"""
Email Ingestion Pydantic schemas for API request/response.
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ============================================================
# EmailAccount schemas
# ============================================================

PROVIDER_PRESETS = {
    "gmail": {"imap_server": "imap.gmail.com", "imap_port": 993, "use_ssl": True},
    "outlook": {"imap_server": "outlook.office365.com", "imap_port": 993, "use_ssl": True},
    "yahoo": {"imap_server": "imap.mail.yahoo.com", "imap_port": 993, "use_ssl": True},
    "custom": {},
}


class EmailAccountBase(BaseModel):
    display_name: str
    email_address: str
    provider_type: str = Field("gmail", description="gmail | outlook | yahoo | custom")
    imap_server: str = "imap.gmail.com"
    imap_port: int = 993
    use_ssl: bool = True
    username: str
    company_id: Optional[UUID] = None
    sender_name: Optional[str] = None
    sender_phone: Optional[str] = None
    is_active: bool = True
    auto_schedule: Optional[str] = None


class EmailAccountCreate(EmailAccountBase):
    password: str  # Plain text, will be encrypted before storage


class EmailAccountUpdate(BaseModel):
    display_name: Optional[str] = None
    email_address: Optional[str] = None
    provider_type: Optional[str] = None
    imap_server: Optional[str] = None
    imap_port: Optional[int] = None
    use_ssl: Optional[bool] = None
    username: Optional[str] = None
    password: Optional[str] = None  # Only update if provided
    company_id: Optional[UUID] = None
    sender_name: Optional[str] = None
    sender_phone: Optional[str] = None
    is_active: Optional[bool] = None
    auto_schedule: Optional[str] = None


class EmailAccountResponse(BaseModel):
    id: UUID
    display_name: str
    email_address: str
    provider_type: str
    imap_server: str
    imap_port: int
    use_ssl: bool
    username: str
    company_id: Optional[UUID] = None
    company_name: Optional[str] = None
    sender_name: Optional[str] = None
    sender_phone: Optional[str] = None
    is_active: bool
    auto_schedule: Optional[str] = None
    last_synced_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class EmailAccountTestResponse(BaseModel):
    success: bool
    message: str
    inbox_count: Optional[int] = None


# ============================================================
# EmailIngestionLog schemas
# ============================================================

class IngestionLogResponse(BaseModel):
    id: UUID
    email_account_id: UUID
    message_id: str
    subject: Optional[str] = None
    sender: Optional[str] = None
    received_at: Optional[datetime] = None
    attachment_name: Optional[str] = None
    status: str
    is_insurance_estimate: Optional[bool] = None
    classification_reason: Optional[str] = None
    matched_client_id: Optional[UUID] = None
    matched_claim_id: Optional[UUID] = None
    match_method: Optional[str] = None
    match_confidence: Optional[int] = None
    claim_created: bool = False
    negotiation_id: Optional[UUID] = None
    file_id: Optional[str] = None
    skip_reason: Optional[str] = None
    error_message: Optional[str] = None
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    # Joined fields (populated by service)
    client_name: Optional[str] = None
    claim_number: Optional[str] = None
    account_email: Optional[str] = None

    class Config:
        from_attributes = True


class ManualAssignRequest(BaseModel):
    client_id: UUID
    claim_id: Optional[UUID] = None
    create_claim: bool = False
    claim_number: Optional[str] = None
    reviewed_by: Optional[str] = None


class SkipRequest(BaseModel):
    reason: str
    reviewed_by: Optional[str] = None


class PollResponse(BaseModel):
    account_id: UUID
    account_email: str
    emails_found: int
    processed: int
    uploaded: int
    skipped: int
    duplicates: int
    errors: int


class BatchPollResponse(BaseModel):
    accounts_polled: int
    results: List[PollResponse]
    total_processed: int
    total_uploaded: int


class IngestionStatsResponse(BaseModel):
    total: int
    uploaded: int
    pending: int
    skipped: int
    failed: int
    duplicates: int
