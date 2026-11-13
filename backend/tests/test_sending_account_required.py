"""Email a person sends from the app goes out only from an account added under
Email Accounts - never from the server's own address (user's rule, 2026-11-05).
Contract signing mail to customers and account mail (password reset) are not
covered and keep their fallback."""

import asyncio
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: E402,F401
from app.domains.claim_followup.models import FollowUpTask, SentEmail  # noqa: E402
from app.domains.claim_followup.service import (  # noqa: E402
    NO_SENDING_ACCOUNT, ClaimFollowUpService,
)
from app.domains.claim_followup.smtp_service import SmtpService  # noqa: E402
from app.domains.email_ingestion.models import EmailAccount  # noqa: E402
from app.domains.supplement.models import SupplementFollowUp, SupplementRequest  # noqa: E402
from app.domains.supplement.service import (  # noqa: E402
    NO_ACCOUNT_ON_INFO_REQUEST, SupplementService,
)

CLAIM_ID = '11111111-1111-1111-1111-111111111111'

# Sent by an admin: any account may be used (access rules: test_email_account_guard.py)
ADMIN = SimpleNamespace(id='99999999-9999-9999-9999-999999999999', role='admin')


@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(type_, compiler, **kw):
    return 'JSON'


class FakeDatabase:
    def __init__(self, engine):
        self._sessions = sessionmaker(bind=engine)

    def get_session(self):
        return self._sessions()

    get_readonly_session = get_session


@pytest.fixture
def env(tmp_path, monkeypatch):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'mail.db'}")
    for model in (EmailAccount, SentEmail, FollowUpTask, SupplementRequest, SupplementFollowUp):
        model.__table__.create(engine)
    database = FakeDatabase(engine)
    # Services that build their own ClaimFollowUpService must not reach a real DB
    import app.core.database_factory as database_factory
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)

    smtp_calls = []
    monkeypatch.setattr(
        SmtpService, 'send',
        lambda self, **kwargs: smtp_calls.append(kwargs) or {'message_id': '<sent@test>'},
    )

    session = database.get_session()

    def account(**fields):
        row = EmailAccount(
            display_name='Office', email_address=fields.pop('email_address', 'office@abc.com'),
            username='office@abc.com', encrypted_password='x', **fields,
        )
        session.add(row)
        session.commit()
        return str(row.id)

    yield SimpleNamespace(database=database, session=session, account=account, smtp_calls=smtp_calls)
    session.close()
    engine.dispose()


def send(env, **data):
    return ClaimFollowUpService(env.database).send_email({
        'claim_id': None,
        'to_addresses': ['adjuster@carrier.com'],
        'subject': 'Documents',
        'body_html': '<p>Attached.</p>',
        **data,
    }, sender=ADMIN)


def test_no_account_is_refused_and_nothing_goes_out(env):
    with pytest.raises(ValueError, match='Choose a sending account'):
        send(env)
    assert env.smtp_calls == []


def test_a_typed_from_address_alone_is_refused(env):
    with pytest.raises(ValueError, match='Choose a sending account'):
        send(env, from_address='office@abcrestoration.com')
    assert env.smtp_calls == []


def test_an_unknown_or_malformed_account_is_refused(env):
    for bad in ('not-a-uuid', '22222222-2222-2222-2222-222222222222'):
        with pytest.raises(ValueError, match='Choose a sending account'):
            send(env, email_account_id=bad)
    assert env.smtp_calls == []


@pytest.mark.parametrize('fields', [{'is_active': False}, {'can_send': False}])
def test_an_account_turned_off_for_sending_is_refused(env, fields):
    account_id = env.account(**fields)
    with pytest.raises(ValueError, match='office@abc.com is turned off for sending'):
        send(env, email_account_id=account_id)
    assert env.smtp_calls == []


def test_a_registered_account_sends_as_itself(env):
    account_id = env.account()
    send(env, email_account_id=account_id)
    [call] = env.smtp_calls
    assert call['account_id'] == account_id
    assert call['from_address'] == 'office@abc.com'


def test_require_sending_account_message():
    assert 'Email Accounts' in NO_SENDING_ACCOUNT


# --- Supplement info request: resend and reply leave from the first account ---

def info_request(env, sent_from=None):
    session = env.session
    sent = SentEmail(
        claim_id=CLAIM_ID, email_account_id=sent_from, from_address='x@abc.com',
        to_addresses=['pa@pa-firm.com'], subject='Information Request', body_html='<p>Hi</p>',
        status='sent',
    )
    session.add(sent)
    session.commit()
    followup = SupplementFollowUp(
        supplement_id='33333333-3333-3333-3333-333333333333',
        followup_type='info_request', contact_method='email',
        contact_email='pa@pa-firm.com', sent_email_id=sent.id, items_needed=[],
    )
    session.add(followup)
    session.commit()
    return followup


def test_resend_goes_out_from_the_account_the_request_used(env, monkeypatch):
    account_id = env.account()
    followup = info_request(env, sent_from=account_id)
    payloads = []
    monkeypatch.setattr(
        ClaimFollowUpService, 'send_email',
        lambda self, data, **kw: payloads.append(data) or {'id': None},
    )
    SupplementService(env.database).resend_info_request(
        str(followup.supplement_id), str(followup.id), {}, sender=ADMIN,
    )
    [payload] = payloads
    assert payload['email_account_id'] == account_id


def test_resend_of_a_request_sent_from_the_server_address_is_refused(env, monkeypatch):
    followup = info_request(env, sent_from=None)
    monkeypatch.setattr(
        ClaimFollowUpService, 'send_email',
        lambda self, data, **kw: pytest.fail('sent without an account'),
    )
    with pytest.raises(ValueError, match='no longer used'):
        SupplementService(env.database).resend_info_request(
            str(followup.supplement_id), str(followup.id), {}, sender=ADMIN,
        )
    assert 'new info request' in NO_ACCOUNT_ON_INFO_REQUEST


# --- Report sends refuse before building the PDF ---

@pytest.mark.parametrize('module_path, endpoint, request_cls, service_cls', [
    ('app.domains.electrician_report.api', 'send_electrician_report_to_pa',
     'SendElectricianReportRequest', 'ElectricianReportService'),
    ('app.domains.plumber_report.api', 'send_plumber_report_to_pa',
     'SendPlumberReportRequest', 'PlumberReportService'),
])
def test_report_send_without_an_account_stops_before_the_pdf(
    env, monkeypatch, module_path, endpoint, request_cls, service_cls,
):
    import importlib
    api = importlib.import_module(module_path)
    monkeypatch.setattr(api, 'require_report', lambda *args: None)
    monkeypatch.setattr(
        getattr(api, service_cls), 'get_report',
        staticmethod(lambda db, report_id: SimpleNamespace(property_address='12 Elm St')),
    )
    monkeypatch.setattr(api, 'PDFService', SimpleNamespace(
        generate_electrician_report_pdf=lambda *a: pytest.fail('PDF built'),
        generate_plumber_report_pdf=lambda *a: pytest.fail('PDF built'),
    ))
    request = getattr(api, request_cls)(
        to_addresses=['pa@pa-firm.com'], subject='Report', body_html='<p>Hi</p>',
    )
    def run():
        result = getattr(api, endpoint)(
            '44444444-4444-4444-4444-444444444444', request, env.session, SimpleNamespace(),
        )
        if asyncio.iscoroutine(result):
            asyncio.run(result)

    with pytest.raises(HTTPException) as caught:
        run()
    assert caught.value.status_code == 400
    assert 'Choose a sending account' in caught.value.detail


# --- The relay toggle is gone ---

def test_the_relay_setting_endpoint_is_gone():
    client = TestClient(app.main.app)
    assert client.get('/api/admin/settings/route-personal-accounts').status_code == 404
