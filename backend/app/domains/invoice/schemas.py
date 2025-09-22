"""
Invoice domain Pydantic schemas
"""

from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict, Any
from datetime import datetime, date
from uuid import UUID


# Nested schemas
class CompanyInfo(BaseModel):
    name: str
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zipcode: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    logo: Optional[str] = None
    website: Optional[str] = None


class ClientInfo(BaseModel):
    name: str
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zipcode: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None


class InsuranceInfo(BaseModel):
    company: Optional[str] = None
    policy_number: Optional[str] = None
    claim_number: Optional[str] = None
    deductible: Optional[float] = None


class PaymentRecord(BaseModel):
    """Payment record schema"""
    amount: float = Field(..., description="Payment amount")
    date: str = Field(..., description="Payment date (YYYY-MM-DD)")
    method: Optional[str] = Field(None, max_length=2, description="Payment method code (2 chars)")
    reference: Optional[str] = Field(None, description="Payment reference/memo")
    
    @validator('amount')
    def validate_amount(cls, v):
        if v <= 0:
            raise ValueError('Payment amount must be positive')
        return v
    
    @validator('date', pre=True)
    def validate_date_format(cls, v):
        """Validate and convert date to YYYY-MM-DD format"""
        if isinstance(v, str):
            # Try to parse various date formats
            try:
                if '-' in v:
                    parts = v.split('-')
                    if len(parts[0]) == 4:  # Already YYYY-MM-DD
                        return v
                    elif len(parts[0]) == 2:  # MM-DD-YYYY
                        month, day, year = parts
                        return f"{year}-{month.zfill(2)}-{day.zfill(2)}"
                elif '/' in v:  # MM/DD/YYYY
                    month, day, year = v.split('/')
                    return f"{year}-{month.zfill(2)}-{day.zfill(2)}"
            except (ValueError, IndexError):
                raise ValueError('Invalid date format. Use YYYY-MM-DD, MM-DD-YYYY, or MM/DD/YYYY')
        return v


class InvoiceItemBase(BaseModel):
    name: str
    description: Optional[str] = None
    quantity: float = 1
    unit: str = "ea"
    rate: float = 0
    taxable: Optional[bool] = True

    # Section/Group fields
    primary_group: Optional[str] = None  # Section name
    secondary_group: Optional[str] = None  # Sub-category (optional)
    sort_order: Optional[int] = 0  # Sort order within section


class InvoiceItemCreate(InvoiceItemBase):
    pass


class InvoiceItemResponse(InvoiceItemBase):
    id: UUID
    invoice_id: Optional[UUID] = None
    amount: float
    taxable: Optional[bool] = True
    order_index: Optional[int] = None

    # Section/Group fields (inherited from base but explicitly included for clarity)
    primary_group: Optional[str] = None
    secondary_group: Optional[str] = None
    sort_order: Optional[int] = 0

    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Main invoice schemas
class InvoiceBase(BaseModel):
    invoice_number: Optional[str] = None
    date: Optional[str] = None  # Accept string dates
    due_date: Optional[str] = None  # Accept string dates
    status: Optional[str] = "draft"
    
    # Either use company_id OR company info
    company_id: Optional[UUID] = None  # For saved companies
    company: Optional[CompanyInfo] = None  # For custom companies
    client: ClientInfo
    insurance: Optional[InsuranceInfo] = None
    
    # Tax configuration
    tax_method: Optional[str] = Field("percentage", description="Tax calculation method: 'percentage' or 'specific'")
    tax_rate: Optional[float] = 0
    tax_amount: Optional[float] = 0

    # Other financial fields
    op_percent: Optional[float] = 0  # O&P percentage
    discount: Optional[float] = 0
    paid_amount: Optional[float] = 0
    
    # Payment tracking
    payments: Optional[List[PaymentRecord]] = Field(default_factory=list, description="List of payment records")
    show_payment_dates: Optional[bool] = Field(True, description="Whether to show payment dates on invoice")
    balance_due: Optional[float] = 0
    
    @validator('tax_method')
    def validate_tax_method(cls, v):
        if v not in ['percentage', 'specific']:
            raise ValueError("tax_method must be 'percentage' or 'specific'")
        return v
    
    @validator('tax_rate')
    def validate_tax_rate(cls, v):
        if v < 0 or v > 100:
            raise ValueError('tax_rate must be between 0 and 100')
        return v
    
    payment_terms: Optional[str] = None
    notes: Optional[str] = None
    
    @validator('date', 'due_date', pre=True)
    def convert_date_format(cls, v):
        """Convert MM-DD-YYYY to YYYY-MM-DD for database storage"""
        if v and isinstance(v, str):
            # Check if it's MM-DD-YYYY format
            if '-' in v and len(v.split('-')) == 3:
                parts = v.split('-')
                # If first part is 4 digits, it's already YYYY-MM-DD
                if len(parts[0]) == 4:
                    return v
                # If first part is 2 digits, assume MM-DD-YYYY
                elif len(parts[0]) == 2 and len(parts[2]) == 4:
                    month, day, year = parts
                    return f"{year}-{month}-{day}"
            # Check if it's MM/DD/YYYY format
            elif '/' in v and len(v.split('/')) == 3:
                month, day, year = v.split('/')
                return f"{year}-{month.zfill(2)}-{day.zfill(2)}"
        return v


class InvoiceCreate(InvoiceBase):
    items: List[InvoiceItemCreate] = []
    
    # Additional fields from frontend
    subtotal: Optional[float] = None
    total: Optional[float] = None


class InvoiceUpdate(BaseModel):
    invoice_number: Optional[str] = None
    date: Optional[str] = None  # Changed to string
    due_date: Optional[str] = None  # Changed to string
    status: Optional[str] = None
    
    @validator('date', 'due_date', pre=True)
    def convert_date_format(cls, v):
        """Convert MM-DD-YYYY to YYYY-MM-DD for database storage"""
        if v and isinstance(v, str):
            # Check if it's MM-DD-YYYY format
            if '-' in v and len(v.split('-')) == 3:
                parts = v.split('-')
                # If first part is 4 digits, it's already YYYY-MM-DD
                if len(parts[0]) == 4:
                    return v
                # If first part is 2 digits, assume MM-DD-YYYY
                elif len(parts[0]) == 2 and len(parts[2]) == 4:
                    month, day, year = parts
                    return f"{year}-{month}-{day}"
            # Check if it's MM/DD/YYYY format
            elif '/' in v and len(v.split('/')) == 3:
                month, day, year = v.split('/')
                return f"{year}-{month.zfill(2)}-{day.zfill(2)}"
        return v
    
    company: Optional[CompanyInfo] = None
    client: Optional[ClientInfo] = None
    insurance: Optional[InsuranceInfo] = None
    
    items: Optional[List[InvoiceItemCreate]] = None
    
    # Tax configuration
    tax_method: Optional[str] = None
    tax_rate: Optional[float] = None
    tax_amount: Optional[float] = None
    op_percent: Optional[float] = None  # O&P percentage
    discount: Optional[float] = None
    paid_amount: Optional[float] = None
    
    # Payment tracking
    payments: Optional[List[PaymentRecord]] = None
    show_payment_dates: Optional[bool] = None
    balance_due: Optional[float] = None
    
    @validator('tax_method')
    def validate_tax_method(cls, v):
        if v is not None and v not in ['percentage', 'specific']:
            raise ValueError("tax_method must be 'percentage' or 'specific'")
        return v
    
    payment_terms: Optional[str] = None
    notes: Optional[str] = None


class InvoiceListResponse(BaseModel):
    id: UUID
    invoice_number: str
    date: str  # Changed to string
    due_date: str  # Changed to string
    status: str
    company_id: Optional[UUID] = None
    company_name: str
    client_name: str
    total: float
    paid_amount: float
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class InvoiceResponse(BaseModel):
    id: UUID
    invoice_number: str
    date: str  # Changed to string
    invoice_date: Optional[str] = None  # Added for compatibility
    due_date: str  # Changed to string
    status: str
    
    # Company info
    company_id: Optional[UUID] = None  # Added company_id
    company_name: str
    company_address: Optional[str]
    company_city: Optional[str]
    company_state: Optional[str]
    company_zipcode: Optional[str]
    company_phone: Optional[str]
    company_email: Optional[str]
    company_logo: Optional[str]
    
    # Client info
    client_name: str
    client_address: Optional[str]
    client_city: Optional[str]
    client_state: Optional[str]
    client_zipcode: Optional[str]
    client_phone: Optional[str]
    client_email: Optional[str]
    
    # Insurance info
    insurance_company: Optional[str]
    insurance_policy_number: Optional[str]
    insurance_claim_number: Optional[str]
    insurance_deductible: Optional[float]
    
    # Financial
    subtotal: float
    op_percent: Optional[float] = 0  # O&P percentage
    tax_method: Optional[str] = "percentage"
    tax_rate: float
    tax_amount: float
    discount: float
    discount_amount: Optional[float] = None  # Added for compatibility
    total: float
    total_amount: Optional[float] = None  # Added for compatibility
    paid_amount: float
    
    # Payment tracking
    payments: Optional[List[PaymentRecord]] = Field(default_factory=list)
    show_payment_dates: Optional[bool] = True
    balance_due: Optional[float] = 0
    
    # Additional
    payment_terms: Optional[str]
    notes: Optional[str]
    
    # Relationships
    items: List[InvoiceItemResponse] = []
    
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class InvoicePDFRequest(BaseModel):
    """Request model for generating PDF preview"""
    invoice_number: str = Field(default_factory=lambda: f"INV-{datetime.now().strftime('%Y%m%d-%H%M%S')}")
    date: str = Field(default_factory=lambda: datetime.now().strftime("%Y-%m-%d"))
    due_date: str = Field(default_factory=lambda: datetime.now().strftime("%Y-%m-%d"))
    
    company: CompanyInfo
    client: ClientInfo
    insurance: Optional[InsuranceInfo] = None
    
    items: List[InvoiceItemBase] = []
    
    subtotal: float = 0
    op_percent: Optional[float] = 0  # O&P percentage
    tax_method: Optional[str] = "percentage"
    tax_rate: float = 0
    tax_amount: float = 0
    discount: float = 0
    total: float = 0
    paid_amount: float = 0
    
    # Payment tracking for PDF
    payments: Optional[List[PaymentRecord]] = Field(default_factory=list)
    show_payment_dates: Optional[bool] = True
    balance_due: Optional[float] = 0

    payment_terms: Optional[str] = None
    notes: Optional[str] = None


class InvoiceNumberResponse(BaseModel):
    """Response model for invoice number generation"""
    invoice_number: str
    sequence: int
    company_code: Optional[str] = None
    year: str