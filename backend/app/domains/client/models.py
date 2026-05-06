"""
Client, Claim, and ClaimNegotiation domain models
"""

from sqlalchemy import (
    DECIMAL,
    JSON,
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


class Client(Base, BaseModel):
    """Client entity - represents a customer/homeowner"""
    __tablename__ = "clients"
    __table_args__ = (
        Index('ix_clients_display_name', 'display_name'),
        Index('ix_clients_company_id', 'company_id'),
        Index('ix_clients_phone', 'phone'),
        Index('ix_clients_email', 'email'),
        {'extend_existing': True}
    )

    # Owner information (supports multiple owners)
    # [{name: str, phone: str, email: str, is_primary: bool}]
    owners = Column(JSON, nullable=False, default=list)
    display_name = Column(String(500), nullable=False)  # "John & Jane Smith"

    # Address
    address = Column(Text)
    city = Column(String(100))
    state = Column(String(50))
    zipcode = Column(String(20))

    # Primary contact (convenience fields, may duplicate primary owner)
    phone = Column(String(50))
    email = Column(String(255))

    # Default insurance info (auto-fill when creating new claims)
    insurance_company = Column(String(255))
    insurance_policy_number = Column(String(100))

    # Which company manages this client
    company_id = Column(UUIDType(), ForeignKey("companies.id"), nullable=True)

    # Normalized address for fast matching (auto-generated from address fields)
    normalized_address = Column(String(500), nullable=True, index=True)

    # Notes
    notes = Column(Text)
    is_active = Column(Boolean, default=True)

    # Relationships
    claims = relationship("Claim", back_populates="client", cascade="all, delete-orphan", lazy='select')
    invoices = relationship("Invoice", back_populates="client_ref", foreign_keys="Invoice.client_id", lazy='select')
    estimates = relationship("Estimate", back_populates="client_ref", foreign_keys="Estimate.client_id", lazy='select')
    work_orders = relationship("WorkOrder", back_populates="client_ref", foreign_keys="WorkOrder.client_id", lazy='select')
    pack_estimates = relationship("PackCalculation", foreign_keys="PackCalculation.client_id", lazy='select')
    # Note: WM Jobs link to Client through Claim (WM Job → Claim → Client)
    # WM Job's existing client_id FK points to companies.id (legacy), not clients.id


class Claim(Base, BaseModel):
    """Insurance claim - one client can have multiple claims"""
    __tablename__ = "claims"
    __table_args__ = (
        Index('ix_claims_claim_number', 'claim_number'),
        Index('ix_claims_client_id', 'client_id'),
        Index('ix_claims_status', 'status'),
        {'extend_existing': True}
    )

    client_id = Column(UUIDType(), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False)
    company_id = Column(UUIDType(), ForeignKey("companies.id"), nullable=True)  # 담당 회사 (claim마다 다를 수 있음)

    # Optional plumber report link
    plumber_report_id = Column(
        UUIDType(), ForeignKey("plumber_reports.id", ondelete="SET NULL"), nullable=True
    )

    # Claim identification
    claim_number = Column(String(100), nullable=False, index=True)

    # Insurance info (per-claim, may differ from client defaults)
    insurance_company = Column(String(255))
    insurance_policy_number = Column(String(100))
    insurance_deductible = Column(DECIMAL(15, 2))

    # Adjuster info
    adjuster_name = Column(String(255))
    adjuster_phone = Column(String(50))
    adjuster_email = Column(String(255))

    # Loss info
    date_of_loss = Column(DateTime(timezone=True))
    loss_description = Column(Text)

    # Current negotiated amounts (updated when new negotiation revision is added)
    current_acv = Column(DECIMAL(15, 2), default=0)  # Actual Cash Value
    current_rcv = Column(DECIMAL(15, 2), default=0)  # Replacement Cost Value
    current_depreciation = Column(DECIMAL(15, 2), default=0)

    # Our amounts
    our_estimate_amount = Column(DECIMAL(15, 2), default=0)
    final_invoice_amount = Column(DECIMAL(15, 2), default=0)

    # Payment tracking
    total_insurance_paid = Column(DECIMAL(15, 2), default=0, comment="Total amount paid by insurance")
    payment_status = Column(
        String(50), default="unpaid",
        comment="unpaid | partial | paid | overpaid | disputed"
    )

    # Insurance rebuild estimate tracking
    insurance_estimate_received = Column(Boolean, default=False)
    insurance_estimate_received_date = Column(DateTime(timezone=True))
    insurance_estimate_file_id = Column(String(255), comment="Stored PDF file ID")
    insurance_estimate_file_name = Column(String(500))

    # Supplement tracking
    needs_supplement = Column(Boolean, default=False)
    supplement_status = Column(
        String(50),
        comment="identified | in_progress | submitted | approved | denied"
    )
    supplement_notes = Column(Text)

    # Status
    status = Column(String(50), default="open")  # open, negotiating, settled, closed, denied

    notes = Column(Text)

    # Relationships
    client = relationship("Client", back_populates="claims")
    negotiations = relationship("ClaimNegotiation", back_populates="claim", cascade="all, delete-orphan", lazy='select', order_by="ClaimNegotiation.revision_number")
    invoices = relationship("Invoice", back_populates="claim_ref", foreign_keys="Invoice.claim_id", lazy='select')
    estimates = relationship("Estimate", back_populates="claim_ref", foreign_keys="Estimate.claim_id", lazy='select')
    work_orders = relationship("WorkOrder", back_populates="claim_ref", foreign_keys="WorkOrder.claim_id", lazy='select')
    water_mitigation_jobs = relationship(
        "WaterMitigationJob", back_populates="claim_ref",
        foreign_keys="WaterMitigationJob.claim_id", lazy='select'
    )
    plumber_report = relationship(
        "PlumberReport", foreign_keys=[plumber_report_id], lazy='select'
    )
    contracts = relationship(
        "ContractInstance", back_populates="claim",
        foreign_keys="ContractInstance.claim_id", lazy='select'
    )
    assigned_companies = relationship(
        "ClaimCompany", back_populates="claim",
        foreign_keys="ClaimCompany.claim_id", cascade="all, delete-orphan", lazy='select'
    )
    cabinet_estimates = relationship(
        "CabinetEstimate", back_populates="claim_ref",
        foreign_keys="CabinetEstimate.claim_id", lazy='select'
    )
    bathroom_estimates = relationship(
        "BathroomEstimate", back_populates="claim_ref",
        foreign_keys="BathroomEstimate.claim_id", lazy='select'
    )
    roofing_estimates = relationship(
        "RoofingEstimate", back_populates="claim_ref",
        foreign_keys="RoofingEstimate.claim_id", lazy='select'
    )
    payments = relationship(
        "ClaimPayment", back_populates="claim",
        cascade="all, delete-orphan", lazy='select',
        order_by="ClaimPayment.received_date.desc()"
    )


class ClaimNegotiation(Base, BaseModel):
    """Tracks insurance estimate revisions / negotiation history"""
    __tablename__ = "claim_negotiations"
    __table_args__ = (
        Index('ix_claim_negotiations_claim_id', 'claim_id'),
        Index('ix_claim_negotiations_revision', 'claim_id', 'revision_number'),
        {'extend_existing': True}
    )

    claim_id = Column(UUIDType(), ForeignKey("claims.id", ondelete="CASCADE"), nullable=False)

    # Version tracking
    revision_number = Column(Integer, nullable=False, default=1)
    revision_type = Column(String(50), nullable=False, default="initial")
    # Types: initial | supplement | re_inspection | appraisal | final

    # Amounts at this revision
    acv_amount = Column(DECIMAL(15, 2), default=0)
    rcv_amount = Column(DECIMAL(15, 2), default=0)
    depreciation_amount = Column(DECIMAL(15, 2), default=0)
    deductible = Column(DECIMAL(15, 2), default=0)

    # Meta
    date_received = Column(DateTime(timezone=True))
    received_from = Column(String(255))  # adjuster name or source
    notes = Column(Text)

    # Attached document (insurance company estimate PDF, etc.)
    document_url = Column(Text)
    document_name = Column(String(500))

    # PDF extraction: section-level financial breakdown
    sections_data = Column(JSON, nullable=True)  # List of summary section dicts
    extraction_status = Column(String(50), nullable=True)  # extracting | completed | failed
    extraction_metadata = Column(JSON, nullable=True)  # AI model, pages, confidence

    # Relationship
    claim = relationship("Claim", back_populates="negotiations")


class ClaimPayment(Base, BaseModel):
    """Individual payment received from insurance company for a claim"""
    __tablename__ = "claim_payments"
    __table_args__ = (
        Index('ix_claim_payments_claim_id', 'claim_id'),
        Index('ix_claim_payments_status', 'payment_type'),
        {'extend_existing': True}
    )

    claim_id = Column(UUIDType(), ForeignKey("claims.id", ondelete="CASCADE"), nullable=False)

    # Payment details
    payment_type = Column(
        String(50), nullable=False, default="insurance",
        comment="insurance | depreciation_recovery | supplement | deductible | other"
    )
    amount = Column(DECIMAL(15, 2), nullable=False)
    check_number = Column(String(100))
    check_date = Column(DateTime(timezone=True))
    received_date = Column(DateTime(timezone=True))

    # Source
    paid_by = Column(String(255), comment="Insurance company name or source")
    description = Column(Text)

    # Status
    status = Column(
        String(50), default="received",
        comment="received | deposited | cleared | returned"
    )

    notes = Column(Text)

    # Audit
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationship
    claim = relationship("Claim", back_populates="payments")
