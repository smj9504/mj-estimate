"""
Water Mitigation domain Pydantic schemas
"""

from datetime import date, datetime
from typing import Dict, List, Optional, Union
from uuid import UUID

from pydantic import BaseModel, Field, validator


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
    property_street: Optional[str] = Field(None, max_length=255)
    property_city: Optional[str] = Field(None, max_length=100)
    property_state: Optional[str] = Field(None, max_length=50)
    property_zipcode: Optional[str] = Field(None, max_length=20)
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
    company_id: Optional[UUID] = None  # Assigned company (service provider)
    active: bool = True
    status: str = Field(JobStatus.LEAD, max_length=50)

    @validator('status')
    def validate_status(cls, v):
        if v not in JobStatus.all_statuses():
            raise ValueError(
                f'Invalid status. Must be one of: {JobStatus.all_statuses()}'
            )
        return v


class JobUpdate(BaseModel):
    """Update job request (all fields optional)"""
    company_id: Optional[UUID] = None  # Assigned company (service provider)
    property_address: Optional[str] = Field(None, max_length=500)
    property_street: Optional[str] = Field(None, max_length=255)
    property_city: Optional[str] = Field(None, max_length=100)
    property_state: Optional[str] = Field(None, max_length=50)
    property_zipcode: Optional[str] = Field(None, max_length=20)
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

    # CompanyCam Integration
    companycam_project_id: Optional[str] = Field(None, max_length=100)

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


class CompanyBrief(BaseModel):
    """Brief company info for job response"""
    id: UUID
    name: str
    company_code: Optional[str] = None

    class Config:
        from_attributes = True


class JobResponse(JobBase):
    """Job response schema"""
    id: UUID
    client_id: Optional[UUID] = None
    company_id: Optional[UUID] = None  # Assigned company ID
    company: Optional[CompanyBrief] = None  # Assigned company details
    active: bool
    status: str

    # Separated address fields (inherited from JobBase)
    property_street: Optional[str] = None
    property_city: Optional[str] = None
    property_state: Optional[str] = None
    property_zipcode: Optional[str] = None

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
    
    # Preview URL for quick loading (optimized)
    preview_url: Optional[str] = None
    thumbnail_url: Optional[str] = None

    class Config:
        from_attributes = True


class PhotoListResponse(BaseModel):
    """Paginated photo list response"""
    items: List[PhotoResponse]
    total: Optional[int] = None  # None for performance optimization on later pages
    page: int
    page_size: int
    total_pages: Optional[int] = None  # None for performance optimization on later pages

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
    template_id: Optional[UUID] = None  # Template this config was created from
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
    compress: bool = False  # Compress PDF (reduce image quality for smaller file size)


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
    document_type: str = Field(..., description="Document type (COS, EWA, Custom)")
    job_address: str = Field(..., description="Job address for document header")
    date_of_loss: Optional[str] = Field(None, description="Date of loss (required for EWA, format: YYYY-MM-DD)")
    rotations: Optional[Dict[str, int]] = Field(None, description="Photo rotations: {photo_id: degrees (0, 90, 180, 270)}")
    custom_filename: Optional[str] = Field(
        None,
        max_length=200,
        description="Custom filename for Custom document type (without .pdf extension)"
    )

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

    @validator('custom_filename')
    def validate_custom_filename(cls, v, values):
        """Validate and sanitize custom filename"""
        if not v:
            return v

        document_type = values.get('document_type')
        if document_type != 'Custom':
            return v

        import re
        # Remove invalid filename characters
        sanitized = re.sub(r'[\\/:*?"<>|]', '', v)
        sanitized = sanitized.strip()

        # Remove .pdf extension if present
        if sanitized.lower().endswith('.pdf'):
            sanitized = sanitized[:-4]

        # Validate not empty
        if not sanitized:
            raise ValueError('Custom filename cannot be empty')

        if len(sanitized) > 200:
            raise ValueError('Custom filename must be 200 characters or less')

        return sanitized


# Alias for CompanyCam integration
WaterMitigationJobCreate = JobCreate


# CompanyCam Sync schemas
class CompanyCamSyncResult(BaseModel):
    """Result of CompanyCam photo sync operation"""
    success: bool
    synced_count: int = Field(0, description="Number of photos newly synced")
    skipped_existing: int = Field(0, description="Photos already in WM (not re-synced)")
    skipped_trashed: int = Field(0, description="Photos skipped because they are trashed in WM")
    total_companycam: int = Field(0, description="Total photos found in CompanyCam project")
    errors: List[str] = Field(default_factory=list, description="Error messages if any")
    message: str = Field("", description="Summary message")
    cancelled: bool = Field(False, description="Whether sync was cancelled by user")


class CompanyCamSyncRequest(BaseModel):
    """Request to sync CompanyCam photos (optional params)"""
    force_refresh: bool = Field(False, description="Re-download even if photo exists")


# Bulk Photo Date Update by Category
class BulkUpdatePhotoDatesByCategoryRequest(BaseModel):
    """
    Request to bulk update photo dates based on category matching.

    Date mapping rules:
    - Day 2 category photos -> mitigation_start_date + 1 day
    - Day 3 category photos -> mitigation_end_date
    - All other categories -> mitigation_start_date
    """
    mitigation_start_date: date = Field(..., description="Mitigation start date")
    mitigation_end_date: date = Field(..., description="Mitigation end date")


class BulkUpdatePhotoDatesByCategoryResponse(BaseModel):
    """Response from bulk photo date update by category"""
    success: bool = Field(True, description="Whether operation succeeded")
    total_updated: int = Field(0, description="Total number of photos updated")
    day2_count: int = Field(0, description="Number of Day 2 photos updated")
    day3_count: int = Field(0, description="Number of Day 3 photos updated")
    other_count: int = Field(0, description="Number of other category photos updated")
    message: str = Field("", description="Summary message")


# ============================================================================
# Report Template Schemas
# ============================================================================

class PhotoLayoutType:
    """Valid photo layout types"""
    SINGLE = "single"   # 1 photo per page
    TWO = "two"         # 2 photos per page
    THREE = "three"     # 3 photos per page
    FOUR = "four"       # 4 photos per page (default)
    SIX = "six"         # 6 photos per page

    @classmethod
    def all_layouts(cls):
        return [cls.SINGLE, cls.TWO, cls.THREE, cls.FOUR, cls.SIX]


class TemplateType:
    """Valid template types"""
    PHOTO_REPORT = "photo_report"
    DAMAGE_ASSESSMENT = "damage_assessment"
    MONITORING_REPORT = "monitoring_report"

    @classmethod
    def all_types(cls):
        return [cls.PHOTO_REPORT, cls.DAMAGE_ASSESSMENT, cls.MONITORING_REPORT]


# Template Section Schemas
class TemplateSectionBase(BaseModel):
    """Base template section schema"""
    title: str = Field(..., max_length=255, description="Section title (e.g., 'Wet Area', 'Demolition')")
    summary: Optional[str] = Field(None, description="Optional prefilled description/summary")
    photo_layout: str = Field(
        "four",
        pattern="^(single|two|three|four|six)$",
        description="Photo layout: single, two, three, four, six"
    )
    default_photos_per_page: int = Field(2, ge=1, le=6, description="Default photos per page")
    display_order: int = Field(0, ge=0, description="Display order for sorting")
    placeholders: Optional[Dict[str, str]] = Field(
        None,
        description="Dynamic placeholders for summary (e.g., {'monitoring_dates': 'Monitoring on {dates}'})"
    )


class TemplateSectionCreate(TemplateSectionBase):
    """Create template section request"""
    pass


class TemplateSectionUpdate(BaseModel):
    """Update template section request (all fields optional)"""
    title: Optional[str] = Field(None, max_length=255)
    summary: Optional[str] = None
    photo_layout: Optional[str] = Field(None, pattern="^(single|two|three|four|six)$")
    default_photos_per_page: Optional[int] = Field(None, ge=1, le=6)
    display_order: Optional[int] = Field(None, ge=0)
    placeholders: Optional[Dict[str, str]] = None


class TemplateSectionResponse(TemplateSectionBase):
    """Template section response"""
    id: UUID
    template_id: UUID
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Template Schemas
class ReportTemplateBase(BaseModel):
    """Base report template schema"""
    name: str = Field(..., max_length=255, description="Template name")
    description: Optional[str] = Field(None, description="Template description")
    template_type: str = Field(
        "photo_report",
        max_length=50,
        description="Template type: photo_report, damage_assessment, monitoring_report"
    )
    is_default: bool = Field(False, description="Is this the default template for this type?")
    is_active: bool = Field(True, description="Is this template active?")


class ReportTemplateCreate(ReportTemplateBase):
    """Create report template request"""
    company_id: Optional[UUID] = Field(None, description="Company ID (NULL for system templates)")
    sections: List[TemplateSectionCreate] = Field(
        default_factory=list,
        description="Initial sections to create with the template"
    )

    @validator('template_type')
    def validate_template_type(cls, v):
        if v not in TemplateType.all_types():
            raise ValueError(f'Invalid template_type. Must be one of: {TemplateType.all_types()}')
        return v


class ReportTemplateUpdate(BaseModel):
    """Update report template request (all fields optional)"""
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    template_type: Optional[str] = Field(None, max_length=50)
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None
    sections: Optional[List[TemplateSectionCreate]] = None  # Sections to replace (deletes old, creates new)

    @validator('template_type')
    def validate_template_type(cls, v):
        if v is not None and v not in TemplateType.all_types():
            raise ValueError(f'Invalid template_type. Must be one of: {TemplateType.all_types()}')
        return v


class ReportTemplateResponse(ReportTemplateBase):
    """Report template response"""
    id: UUID
    company_id: Optional[UUID] = None
    created_by_id: Optional[UUID] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    sections: List[TemplateSectionResponse] = []

    class Config:
        from_attributes = True


class ReportTemplateListResponse(BaseModel):
    """Paginated template list response"""
    items: List[ReportTemplateResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class ReportTemplateBrief(BaseModel):
    """Brief template info for dropdowns/selectors"""
    id: UUID
    name: str
    template_type: str
    is_default: bool
    section_count: int

    class Config:
        from_attributes = True


# Template Clone Request
class ReportTemplateCloneRequest(BaseModel):
    """Request to clone/duplicate a template"""
    new_name: str = Field(..., max_length=255, description="Name for the cloned template")
    company_id: Optional[UUID] = Field(None, description="Target company (NULL for system template)")
    include_sections: bool = Field(True, description="Include sections in the clone")


# Create Report Config from Template
class CreateConfigFromTemplateRequest(BaseModel):
    """Request to create a report config from a template"""
    template_id: UUID = Field(..., description="Template ID to use")
    placeholder_values: Optional[Dict[str, str]] = Field(
        None,
        description="Values for placeholders (e.g., {'monitoring_dates': 'Jan 1, Jan 5, Jan 10'})"
    )
    cover_title: Optional[str] = Field(None, max_length=255, description="Override cover title")
    cover_description: Optional[str] = Field(None, description="Override cover description")
