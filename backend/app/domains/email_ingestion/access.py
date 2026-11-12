"""Who may manage an email account, who may send from it, and where its saved
credentials may go (security audit, 2026-11).

- Manage (edit, test, delete): someone's own mailbox (owner_staff_id) only by
  its owner or an admin. A shared inbox (no owner) by an admin or anyone in its
  company, as before.
- Send from: the person's own mailbox, any account of one of their companies
  (user's rule 2026-11-05: any registered account in the company may be used,
  not only your own), or any account for an admin. Scheduled/background sends
  with nobody signed in pass SYSTEM_SENDER.
- A saved password is only ever sent to the server it was saved for: changing
  the server, port, SSL, provider or username of a password account needs the
  password typed again. A Google-connected account's token only ever goes to
  Google: its server fields can't be changed, and connections ignore them.
"""

from typing import Any, Dict, List, Optional

from sqlalchemy import String, cast, or_

from app.domains.auth.company_scope import company_ids, sees_everything


class _SystemSender:
    """A send with nobody signed in (a scheduled job). Not a staff member."""

    id = None
    role = None

    def __repr__(self) -> str:
        return "SYSTEM_SENDER"


SYSTEM_SENDER = _SystemSender()


def _owned_by(account: Any, staff: Any) -> bool:
    owner = getattr(account, "owner_staff_id", None)
    if owner is None and isinstance(account, dict):
        owner = account.get("owner_staff_id")
    return bool(owner) and staff is not None and str(owner) == str(staff.id)


def _company_of(account: Any) -> Optional[str]:
    company = account.get("company_id") if isinstance(account, dict) else getattr(account, "company_id", None)
    return str(company) if company else None


def _owner_of(account: Any) -> Optional[str]:
    owner = account.get("owner_staff_id") if isinstance(account, dict) else getattr(account, "owner_staff_id", None)
    return str(owner) if owner else None


def may_manage(db: Any, staff: Any, account: Any) -> bool:
    """Edit, test or delete the account."""
    if sees_everything(staff) or _owned_by(account, staff):
        return True
    if _owner_of(account):
        return False  # someone else's own mailbox
    ids = company_ids(db, staff)
    return ids is None or (_company_of(account) is not None and _company_of(account) in ids)


def may_send_from(db: Any, staff: Any, account: Any) -> bool:
    """Send email as this account."""
    if staff is SYSTEM_SENDER or sees_everything(staff) or _owned_by(account, staff):
        return True
    ids = company_ids(db, staff)
    return ids is None or (_company_of(account) is not None and _company_of(account) in ids)


def sendable_condition(db: Any, staff: Any):
    """SQL condition on EmailAccount for the accounts staff may send from;
    None means no limit (admin)."""
    from app.domains.email_ingestion.models import EmailAccount

    if staff is SYSTEM_SENDER:
        return None
    ids = company_ids(db, staff)
    if ids is None:
        return None
    own = cast(EmailAccount.owner_staff_id, String) == str(staff.id)
    if not ids:
        return own
    return or_(EmailAccount.company_id.in_(ids), own)


# ------------------------------------------------------------------ credentials

# Every field that decides where the saved password or token is sent, or how.
CREDENTIAL_DESTINATION_FIELDS = (
    "provider_type",   # picks the SMTP preset host
    "imap_server",
    "imap_port",
    "use_ssl",
    "smtp_server",
    "smtp_port",
    "username",
)

GOOGLE_IMAP = {"server": "imap.gmail.com", "port": 993, "use_ssl": True}
GOOGLE_SMTP = {"server": "smtp.gmail.com", "port": 587, "use_tls": True}

PASSWORD_AGAIN = (
    "Enter the account's password again to change its server, port, SSL, provider "
    "or username. The saved password is only sent to the server it was saved for."
)
OAUTH_SERVER_FIXED = (
    "This account is connected with Google, so its server settings can't be changed. "
    "To use a different mailbox, connect it with Google or add it as a new account."
)


def _same(field: str, stored: Any, new: Any) -> bool:
    if field in ("imap_port", "smtp_port"):
        try:
            return (int(stored) if stored not in (None, "") else None) == (
                int(new) if new not in (None, "") else None
            )
        except (TypeError, ValueError):
            return False
    if field == "use_ssl":
        return bool(stored) == bool(new)
    stored_text = (str(stored).strip() if stored is not None else "")
    new_text = (str(new).strip() if new is not None else "")
    if field == "username":
        return stored_text == new_text
    return stored_text.lower() == new_text.lower()


def credential_destination_changes(stored: Dict[str, Any], update: Dict[str, Any]) -> List[str]:
    """The fields in update that would send the saved credentials somewhere
    (or somehow) other than before. Compared with the stored values, since the
    edit form sends every field whether it changed or not."""
    return [
        field for field in CREDENTIAL_DESTINATION_FIELDS
        if field in update and not _same(field, stored.get(field), update[field])
    ]


def check_credential_destination(stored: Dict[str, Any], update: Dict[str, Any]) -> None:
    """Raise ValueError if the update would send the saved password or Google
    token to a server it wasn't saved for."""
    changed = credential_destination_changes(stored, update)
    if not changed:
        return
    if stored.get("auth_method") == "oauth":
        raise ValueError(OAUTH_SERVER_FIXED)
    if not (update.get("password") or "").strip():
        raise ValueError(PASSWORD_AGAIN)
