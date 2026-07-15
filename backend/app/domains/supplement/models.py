"""
Supplement domain models.
Tracks re-estimation needs, bid item estimates, and public adjuster follow-ups.
"""

from sqlalchemy import (
    DECIMAL,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType


class SupplementRequest(Base, BaseModel):
    """
    Tracks when a claim needs re-estimation (supplement).

    Created when insurance estimate is reviewed and differences are found.
    Links to the original negotiation and tracks the supplement lifecycle.
    """
    __tablename__ = "supplement_requests"
    __table_args__ = (
        Index('ix_supplement_requests_claim', 'claim_id'),
        Index('ix_supplement_requests_status', 'status'),
        Index('ix_supplement_requests_priority', 'priority'),
        {'extend_existing': True}
    )

    claim_id = Column(
        UUIDType(),
        ForeignKey("claims.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Which insurance negotiation this supplement is based on
    negotiation_id = Column(
        UUIDType(),
        ForeignKey("claim_negotiations.id", ondelete="SET NULL"),
        nullable=True,
        comment="The insurance estimate revision this supplement addresses"
    )

    # Request type: supplement (default) or estimate_request (insurer asked us for estimate)
    request_type = Column(
        String(50),
        nullable=False,
        default='supplement',
        server_default='supplement',
        comment="supplement | estimate_request"
    )

    # Supplement details
    title = Column(String(500), nullable=False)
    reason = Column(Text, comment="Why re-estimation is needed")
    description = Column(Text)

    # Amounts
    original_amount = Column(DECIMAL(15, 2), default=0, comment="Insurance estimate amount")
    supplement_amount = Column(DECIMAL(15, 2), default=0, comment="Our supplement amount")
    difference = Column(DECIMAL(15, 2), default=0, comment="Difference (auto-calculated)")
    our_estimate_amount = Column(
        DECIMAL(15, 2), default=0,
        comment="Contractor estimate amount (for estimate_request type)"
    )

    # Status workflow: identified -> in_progress -> submitted -> under_review -> approved/denied
    status = Column(
        String(50),
        nullable=False,
        default='identified',
        comment="identified | in_progress | submitted | under_review | approved | denied | withdrawn"
    )
    priority = Column(String(20), default='normal', comment="low | normal | high | urgent")

    # Submission tracking
    submitted_to = Column(String(255), comment="Public adjuster or insurance adjuster name")
    submitted_to_email = Column(String(255))
    submitted_date = Column(DateTime(timezone=True))
    response_date = Column(DateTime(timezone=True))
    response_notes = Column(Text)

    # Required estimate types checklist (e.g. {"xactimate": true, "pack_in_out": false, ...})
    required_estimates = Column(
        JSONB,
        default={},
        comment="Checklist of required estimate types: xactimate, pack_in_out, cabinet, bathroom"
    )

    # Document reference (supplement estimate PDF)
    document_file_id = Column(String(255), comment="Supplement estimate PDF file ID")
    document_file_name = Column(String(500))

    # Audit
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationships
    claim = relationship("Claim", lazy='select')
    negotiation = relationship("ClaimNegotiation", lazy='select')
    bid_items = relationship(
        "BidItemEstimate",
        back_populates="supplement",
        cascade="all, delete-orphan",
        order_by="BidItemEstimate.created_at"
    )
    followups = relationship(
        "SupplementFollowUp",
        back_populates="supplement",
        cascade="all, delete-orphan",
        order_by="SupplementFollowUp.created_at.desc()"
    )


class BidItemEstimate(Base, BaseModel):
    """
    Links a supplement request to specific bid item estimates.

    Each bid item can reference an existing estimate (bathroom, cabinet, packing, roofing)
    or be a standalone custom estimate.
    """
    __tablename__ = "bid_item_estimates"
    __table_args__ = (
        Index('ix_bid_item_estimates_supplement', 'supplement_id'),
        Index('ix_bid_item_estimates_type', 'estimate_type'),
        Index('ix_bid_item_estimates_status', 'status'),
        {'extend_existing': True}
    )

    supplement_id = Column(
        UUIDType(),
        ForeignKey("supplement_requests.id", ondelete="CASCADE"),
        nullable=False,
    )

    # What type of bid item estimate
    estimate_type = Column(
        String(50),
        nullable=False,
        comment="bathroom | cabinet | packing | roofing | kitchen | flooring | other"
    )
    title = Column(String(500), nullable=False, default="")
    description = Column(Text)

    # Link to actual estimate (polymorphic - only one should be set)
    bathroom_estimate_id = Column(UUIDType(), ForeignKey("bathroom_estimates.id", ondelete="SET NULL"), nullable=True)
    cabinet_estimate_id = Column(UUIDType(), ForeignKey("cabinet_estimates.id", ondelete="SET NULL"), nullable=True)
    pack_calculation_id = Column(UUIDType(), ForeignKey("pack_calculations.id", ondelete="SET NULL"), nullable=True)
    roofing_estimate_id = Column(UUIDType(), ForeignKey("roofing_estimates.id", ondelete="SET NULL"), nullable=True)

    # For custom/other types that don't have a specific estimate model
    custom_amount = Column(DECIMAL(15, 2))
    custom_document_file_id = Column(String(255))
    custom_document_file_name = Column(String(500))

    # When Xactimate already includes this bid item's amount, exclude from supplement total
    included_in_xactimate = Column(
        Boolean,
        default=False,
        nullable=False,
        server_default='false',
        comment="If true, this item's amount is already included in Xactimate and excluded from supplement total"
    )

    # Status
    status = Column(
        String(50),
        nullable=False,
        default='draft',
        comment="draft | sent | approved | revision_needed | denied"
    )

    # PA submission tracking
    sent_to_pa_date = Column(DateTime(timezone=True))
    pa_response_date = Column(DateTime(timezone=True))
    pa_response_notes = Column(Text)

    # Audit
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationships
    supplement = relationship("SupplementRequest", back_populates="bid_items")


class SupplementFollowUp(Base, BaseModel):
    """
    Follow-up log for supplement requests sent to public adjuster.
    Tracks each contact attempt, info requests, and responses.
    """
    __tablename__ = "supplement_followups"
    __table_args__ = (
        Index('ix_supplement_followups_supplement', 'supplement_id'),
        {'extend_existing': True}
    )

    supplement_id = Column(
        UUIDType(),
        ForeignKey("supplement_requests.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Follow-up type
    followup_type = Column(
        String(30),
        nullable=False,
        default='general',
        server_default='general',
        comment="general | info_request"
    )

    # Follow-up details
    contact_method = Column(String(30), nullable=False, comment="email | phone | text | in_person")
    contact_name = Column(String(255))
    contact_email = Column(String(255))
    summary = Column(Text)

    # Info request specific fields
    items_needed = Column(
        JSONB,
        default=list,
        comment="List of info items needed: [{description: str, resolved: bool}]"
    )
    request_to_type = Column(
        String(50),
        comment="public_adjuster | contractor"
    )
    info_status = Column(
        String(30),
        default='pending',
        server_default='pending',
        comment="pending | sent | awaiting_response | partially_resolved | resolved"
    )

    # Response
    response_received = Column(Boolean, default=False)
    response_date = Column(DateTime(timezone=True))
    response_summary = Column(Text)
    reply_body_html = Column(Text, comment="Full reply email body (HTML)")
    reply_attachment_ids = Column(
        JSONB,
        default=list,
        comment="List of file IDs attached to the reply"
    )

    # Conversation thread: [{type: "sent"|"received", date: str, body_html: str, sender: str, summary: str}]
    conversation = Column(
        JSONB,
        default=list,
        comment="Chronological list of sent/received messages in this thread"
    )

    # Link to sent email for auto reply detection
    sent_email_id = Column(
        UUIDType(),
        ForeignKey("sent_emails.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Follow-up tracking
    follow_up_count = Column(Integer, default=0, server_default='0')
    last_follow_up_date = Column(DateTime(timezone=True))

    # Audit
    logged_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationships
    supplement = relationship("SupplementRequest", back_populates="followups")
