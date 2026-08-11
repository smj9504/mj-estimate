"""
AccuLynx integration Pydantic schemas (request/response).
"""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class AccuLynxJobSearchItem(BaseModel):
    """One result row from an AccuLynx job/lead search."""
    id: str
    job_number: Optional[str] = None
    job_name: Optional[str] = None
    address: Optional[str] = None
    current_milestone: Optional[str] = None


class AccuLynxJobSearchResponse(BaseModel):
    items: List[AccuLynxJobSearchItem]
    count: int = 0


class AccuLynxLinkRequest(BaseModel):
    acculynx_job_id: str
    acculynx_job_number: Optional[str] = None


class AccuLynxLinkResponse(BaseModel):
    claim_id: str
    acculynx_job_id: str
    acculynx_job_number: Optional[str] = None
    linked_at: datetime

    class Config:
        from_attributes = True


class AccuLynxSyncFileResult(BaseModel):
    source_table: str  # 'file' | 'wm_photo' | 'wm_document'
    source_id: str
    filename: Optional[str] = None
    status: str  # 'success' | 'failed' | 'skipped'
    error_message: Optional[str] = None


class AccuLynxSyncResult(BaseModel):
    claim_id: str
    acculynx_job_id: str
    total_candidates: int
    already_synced: int
    succeeded: int
    failed: int
    results: List[AccuLynxSyncFileResult]


class AccuLynxContactSearchItem(BaseModel):
    id: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    company_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None


class AccuLynxContactSearchResponse(BaseModel):
    items: List[AccuLynxContactSearchItem]
    count: int = 0


class AccuLynxUserItem(BaseModel):
    id: str
    display_name: str
    role: Optional[str] = None


class AccuLynxAddressInput(BaseModel):
    street1: str
    street2: Optional[str] = None
    city: str
    state: str
    zip_code: str
    country: str = "USA"


class AccuLynxNewContactInput(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[AccuLynxAddressInput] = None


class AccuLynxCreateLeadRequest(BaseModel):
    # Either reuse an existing AccuLynx contact...
    contact_id: Optional[str] = None
    # ...or create a new one from these fields
    new_contact: Optional[AccuLynxNewContactInput] = None

    address: Optional[AccuLynxAddressInput] = None
    notes: Optional[str] = None
    representative_user_id: Optional[str] = None


class AccuLynxContactLinkResponse(BaseModel):
    client_id: str
    acculynx_contact_id: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    company_name: Optional[str] = None


class AccuLynxUploadStatus(BaseModel):
    source_table: str
    source_id: str
    filename: Optional[str] = None
    status: str
    error_message: Optional[str] = None
    uploaded_at: Optional[datetime] = None

    class Config:
        from_attributes = True
