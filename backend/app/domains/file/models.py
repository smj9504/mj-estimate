"""
File management models for handling uploaded files
"""

from sqlalchemy import BigInteger, Column, Float, String, Integer, DateTime, Text, Boolean, Index, UniqueConstraint
from sqlalchemy.sql import func
import uuid

from app.core.database_factory import Base


def generate_uuid():
    """Generate UUID for primary keys"""
    return str(uuid.uuid4())


class File(Base):
    """File table for tracking uploaded files"""
    __tablename__ = "files"
    __table_args__ = (
        Index('ix_files_context_lookup', 'context', 'context_id', 'category', 'is_active'),
        {'extend_existing': True},
    )

    id = Column(String, primary_key=True, default=generate_uuid)
    filename = Column(String(255), nullable=False)  # Generated filename
    original_name = Column(String(255), nullable=False)  # Original upload name
    content_type = Column(String(100), nullable=False)  # MIME type
    size = Column(Integer, nullable=False)  # File size in bytes
    url = Column(Text, nullable=False)  # File URL/path
    thumbnail_url = Column(Text)  # Thumbnail URL for images
    storage_provider = Column(String(50))  # local | gcs | b2 | gdrive - authoritative
    # source of truth for where `url` lives; download code should check this
    # column, not re-derive it from parsing the url string

    # Context information
    context = Column(String(50), nullable=False)  # work-order, estimate, invoice, etc.
    context_id = Column(String, nullable=False)  # ID of the related entity
    category = Column(String(50), default='general')  # File category (before, after, general, etc.)

    # File metadata
    description = Column(Text)  # Optional file description
    uploaded_by = Column(String)  # Username or staff ID who uploaded
    upload_date = Column(DateTime(timezone=True), server_default=func.now())

    # Status
    is_active = Column(Boolean, default=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class VideoRendition(Base):
    """What a stored video needs on top of the file: a poster to show before it plays,
    and an H.264 copy when the browsers can't all play the original (an iPhone's HEVC).

    Works the same for a job's WMPhoto and a claim's File, so it hangs off either
    by owner_type and owner_id, and no photo query has to know about it.
    """
    __tablename__ = "video_renditions"
    __table_args__ = (
        UniqueConstraint('owner_type', 'owner_id', name='uq_video_renditions_owner'),
        {'extend_existing': True},
    )

    id = Column(String, primary_key=True, default=generate_uuid)
    owner_type = Column(String(20), nullable=False)  # 'wm_photo' | 'file'
    owner_id = Column(String(36), nullable=False)

    status = Column(String(20), nullable=False, default='pending')  # pending | processing | ready | failed
    attempts = Column(Integer, nullable=False, default=0)
    error = Column(Text)

    # Where the two files below live; NULL playback_file_id = the original plays everywhere
    storage_provider = Column(String(50))
    poster_file_id = Column(Text)
    playback_file_id = Column(Text)
    playback_size = Column(BigInteger)

    codec = Column(String(30))
    width = Column(Integer)
    height = Column(Integer)
    duration_seconds = Column(Float)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
