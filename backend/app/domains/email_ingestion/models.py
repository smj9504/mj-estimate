"""
Email Ingestion domain models.
Manages email accounts for polling and tracks ingestion history.
"""

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType


class EmailAccount(Base, BaseModel):
    """Email account configuration for IMAP polling"""
    __tablename__ = "email_accounts"
    __table_args__ = (
        Index("ix_email_accounts_company_id", "company_id"),
        {"extend_existing": True},
    )

    company_id = Column(UUIDType(), ForeignKey("companies.id"), nullable=True)

    # Display
    display_name = Column(String(255), nullable=False)
    email_address = Column(String(255), nullable=False, unique=True)

    # Provider preset: gmail, outlook, yahoo, custom
    provider_type = Column(String(50), nullable=False, default="gmail")

    # IMAP connection
    imap_server = Column(String(255), nullable=False, default="imap.gmail.com")
    imap_port = Column(Integer, nullable=False, default=993)
    use_ssl = Column(Boolean, nullable=False, default=True)

    # Custom SMTP connection (send-only providers like Resend that have no
    # IMAP endpoint - imap_server/imap_port above stay dummy values and
    # auto_schedule stays null so polling never runs for these accounts).
    # Null means "use the provider_type preset in SMTP_PROVIDERS" as before.
    smtp_server = Column(String(255), nullable=True)
    smtp_port = Column(Integer, nullable=True)

    # Credentials (password is Fernet-encrypted)
    username = Column(String(255), nullable=False)
    encrypted_password = Column(Text, nullable=False)

    # Sender identity (for email signature)
    sender_name = Column(String(255), nullable=True, comment="Sender full name for signature")
    sender_phone = Column(String(50), nullable=True, comment="Sender phone for signature")

    # OAuth 2.0 (alternative to password auth)
    auth_method = Column(String(20), nullable=False, default="password", comment="password | oauth")
    oauth_access_token = Column(Text, nullable=True, comment="Encrypted OAuth access token")
    oauth_refresh_token = Column(Text, nullable=True, comment="Encrypted OAuth refresh token")
    oauth_token_expiry = Column(DateTime(timezone=True), nullable=True)

    # Capabilities
    can_send = Column(Boolean, nullable=False, default=True, comment="Show in From selector for outbound emails")

    # State
    is_active = Column(Boolean, nullable=False, default=True)
    last_synced_at = Column(DateTime(timezone=True), nullable=True)

    # Auto-schedule: cron expression or null for manual-only
    # e.g. "0 9 * * *" for daily 9 AM, null for manual only
    auto_schedule = Column(String(100), nullable=True)

    # Relationships
    ingestion_logs = relationship(
        "EmailIngestionLog",
        back_populates="email_account",
        cascade="all, delete-orphan",
        lazy="select",
    )


class EmailIngestionLog(Base, BaseModel):
    """Tracks each email attachment processing attempt"""
    __tablename__ = "email_ingestion_logs"
    __table_args__ = (
        Index("ix_email_ingestion_logs_account_id", "email_account_id"),
        Index("ix_email_ingestion_logs_status", "status"),
        # Composite unique per-attachment (not per-email): an email with
        # multiple PDFs where only one fails should let that one attachment
        # be retried on the next poll without re-processing the rest.
        Index("ix_email_ingestion_logs_msgid_hash", "message_id", "attachment_hash", unique=True),
        Index("ix_email_ingestion_logs_attachment_hash", "attachment_hash"),
        {"extend_existing": True},
    )

    email_account_id = Column(
        UUIDType(),
        ForeignKey("email_accounts.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Email identification (RFC 2822 Message-ID). Uniqueness is enforced
    # per-attachment via the (message_id, attachment_hash) composite index
    # above, not on this column alone - an email can have multiple PDFs.
    message_id = Column(String(500), nullable=False)

    # Email metadata
    subject = Column(Text, nullable=True)
    sender = Column(String(500), nullable=True)
    received_at = Column(DateTime(timezone=True), nullable=True)

    # Attachment info
    attachment_name = Column(String(500), nullable=True)
    attachment_hash = Column(String(64), nullable=True)  # SHA-256 hex digest

    # Processing status
    # pending | uploaded | skipped | failed | duplicate
    status = Column(String(50), nullable=False, default="pending")

    # Classification result
    is_insurance_estimate = Column(Boolean, nullable=True)
    classification_reason = Column(Text, nullable=True)

    # Matching result
    matched_client_id = Column(UUIDType(), ForeignKey("clients.id", ondelete="SET NULL"), nullable=True)
    matched_claim_id = Column(UUIDType(), ForeignKey("claims.id", ondelete="SET NULL"), nullable=True)
    match_method = Column(String(100), nullable=True)  # claim_number, policy_number, address, name, manual
    match_confidence = Column(Integer, nullable=True)  # 0-100

    # Outcome
    claim_created = Column(Boolean, nullable=False, default=False)
    negotiation_id = Column(UUIDType(), nullable=True)  # Created ClaimNegotiation ID
    file_id = Column(String(255), nullable=True)  # Uploaded File ID

    # Skip / error info
    skip_reason = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)

    # Manual review
    reviewed_by = Column(String(255), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    email_account = relationship("EmailAccount", back_populates="ingestion_logs")
