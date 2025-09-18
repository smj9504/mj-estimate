"""
File management models for handling uploaded files
"""

from sqlalchemy import Column, String, Integer, DateTime, Text, Boolean
from sqlalchemy.sql import func
import uuid

from app.core.database_factory import Base


def generate_uuid():
    """Generate UUID for primary keys"""
    return str(uuid.uuid4())


class File(Base):
    """File table for tracking uploaded files"""
    __tablename__ = "files"

    id = Column(String, primary_key=True, default=generate_uuid)
    filename = Column(String(255), nullable=False)  # Generated filename
    original_name = Column(String(255), nullable=False)  # Original upload name
    content_type = Column(String(100), nullable=False)  # MIME type
    size = Column(Integer, nullable=False)  # File size in bytes
    url = Column(Text, nullable=False)  # File URL/path
    thumbnail_url = Column(Text)  # Thumbnail URL for images

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