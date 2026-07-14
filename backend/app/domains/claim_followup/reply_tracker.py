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
    # Common reply separators (with or without leading newline)
    separators = [
        r"\n?-{3,}\s*Original Message\s*-{3,}",
        r"\n?On .+wrote\s*:",
        r"\n>{2,}",
        r"\n?_{3,}",
        r"\n?From:\s+.+\nSent:\s+",
        r"\n?On \d{1,2}/\d{1,2}/\d{2,4}.+wrote\s*:",  # On 06/05/2026 ... wrote:
    ]
    for sep in separators:
        match = re.search(sep, full_text, re.IGNORECASE)
        if match:
            result = full_text[: match.start()].strip()
            if result:
                return result
    # If no separator found, return first 500 chars
    return full_text[:500].strip() if len(full_text) > 500 else full_text.strip()


def _extract_reply_html(full_html: str) -> str:
    """Extract only the new reply content from HTML, stripping quoted original."""
    if not full_html:
        return ""
    # Gmail wraps quoted content in <div class="gmail_quote">
    gmail_quote = re.search(r'<div\s+class="gmail_quote"', full_html, re.IGNORECASE)
    if gmail_quote:
        return full_html[: gmail_quote.start()].strip()
    # Outlook uses <div id="appendonsend"> or <hr> before quoted
    outlook_sep = re.search(r'<div\s+id="appendonsend"|<hr\s*/?\s*>', full_html, re.IGNORECASE)
    if outlook_sep:
        return full_html[: outlook_sep.start()].strip()
    # Generic: <blockquote> wraps quoted content
    blockquote = re.search(r'<blockquote', full_html, re.IGNORECASE)
    if blockquote:
        return full_html[: blockquote.start()].strip()
    # Fallback: "On ... wrote:" pattern in HTML
    on_wrote = re.search(r'On .+wrote\s*:', full_html, re.IGNORECASE)
    if on_wrote:
        return full_html[: on_wrote.start()].strip()
    return full_html


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

            # Connect to IMAP and search for replies (single connection)
            auth_method = account.get("auth_method", "password")
            oauth_token = None
            password = ""
            if auth_method == "oauth":
                from app.domains.claim_followup.smtp_service import (
                    SmtpService,
                )
                smtp = SmtpService()
                oauth_token = smtp._get_fresh_oauth_token(
                    account, session
                )
            else:
                password = decrypt_password(
                    account["encrypted_password"]
                )
            imap = IMAPClient(
                server=account["imap_server"],
                port=account["imap_port"],
                username=account["username"],
                password=password,
                use_ssl=account["use_ssl"],
                oauth_access_token=oauth_token,
                timeout=30,
            )

            # Search within last 30 days
            since = datetime.now(timezone.utc) - timedelta(days=30)

            found = 0

            try:
                # Use a single IMAP connection for both strategies
                imap.connect()
                imap._connection.select("INBOX", readonly=True)

                # Strategy 1: Header-based matching (smtp_message_id)
                if msg_id_map:
                    header_results = self._search_by_headers(
                        imap, list(msg_id_map.keys()), since
                    )
                    logger.info(
                        f"[ReplyTracker] Header search returned "
                        f"{len(header_results)} candidate replies"
                    )
                    for reply in header_results:
                        matched = self._match_reply_to_sent(
                            reply, msg_id_map
                        )
                        if matched:
                            self._process_reply(session, matched, reply)
                            found += 1

                # Strategy 2: Subject-based matching (reuse same connection)
                if subject_map:
                    subject_results = self._search_by_subject(
                        imap, list(subject_map.keys()), since
                    )
                    logger.info(
                        f"[ReplyTracker] Subject search returned "
                        f"{len(subject_results)} candidate replies"
                    )
                    for reply in subject_results:
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
            finally:
                imap.disconnect()

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

    def _search_by_headers(self, imap, message_ids, since_date):
        """Search for replies by In-Reply-To/References headers (connection already open)."""
        results = []
        seen = set()
        for orig_id in message_ids:
            try:
                for header in ("In-Reply-To", "References"):
                    status, data = imap._connection.search(
                        None, f'(HEADER "{header}" "{orig_id}")'
                    )
                    if status == "OK" and data[0]:
                        for msg_num in data[0].split():
                            if msg_num in seen:
                                continue
                            seen.add(msg_num)
                            fetched = imap._fetch_headers_only(msg_num)
                            if fetched:
                                results.append(fetched)
            except Exception as e:
                logger.debug(f"Header search failed for {orig_id}: {e}")
        return results

    def _search_by_subject(self, imap, subjects, since_date):
        """Search for replies by subject (connection already open)."""
        results = []
        seen = set()
        date_criteria = ""
        if since_date:
            date_criteria = f' SINCE {since_date.strftime("%d-%b-%Y")}'
        for subj in subjects[:30]:
            try:
                search_subj = subj[:100]
                criteria = f'(SUBJECT "Re: {search_subj}"{date_criteria})'
                status, data = imap._connection.search(None, criteria)
                if status == "OK" and data[0]:
                    for msg_num in data[0].split()[-50:]:
                        if msg_num in seen:
                            continue
                        seen.add(msg_num)
                        fetched = imap._fetch_headers_only(msg_num)
                        if fetched:
                            results.append(fetched)
            except Exception as e:
                logger.debug(f"Subject search failed for '{subj[:50]}': {e}")
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
                raw_html = reply.body_html or reply.body_text or ""
                cleaned_html = _extract_reply_html(raw_html)
                sup_followup.reply_body_html = cleaned_html
                sup_followup.info_status = "awaiting_response"  # keep open for continued conversation
                # Append to conversation thread
                conv = list(sup_followup.conversation or [])
                conv.append({
                    "type": "received",
                    "date": reply_time.isoformat() if reply_time else "",
                    "sender": reply.sender or "",
                    "body_html": cleaned_html,
                    "summary": reply_summary,
                })
                sup_followup.conversation = conv
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
