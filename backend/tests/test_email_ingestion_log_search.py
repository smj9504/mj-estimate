"""Attachment Review can find an email by the address, claim number or policy
number it concerns, and a hit brings back every attachment of that email."""

from pathlib import Path
import sys

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401
from app.domains.client.address_utils import normalize_address  # noqa: E402
from app.domains.client.models import Claim, Client  # noqa: E402
from app.domains.email_ingestion.models import (  # noqa: E402
    EmailAccount,
    EmailIngestionLog,
    ReceivedEmail,
)
from app.domains.email_ingestion.repository import EmailIngestionLogRepository  # noqa: E402


@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(type_, compiler, **kw):
    return 'JSON'


@pytest.fixture
def env(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'logs.db'}")
    for model in (Client, Claim, EmailAccount, EmailIngestionLog, ReceivedEmail):
        model.__table__.create(engine)
    session = sessionmaker(bind=engine)()

    account = EmailAccount(
        display_name='Office', email_address='office@ourco.com', username='office@ourco.com',
        encrypted_password='x', imap_server='imap.gmail.com', imap_port=993,
    )
    address = '4410 Briarwood Street'
    client = Client(
        display_name='Dana Whitfield', address=address, city='Plano', zipcode='75023',
        normalized_address=normalize_address(address), insurance_policy_number='POL-55120',
    )
    session.add_all([account, client])
    session.flush()
    claim = Claim(client_id=client.id, claim_number='CLM-0098812')
    session.add(claim)
    session.flush()

    def add_log(message_id, attachment_name, status='pending', subject='Estimate attached', **fields):
        log = EmailIngestionLog(
            email_account_id=account.id, message_id=message_id, subject=subject,
            sender='adjuster@carrier.com', attachment_name=attachment_name, status=status, **fields,
        )
        session.add(log)
        return log

    # The estimate won the match; the photo report riding along did not.
    add_log('<matched@carrier>', 'estimate.pdf',
            matched_client_id=client.id, matched_claim_id=claim.id)
    add_log('<matched@carrier>', 'photos.pdf')
    # Nothing matched, but the carrier quoted the loss in the body.
    add_log('<body-only@carrier>', 'scope.pdf', subject='New assignment')
    session.add(ReceivedEmail(
        email_account_id=account.id, message_id='<body-only@carrier>', subject='New assignment',
        body_text='Please inspect the loss at 912 Larkspur Ln, claim 77-HX-4021.',
    ))
    add_log('<unrelated@carrier>', 'w9.pdf', status='skipped', subject='W9 request')
    session.commit()

    yield EmailIngestionLogRepository(session)
    session.close()


def _found(repo, term, **filters):
    return sorted(
        (log['message_id'], log['attachment_name'])
        for log in repo.get_logs_with_filters(search=term, **filters)
    )


MATCHED_EMAIL = [('<matched@carrier>', 'estimate.pdf'), ('<matched@carrier>', 'photos.pdf')]


def test_claim_number_finds_the_matched_email_with_its_siblings(env):
    assert _found(env, '0098812') == MATCHED_EMAIL


def test_client_address_finds_the_matched_email(env):
    assert _found(env, 'briarwood') == MATCHED_EMAIL


def test_address_spelled_differently_still_finds_the_client(env):
    # Stored "Street", searched "St." - only the normalized address agrees.
    assert _found(env, '4410 Briarwood St.') == MATCHED_EMAIL


def test_policy_number_and_client_name_find_the_matched_email(env):
    assert _found(env, 'pol-55120') == MATCHED_EMAIL
    assert _found(env, 'whitfield') == MATCHED_EMAIL


def test_email_body_finds_an_unmatched_attachment(env):
    assert _found(env, '912 Larkspur') == [('<body-only@carrier>', 'scope.pdf')]
    assert _found(env, '77-HX-4021') == [('<body-only@carrier>', 'scope.pdf')]


def test_file_name_and_subject_are_searched(env):
    assert _found(env, 'w9') == [('<unrelated@carrier>', 'w9.pdf')]
    assert _found(env, 'new assignment') == [('<body-only@carrier>', 'scope.pdf')]


def test_search_narrows_within_the_status_filter(env):
    assert _found(env, 'w9', status='pending') == []
    assert _found(env, 'w9', status='skipped') == [('<unrelated@carrier>', 'w9.pdf')]


def test_blank_search_returns_everything(env):
    assert len(_found(env, '  ')) == 4
    assert _found(env, 'no such thing') == []
