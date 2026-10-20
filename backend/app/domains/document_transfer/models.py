"""
Estimates and invoices offered from one person to another.

The recipient gets their own copy only when they accept.
"""

from sqlalchemy import Column, DateTime, ForeignKey, String, Text

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType


class DocumentTransfer(Base, BaseModel):
    __tablename__ = "document_transfers"
    __table_args__ = {'extend_existing': True}

    # estimate or invoice
    document_type = Column(String(20), nullable=False)
    # The sender's document; copied as it is at the moment of acceptance
    source_id = Column(UUIDType(), nullable=False, index=True)
    # What was sent, kept for display even if the original changes or goes
    document_number = Column(String(50))
    client_name = Column(String(255))

    from_staff_id = Column(UUIDType(), ForeignKey("staff.id", ondelete="SET NULL"))
    to_staff_id = Column(UUIDType(), ForeignKey("staff.id", ondelete="CASCADE"), nullable=False, index=True)
    note = Column(Text)

    # pending, accepted, declined, cancelled
    status = Column(String(20), default='pending', nullable=False, index=True)
    # The recipient's copy, once accepted
    copy_id = Column(UUIDType())
    responded_at = Column(DateTime(timezone=True))
