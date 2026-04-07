"""
Crew Upload schemas for API request/response
"""

from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field


# ===== Public API Schemas (no auth) =====

class LinkInfoResponse(BaseModel):
    """Response when crew accesses an upload link"""
    valid: bool
    property_address: Optional[str] = None
    job_id: Optional[str] = None
    context: Optional[str] = None
    label: Optional[str] = None
    crew_name: Optional[str] = None
    max_files: int = 1000
    max_file_size_mb: int = 500
    upload_count: int = 0
    expires_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SessionCreateRequest(BaseModel):
    """Request to create an upload session"""
    total_files: int = Field(ge=1, le=1000)
    device_info: Optional[str] = None


class SessionCreateResponse(BaseModel):
    """Response with session token for resume capability"""
    session_token: str
    session_id: str

    class Config:
        from_attributes = True


class SessionStatusResponse(BaseModel):
    """Response with session upload progress"""
    session_token: str
    total_files: int
    completed_files: int
    failed_files: int
    completed_fingerprints: List[str] = []
    status: str

    class Config:
        from_attributes = True


class FileUploadMetadata(BaseModel):
    """Metadata sent with each file upload"""
    fingerprint: str  # "{filename}_{size}_{lastModified}"
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    captured_at: Optional[datetime] = None
    device_model: Optional[str] = None
    original_filename: Optional[str] = None


class FileUploadResponse(BaseModel):
    """Response after successful file upload"""
    file_id: str
    filename: str
    size: int
    fingerprint: str
    completed_files: int
    total_files: int

    class Config:
        from_attributes = True


# ===== Admin API Schemas (auth required) =====

class UploadLinkCreateRequest(BaseModel):
    """Request to create a new upload link"""
    context: str = 'water-mitigation'
    context_id: str  # Job UUID
    label: Optional[str] = None
    crew_name: Optional[str] = None
    expires_in_days: int = Field(default=7, ge=1, le=90)
    max_files: int = Field(default=1000, ge=1, le=5000)


class UploadLinkResponse(BaseModel):
    """Response with upload link details"""
    id: str
    token: str
    context: str
    context_id: str
    label: Optional[str] = None
    crew_name: Optional[str] = None
    is_active: bool
    expires_at: datetime
    max_files: int
    upload_count: int
    total_size_bytes: int
    last_accessed_at: Optional[datetime] = None
    created_at: datetime
    upload_url: Optional[str] = None  # Full URL for sharing

    class Config:
        from_attributes = True


class UploadLinkListResponse(BaseModel):
    """List of upload links"""
    items: List[UploadLinkResponse]
    total: int
