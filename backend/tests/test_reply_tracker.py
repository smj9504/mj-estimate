"""Replies to follow-up emails reach the claim's history: the tracker records
what it can save, and later replies come through the stored inbound mail."""

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401
from app.domains.claim_followup.models import CommunicationLog, FollowUpTask, SentEmail  # noqa: E402
from app.domains.claim_followup.reply_tracker import ReplyTracker  # noqa: E402
from app.domains.claim_followup.repository import SentEmailRepository  # noqa: E402
from app.domains.claim_followup.schemas import SentEmailResponse  # noqa: E402
from app.domains.client.models import Claim, ClaimActivity, Client  # noqa: E402
from app.domains.email_ingestion import email_client, service as ingestion_service  # noqa: E402
from app.domains.email_ingestion.email_client import FetchedEmail  # noqa: E402
from app.domains.email_ingestion.models import EmailAccount, ReceivedEmail  # noqa: E402
from app.domains.email_ingestion.service import EmailIngestionService  # noqa: E402
from app.domains.supplement.models import SupplementFollowUp  # noqa: E402


@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(type_, compiler, **kw):
    return 'JSON'


class FakeDatabase:
    def __init__(self, engine):
        self._sessions = sessionmaker(bind=engine)

    def get_session(self):
        return self._sessions()

    get_readonly_session = get_session


class FakeImap:
    """Connects to nothing: the tests hand the tracker its search results."""

    def __init__(self, **kwargs):
        self._connection = SimpleNamespace(select=lambda *a, **k: ('OK', [b'1']))

    def connect(self):
        pass

    def disconnect(self):
        pass


@pytest.fixture
def env(tmp_path, monkeypatch):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'replies.db'}")
    for model in (
        Client, Claim, FollowUpTask, SentEmail, CommunicationLog,
        ClaimActivity, EmailAccount, ReceivedEmail, SupplementFollowUp,
    ):
        model.__table__.create(engine)
    monkeypatch.setattr(email_client, 'IMAPClient', FakeImap)
    monkeypatch.setattr(ingestion_service, 'decrypt_password', lambda _: '')

    database = FakeDatabase(engine)
    session = database.get_session()
    account = EmailAccount(
        display_name='Office', email_address='office@ourco.com', username='office@ourco.com',
        encrypted_password='x', imap_server='imap.gmail.com', imap_port=993,
    )
    client = Client(display_name='A Client')
    session.add_all([account, client])
    session.flush()
    claim = Claim(client_id=client.id, claim_number='0835947722')
    session.add(claim)
    session.commit()

    yield SimpleNamespace(database=database, session=session, account=account, claim=claim)
    session.close()
    engine.dispose()


def add_sent(env, message_id):
    email = SentEmail(
        claim_id=env.claim.id, email_account_id=env.account.id,
        from_address='office@ourco.com', to_addresses=['pat@carrier.com'],
        subject=f'Follow up {message_id}', body_html='<p>Hi</p>', status='sent',
        sent_at=datetime.now(timezone.utc) - timedelta(days=1),
        smtp_message_id=message_id,
    )
    env.session.add(email)
    env.session.commit()
    return email


def reply_to(message_id, own_id, sender='Pat Lee <pat@carrier.com>', subject='Re: Follow up'):
    return FetchedEmail(
        message_id=own_id, subject=subject, sender=sender,
        received_at=datetime(2026, 11, 2, 15, tzinfo=timezone.utc),
        body_text='We got the estimate.', body_html='',
        in_reply_to=message_id, references=message_id,
    )


def run_tracker(env, monkeypatch, replies, broken=()):
    """One tracker pass over the account, with `replies` as the header search result."""
    tracker = ReplyTracker(env.database)
    monkeypatch.setattr(tracker, '_search_by_headers', lambda *a: replies)
    monkeypatch.setattr(tracker, '_search_by_subject', lambda *a: [])
    original = tracker._process_reply

    def process(session, sent_email, reply):
        if reply.message_id in broken:
            raise RuntimeError('value too long')
        original(session, sent_email, reply)

    monkeypatch.setattr(tracker, '_process_reply', process)
    account = {
        'id': str(env.account.id), 'email_address': 'office@ourco.com', 'auth_method': 'password',
        'encrypted_password': 'x', 'imap_server': 'imap.gmail.com', 'imap_port': 993,
        'username': 'office@ourco.com', 'use_ssl': True,
    }
    return tracker._check_account(account)


def replied(env, email):
    env.session.expire_all()
    return env.session.get(SentEmail, email.id).reply_received


def test_a_reply_that_cannot_be_saved_leaves_the_others(env, monkeypatch):
    first, second, third = (add_sent(env, f'<s{n}@ourco.com>') for n in (1, 2, 3))

    found = run_tracker(env, monkeypatch, [
        reply_to('<s1@ourco.com>', '<r1@carrier.com>'),
        reply_to('<s2@ourco.com>', '<r2@carrier.com>'),
        reply_to('<s3@ourco.com>', '<r3@carrier.com>'),
    ], broken={'<r2@carrier.com>'})

    assert found == 2
    assert replied(env, first) and replied(env, third)
    assert not replied(env, second)
    assert env.session.query(CommunicationLog).count() == 2


def test_the_reply_that_failed_is_picked_up_on_the_next_run(env, monkeypatch):
    email = add_sent(env, '<s1@ourco.com>')
    reply = reply_to('<s1@ourco.com>', '<r1@carrier.com>')

    run_tracker(env, monkeypatch, [reply], broken={'<r1@carrier.com>'})
    assert not replied(env, email)

    assert run_tracker(env, monkeypatch, [reply]) == 1
    assert replied(env, email)


def test_long_headers_are_cut_to_fit_their_columns(env, monkeypatch):
    add_sent(env, '<s1@ourco.com>')
    sender = f"{'A very long display name ' * 20}<pat@carrier.com>"

    run_tracker(env, monkeypatch, [
        reply_to('<s1@ourco.com>', '<r1@carrier.com>', sender=sender, subject='Re: ' + 'x' * 600),
    ])

    log = env.session.query(CommunicationLog).one()
    assert len(log.contact_email) == 255
    assert len(log.subject) == 500
    assert len(env.session.query(ClaimActivity).one().title) == 500


def test_a_second_reply_reaches_the_claim_through_stored_mail(env, monkeypatch):
    """The tracker stops watching an email after its first reply."""
    email = add_sent(env, '<s1@ourco.com>')
    run_tracker(env, monkeypatch, [reply_to('<s1@ourco.com>', '<r1@carrier.com>')])

    service = EmailIngestionService(env.database)
    later = reply_to('<s1@ourco.com>', '<r2@carrier.com>')
    assert service._save_received_email(env.session, str(env.account.id), later)

    listed = service.get_received_emails(claim_id=str(env.claim.id))['items']
    assert [m['message_id'] for m in listed] == ['<r2@carrier.com>']
    assert listed[0]['in_reply_to'] == '<s1@ourco.com>'
    assert env.session.get(SentEmail, email.id).reply_received


def test_tracker_log_and_stored_message_agree_on_sender_and_date(env, monkeypatch):
    """The history drops the log line for a message it lists, by these two fields."""
    add_sent(env, '<s1@ourco.com>')
    reply = reply_to('<s1@ourco.com>', '<r1@carrier.com>')
    run_tracker(env, monkeypatch, [reply])
    EmailIngestionService(env.database)._save_received_email(env.session, str(env.account.id), reply)

    log = env.session.query(CommunicationLog).one()
    stored = env.session.query(ReceivedEmail).one()

    assert log.contact_email == stored.sender
    assert log.response_date == stored.received_at


def test_the_history_gets_each_sent_emails_message_id(env):
    add_sent(env, '<s1@ourco.com>')

    rows = SentEmailRepository(env.session).get_by_claim(str(env.claim.id))

    assert SentEmailResponse(**rows[0]).smtp_message_id == '<s1@ourco.com>'
