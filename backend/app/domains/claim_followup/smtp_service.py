"""
SMTP Email Sending Service.
Handles outbound email delivery via SMTP with support for Gmail, Outlook, and custom servers.
"""

import logging
import smtplib
from datetime import datetime, timezone
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, formatdate, make_msgid
from typing import Any, Dict, List, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

# SMTP provider presets
SMTP_PROVIDERS = {
    "gmail": {"server": "smtp.gmail.com", "port": 587, "use_tls": True},
    "outlook": {"server": "smtp.office365.com", "port": 587, "use_tls": True},
    "yahoo": {"server": "smtp.mail.yahoo.com", "port": 587, "use_tls": True},
}


class SmtpService:
    """SMTP email sending service"""

    def send(
        self,
        account_id: Optional[str],
        from_address: str,
        to_addresses: List[str],
        subject: str,
        body_html: str,
        cc_addresses: List[str] = None,
        bcc_addresses: List[str] = None,
        attachments: List[Dict[str, Any]] = None,
        reply_to: Optional[str] = None,
        skip_signature: bool = False,
        display_name_override: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Send an email via SMTP.

        If account_id is provided, uses that account's SMTP credentials.
        Otherwise, uses system-level SMTP settings from environment.
        """
        cc_addresses = cc_addresses or []
        bcc_addresses = bcc_addresses or []
        attachments = attachments or []

        # Get SMTP connection details
        smtp_config = self._get_smtp_config(account_id)

        # Build message
        msg, failed_attachments = self._build_message(
            from_address=from_address,
            to_addresses=to_addresses,
            cc_addresses=cc_addresses,
            subject=subject,
            body_html=body_html,
            attachments=attachments,
            reply_to=reply_to,
            display_name=display_name_override or smtp_config.get("display_name", ""),
            sender_name="" if skip_signature else smtp_config.get("sender_name", ""),
            sender_phone=smtp_config.get("sender_phone", ""),
            email_address=smtp_config.get("email_address", from_address),
            company_name=smtp_config.get("company_name", ""),
        )

        # Fail loudly instead of silently sending without attachments -
        # a "sent" email missing a supplement estimate is worse than a
        # blocked send, since the PA would silently never receive the file.
        if failed_attachments:
            names = ", ".join(failed_attachments)
            raise ValueError(
                f"Failed to attach the following file(s), email not sent: {names}. "
                f"The file(s) may be missing from storage - try re-uploading."
            )

        # Check message size before sending (Gmail limit: 25MB)
        MAX_EMAIL_SIZE_MB = 25
        msg_size = len(msg.as_bytes())
        msg_size_mb = msg_size / (1024 * 1024)
        if msg_size_mb > MAX_EMAIL_SIZE_MB:
            attachment_details = []
            for att in attachments:
                name = att.get("filename", "unknown")
                raw = att.get("data")
                size_info = f"{len(raw) / (1024*1024):.1f}MB" if raw and isinstance(raw, bytes) else "file_id"
                attachment_details.append(f"{name}({size_info})")
            details = ", ".join(attachment_details) if attachment_details else "no details"
            raise ValueError(
                f"Email size ({msg_size_mb:.1f}MB) exceeds Gmail's {MAX_EMAIL_SIZE_MB}MB limit. "
                f"Attachments: {details}. Please reduce the number or size of attachments."
            )

        # Send
        message_id = msg["Message-ID"]
        all_recipients = to_addresses + cc_addresses + bcc_addresses

        try:
            if smtp_config.get("use_tls"):
                server = smtplib.SMTP(smtp_config["server"], smtp_config["port"])
                server.ehlo()
                server.starttls()
                server.ehlo()
            else:
                server = smtplib.SMTP_SSL(smtp_config["server"], smtp_config["port"])

            # Authenticate: OAuth XOAUTH2 or password
            oauth_token = smtp_config.get("oauth_access_token")
            if oauth_token:
                auth_string = (
                    f"user={smtp_config['username']}\x01"
                    f"auth=Bearer {oauth_token}\x01\x01"
                )
                server.docmd("AUTH", "XOAUTH2 " + __import__("base64").b64encode(
                    auth_string.encode()
                ).decode())
            elif smtp_config.get("username") and smtp_config.get("password"):
                server.login(smtp_config["username"], smtp_config["password"])

            server.sendmail(from_address, all_recipients, msg.as_string())
            server.quit()

            logger.info(f"Email sent successfully to {to_addresses}, message_id={message_id}")
            return {"message_id": message_id, "status": "sent"}

        except smtplib.SMTPAuthenticationError as e:
            logger.error(f"SMTP authentication failed: {e}")
            raise ValueError(f"Email authentication failed. Please check your credentials. Error: {e}")
        except smtplib.SMTPRecipientsRefused as e:
            logger.error(f"SMTP recipients refused: {e}")
            raise ValueError(f"Recipients refused: {e}")
        except Exception as e:
            logger.error(f"SMTP send error: {e}")
            raise

    def _get_smtp_config(self, account_id: Optional[str]) -> Dict[str, Any]:
        """Get SMTP configuration for sending"""
        if account_id:
            return self._get_account_smtp_config(account_id)

        # Fallback to system-level SMTP settings
        return {
            "server": getattr(settings, "SMTP_HOST", "smtp.gmail.com"),
            "port": int(getattr(settings, "SMTP_PORT", 587)),
            "use_tls": True,
            "username": getattr(settings, "SMTP_USER", None),
            "password": getattr(settings, "SMTP_PASSWORD", None),
            "display_name": getattr(settings, "SMTP_FROM_NAME", ""),
            "email_address": getattr(settings, "SMTP_FROM_EMAIL", ""),
        }

    def _get_account_smtp_config(self, account_id: str) -> Dict[str, Any]:
        """Get SMTP config from an EmailAccount (reuses IMAP credentials)"""
        from app.core.database_factory import get_database
        from app.domains.email_ingestion.repository import (
            get_email_account_repository,
        )
        from app.domains.email_ingestion.service import decrypt_password

        database = get_database()
        session = database.get_readonly_session()
        try:
            repo = get_email_account_repository(session)
            account = repo.get_by_id(account_id)
            if not account:
                raise ValueError(
                    f"Email account {account_id} not found"
                )

            provider = account.get("provider_type", "gmail")
            preset = SMTP_PROVIDERS.get(
                provider, SMTP_PROVIDERS["gmail"]
            )

            # OAuth or password auth
            auth_method = account.get("auth_method", "password")
            oauth_token = None
            password = None

            if auth_method == "oauth":
                oauth_token = self._get_fresh_oauth_token(
                    account, session
                )
            else:
                password = decrypt_password(
                    account["encrypted_password"]
                )

            # Get company name for signature
            company_name = ""
            if account.get("company_id"):
                try:
                    from app.domains.company.models import Company
                    company = session.query(Company).filter(
                        Company.id == account["company_id"]
                    ).first()
                    if company:
                        company_name = company.name or ""
                except Exception:
                    pass

            return {
                "server": preset["server"],
                "port": preset["port"],
                "use_tls": preset["use_tls"],
                "username": account["username"],
                "password": password,
                "oauth_access_token": oauth_token,
                "display_name": account.get("display_name", ""),
                "sender_name": account.get("sender_name", ""),
                "sender_phone": account.get("sender_phone", ""),
                "email_address": account.get(
                    "email_address", ""
                ),
                "company_name": company_name,
            }
        finally:
            session.close()

    def _get_fresh_oauth_token(
        self, account: Dict[str, Any], session
    ) -> str:
        """Get a fresh OAuth access token, refreshing if expired"""
        from app.core.encryption import decrypt_text
        from datetime import datetime, timezone

        token_expiry = account.get("oauth_token_expiry")
        access_token_enc = account.get("oauth_access_token")
        refresh_token_enc = account.get("oauth_refresh_token")

        if not refresh_token_enc:
            raise ValueError(
                "OAuth refresh token not found. "
                "Please reconnect the account."
            )

        needs_refresh = True
        if access_token_enc and token_expiry:
            if isinstance(token_expiry, str):
                from dateutil.parser import parse
                token_expiry = parse(token_expiry)
            now = datetime.now(timezone.utc)
            if token_expiry.tzinfo is None:
                from datetime import timezone as tz
                token_expiry = token_expiry.replace(
                    tzinfo=tz.utc
                )
            needs_refresh = now >= token_expiry

        if not needs_refresh and access_token_enc:
            return decrypt_text(access_token_enc)

        # Refresh the token
        from app.core.encryption import encrypt_text
        from app.core.config import settings
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request

        refresh_token = decrypt_text(refresh_token_enc)
        creds = Credentials(
            token=None,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=settings.GOOGLE_OAUTH_CLIENT_ID,
            client_secret=settings.GOOGLE_OAUTH_CLIENT_SECRET,
        )
        creds.refresh(Request())

        # Update stored tokens
        from app.domains.email_ingestion.models import (
            EmailAccount,
        )
        acc_obj = session.query(EmailAccount).filter(
            EmailAccount.id == account["id"]
        ).first()
        if acc_obj:
            acc_obj.oauth_access_token = encrypt_text(
                creds.token
            )
            if creds.refresh_token:
                acc_obj.oauth_refresh_token = encrypt_text(
                    creds.refresh_token
                )
            acc_obj.oauth_token_expiry = creds.expiry
            try:
                session.commit()
            except Exception:
                session.rollback()

        return creds.token

    def _build_message(
        self,
        from_address: str,
        to_addresses: List[str],
        cc_addresses: List[str],
        subject: str,
        body_html: str,
        attachments: List[Dict[str, Any]],
        reply_to: Optional[str] = None,
        display_name: str = "",
        sender_name: str = "",
        sender_phone: str = "",
        email_address: str = "",
        company_name: str = "",
    ) -> tuple[MIMEMultipart, List[str]]:
        """Build MIME message with spam-prevention headers and signature.

        Returns (message, failed_attachment_filenames) - callers must check
        the failure list rather than assume every requested attachment made it in.
        """
        # Append email signature if sender info is available
        if sender_name:
            body_html = self._append_signature(
                body_html, sender_name, company_name, sender_phone, email_address
            )

        # Plain text: clean conversion from HTML
        import re
        plain_text = body_html
        plain_text = re.sub(r'<br\s*/?>', '\n', plain_text)
        plain_text = re.sub(r'</p>\s*', '\n\n', plain_text)
        plain_text = re.sub(r'<li[^>]*>', '- ', plain_text)
        plain_text = re.sub(r'</li>', '\n', plain_text)
        plain_text = re.sub(r'<[^>]+>', '', plain_text)
        plain_text = re.sub(r'\n{3,}', '\n\n', plain_text).strip()

        # Use multipart/alternative when no attachments, multipart/mixed when attachments exist
        has_attachments = bool(attachments)
        failed_attachments: List[str] = []
        if has_attachments:
            msg = MIMEMultipart("mixed")
            body_part = MIMEMultipart("alternative")
            body_part.attach(MIMEText(plain_text, "plain", "utf-8"))
            body_part.attach(MIMEText(body_html, "html", "utf-8"))
            msg.attach(body_part)
            for attachment in attachments:
                if not self._attach_file(msg, attachment):
                    failed_attachments.append(attachment.get("filename", "attachment"))
        else:
            msg = MIMEMultipart("alternative")
            msg.attach(MIMEText(plain_text, "plain", "utf-8"))
            msg.attach(MIMEText(body_html, "html", "utf-8"))

        from_header = formataddr((display_name, from_address)) if display_name else from_address
        msg["From"] = from_header
        msg["To"] = ", ".join(to_addresses)
        if cc_addresses:
            msg["Cc"] = ", ".join(cc_addresses)
        msg["Subject"] = subject

        # Required headers to avoid spam classification
        sender_domain = from_address.split("@")[-1] if "@" in from_address else "gmail.com"
        msg["Message-ID"] = make_msgid(domain=sender_domain)
        msg["Date"] = formatdate(localtime=True)
        msg["MIME-Version"] = "1.0"

        # Always set Reply-To for deliverability
        msg["Reply-To"] = reply_to or from_address

        return msg, failed_attachments

    def _append_signature(
        self,
        body_html: str,
        sender_name: str,
        company_name: str = "",
        sender_phone: str = "",
        email_address: str = "",
    ) -> str:
        """Append professional email signature to HTML body."""
        lines = [f"<strong>{sender_name}</strong>"]
        if company_name:
            lines.append(company_name)
        if sender_phone:
            lines.append(sender_phone)
        if email_address:
            lines.append(email_address)

        signature_html = (
            '<div style="margin-top:24px;padding-top:12px;'
            'border-top:1px solid #ddd;font-size:13px;color:#555;'
            'line-height:1.6;">'
            + "<br/>".join(lines)
            + "</div>"
        )
        return body_html + signature_html

    def _attach_file(self, msg: MIMEMultipart, attachment: Dict[str, Any]) -> bool:
        """Attach a file to the message. Returns True if attached, False on failure.

        Supports two modes:
        - file_id: looks up File model and reads from storage
        - data: raw bytes passed directly (for on-the-fly generated PDFs)

        Callers must check the return value - a failure here must not result
        in silently sending the email without the attachment.
        """
        filename = attachment.get("filename", "attachment")

        # Mode 1: Raw bytes provided directly
        raw_data = attachment.get("data")
        if raw_data and isinstance(raw_data, bytes):
            part = MIMEApplication(raw_data, Name=filename)
            part["Content-Disposition"] = f'attachment; filename="{filename}"'
            msg.attach(part)
            logger.info(f"Attached file (raw): {filename} ({len(raw_data)} bytes)")
            return True

        file_id = attachment.get("file_id")
        if not file_id:
            logger.warning(f"Attachment '{filename}' has no file_id or raw data")
            return False

        try:
            from app.domains.file.service import get_storage_provider
            from app.domains.file.models import File as FileModel
            from app.core.database_factory import get_database
            from pathlib import Path

            # Look up the File record to get the storage URL/path
            database = get_database()
            session = database.get_session()
            try:
                file_rec = session.query(FileModel).filter(FileModel.id == file_id).first()
                if not file_rec:
                    logger.warning(f"File record not found for ID: {file_id}")
                    return False
                file_url = file_rec.url or ''
            finally:
                session.close()
            file_data = None

            if file_url.startswith('gs://') or file_url.startswith('b2://') or file_url.startswith('https://') or file_url.startswith('http://'):
                # Cloud storage - download via provider
                storage = get_storage_provider()
                file_data = storage.download(file_url)
            else:
                # Local file
                file_path = Path(file_url)
                if file_path.exists():
                    file_data = file_path.read_bytes()
                else:
                    logger.warning(f"Local file not found: {file_url}")

            if file_data:
                part = MIMEApplication(file_data, Name=filename)
                part["Content-Disposition"] = f'attachment; filename="{filename}"'
                msg.attach(part)
                logger.info(f"Attached file: {filename} ({len(file_data)} bytes)")
                return True
            else:
                logger.warning(f"No file data for file_id={file_id} (url={file_url})")
                return False
        except Exception as e:
            logger.warning(f"Could not attach file '{filename}' (file_id={file_id}): {type(e).__name__}: {e}")
            return False


def test_smtp_connection(account_id: Optional[str] = None) -> Dict[str, Any]:
    """Test SMTP connection without sending an email"""
    service = SmtpService()
    smtp_config = service._get_smtp_config(account_id)

    try:
        if smtp_config.get("use_tls"):
            server = smtplib.SMTP(smtp_config["server"], smtp_config["port"])
            server.ehlo()
            server.starttls()
            server.ehlo()
        else:
            server = smtplib.SMTP_SSL(smtp_config["server"], smtp_config["port"])

        if smtp_config.get("username") and smtp_config.get("password"):
            server.login(smtp_config["username"], smtp_config["password"])

        server.quit()
        return {"success": True, "message": "SMTP connection successful"}
    except Exception as e:
        return {"success": False, "message": str(e)}
