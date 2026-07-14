"""
Contract domain models
- ContractTemplate: PDF template per company
- ContractInstance: Generated contract for a specific claim/client
- ContractSignature: Digital signature capture
- ClaimCompany: Many-to-many between Claim and Company with role
"""

import uuid
from datetime import datetime, timedelta

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
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType, generate_uuid


class ContractTemplate(Base, BaseModel):
    """PDF contract template belonging to a company"""
    __tablename__ = "contract_templates"
    __table_args__ = (
        Index('ix_contract_templates_company', 'company_id'),
        {'extend_existing': True}
    )

    company_id = Column(UUIDType(), ForeignKey("companies.id"), nullable=False)
    name = Column(String(500), nullable=False)  # "Authorization to Perform Work"
    document_type = Column(String(100), default="authorization")
    # Types: authorization | certificate_of_satisfaction |
    #        scope_of_work | lien_waiver | change_order | other
    description = Column(Text)

    # PDF file storage
    file_url = Column(Text, nullable=False)       # storage path or URL
    file_name = Column(String(500))               # original filename
    file_size = Column(Integer)                    # bytes
    storage_provider = Column(String(50))          # local | gdrive | gcs
    storage_file_id = Column(String(500))          # provider-specific file ID (e.g. GCS object path)

    # Signature config
    requires_signature = Column(Boolean, default=True)
    signature_roles = Column(Text)  # JSON string: ["homeowner","company_rep"]

    # Field mapping config (JSON: array of field placement objects)
    field_mappings = Column(Text)

    is_active = Column(Boolean, default=True)
    version = Column(Integer, default=1)

    # Relationships
    company = relationship("Company", foreign_keys=[company_id], lazy='select')
    instances = relationship(
        "ContractInstance", back_populates="template",
        cascade="all, delete-orphan", lazy='select'
    )


class ContractInstance(Base, BaseModel):
    """A concrete contract generated from a template for a claim"""
    __tablename__ = "contract_instances"
    __table_args__ = (
        Index('ix_contract_instances_claim', 'claim_id'),
        Index('ix_contract_instances_client', 'client_id'),
        Index('ix_contract_instances_token', 'signing_token', unique=True),
        {'extend_existing': True}
    )

    template_id = Column(UUIDType(), ForeignKey("contract_templates.id"), nullable=False)
    claim_id = Column(UUIDType(), ForeignKey("claims.id", ondelete="CASCADE"), nullable=True)
    client_id = Column(UUIDType(), ForeignKey("clients.id"), nullable=True)
    company_id = Column(UUIDType(), ForeignKey("companies.id"), nullable=False)

    # Contract metadata
    contract_number = Column(String(100), index=True)
    title = Column(String(500))
    notes = Column(Text)  # office notes

    # Pre-filled data snapshot (JSON: client info, claim info, company info at time of generation)
    prefill_data = Column(Text)  # JSON

    # Signing
    signing_token = Column(String(100), unique=True, index=True)
    token_expires_at = Column(DateTime(timezone=True))
    status = Column(String(50), default="draft")
    # Status: draft | sent | viewed | signed | voided

    sent_at = Column(DateTime(timezone=True))
    viewed_at = Column(DateTime(timezone=True))
    signed_at = Column(DateTime(timezone=True))
    voided_at = Column(DateTime(timezone=True))

    # Filled PDF (generated with prefilled data from template field mappings)
    filled_pdf_url = Column(Text)

    # Signed PDF (generated after all signatures collected)
    signed_pdf_url = Column(Text)

    # Email tracking: JSON list of emails the signing link was sent to
    sent_to_emails = Column(Text)  # JSON: ["client@example.com"]

    # Audit trail: JSON array of events
    # [{action, timestamp, ip, user_agent, detail}, ...]
    audit_log = Column(Text)  # JSON

    # Relationships
    template = relationship("ContractTemplate", back_populates="instances")
    claim = relationship("Claim", foreign_keys=[claim_id], lazy='select')
    client = relationship("Client", foreign_keys=[client_id], lazy='select')
    company = relationship("Company", foreign_keys=[company_id], lazy='select')
    signatures = relationship(
        "ContractSignature", back_populates="contract_instance",
        cascade="all, delete-orphan", lazy='select'
    )

    def generate_token(self, expires_days=30):
        """Generate a signing token with expiry"""
        self.signing_token = str(uuid.uuid4())
        self.token_expires_at = datetime.utcnow() + timedelta(days=expires_days)
        return self.signing_token

    @property
    def is_token_valid(self):
        if not self.signing_token or not self.token_expires_at:
            return False
        return datetime.utcnow() < self.token_expires_at


class ContractSignature(Base, BaseModel):
    """Digital signature on a contract"""
    __tablename__ = "contract_signatures"
    __table_args__ = (
        Index('ix_contract_signatures_instance', 'contract_instance_id'),
        {'extend_existing': True}
    )

    contract_instance_id = Column(
        UUIDType(), ForeignKey("contract_instances.id", ondelete="CASCADE"),
        nullable=False
    )

    # Signer info
    signer_name = Column(String(255), nullable=False)
    signer_role = Column(String(50), default="homeowner")
    # Roles: homeowner | company_rep | witness

    # Signature data
    signature_image = Column(Text, nullable=False)  # base64 PNG
    signature_type = Column(String(20), default='drawn')  # drawn | typed
    typed_name = Column(String(255))  # for typed signatures

    # Audit / legal
    signed_at = Column(DateTime(timezone=True), default=func.now())
    ip_address = Column(String(100))
    user_agent = Column(Text)

    # E-sign consent
    consent_agreed = Column(Boolean, default=False)
    consent_text = Column(Text)

    # Document integrity
    document_hash = Column(String(128))

    # Relationship
    contract_instance = relationship("ContractInstance", back_populates="signatures")


class ClaimCompany(Base, BaseModel):
    """Many-to-many: Companies assigned to a Claim with roles"""
    __tablename__ = "claim_companies"
    __table_args__ = (
        Index('ix_claim_companies_claim', 'claim_id'),
        Index('ix_claim_companies_unique', 'claim_id', 'company_id', 'role', unique=True),
        {'extend_existing': True}
    )

    claim_id = Column(UUIDType(), ForeignKey("claims.id", ondelete="CASCADE"), nullable=False)
    company_id = Column(UUIDType(), ForeignKey("companies.id"), nullable=False)
    role = Column(String(50), nullable=False)
    # Roles: plumber | water_mitigation | reconstruction | moving | other
    is_primary = Column(Boolean, default=False)
    notes = Column(Text)
    assigned_at = Column(DateTime(timezone=True), default=func.now())

    # Relationships
    claim = relationship("Claim", foreign_keys=[claim_id], lazy='select')
    company = relationship("Company", foreign_keys=[company_id], lazy='select')
