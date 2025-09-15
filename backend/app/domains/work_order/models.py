"""
Work Order database models
"""

from sqlalchemy import Column, String, Text, DateTime, Boolean, ForeignKey, Enum, Integer, Index, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import UUID
from datetime import datetime
import enum
import uuid

from app.core.database_factory import Base
from app.core.database_types import UUIDType, generate_uuid


class WorkOrderStatus(str, enum.Enum):
    """Work order status enumeration"""
    DRAFT = "draft"
    PENDING = "pending"
    APPROVED = "approved"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    ON_HOLD = "on_hold"


class WorkOrder(Base):
    """Work Order model"""
    __tablename__ = "work_orders"
    __table_args__ = (
        Index('ix_work_order_number_version', 'work_order_number', 'version'),
        {'extend_existing': True}
    )
    
    id = Column(UUIDType(), primary_key=True, default=generate_uuid, index=True)
    
    # Work Order Information
    work_order_number = Column(String(50), nullable=False, index=True)
    version = Column(Integer, default=1, nullable=False)
    is_latest = Column(Boolean, default=True, nullable=False)
    
    # Company relationship
    company_id = Column(UUIDType(), ForeignKey("companies.id"), nullable=False)
    # company = relationship("Company", back_populates="work_orders")
    
    # Client Information
    client_name = Column(String(200), nullable=False)
    client_address = Column(String(500))
    client_city = Column(String(100))
    client_state = Column(String(50))
    client_zipcode = Column(String(20))
    client_phone = Column(String(50))
    client_email = Column(String(200))
    
    # Job Information
    job_site_address = Column(String(500))
    job_site_city = Column(String(100))
    job_site_state = Column(String(50))
    job_site_zipcode = Column(String(20))
    
    # Work Details
    document_type = Column(String(50), nullable=False)  # Stores Document Type code from Document Types table
    work_description = Column(Text)
    scope_of_work = Column(Text)
    special_instructions = Column(Text)
    
    # Status and Assignment
    status = Column(Enum(WorkOrderStatus), default=WorkOrderStatus.DRAFT)
    priority = Column(String(20), default="medium")  # low, medium, high, urgent
    
    # Staff Assignment
    created_by_staff_id = Column(UUIDType(), nullable=False)
    assigned_to_staff_id = Column(UUIDType())
    
    # Scheduling
    scheduled_start_date = Column(DateTime)
    scheduled_end_date = Column(DateTime)
    actual_start_date = Column(DateTime)
    actual_end_date = Column(DateTime)
    
    # Financial Information
    estimated_hours = Column(String(20))
    estimated_cost = Column(String(50))
    actual_hours = Column(String(20))
    actual_cost = Column(String(50))
    
    # Calculated Cost Fields
    base_cost = Column(String(50))  # Base cost from selected trades
    final_cost = Column(String(50))  # Total cost including base + additional costs + tax
    tax_amount = Column(String(50))  # Tax amount
    discount_amount = Column(String(50))  # Discount amount if any
    
    # Tax Settings
    apply_tax = Column(Boolean, default=False)  # Whether to apply tax to this work order
    tax_rate = Column(String(20), default="0")  # Tax rate if applicable (default 0)
    
    # Additional Information
    materials_required = Column(Text)
    tools_required = Column(Text)
    permits_required = Column(Text)
    safety_notes = Column(Text)
    
    # Trades and Consultation
    trades = Column(JSON)  # Store as JSON array of UUIDs
    consultation_notes = Column(Text)
    cost_override = Column(String(50))
    
    # Additional Costs (e.g., Roofing report, Siding report, etc.)
    additional_costs = Column(JSON)  # Store as JSON array of {name, amount, description, type?: optional}
    
    # Internal Notes
    internal_notes = Column(Text)
    completion_notes = Column(Text)
    
    # Status Flags
    is_active = Column(Boolean, default=True)
    is_billable = Column(Boolean, default=True)
    requires_permit = Column(Boolean, default=False)
    
    # Revision Tracking
    revision_count = Column(Integer, default=0, nullable=False)
    revision_requested = Column(Boolean, default=False, nullable=False)
    last_revision_date = Column(DateTime)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __str__(self):
        return f"Work Order #{self.work_order_number} - {self.client_name}"
    
    def __repr__(self):
        return f"<WorkOrder(id={self.id}, number={self.work_order_number}, status={self.status})>"


class WorkOrderStaffAssignment(Base):
    """Junction table for work order to staff many-to-many relationship"""
    __tablename__ = "work_order_staff_assignments"
    __table_args__ = (
        Index('ix_work_order_staff', 'work_order_id', 'staff_id'),
        {'extend_existing': True}
    )
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    # Foreign Keys
    work_order_id = Column(UUID(as_uuid=True), ForeignKey("work_orders.id"), nullable=False)
    staff_id = Column(UUID(as_uuid=True), ForeignKey("staff.id"), nullable=False)
    
    # Assignment Details
    assigned_role = Column(String(50))  # primary, secondary, reviewer, etc.
    is_active = Column(Boolean, default=True)
    
    # Timestamps
    assigned_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime)
    
    def __repr__(self):
        return f"<WorkOrderStaffAssignment(work_order_id={self.work_order_id}, staff_id={self.staff_id})>"