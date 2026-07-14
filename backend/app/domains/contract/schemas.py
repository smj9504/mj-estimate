"""
Contract domain Pydantic schemas
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, validator


# ============================================================
# ContractTemplate schemas
# ============================================================

class ContractTemplateCreate(BaseModel):
    company_id: UUID
    name: str
    document_type: str = "authorization"
    description: Optional[str] = None
    requires_signature: bool = True
    signature_roles: Optional[str] = '["homeowner"]'  # JSON string

    @validator('document_type')
    def validate_document_type(cls, v):
        allowed = [
            'authorization', 'certificate_of_satisfaction',
            'certificate_of_completion',
            'scope_of_work', 'lien_waiver', 'change_order', 'other'
        ]
        if v not in allowed:
            raise ValueError(f"document_type must be one of {allowed}")
        return v


class ContractTemplateUpdate(BaseModel):
    name: Optional[str] = None
    document_type: Optional[str] = None
    description: Optional[str] = None
    requires_signature: Optional[bool] = None
    signature_roles: Optional[str] = None
    is_active: Optional[bool] = None


class ContractTemplateResponse(BaseModel):
    id: UUID
    company_id: UUID
    company_name: Optional[str] = None
    name: str
    document_type: str
    description: Optional[str] = None
    file_url: Optional[str] = None
    file_name: Optional[str] = None
    file_size: Optional[int] = None
    requires_signature: bool = True
    signature_roles: Optional[str] = None
    field_mappings: Optional[str] = None  # JSON string
    is_active: bool = True
    version: int = 1
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ============================================================
# Field Mapping schemas
# ============================================================

class FieldMappingItem(BaseModel):
    """Single field placement on a PDF template"""
    id: str
    pageIndex: int
    x: float = Field(..., ge=0, le=1, description="X position as ratio (0-1)")
    y: float = Field(..., ge=0, le=1, description="Y position as ratio (0-1)")
    width: float = Field(..., gt=0, le=1, description="Width as ratio (0-1)")
    height: float = Field(..., gt=0, le=1, description="Height as ratio (0-1)")
    fieldKey: str = Field(..., description="Data source key, e.g. client.display_name or signature.homeowner")
    label: str = Field(..., description="Display label for the field")
    fontSize: int = Field(12, ge=6, le=72)
    fontColor: str = Field("#000000")
    fieldType: Optional[str] = Field(
        None, description="text | signature | initial | date_signed"
    )
    signerRole: Optional[str] = Field(
        None, description="homeowner | company_rep | witness"
    )


class FieldMappingUpdate(BaseModel):
    """Update field mappings on a template"""
    field_mappings: List[FieldMappingItem]


class FieldMappingResponse(BaseModel):
    """Field mappings with available fields list"""
    field_mappings: List[FieldMappingItem] = []
    available_fields: List[Dict[str, Any]] = []


# ============================================================
# ContractInstance schemas
# ============================================================

class ContractInstanceCreate(BaseModel):
    template_id: UUID
    claim_id: UUID
    client_id: UUID
    company_id: UUID
    title: Optional[str] = None
    notes: Optional[str] = None
    token_expires_days: int = Field(30, ge=1, le=365)
    prefill_overrides: Optional[Dict[str, Any]] = None  # user-edited prefill values


class ContractInstanceUpdate(BaseModel):
    title: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None


class ContractInstanceResponse(BaseModel):
    id: UUID
    template_id: UUID
    claim_id: UUID
    client_id: UUID
    company_id: UUID
    contract_number: Optional[str] = None
    title: Optional[str] = None
    notes: Optional[str] = None
    status: str = "draft"
    signing_token: Optional[str] = None
    token_expires_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    viewed_at: Optional[datetime] = None
    signed_at: Optional[datetime] = None
    voided_at: Optional[datetime] = None
    filled_pdf_url: Optional[str] = None
    signed_pdf_url: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    # Nested info (populated by service)
    template_name: Optional[str] = None
    company_name: Optional[str] = None
    client_name: Optional[str] = None
    signature_count: int = 0
    signatures: Optional[List[dict]] = None

    class Config:
        from_attributes = True


# ============================================================
# ContractSignature schemas (for public signing)
# ============================================================

class SigningRequest(BaseModel):
    """Public signing endpoint request"""
    signer_name: str = Field(
        "", max_length=255
    )
    signer_role: str = Field("homeowner")
    signature_image: str = Field(
        ..., description="Base64 PNG signature image"
    )
    signature_type: str = Field(
        "drawn", description="drawn | typed"
    )
    typed_name: Optional[str] = Field(
        None, description="Name text for typed signatures"
    )
    signature_fields: Optional[Dict[str, str]] = Field(
        None,
        description="Map of field ID -> base64 image or date"
    )
    consent_agreed: bool = Field(
        False, description="E-sign consent acknowledged"
    )
    consent_text: Optional[str] = Field(
        None, description="Consent clause text shown"
    )

    @validator('signer_role')
    def validate_role(cls, v):
        allowed = ['homeowner', 'company_rep', 'witness']
        if v not in allowed:
            raise ValueError(f"signer_role must be one of {allowed}")
        return v

    @validator('signature_type')
    def validate_signature_type(cls, v):
        allowed = ['drawn', 'typed']
        if v not in allowed:
            raise ValueError(f"signature_type must be one of {allowed}")
        return v


class SigningResponse(BaseModel):
    """Public signing endpoint response"""
    contract_id: UUID
    signer_name: str
    signed_at: datetime
    message: str = "Contract signed successfully"


class SignatureFieldPlacement(BaseModel):
    """Signature/initial field position on the PDF"""
    id: str
    pageIndex: int
    x: float
    y: float
    width: float
    height: float
    fieldType: str  # signature | initial | date_signed
    signerRole: str
    label: str


class ContractViewResponse(BaseModel):
    """Public contract view (for signing page)"""
    contract_id: UUID
    title: Optional[str] = None
    company_name: Optional[str] = None
    client_name: Optional[str] = None
    template_name: Optional[str] = None
    document_type: Optional[str] = None
    file_url: Optional[str] = None
    filled_pdf_url: Optional[str] = None
    status: str
    requires_signature: bool = True
    signature_roles: Optional[str] = None
    signature_fields: List[SignatureFieldPlacement] = []
    existing_signatures: List[dict] = []


# ============================================================
# Prefill Preview schemas
# ============================================================

class PrefillPreviewResponse(BaseModel):
    """Prefill data preview for contract generation"""
    client: Dict[str, Any] = {}
    claim: Dict[str, Any] = {}
    company: Dict[str, Any] = {}
    meta: Dict[str, Any] = {}
    field_mappings: List[Dict[str, Any]] = []


# ============================================================
# Dashboard schemas
# ============================================================

class CompanyContractSummary(BaseModel):
    """Contract summary per company in a claim"""
    company_id: UUID
    company_name: str
    role: Optional[str] = None
    is_primary: bool = False
    contracts: List[Dict[str, Any]] = []
    summary: Dict[str, int] = {}


class ClaimContractDashboard(BaseModel):
    """All contracts for a claim grouped by company"""
    claim_id: UUID
    companies: List[CompanyContractSummary] = []
    total_contracts: int = 0


# ============================================================
# ClaimCompany schemas
# ============================================================

class ClaimCompanyCreate(BaseModel):
    company_id: UUID
    role: str
    is_primary: bool = False
    notes: Optional[str] = None

    @validator('role')
    def validate_role(cls, v):
        allowed = ['plumber', 'water_mitigation', 'reconstruction', 'moving', 'other']
        if v not in allowed:
            raise ValueError(f"role must be one of {allowed}")
        return v


class ClaimCompanyResponse(BaseModel):
    id: UUID
    claim_id: UUID
    company_id: UUID
    company_name: Optional[str] = None
    role: str
    is_primary: bool = False
    notes: Optional[str] = None
    assigned_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True
