"""
Generic document model for tracking all document types
"""

from sqlalchemy import Column, String, Text, DateTime, DECIMAL
from sqlalchemy.sql import func
import uuid

from app.core.database_factory import Base


def generate_uuid():
    """Generate UUID for primary keys"""
    return str(uuid.uuid4())


class Document(Base):
    """Generic document table for tracking all document types"""
    __tablename__ = "documents"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    document_type = Column(String(50), nullable=False)  # invoice, estimate, plumber_report
    document_id = Column(String, nullable=False)  # ID from specific table
    document_number = Column(String(50), nullable=False)
    client_name = Column(String(255))
    total_amount = Column(DECIMAL(15, 2))
    status = Column(String(50))
    created_date = Column(DateTime(timezone=True))
    pdf_url = Column(Text)  # URL or path to generated PDF
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())