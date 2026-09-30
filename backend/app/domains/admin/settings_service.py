"""
System settings service - simple key-value get/set backed by the
system_settings table, with an in-process cache so hot paths like
SmtpService.send() don't hit the DB on every email.
"""

import logging
import threading
from typing import Optional

logger = logging.getLogger(__name__)

ROUTE_PERSONAL_ACCOUNTS_THROUGH_FALLBACK_KEY = "route_personal_accounts_through_fallback"

_cache_lock = threading.Lock()
_cache: dict = {}


def _get_session():
    from app.core.database_factory import get_database
    return get_database().get_session()


def get_bool_setting(key: str, default: bool) -> bool:
    """Read a boolean setting, DB value winning over the passed-in default.
    Cached in-process; call invalidate_setting_cache() after writing."""
    with _cache_lock:
        if key in _cache:
            return _cache[key]

    session = _get_session()
    try:
        from app.domains.admin.models import SystemSetting
        row = session.query(SystemSetting).filter(SystemSetting.key == key).first()
        value = (row.value.strip().lower() == "true") if row else default
        with _cache_lock:
            _cache[key] = value
        return value
    except Exception as e:
        logger.warning(f"Failed to read system setting '{key}', using default {default}: {e}")
        return default
    finally:
        session.close()


def set_bool_setting(key: str, value: bool) -> None:
    session = _get_session()
    try:
        from app.domains.admin.models import SystemSetting
        row = session.query(SystemSetting).filter(SystemSetting.key == key).first()
        str_value = "true" if value else "false"
        if row:
            row.value = str_value
        else:
            session.add(SystemSetting(key=key, value=str_value))
        session.commit()
        with _cache_lock:
            _cache[key] = value
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def invalidate_setting_cache(key: Optional[str] = None) -> None:
    with _cache_lock:
        if key is None:
            _cache.clear()
        else:
            _cache.pop(key, None)
