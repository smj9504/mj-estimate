"""
Email Ingestion service - orchestrates polling, classification, matching, and upload.
"""

import io
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from cryptography.fernet import Fernet

from app.core.config import settings
from app.domains.email_ingestion.email_client import _html_to_text, readable_plain_text
from app.domains.email_ingestion.schemas import ESTIMATE_DOCUMENT_TYPE

logger = logging.getLogger(__name__)

# Encryption key for email passwords
# Generate once: Fernet.generate_key() and store in env
_ENCRYPTION_KEY = getattr(settings, "EMAIL_ENCRYPTION_KEY", None)

# Category of a stored attachment awaiting review; confirming it replaces
# this with the document type the reviewer chose.
PENDING_FILE_CATEGORY = "pending-estimate"

# Mail filed on a claim keeps all its files, so they open from the claim's
# Received list. PDFs go through the review pipeline (EmailIngestionLog);
# anything else is stored under this context, keyed by the received_emails
# row of the inbox it came into.
RECEIVED_FILE_CONTEXT = "received-email"
RECEIVED_FILE_CATEGORY = "email-attachment"
# Larger files stay in the mailbox
_MAX_RECEIVED_FILE_BYTES = 25 * 1024 * 1024

_KEPT_ON_CLAIM = "Kept: its email is filed on a claim"
_KEPT_WITH_SIBLING = "Kept: sibling attachment on this email qualified"

# Logged without a stored file because of what the classifier said, or a
# storage failure: a claim's mail stores these after all. Not our own files
# coming back, nor duplicates of a file already stored.
_UPGRADABLE_STATUSES = ("skipped", "failed")
_OWN_FILE_SKIP_REASON = "Attachment is a file we sent; already on the claim as outbound mail"


_BOUNCE_SENDER_PATTERN = re.compile(
    r"(postmaster|mailer-daemon|mail\s*delivery\s*(subsystem|system))",
    re.IGNORECASE,
)
_BOUNCE_SUBJECT_PATTERN = re.compile(
    r"(delivery\s*(status\s*notification|failure)|undeliverable|"
    r"returned\s*mail|failure\s*notice|mail\s*delivery\s*failed)",
    re.IGNORECASE,
)


def _is_bounce_message(sender: Optional[str], subject: Optional[str]) -> bool:
    """True for delivery-failure notifications.

    A bounce quotes the original message, attachments included, so ingesting
    one re-files every PDF we just sent. One undelivered estimate produced 12
    such rows here.
    """
    if sender and _BOUNCE_SENDER_PATTERN.search(sender):
        return True
    return bool(subject and _BOUNCE_SUBJECT_PATTERN.search(subject))


def _closing_transaction_between(session, fetched_emails):
    """Pass messages through, ending the transaction before the next one downloads.
    Neon has dropped connections partway through a poll, and a slow attachment
    shouldn't leave one idle in a transaction."""
    for fetched_email in fetched_emails:
        yield fetched_email
        session.commit()


def _attachment_stats() -> Dict[str, int]:
    """Counters _process_email_attachments adds to, as a poll reports them"""
    return {
        key: 0 for key in (
            "emails_found", "processed", "uploaded", "pending", "skipped",
            "duplicates", "errors",
        )
    }


def _load_sent_attachment_index(session) -> Tuple[Set[str], Set[str]]:
    """Index of everything we have emailed out: (sha256 set, filename set).

    Built once per poll. Reading sent_emails.attachments per attachment
    meant a full scan of that JSONB column for every PDF in every message,
    which held the connection long enough that the Neon pooler dropped it
    mid-poll.
    """
    from app.domains.claim_followup.models import SentEmail

    hashes: Set[str] = set()
    names: Set[str] = set()
    rows = session.query(SentEmail.attachments).filter(
        SentEmail.attachments.isnot(None)
    ).all()
    for (atts,) in rows:
        for att in (atts or []):
            if not isinstance(att, dict):
                continue
            digest = att.get("sha256_hash")
            if digest:
                hashes.add(digest)
            name = (att.get("filename") or "").strip().lower()
            if name:
                names.add(name)
    return hashes, names


def _any_attachment_qualifies(fetched_email, sent_index) -> bool:
    """True if at least one PDF on this email classifies as claim paperwork.

    Used to carry the rest of the email's attachments along. Files we sent
    ourselves do not count - an estimate of ours bouncing back should not
    drag the whole message in.
    """
    from app.domains.email_ingestion.classifier import (
        classify_email_attachment,
    )

    for att in fetched_email.pdf_attachments:
        if _is_own_sent_attachment(att, sent_index):
            continue
        ok, _conf, _reason = classify_email_attachment(
            filename=att.filename,
            sender=fetched_email.sender,
            subject=fetched_email.subject,
            body=fetched_email.body_text,
            pdf_data=att.data,
        )
        if ok:
            return True
    return False


def _is_own_sent_attachment(attachment, sent_index) -> bool:
    """True if this attachment is a file we emailed out ourselves.

    Matched on sha256 when the outbound row recorded one, otherwise on
    filename. Older sent_emails rows stored only {filename, mime_type}, so
    the filename fallback is what covers the existing backlog; sends from
    now on carry a hash and match exactly.
    """
    sent_hashes, sent_names = sent_index
    digest = attachment.sha256_hash or ""
    if digest and digest in sent_hashes:
        return True
    name = (attachment.filename or "").strip().lower()
    return bool(name and name in sent_names)


# Message-IDs inside In-Reply-To / References headers.
_MESSAGE_ID_PATTERN = re.compile(r"<[^<>\s]+>")

# Claim matches that name the claim outright, rather than guessing it from an
# address or a name
_CERTAIN_MATCH_METHODS = {"reply_thread", "claim_number"}

# Marketing HTML runs to hundreds of KB; nothing past this is worth keeping.
_MAX_BODY_CHARS = 200_000


def _as_datetime(value) -> Optional[datetime]:
    """A date from a repository dict, which holds dates as ISO strings.

    Passed on as a string, last_synced_at failed the IMAP search, so every
    poll of an account that had synced before stopped there."""
    if value is None or isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value)


def _snippet(text: str, length: int = 280) -> Optional[str]:
    collapsed = " ".join((text or "").split())
    return collapsed[:length] or None


def _cap(value: Optional[str], max_chars: int) -> Optional[str]:
    if not value:
        return None
    # Postgres text cannot hold NUL bytes, which some mailers emit.
    return value.replace("\x00", "")[:max_chars]


def _received_email_dict(row, include_body: bool) -> Dict[str, Any]:
    # Mail stored before the plain part was checked at fetch still holds the
    # botched text, so it is read past here rather than rewritten
    body_text = readable_plain_text(row.body_text, row.body_html)
    data = {
        "id": str(row.id),
        "email_account_id": str(row.email_account_id),
        "message_id": row.message_id,
        "in_reply_to": row.in_reply_to,
        "subject": row.subject,
        "sender": row.sender,
        "to_addresses": row.to_addresses,
        "cc_addresses": row.cc_addresses,
        "received_at": row.received_at,
        "snippet": row.snippet if body_text == row.body_text else _snippet(body_text),
        "attachment_names": row.attachment_names or [],
        "matched_client_id": str(row.matched_client_id) if row.matched_client_id else None,
        "matched_claim_id": str(row.matched_claim_id) if row.matched_claim_id else None,
        "match_method": row.match_method,
        "match_confidence": row.match_confidence,
        "matched_wm_job_id": str(row.matched_wm_job_id) if row.matched_wm_job_id else None,
        "created_at": row.created_at,
    }
    if include_body:
        data["body_text"] = body_text
        data["body_html"] = row.body_html
    return data


def _attachment_note(log, file_id: Optional[str]) -> Optional[str]:
    """What the claim page says about a PDF it can't file, or can't open"""
    if log.status == "duplicate":
        return "Same file as one received before"
    if log.skip_reason == _OWN_FILE_SKIP_REASON:
        return "Our own file, sent from the app"
    if file_id is None:
        if log.status == "failed":
            return "Couldn't be stored"
        return "Not stored in the app"
    return None


def _readable_file(session, file_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """A stored file as client/document_files.read_hub_file reads it"""
    from app.domains.file.models import File

    if not file_id:
        return None
    f = session.query(File).filter(File.id == file_id).first()
    if f is None or f.is_active is False:
        return None
    return {
        "filename": f.original_name or f.filename or "attachment",
        "mime_type": f.content_type or "application/octet-stream",
        "read": ("file", f.url, f.storage_provider),
    }


def _one_copy_per_message(query):
    """A message delivered to several connected inboxes is stored once for each;
    a list shows it once. The copy on a claim wins over one that isn't."""
    from sqlalchemy import case, func, select

    from app.domains.email_ingestion.models import ReceivedEmail

    copies = query.with_entities(
        ReceivedEmail.id.label("id"),
        func.row_number().over(
            partition_by=ReceivedEmail.message_id,
            order_by=(
                case((ReceivedEmail.matched_claim_id.is_(None), 1), else_=0),
                ReceivedEmail.created_at,
                ReceivedEmail.id,
            ),
        ).label("copy_number"),
    ).subquery()
    return query.filter(
        ReceivedEmail.id.in_(select(copies.c.id).where(copies.c.copy_number == 1))
    )


def _get_fernet() -> Fernet:
    """Get Fernet instance for password encryption/decryption"""
    key = _ENCRYPTION_KEY or settings.SECRET_KEY[:32].ljust(32, "=")
    # Fernet requires url-safe base64 encoded 32 bytes
    import base64
    padded = key.encode("utf-8")[:32].ljust(32, b"\0")
    key_b64 = base64.urlsafe_b64encode(padded)
    return Fernet(key_b64)


def encrypt_password(password: str) -> str:
    """Encrypt a password for storage"""
    f = _get_fernet()
    return f.encrypt(password.encode("utf-8")).decode("utf-8")


def decrypt_password(encrypted: str) -> str:
    """Decrypt a stored password"""
    f = _get_fernet()
    return f.decrypt(encrypted.encode("utf-8")).decode("utf-8")


class EmailIngestionService:
    """Orchestrates the email ingestion pipeline"""

    def __init__(self, database=None):
        from app.core.database_factory import get_database
        self.database = database or get_database()

    def _get_session(self):
        return self.database.get_session()

    def _get_readonly_session(self):
        return self.database.get_readonly_session()

    # ============================================================
    # Account Management
    # ============================================================

    def create_account(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new email account with encrypted password"""
        session = self._get_session()
        try:
            from app.domains.email_ingestion.repository import get_email_account_repository
            repo = get_email_account_repository(session)

            # Encrypt password
            plain_password = data.pop("password")
            data["encrypted_password"] = encrypt_password(plain_password)

            result = repo.create(data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            logger.error(f"Error creating email account: {e}")
            raise
        finally:
            session.close()

    def update_account(self, account_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update an email account"""
        session = self._get_session()
        try:
            from app.domains.email_ingestion.repository import get_email_account_repository
            repo = get_email_account_repository(session)

            # Encrypt password if provided
            if "password" in data and data["password"]:
                data["encrypted_password"] = encrypt_password(data.pop("password"))
            else:
                data.pop("password", None)

            result = repo.update(account_id, data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def delete_account(self, account_id: str) -> bool:
        """Delete an email account"""
        session = self._get_session()
        try:
            from app.domains.email_ingestion.repository import get_email_account_repository
            repo = get_email_account_repository(session)
            result = repo.delete(account_id)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def get_accounts(self, company_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get all email accounts"""
        session = self._get_readonly_session()
        try:
            from app.domains.email_ingestion.repository import get_email_account_repository
            repo = get_email_account_repository(session)
            return repo.get_active_accounts(company_id)
        finally:
            session.close()

    def get_account(self, account_id: str) -> Optional[Dict[str, Any]]:
        """Get a single email account"""
        session = self._get_readonly_session()
        try:
            from app.domains.email_ingestion.repository import get_email_account_repository
            repo = get_email_account_repository(session)
            return repo.get_by_id(account_id)
        finally:
            session.close()

    def get_all_accounts(self) -> List[Dict[str, Any]]:
        """Get all email accounts (active and inactive), enriched with company_name"""
        session = self._get_readonly_session()
        try:
            from app.domains.email_ingestion.repository import get_email_account_repository
            repo = get_email_account_repository(session)
            accounts = repo.get_all(order_by="-created_at")
            self._enrich_with_company_name(session, accounts)
            return accounts
        finally:
            session.close()

    def _enrich_with_company_name(self, session, accounts: List[Dict[str, Any]]):
        """Add company_name to each account dict"""
        company_ids = [
            str(a['company_id']) for a in accounts
            if a.get('company_id')
        ]
        if not company_ids:
            return
        from app.domains.company.models import Company
        companies = session.query(
            Company.id, Company.name
        ).filter(Company.id.in_(company_ids)).all()
        name_map = {str(c.id): c.name for c in companies}
        for a in accounts:
            cid = str(a['company_id']) if a.get('company_id') else None
            a['company_name'] = name_map.get(cid) if cid else None

    def connect_oauth(self, code: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Connect an email account via Google OAuth.
        Creates a new account or updates existing one."""
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import Flow
        from googleapiclient.discovery import build
        from app.core.config import settings
        from app.core.encryption import encrypt_text
        from app.domains.email_ingestion.repository import (
            get_email_account_repository,
        )

        # Gmail scopes for IMAP + SMTP
        scopes = [
            "https://mail.google.com/",
            "https://www.googleapis.com/auth/userinfo.email",
            "openid",
        ]

        client_config = {
            "web": {
                "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
                "client_secret": settings.GOOGLE_OAUTH_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [
                    settings.GOOGLE_OAUTH_REDIRECT_URI
                ],
            }
        }

        flow = Flow.from_client_config(
            client_config,
            scopes=scopes,
            redirect_uri=settings.GOOGLE_OAUTH_REDIRECT_URI,
        )
        flow.fetch_token(code=code)
        creds = flow.credentials

        # Get user email
        svc = build("oauth2", "v2", credentials=creds)
        userinfo = svc.userinfo().get().execute()
        email_address = userinfo.get("email", "")
        display_name = userinfo.get("name", email_address)

        session = self._get_session()
        try:
            repo = get_email_account_repository(session)

            # Check if account with this email already exists
            existing = repo.get_by_email(email_address)

            account_data = {
                "auth_method": "oauth",
                "oauth_access_token": encrypt_text(creds.token),
                "oauth_refresh_token": encrypt_text(
                    creds.refresh_token
                ) if creds.refresh_token else None,
                "oauth_token_expiry": creds.expiry,
                "encrypted_password": encrypt_password("oauth"),
                "is_active": True,
            }

            if existing:
                # Update existing account to OAuth
                account_data.update({
                    k: v for k, v in data.items()
                    if v is not None and k in (
                        "company_id", "owner_staff_id", "sender_name", "sender_phone",
                    )
                })
                result = repo.update(str(existing["id"]), account_data)
            else:
                # Detect provider
                domain = email_address.split("@")[1] if "@" in email_address else ""
                provider = "gmail"
                if "outlook" in domain or "office" in domain:
                    provider = "outlook"

                account_data.update({
                    "display_name": data.get("sender_name") or display_name,
                    "email_address": email_address,
                    "provider_type": provider,
                    "imap_server": "imap.gmail.com",
                    "imap_port": 993,
                    "use_ssl": True,
                    "username": email_address,
                    "company_id": data.get("company_id"),
                    "owner_staff_id": data.get("owner_staff_id"),
                    "sender_name": data.get("sender_name"),
                    "sender_phone": data.get("sender_phone"),
                })
                result = repo.create(account_data)

            session.commit()
            self._enrich_with_company_name(session, [result])
            return result
        except Exception as e:
            session.rollback()
            logger.error(f"OAuth connect failed: {e}")
            raise
        finally:
            session.close()

    def get_oauth_url(self) -> Dict[str, str]:
        """Generate Google OAuth authorization URL for email access"""
        from app.core.config import settings
        from google_auth_oauthlib.flow import Flow

        scopes = [
            "https://mail.google.com/",
            "https://www.googleapis.com/auth/userinfo.email",
            "openid",
        ]

        client_config = {
            "web": {
                "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
                "client_secret": settings.GOOGLE_OAUTH_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [
                    settings.GOOGLE_OAUTH_REDIRECT_URI
                ],
            }
        }

        flow = Flow.from_client_config(
            client_config,
            scopes=scopes,
            redirect_uri=settings.GOOGLE_OAUTH_REDIRECT_URI,
        )

        auth_url, state = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="true",
            prompt="consent",
            state="email_account",
        )

        return {"authorization_url": auth_url, "state": state}

    def _build_imap_client(self, account: Dict[str, Any], session=None):
        """Build an IMAPClient with proper auth (password or OAuth)"""
        from app.domains.email_ingestion.email_client import IMAPClient

        auth_method = account.get("auth_method", "password")
        oauth_token = None
        password = ""

        if auth_method == "oauth":
            from app.domains.claim_followup.smtp_service import SmtpService
            smtp = SmtpService()
            oauth_token = smtp._get_fresh_oauth_token(
                account, session
            )
        else:
            password = decrypt_password(account["encrypted_password"])

        return IMAPClient(
            server=account["imap_server"],
            port=account["imap_port"],
            username=account["username"],
            password=password,
            use_ssl=account["use_ssl"],
            oauth_access_token=oauth_token,
        )

    def test_account(self, account_id: str) -> Dict[str, Any]:
        """Test IMAP connection for an account"""
        session = self._get_readonly_session()
        try:
            from app.domains.email_ingestion.repository import get_email_account_repository
            repo = get_email_account_repository(session)
            account = repo.get_by_id(account_id)

            if not account:
                return {"success": False, "message": "Account not found", "inbox_count": None}

            client = self._build_imap_client(account, session)
            success, message, inbox_count = client.test_connection()
            return {"success": success, "message": message, "inbox_count": inbox_count}
        except Exception as e:
            return {"success": False, "message": str(e), "inbox_count": None}
        finally:
            session.close()

    # ============================================================
    # Polling & Processing
    # ============================================================

    def poll_account(
        self,
        account_id: str,
        since_date: Optional[datetime] = None,
        limit: int = 50,
        unseen_only: bool = False,
    ) -> Dict[str, Any]:
        """Poll a single email account for new insurance estimate PDFs.

        Matched attachments are queued as 'pending' for review; polling never
        creates claims or revisions on its own.

        `since_date` defaults to the account's last_synced_at (an incremental
        poll). Pass an explicit date with a larger `limit` to backfill older
        mail - dedup is by (message_id, attachment_hash), so re-scanning
        already-processed mail is safe.
        """
        session = self._get_session()
        try:
            from app.domains.email_ingestion.repository import (
                get_email_account_repository,
                get_email_ingestion_log_repository,
            )
            account_repo = get_email_account_repository(session)
            log_repo = get_email_ingestion_log_repository(session)

            account = account_repo.get_by_id(account_id)
            if not account:
                raise ValueError(f"Account {account_id} not found")

            # Connect to IMAP
            imap = self._build_imap_client(account, session)

            # Every message, with or without attachments: the ones matching
            # a claim are kept in received_emails, and the ones carrying
            # files also go through the PDF pipeline below. These arrive one
            # at a time, so only one message's attachments are in memory.
            all_emails = imap.fetch_emails(
                since_date=since_date or _as_datetime(account.get("last_synced_at")),
                limit=limit,
                unseen_only=unseen_only,
            )

            stats = {
                "account_id": account_id,
                "account_email": account["email_address"],
                "emails_found": 0,
                "emails_scanned": 0,
                "emails_saved": 0,
                "processed": 0,
                "uploaded": 0,
                "pending": 0,
                "skipped": 0,
                "duplicates": 0,
                "errors": 0,
            }

            # Everything we have emailed out, read once. Looking this up per
            # attachment scanned the whole sent_emails JSONB column for every
            # PDF, which dropped the Neon connection partway through a poll.
            sent_index = _load_sent_attachment_index(session)
            # Same for the water mitigation jobs inbound mail is matched to
            from app.domains.water_mitigation.adjuster_inbox import JobMailIndex
            wm_index = JobMailIndex.load(session)
            from app.domains.email_ingestion.matcher import ClaimContactIndex
            claim_index = ClaimContactIndex.load(session)

            for fetched_email in _closing_transaction_between(session, all_emails):
                stats["emails_scanned"] += 1

                try:
                    if self._save_received_email(
                        session, account_id, fetched_email,
                        wm_index=wm_index, own_address=account["email_address"],
                        claim_index=claim_index,
                    ):
                        stats["emails_saved"] += 1
                except Exception as e:
                    session.rollback()
                    logger.error(
                        f"Error saving received email {fetched_email.message_id}: {e}"
                    )
                    stats["errors"] += 1

                try:
                    self._process_email_attachments(
                        session, log_repo, account, fetched_email, sent_index, stats,
                        filed=self._claim_filing(session, account_id, fetched_email.message_id),
                    )
                except Exception as e:
                    session.rollback()
                    logger.error(
                        f"Error keeping the files of {fetched_email.message_id}: {e}"
                    )
                    stats["errors"] += 1

            # Update last_synced_at
            from app.domains.email_ingestion.models import EmailAccount
            acc = session.query(EmailAccount).filter(EmailAccount.id == account_id).first()
            if acc:
                acc.last_synced_at = datetime.now(timezone.utc)
                session.commit()

            return stats

        except Exception as e:
            session.rollback()
            logger.error(f"Error polling account {account_id}: {e}")
            raise
        finally:
            session.close()

    def poll_all_accounts(
        self,
        since_date: Optional[datetime] = None,
        limit: int = 50,
        unseen_only: bool = False,
        company_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Poll all active email accounts (only these companies' when given)"""
        accounts = self.get_accounts()
        if company_ids is not None:
            accounts = [
                a for a in accounts
                if a.get("company_id") and str(a["company_id"]) in company_ids
            ]
        results = []
        total_processed = 0
        total_uploaded = 0
        total_pending = 0
        total_saved = 0

        for account in accounts:
            try:
                result = self.poll_account(
                    str(account["id"]),
                    since_date=since_date,
                    limit=limit,
                    unseen_only=unseen_only,
                )
                results.append(result)
                total_processed += result["processed"]
                total_uploaded += result["uploaded"]
                total_pending += result.get("pending", 0)
                total_saved += result.get("emails_saved", 0)
            except Exception as e:
                logger.error(f"Error polling account {account['email_address']}: {e}")
                results.append({
                    "account_id": str(account["id"]),
                    "account_email": account["email_address"],
                    "emails_found": 0,
                    "processed": 0,
                    "uploaded": 0,
                    "pending": 0,
                    "skipped": 0,
                    "duplicates": 0,
                    "errors": 1,
                })

        return {
            "accounts_polled": len(results),
            "results": results,
            "total_processed": total_processed,
            "total_uploaded": total_uploaded,
            "total_pending": total_pending,
            "total_saved": total_saved,
        }

    # ============================================================
    # Received emails (all inbound mail)
    # ============================================================

    def search_account(
        self,
        account: Dict[str, Any],
        criteria: List[str],
        since_date: Optional[datetime] = None,
        limit: int = 50,
    ) -> int:
        """Store the account's INBOX messages matching any IMAP search term,
        for a check that can't wait for the next poll. Returns how many were
        new.

        The files on mail filed on a claim are kept too, as the poll keeps
        them, so they open from the claim right away. That includes mail
        stored before: a check is how a claim's older mail gets its files.
        Everything else the poll does is left to it (last_synced_at
        included).
        """
        from app.domains.email_ingestion.matcher import ClaimContactIndex
        from app.domains.email_ingestion.repository import get_email_ingestion_log_repository
        from app.domains.water_mitigation.adjuster_inbox import JobMailIndex

        session = self._get_session()
        try:
            imap = self._build_imap_client(account, session)
            wm_index = JobMailIndex.load(session)
            claim_index = ClaimContactIndex.load(session)
            log_repo = get_email_ingestion_log_repository(session)
            sent_index = _load_sent_attachment_index(session)
            account_id = str(account["id"])
            stats = _attachment_stats()
            saved = 0
            fetched = imap.search_emails(criteria, since_date=since_date, limit=limit)
            for fetched_email in _closing_transaction_between(session, fetched):
                try:
                    if self._save_received_email(
                        session, account_id, fetched_email,
                        wm_index=wm_index, own_address=account["email_address"],
                        claim_index=claim_index,
                    ):
                        saved += 1
                except Exception as e:
                    # e.g. the scheduled poll stored the same message meanwhile
                    session.rollback()
                    logger.error(
                        f"Error saving received email {fetched_email.message_id}: {e}"
                    )
                try:
                    filed = self._claim_filing(session, account_id, fetched_email.message_id)
                    if filed:
                        self._process_email_attachments(
                            session, log_repo, account, fetched_email, sent_index, stats,
                            filed=filed,
                        )
                except Exception as e:
                    # One message's files don't stop the check
                    session.rollback()
                    logger.error(
                        f"Error keeping the files of {fetched_email.message_id}: {e}"
                    )
            return saved
        finally:
            session.close()

    def search_inboxes(
        self,
        criteria: List[str],
        since_date: Optional[datetime] = None,
        limit: int = 50,
    ) -> Dict[str, Any]:
        """search_account over every connected inbox, for a check someone is
        waiting on. One account failing doesn't stop the others; it is
        reported in `errors`."""
        result: Dict[str, Any] = {
            "checked_at": datetime.now(timezone.utc),
            "accounts_checked": 0,
            "saved": 0,
            "errors": [],
            "skipped_reason": None,
        }
        # Send-only accounts (Resend etc.) have no inbox; see EmailAccount.smtp_server
        accounts = [
            a for a in self.get_accounts()
            if not (a.get("provider_type") == "custom" and a.get("smtp_server"))
        ]
        if not accounts:
            result["skipped_reason"] = "No email inbox is connected."
            return result

        for account in accounts:
            try:
                result["saved"] += self.search_account(
                    account, criteria, since_date=since_date, limit=limit
                )
                result["accounts_checked"] += 1
            except Exception as e:
                logger.warning(f"Inbox check failed for {account['email_address']}: {e}")
                result["errors"].append({
                    "account": account["email_address"],
                    "error": str(e),
                })
        return result

    def _save_received_email(
        self,
        session,
        account_id: str,
        fetched_email,
        wm_index=None,
        own_address: Optional[str] = None,
        claim_index=None,
    ) -> bool:
        """Store one inbound message if it belongs to a claim or a water
        mitigation job.

        False if it was already stored or matched nothing - the inbox also
        holds newsletters, receipts and personal mail, none of which belong
        in the app. Unmatched mail is re-checked on the next poll that
        covers its date, so a claim created later still picks it up.

        `wm_index` (a JobMailIndex) also matches WM jobs; `own_address` is
        the receiving account's, so copies of our own mail aren't taken for
        an adjuster's. `claim_index` (a ClaimContactIndex) files mail from
        someone on a claim that names its street.
        """
        from app.domains.email_ingestion.models import ReceivedEmail

        exists = session.query(ReceivedEmail.id).filter(
            ReceivedEmail.email_account_id == account_id,
            ReceivedEmail.message_id == fetched_email.message_id[:500],
        ).first()
        if exists:
            return False

        text = fetched_email.body_text or _html_to_text(fetched_email.body_html)
        client_id, claim_id, method, confidence = self._match_received_email(
            session, fetched_email, text, claim_index=claim_index,
        )

        wm_job_id = None
        if wm_index is not None:
            wm_job_id, wm_method, wm_confidence = wm_index.match(
                fetched_email.subject, text, fetched_email.sender,
                claim_id=claim_id, own_address=own_address,
            )
            job_claim_id, job_client_id = wm_index.claim_of(wm_job_id)
            if wm_job_id and job_claim_id and job_claim_id != claim_id:
                if method in _CERTAIN_MATCH_METHODS:
                    # The thread or claim number says another claim
                    wm_job_id = None
                else:
                    # The job's claim number or adjuster beats an address or
                    # name guess at the claim
                    client_id, claim_id = job_client_id, job_claim_id
                    method, confidence = wm_method, wm_confidence
            elif wm_job_id and not method:
                method, confidence = wm_method, wm_confidence

        if not client_id and not claim_id and not wm_job_id:
            return False

        session.add(ReceivedEmail(
            email_account_id=account_id,
            message_id=fetched_email.message_id[:500],
            in_reply_to=(fetched_email.in_reply_to or "")[:500] or None,
            subject=_cap(fetched_email.subject, 2000),
            sender=(fetched_email.sender or "")[:500] or None,
            to_addresses=_cap(fetched_email.to, 5000),
            cc_addresses=_cap(fetched_email.cc, 5000),
            received_at=fetched_email.received_at,
            snippet=_snippet(text),
            body_text=_cap(fetched_email.body_text, _MAX_BODY_CHARS),
            body_html=_cap(fetched_email.body_html, _MAX_BODY_CHARS),
            attachment_names=fetched_email.attachment_names or None,
            matched_client_id=client_id,
            matched_claim_id=claim_id,
            match_method=method,
            match_confidence=confidence,
            matched_wm_job_id=wm_job_id,
        ))
        session.commit()
        return True

    def _match_received_email(
        self, session, fetched_email, text: str, claim_index=None,
    ) -> Tuple[Optional[str], Optional[str], Optional[str], Optional[int]]:
        """(client_id, claim_id, method, confidence) for an inbound message.

        A reply in a thread we started is the strongest signal - the claim is
        whatever our outbound mail (or an earlier stored message in the same
        thread) belonged to. Otherwise fall back to the attachment matcher's
        text rules over subject + body, then to `claim_index` (a
        ClaimContactIndex): a sender on the claim naming its street.
        """
        from app.domains.claim_followup.models import SentEmail
        from app.domains.client.models import Claim
        from app.domains.email_ingestion.matcher import match_email_to_client
        from app.domains.email_ingestion.models import ReceivedEmail

        thread_ids = _MESSAGE_ID_PATTERN.findall(
            f"{fetched_email.in_reply_to} {fetched_email.references}"
        )
        if thread_ids:
            claim_id = None
            sent = session.query(SentEmail.claim_id).filter(
                SentEmail.smtp_message_id.in_(thread_ids)
            ).first()
            if sent:
                claim_id = sent[0]
            else:
                earlier = session.query(ReceivedEmail.matched_claim_id).filter(
                    ReceivedEmail.message_id.in_(thread_ids),
                    ReceivedEmail.matched_claim_id.isnot(None),
                ).first()
                if earlier:
                    claim_id = earlier[0]
            if claim_id:
                claim = session.query(Claim).filter(Claim.id == claim_id).first()
                if claim:
                    return str(claim.client_id), str(claim.id), "reply_thread", 95

        email_text = f"Subject: {fetched_email.subject}\n{text}"
        result = match_email_to_client(
            session, email_text, "", sender=fetched_email.sender
        )
        # A bare name guess ("Dear John" -> any client named John) is too
        # loose to file mail on; keep name matches only when the sender's
        # address is the client's own email.
        if result.method == "name" and (result.confidence or 0) < 85:
            result.client_id = None
        if not result.client_id:
            # Someone on the claim naming its street ("larkspur")
            result = claim_index.match(email_text, fetched_email.sender) if claim_index else None
            if not result:
                return None, None, None, None

        claim_id = result.claim_id
        if not claim_id:
            # Address / sender-email matches find the client, not the claim.
            # With a single claim there is nothing to choose between.
            claims = session.query(Claim.id).filter(
                Claim.client_id == result.client_id
            ).limit(2).all()
            if len(claims) == 1:
                claim_id = str(claims[0][0])
        return result.client_id, claim_id, result.method, result.confidence

    def get_received_emails(
        self,
        claim_id: Optional[str] = None,
        account_id: Optional[str] = None,
        unmatched: bool = False,
        search: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        scope=None,
    ) -> Dict[str, Any]:
        """List stored inbound mail, newest first. Bodies are left out."""
        from sqlalchemy import or_

        from app.domains.auth.company_scope import scoped
        from app.domains.client.models import Claim, Client
        from app.domains.email_ingestion.models import EmailAccount, ReceivedEmail

        session = self._get_readonly_session()
        try:
            query = scoped(session.query(ReceivedEmail), scope)
            if claim_id:
                query = query.filter(ReceivedEmail.matched_claim_id == claim_id)
            if account_id:
                query = query.filter(ReceivedEmail.email_account_id == account_id)
            if search and search.strip():
                like = f"%{search.strip()}%"
                query = query.filter(or_(
                    ReceivedEmail.subject.ilike(like),
                    ReceivedEmail.sender.ilike(like),
                    ReceivedEmail.snippet.ilike(like),
                ))
            query = _one_copy_per_message(query)
            # After picking the copy: a message is unlinked only if no copy is on a claim
            if unmatched:
                query = query.filter(ReceivedEmail.matched_claim_id.is_(None))

            total = query.count()
            rows = query.order_by(
                ReceivedEmail.received_at.desc().nullslast()
            ).offset(offset).limit(limit).all()

            claim_ids = {r.matched_claim_id for r in rows if r.matched_claim_id}
            client_ids = {r.matched_client_id for r in rows if r.matched_client_id}
            account_ids = {r.email_account_id for r in rows}
            claims = {
                c.id: c for c in session.query(Claim).filter(Claim.id.in_(claim_ids))
            } if claim_ids else {}
            clients = {
                c.id: c for c in session.query(Client).filter(Client.id.in_(client_ids))
            } if client_ids else {}
            accounts = {
                a.id: a for a in session.query(EmailAccount).filter(EmailAccount.id.in_(account_ids))
            } if account_ids else {}

            items = []
            for r in rows:
                item = _received_email_dict(r, include_body=False)
                claim = claims.get(r.matched_claim_id)
                client = clients.get(r.matched_client_id)
                acc = accounts.get(r.email_account_id)
                item["claim_number"] = claim.claim_number if claim else None
                item["client_name"] = client.display_name if client else None
                item["account_email"] = acc.email_address if acc else None
                items.append(item)
            return {"items": items, "total": total}
        finally:
            session.close()

    def get_received_email(self, email_id: str) -> Optional[Dict[str, Any]]:
        """One stored inbound message, body included."""
        from app.domains.email_ingestion.models import ReceivedEmail

        session = self._get_readonly_session()
        try:
            row = session.query(ReceivedEmail).filter(ReceivedEmail.id == email_id).first()
            return _received_email_dict(row, include_body=True) if row else None
        finally:
            session.close()

    def assign_received_email(self, email_id: str, claim_id: Optional[str]) -> Dict[str, Any]:
        """Link an inbound message to a claim by hand, or unlink it (None)."""
        from app.domains.client.models import Claim
        from app.domains.email_ingestion.models import ReceivedEmail

        session = self._get_session()
        try:
            row = session.query(ReceivedEmail).filter(ReceivedEmail.id == email_id).first()
            if not row:
                raise ValueError(f"Received email {email_id} not found")
            claim = None
            if claim_id:
                claim = session.query(Claim).filter(Claim.id == claim_id).first()
                if not claim:
                    raise ValueError(f"Claim {claim_id} not found")
            # Every inbox's copy: lists show one, and another copy would take
            # the place of one just unlinked
            copies = session.query(ReceivedEmail).filter(
                ReceivedEmail.message_id == row.message_id
            ).all()
            for copy in copies:
                # A person's call overrides the automatic WM job match; mail on a
                # claim still shows on that claim's job
                copy.matched_wm_job_id = None
                copy.matched_claim_id = claim.id if claim else None
                copy.matched_client_id = claim.client_id if claim else None
                copy.match_method = "manual" if claim else None
                copy.match_confidence = 100 if claim else None
            session.commit()
            return _received_email_dict(row, include_body=False)
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def get_received_attachments(self, email_id: str) -> Optional[List[Dict[str, Any]]]:
        """The files on one received email, for opening them from the claim;
        None for an unknown email.

        - kind "pdf": a PDF's review log. `file_id` opens it; `can_file`
          means it waits for review and can be filed on the claim.
        - kind "file": another file kept with mail on a claim.
        - kind "missing": a name on the email with no stored file - mail
          stored before files were kept (a Check inbox on the claim fetches
          them), a large email's non-PDF files, our own files coming back.
        """
        session = self._get_readonly_session()
        try:
            return self._received_attachments(session, email_id)
        finally:
            session.close()

    def _received_attachments(self, session, email_id: str) -> Optional[List[Dict[str, Any]]]:
        from collections import Counter

        from app.domains.email_ingestion.models import EmailIngestionLog, ReceivedEmail
        from app.domains.file.models import File

        row = session.query(ReceivedEmail).filter(ReceivedEmail.id == email_id).first()
        if row is None:
            return None

        logs = session.query(EmailIngestionLog).filter(
            EmailIngestionLog.message_id == row.message_id
        ).order_by(EmailIngestionLog.created_at).all()
        # A duplicate has no file of its own: it opens the stored copy
        copy_of: Dict[str, str] = {}
        missing_hashes = {
            log.attachment_hash for log in logs if not log.file_id and log.attachment_hash
        }
        if missing_hashes:
            for digest, file_id in session.query(
                EmailIngestionLog.attachment_hash, EmailIngestionLog.file_id
            ).filter(
                EmailIngestionLog.attachment_hash.in_(missing_hashes),
                EmailIngestionLog.file_id.isnot(None),
                EmailIngestionLog.file_id != "",
            ).order_by(EmailIngestionLog.created_at):
                copy_of.setdefault(digest, file_id)

        copy_ids = [
            str(i) for (i,) in session.query(ReceivedEmail.id).filter(
                ReceivedEmail.message_id == row.message_id
            )
        ]
        others = session.query(File).filter(
            File.context == RECEIVED_FILE_CONTEXT,
            File.context_id.in_(copy_ids),
            File.is_active.isnot(False),
        ).order_by(File.created_at).all()

        log_file_ids = {
            log.file_id or copy_of.get(log.attachment_hash) for log in logs
        } - {None}
        files = {
            f.id: f for f in session.query(File).filter(File.id.in_(log_file_ids))
        } if log_file_ids else {}

        items: List[Dict[str, Any]] = []
        for log in logs:
            file_id = log.file_id or copy_of.get(log.attachment_hash)
            stored = files.get(file_id)
            if stored is None or stored.is_active is False:
                file_id = None
            document_type = None
            if log.status == "uploaded" and stored is not None and stored.category not in (
                None, PENDING_FILE_CATEGORY,
            ):
                document_type = stored.category
            items.append({
                "kind": "pdf",
                "name": log.attachment_name or (stored.original_name if stored else "attachment.pdf"),
                "log_id": str(log.id),
                "file_id": file_id,
                "size": stored.size if stored else None,
                "content_type": stored.content_type if stored else "application/pdf",
                "status": log.status,
                "document_type": document_type,
                "is_insurance_estimate": log.is_insurance_estimate,
                "note": _attachment_note(log, file_id),
                "can_file": log.status == "pending" and bool(log.file_id) and file_id is not None,
            })
        for f in others:
            items.append({
                "kind": "file",
                "name": f.original_name,
                "log_id": None,
                "file_id": f.id,
                "size": f.size,
                "content_type": f.content_type,
                "status": None,
                "document_type": None,
                "is_insurance_estimate": None,
                "note": None,
                "can_file": False,
            })

        unaccounted = Counter(row.attachment_names or []) - Counter(item["name"] for item in items)
        for name in row.attachment_names or []:
            if unaccounted[name] > 0:
                unaccounted[name] -= 1
                items.append({
                    "kind": "missing", "name": name, "log_id": None, "file_id": None,
                    "size": None, "content_type": None, "status": None,
                    "document_type": None, "is_insurance_estimate": None,
                    "note": "Not stored in the app", "can_file": False,
                })
        return items

    def received_attachment_file(self, email_id: str, file_id: str) -> Optional[Dict[str, Any]]:
        """Where to read one of a received email's files (see
        get_received_attachments), or None when it isn't one of them."""
        session = self._get_readonly_session()
        try:
            items = self._received_attachments(session, email_id) or []
            if not any(item["file_id"] == file_id for item in items):
                return None
            return _readable_file(session, file_id)
        finally:
            session.close()

    def log_file(self, log_id: str) -> Optional[Dict[str, Any]]:
        """Where to read a review log's stored PDF (a duplicate's stored
        copy), or None when there is none."""
        from app.domains.email_ingestion.models import EmailIngestionLog

        session = self._get_readonly_session()
        try:
            log = session.query(EmailIngestionLog).filter(EmailIngestionLog.id == log_id).first()
            if log is None:
                return None
            file_id = log.file_id
            if not file_id and log.attachment_hash:
                copy = session.query(EmailIngestionLog.file_id).filter(
                    EmailIngestionLog.attachment_hash == log.attachment_hash,
                    EmailIngestionLog.file_id.isnot(None),
                    EmailIngestionLog.file_id != "",
                ).order_by(EmailIngestionLog.created_at).first()
                file_id = copy[0] if copy else None
            return _readable_file(session, file_id) if file_id else None
        finally:
            session.close()

    def pending_log_file_id(self, log_id: str) -> str:
        """The stored PDF of a log still waiting for review, which is about
        to become a claim's estimate revision. Raises ValueError otherwise."""
        from app.domains.email_ingestion.models import EmailIngestionLog

        session = self._get_readonly_session()
        try:
            log = session.query(EmailIngestionLog).filter(EmailIngestionLog.id == log_id).first()
            if log is None:
                raise ValueError("Email attachment not found")
            if log.status != "pending" or not log.file_id:
                raise ValueError("This attachment was already filed or has no stored file")
            return log.file_id
        finally:
            session.close()

    def mark_filed_as_revision(
        self,
        log_id: str,
        client_id: str,
        claim_id: str,
        negotiation_id: str,
        reviewed_by: Optional[str] = None,
    ) -> None:
        """Record that a log's PDF became the claim's estimate revision
        (made on the claim page, amounts and all), as manual_assign records
        an insurance estimate confirmed in review."""
        from app.domains.email_ingestion.models import EmailIngestionLog
        from app.domains.file.models import File

        session = self._get_session()
        try:
            log = session.query(EmailIngestionLog).filter(EmailIngestionLog.id == log_id).first()
            if log is None:
                raise ValueError("Email attachment not found")
            stored = session.query(File).filter(File.id == log.file_id).first()
            if stored is not None:
                stored.context = "claim-negotiation"
                stored.context_id = str(claim_id)
                stored.category = ESTIMATE_DOCUMENT_TYPE
            log.matched_client_id = client_id
            log.matched_claim_id = claim_id
            log.match_method = "manual"
            log.match_confidence = 100
            log.reviewed_by = reviewed_by
            log.reviewed_at = datetime.now(timezone.utc)
            log.status = "uploaded"
            log.negotiation_id = negotiation_id
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    # ============================================================
    # Attachments
    # ============================================================

    def _claim_filing(self, session, account_id: str, message_id: str):
        """The received_emails row of this inbox's copy of the message when
        it is filed on a claim, else None."""
        from app.domains.email_ingestion.models import ReceivedEmail

        return session.query(ReceivedEmail).filter(
            ReceivedEmail.email_account_id == account_id,
            ReceivedEmail.message_id == (message_id or "")[:500],
            ReceivedEmail.matched_claim_id.isnot(None),
        ).first()

    def _process_email_attachments(
        self,
        session,
        log_repo,
        account: Dict[str, Any],
        fetched_email,
        sent_index: Tuple[Set[str], Set[str]],
        stats: Dict[str, int],
        filed=None,
    ) -> None:
        """Run the message's PDFs through the review pipeline, adding to
        `stats`.

        `filed` is the message's received_emails row when it is filed on a
        claim. Such mail keeps every PDF whatever the classifier makes of it
        - a carrier's estimate can be named for nothing but the address -
        and its other files too, so all of them open from the claim.
        """
        if not fetched_email.attachments:
            return
        stats["emails_found"] += 1

        # A bounce is our own outbound mail coming back; skip the whole
        # message rather than filtering its attachments one by one, since
        # none of them are new inbound documents.
        if _is_bounce_message(fetched_email.sender, fetched_email.subject):
            stats["skipped"] += 1
            return

        account_id = str(account["id"])
        # Pre-pass: does any attachment on this email look like claim
        # paperwork? Attachments are judged one at a time, so without this
        # the first file is evaluated before its siblings exist. When one
        # qualifies the others are kept too - a claim packet arrives as
        # estimate + scope + photo report + contract, and some of those are
        # named only for the property address, which no filename rule can
        # recognise on its own.
        if filed is not None:
            sibling_passed, keep_reason = True, _KEPT_ON_CLAIM
        else:
            sibling_passed = _any_attachment_qualifies(fetched_email, sent_index)
            keep_reason = _KEPT_WITH_SIBLING

        # Dedup is per attachment (not per email), so one that failed before
        # is looked at again while the ones already logged are left alone.
        for attachment in fetched_email.pdf_attachments:
            try:
                logged = log_repo.get_by_message_id_and_hash(
                    fetched_email.message_id, attachment.sha256_hash
                )
                if logged is not None:
                    if filed is not None and self._keep_logged_attachment(
                        session, logged, account_id, attachment, fetched_email
                    ):
                        stats["pending"] += 1
                    else:
                        stats["duplicates"] += 1
                    continue

                result = self._process_attachment(
                    session=session,
                    log_repo=log_repo,
                    account=account,
                    fetched_email=fetched_email,
                    attachment=attachment,
                    sibling_passed=sibling_passed,
                    sent_index=sent_index,
                    keep_reason=keep_reason,
                )
                stats["processed"] += 1
                status = result.get("status")
                if status == "uploaded":
                    stats["uploaded"] += 1
                elif status == "pending":
                    stats["pending"] += 1
                elif status == "skipped":
                    stats["skipped"] += 1
                elif status == "duplicate":
                    stats["duplicates"] += 1
            except Exception as e:
                logger.error(f"Error processing attachment {attachment.filename}: {e}")
                session.rollback()
                stats["errors"] += 1
                try:
                    log_repo.create({
                        "email_account_id": account_id,
                        "message_id": fetched_email.message_id,
                        "subject": fetched_email.subject,
                        "sender": fetched_email.sender,
                        "received_at": fetched_email.received_at,
                        "attachment_name": attachment.filename,
                        "attachment_hash": attachment.sha256_hash,
                        "status": "failed",
                        "error_message": str(e),
                    })
                    session.commit()
                except Exception as log_error:
                    # e.g. a poll logged the same attachment meanwhile; the
                    # next message's files still get their turn
                    session.rollback()
                    logger.error(f"Couldn't log the failure of {attachment.filename}: {log_error}")

        if filed is not None:
            self._store_received_files(session, filed, fetched_email, sent_index)

    def _keep_logged_attachment(
        self, session, log, account_id: str, attachment, fetched_email
    ) -> bool:
        """Store a PDF that was logged without its file - the classifier
        passed it over, or storing it failed - now that its email is filed
        on a claim, and put it up for review. False when there is nothing
        to do: it has its file, or it is ours, or a copy of a stored one."""
        if log.file_id or log.status not in _UPGRADABLE_STATUSES:
            return False
        if log.skip_reason == _OWN_FILE_SKIP_REASON:
            return False
        file_id = self._store_attachment_file(session, account_id, attachment, fetched_email)
        if file_id is None:
            return False
        log.file_id = file_id
        log.status = "pending"
        log.skip_reason = None
        log.error_message = None
        reason = log.classification_reason
        log.classification_reason = f"{reason} | {_KEPT_ON_CLAIM}" if reason else _KEPT_ON_CLAIM
        session.commit()
        return True

    def _store_received_files(self, session, filed, fetched_email, sent_index) -> int:
        """Store the message's files other than PDFs under RECEIVED_FILE_CONTEXT,
        keyed by `filed` (its received_emails row). Returns how many were new.

        Files we sent ourselves and files over _MAX_RECEIVED_FILE_BYTES are
        left in the mailbox. A file stored from another inbox's copy of the
        message isn't stored again. Files are told apart by name - storage
        may shrink a picture, so its size changes - and a name the message
        carries twice ("image.jpeg" from a phone) by how many are stored."""
        from collections import Counter

        from app.domains.email_ingestion.models import ReceivedEmail
        from app.domains.file.models import File
        from app.domains.file.service import FileService

        pdfs = {id(att) for att in fetched_email.pdf_attachments}
        others = [
            att for att in fetched_email.attachments
            if id(att) not in pdfs
            and att.data and len(att.data) <= _MAX_RECEIVED_FILE_BYTES
            and not _is_own_sent_attachment(att, sent_index)
        ]
        if not others:
            return 0

        copy_ids = [
            str(row_id) for (row_id,) in session.query(ReceivedEmail.id).filter(
                ReceivedEmail.message_id == filed.message_id
            )
        ]
        have = Counter(
            name for (name,) in session.query(File.original_name).filter(
                File.context == RECEIVED_FILE_CONTEXT,
                File.context_id.in_(copy_ids),
                File.is_active.isnot(False),
            )
        )
        context_id = str(filed.id)
        # Nothing held open while the files upload
        session.commit()

        seen: Counter = Counter()
        stored = 0
        for att in others:
            name = (att.filename or "attachment")[:255]
            seen[name] += 1
            if seen[name] <= have[name]:
                continue
            file_service = FileService(self.database)
            try:
                self._run_upload(
                    file_service,
                    file_data=io.BytesIO(att.data),
                    original_filename=name,
                    content_type=att.content_type or "application/octet-stream",
                    context=RECEIVED_FILE_CONTEXT,
                    context_id=context_id,
                    category=RECEIVED_FILE_CATEGORY,
                    description=f"Received with: {fetched_email.subject or ''}"[:1000],
                )
                file_service.repository.session.commit()
                stored += 1
            except Exception as e:
                logger.error(f"Failed to store received file {name}: {e}")
                file_service.repository.session.rollback()
            finally:
                file_service.repository.session.close()
        return stored

    def _process_attachment(
        self,
        session,
        log_repo,
        account: Dict[str, Any],
        fetched_email,
        attachment,
        sibling_passed: bool = False,
        sent_index: Optional[Tuple[Set[str], Set[str]]] = None,
        keep_reason: str = _KEPT_WITH_SIBLING,
    ) -> Dict[str, Any]:
        """Process a single PDF attachment through the pipeline.

        Stores the PDF and records what it matched, then leaves the row
        'pending'. Creating the claim and the ClaimNegotiation revision is a
        reviewer's decision, made in manual_assign - see Step 6.
        """
        from app.domains.email_ingestion.classifier import (
            classify_email_attachment,
            extract_pdf_text_first_pages,
        )
        from app.domains.email_ingestion.matcher import match_email_to_client

        account_id = str(account["id"])

        # Step 0: Is this a file we sent ourselves, coming back to us?
        # Replies, forwards and bounce notifications re-attach the original
        # PDFs, so without this the estimate we emailed out is ingested again
        # and shows up twice on the claim - once under sent mail, once under
        # received. Compared by hash where we have one (sends from now on)
        # and by filename otherwise (older rows stored only name + mime type).
        if _is_own_sent_attachment(
            attachment, sent_index or _load_sent_attachment_index(session)
        ):
            log_repo.create({
                "email_account_id": account_id,
                "message_id": fetched_email.message_id,
                "subject": fetched_email.subject,
                "sender": fetched_email.sender,
                "received_at": fetched_email.received_at,
                "attachment_name": attachment.filename,
                "attachment_hash": attachment.sha256_hash,
                "status": "skipped",
                "skip_reason": _OWN_FILE_SKIP_REASON,
            })
            session.commit()
            return {"status": "skipped"}

        # Step 1: Check attachment hash duplicate
        if log_repo.exists_by_attachment_hash(attachment.sha256_hash):
            log_data = {
                "email_account_id": account_id,
                "message_id": fetched_email.message_id,
                "subject": fetched_email.subject,
                "sender": fetched_email.sender,
                "received_at": fetched_email.received_at,
                "attachment_name": attachment.filename,
                "attachment_hash": attachment.sha256_hash,
                "status": "duplicate",
                "skip_reason": "Attachment with same hash already uploaded",
            }
            log_repo.create(log_data)
            session.commit()
            return {"status": "duplicate"}

        # Step 2: Classify
        is_estimate, confidence, reason = classify_email_attachment(
            filename=attachment.filename,
            sender=fetched_email.sender,
            subject=fetched_email.subject,
            body=fetched_email.body_text,
            pdf_data=attachment.data,
        )

        if not is_estimate and not sibling_passed:
            log_data = {
                "email_account_id": account_id,
                "message_id": fetched_email.message_id,
                "subject": fetched_email.subject,
                "sender": fetched_email.sender,
                "received_at": fetched_email.received_at,
                "attachment_name": attachment.filename,
                "attachment_hash": attachment.sha256_hash,
                "status": "skipped",
                "is_insurance_estimate": False,
                "classification_reason": reason,
                "skip_reason": f"Not classified as insurance estimate (confidence: {confidence}%)",
            }
            log_repo.create(log_data)
            session.commit()
            return {"status": "skipped"}

        if not is_estimate:
            # Kept only because a sibling attachment on the same email
            # qualified, or the email is filed on a claim. Files named just
            # for the property address ("6305 Musket Ball Drive Centreville
            # 20121.pdf") carry no recognisable document type, but arrive in
            # the same packet as the report that does.
            reason = f"{reason} | {keep_reason}"

        # Step 2.5: Persist the PDF now that it's classified as an estimate, so a
        # reviewer can preview/assign it later even if matching fails below.
        pending_file_id = self._store_attachment_file(session, account_id, attachment, fetched_email)
        if pending_file_id is None:
            log_data = {
                "email_account_id": account_id,
                "message_id": fetched_email.message_id,
                "subject": fetched_email.subject,
                "sender": fetched_email.sender,
                "received_at": fetched_email.received_at,
                "attachment_name": attachment.filename,
                "attachment_hash": attachment.sha256_hash,
                "status": "failed",
                "is_insurance_estimate": is_estimate,
                "classification_reason": reason,
                "error_message": "Failed to store attachment in file storage",
            }
            log_repo.create(log_data)
            session.commit()
            return {"status": "failed"}

        # Step 3: Match to client/claim
        pdf_text = extract_pdf_text_first_pages(attachment.data)
        email_text = f"Subject: {fetched_email.subject}\n{fetched_email.body_text}"
        match_result = match_email_to_client(session, email_text, pdf_text, sender=fetched_email.sender)

        if not match_result.client_id:
            # No match - create pending log for manual review. The PDF is already
            # stored (pending_file_id), so a reviewer can preview it and assign it
            # later via manual_assign without losing the original file.
            log_data = {
                "email_account_id": account_id,
                "message_id": fetched_email.message_id,
                "subject": fetched_email.subject,
                "sender": fetched_email.sender,
                "received_at": fetched_email.received_at,
                "attachment_name": attachment.filename,
                "attachment_hash": attachment.sha256_hash,
                "status": "pending",
                "is_insurance_estimate": is_estimate,
                "classification_reason": reason,
                "file_id": pending_file_id,
            }
            log_repo.create(log_data)
            session.commit()
            return {"status": "pending"}

        # Step 4: Resolve the claim this attachment would belong to.
        # Nothing is created here - a brand-new claim is only minted once a
        # reviewer confirms the match (manual_assign), never by the poller.
        claim_id = match_result.claim_id

        # Step 5: Check duplicate for this specific claim
        if claim_id and log_repo.exists_by_attachment_hash(attachment.sha256_hash, claim_id):
            log_data = {
                "email_account_id": account_id,
                "message_id": fetched_email.message_id,
                "subject": fetched_email.subject,
                "sender": fetched_email.sender,
                "received_at": fetched_email.received_at,
                "attachment_name": attachment.filename,
                "attachment_hash": attachment.sha256_hash,
                "status": "duplicate",
                "matched_client_id": match_result.client_id,
                "matched_claim_id": claim_id,
                "skip_reason": "Same file already uploaded to this claim",
                "file_id": pending_file_id,
            }
            log_repo.create(log_data)
            session.commit()
            return {"status": "duplicate"}

        # Step 6: Queue for review. A match is a *suggestion*, not a decision:
        # the revision is only created once a human confirms it in the review
        # screen (manual_assign). Auto-creating it here meant a fuzzy address
        # or name match silently bumped a claim's revision number and pushed
        # the claim to 'negotiating' before anyone had looked at the PDF.
        # The match is recorded on the log so the reviewer can confirm with
        # one click instead of re-finding the client.
        log_data = {
            "email_account_id": account_id,
            "message_id": fetched_email.message_id,
            "subject": fetched_email.subject,
            "sender": fetched_email.sender,
            "received_at": fetched_email.received_at,
            "attachment_name": attachment.filename,
            "attachment_hash": attachment.sha256_hash,
            "status": "pending",
            "is_insurance_estimate": is_estimate,
            "classification_reason": reason,
            "matched_client_id": match_result.client_id,
            "matched_claim_id": claim_id,
            "match_method": match_result.method,
            "match_confidence": match_result.confidence,
            "file_id": pending_file_id,
        }
        log_repo.create(log_data)
        session.commit()

        return {"status": "pending", "file_id": pending_file_id}

    def _run_upload(self, file_service, **upload_kwargs) -> Dict[str, Any]:
        """Run the async FileService.upload_file from sync code, whether or not
        an event loop is already running in this thread."""
        import asyncio

        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(
                    asyncio.run, file_service.upload_file(**upload_kwargs)
                ).result()
        return asyncio.run(file_service.upload_file(**upload_kwargs))

    def _store_attachment_file(
        self, session, account_id: str, attachment, fetched_email
    ) -> Optional[str]:
        """Upload the attachment to storage right after classification, so the
        PDF survives even if matching fails and the log ends up 'pending'.
        Returns the new File's id, or None if the storage upload failed.

        FileService.upload_file() only flushes the new File row - it does not
        commit. Callers (normally the /api/files/upload endpoint) are expected
        to commit the repository's session themselves, so we must do the same
        on our own FileService instance here or the row never persists.
        """
        from app.domains.file.service import FileService

        file_service = FileService(self.database)
        try:
            file_result = self._run_upload(
                file_service,
                file_data=io.BytesIO(attachment.data),
                original_filename=attachment.filename,
                content_type="application/pdf",
                context="email-ingestion",
                context_id=account_id,
                category=PENDING_FILE_CATEGORY,
                description=f"Email ingestion pending review: {fetched_email.subject}",
            )
            file_service.repository.session.commit()
            return file_result.get("id")
        except Exception as e:
            logger.error(f"Failed to store email attachment {attachment.filename}: {e}")
            file_service.repository.session.rollback()
            return None

    def _upload_and_create_negotiation(
        self,
        session,
        claim_id,
        attachment,
        fetched_email,
        existing_file_id: Optional[str] = None,
    ) -> tuple:
        """Attach a PDF to a claim and create a ClaimNegotiation entry.

        If existing_file_id is given, the file was already uploaded (via
        _store_attachment_file) and is simply re-pointed at the claim instead
        of being re-uploaded. Raises on failure instead of silently recording
        a fake local URL - callers must catch and log the error themselves.

        Either `attachment` (with .filename/.data) or `existing_file_id` must
        be provided.
        """
        if attachment is None and not existing_file_id:
            raise ValueError("_upload_and_create_negotiation requires either attachment or existing_file_id")
        from app.domains.file.models import File
        from app.domains.client.repository import get_claim_negotiation_repository

        if existing_file_id:
            file_record = session.query(File).filter(File.id == existing_file_id).first()
            if not file_record:
                raise ValueError(f"Expected file {existing_file_id} not found")
            file_record.context = "claim-negotiation"
            file_record.context_id = claim_id
            file_record.category = "insurance-estimate"
            session.flush()
            file_id = file_record.id
            file_url = file_record.url
        else:
            from app.domains.file.service import FileService

            # Own FileService instance -> own session -> must commit it
            # ourselves (upload_file() only flushes; see _store_attachment_file).
            file_service = FileService(self.database)
            try:
                file_result = self._run_upload(
                    file_service,
                    file_data=io.BytesIO(attachment.data),
                    original_filename=attachment.filename,
                    content_type="application/pdf",
                    context="claim-negotiation",
                    context_id=claim_id,
                    category="insurance-estimate",
                    description=f"Auto-ingested from email: {fetched_email.subject}",
                )
                file_service.repository.session.commit()
            except Exception:
                file_service.repository.session.rollback()
                raise
            file_id = file_result.get("id")
            file_url = file_result.get("url", "")

        # Create ClaimNegotiation
        neg_repo = get_claim_negotiation_repository(session)
        next_rev = neg_repo.get_next_revision_number(claim_id)

        document_name = attachment.filename if attachment is not None else file_record.original_name

        negotiation_data = {
            "claim_id": claim_id,
            "revision_number": next_rev,
            "revision_type": "initial" if next_rev == 1 else "supplement",
            "date_received": fetched_email.received_at or datetime.now(timezone.utc),
            "received_from": fetched_email.sender,
            "document_url": file_url,
            "document_name": document_name,
            "notes": f"Auto-ingested from email: {fetched_email.subject}",
        }
        neg_result = neg_repo.create_and_update_claim(negotiation_data)

        return file_id, str(neg_result.get("id", ""))

    def _file_claim_document(self, session, claim_id, file_id: str, document_type: str) -> str:
        """Attach a stored PDF to a claim as `document_type`, with no revision.

        Only the carrier's estimate is a negotiation revision. A photo report
        or a denial letter that came in the same email belongs on the claim
        too, but must not bump its revision number or move it to negotiating.
        """
        from app.domains.file.models import File

        file_record = session.query(File).filter(File.id == file_id).first()
        if not file_record:
            raise ValueError(f"Expected file {file_id} not found")
        file_record.context = "claim-document"
        file_record.context_id = claim_id
        file_record.category = document_type
        session.flush()
        return file_record.id

    # ============================================================
    # Log Management
    # ============================================================

    def get_logs(
        self,
        status: Optional[str] = None,
        account_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        claim_id: Optional[str] = None,
        has_attachment: bool = False,
        search: Optional[str] = None,
        scope=None,
    ) -> List[Dict[str, Any]]:
        """Get ingestion logs with filters"""
        session = self._get_readonly_session()
        try:
            from app.domains.email_ingestion.repository import get_email_ingestion_log_repository
            repo = get_email_ingestion_log_repository(session)
            logs = repo.get_logs_with_filters(
                status, account_id, limit, offset,
                claim_id=claim_id, has_attachment=has_attachment, search=search,
                scope=scope,
            )

            # Attach stored-file metadata. `file_id` is a plain String column,
            # not a FK, so there is no relationship to join through - look the
            # rows up in one query and map them back.
            file_ids = [log["file_id"] for log in logs if log.get("file_id")]
            if file_ids:
                from app.domains.file.models import File
                files = session.query(File).filter(File.id.in_(file_ids)).all()
                by_id = {f.id: f for f in files}
                for log in logs:
                    f = by_id.get(log.get("file_id"))
                    if f:
                        log["file_name"] = f.original_name
                        log["file_size"] = f.size
                        log["file_content_type"] = f.content_type
                        # Confirming files the PDF under its document type
                        if f.category and f.category != PENDING_FILE_CATEGORY:
                            log["document_type"] = f.category

            self._suggest_from_siblings(session, logs)

            # Enrich with client/claim names
            for log in logs:
                if log.get("matched_client_id"):
                    from app.domains.client.models import Client
                    client = session.query(Client).filter(
                        Client.id == log["matched_client_id"]
                    ).first()
                    log["client_name"] = client.display_name if client else None
                    log["client_address"] = client.address if client else None

                if log.get("matched_claim_id"):
                    from app.domains.client.models import Claim
                    claim = session.query(Claim).filter(
                        Claim.id == log["matched_claim_id"]
                    ).first()
                    log["claim_number"] = claim.claim_number if claim else None

                if log.get("email_account_id"):
                    from app.domains.email_ingestion.models import EmailAccount
                    acc = session.query(EmailAccount).filter(
                        EmailAccount.id == log["email_account_id"]
                    ).first()
                    log["account_email"] = acc.email_address if acc else None

            return logs
        finally:
            session.close()

    def _suggest_from_siblings(self, session, logs: List[Dict[str, Any]]) -> None:
        """Give a pending attachment the client/claim its email belongs to.

        Each attachment is matched on its own text, so in a multi-file email
        usually only one finds the client; a photo report or a sketch named
        for the address comes back unmatched, and confirming it meant finding
        the client all over again. It belongs where its sibling does - and,
        once a sibling has been confirmed, where the reviewer put that one,
        including a claim created on that confirm. Worked out at read time so
        it follows confirmations as they happen. Only gaps are filled: an
        attachment's own match to a different client is left alone.
        """
        from app.domains.email_ingestion.models import EmailIngestionLog

        open_logs = [
            log for log in logs
            if log.get("status") == "pending" and log.get("message_id")
        ]
        if not open_logs:
            return

        siblings = session.query(EmailIngestionLog).filter(
            EmailIngestionLog.message_id.in_({log["message_id"] for log in open_logs}),
            EmailIngestionLog.matched_client_id.isnot(None),
        ).all()

        def rank(row):
            return (
                row.status == "uploaded",
                row.matched_claim_id is not None,
                row.match_confidence or 0,
            )

        # Same message in another mailbox may belong to another company
        best: Dict[Tuple[str, str], Any] = {}
        for row in siblings:
            key = (str(row.email_account_id), row.message_id)
            if key not in best or rank(row) > rank(best[key]):
                best[key] = row

        for log in open_logs:
            row = best.get((str(log["email_account_id"]), log["message_id"]))
            if row is None or str(row.id) == str(log["id"]):
                continue
            if not log.get("matched_client_id"):
                log["matched_client_id"] = row.matched_client_id
                log["matched_claim_id"] = row.matched_claim_id
                log["match_method"] = "same_email"
                log["match_confidence"] = row.match_confidence
            elif (
                not log.get("matched_claim_id")
                and str(log["matched_client_id"]) == str(row.matched_client_id)
            ):
                log["matched_claim_id"] = row.matched_claim_id

        # Still nothing: where the email itself was filed. Its text can name
        # the claim when the attachment's doesn't - "a supplement for
        # larkspur" from the claim's public adjuster.
        unmatched = [log for log in open_logs if not log.get("matched_client_id")]
        if not unmatched:
            return
        from app.domains.email_ingestion.models import ReceivedEmail

        filed = {
            (str(row.email_account_id), row.message_id): row
            for row in session.query(ReceivedEmail).filter(
                ReceivedEmail.message_id.in_({log["message_id"][:500] for log in unmatched}),
                ReceivedEmail.matched_client_id.isnot(None),
            )
        }
        for log in unmatched:
            row = filed.get((str(log["email_account_id"]), log["message_id"][:500]))
            if row is not None:
                log["matched_client_id"] = row.matched_client_id
                log["matched_claim_id"] = row.matched_claim_id
                log["match_method"] = "same_email"
                log["match_confidence"] = row.match_confidence

    def get_pending_logs(self, scope=None) -> List[Dict[str, Any]]:
        """Get logs needing manual review"""
        return self.get_logs(status="pending", scope=scope)

    def get_stats(self, scope=None) -> Dict[str, int]:
        """Get ingestion statistics"""
        session = self._get_readonly_session()
        try:
            from app.domains.email_ingestion.repository import get_email_ingestion_log_repository
            repo = get_email_ingestion_log_repository(session)
            return repo.get_stats(scope=scope)
        finally:
            session.close()

    def manual_assign(self, log_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Manually assign a pending log to a client/claim and file the
        previously-stored PDF on it as data["document_type"]. An insurance
        estimate also creates the ClaimNegotiation revision."""
        from types import SimpleNamespace

        session = self._get_session()
        try:
            from app.domains.email_ingestion.repository import get_email_ingestion_log_repository
            from app.domains.email_ingestion.models import EmailIngestionLog

            log_repo = get_email_ingestion_log_repository(session)
            log = session.query(EmailIngestionLog).filter(
                EmailIngestionLog.id == log_id
            ).first()

            if not log:
                raise ValueError("Log not found")

            if not log.file_id:
                raise ValueError("No stored PDF found for this log; cannot upload")

            client_id = str(data["client_id"])
            claim_id = data.get("claim_id")
            reviewed_by = data.get("reviewed_by")
            document_type = data.get("document_type") or ESTIMATE_DOCUMENT_TYPE

            # Create claim if requested
            claim_created = False
            if data.get("create_claim") and not claim_id:
                from app.domains.client.models import Claim
                claim_number = data.get("claim_number") or f"MANUAL-{datetime.now().strftime('%Y%m%d%H%M%S')}"
                claim = Claim(
                    client_id=client_id,
                    claim_number=claim_number,
                    status="open",
                    notes="Created during manual email assignment",
                )
                session.add(claim)
                session.flush()
                claim_id = str(claim.id)
                claim_created = True
                # The company whose mailbox got the email works the claim,
                # so its staff can see the claim they just made
                if log.email_account and log.email_account.company_id:
                    from app.domains.client.claim_companies import add_claim_company
                    add_claim_company(session, claim_id, log.email_account.company_id)

            if claim_id:
                claim_id = str(claim_id)

            # Reconstruct just the fields _upload_and_create_negotiation needs,
            # without building a real FetchedEmail (no attachment data required
            # since the file was already uploaded in _store_attachment_file).
            fetched_email_stub = SimpleNamespace(
                subject=log.subject,
                sender=log.sender,
                received_at=log.received_at,
            )

            try:
                if document_type == ESTIMATE_DOCUMENT_TYPE:
                    file_id, negotiation_id = self._upload_and_create_negotiation(
                        session,
                        claim_id,
                        attachment=None,
                        fetched_email=fetched_email_stub,
                        existing_file_id=log.file_id,
                    )
                else:
                    file_id = self._file_claim_document(
                        session, claim_id, log.file_id, document_type
                    )
                    negotiation_id = None
            except Exception as e:
                logger.error(f"manual_assign failed to finalize negotiation for log {log_id}: {e}")
                log.status = "failed"
                log.error_message = str(e)
                session.commit()
                raise

            # Update log
            log.matched_client_id = client_id
            log.matched_claim_id = claim_id
            log.match_method = "manual"
            log.match_confidence = 100
            log.claim_created = claim_created
            log.reviewed_by = reviewed_by
            log.reviewed_at = datetime.now(timezone.utc)
            log.status = "uploaded"
            log.file_id = file_id
            log.negotiation_id = negotiation_id

            session.commit()

            result = log_repo._convert_to_dict(log)
            result["document_type"] = document_type
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def skip_log(self, log_id: str, reason: str, reviewed_by: Optional[str] = None) -> Dict[str, Any]:
        """Mark a log as skipped"""
        session = self._get_session()
        try:
            from app.domains.email_ingestion.models import EmailIngestionLog
            from app.domains.email_ingestion.repository import get_email_ingestion_log_repository

            log = session.query(EmailIngestionLog).filter(
                EmailIngestionLog.id == log_id
            ).first()

            if not log:
                raise ValueError("Log not found")

            log.status = "skipped"
            log.skip_reason = reason
            log.reviewed_by = reviewed_by
            log.reviewed_at = datetime.now(timezone.utc)

            session.commit()

            repo = get_email_ingestion_log_repository(session)
            return repo._convert_to_dict(log)
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()
