"""
Crew Upload domain models
- UploadLink: Shareable upload links for field crews
- UploadSession: Tracks upload progress per device/visit
"""

import secrets

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text
from sqlalchemy import ForeignKey, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType


def generate_token() -> str:
    """Generate a URL-safe token for upload links"""
    return secrets.token_urlsafe(48)  # 64-char URL-safe string


class UploadLink(Base, BaseModel):
    """
    Shareable upload link for field crews.

    Admin creates a link tied to a job -> shares URL with crew ->
    crew opens link in mobile browser -> uploads photos/videos without login.
    """
    __tablename__ = "upload_links"
    __table_args__ = (
        Index('ix_upload_links_token', 'token'),
        Index('ix_upload_links_context', 'context', 'context_id'),
        Index('ix_upload_links_active', 'is_active'),
        {'extend_existing': True}
    )

    # URL token (unique, URL-safe)
    token = Column(String(100), unique=True, nullable=False, default=generate_token, index=True)

    # Link context (which job this upload is for)
    context = Column(String(50), nullable=False, default='water-mitigation')
    context_id = Column(UUIDType(), nullable=False)  # Job ID
    company_id = Column(UUIDType(), ForeignKey("companies.id"), nullable=False)

    # Link metadata
    label = Column(String(200))  # Optional label e.g. "Kitchen photos"
    crew_name = Column(String(100))  # Who this link is for

    # Security & limits
    expires_at = Column(DateTime(timezone=True), nullable=False)
    max_files = Column(Integer, default=1000)
    max_file_size_mb = Column(Integer, default=500)  # Per file limit in MB
    is_active = Column(Boolean, default=True, nullable=False)

    # Usage tracking
    upload_count = Column(Integer, default=0, nullable=False)
    total_size_bytes = Column(Integer, default=0, nullable=False)
    last_accessed_at = Column(DateTime(timezone=True))

    # Audit
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"), nullable=False)

    # Relationships
    sessions = relationship("UploadSession", back_populates="link", cascade="all, delete-orphan")
    company = relationship("Company", foreign_keys=[company_id])


class UploadSession(Base, BaseModel):
    """
    Tracks an upload session (one browser visit).

    Enables resume: when crew revisits the link, client sends session_token
    and server returns which files were already uploaded (via completed_fingerprints).
    """
    __tablename__ = "upload_sessions"
    __table_args__ = (
        Index('ix_upload_sessions_link', 'link_id'),
        Index('ix_upload_sessions_token', 'session_token'),
        {'extend_existing': True}
    )

    link_id = Column(UUIDType(), ForeignKey("upload_links.id", ondelete="CASCADE"), nullable=False)

    # Session identification (stored in client localStorage)
    session_token = Column(String(100), unique=True, nullable=False, default=generate_token)

    # Progress tracking
    total_files = Column(Integer, default=0)
    completed_files = Column(Integer, default=0)
    failed_files = Column(Integer, default=0)

    # Completed file fingerprints for resume capability
    # fingerprint = "{filename}_{size}_{lastModified}"
    completed_fingerprints = Column(JSONB, default=list)

    # Session metadata
    status = Column(String(20), default='active')  # active, completed, expired
    device_info = Column(String(500))  # User-Agent string
    last_activity_at = Column(DateTime(timezone=True), default=func.now())

    # Relationships
    link = relationship("UploadLink", back_populates="sessions")
