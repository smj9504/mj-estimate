"""A claim's mail can be fetched from the inboxes on demand, and a message too
big to parse whole is read part by part, so the morning poll survives it."""

from datetime import datetime, timezone
from email.mime.application import MIMEApplication
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
import re
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
from app.domains.claim_followup.models import FollowUpTask, SentEmail  # noqa: E402
from app.domains.client.models import Claim, Client  # noqa: E402
from app.domains.email_ingestion import email_client  # noqa: E402
from app.domains.email_ingestion.claim_inbox import (  # noqa: E402
    ClaimInboxService,
    claim_search_terms,
    street_search_term,
)
from app.domains.email_ingestion.email_client import (  # noqa: E402
    FetchedEmail,
    IMAPClient,
    _decode_header_value,
)
from app.domains.email_ingestion.models import EmailAccount, ReceivedEmail  # noqa: E402
from app.domains.water_mitigation.models import WaterMitigationJob  # noqa: E402


@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(type_, compiler, **kw):
    return 'JSON'


class FakeDatabase:
    def __init__(self, engine):
        self._sessions = sessionmaker(bind=engine)

    def get_session(self):
        return self._sessions()

    get_readonly_session = get_session


SENT_ID = '<179372152567.1.178@ourco.com>'


@pytest.fixture
def env(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'claim_inbox.db'}")
    for model in (WaterMitigationJob, Client, Claim, SentEmail, FollowUpTask, EmailAccount, ReceivedEmail):
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
        claim_id=claim.id, from_address='office@ourco.com', to_addresses=['pa@advocates.com'],
        subject="Plumber's Report — 6315 Cardinal Hill Pl", body_html='<p>Attached</p>',
        status='sent', smtp_message_id=SENT_ID,
    ))
    session.commit()

    yield {'database': database, 'session': session, 'claim': claim}
    session.close()
    engine.dispose()


def mail(message_id, subject, in_reply_to='', references='', body='Thanks!'):
    return FetchedEmail(
        message_id=message_id, subject=subject, sender='Pat Lee <pa@advocates.com>',
        received_at=datetime(2026, 11, 4, 22, 59, tzinfo=timezone.utc),
        body_text=body, body_html='', in_reply_to=in_reply_to, references=references,
    )


# ---- the claim check ----

def test_street_term_is_the_house_number_and_street_name():
    assert street_search_term('6315 Cardinal Hill Pl, Springfield VA 22152') == '6315 Cardinal'
    assert street_search_term('Cardinal Hill Pl') is None
    assert street_search_term(None) is None


def test_terms_cover_replies_claim_number_and_street():
    terms = claim_search_terms('202610020025', '6315 Cardinal Hill Pl, Springfield VA', [SENT_ID])

    assert terms == [
        f'HEADER In-Reply-To "{SENT_ID}"',
        'TEXT "202610020025"',
        'TEXT "6315 Cardinal"',
    ]


def test_a_short_claim_number_is_not_searched_for():
    assert claim_search_terms('TBD', None, []) == []


def test_check_files_the_reply_and_the_reply_to_it_on_the_claim(env, monkeypatch):
    searches = []
    first = mail('<r1@gmail.com>', "Re: Plumber's Report — 6315 Cardinal Hill Pl", in_reply_to=SENT_ID)
    # Gmail can't search References: this one is found by the street, and
    # filed through the thread
    second = mail(
        '<r2@gmail.com>', "Re: Plumber's Report — 6315 Cardinal Hill Pl",
        in_reply_to='<r1@gmail.com>', references=f'{SENT_ID} <r1@gmail.com>',
    )
    newsletter = mail('<n1@news.com>', 'Weekly deals', body='Nothing about any claim')

    def fake_search(self, criteria, since_date=None, limit=50):
        searches.append((criteria, since_date, limit))
        return [first, second, newsletter]

    monkeypatch.setattr(IMAPClient, 'search_emails', fake_search)
    monkeypatch.setattr('app.domains.email_ingestion.service.decrypt_password', lambda _: 'pw')

    service = ClaimInboxService(env['database'])
    result = service.check_claim_inbox(str(env['claim'].id))

    [(criteria, since, limit)] = searches
    assert criteria == [
        f'HEADER In-Reply-To "{SENT_ID}"', 'TEXT "202610020025"', 'TEXT "6315 Cardinal"',
    ]
    assert since is not None and limit == 50
    assert result['accounts_checked'] == 1
    assert result['saved'] == 2
    assert result['new_on_claim'] == 2
    assert result['errors'] == []

    env['session'].expire_all()
    rows = env['session'].query(ReceivedEmail).order_by(ReceivedEmail.message_id).all()
    assert [(r.message_id, str(r.matched_claim_id), r.match_method) for r in rows] == [
        ('<r1@gmail.com>', str(env['claim'].id), 'reply_thread'),
        ('<r2@gmail.com>', str(env['claim'].id), 'reply_thread'),
    ]
    # Already stored the second time
    again = service.check_claim_inbox(str(env['claim'].id))
    assert (again['saved'], again['new_on_claim']) == (0, 0)


def test_mail_about_another_claim_is_not_counted_on_this_one(env, monkeypatch):
    session = env['session']
    other_client = Client(display_name='Someone Else', address='12 Elm St, Austin TX')
    session.add(other_client)
    session.flush()
    session.add(Claim(client_id=other_client.id, claim_number='OTHER-55555'))
    session.commit()

    def fake_search(self, criteria, since_date=None, limit=50):
        return [mail('<o1@carrier.com>', 'Claim OTHER-55555 update', body='About OTHER-55555')]

    monkeypatch.setattr(IMAPClient, 'search_emails', fake_search)
    monkeypatch.setattr('app.domains.email_ingestion.service.decrypt_password', lambda _: 'pw')

    result = ClaimInboxService(env['database']).check_claim_inbox(str(env['claim'].id))

    assert (result['saved'], result['new_on_claim']) == (1, 0)


def test_check_of_an_unknown_claim_says_so(env):
    with pytest.raises(ValueError):
        ClaimInboxService(env['database']).check_claim_inbox('00000000-0000-0000-0000-000000000000')


def test_one_inbox_failing_leaves_the_others_and_is_reported(env, monkeypatch):
    session = env['session']
    session.add(EmailAccount(
        display_name='Second', email_address='second@ourco.com', username='second@ourco.com',
        encrypted_password='x', imap_server='imap.gmail.com', imap_port=993,
    ))
    session.commit()

    def fake_search(self, criteria, since_date=None, limit=50):
        if self.username == 'office@ourco.com':
            raise OSError('connection reset')
        return [mail('<r1@gmail.com>', 'Re: report', in_reply_to=SENT_ID)]

    monkeypatch.setattr(IMAPClient, 'search_emails', fake_search)
    monkeypatch.setattr('app.domains.email_ingestion.service.decrypt_password', lambda _: 'pw')

    result = ClaimInboxService(env['database']).check_claim_inbox(str(env['claim'].id))

    assert result['accounts_checked'] == 1
    assert result['saved'] == 1
    assert result['errors'] == [{'account': 'office@ourco.com', 'error': 'connection reset'}]


# ---- reading a big message in parts ----

def _sections(message, prefix=''):
    """IMAP section number -> MIME part, as a server numbers them"""
    found = {}
    if not message.is_multipart():
        return found
    for number, part in enumerate(message.get_payload(), start=1):
        section = f'{prefix}{number}'
        found[section] = part
        found.update(_sections(part, f'{section}.'))
    return found


def _split(raw):
    head, _, body = raw.partition(b'\n\n')
    return head + b'\n\n', body


class FakeServer:
    """Answers the FETCH commands IMAPClient sends, for one message"""

    def __init__(self, message, size=None):
        self.raw = message.as_bytes()
        self.size = size if size is not None else len(self.raw)
        self.parts = _sections(message)
        self.commands = []

    def fetch(self, msg_id, spec):
        self.commands.append(spec)
        if spec == '(RFC822.SIZE)':
            return 'OK', [f'{msg_id.decode()} (RFC822.SIZE {self.size})'.encode()]
        if spec == '(BODY.PEEK[])':
            return 'OK', [(b'1 (BODY[] {n}', self.raw), b')']
        headers_and_text = re.fullmatch(r'\(BODY\.PEEK\[HEADER\] BODY\.PEEK\[TEXT\]<0\.(\d+)>\)', spec)
        if headers_and_text:
            head, body = _split(self.raw)
            body = body[:int(headers_and_text.group(1))]
            return 'OK', [(b'1 (BODY[HEADER] {n}', head), (b' BODY[TEXT]<0> {n}', body), b')']
        section = re.fullmatch(r'\(BODY\.PEEK\[([\d.]+?)(\.MIME)?\]\)', spec)
        part = self.parts.get(section.group(1)) if section else None
        if part is None:
            return 'OK', [f'1 (BODY[{section.group(1) if section else "?"}] NIL)'.encode()]
        head, body = _split(part.as_bytes())
        return 'OK', [(b'1 (BODY[x] {n}', head if section.group(2) else body), b')']


def big_message():
    message = MIMEMultipart('mixed')
    message['Message-ID'] = '<big@carrier.com>'
    message['Subject'] = 'Photos and estimate - 6315 Cardinal Hill Pl'
    message['From'] = 'Pat Lee <pat@carrier.com>'
    message['To'] = 'office@ourco.com'
    message['In-Reply-To'] = SENT_ID
    body = MIMEMultipart('alternative')
    body.attach(MIMEText('Estimate attached, photos too.', 'plain'))
    body.attach(MIMEText('<p>Estimate attached, photos too.</p>', 'html'))
    message.attach(body)
    photo = MIMEImage(b'\x89PNG' + b'0' * 5000, 'png')
    photo.add_header('Content-Disposition', 'attachment', filename='kitchen.png')
    message.attach(photo)
    pdf = MIMEApplication(b'%PDF-1.4 estimate', 'pdf')
    pdf.add_header('Content-Disposition', 'attachment', filename='Estimate.pdf')
    message.attach(pdf)
    return message


def client_for(server):
    client = IMAPClient('imap.test', 993, 'user', 'password')
    client._connection = server
    return client


def test_a_message_over_the_limit_is_read_in_parts():
    server = FakeServer(big_message(), size=email_client.WHOLE_MESSAGE_MAX_BYTES + 1)

    fetched = client_for(server)._fetch_single(b'1')

    assert '(BODY.PEEK[])' not in server.commands
    assert fetched.message_id == '<big@carrier.com>'
    assert fetched.in_reply_to == SENT_ID
    assert fetched.to == 'office@ourco.com'
    assert fetched.body_text.strip() == 'Estimate attached, photos too.'
    assert [(a.filename, a.data) for a in fetched.pdf_attachments] == [('Estimate.pdf', b'%PDF-1.4 estimate')]
    # The picture isn't downloaded, but the message still lists it
    assert '(BODY.PEEK[2])' not in server.commands
    assert fetched.attachment_names == ['Estimate.pdf', 'kitchen.png']


def test_parts_and_whole_reads_find_the_same_files_and_text():
    whole = client_for(FakeServer(big_message()))._fetch_single(b'1')
    parts = client_for(FakeServer(big_message()))._fetch_in_parts(b'1', 1)

    assert [(a.filename, a.sha256_hash) for a in whole.pdf_attachments] == \
        [(a.filename, a.sha256_hash) for a in parts.pdf_attachments]
    assert whole.body_text.strip() == parts.body_text.strip()
    assert sorted(whole.attachment_names) == sorted(parts.attachment_names)


def test_a_message_under_the_limit_is_read_whole():
    server = FakeServer(big_message())

    fetched = client_for(server)._fetch_single(b'1')

    assert server.commands == ['(RFC822.SIZE)', '(BODY.PEEK[])']
    assert [a.filename for a in fetched.attachments] == ['kitchen.png', 'Estimate.pdf']


def test_header_and_text_reads_stop_at_the_text_limit(monkeypatch):
    monkeypatch.setattr(email_client, 'TEXT_FETCH_BYTES', 64)
    server = FakeServer(big_message())

    fetched = client_for(server)._fetch_headers_only(b'1')

    assert server.commands == ['(BODY.PEEK[HEADER] BODY.PEEK[TEXT]<0.64>)']
    assert fetched.subject == 'Photos and estimate - 6315 Cardinal Hill Pl'


def test_folded_header_values_come_back_on_one_line():
    assert _decode_header_value('Photo Report - 2641 Sledding Hill\r\n Rd.pdf') == \
        'Photo Report - 2641 Sledding Hill Rd.pdf'
    assert _decode_header_value('Estimate - Claim\r\n\t#0835947722') == 'Estimate - Claim\t#0835947722'
