"""
Encryption utilities for sensitive data storage.
Uses Fernet symmetric encryption with the application's SECRET_KEY.
"""

import base64
import hashlib
from cryptography.fernet import Fernet
from app.core.config import settings


def _get_fernet_key() -> bytes:
    """
    Generate a Fernet-compatible key from SECRET_KEY.
    Fernet requires a 32-byte URL-safe base64-encoded key.
    """
    # Use SHA256 to get a consistent 32-byte key from SECRET_KEY
    key_bytes = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    return base64.urlsafe_b64encode(key_bytes)


def _get_fernet() -> Fernet:
    """Get Fernet instance for encryption/decryption."""
    return Fernet(_get_fernet_key())


def encrypt_text(plain_text: str) -> str:
    """
    Encrypt a string and return base64-encoded ciphertext.

    Args:
        plain_text: The text to encrypt

    Returns:
        Base64-encoded encrypted string
    """
    if not plain_text:
        return ""

    fernet = _get_fernet()
    encrypted = fernet.encrypt(plain_text.encode())
    return encrypted.decode()


def decrypt_text(encrypted_text: str) -> str:
    """
    Decrypt a base64-encoded ciphertext and return the original string.

    Args:
        encrypted_text: Base64-encoded encrypted string

    Returns:
        Decrypted original string

    Raises:
        Exception if decryption fails (invalid key or corrupted data)
    """
    if not encrypted_text:
        return ""

    fernet = _get_fernet()
    decrypted = fernet.decrypt(encrypted_text.encode())
    return decrypted.decode()


def is_encrypted(text: str) -> bool:
    """
    Check if a string appears to be Fernet-encrypted.
    Fernet tokens start with 'gAAAAA'.
    """
    if not text:
        return False
    return text.startswith('gAAAAA')
