"""Contractor Portal models."""

import secrets

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, String
from sqlalchemy.orm import relationship

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType


def generate_portal_token() -> str:
    """Generate a URL-safe token for contractor portal access."""
    return secrets.token_urlsafe(48)


class ContractorPortalToken(Base, BaseModel):
    """Long-lived token for contractor portal access.

    Links to a CompanyContact. No expiry - use is_active to revoke.
    """

    __tablename__ = "contractor_portal_tokens"
    __table_args__ = (
        Index("ix_contractor_portal_tokens_token", "token", unique=True),
        Index("ix_contractor_portal_tokens_contact", "company_contact_id"),
        {"extend_existing": True},
    )

    company_contact_id = Column(
        UUIDType(),
        ForeignKey("company_contacts.id", ondelete="CASCADE"),
        nullable=False,
    )
    token = Column(
        String(100),
        nullable=False,
        default=generate_portal_token,
    )
    is_active = Column(Boolean, default=True)
    last_accessed_at = Column(DateTime(timezone=True))

    # Relationships
    contact = relationship(
        "CompanyContact", foreign_keys=[company_contact_id], lazy="select"
    )
