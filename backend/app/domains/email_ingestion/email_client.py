"""
IMAP email client for fetching emails with attachments.
Supports Gmail, Outlook, Yahoo, and custom IMAP servers.
"""

import email
import hashlib
import imaplib
import logging
from dataclasses import dataclass, field
from datetime import datetime
from email.header import decode_header
from email.utils import parsedate_to_datetime
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)


@dataclass
class EmailAttachment:
    """Represents an email attachment"""
    filename: str
    content_type: str
    data: bytes
    sha256_hash: str = ""

    def __post_init__(self):
        if not self.sha256_hash and self.data:
            self.sha256_hash = hashlib.sha256(self.data).hexdigest()


@dataclass
class FetchedEmail:
    """Represents a fetched email with metadata and attachments"""
    message_id: str
    subject: str
    sender: str
    received_at: Optional[datetime]
    body_text: str
    body_html: str
    attachments: List[EmailAttachment] = field(default_factory=list)

    @property
    def pdf_attachments(self) -> List[EmailAttachment]:
        """Filter for PDF attachments only"""
        return [
            att for att in self.attachments
            if att.content_type == "application/pdf"
            or att.filename.lower().endswith(".pdf")
        ]


def _decode_header_value(value: str) -> str:
    """Decode RFC 2047 encoded header value"""
    if not value:
        return ""
    decoded_parts = decode_header(value)
    result = []
    for part, charset in decoded_parts:
        if isinstance(part, bytes):
            result.append(part.decode(charset or "utf-8", errors="replace"))
        else:
            result.append(part)
    return " ".join(result)


def _extract_body(msg: email.message.Message) -> Tuple[str, str]:
    """Extract plain text and HTML body from email message"""
    text_body = ""
    html_body = ""

    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get("Content-Disposition", ""))

            # Skip attachments
            if "attachment" in content_disposition:
                continue

            try:
                payload = part.get_payload(decode=True)
                if payload is None:
                    continue
                charset = part.get_content_charset() or "utf-8"
                decoded = payload.decode(charset, errors="replace")
            except Exception:
                continue

            if content_type == "text/plain" and not text_body:
                text_body = decoded
            elif content_type == "text/html" and not html_body:
                html_body = decoded
    else:
        try:
            payload = msg.get_payload(decode=True)
            if payload:
                charset = msg.get_content_charset() or "utf-8"
                decoded = payload.decode(charset, errors="replace")
                if msg.get_content_type() == "text/html":
                    html_body = decoded
                else:
                    text_body = decoded
        except Exception:
            pass

    return text_body, html_body


def _extract_attachments(msg: email.message.Message, max_size_mb: int = 50) -> List[EmailAttachment]:
    """Extract attachments from email message"""
    attachments = []
    max_size = max_size_mb * 1024 * 1024

    for part in msg.walk():
        content_disposition = str(part.get("Content-Disposition", ""))
        if "attachment" not in content_disposition and part.get_content_maintype() != "application":
            continue

        filename = part.get_filename()
        if not filename:
            continue

        filename = _decode_header_value(filename)
        content_type = part.get_content_type()

        try:
            data = part.get_payload(decode=True)
            if data is None or len(data) > max_size:
                continue

            attachments.append(EmailAttachment(
                filename=filename,
                content_type=content_type,
                data=data,
            ))
        except Exception as e:
            logger.warning(f"Failed to extract attachment {filename}: {e}")

    return attachments


class IMAPClient:
    """IMAP client for fetching emails from a mailbox"""

    def __init__(
        self,
        server: str,
        port: int,
        username: str,
        password: str,
        use_ssl: bool = True,
    ):
        self.server = server
        self.port = port
        self.username = username
        self.password = password
        self.use_ssl = use_ssl
        self._connection: Optional[imaplib.IMAP4] = None

    def connect(self) -> None:
        """Establish IMAP connection and login"""
        if self.use_ssl:
            self._connection = imaplib.IMAP4_SSL(self.server, self.port)
        else:
            self._connection = imaplib.IMAP4(self.server, self.port)
        self._connection.login(self.username, self.password)

    def disconnect(self) -> None:
        """Close IMAP connection"""
        if self._connection:
            try:
                self._connection.logout()
            except Exception:
                pass
            self._connection = None

    def test_connection(self) -> Tuple[bool, str, Optional[int]]:
        """Test connection and return (success, message, inbox_count)"""
        try:
            self.connect()
            status, data = self._connection.select("INBOX", readonly=True)
            if status != "OK":
                return False, f"Cannot access INBOX: {status}", None
            inbox_count = int(data[0])
            self.disconnect()
            return True, "Connection successful", inbox_count
        except imaplib.IMAP4.error as e:
            return False, f"IMAP error: {str(e)}", None
        except Exception as e:
            return False, f"Connection failed: {str(e)}", None
        finally:
            self.disconnect()

    def fetch_unseen_with_attachments(
        self,
        since_date: Optional[datetime] = None,
        limit: int = 50,
    ) -> List[FetchedEmail]:
        """
        Fetch unseen emails that have attachments.
        Returns list of FetchedEmail objects.
        """
        results = []

        try:
            self.connect()
            self._connection.select("INBOX")

            # Build search criteria
            criteria = ["UNSEEN"]
            if since_date:
                date_str = since_date.strftime("%d-%b-%Y")
                criteria.append(f'SINCE {date_str}')

            search_query = f'({" ".join(criteria)})'
            status, message_ids = self._connection.search(None, search_query)

            if status != "OK" or not message_ids[0]:
                return results

            ids = message_ids[0].split()
            # Process most recent first, limit count
            ids = ids[-limit:]

            for msg_id in ids:
                try:
                    fetched = self._fetch_single(msg_id)
                    if fetched and fetched.attachments:
                        results.append(fetched)
                except Exception as e:
                    logger.warning(f"Failed to fetch email {msg_id}: {e}")
                    continue

        except Exception as e:
            logger.error(f"Error fetching emails: {e}")
            raise
        finally:
            self.disconnect()

        return results

    def _fetch_single(self, msg_id: bytes) -> Optional[FetchedEmail]:
        """Fetch a single email by its IMAP sequence ID"""
        status, data = self._connection.fetch(msg_id, "(RFC822)")
        if status != "OK" or not data or not data[0]:
            return None

        raw = data[0][1]
        msg = email.message_from_bytes(raw)

        # Extract Message-ID
        message_id = msg.get("Message-ID", "").strip()
        if not message_id:
            # Generate fallback from date + subject hash
            fallback = f"{msg.get('Date', '')}-{msg.get('Subject', '')}"
            message_id = f"<{hashlib.md5(fallback.encode()).hexdigest()}@fallback>"

        subject = _decode_header_value(msg.get("Subject", ""))
        sender = _decode_header_value(msg.get("From", ""))

        # Parse received date
        received_at = None
        date_str = msg.get("Date")
        if date_str:
            try:
                received_at = parsedate_to_datetime(date_str)
            except Exception:
                pass

        text_body, html_body = _extract_body(msg)
        attachments = _extract_attachments(msg)

        return FetchedEmail(
            message_id=message_id,
            subject=subject,
            sender=sender,
            received_at=received_at,
            body_text=text_body,
            body_html=html_body,
            attachments=attachments,
        )

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.disconnect()
