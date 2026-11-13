"""SECRET_KEY can be replaced without losing the secrets stored encrypted in the
DB (mail passwords, OAuth tokens): DATA_ENCRYPTION_KEY becomes the key, old
keys stay readable through PREVIOUS_*, and scripts/reencrypt_secrets.py moves
every row to the current key."""

import os
from pathlib import Path
import sys

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("DATABASE_URL", "sqlite:///./test_secret_rotation.db")

from cryptography.fernet import Fernet, InvalidToken
import pytest
from sqlalchemy import create_engine, text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import encryption
from app.core.config import settings

OLD_SECRET = "old-secret-key-that-was-exposed-0123456789"
NEW_SECRET = "new-secret-key-after-rotation-9876543210"


@pytest.fixture
def keys(monkeypatch):
    """Set the key settings for one test."""
    def set_keys(secret, data_key=None, previous_secrets=None, previous_data_keys=None, email_key=None):
        monkeypatch.setattr(settings, "SECRET_KEY", secret)
        monkeypatch.setattr(settings, "DATA_ENCRYPTION_KEY", data_key, raising=False)
        monkeypatch.setattr(settings, "PREVIOUS_SECRET_KEYS", previous_secrets, raising=False)
        monkeypatch.setattr(settings, "PREVIOUS_DATA_ENCRYPTION_KEYS", previous_data_keys, raising=False)
        monkeypatch.setattr(settings, "EMAIL_ENCRYPTION_KEY", email_key, raising=False)
        for name in ("DATA_ENCRYPTION_KEY", "PREVIOUS_SECRET_KEYS", "PREVIOUS_DATA_ENCRYPTION_KEYS"):
            monkeypatch.delenv(name, raising=False)
    return set_keys


def old_token(secret, value):
    """What encrypt_text produced before 2026-11-12 (sha256 of SECRET_KEY)."""
    return Fernet(encryption._derived_key(secret)).encrypt(value.encode()).decode()


def old_mail_password(secret, value, email_key=None):
    """What email_ingestion.encrypt_password produced before 2026-11-12."""
    return Fernet(encryption._legacy_mail_key(email_key, secret)).encrypt(value.encode()).decode()


def test_nothing_changes_until_a_data_key_is_set(keys):
    keys(OLD_SECRET)
    token = encryption.encrypt_text("refresh-token")
    # Same key as before, so a server still on the old code reads it.
    assert Fernet(encryption._derived_key(OLD_SECRET)).decrypt(token.encode()) == b"refresh-token"
    assert encryption.decrypt_text(old_token(OLD_SECRET, "a")) == "a"
    assert encryption.decrypt_text(old_mail_password(OLD_SECRET, "mail-pass")) == "mail-pass"


def test_after_rotation_old_secrets_still_open_and_new_ones_use_the_data_key(keys):
    stored_token = old_token(OLD_SECRET, "gmail-refresh")
    stored_password = old_mail_password(OLD_SECRET, "imap-pass")
    data_key = Fernet.generate_key().decode()

    keys(NEW_SECRET, data_key=data_key, previous_secrets=OLD_SECRET)
    assert encryption.decrypt_text(stored_token) == "gmail-refresh"
    assert encryption.decrypt_text(stored_password) == "imap-pass"
    assert not encryption.on_current_key(stored_token)

    rewritten = encryption.reencrypt(stored_token)
    assert encryption.on_current_key(rewritten)
    assert Fernet(data_key.encode()).decrypt(rewritten.encode()) == b"gmail-refresh"


def test_without_the_old_key_listed_old_secrets_cannot_be_read(keys):
    stored = old_token(OLD_SECRET, "x")
    keys(NEW_SECRET, data_key=Fernet.generate_key().decode())
    with pytest.raises(InvalidToken):
        encryption.decrypt_text(stored)


def test_mail_passwords_under_an_email_encryption_key_are_still_read(keys):
    email_key = Fernet.generate_key().decode()
    stored = old_mail_password(OLD_SECRET, "smtp-pass", email_key=email_key)
    keys(NEW_SECRET, data_key=Fernet.generate_key().decode(), email_key=email_key)
    assert encryption.decrypt_text(stored) == "smtp-pass"


def test_a_malformed_data_key_fails_loudly(keys):
    keys(NEW_SECRET, data_key="not-a-fernet-key")
    with pytest.raises(ValueError):
        encryption.encrypt_text("x")


def test_the_script_counts_then_moves_every_row_to_the_current_key(keys, tmp_path):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    import reencrypt_secrets

    engine = create_engine(f"sqlite:///{tmp_path / 'rotation.db'}")
    with engine.begin() as c:
        c.execute(text("CREATE TABLE email_accounts (id TEXT PRIMARY KEY, encrypted_password TEXT, "
                       "oauth_access_token TEXT, oauth_refresh_token TEXT)"))
        c.execute(text("CREATE TABLE staff (id TEXT PRIMARY KEY, gdrive_oauth_access_token TEXT, "
                       "gdrive_oauth_refresh_token TEXT, gdrive_service_account_json TEXT)"))
        c.execute(text("INSERT INTO email_accounts VALUES ('a1', :p, NULL, NULL), ('a2', '', :at, :rt)"),
                  {"p": old_mail_password(OLD_SECRET, "imap-pass"),
                   "at": old_token(OLD_SECRET, "access"), "rt": old_token(OLD_SECRET, "refresh")})
        c.execute(text("INSERT INTO staff VALUES ('s1', NULL, :rt, NULL), ('s2', NULL, :bad, NULL)"),
                  {"rt": old_token(OLD_SECRET, "drive-refresh"),
                   "bad": old_token("some-key-nobody-has", "lost")})

    keys(NEW_SECRET, data_key=Fernet.generate_key().decode(), previous_secrets=OLD_SECRET)

    with engine.begin() as c:
        dry = reencrypt_secrets.run(c, apply=False)
    assert dry["email_accounts.encrypted_password"]["old"] == 1
    assert dry["email_accounts.oauth_refresh_token"]["old"] == 1
    assert dry["staff.gdrive_oauth_refresh_token"] == {"old": 1, "unreadable": 1}

    with engine.begin() as c:
        reencrypt_secrets.run(c, apply=True)
    with engine.begin() as c:
        after = reencrypt_secrets.run(c, apply=False)
        password = c.execute(text("SELECT encrypted_password FROM email_accounts WHERE id='a1'")).scalar()
    assert all(counts["old"] == 0 for counts in after.values())
    assert after["staff.gdrive_oauth_refresh_token"]["unreadable"] == 1  # left alone
    assert encryption.on_current_key(password)
    assert encryption.decrypt_text(password) == "imap-pass"


def test_mail_accounts_read_passwords_saved_the_old_way(keys):
    from app.domains.email_ingestion.service import decrypt_password, encrypt_password

    saved_before = old_mail_password(OLD_SECRET, "imap-pass")
    keys(OLD_SECRET)
    assert decrypt_password(saved_before) == "imap-pass"
    saved_now = encrypt_password("new-pass")
    assert encryption.on_current_key(saved_now)

    keys(NEW_SECRET, data_key=Fernet.generate_key().decode(), previous_secrets=OLD_SECRET)
    assert decrypt_password(saved_before) == "imap-pass"
    assert decrypt_password(saved_now) == "new-pass"
