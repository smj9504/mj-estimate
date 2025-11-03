"""
Line Items domain Pydantic schemas
"""

from pydantic import BaseModel, Field, field_validator, model_validator, computed_field
from typing import List, Optional, Dict, Any, Annotated
from datetime import datetime
from uuid import UUID
from decimal import Decimal
from enum import Enum


class LineItemType(str, Enum):
    """Line item type enumeration"""
    XACTIMATE = "XACTIMATE"
    CUSTOM = "CUSTOM"


# =====================================================
# Category Schemas
# =====================================================
class LineItemCategoryBase(BaseModel):
    """Base schema for line item categories"""
    code: str = Field(..., max_length=50)
    name: str = Field(..., max_length=200)
    description: Optional[str] = None
    parent_code: Optional[str] = Field(None, max_length=50)
    display_order: int = 0
    is_active: bool = True


class LineItemCategoryCreate(LineItemCategoryBase):
    """Schema for creating a category"""
    pass


class LineItemCategoryUpdate(BaseModel):
    """Schema for updating a category"""
    name: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = None
    parent_code: Optional[str] = Field(None, max_length=50)
    display_order: Optional[int] = None
    is_active: Optional[bool] = None


class LineItemCategoryResponse(LineItemCategoryBase):
    """Schema for category response"""
    created_at: datetime
    updated_at: Optional[datetime] = None
    subcategories: List['LineItemCategoryResponse'] = []
    
    model_config = {"from_attributes": True}


class TaxMethod(str, Enum):
    """Tax calculation method"""
    percentage = "percentage"
    specific = "specific"
    none = "none"


# =====================================================
# Line Item Note Schemas
# =====================================================
class LineItemNoteBase(BaseModel):
    """Base schema for line item notes"""
    title: Optional[str] = Field(None, max_length=200)
    content: str = Field(..., min_length=1)
    category: Optional[str] = Field(None, max_length=50)
    is_template: bool = True


class LineItemNoteCreate(LineItemNoteBase):
    """Schema for creating a line item note"""
    company_id: Optional[UUID] = None


class LineItemNoteUpdate(BaseModel):
    """Schema for updating a line item note"""
    title: Optional[str] = Field(None, max_length=200)
    content: Optional[str] = Field(None, min_length=1)
    category: Optional[str] = Field(None, max_length=50)
    is_template: Optional[bool] = None


class LineItemNoteResponse(LineItemNoteBase):
    """Schema for line item note response"""
    id: UUID
    company_id: Optional[UUID] = None
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    model_config = {"from_attributes": True}


# =====================================================
# Line Item Schemas
# =====================================================
class LineItemBase(BaseModel):
    """Base schema for line items - simplified for custom items only"""
    cat: Optional[str] = Field(None, max_length=50)
    item: Optional[str] = Field(None, max_length=50)
    description: str = Field(..., min_length=1)
    includes: Optional[str] = None
    unit: Optional[str] = Field(None, max_length=50)
    
    # Optional detailed cost breakdown (can be used for custom items too)
    lab: Optional[Decimal] = Field(None, ge=0)
    mat: Optional[Decimal] = Field(None, ge=0)
    equ: Optional[Decimal] = Field(None, ge=0)
    labor_burden: Optional[Decimal] = Field(None, ge=0)
    market_condition: Optional[Decimal] = Field(None, ge=0)
    
    # Required unit price for custom items
    untaxed_unit_price: Decimal = Field(..., gt=0)
    
    @field_validator('untaxed_unit_price')
    @classmethod
    def ensure_positive_price(cls, v):
        """Ensure unit price is positive"""
        if v is None or v <= 0:
            raise ValueError('Line items must have a positive untaxed_unit_price')
        return v


class LineItemCreate(LineItemBase):
    """Schema for creating a line item"""
    type: Optional[LineItemType] = Field(LineItemType.CUSTOM, description="Line item type")
    company_id: Optional[UUID] = None
    is_active: bool = True
    note_ids: Optional[List[UUID]] = []  # Attach existing notes
    save_to_library: bool = True  # If False, create temporary item for one-time use


class LineItemUpdate(BaseModel):
    """Schema for updating a line item"""
    cat: Optional[str] = Field(None, max_length=50)
    item: Optional[str] = Field(None, max_length=50)
    description: Optional[str] = Field(None, min_length=1)
    includes: Optional[str] = None
    unit: Optional[str] = Field(None, max_length=50)
    
    # Xactimate fields
    lab: Optional[Decimal] = Field(None, ge=0)
    mat: Optional[Decimal] = Field(None, ge=0)
    equ: Optional[Decimal] = Field(None, ge=0)
    labor_burden: Optional[Decimal] = Field(None, ge=0)
    market_condition: Optional[Decimal] = Field(None, ge=0)
    
    # Custom price
    untaxed_unit_price: Optional[Decimal] = Field(None, ge=0)
    
    is_active: Optional[bool] = None
    note_ids: Optional[List[UUID]] = None  # Update attached notes


class LineItemResponse(LineItemBase):
    """Schema for line item response"""
    id: UUID
    is_active: bool
    version: int
    company_id: Optional[UUID] = None
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    notes: List[LineItemNoteResponse] = []
    
    model_config = {"from_attributes": True}
    
    @computed_field
    @property
    def calculated_price(self) -> Optional[Decimal]:
        """Calculate the price - use breakdown if available, otherwise use unit price"""
        # If detailed breakdown is provided, calculate from components
        breakdown_fields = [self.lab, self.mat, self.equ, self.labor_burden, self.market_condition]
        breakdown_total = Decimal('0')
        has_breakdown = False
        
        for field_value in breakdown_fields:
            if field_value and field_value > 0:
                breakdown_total += field_value
                has_breakdown = True
        
        # Return breakdown total if available, otherwise return unit price
        return breakdown_total if has_breakdown else self.untaxed_unit_price


class LineItemSearch(BaseModel):
    """Schema for searching line items"""
    type: Optional[LineItemType] = None  # Filter by line item type
    cat: Optional[str] = None  # Filter by category code
    item: Optional[str] = None  # Filter by item code
    search_term: Optional[str] = None  # Search in description and includes (ILIKE)
    description: Optional[str] = None  # Specific description search
    company_id: Optional[UUID] = None
    is_active: Optional[bool] = True
    page: int = Field(1, ge=1)
    page_size: int = Field(20, ge=1, le=100)


# =====================================================
# Template Schemas
# =====================================================
class EmbeddedItemData(BaseModel):
    """Schema for embedded item data in templates

    This allows templates to store item information directly
    instead of requiring a line_item_id reference.
    """
    item_code: str = Field(..., max_length=50, description="Item name/code (e.g., 'RDG', 'ITEM001')")
    description: Optional[str] = Field(None, description="Item display name")
    includes: Optional[str] = Field(None, description="Work description/details")
    unit: Optional[str] = Field("EA", max_length=50, description="Measurement unit")
    rate: Decimal = Field(..., gt=0, description="Unit price")
    type: Optional[str] = Field("CUSTOM", description="Item type: CUSTOM or XACTIMATE")

    # Optional Xactimate breakdown
    lab: Optional[Decimal] = Field(None, ge=0)
    mat: Optional[Decimal] = Field(None, ge=0)
    equ: Optional[Decimal] = Field(None, ge=0)
    labor_burden: Optional[Decimal] = Field(None, ge=0)
    market_condition: Optional[Decimal] = Field(None, ge=0)


class TemplateLineItemBase(BaseModel):
    """Base schema for template line items

    Supports two modes:
    1. Reference mode: provide line_item_id
    2. Embedded mode: provide embedded_data

    One and only one must be provided.
    """
    line_item_id: Optional[UUID] = Field(None, description="Reference to existing line item (reference mode)")
    embedded_data: Optional[EmbeddedItemData] = Field(None, description="Embedded item data (embedded mode)")
    quantity_multiplier: Decimal = Field(Decimal('1'), ge=0)
    order_index: int = 0

    @model_validator(mode='after')
    def validate_item_reference(self):
        """Ensure either line_item_id OR embedded_data is provided"""
        if self.line_item_id is None and self.embedded_data is None:
            raise ValueError("Either line_item_id or embedded_data must be provided")

        if self.line_item_id is not None and self.embedded_data is not None:
            raise ValueError("Cannot provide both line_item_id and embedded_data")

        return self


class TemplateLineItemCreate(TemplateLineItemBase):
    """Schema for adding line item to template"""
    pass


class TemplateLineItemResponse(BaseModel):
    """Schema for template line item response

    Returns the template item with either:
    - line_item: full LineItem object (reference mode)
    - embedded_data: embedded item data (embedded mode)
    """
    id: UUID
    line_item_id: Optional[UUID] = None
    embedded_data: Optional[EmbeddedItemData] = None
    quantity_multiplier: Decimal
    order_index: int

    # Full line item object if reference mode
    line_item: Optional[LineItemResponse] = None

    model_config = {"from_attributes": True}


class LineItemTemplateBase(BaseModel):
    """Base schema for line item templates"""
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    category: Optional[str] = Field(None, max_length=100)


class LineItemTemplateCreate(LineItemTemplateBase):
    """Schema for creating a template"""
    company_id: Optional[UUID] = None
    line_item_ids: Optional[List[TemplateLineItemCreate]] = []


class LineItemTemplateUpdate(BaseModel):
    """Schema for updating a template"""
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    category: Optional[str] = Field(None, max_length=100)
    is_active: Optional[bool] = None
    line_item_ids: Optional[List[TemplateLineItemCreate]] = None


class LineItemTemplateResponse(LineItemTemplateBase):
    """Schema for template response"""
    id: UUID
    company_id: Optional[UUID] = None
    is_active: bool
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    template_items: List[TemplateLineItemResponse] = []
    
    model_config = {"from_attributes": True}


# =====================================================
# Invoice/Estimate Integration Schemas
# =====================================================
class LineItemOverride(BaseModel):
    """Schema for line item value overrides in invoices/estimates"""
    lab: Optional[Decimal] = None
    mat: Optional[Decimal] = None
    equ: Optional[Decimal] = None
    labor_burden: Optional[Decimal] = None
    market_condition: Optional[Decimal] = None
    untaxed_unit_price: Optional[Decimal] = None
    quantity: Optional[Decimal] = None
    description: Optional[str] = None


class InvoiceLineItemCreate(BaseModel):
    """Schema for adding line item to invoice"""
    line_item_id: Optional[UUID] = None  # Reference existing item
    custom_item: Optional[LineItemBase] = None  # Or create inline custom
    quantity: Decimal = Field(Decimal('1'), ge=0)
    override_values: Optional[LineItemOverride] = None
    order_index: int = 0


class EstimateLineItemCreate(BaseModel):
    """Schema for adding line item to estimate"""
    line_item_id: Optional[UUID] = None  # Reference existing item
    custom_item: Optional[LineItemBase] = None  # Or create inline custom
    room: Optional[str] = None  # Room assignment for estimates
    quantity: Decimal = Field(Decimal('1'), ge=0)
    override_values: Optional[LineItemOverride] = None
    order_index: int = 0


# =====================================================
# Tax Calculation Schemas
# =====================================================
class TaxCalculationRequest(BaseModel):
    """Request schema for tax calculation"""
    line_item_id: UUID
    quantity: Decimal = Field(Decimal('1'), ge=0)
    tax_method: TaxMethod
    tax_rate: Decimal = Field(Decimal('0'), ge=0, le=100)
    override_values: Optional[LineItemOverride] = None


class TaxCalculationResponse(BaseModel):
    """Response schema for tax calculation"""
    subtotal: Decimal
    taxable_amount: Decimal
    tax_amount: Decimal
    total: Decimal
    breakdown: Dict[str, Decimal]


# =====================================================
# Bulk Operations
# =====================================================
class BulkLineItemCreate(BaseModel):
    """Schema for bulk creating line items"""
    items: List[LineItemCreate]


class BulkTemplateApply(BaseModel):
    """Schema for applying template to invoice/estimate"""
    template_id: UUID
    target_type: str = Field(..., pattern="^(invoice|estimate)$")
    target_id: UUID
    quantity_multiplier: Decimal = Field(Decimal('1'), ge=0)


class LineItemImportRequest(BaseModel):
    """Schema for importing line items from external source"""
    source_type: str = Field(..., pattern="^(csv|excel|json)$")
    data: str  # Base64 encoded file content
    mapping: Optional[Dict[str, str]] = None  # Field mapping


class LineItemExportRequest(BaseModel):
    """Schema for exporting line items"""
    format: str = Field(..., pattern="^(csv|excel|json|pdf)$")
    filters: Optional[LineItemSearch] = None
    include_notes: bool = True
    include_templates: bool = False