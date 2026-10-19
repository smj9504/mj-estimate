"""
Emailed codes that confirm a signed-in person's own password change.

The code goes to the address on the staff record, so changing a password
takes access to that mailbox as well as a signed-in session. Only a keyed
hash of the code is stored, in the cache, for CODE_TTL_SECONDS.
"""
import hashlib
import hmac
import json
import secrets
import time
from typing import Optional

from app.core.cache import CacheService
from app.core.config import settings

CODE_TTL_SECONDS = 10 * 60
# Wrong guesses allowed before the code stops working
MAX_ATTEMPTS = 5


def _key(staff_id) -> str:
    return f"pwchange:{staff_id}"


def _digest(staff_id, code: str) -> str:
    message = f"{staff_id}:{code}".encode()
    return hmac.new(settings.SECRET_KEY.encode(), message, hashlib.sha256).hexdigest()


async def issue_code(cache: CacheService, staff_id) -> Optional[str]:
    """
    Make a new 6-digit code for this person, replacing any earlier one.
    Returns None if the cache could not store it.
    """
    code = f"{secrets.randbelow(10 ** 6):06d}"
    record = {
        "digest": _digest(staff_id, code),
        "attempts": 0,
        "expires_at": time.time() + CODE_TTL_SECONDS,
    }
    if not await cache.set(_key(staff_id), json.dumps(record), ttl=CODE_TTL_SECONDS):
        return None
    return code


async def check_code(cache: CacheService, staff_id, code: str) -> bool:
    """
    True if the code matches. A match uses the code up, and so does the
    last allowed wrong guess.
    """
    key = _key(staff_id)
    raw = await cache.get(key)
    if not raw:
        return False

    record = json.loads(raw)
    remaining = int(record["expires_at"] - time.time())
    if remaining <= 0:
        await cache.delete(key)
        return False

    if hmac.compare_digest(record["digest"], _digest(staff_id, code.strip())):
        await cache.delete(key)
        return True

    record["attempts"] += 1
    if record["attempts"] >= MAX_ATTEMPTS:
        await cache.delete(key)
    else:
        # Keep the original expiry rather than restarting the clock
        await cache.set(key, json.dumps(record), ttl=remaining)
    return False


def mask_email(email: str) -> str:
    """'jane@example.com' -> 'j***@example.com'"""
    local, _, domain = email.partition("@")
    return f"{local[:1]}***@{domain}" if domain else "***"
