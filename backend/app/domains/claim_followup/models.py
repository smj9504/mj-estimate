"""
Claim Follow-up domain models.
Tracks adjuster communications, follow-up tasks, email templates, and sent emails.
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
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType


class FollowUpTask(Base, BaseModel):
    """
    Follow-up task for insurance claim communication.

    Tracks what needs to be followed up on, when, and current status.
    Types:
    - docs_sent: Documents sent to adjuster (Invoice + COS + EWA + Photo Report)
    - payment_check: Checking if insurance payment was received
    - estimate_request: Requesting rebuild estimate from insurance
    - supplement_sent: Supplement estimate sent to public adjuster
    - general: General follow-up
    """
    __tablename__ = "followup_tasks"
    __table_args__ = (
        Index('ix_followup_tasks_claim', 'claim_id'),
        Index('ix_followup_tasks_status', 'status'),
        Index('ix_followup_tasks_due', 'due_date', 'status'),
        Index('ix_followup_tasks_type_status', 'task_type', 'status'),
        Index('ix_followup_tasks_assigned', 'assigned_to_email'),
        {'extend_existing': True}
    )

    claim_id = Column(
        UUIDType(),
        ForeignKey("claims.id", ondelete="CASCADE"),
        nullable=False,
    )
    wm_job_id = Column(
        UUIDType(),
        ForeignKey("water_mitigation_jobs.id", ondelete="SET NULL"),
        nullable=True,
        comment="Optional link to specific WM job"
    )

    # Task classification
    task_type = Column(
        String(50),
        nullable=False,
        comment="wm_docs_sent | supplement_sent | depreciation_recovery | estimate_request | payment_check | wm_payment_check | docs_sent | general | dispute | appraisal | attorney_referral"
    )
    title = Column(String(500), nullable=False)
    description = Column(Text)

    # Status tracking
    status = Column(
        String(50),
        nullable=False,
        default='pending',
        comment="pending | awaiting_response | responded | resolved | overdue | cancelled"
    )

    # Scheduling
    due_date = Column(DateTime(timezone=True), nullable=True)
    last_contacted_at = Column(DateTime(timezone=True))
    next_followup_date = Column(DateTime(timezone=True))
    contact_count = Column(Integer, default=0, comment="Number of times contacted")

    # Auto follow-up settings
    auto_followup_enabled = Column(Boolean, default=False)
    followup_interval_days = Column(Integer, default=3, comment="Days between auto follow-ups")
    max_followup_count = Column(Integer, default=5, comment="Max auto follow-ups before escalation")

    # Assignment
    assigned_to_name = Column(String(255), comment="Adjuster or PA name")
    assigned_to_email = Column(String(255), comment="Adjuster or PA email")
    assigned_to_phone = Column(String(50))
    assigned_to_role = Column(
        String(50),
        default='adjuster',
        comment="adjuster | public_adjuster | contractor"
    )

    # Priority
    priority = Column(String(20), default='normal', comment="low | normal | high | urgent")

    # Resolution
    resolved_at = Column(DateTime(timezone=True))
    resolution_notes = Column(Text)

    # Audit
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationships
    claim = relationship("Claim", lazy='select')
    communications = relationship(
        "CommunicationLog",
        back_populates="followup_task",
        cascade="all, delete-orphan",
        order_by="CommunicationLog.created_at.desc()"
    )
    sent_emails = relationship(
        "SentEmail",
        back_populates="followup_task",
        cascade="all, delete-orphan",
        order_by="SentEmail.sent_at.desc()"
    )


class EmailTemplate(Base, BaseModel):
    """
    Reusable email templates for follow-up communications.

    Supports variable substitution:
    - {{claim_number}}, {{property_address}}, {{homeowner_name}}
    - {{adjuster_name}}, {{insurance_company}}
    - {{invoice_amount}}, {{documents_sent_date}}
    - {{company_name}}, {{sender_name}}, {{sender_phone}}
    """
    __tablename__ = "email_templates"
    __table_args__ = (
        Index('ix_email_templates_type', 'template_type'),
        Index('ix_email_templates_active', 'is_active'),
        {'extend_existing': True}
    )

    name = Column(String(255), nullable=False)
    description = Column(Text)

    template_type = Column(
        String(50),
        nullable=False,
        comment="initial_send | first_followup | second_followup | urgent_notice | payment_inquiry | estimate_request | supplement_followup | custom"
    )

    # Email content
    subject_template = Column(String(500), nullable=False)
    body_template = Column(Text, nullable=False, comment="HTML body with {{variable}} placeholders")

    # Available variables for this template (for UI hints)
    available_variables = Column(
        JSONB,
        default=list,
        comment="List of variable names available for substitution"
    )

    # Metadata
    language = Column(String(10), default='en', comment="en | ko | es")
    is_active = Column(Boolean, default=True)
    is_system = Column(Boolean, default=False, comment="System-provided template (not deletable)")
    usage_count = Column(Integer, default=0)

    # Company ownership (NULL = system-wide)
    company_id = Column(
        UUIDType(),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=True,
    )

    # Audit
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"))


class CommunicationLog(Base, BaseModel):
    """
    Log of all communications (email, phone, text) with adjusters/PAs.
    Tracks whether the recipient acknowledged the communication.
    """
    __tablename__ = "communication_logs"
    __table_args__ = (
        Index('ix_communication_logs_task', 'followup_task_id'),
        Index('ix_communication_logs_claim', 'claim_id'),
        Index('ix_communication_logs_type', 'communication_type'),
        {'extend_existing': True}
    )

    followup_task_id = Column(
        UUIDType(),
        ForeignKey("followup_tasks.id", ondelete="CASCADE"),
        nullable=True,
    )
    claim_id = Column(
        UUIDType(),
        ForeignKey("claims.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Communication details
    communication_type = Column(
        String(30),
        nullable=False,
        comment="email | phone | text | in_person | other"
    )
    direction = Column(
        String(10),
        nullable=False,
        default='outbound',
        comment="outbound | inbound"
    )

    # Contact info
    contact_name = Column(String(255))
    contact_email = Column(String(255))
    contact_phone = Column(String(50))

    # Content summary
    subject = Column(String(500))
    summary = Column(Text, comment="Brief summary of communication content")

    # Response tracking
    response_received = Column(Boolean, default=False)
    response_date = Column(DateTime(timezone=True))
    response_summary = Column(Text)

    # Reference to sent email (if communication was email)
    sent_email_id = Column(
        UUIDType(),
        ForeignKey("sent_emails.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Audit
    logged_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationships
    followup_task = relationship("FollowUpTask", back_populates="communications")


class SentEmail(Base, BaseModel):
    """
    Record of emails sent from the system.
    Provides full audit trail of outbound emails.
    """
    __tablename__ = "sent_emails"
    __table_args__ = (
        Index('ix_sent_emails_claim', 'claim_id'),
        Index('ix_sent_emails_task', 'followup_task_id'),
        Index('ix_sent_emails_status', 'status'),
        Index('ix_sent_emails_sent_at', 'sent_at'),
        {'extend_existing': True}
    )

    claim_id = Column(
        UUIDType(),
        ForeignKey("claims.id", ondelete="CASCADE"),
        nullable=False,
    )
    followup_task_id = Column(
        UUIDType(),
        ForeignKey("followup_tasks.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Sending account
    email_account_id = Column(
        UUIDType(),
        ForeignKey("email_accounts.id", ondelete="SET NULL"),
        nullable=True,
        comment="Email account used for sending"
    )

    # Recipients
    from_address = Column(String(255), nullable=False)
    to_addresses = Column(JSONB, nullable=False, comment="List of recipient emails")
    cc_addresses = Column(JSONB, default=list)
    bcc_addresses = Column(JSONB, default=list)
    reply_to = Column(String(255))

    # Content
    subject = Column(String(500), nullable=False)
    body_html = Column(Text, nullable=False)
    body_text = Column(Text, comment="Plain text version")

    # Attachments
    attachments = Column(
        JSONB,
        default=list,
        comment="[{filename, file_id, mime_type, size}]"
    )

    # Template reference
    template_id = Column(
        UUIDType(),
        ForeignKey("email_templates.id", ondelete="SET NULL"),
        nullable=True,
    )
    template_variables = Column(JSONB, comment="Variables used for template rendering")

    # AI generation
    is_ai_generated = Column(Boolean, default=False)
    ai_prompt = Column(Text, comment="Prompt used for AI generation (if applicable)")

    # Sending status
    status = Column(
        String(30),
        nullable=False,
        default='draft',
        comment="draft | queued | sending | sent | failed | bounced"
    )
    sent_at = Column(DateTime(timezone=True))
    error_message = Column(Text)

    # SMTP tracking
    smtp_message_id = Column(String(500), comment="SMTP Message-ID header for tracking")

    # Scheduling
    scheduled_at = Column(DateTime(timezone=True), comment="When to send (for scheduled emails)")

    # Reply tracking
    reply_received = Column(Boolean, default=False)
    reply_received_at = Column(DateTime(timezone=True))
    reply_summary = Column(Text, comment="Summary of the reply content")

    # Audit
    sent_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationships
    followup_task = relationship("FollowUpTask", back_populates="sent_emails")
    claim = relationship("Claim", lazy='select')
    template = relationship("EmailTemplate", lazy='select')
