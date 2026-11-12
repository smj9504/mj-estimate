"""
Encryption for secrets kept in the database: mail account passwords, Gmail and
Google Drive OAuth tokens, Drive service-account keys.

Keys, so SECRET_KEY can be changed without losing those secrets:

- DATA_ENCRYPTION_KEY (a Fernet key, ``Fernet.generate_key()``): when set,
  everything is encrypted with it. When not set, the key is derived from
  SECRET_KEY as it always was, so nothing changes until it is set.
- PREVIOUS_SECRET_KEYS / PREVIOUS_DATA_ENCRYPTION_KEYS (comma-separated old
  values): only used to read what was encrypted before a rotation.
  ``scripts/reencrypt_secrets.py`` rewrites those rows with the current key;
  after it reports nothing left on an old key, remove these two settings.

Mail passwords used to be encrypted with a key of their own (the first 32
characters of EMAIL_ENCRYPTION_KEY, or of SECRET_KEY, zero-padded). Those are
still read; new ones use the current key like everything else.
"""

import base64
import hashlib
import os
from functools import lru_cache
from typing import List, Optional, Tuple

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.core.config import settings


def _split(value: Optional[str]) -> List[str]:
    return [v.strip() for v in (value or "").split(",") if v.strip()]


def _derived_key(secret: str) -> bytes:
    """The Fernet key derived from a SECRET_KEY (sha256)."""
    return base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())


def _legacy_mail_key(email_key: Optional[str], secret: str) -> bytes:
    """The key mail passwords were encrypted with before 2026-11-12."""
    key = email_key or secret[:32].ljust(32, "=")
    padded = key.encode("utf-8")[:32].ljust(32, b"\0")
    return base64.urlsafe_b64encode(padded)


def _settings_snapshot() -> Tuple[str, Optional[str], Optional[str], Tuple[str, ...], Tuple[str, ...]]:
    return (
        settings.SECRET_KEY,
        getattr(settings, "DATA_ENCRYPTION_KEY", None) or os.getenv("DATA_ENCRYPTION_KEY"),
        getattr(settings, "EMAIL_ENCRYPTION_KEY", None),
        tuple(_split(getattr(settings, "PREVIOUS_SECRET_KEYS", None) or os.getenv("PREVIOUS_SECRET_KEYS"))),
        tuple(_split(getattr(settings, "PREVIOUS_DATA_ENCRYPTION_KEYS", None) or os.getenv("PREVIOUS_DATA_ENCRYPTION_KEYS"))),
    )


@lru_cache(maxsize=4)
def _keys(snapshot) -> Tuple[bytes, Tuple[bytes, ...]]:
    """(current key, every key that may have encrypted a stored value)."""
    secret, data_key, email_key, previous_secrets, previous_data_keys = snapshot
    current = data_key.encode() if data_key else _derived_key(secret)
    Fernet(current)  # A malformed DATA_ENCRYPTION_KEY fails here, loudly.

    readable = [
        current,
        _derived_key(secret),
        _legacy_mail_key(email_key, secret),
        _legacy_mail_key(None, secret),
    ]
    readable += [k.encode() for k in previous_data_keys]
    for old in previous_secrets:
        readable += [_derived_key(old), _legacy_mail_key(None, old)]
    unique = tuple(dict.fromkeys(readable))
    return current, unique


def _current_fernet() -> Fernet:
    return Fernet(_keys(_settings_snapshot())[0])


def _reading_fernet() -> MultiFernet:
    return MultiFernet([Fernet(k) for k in _keys(_settings_snapshot())[1]])


def encrypt_text(plain_text: str) -> str:
    """Encrypt with the current key. Returns a Fernet token ('gAAAAA...')."""
    if not plain_text:
        return ""
    return _current_fernet().encrypt(plain_text.encode()).decode()


def decrypt_text(encrypted_text: str) -> str:
    """Decrypt a value encrypted with the current key or any older one.

    Raises cryptography.fernet.InvalidToken when no known key opens it.
    """
    if not encrypted_text:
        return ""
    return _reading_fernet().decrypt(encrypted_text.encode()).decode()


def on_current_key(encrypted_text: str) -> bool:
    """True when the current key alone opens this value."""
    try:
        _current_fernet().decrypt(encrypted_text.encode())
        return True
    except InvalidToken:
        return False


def reencrypt(encrypted_text: str) -> str:
    """The same secret encrypted with the current key."""
    return encrypt_text(decrypt_text(encrypted_text))


def is_encrypted(text: str) -> bool:
    """
    Check if a string appears to be Fernet-encrypted.
    Fernet tokens start with 'gAAAAA'.
    """
    if not text:
        return False
    return text.startswith('gAAAAA')
