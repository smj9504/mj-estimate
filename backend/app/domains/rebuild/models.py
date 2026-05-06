"""
Rebuild domain models.
Tracks construction projects, contractors, and completion document packages.
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
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType


class RebuildContractor(Base, BaseModel):
    """
    Construction company that performs rebuild work.
    Each contractor can have a custom document template configuration.
    """
    __tablename__ = "rebuild_contractors"
    __table_args__ = (
        Index('ix_rebuild_contractors_active', 'is_active'),
        {'extend_existing': True}
    )

    company_name = Column(String(255), nullable=False)
    contact_name = Column(String(255))
    phone = Column(String(50))
    email = Column(String(255))
    address = Column(Text)

    # Specialties
    specialty = Column(
        String(100),
        comment="general | plumbing | electrical | flooring | painting | roofing | hvac | other"
    )
    license_number = Column(String(100))
    insurance_info = Column(Text)

    # Document template configuration (how this contractor's docs should be formatted)
    doc_config = Column(
        JSONB,
        default=dict,
        comment="""
        {
            coc_format: 'standard' | 'custom',
            coc_template_text: '...',
            invoice_format: 'standard' | 'aia' | 'custom',
            invoice_header: '...',
            photo_requirements: ['before', 'during', 'after', 'final_inspection'],
            additional_docs: ['warranty', 'permit', 'lien_waiver'],
            letterhead_file_id: '...',
            signature_file_id: '...'
        }
        """
    )

    is_active = Column(Boolean, default=True)
    notes = Column(Text)

    # Audit
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationships
    projects = relationship("RebuildProject", back_populates="contractor", lazy='select')


class RebuildProject(Base, BaseModel):
    """
    A construction/rebuild project linked to an insurance claim.
    Tracks the project lifecycle from assignment to completion.
    """
    __tablename__ = "rebuild_projects"
    __table_args__ = (
        Index('ix_rebuild_projects_claim', 'claim_id'),
        Index('ix_rebuild_projects_status', 'status'),
        Index('ix_rebuild_projects_contractor', 'contractor_id'),
        {'extend_existing': True}
    )

    claim_id = Column(
        UUIDType(),
        ForeignKey("claims.id", ondelete="CASCADE"),
        nullable=False,
    )
    contractor_id = Column(
        UUIDType(),
        ForeignKey("rebuild_contractors.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Project info
    title = Column(String(500), nullable=False)
    description = Column(Text)
    scope_of_work = Column(Text, comment="Detailed scope of construction work")

    # Property (denormalized for easy listing)
    property_address = Column(String(500))

    # Status workflow: pending -> assigned -> in_progress -> completed -> invoiced -> closed
    status = Column(
        String(50),
        nullable=False,
        default='pending',
        comment="pending | assigned | in_progress | completed | invoiced | docs_sent | closed"
    )

    # Dates
    start_date = Column(DateTime(timezone=True))
    estimated_completion = Column(DateTime(timezone=True))
    actual_completion = Column(DateTime(timezone=True))

    # Financial
    insurance_estimate_amount = Column(DECIMAL(15, 2), default=0, comment="Amount from insurance estimate")
    contract_amount = Column(DECIMAL(15, 2), default=0, comment="Agreed contract amount")
    final_invoice_amount = Column(DECIMAL(15, 2), default=0)

    # Completion docs tracking
    coc_sent = Column(Boolean, default=False, comment="Certificate of Completion sent")
    invoice_sent = Column(Boolean, default=False)
    photos_sent = Column(Boolean, default=False)
    docs_sent_to = Column(
        String(50),
        comment="public_adjuster | insurance_company | both"
    )
    docs_sent_date = Column(DateTime(timezone=True))
    docs_acknowledged = Column(Boolean, default=False)
    docs_acknowledged_date = Column(DateTime(timezone=True))

    priority = Column(String(20), default='normal')
    notes = Column(Text)

    # Audit
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationships
    claim = relationship("Claim", lazy='select')
    contractor = relationship("RebuildContractor", back_populates="projects", lazy='joined')
    completion_docs = relationship(
        "RebuildCompletionDoc",
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="RebuildCompletionDoc.created_at"
    )


class RebuildCompletionDoc(Base, BaseModel):
    """
    Individual completion document for a rebuild project.
    COC, Invoice, completion photos, warranty, etc.
    """
    __tablename__ = "rebuild_completion_docs"
    __table_args__ = (
        Index('ix_rebuild_completion_docs_project', 'project_id'),
        Index('ix_rebuild_completion_docs_type', 'doc_type'),
        {'extend_existing': True}
    )

    project_id = Column(
        UUIDType(),
        ForeignKey("rebuild_projects.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Document type
    doc_type = Column(
        String(50),
        nullable=False,
        comment="coc | invoice | completion_photo | warranty | permit | lien_waiver | other"
    )
    title = Column(String(500), nullable=False)
    description = Column(Text)

    # File reference
    file_id = Column(String(255), comment="Storage file ID")
    file_name = Column(String(500))
    file_url = Column(Text)
    mime_type = Column(String(100), default='application/pdf')

    # Status
    status = Column(
        String(50),
        default='draft',
        comment="draft | final | sent | acknowledged"
    )

    # Audit
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationships
    project = relationship("RebuildProject", back_populates="completion_docs")
