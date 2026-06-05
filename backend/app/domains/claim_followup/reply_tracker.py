"""
Automatic Reply Tracker.

Polls IMAP inboxes for replies to sent follow-up emails and
auto-updates SentEmail, FollowUpTask, CommunicationLog, and ClaimActivity.
"""

import imaplib
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


def _extract_reply_body(full_text: str) -> str:
    """Extract only the new reply content, stripping quoted original message."""
    # Common reply separators
    separators = [
        r"\n-{3,}\s*Original Message\s*-{3,}",
        r"\nOn .+ wrote:",
        r"\n>{2,}",
        r"\n_{3,}",
        r"\nFrom:\s+.+\nSent:\s+",
    ]
    for sep in separators:
        match = re.search(sep, full_text, re.IGNORECASE)
        if match:
            return full_text[: match.start()].strip()
    # If no separator found, return first 500 chars
    return full_text[:500].strip() if len(full_text) > 500 else full_text.strip()


def _truncate(text: str, max_len: int = 500) -> str:
    if not text:
        return ""
    return text[:max_len] + "..." if len(text) > max_len else text


class ReplyTracker:
    """Checks IMAP inboxes for replies to sent follow-up emails."""

    def __init__(self, database=None):
        from app.core.database_factory import get_database
        self.database = database or get_database()

    def check_replies(self, account_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Main entry point: check for replies across email accounts.

        If account_id is provided, only check that account.
        Otherwise, check all active accounts.

        Returns stats dict with matched/checked counts.
        """
        from app.domains.email_ingestion.service import EmailIngestionService

        ingestion_service = EmailIngestionService(self.database)

        if account_id:
            accounts = [ingestion_service.get_account(account_id)]
            accounts = [a for a in accounts if a]
        else:
            accounts = ingestion_service.get_accounts()

        if not accounts:
            return {"accounts_checked": 0, "replies_found": 0, "errors": []}

        total_found = 0
        errors = []

        for account in accounts:
            try:
                found = self._check_account(account)
                total_found += found
            except Exception as e:
                import traceback
                tb = traceback.format_exc()
                err_msg = repr(e)
                logger.error(
                    f"Reply check failed for "
                    f"{account['email_address']}: {err_msg}\n{tb}"
                )
                errors.append({
                    "account": account["email_address"],
                    "error": err_msg,
                    "traceback": tb,
                })

        return {
            "accounts_checked": len(accounts),
            "replies_found": total_found,
            "errors": errors,
        }

    def _check_account(self, account: Dict[str, Any]) -> int:
        """Check a single email account for replies. Returns count of replies found."""
        from app.domains.email_ingestion.email_client import IMAPClient
        from app.domains.email_ingestion.service import decrypt_password

        session = self.database.get_session()
        try:
            # Get unreplied sent emails that used this account (or system default)
            unreplied = self._get_unreplied_emails(session, account["id"])
            logger.info(
                f"[ReplyTracker] Account {account['email_address']}: "
                f"{len(unreplied)} unreplied sent emails found"
            )
            if not unreplied:
                return 0

            # Build message_id -> sent_email mapping
            msg_id_map: Dict[str, Dict] = {}
            for sent in unreplied:
                mid = sent.get("smtp_message_id")
                if mid:
                    msg_id_map[mid] = sent

            # Build subject -> sent_email mapping for fallback matching
            subject_map: Dict[str, List[Dict]] = {}
            for sent in unreplied:
                subj = (sent.get("subject") or "").strip().lower()
                if subj:
                    subject_map.setdefault(subj, []).append(sent)

            logger.info(
                f"[ReplyTracker] {len(msg_id_map)} with smtp_message_id, "
                f"{len(subject_map)} unique subjects "
                f"(out of {len(unreplied)} unreplied)"
            )

            # Need at least one matching strategy
            if not msg_id_map and not subject_map:
                return 0

            # Connect to IMAP and search for replies
            password = decrypt_password(account["encrypted_password"])
            imap = IMAPClient(
                server=account["imap_server"],
                port=account["imap_port"],
                username=account["username"],
                password=password,
                use_ssl=account["use_ssl"],
            )

            # Search within last 30 days
            since = datetime.now(timezone.utc) - timedelta(days=30)

            found = 0

            try:
                # Strategy 1: Header-based matching (smtp_message_id)
                if msg_id_map:
                    replies = imap.fetch_replies(
                        original_message_ids=list(msg_id_map.keys()),
                        since_date=since,
                    )
                    logger.info(
                        f"[ReplyTracker] Header search returned "
                        f"{len(replies)} candidate replies"
                    )
                    for reply in replies:
                        matched = self._match_reply_to_sent(
                            reply, msg_id_map
                        )
                        if matched:
                            self._process_reply(session, matched, reply)
                            found += 1

                # Strategy 2: Subject-based matching for emails without
                # smtp_message_id (older emails or failed tracking)
                if subject_map:
                    subject_replies = imap.fetch_replies_by_subject(
                        subjects=list(subject_map.keys()),
                        since_date=since,
                    )
                    logger.info(
                        f"[ReplyTracker] Subject search returned "
                        f"{len(subject_replies)} candidate replies"
                    )
                    for reply in subject_replies:
                        matched = self._match_reply_by_subject(
                            reply, subject_map, unreplied
                        )
                        if matched:
                            self._process_reply(session, matched, reply)
                            found += 1

            except imaplib.IMAP4.error as imap_err:
                err_bytes = imap_err.args[0] if imap_err.args else b""
                err_str = (
                    err_bytes.decode() if isinstance(err_bytes, bytes)
                    else str(err_bytes)
                )
                if "AUTHENTICATIONFAILED" in err_str or "Invalid credentials" in err_str:
                    logger.warning(
                        f"[ReplyTracker] Authentication failed for "
                        f"{account['email_address']} — disabling account. "
                        f"Please update credentials in email settings."
                    )
                    self._disable_account(session, account["id"])
                    session.commit()
                    return 0
                raise

            session.commit()
            logger.info(
                f"[ReplyTracker] Account {account['email_address']}: "
                f"{len(unreplied)} unreplied, {found} replies matched"
            )
            return found

        except Exception as e:
            session.rollback()
            logger.error(
                f"[ReplyTracker] Error checking "
                f"{account['email_address']}: {e}",
                exc_info=True,
            )
            raise
        finally:
            session.close()

    def _disable_account(self, session, account_id: str) -> None:
        """Disable an email account after authentication failure."""
        try:
            from app.domains.email_ingestion.models import EmailAccount
            account = session.query(EmailAccount).filter(
                EmailAccount.id == account_id
            ).first()
            if account:
                account.is_active = False
                logger.info(
                    f"[ReplyTracker] Account {account_id} disabled "
                    f"due to authentication failure"
                )
        except Exception as e:
            logger.warning(f"[ReplyTracker] Could not disable account: {e}")

    def _get_unreplied_emails(
        self, session, account_id: str
    ) -> List[Dict[str, Any]]:
        """Get sent emails that haven't received a reply yet.

        Matches emails sent from this account OR emails with no
        account_id (system-level sends). Includes emails both with
        and without smtp_message_id for subject-based fallback matching.
        """
        from app.domains.claim_followup.models import SentEmail
        from sqlalchemy import or_

        cutoff = datetime.now(timezone.utc) - timedelta(days=60)

        rows = (
            session.query(SentEmail)
            .filter(
                SentEmail.status == "sent",
                SentEmail.reply_received == False,  # noqa: E712
                SentEmail.sent_at >= cutoff,
            )
            .filter(
                or_(
                    SentEmail.email_account_id == account_id,
                    SentEmail.email_account_id.is_(None),
                )
            )
            .order_by(SentEmail.sent_at.desc())
            .limit(200)
            .all()
        )

        results = []
        for row in rows:
            results.append({
                "id": str(row.id),
                "claim_id": str(row.claim_id) if row.claim_id else None,
                "followup_task_id": str(row.followup_task_id) if row.followup_task_id else None,
                "smtp_message_id": row.smtp_message_id,
                "subject": row.subject,
                "to_addresses": row.to_addresses or [],
                "from_address": row.from_address,
                "sent_at": row.sent_at,
            })
        return results

    def _match_reply_to_sent(
        self, reply, msg_id_map: Dict[str, Dict]
    ) -> Optional[Dict]:
        """Match an incoming reply to its original sent email."""
        # Primary: In-Reply-To header matches our Message-ID
        if reply.in_reply_to and reply.in_reply_to in msg_id_map:
            return msg_id_map[reply.in_reply_to]

        # Secondary: References header contains our Message-ID
        if reply.references:
            for mid in msg_id_map:
                if mid in reply.references:
                    return msg_id_map[mid]

        return None

    def _match_reply_by_subject(
        self,
        reply,
        subject_map: Dict[str, List[Dict]],
        unreplied: List[Dict],
    ) -> Optional[Dict]:
        """Match a reply by subject line + sender address.

        Strips common reply prefixes (Re:, Fwd:, etc.) and checks
        if the reply sender was one of our original recipients.
        """
        reply_subject = (reply.subject or "").strip().lower()
        # Strip reply/forward prefixes
        cleaned = re.sub(
            r'^(re|fw|fwd)\s*:\s*', '', reply_subject, flags=re.IGNORECASE
        ).strip()

        candidates = subject_map.get(cleaned, [])
        if not candidates:
            return None

        reply_sender = (reply.sender or "").lower()
        for sent in candidates:
            # Already processed?
            if sent.get("_matched"):
                continue
            # Check: reply sender should be one of our TO recipients
            to_addrs = [
                a.lower() for a in (sent.get("to_addresses") or [])
            ]
            if any(addr in reply_sender for addr in to_addrs):
                sent["_matched"] = True
                return sent

        return None

    def _process_reply(self, session, sent_email: Dict, reply) -> None:
        """Process a matched reply: update SentEmail, Task, CommunicationLog, Activity."""
        from app.domains.claim_followup.models import (
            CommunicationLog,
            FollowUpTask as FollowUpTaskModel,
            SentEmail,
        )

        email_id = sent_email["id"]

        # Check if already processed (race condition guard)
        email_obj = session.query(SentEmail).filter(SentEmail.id == email_id).first()
        if not email_obj or email_obj.reply_received:
            return

        # Extract reply content
        reply_text = _extract_reply_body(reply.body_text or "")
        reply_summary = _truncate(reply_text)
        reply_time = reply.received_at or datetime.now(timezone.utc)

        # 1. Update SentEmail
        email_obj.reply_received = True
        email_obj.reply_received_at = reply_time
        email_obj.reply_summary = reply_summary

        # 2. Update FollowUpTask status
        if email_obj.followup_task_id:
            task = session.query(FollowUpTaskModel).filter(
                FollowUpTaskModel.id == email_obj.followup_task_id
            ).first()
            if task and task.status in ("pending", "awaiting_response"):
                task.status = "responded"

        # 3. Create inbound CommunicationLog
        comm_log = CommunicationLog(
            followup_task_id=email_obj.followup_task_id,
            claim_id=email_obj.claim_id,
            communication_type="email",
            direction="inbound",
            contact_email=reply.sender,
            subject=reply.subject or f"Re: {email_obj.subject}",
            summary=reply_summary or "Reply received (auto-detected).",
            response_received=True,
            response_date=reply_time,
            response_summary=reply_summary,
            sent_email_id=email_obj.id,
        )
        session.add(comm_log)

        # 4. Log ClaimActivity
        try:
            from app.domains.client.models import ClaimActivity
            session.add(ClaimActivity(
                claim_id=email_obj.claim_id,
                activity_type="reply_received",
                title=f"Reply auto-detected from {reply.sender}",
                description=reply_summary or f"Reply to: {email_obj.subject}",
                related_entity_type="sent_email",
                related_entity_id=email_obj.id,
            ))
        except Exception as e:
            logger.warning(f"Failed to log ClaimActivity for auto-reply: {e}")

        # 5. Update linked SupplementFollowUp if exists
        try:
            from app.domains.supplement.models import SupplementFollowUp
            sup_followup = session.query(SupplementFollowUp).filter(
                SupplementFollowUp.sent_email_id == email_id
            ).first()
            if sup_followup:
                sup_followup.response_received = True
                sup_followup.response_date = reply_time
                sup_followup.response_summary = reply_summary
                sup_followup.reply_body_html = reply.body_html or reply.body_text or ""
                sup_followup.info_status = "resolved"
                logger.info(
                    f"Auto-updated SupplementFollowUp {sup_followup.id} "
                    f"with reply from {reply.sender}"
                )
        except Exception as e:
            logger.warning(f"Failed to update SupplementFollowUp for reply: {e}")

        session.flush()
        logger.info(
            f"Auto-detected reply for email {email_id} from {reply.sender}"
        )
