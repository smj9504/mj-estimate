"""Confirming an emailed attachment in Attachment Review: it arrives preset
with the client/claim its email belongs to, and it is filed on the claim as
the document type the reviewer picks - only an insurance estimate makes a
negotiation revision."""

from datetime import datetime
from pathlib import Path
import sys

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.sqlite import base as sqlite_base
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401
from app.domains.client.models import Claim, ClaimNegotiation, Client  # noqa: E402
from app.domains.email_ingestion.models import (  # noqa: E402
    EmailAccount,
    EmailIngestionLog,
    ReceivedEmail,
)
from app.domains.email_ingestion.service import EmailIngestionService  # noqa: E402
from app.domains.file.models import File  # noqa: E402


@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(type_, compiler, **kw):
    return 'JSON'


def _accept_iso_strings(monkeypatch):
    """The repository writes a revision's dates as ISO strings, which Postgres
    takes and SQLite's DateTime refuses; parse them as Postgres would"""
    real = sqlite_base.DATETIME.bind_processor

    def bind_processor(self, dialect):
        process = real(self, dialect)

        def parse_then_process(value):
            if isinstance(value, str):
                value = datetime.fromisoformat(value.replace('Z', '+00:00'))
            return process(value)
        return parse_then_process
    monkeypatch.setattr(sqlite_base.DATETIME, 'bind_processor', bind_processor)


class _Database:
    def __init__(self, make_session):
        self._make_session = make_session

    def get_session(self):
        return self._make_session()

    get_readonly_session = get_session


@pytest.fixture
def env(tmp_path, monkeypatch):
    _accept_iso_strings(monkeypatch)
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'confirm.db'}")
    for model in (Client, Claim, ClaimNegotiation, EmailAccount, EmailIngestionLog,
                  ReceivedEmail, File):
        model.__table__.create(engine)
    make_session = sessionmaker(bind=engine, expire_on_commit=False)
    session = make_session()

    office = EmailAccount(
        display_name='Office', email_address='office@ourco.com', username='office@ourco.com',
        encrypted_password='x', imap_server='imap.gmail.com', imap_port=993,
    )
    other_box = EmailAccount(
        display_name='Other', email_address='other@theirco.com', username='other@theirco.com',
        encrypted_password='x', imap_server='imap.gmail.com', imap_port=993,
    )
    dana = Client(display_name='Dana Whitfield', address='4410 Briarwood Street')
    lee = Client(display_name='Lee Ortega', address='17 Quarry Rd')
    session.add_all([office, other_box, dana, lee])
    session.flush()
    claim = Claim(client_id=dana.id, claim_number='CLM-0098812', status='open')
    session.add(claim)
    session.flush()

    def add_log(message_id, name, account=office, status='pending', **fields):
        stored = File(
            filename=name, original_name=name, content_type='application/pdf', size=1,
            url=f'/files/{name}', context='email-ingestion', context_id=str(account.id),
            category='pending-estimate',
        )
        session.add(stored)
        session.flush()
        log = EmailIngestionLog(
            email_account_id=account.id, message_id=message_id, subject='Claim packet',
            sender='adjuster@carrier.com', attachment_name=name, status=status,
            file_id=stored.id, **fields,
        )
        session.add(log)
        session.flush()
        return log

    session.commit()
    yield {
        'session': session, 'add_log': add_log, 'office': office, 'other_box': other_box,
        'dana': dana, 'lee': lee, 'claim': claim,
        'service': EmailIngestionService(_Database(make_session)),
    }
    session.close()


def _by_name(env):
    env['session'].commit()
    return {log['attachment_name']: log for log in env['service'].get_logs(limit=50)}


def test_unmatched_attachment_takes_its_emails_match(env):
    env['add_log']('<packet>', 'estimate.pdf', matched_client_id=env['dana'].id,
                   matched_claim_id=env['claim'].id, match_method='claim_number',
                   match_confidence=95)
    env['add_log']('<packet>', 'photos.pdf')

    photos = _by_name(env)['photos.pdf']

    assert str(photos['matched_client_id']) == str(env['dana'].id)
    assert str(photos['matched_claim_id']) == str(env['claim'].id)
    assert photos['match_method'] == 'same_email'
    assert photos['client_name'] == 'Dana Whitfield'
    assert photos['claim_number'] == 'CLM-0098812'


def test_a_confirmed_sibling_decides_where_the_rest_go(env):
    # The estimate matched the client by address only; the reviewer then put
    # the letter on the claim, which is where the estimate should follow.
    env['add_log']('<packet>', 'estimate.pdf', matched_client_id=env['dana'].id,
                   match_method='address', match_confidence=70)
    env['add_log']('<packet>', 'letter.pdf', status='uploaded',
                   matched_client_id=env['dana'].id, matched_claim_id=env['claim'].id,
                   match_method='manual', match_confidence=100)
    env['add_log']('<packet>', 'sketch.pdf')

    logs = _by_name(env)

    assert str(logs['estimate.pdf']['matched_claim_id']) == str(env['claim'].id)
    assert logs['estimate.pdf']['match_method'] == 'address'
    assert str(logs['sketch.pdf']['matched_claim_id']) == str(env['claim'].id)
    assert logs['sketch.pdf']['match_confidence'] == 100


def test_an_attachments_own_match_to_another_client_is_kept(env):
    env['add_log']('<two-claims>', 'dana.pdf', matched_client_id=env['dana'].id,
                   matched_claim_id=env['claim'].id, match_confidence=95)
    env['add_log']('<two-claims>', 'lee.pdf', matched_client_id=env['lee'].id,
                   match_confidence=60)

    lee = _by_name(env)['lee.pdf']

    assert str(lee['matched_client_id']) == str(env['lee'].id)
    assert lee['matched_claim_id'] is None


def test_the_same_email_in_another_mailbox_suggests_nothing(env):
    env['add_log']('<cc>', 'estimate.pdf', matched_client_id=env['dana'].id,
                   matched_claim_id=env['claim'].id, match_confidence=95)
    env['add_log']('<cc>', 'photos.pdf', account=env['other_box'])

    assert _by_name(env)['photos.pdf']['matched_client_id'] is None


def test_a_non_estimate_is_filed_without_a_revision(env):
    log = env['add_log']('<packet>', 'denial.pdf')
    env['session'].commit()

    result = env['service'].manual_assign(str(log.id), {
        'client_id': env['dana'].id, 'claim_id': env['claim'].id,
        'document_type': 'carrier-letter',
    })

    session = env['session']
    session.expire_all()
    stored = session.get(File, log.file_id)
    assert (stored.context, stored.context_id, stored.category) == (
        'claim-document', str(env['claim'].id), 'carrier-letter')
    assert result['status'] == 'uploaded'
    assert result['document_type'] == 'carrier-letter'
    assert result['negotiation_id'] is None
    assert session.query(ClaimNegotiation).count() == 0
    assert session.get(Claim, env['claim'].id).status == 'open'
    assert _by_name(env)['denial.pdf']['document_type'] == 'carrier-letter'


def test_an_insurance_estimate_becomes_a_revision(env):
    log = env['add_log']('<packet>', 'estimate.pdf')
    env['session'].commit()

    result = env['service'].manual_assign(str(log.id), {
        'client_id': env['dana'].id, 'claim_id': env['claim'].id,
        'document_type': 'insurance-estimate',
    })

    session = env['session']
    session.expire_all()
    revision = session.query(ClaimNegotiation).one()
    assert str(revision.id) == str(result['negotiation_id'])
    assert revision.revision_number == 1
    assert session.get(File, log.file_id).category == 'insurance-estimate'
    assert _by_name(env)['estimate.pdf']['document_type'] == 'insurance-estimate'


def test_a_pending_attachment_has_no_document_type_yet(env):
    env['add_log']('<packet>', 'estimate.pdf')

    assert _by_name(env)['estimate.pdf'].get('document_type') is None
