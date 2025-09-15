"""
Work Order Pydantic schemas
"""

from typing import Optional
from pydantic import BaseModel, EmailStr, field_validator
from datetime import datetime
from uuid import UUID
from .models import WorkOrderStatus


class WorkOrderBase(BaseModel):
    """Base work order schema"""
    company_id: UUID
    
    # Client Information
    client_name: str
    client_address: Optional[str] = None
    client_city: Optional[str] = None
    client_state: Optional[str] = None
    client_zipcode: Optional[str] = None
    client_phone: Optional[str] = None
    client_email: Optional[str] = None
    
    # Job Information
    job_site_address: Optional[str] = None
    job_site_city: Optional[str] = None
    job_site_state: Optional[str] = None
    job_site_zipcode: Optional[str] = None
    
    # Work Details
    document_type: str  # Document Type code from Document Types table
    work_description: Optional[str] = None
    scope_of_work: Optional[str] = None
    special_instructions: Optional[str] = None
    
    # Status and Assignment
    priority: Optional[str] = "medium"
    assigned_to_staff_id: Optional[UUID] = None
    
    # Scheduling
    scheduled_start_date: Optional[datetime] = None
    scheduled_end_date: Optional[datetime] = None
    
    # Financial Information
    estimated_hours: Optional[str] = None
    estimated_cost: Optional[str] = None
    
    # Additional Information
    materials_required: Optional[str] = None
    tools_required: Optional[str] = None
    permits_required: Optional[str] = None
    safety_notes: Optional[str] = None
    
    # Trades and Consultation
    trades: Optional[list[UUID]] = None
    consultation_notes: Optional[str] = None
    cost_override: Optional[str] = None
    
    # Additional Costs (list of dicts with name, amount, description)
    additional_costs: Optional[list[dict]] = None
    
    # Tax Settings
    apply_tax: Optional[bool] = False
    tax_rate: Optional[str] = "0"
    
    # Status Flags
    is_billable: Optional[bool] = True
    requires_permit: Optional[bool] = False

    @field_validator('client_email')
    @classmethod
    def validate_client_email(cls, v):
        """Allow any string for draft saves, but clean up empty/whitespace values"""
        if not v:
            return None
        # Clean up whitespace
        v = str(v).strip()
        if not v:
            return None
        # For draft saves, we accept any non-empty string
        # Email validation can be done on the frontend or when finalizing
        return v


class WorkOrderCreate(WorkOrderBase):
    """Schema for creating a work order"""
    work_order_number: Optional[str] = None
    created_by_staff_id: Optional[UUID] = None
    base_cost: Optional[float] = None
    discount_amount: Optional[float] = None
    tax_amount: Optional[float] = None
    final_cost: Optional[float] = None
    apply_tax: Optional[bool] = False
    tax_rate: Optional[str] = "0"


class WorkOrderUpdate(BaseModel):
    """Schema for updating a work order"""
    work_order_number: Optional[str] = None
    company_id: Optional[UUID] = None
    
    # Client Information
    client_name: Optional[str] = None
    client_address: Optional[str] = None
    client_city: Optional[str] = None
    client_state: Optional[str] = None
    client_zipcode: Optional[str] = None
    client_phone: Optional[str] = None
    client_email: Optional[str] = None
    
    # Job Information
    job_site_address: Optional[str] = None
    job_site_city: Optional[str] = None
    job_site_state: Optional[str] = None
    job_site_zipcode: Optional[str] = None
    
    # Work Details
    document_type: Optional[str] = None  # Document Type code from Document Types table
    work_description: Optional[str] = None
    scope_of_work: Optional[str] = None
    special_instructions: Optional[str] = None
    
    # Status and Assignment
    status: Optional[WorkOrderStatus] = None
    priority: Optional[str] = None
    assigned_to_staff_id: Optional[UUID] = None
    
    # Scheduling
    scheduled_start_date: Optional[datetime] = None
    scheduled_end_date: Optional[datetime] = None
    actual_start_date: Optional[datetime] = None
    actual_end_date: Optional[datetime] = None
    
    # Financial Information
    estimated_hours: Optional[str] = None
    estimated_cost: Optional[str] = None
    actual_hours: Optional[str] = None
    actual_cost: Optional[str] = None
    
    # Additional Information
    materials_required: Optional[str] = None
    tools_required: Optional[str] = None
    permits_required: Optional[str] = None
    safety_notes: Optional[str] = None
    
    # Trades and Consultation
    trades: Optional[list[UUID]] = None
    consultation_notes: Optional[str] = None
    cost_override: Optional[str] = None
    
    # Additional Costs (list of dicts with name, amount, description)
    additional_costs: Optional[list[dict]] = None
    
    # Internal Notes
    internal_notes: Optional[str] = None
    completion_notes: Optional[str] = None
    
    # Tax Settings
    apply_tax: Optional[bool] = None
    tax_rate: Optional[str] = None
    
    # Status Flags
    is_active: Optional[bool] = None
    is_billable: Optional[bool] = None
    requires_permit: Optional[bool] = None


class WorkOrder(WorkOrderBase):
    """Work order schema with all fields"""
    id: UUID
    work_order_number: str
    status: WorkOrderStatus
    created_by_staff_id: UUID
    
    # Staff names (populated from joins)
    created_by_staff_name: Optional[str] = None
    assigned_to_staff_name: Optional[str] = None
    
    # Cost fields (calculated, no defaults to preserve actual values)
    base_cost: Optional[float] = None
    credits_applied: Optional[float] = None
    final_cost: Optional[float] = None
    tax_amount: Optional[float] = None
    discount_amount: Optional[float] = None
    
    # Tax Settings
    apply_tax: Optional[bool] = False
    tax_rate: Optional[str] = "0"
    
    # Scheduling
    actual_start_date: Optional[datetime] = None
    actual_end_date: Optional[datetime] = None
    
    # Financial Information
    actual_hours: Optional[str] = None
    actual_cost: Optional[str] = None
    
    # Internal Notes
    internal_notes: Optional[str] = None
    completion_notes: Optional[str] = None
    
    # Status Flags
    is_active: Optional[bool] = True
    
    # Timestamps
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class WorkOrderResponse(BaseModel):
    """Response schema for work order endpoints"""
    data: Optional[WorkOrder] = None
    error: Optional[str] = None
    message: Optional[str] = None


class WorkOrdersResponse(BaseModel):
    """Response schema for multiple work orders"""
    data: list[WorkOrder]
    total: int


class WorkOrderFilter(BaseModel):
    """Filter parameters for work orders"""
    search: Optional[str] = None
    status: Optional[WorkOrderStatus] = None
    company_id: Optional[UUID] = None
    assigned_to_staff_id: Optional[UUID] = None
    created_by_staff_id: Optional[UUID] = None
    document_type: Optional[str] = None  # Document Type code from Document Types table
    priority: Optional[str] = None
    is_active: Optional[bool] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None