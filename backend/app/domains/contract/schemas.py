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
    is_active: bool = True
    version: int = 1
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


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
    signer_name: str = Field(..., min_length=1, max_length=255)
    signer_role: str = Field("homeowner")
    signature_image: str = Field(..., description="Base64 PNG signature image")

    @validator('signer_role')
    def validate_role(cls, v):
        allowed = ['homeowner', 'company_rep', 'witness']
        if v not in allowed:
            raise ValueError(f"signer_role must be one of {allowed}")
        return v


class SigningResponse(BaseModel):
    """Public signing endpoint response"""
    contract_id: UUID
    signer_name: str
    signed_at: datetime
    message: str = "Contract signed successfully"


class ContractViewResponse(BaseModel):
    """Public contract view (for signing page)"""
    contract_id: UUID
    title: Optional[str] = None
    company_name: Optional[str] = None
    client_name: Optional[str] = None
    template_name: Optional[str] = None
    document_type: Optional[str] = None
    file_url: Optional[str] = None
    status: str
    requires_signature: bool = True
    signature_roles: Optional[str] = None
    existing_signatures: List[dict] = []


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
