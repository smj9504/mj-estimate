"""
Document schemas (base for estimates and invoices)
"""

from typing import Optional, List, Literal
from pydantic import BaseModel
from datetime import datetime
from decimal import Decimal

DocumentType = Literal["estimate", "invoice", "insurance_estimate", "plumber_report"]
DocumentStatus = Literal["draft", "sent", "paid", "cancelled"]

class DocumentItem(BaseModel):
    """Document item schema"""
    id: Optional[str] = None
    description: str
    quantity: float
    unit_price: float
    total: float
    unit: Optional[str] = None
    order: Optional[int] = None

class DocumentBase(BaseModel):
    """Base document schema"""
    company_id: str
    client_name: str
    client_email: Optional[str] = None
    client_phone: Optional[str] = None
    client_address: Optional[str] = None
    notes: Optional[str] = None
    status: DocumentStatus = "draft"

class Document(DocumentBase):
    """Document schema with all fields"""
    id: str
    type: DocumentType
    document_number: str
    total_amount: float
    created_at: datetime
    updated_at: datetime
    items: Optional[List[DocumentItem]] = []
    
    class Config:
        from_attributes = True

class DocumentFilter(BaseModel):
    """Document filter schema"""
    type: Optional[DocumentType] = None
    status: Optional[DocumentStatus] = None
    company_id: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    search: Optional[str] = None

class PaginatedDocuments(BaseModel):
    """Paginated documents response"""
    items: List[dict]  # Changed from data to items and from Document to dict
    total: int
    page: int
    page_size: int  # Changed from pageSize to page_size
    total_pages: int  # Added field