"""
SMTP Email Sending Service.
Handles outbound email delivery via SMTP with support for Gmail, Outlook, and custom servers.
"""

import logging
import smtplib
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, make_msgid
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
        msg = self._build_message(
            from_address=from_address,
            to_addresses=to_addresses,
            cc_addresses=cc_addresses,
            subject=subject,
            body_html=body_html,
            attachments=attachments,
            reply_to=reply_to,
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

            if smtp_config.get("username") and smtp_config.get("password"):
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
            "server": getattr(settings, "SMTP_SERVER", "smtp.gmail.com"),
            "port": int(getattr(settings, "SMTP_PORT", 587)),
            "use_tls": getattr(settings, "SMTP_USE_TLS", True),
            "username": getattr(settings, "SMTP_USERNAME", None),
            "password": getattr(settings, "SMTP_PASSWORD", None),
        }

    def _get_account_smtp_config(self, account_id: str) -> Dict[str, Any]:
        """Get SMTP config from an EmailAccount (reuses IMAP credentials)"""
        from app.core.database_factory import get_database
        from app.domains.email_ingestion.repository import get_email_account_repository
        from app.domains.email_ingestion.service import decrypt_password

        database = get_database()
        session = database.get_readonly_session()
        try:
            repo = get_email_account_repository(session)
            account = repo.get_by_id(account_id)
            if not account:
                raise ValueError(f"Email account {account_id} not found")

            provider = account.get("provider_type", "gmail")
            preset = SMTP_PROVIDERS.get(provider, SMTP_PROVIDERS["gmail"])

            # Decrypt the password
            password = decrypt_password(account["encrypted_password"])

            return {
                "server": preset["server"],
                "port": preset["port"],
                "use_tls": preset["use_tls"],
                "username": account["username"],
                "password": password,
            }
        finally:
            session.close()

    def _build_message(
        self,
        from_address: str,
        to_addresses: List[str],
        cc_addresses: List[str],
        subject: str,
        body_html: str,
        attachments: List[Dict[str, Any]],
        reply_to: Optional[str] = None,
    ) -> MIMEMultipart:
        """Build MIME message"""
        msg = MIMEMultipart("mixed")
        msg["From"] = from_address
        msg["To"] = ", ".join(to_addresses)
        if cc_addresses:
            msg["Cc"] = ", ".join(cc_addresses)
        msg["Subject"] = subject
        msg["Message-ID"] = make_msgid()

        if reply_to:
            msg["Reply-To"] = reply_to

        # Body
        body_part = MIMEMultipart("alternative")
        # Plain text fallback (strip HTML tags)
        import re
        plain_text = re.sub(r'<[^>]+>', '', body_html)
        plain_text = re.sub(r'\s+', ' ', plain_text).strip()
        body_part.attach(MIMEText(plain_text, "plain", "utf-8"))
        body_part.attach(MIMEText(body_html, "html", "utf-8"))
        msg.attach(body_part)

        # Attachments
        for attachment in attachments:
            self._attach_file(msg, attachment)

        return msg

    def _attach_file(self, msg: MIMEMultipart, attachment: Dict[str, Any]) -> None:
        """Attach a file to the message"""
        file_id = attachment.get("file_id")
        filename = attachment.get("filename", "attachment")
        mime_type = attachment.get("mime_type", "application/octet-stream")

        if not file_id:
            return

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
                    return
                file_url = file_rec.url or ''
            finally:
                session.close()
            file_data = None

            if file_url.startswith('gs://') or file_url.startswith('https://') or file_url.startswith('http://'):
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
            else:
                logger.warning(f"No file data for file_id={file_id}")
        except Exception as e:
            logger.warning(f"Could not attach file {file_id}: {e}")


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
