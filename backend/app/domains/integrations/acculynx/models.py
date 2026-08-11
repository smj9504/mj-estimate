"""
AccuLynx integration database models.

Intentionally standalone: no ForeignKey constraints to `claims`, `wm_photos`,
etc. so this module has zero hard dependency on other domains' schemas and
can be dropped (both tables) without touching any other table. See
`__init__.py` for the full removal checklist.
"""

from datetime import datetime

from sqlalchemy import Column, String, Text, DateTime, Index

from app.core.database_factory import Base
from app.core.database_types import UUIDType, generate_uuid


class AccuLynxJobLink(Base):
    """
    Links a Simple Work claim (claims.id) to an AccuLynx job/lead.

    One claim <-> one AccuLynx job. Works for any claim type (water
    mitigation, roofing, siding, etc.) since `claim_id` is the universal
    cross-domain key (see backend/app/domains/client/models.py: Claim).
    """
    __tablename__ = "acculynx_job_links"
    __table_args__ = (
        {'extend_existing': True}
    )

    id = Column(UUIDType(), primary_key=True, default=generate_uuid, index=True)

    claim_id = Column(UUIDType(), nullable=False, unique=True, index=True)  # claims.id (loose reference)
    acculynx_job_id = Column(String(100), nullable=False)
    acculynx_job_number = Column(String(50))  # display-only cache from AccuLynx job search result

    linked_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<AccuLynxJobLink(claim_id={self.claim_id}, acculynx_job_id={self.acculynx_job_id})>"


class AccuLynxContactLink(Base):
    """
    Remembers which AccuLynx contact a Simple Work client (customer) maps
    to, so creating leads for that client's other claims reuses the same
    AccuLynx contact instead of creating a duplicate one each time.

    Keyed by client_id (not claim_id) - one client can have many claims,
    and in AccuLynx one contact can have many jobs, so this mirrors that
    "one contact, many jobs" relationship on our side too.
    """
    __tablename__ = "acculynx_contact_links"
    __table_args__ = (
        {'extend_existing': True}
    )

    id = Column(UUIDType(), primary_key=True, default=generate_uuid, index=True)

    client_id = Column(UUIDType(), nullable=False, unique=True, index=True)  # clients.id (loose reference)
    acculynx_contact_id = Column(String(100), nullable=False)

    linked_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<AccuLynxContactLink(client_id={self.client_id}, acculynx_contact_id={self.acculynx_contact_id})>"


class AccuLynxUpload(Base):
    """
    Audit trail of files sent from Simple Work to AccuLynx.

    `source_id` has a unique index so a file is never sent twice once it
    has a successful row here.
    """
    __tablename__ = "acculynx_uploads"
    __table_args__ = (
        Index('ix_acculynx_uploads_claim', 'claim_id'),
        {'extend_existing': True}
    )

    id = Column(UUIDType(), primary_key=True, default=generate_uuid, index=True)

    claim_id = Column(UUIDType(), nullable=False, index=True)
    acculynx_job_id = Column(String(100), nullable=False)

    source_table = Column(String(20), nullable=False)  # 'file' | 'wm_photo' | 'wm_document'
    source_id = Column(UUIDType(), nullable=False, unique=True, index=True)
    filename = Column(String(500))

    status = Column(String(20), default="pending", nullable=False)  # pending | success | failed
    error_message = Column(Text)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    uploaded_at = Column(DateTime)

    def __repr__(self):
        return f"<AccuLynxUpload(source={self.source_table}:{self.source_id}, status={self.status})>"
