"""
Pydantic schemas for Plumber Report
"""

from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field
from uuid import UUID


class ClientInfo(BaseModel):
    """Client information schema"""
    name: str
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zipcode: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None


class PropertyInfo(BaseModel):
    """Property information schema"""
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zipcode: Optional[str] = None


class InvoiceItem(BaseModel):
    """Invoice item schema"""
    name: str
    description: Optional[str] = None
    quantity: float = 0
    unit: Optional[str] = None
    unit_cost: float = 0
    total_cost: float = 0
    

class PaymentRecord(BaseModel):
    """Payment record schema"""
    amount: float
    date: Optional[datetime] = None
    method: Optional[str] = None
    reference: Optional[str] = None
    notes: Optional[str] = None


class PhotoRecord(BaseModel):
    """Photo record schema"""
    id: str
    url: str
    category: str = Field(..., description="before, during, after, damage, equipment, other")
    caption: Optional[str] = None
    timestamp: Optional[datetime] = None


class FinancialSummary(BaseModel):
    """Financial summary schema"""
    labor_cost: float = 0
    materials_cost: float = 0
    equipment_cost: float = 0
    subtotal: float = 0
    tax_amount: float = 0
    discount: float = 0
    total_amount: float = 0
    balance_due: float = 0


class PlumberReportBase(BaseModel):
    """Base schema for Plumber Report"""
    report_number: Optional[str] = None
    template_type: str = "standard"
    status: str = "draft"
    
    # Client and Property
    client: ClientInfo
    property: PropertyInfo
    
    # Service Details
    service_date: datetime
    technician_name: Optional[str] = None
    license_number: Optional[str] = None
    
    # Report Content
    cause_of_damage: Optional[str] = None
    work_performed: Optional[str] = None
    materials_equipment_text: Optional[str] = None
    recommendations: Optional[str] = None
    
    # Additional Information
    warranty_info: Optional[str] = None
    terms_conditions: Optional[str] = None
    notes: Optional[str] = None


class PlumberReportCreate(PlumberReportBase):
    """Schema for creating a Plumber Report"""
    company_id: Optional[UUID] = None
    invoice_items: List[InvoiceItem] = []
    payments: List[PaymentRecord] = []
    show_payment_dates: bool = True
    photos: List[PhotoRecord] = []
    financial: Optional[FinancialSummary] = None


class PlumberReportUpdate(BaseModel):
    """Schema for updating a Plumber Report"""
    report_number: Optional[str] = None
    template_type: Optional[str] = None
    status: Optional[str] = None
    
    client: Optional[ClientInfo] = None
    property: Optional[PropertyInfo] = None
    
    service_date: Optional[datetime] = None
    technician_name: Optional[str] = None
    license_number: Optional[str] = None
    
    cause_of_damage: Optional[str] = None
    work_performed: Optional[str] = None
    materials_equipment_text: Optional[str] = None
    recommendations: Optional[str] = None
    
    invoice_items: Optional[List[InvoiceItem]] = None
    payments: Optional[List[PaymentRecord]] = None
    show_payment_dates: Optional[bool] = None
    photos: Optional[List[PhotoRecord]] = None
    financial: Optional[FinancialSummary] = None
    
    warranty_info: Optional[str] = None
    terms_conditions: Optional[str] = None
    notes: Optional[str] = None


class PlumberReportResponse(PlumberReportBase):
    """Schema for Plumber Report response"""
    id: UUID
    company_id: Optional[UUID] = None
    company_data: Optional[Dict[str, Any]] = None
    
    invoice_items: List[InvoiceItem] = []
    payments: List[PaymentRecord] = []
    show_payment_dates: bool = True
    photos: List[PhotoRecord] = []
    financial: FinancialSummary
    
    created_at: datetime
    updated_at: Optional[datetime] = None
    created_by: Optional[str] = None
    updated_by: Optional[str] = None
    
    class Config:
        from_attributes = True


class PlumberReportListResponse(BaseModel):
    """Schema for list of Plumber Reports"""
    reports: List[PlumberReportResponse]
    total: int
    page: int
    limit: int


class PlumberReportPDFRequest(BaseModel):
    """Schema for PDF generation request"""
    report_data: PlumberReportResponse
    include_photos: bool = True
    include_financial: bool = True
    page_size: str = "letter"  # letter, a4
    orientation: str = "portrait"  # portrait, landscape