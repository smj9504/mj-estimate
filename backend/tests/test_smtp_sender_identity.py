"""From is always the verified sending address; anything else becomes Reply-To."""

from email import message_from_bytes

import pytest

RESEND = {
    "send_only": True,
    "server": "smtp.resend.com",
    "port": 587,
    "use_tls": True,
    "display_name": "Scopit",
    "email_address": "documents@scopit.work",
}
GMAIL = {
    "send_only": False,
    "server": "smtp.gmail.com",
    "port": 587,
    "use_tls": True,
    "provider_type": "gmail",
    "sender_name": "Jane Doe",
    "email_address": "jane@gmail.com",
}


class FakeSMTP:
    sent = []

    def __init__(self, *args, **kwargs):
        self.data = b""

    ehlo = starttls = quit = close = lambda self, *a: None
    ehlo_or_helo_if_needed = lambda self: None
    does_esmtp = False

    def mail(self, sender, options=()):
        self.envelope_from = sender
        return 250, b"ok"

    def rcpt(self, addr):
        return 250, b"ok"

    def docmd(self, cmd):
        return 354, b"go"

    def send(self, chunk):
        self.data += chunk

    def getreply(self):
        FakeSMTP.sent.append(self)
        return 250, b"ok"


@pytest.fixture
def smtp(monkeypatch):
    from app.domains.claim_followup import smtp_service

    monkeypatch.setattr(smtp_service.smtplib, 'SMTP', FakeSMTP)
    FakeSMTP.sent = []
    return smtp_service.SmtpService()


def sent_with(smtp, monkeypatch, config, from_address, **kwargs):
    monkeypatch.setattr(smtp, '_get_smtp_config', lambda account_id: dict(config))
    smtp.send('acct' if config is GMAIL else None, from_address, ['adjuster@carrier.com'],
              'Subject', '<p>Hi</p>', **kwargs)
    server = FakeSMTP.sent[-1]
    return server.envelope_from, message_from_bytes(server.data)


def test_typed_sender_moves_to_reply_to(smtp, monkeypatch):
    envelope, msg = sent_with(smtp, monkeypatch, RESEND, 'office@abcrestoration.com')
    assert envelope == 'documents@scopit.work'
    assert 'documents@scopit.work' in msg['From']
    assert msg['Reply-To'] == 'office@abcrestoration.com'


def test_send_only_address_is_never_reply_to(smtp, monkeypatch):
    # Contract fallback passes Resend's SMTP username as from_address.
    _, msg = sent_with(smtp, monkeypatch, RESEND, 'resend', reply_to='resend')
    assert 'documents@scopit.work' in msg['From']
    assert msg['Reply-To'] is None
    assert msg['List-Unsubscribe'] is None


def test_caller_reply_to_wins(smtp, monkeypatch):
    _, msg = sent_with(smtp, monkeypatch, RESEND, 'office@abcrestoration.com',
                       reply_to='jane@abcrestoration.com')
    assert msg['Reply-To'] == 'jane@abcrestoration.com'


def test_account_sending_as_itself_is_unchanged(smtp, monkeypatch):
    envelope, msg = sent_with(smtp, monkeypatch, GMAIL, 'jane@gmail.com')
    assert envelope == 'jane@gmail.com'
    assert 'jane@gmail.com' in msg['From']
    assert msg['Reply-To'] == 'jane@gmail.com'


def test_account_cannot_send_as_another_address(smtp, monkeypatch):
    envelope, msg = sent_with(smtp, monkeypatch, GMAIL, 'office@abcrestoration.com')
    assert envelope == 'jane@gmail.com'
    assert 'jane@gmail.com' in msg['From']
    assert msg['Reply-To'] == 'office@abcrestoration.com'
    body = msg.get_payload()[1].get_payload(decode=True).decode()
    assert 'office@abcrestoration.com' in body
