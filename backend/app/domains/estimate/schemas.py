"""
Estimate domain Pydantic schemas
"""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime
from uuid import UUID
from decimal import Decimal


class EstimateItemBase(BaseModel):
    """Base schema for estimate items"""
    # Flexible grouping fields
    primary_group: Optional[str] = None  # 1차 분류
    secondary_group: Optional[str] = None  # 2차 분류
    sort_order: Optional[int] = 0  # 그룹 내 정렬 순서
    
    # Deprecated but kept for backward compatibility
    room: Optional[str] = None  # Use primary_group/secondary_group instead
    
    description: str
    quantity: float = 1.0
    unit: Optional[str] = "ea"
    rate: float = 0.0
    category: Optional[str] = None
    note: Optional[str] = None  # Rich text HTML content
    
    # Insurance specific fields
    depreciation_rate: Optional[float] = 0.0
    depreciation_amount: Optional[float] = 0.0
    acv_amount: Optional[float] = 0.0
    rcv_amount: Optional[float] = 0.0


class EstimateItemCreate(EstimateItemBase):
    """Schema for creating estimate items"""
    pass


class EstimateItemUpdate(BaseModel):
    """Schema for updating estimate items"""
    primary_group: Optional[str] = None
    secondary_group: Optional[str] = None
    sort_order: Optional[int] = None
    room: Optional[str] = None  # Deprecated
    description: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None
    rate: Optional[float] = None
    category: Optional[str] = None
    note: Optional[str] = None
    depreciation_rate: Optional[float] = None


class EstimateItemResponse(EstimateItemBase):
    """Response schema for estimate items"""
    id: UUID
    estimate_id: Optional[UUID] = None
    amount: float = 0.0
    tax_rate: float = 0.0
    tax_amount: float = 0.0
    order_index: Optional[int] = None
    primary_group: Optional[str] = None
    secondary_group: Optional[str] = None
    sort_order: Optional[int] = 0
    note: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class EstimateBase(BaseModel):
    """Base schema for estimates"""
    estimate_number: Optional[str] = None
    estimate_type: Optional[str] = "standard"  # standard or insurance
    company_id: Optional[UUID] = None
    client_name: str
    client_address: Optional[str] = None
    client_city: Optional[str] = None
    client_state: Optional[str] = None
    client_zipcode: Optional[str] = None
    client_phone: Optional[str] = None
    client_email: Optional[str] = None
    
    estimate_date: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    status: Optional[str] = "draft"
    
    notes: Optional[str] = None
    terms: Optional[str] = None
    
    # Insurance estimate specific fields
    claim_number: Optional[str] = None
    policy_number: Optional[str] = None
    deductible: Optional[float] = None
    
    # Room data for floor plans
    room_data: Optional[Dict[str, Any]] = None


class EstimateCreate(EstimateBase):
    """Schema for creating estimates"""
    items: List[EstimateItemCreate] = []


class EstimateUpdate(BaseModel):
    """Schema for updating estimates"""
    estimate_number: Optional[str] = None
    estimate_type: Optional[str] = None  # standard or insurance
    client_name: Optional[str] = None
    client_address: Optional[str] = None
    client_city: Optional[str] = None
    client_state: Optional[str] = None
    client_zipcode: Optional[str] = None
    client_phone: Optional[str] = None
    client_email: Optional[str] = None
    
    estimate_date: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    status: Optional[str] = None
    
    notes: Optional[str] = None
    terms: Optional[str] = None
    
    # Insurance fields
    claim_number: Optional[str] = None
    policy_number: Optional[str] = None
    deductible: Optional[float] = None
    
    # Room data
    room_data: Optional[Dict[str, Any]] = None
    
    # Items
    items: Optional[List[EstimateItemCreate]] = None


class EstimateListResponse(BaseModel):
    """Response schema for estimate list"""
    id: UUID
    estimate_number: str
    estimate_type: Optional[str] = "standard"  # standard or insurance
    company_id: Optional[UUID] = None
    client_name: str
    total_amount: float
    status: str
    estimate_date: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class EstimateResponse(BaseModel):
    """Full response schema for estimates"""
    id: UUID
    estimate_number: str
    estimate_type: Optional[str] = "standard"  # standard or insurance
    company_id: Optional[UUID] = None
    
    # Client info
    client_name: str
    client_address: Optional[str] = None
    client_city: Optional[str] = None
    client_state: Optional[str] = None
    client_zipcode: Optional[str] = None
    client_phone: Optional[str] = None
    client_email: Optional[str] = None
    
    # Dates
    estimate_date: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    status: str = "draft"
    
    # Financial
    subtotal: float = 0.0
    tax_rate: float = 0.0
    tax_amount: float = 0.0
    discount_amount: float = 0.0
    total_amount: float = 0.0
    
    # Insurance specific
    claim_number: Optional[str] = None
    policy_number: Optional[str] = None
    deductible: Optional[float] = None
    depreciation_amount: Optional[float] = 0.0
    acv_amount: Optional[float] = 0.0
    rcv_amount: Optional[float] = 0.0
    
    # Additional
    notes: Optional[str] = None
    terms: Optional[str] = None
    room_data: Optional[Dict[str, Any]] = None
    
    # Relationships
    items: List[EstimateItemResponse] = []
    
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class EstimateNumberResponse(BaseModel):
    """Response schema for generated estimate number"""
    estimate_number: str
    sequence: int
    company_prefix: Optional[str] = None
    year: str
    
    class Config:
        from_attributes = True


class EstimatePDFRequest(BaseModel):
    """Request model for generating PDF preview"""
    estimate_number: str = Field(default_factory=lambda: f"EST-{datetime.now().strftime('%Y%m%d-%H%M%S')}")
    estimate_date: str = Field(default_factory=lambda: datetime.now().strftime("%Y-%m-%d"))
    valid_until: Optional[str] = None
    
    company: Dict[str, Any]  # Company info
    client: Dict[str, Any]  # Client info
    
    items: List[Dict[str, Any]] = []
    room_data: Optional[Dict[str, Any]] = None
    
    # Financial
    subtotal: float = 0
    tax_rate: float = 0
    tax_amount: float = 0
    discount_amount: float = 0
    total_amount: float = 0
    
    # Insurance
    claim_number: Optional[str] = None
    policy_number: Optional[str] = None
    deductible: Optional[float] = None
    depreciation_amount: Optional[float] = 0
    acv_amount: Optional[float] = 0
    rcv_amount: Optional[float] = 0
    
    notes: Optional[str] = None
    terms: Optional[str] = None