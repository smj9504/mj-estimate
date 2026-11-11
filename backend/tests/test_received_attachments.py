"""The files on a claim's received mail can be opened from the claim: Check
inbox (and the morning poll) keep every file of mail filed on a claim, a PDF
the classifier would pass over included, and a PDF waiting for review can
become the claim's estimate revision."""

from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
import sys
import uuid

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
from app.domains.claim_followup.models import FollowUpTask, SentEmail  # noqa: E402
from app.domains.client.models import Claim, Client  # noqa: E402
from app.domains.email_ingestion.claim_inbox import ClaimInboxService  # noqa: E402
from app.domains.email_ingestion.email_client import (  # noqa: E402
    EmailAttachment,
    FetchedEmail,
    IMAPClient,
)
from app.domains.email_ingestion.models import (  # noqa: E402
    EmailAccount,
    EmailIngestionLog,
    ReceivedEmail,
)
from app.domains.email_ingestion.service import EmailIngestionService  # noqa: E402
from app.domains.file.models import File  # noqa: E402
from app.domains.water_mitigation.models import WaterMitigationJob  # noqa: E402


@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(type_, compiler, **kw):
    return 'JSON'


def _accept_iso_strings(monkeypatch):
    """The repository writes a log's dates as ISO strings, which Postgres
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


class FakeDatabase:
    def __init__(self, engine):
        self._sessions = sessionmaker(bind=engine, expire_on_commit=False)

    def get_session(self):
        return self._sessions()

    get_readonly_session = get_session


class FakeFileService:
    """Stores the File row the way FileService does, the bytes in memory"""
    uploads = []

    def __init__(self, database):
        self.repository = SimpleNamespace(session=database.get_session())

    async def upload_file(self, file_data, original_filename, content_type, context,
                          context_id, category='general', description=None, **_):
        data = file_data.read()
        # Not shaped like a UUID: the log repository would make one a UUID
        # object, which Postgres stores in file_id and SQLite refuses
        stored = File(
            id=f'file-{uuid.uuid4().hex}', filename=original_filename, original_name=original_filename,
            content_type=content_type, size=len(data), url=f'mem://{original_filename}',
            storage_provider='local', context=context, context_id=context_id,
            category=category, description=description,
        )
        self.repository.session.add(stored)
        self.repository.session.flush()
        FakeFileService.uploads.append((original_filename, context))
        return {'id': stored.id, 'url': stored.url}


SENT_ID = '<179372152567.1.178@ourco.com>'
PA = 'Pat Lee <pa@advocates.example>'
PDF = b'%PDF-1.4 not much of a pdf'


@pytest.fixture
def env(tmp_path, monkeypatch):
    _accept_iso_strings(monkeypatch)
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'received_files.db'}")
    for model in (WaterMitigationJob, Client, Claim, SentEmail, FollowUpTask,
                  EmailAccount, ReceivedEmail, EmailIngestionLog, File):
        model.__table__.create(engine)
    database = FakeDatabase(engine)
    session = database.get_session()

    session.add(EmailAccount(
        display_name='Office', email_address='office@ourco.com', username='office@ourco.com',
        encrypted_password='x', imap_server='imap.gmail.com', imap_port=993,
    ))
    client = Client(display_name='Sylvia Lam', address='6315 Cardinal Hill Pl, Springfield VA 22152')
    session.add(client)
    session.flush()
    claim = Claim(client_id=client.id, claim_number='202610020025')
    session.add(claim)
    session.flush()
    session.add(SentEmail(
        claim_id=claim.id, from_address='office@ourco.com', to_addresses=['pa@advocates.example'],
        subject="Plumber's Report — 6315 Cardinal Hill Pl", body_html='<p>Attached</p>',
        status='sent', smtp_message_id=SENT_ID,
        attachments=[{'filename': 'Plumber Report.pdf', 'mime_type': 'application/pdf'}],
    ))
    session.commit()

    FakeFileService.uploads = []
    monkeypatch.setattr('app.domains.file.service.FileService', FakeFileService)
    monkeypatch.setattr('app.domains.email_ingestion.service.decrypt_password', lambda _: 'pw')

    yield {'database': database, 'session': session, 'claim': claim, 'client': client}
    session.close()
    engine.dispose()


def reply(message_id='<r1@gmail.com>', attachments=(), unread=(), in_reply_to=SENT_ID,
          sender=PA, body='See the attached.'):
    return FetchedEmail(
        message_id=message_id, subject="Re: Plumber's Report — 6315 Cardinal Hill Pl",
        sender=sender, received_at=datetime(2026, 11, 10, 15, 4, tzinfo=timezone.utc),
        body_text=body, body_html='', in_reply_to=in_reply_to,
        attachments=list(attachments), unread_attachment_names=list(unread),
    )


def check(env, monkeypatch, *found):
    monkeypatch.setattr(IMAPClient, 'search_emails', lambda self, *a, **k: iter(found))
    result = ClaimInboxService(env['database']).check_claim_inbox(str(env['claim'].id))
    env['session'].expire_all()
    return result


def estimate_pdf():
    # Named for the address only: no filename rule, sender or text says estimate
    return EmailAttachment('6315 Cardinal Hill.pdf', 'application/pdf', PDF)


def photo():
    return EmailAttachment('kitchen.jpg', 'image/jpeg', b'\xff\xd8\xff photo bytes')


def own_file():
    return EmailAttachment('Plumber Report.pdf', 'application/pdf', b'%PDF-1.4 ours')


# ---- what a check keeps ----

def test_check_keeps_every_file_of_the_claims_mail(env, monkeypatch):
    check(env, monkeypatch, reply(attachments=[estimate_pdf(), photo(), own_file()]))

    session = env['session']
    logs = {log.attachment_name: log for log in session.query(EmailIngestionLog)}
    kept = logs['6315 Cardinal Hill.pdf']
    assert kept.status == 'pending'
    assert kept.file_id
    assert kept.is_insurance_estimate is False
    assert 'its email is filed on a claim' in kept.classification_reason
    # Our own report coming back in the reply isn't stored again
    assert logs['Plumber Report.pdf'].status == 'skipped'
    assert logs['Plumber Report.pdf'].file_id is None

    [email] = session.query(ReceivedEmail).all()
    [picture] = session.query(File).filter(File.context == 'received-email').all()
    assert (picture.original_name, picture.context_id, picture.content_type) == (
        'kitchen.jpg', str(email.id), 'image/jpeg')
    assert sorted(FakeFileService.uploads) == [
        ('6315 Cardinal Hill.pdf', 'email-ingestion'), ('kitchen.jpg', 'received-email'),
    ]


def test_a_second_check_stores_nothing_again(env, monkeypatch):
    message = reply(attachments=[estimate_pdf(), photo()])
    check(env, monkeypatch, message)
    check(env, monkeypatch, message)

    assert len(FakeFileService.uploads) == 2
    assert env['session'].query(EmailIngestionLog).count() == 1


def test_mail_already_stored_gets_its_files_on_the_next_check(env, monkeypatch):
    message = reply(attachments=[estimate_pdf()])
    # Stored by a check from before files were kept
    session = env['session']
    session.add(ReceivedEmail(
        email_account_id=session.query(EmailAccount.id).scalar(), message_id=message.message_id,
        subject=message.subject, sender=message.sender, attachment_names=['6315 Cardinal Hill.pdf'],
        matched_client_id=env['client'].id, matched_claim_id=env['claim'].id,
        match_method='reply_thread', match_confidence=95,
    ))
    session.commit()

    result = check(env, monkeypatch, message)

    assert result['saved'] == 0
    [log] = env['session'].query(EmailIngestionLog).all()
    assert (log.status, bool(log.file_id)) == ('pending', True)


def test_mail_on_no_claim_keeps_no_files(env, monkeypatch):
    stranger = reply(
        message_id='<n1@news.example>', in_reply_to='', sender='Deals <deals@news.example>',
        body='Nothing about any claim', attachments=[estimate_pdf(), photo()],
    )
    check(env, monkeypatch, stranger)

    session = env['session']
    assert session.query(EmailIngestionLog).count() == 0
    assert session.query(File).count() == 0


def test_a_pdf_passed_over_before_is_kept_once_its_mail_is_on_a_claim(env, monkeypatch):
    message = reply(attachments=[estimate_pdf()])
    session = env['session']
    # The poll saw it first, before the email could be filed on the claim
    session.add(EmailIngestionLog(
        email_account_id=session.query(EmailAccount.id).scalar(), message_id=message.message_id,
        attachment_name='6315 Cardinal Hill.pdf',
        attachment_hash=message.attachments[0].sha256_hash, status='skipped',
        is_insurance_estimate=False, classification_reason='[Name:0%] no document type',
        skip_reason='Not classified as insurance estimate (confidence: 0%)',
    ))
    session.commit()

    check(env, monkeypatch, message)

    [log] = env['session'].query(EmailIngestionLog).all()
    assert (log.status, log.skip_reason, bool(log.file_id)) == ('pending', None, True)
    assert log.classification_reason == (
        '[Name:0%] no document type | Kept: its email is filed on a claim'
    )


# ---- what the claim page lists and opens ----

def test_the_emails_files_are_listed_and_only_they_open(env, monkeypatch):
    check(env, monkeypatch, reply(
        attachments=[estimate_pdf(), photo(), own_file()], unread=['drone video.zip'],
    ))
    service = EmailIngestionService(env['database'])
    [email] = env['session'].query(ReceivedEmail).all()

    items = service.get_received_attachments(str(email.id))

    by_name = {item['name']: item for item in items}
    assert [item['kind'] for item in items] == ['pdf', 'pdf', 'file', 'missing']
    estimate = by_name['6315 Cardinal Hill.pdf']
    assert (estimate['can_file'], estimate['status'], estimate['note']) == (True, 'pending', None)
    ours = by_name['Plumber Report.pdf']
    assert (ours['file_id'], ours['can_file'], ours['note']) == (
        None, False, 'Our own file, sent from the app')
    assert by_name['kitchen.jpg']['file_id']
    assert by_name['drone video.zip']['note'] == 'Not stored in the app'

    readable = service.received_attachment_file(str(email.id), by_name['kitchen.jpg']['file_id'])
    assert readable == {
        'filename': 'kitchen.jpg', 'mime_type': 'image/jpeg',
        'read': ('file', 'mem://kitchen.jpg', 'local'),
    }
    # Any other stored file is not this email's to open
    session = env['session']
    other = File(id=str(uuid.uuid4()), filename='x.pdf', original_name='x.pdf',
                 content_type='application/pdf', size=1, url='mem://x.pdf',
                 context='claim-document', context_id=str(env['claim'].id))
    session.add(other)
    session.commit()
    assert service.received_attachment_file(str(email.id), other.id) is None


def test_a_duplicate_opens_the_copy_already_stored(env, monkeypatch):
    message = reply(attachments=[estimate_pdf()])
    check(env, monkeypatch, message)
    session = env['session']
    [first] = session.query(EmailIngestionLog).all()
    # The same PDF again in a later email
    later = ReceivedEmail(
        email_account_id=first.email_account_id, message_id='<r9@gmail.com>',
        subject='Fwd: estimate', attachment_names=['6315 Cardinal Hill.pdf'],
        matched_client_id=env['client'].id, matched_claim_id=env['claim'].id,
    )
    session.add(later)
    session.add(EmailIngestionLog(
        email_account_id=first.email_account_id, message_id='<r9@gmail.com>',
        attachment_name='6315 Cardinal Hill.pdf', attachment_hash=first.attachment_hash,
        status='duplicate', skip_reason='Attachment with same hash already uploaded',
    ))
    session.commit()

    [item] = EmailIngestionService(env['database']).get_received_attachments(str(later.id))

    assert (item['file_id'], item['can_file'], item['note']) == (
        first.file_id, False, 'Same file as one received before')


# ---- becoming the claim's estimate revision ----

def test_a_pending_pdf_becomes_the_revision_and_is_filed(env, monkeypatch):
    check(env, monkeypatch, reply(attachments=[estimate_pdf()]))
    service = EmailIngestionService(env['database'])
    [log] = env['session'].query(EmailIngestionLog).all()

    assert service.pending_log_file_id(str(log.id)) == log.file_id
    negotiation_id = str(uuid.uuid4())
    service.mark_filed_as_revision(
        str(log.id), str(env['client'].id), str(env['claim'].id), negotiation_id,
        reviewed_by='Morgan Office',
    )

    session = env['session']
    session.expire_all()
    log = session.get(EmailIngestionLog, log.id)
    assert (log.status, log.match_method, str(log.negotiation_id), log.reviewed_by) == (
        'uploaded', 'manual', negotiation_id, 'Morgan Office')
    stored = session.get(File, log.file_id)
    assert (stored.context, stored.context_id, stored.category) == (
        'claim-negotiation', str(env['claim'].id), 'insurance-estimate')
    # Filed once only
    with pytest.raises(ValueError):
        service.pending_log_file_id(str(log.id))
    [email] = session.query(ReceivedEmail).all()
    [item] = service.get_received_attachments(str(email.id))
    assert (item['document_type'], item['can_file']) == ('insurance-estimate', False)


def test_the_poll_keeps_the_files_of_mail_on_a_claim_too(env, monkeypatch):
    message = reply(attachments=[estimate_pdf(), photo()])
    monkeypatch.setattr(IMAPClient, 'fetch_emails', lambda self, *a, **k: iter([message]))
    session = env['session']
    account_id = str(session.query(EmailAccount.id).scalar())

    stats = EmailIngestionService(env['database']).poll_account(account_id)

    session.expire_all()
    assert (stats['emails_saved'], stats['pending']) == (1, 1)
    [log] = session.query(EmailIngestionLog).all()
    assert (log.status, bool(log.file_id)) == ('pending', True)
    assert session.query(File).filter(File.context == 'received-email').count() == 1


def test_the_poll_still_passes_over_a_pdf_on_mail_on_no_claim(env, monkeypatch):
    stranger = reply(
        message_id='<n1@news.example>', in_reply_to='', sender='Deals <deals@news.example>',
        body='Nothing about any claim', attachments=[estimate_pdf(), photo()],
    )
    monkeypatch.setattr(IMAPClient, 'fetch_emails', lambda self, *a, **k: iter([stranger]))
    session = env['session']

    EmailIngestionService(env['database']).poll_account(str(session.query(EmailAccount.id).scalar()))

    session.expire_all()
    [log] = session.query(EmailIngestionLog).all()
    assert (log.status, log.file_id) == ('skipped', None)
    assert session.query(File).count() == 0

