"""
Water Mitigation domain Pydantic schemas
"""

from pydantic import BaseModel, Field, validator
from typing import List, Optional, Union
from datetime import datetime, date
from uuid import UUID


# Job Status enum values
class JobStatus:
    LEAD = "Lead"
    DOC_PREPPING = "Doc prepping"
    SENT_TO_ADJUSTER = "Sent to adjuster"
    FOLLOW_UP = "Follow up"
    PAPERWORK_RECEIVED = "Paperwork received"
    CHECK_RECEIVED = "Check received"
    COMPLETE = "Complete"

    @classmethod
    def all_statuses(cls):
        return [
            cls.LEAD,
            cls.DOC_PREPPING,
            cls.SENT_TO_ADJUSTER,
            cls.FOLLOW_UP,
            cls.PAPERWORK_RECEIVED,
            cls.CHECK_RECEIVED,
            cls.COMPLETE
        ]


# Base schemas
class JobBase(BaseModel):
    """Base job schema"""
    property_address: str = Field(..., max_length=500)
    homeowner_name: Optional[str] = Field(None, max_length=255)
    homeowner_phone: Optional[str] = Field(None, max_length=50)
    homeowner_email: Optional[str] = Field(None, max_length=255)

    insurance_company: Optional[str] = Field(None, max_length=255)
    insurance_policy_number: Optional[str] = Field(None, max_length=100)
    claim_number: Optional[str] = Field(None, max_length=100)

    date_of_loss: Optional[Union[datetime, date]] = None
    mitigation_period: Optional[str] = Field(None, max_length=100)
    mitigation_start_date: Optional[Union[datetime, date]] = None
    mitigation_end_date: Optional[Union[datetime, date]] = None

    adjuster_name: Optional[str] = Field(None, max_length=255)
    adjuster_phone: Optional[str] = Field(None, max_length=50)
    adjuster_email: Optional[str] = Field(None, max_length=255)

    inspection_date: Optional[Union[datetime, date]] = None
    inspection_time: Optional[str] = Field(None, max_length=20)
    plumbers_report: Optional[str] = Field(None, max_length=100)
    mitigation_flag: bool = False

    # Financial/Documents Information
    documents_sent_date: Optional[Union[datetime, date]] = None
    invoice_number: Optional[str] = Field(None, max_length=100)
    invoice_amount: Optional[float] = None
    check_number: Optional[str] = Field(None, max_length=100)
    check_date: Optional[Union[datetime, date]] = None
    check_amount: Optional[float] = None

    @validator('date_of_loss', 'mitigation_start_date', 'mitigation_end_date', 'inspection_date', 'documents_sent_date', 'check_date', pre=True)
    def convert_date_to_datetime(cls, v):
        """Convert date to datetime if needed"""
        if isinstance(v, date) and not isinstance(v, datetime):
            return datetime.combine(v, datetime.min.time())
        return v


class JobCreate(JobBase):
    """Create job request"""
    client_id: Optional[UUID] = None
    active: bool = True
    status: str = Field(JobStatus.LEAD, max_length=50)

    @validator('status')
    def validate_status(cls, v):
        if v not in JobStatus.all_statuses():
            raise ValueError(f'Invalid status. Must be one of: {JobStatus.all_statuses()}')
        return v


class JobUpdate(BaseModel):
    """Update job request (all fields optional)"""
    property_address: Optional[str] = Field(None, max_length=500)
    homeowner_name: Optional[str] = Field(None, max_length=255)
    homeowner_phone: Optional[str] = Field(None, max_length=50)
    homeowner_email: Optional[str] = Field(None, max_length=255)

    insurance_company: Optional[str] = Field(None, max_length=255)
    insurance_policy_number: Optional[str] = Field(None, max_length=100)
    claim_number: Optional[str] = Field(None, max_length=100)

    date_of_loss: Optional[Union[datetime, date]] = None
    mitigation_period: Optional[str] = Field(None, max_length=100)
    mitigation_start_date: Optional[Union[datetime, date]] = None
    mitigation_end_date: Optional[Union[datetime, date]] = None

    adjuster_name: Optional[str] = Field(None, max_length=255)
    adjuster_phone: Optional[str] = Field(None, max_length=50)
    adjuster_email: Optional[str] = Field(None, max_length=255)

    inspection_date: Optional[Union[datetime, date]] = None
    inspection_time: Optional[str] = Field(None, max_length=20)
    plumbers_report: Optional[str] = Field(None, max_length=100)
    mitigation_flag: Optional[bool] = None

    # Financial/Documents Information
    documents_sent_date: Optional[Union[datetime, date]] = None
    invoice_number: Optional[str] = Field(None, max_length=100)
    invoice_amount: Optional[float] = None
    check_number: Optional[str] = Field(None, max_length=100)
    check_date: Optional[Union[datetime, date]] = None
    check_amount: Optional[float] = None

    active: Optional[bool] = None

    @validator('date_of_loss', 'mitigation_start_date', 'mitigation_end_date', 'inspection_date', 'documents_sent_date', 'check_date', pre=True)
    def convert_date_to_datetime(cls, v):
        """Convert date to datetime if needed"""
        if isinstance(v, date) and not isinstance(v, datetime):
            return datetime.combine(v, datetime.min.time())
        return v


class JobStatusUpdate(BaseModel):
    """Update job status request"""
    status: str = Field(..., max_length=50)
    notes: Optional[str] = None

    @validator('status')
    def validate_status(cls, v):
        if v not in JobStatus.all_statuses():
            raise ValueError(f'Invalid status. Must be one of: {JobStatus.all_statuses()}')
        return v


class JobResponse(JobBase):
    """Job response schema"""
    id: UUID
    client_id: Optional[UUID] = None
    active: bool
    status: str

    companycam_project_id: Optional[str] = None
    google_sheet_row_number: Optional[int] = None

    companycam_last_sync: Optional[datetime] = None
    sheets_last_sync: Optional[datetime] = None

    created_at: datetime
    updated_at: Optional[datetime] = None  # Make optional since it can be None
    created_by_id: Optional[UUID] = None
    updated_by_id: Optional[UUID] = None

    # Computed fields
    photo_count: Optional[int] = 0

    class Config:
        from_attributes = True


class JobListResponse(BaseModel):
    """Job list response with pagination"""
    items: List[JobResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


# Photo Category schemas
class CategoryCreate(BaseModel):
    """Create category request"""
    category_name: str = Field(..., max_length=100)
    category_type: str = Field('custom', max_length=50)
    color_code: str = Field('#1890ff', max_length=7)


class CategoryResponse(BaseModel):
    """Category response schema"""
    id: UUID
    client_id: Optional[UUID] = None
    category_name: str
    category_type: str
    color_code: str
    display_order: int
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


# Photo schemas
class PhotoUpload(BaseModel):
    """Photo upload metadata"""
    title: Optional[str] = None
    description: Optional[str] = None
    tag_ids: Optional[List[UUID]] = []


class PhotoResponse(BaseModel):
    """Photo response schema"""
    id: UUID
    job_id: UUID
    source: str
    external_id: Optional[str] = None

    file_name: str
    file_path: str
    file_size: Optional[int] = None
    mime_type: Optional[str] = None
    file_type: Optional[str] = None

    title: Optional[str] = None
    description: Optional[str] = None
    captured_date: Optional[datetime] = None

    upload_status: str
    uploaded_by_id: Optional[UUID] = None

    created_at: datetime
    updated_at: Optional[datetime] = None

    # Categories
    categories: List[CategoryResponse] = []

    # Additional field for thumbnail support
    thumbnail_path: Optional[str] = None
    category: Optional[str] = None

    class Config:
        from_attributes = True


class PhotoListResponse(BaseModel):
    """Paginated photo list response"""
    items: List[PhotoResponse]
    total: int
    page: int
    page_size: int
    total_pages: int

    class Config:
        from_attributes = True


# Status History schemas
class StatusHistoryResponse(BaseModel):
    """Status history response"""
    id: UUID
    job_id: UUID
    previous_status: Optional[str] = None
    new_status: str
    changed_by_id: Optional[UUID] = None
    changed_at: datetime
    notes: Optional[str] = None

    class Config:
        from_attributes = True


# Bulk operations
class BulkUpdateDateRequest(BaseModel):
    """Bulk update photo date request"""
    photo_ids: List[UUID]
    new_date: date  # Only date part, time will be preserved


# Filters
class JobFilters(BaseModel):
    """Job list filters"""
    search: Optional[str] = None
    status: Optional[List[str]] = None
    active: Optional[bool] = None
    page: int = Field(1, ge=1)
    page_size: int = Field(50, ge=1, le=100)


# Report schemas
class PhotoMetadata(BaseModel):
    """Photo metadata for report"""
    photo_id: str
    caption: Optional[str] = None
    show_date: bool = True
    show_description: bool = True

    class Config:
        from_attributes = True


class ReportSection(BaseModel):
    """Report section configuration"""
    id: str
    title: str
    summary: Optional[str] = None
    photos: List[PhotoMetadata] = []
    layout: str = Field("four", pattern="^(single|two|three|four|six)$")
    display_order: int

    class Config:
        from_attributes = True


class ReportConfigBase(BaseModel):
    """Base report config schema"""
    cover_title: str = Field("Water Mitigation Report", max_length=255)
    cover_description: Optional[str] = None
    sections: List[dict] = []  # List of section dictionaries


class ReportConfigCreate(ReportConfigBase):
    """Create report config request"""
    job_id: UUID


class ReportConfigUpdate(BaseModel):
    """Update report config request (all fields optional)"""
    cover_title: Optional[str] = Field(None, max_length=255)
    cover_description: Optional[str] = None
    sections: Optional[List[dict]] = None


class ReportConfigResponse(ReportConfigBase):
    """Report config response"""
    id: UUID
    job_id: UUID
    created_at: datetime
    updated_at: Optional[datetime] = None
    created_by_id: Optional[UUID] = None

    class Config:
        from_attributes = True


class GenerateReportRequest(BaseModel):
    """Request to generate report PDF"""
    config_id: Optional[UUID] = None  # Use saved config
    save_config: bool = False  # Save current config
    config: Optional[ReportConfigCreate] = None  # Inline config


class GenerateReportResponse(BaseModel):
    """Response from report generation"""
    file_id: UUID
    file_path: str
    filename: str
    download_url: str
    config_id: Optional[UUID] = None  # If config was saved


# Document schemas
class WMDocumentBase(BaseModel):
    """Base document schema"""
    document_type: str = Field(..., max_length=50, description="Document type (COS, EWA, etc.)")
    filename: str = Field(..., max_length=500, description="Document filename")


class WMDocumentResponse(WMDocumentBase):
    """Document response schema (excludes file_path for security)"""
    id: UUID
    job_id: UUID
    file_size: int
    mime_type: str
    photo_count: int
    source_photo_ids: Optional[str] = None  # JSON string of photo IDs
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class GenerateDocumentRequest(BaseModel):
    """Request to generate document PDF"""
    photo_ids: List[str] = Field(..., description="List of photo IDs to include (EWA requires exactly 1 photo)")
    document_type: str = Field(..., description="Document type (COS, EWA)")
    job_address: str = Field(..., description="Job address for document header")
    date_of_loss: Optional[str] = Field(None, description="Date of loss (required for EWA, format: YYYY-MM-DD)")

    @validator('photo_ids')
    def validate_photo_ids(cls, v, values):
        """Validate photo_ids based on document_type"""
        document_type = values.get('document_type')
        if document_type == 'EWA':
            if len(v) != 1:
                raise ValueError('EWA document requires exactly 1 photo')
        return v

    @validator('date_of_loss')
    def validate_date_of_loss(cls, v, values):
        """Validate date_of_loss is provided for EWA"""
        document_type = values.get('document_type')
        if document_type == 'EWA' and not v:
            raise ValueError('date_of_loss is required for EWA document')
        return v
