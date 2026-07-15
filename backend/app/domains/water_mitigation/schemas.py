"""
Water Mitigation domain Pydantic schemas
"""

from datetime import date, datetime
from typing import Any, Dict, List, Optional, Union
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
    adjuster_phone: Optional[str] = Field(None, max_length=100)
    adjuster_email: Optional[str] = Field(None, max_length=255)
    adjuster_emails: Optional[List[Dict[str, str]]] = Field(
        None,
        description="Additional email contacts [{name, email, role}]"
    )

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
    payment_status: Optional[str] = None
    payment_note: Optional[str] = None

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
    adjuster_phone: Optional[str] = Field(None, max_length=100)
    adjuster_email: Optional[str] = Field(None, max_length=255)
    adjuster_emails: Optional[List[Dict[str, str]]] = Field(
        None,
        description="Additional email contacts [{name, email, role}]"
    )

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
    payment_status: Optional[str] = None
    payment_note: Optional[str] = None

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
    google_sheet_name: Optional[str] = None

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

    # MagicPlan metadata (floor, room info)
    magicplan_metadata: Optional[Dict[str, Any]] = None

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
    cover_title: str = Field("Water Mitigation Photos", max_length=255)
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
    report_date: Optional[str] = None  # Custom report date (ISO format: YYYY-MM-DD)
    compress: bool = False  # Compress PDF (reduce image quality for smaller file size)
    template_variant: str = "a"  # Template variant: 'a' (default), 'b' (formal), 'c' (modern)


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
    file_size: Optional[int] = None
    mime_type: str
    photo_count: Optional[int] = 0
    source_photo_ids: Optional[str] = None  # JSON string of photo IDs
    annotation_data: Optional[str] = None  # JSON string of annotation data for re-editing
    has_source_pdf: bool = False  # Whether original PDF is available for re-editing
    invoice_amount: Optional[float] = None  # Amount for invoice documents
    upload_source: Optional[str] = 'generated'  # 'generated' or 'manual_upload'
    title: Optional[str] = None
    description: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PerspectiveCropPoint(BaseModel):
    """A point in ratio coordinates (0.0-1.0)"""
    x: float = Field(..., ge=0.0, le=1.0)
    y: float = Field(..., ge=0.0, le=1.0)


class PerspectiveCropRequest(BaseModel):
    """Request to apply perspective crop to a photo"""
    points: List[PerspectiveCropPoint] = Field(
        ..., min_items=4, max_items=4,
        description="4 corner points in order: top-left, top-right, bottom-right, bottom-left"
    )
    scan_effect: Optional[str] = Field(None, description="Apply scan effect after crop: 'color_scan', 'bw_scan'")


class GenerateDocumentRequest(BaseModel):
    """Request to generate document PDF"""
    photo_ids: List[str] = Field(..., description="List of photo IDs to include (EWA requires exactly 1 photo)")
    document_type: str = Field(..., description="Document type (COS, EWA, Custom)")
    job_address: str = Field(..., description="Job address for document header")
    date_of_loss: Optional[str] = Field(None, description="Date of loss (format: YYYY-MM-DD)")
    mitigation_start_date: Optional[str] = Field(None, description="Mitigation start date (used for EWA, format: YYYY-MM-DD)")
    rotations: Optional[Dict[str, int]] = Field(None, description="Photo rotations: {photo_id: degrees (0, 90, 180, 270)}")
    custom_filename: Optional[str] = Field(
        None,
        max_length=200,
        description="Custom filename for Custom document type (without .pdf extension)"
    )
    compress: bool = Field(False, description="Compress PDF to reduce file size")
    scan_effect: Optional[str] = Field(None, description="Scan effect: 'color_scan', 'bw_scan', or None")

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


# =============================================================================
# Scope of Work Schemas
# =============================================================================

# Standard scope items template
STANDARD_SCOPE_ITEMS = [
    {"name": "Floor Protection", "item_type": "standard", "unit": "SF"},
    {"name": "Content Protection", "item_type": "standard", "unit": "SF"},
    {"name": "Content Manipulation", "item_type": "standard", "unit": "HR"},
    {"name": "Containment", "item_type": "standard", "unit": "SF"},
    {"name": "Air Mover", "item_type": "standard", "unit": "EA"},
    {"name": "Dehumidifier", "item_type": "standard", "unit": "EA"},
    {"name": "Air Scrubber", "item_type": "standard", "unit": "EA"},
]


# --- Material Weight Brief (for ScopeItem response) ---

class MaterialWeightBrief(BaseModel):
    """Brief material weight info for scope item response"""
    id: UUID
    material_type: str  # Maps to MaterialWeight.material_type
    dry_weight_per_unit: float  # Maps to MaterialWeight.dry_weight_per_unit
    unit: str

    class Config:
        from_attributes = True


# --- Scope Location Schemas ---

class ScopeLocationCreate(BaseModel):
    """Create scope location request"""
    job_id: UUID
    name: str = Field(..., max_length=255)
    floor: Optional[str] = Field(None, max_length=50)
    room_type: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None
    display_order: int = 0
    auto_add_standard_items: bool = Field(
        default=True,
        description="Automatically add standard scope items when creating location"
    )


class ScopeLocationUpdate(BaseModel):
    """Update scope location request"""
    name: Optional[str] = Field(None, max_length=255)
    floor: Optional[str] = Field(None, max_length=50)
    room_type: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None
    display_order: Optional[int] = None


class LineItemBrief(BaseModel):
    """Brief line item info for scope item response"""
    id: UUID
    description: str
    unit: Optional[str] = None
    untaxed_unit_price: Optional[float] = None

    class Config:
        from_attributes = True


class ScopeItemResponse(BaseModel):
    """Scope item response (used in location response)"""
    id: UUID
    location_id: UUID
    item_type: str
    name: str
    description: Optional[str] = None
    quantity: Optional[float] = None
    quantity_formula: Optional[str] = None
    unit: str
    material_weight_id: Optional[UUID] = None
    material_weight: Optional[MaterialWeightBrief] = None
    line_item_id: Optional[UUID] = None
    line_item: Optional[LineItemBrief] = None
    include_in_debris: bool
    invoiced: bool = False
    invoiced_at: Optional[datetime] = None
    display_order: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ScopeLocationResponse(BaseModel):
    """Scope location response"""
    id: UUID
    job_id: UUID
    name: str
    floor: Optional[str] = None
    room_type: Optional[str] = None
    description: Optional[str] = None
    display_order: int
    scope_items: List[ScopeItemResponse] = []
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ScopeLocationListResponse(BaseModel):
    """Scope location list response"""
    items: List[ScopeLocationResponse]
    total: int


# --- Scope Item Schemas ---

class ScopeItemCreate(BaseModel):
    """Create scope item request"""
    location_id: UUID
    item_type: str = Field("standard", max_length=50)  # standard, demolition, custom
    name: str = Field(..., max_length=255)
    description: Optional[str] = None
    quantity: Optional[float] = None
    quantity_formula: Optional[str] = Field(None, max_length=500)
    unit: str = Field("SF", max_length=20)
    material_weight_id: Optional[UUID] = None
    line_item_id: Optional[UUID] = Field(None, description="Link to LineItem for invoice rate")
    include_in_debris: bool = True
    display_order: int = 0


class ScopeItemUpdate(BaseModel):
    """Update scope item request"""
    item_type: Optional[str] = Field(None, max_length=50)
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    quantity: Optional[float] = None
    quantity_formula: Optional[str] = Field(None, max_length=500)
    unit: Optional[str] = Field(None, max_length=20)
    material_weight_id: Optional[UUID] = None
    line_item_id: Optional[UUID] = Field(None, description="Link to LineItem for invoice rate")
    include_in_debris: Optional[bool] = None
    display_order: Optional[int] = None


# --- Debris Calculation Schemas ---

class DebrisItemDetail(BaseModel):
    """Detail for each item in debris calculation"""
    item_id: str
    item_name: str
    material_name: Optional[str] = None
    quantity: float
    unit: str
    weight_per_unit: float
    weight_lb: float
    weight_ton: float


class CategoryBreakdown(BaseModel):
    """Breakdown by category"""
    category_name: str
    weight_lb: float
    weight_ton: float
    item_count: int


class DumpsterRecommendation(BaseModel):
    """Dumpster size recommendation"""
    size: str
    capacity_tons: float
    count: int
    total_capacity_tons: float


class WMDebrisCalculationResponse(BaseModel):
    """Debris calculation response"""
    id: UUID
    job_id: UUID
    total_weight_lb: float
    total_weight_ton: float
    bag_count: Optional[int] = None  # Number of 42-gallon contractor bags needed
    category_breakdown: List[CategoryBreakdown] = []
    dumpster_recommendation: Optional[DumpsterRecommendation] = None
    item_details: List[DebrisItemDetail] = []
    calculated_at: datetime
    calculated_by_id: Optional[UUID] = None

    class Config:
        from_attributes = True


class CalculateDebrisRequest(BaseModel):
    """Request to calculate debris for a job"""
    save_result: bool = True  # Whether to save calculation to database


class CalculateDebrisResponse(BaseModel):
    """Response for debris calculation"""
    success: bool
    calculation: Optional[WMDebrisCalculationResponse] = None
    message: str
    warnings: List[str] = []


# --- Bulk Operations ---

class AddStandardItemsRequest(BaseModel):
    """Request to add standard items to a location"""
    item_names: Optional[List[str]] = None  # If None, add all standard items


# --- Formula Calculation ---

class CalculateFormulaRequest(BaseModel):
    """Request to calculate a quantity formula"""
    formula: str = Field(..., max_length=500, description="Math formula like '10*12+5*8'")


class CalculateFormulaResponse(BaseModel):
    """Response for formula calculation"""
    success: bool
    formula: str
    result: Optional[float] = None
    error: Optional[str] = None


# =============================================================================
# Scope Item Category Schemas
# =============================================================================

class ScopeItemCategoryBase(BaseModel):
    """Base schema for scope item categories"""
    name: str = Field(..., max_length=100, description="Category name (e.g., 'Equipment', 'Protection')")
    description: Optional[str] = Field(None, description="Category description")
    color: str = Field('#1890ff', max_length=7, description="Hex color code for UI display")
    icon: Optional[str] = Field(None, max_length=50, description="Icon identifier for UI")
    display_order: int = Field(0, ge=0, description="Display order in UI")


class ScopeItemCategoryCreate(ScopeItemCategoryBase):
    """Create scope item category request"""
    company_id: Optional[UUID] = Field(
        None,
        description="Company ID (NULL for system-wide categories)"
    )


class ScopeItemCategoryUpdate(BaseModel):
    """Update scope item category request (all fields optional)"""
    name: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None
    color: Optional[str] = Field(None, max_length=7)
    icon: Optional[str] = Field(None, max_length=50)
    display_order: Optional[int] = Field(None, ge=0)
    is_active: Optional[bool] = None


class ScopeItemCategoryResponse(ScopeItemCategoryBase):
    """Scope item category response"""
    id: UUID
    company_id: Optional[UUID] = None
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ScopeItemCategoryListResponse(BaseModel):
    """Paginated scope item category list response"""
    items: List[ScopeItemCategoryResponse]
    total: int
    page: int
    page_size: int


class ScopeItemCategoryBrief(BaseModel):
    """Brief category info for dropdowns/selectors"""
    id: UUID
    name: str
    color: str
    display_order: int

    class Config:
        from_attributes = True


# =============================================================================
# Standard Scope Item Schemas
# =============================================================================

class StandardScopeItemBase(BaseModel):
    """Base schema for standard scope items"""
    name: str = Field(..., max_length=255, description="Item name (e.g., 'Floor Protection')")
    description: Optional[str] = Field(None, description="Detailed description")
    item_type: str = Field(
        'standard',
        description="Item type: standard, demolition, custom"
    )
    unit: str = Field(
        'SF',
        description="Default unit: SF, LF, EA"
    )
    default_quantity: Optional[float] = Field(None, ge=0, description="Default quantity")
    default_include_in_debris: Optional[bool] = Field(default=False, description="Include in debris calculation by default")
    display_order: Optional[int] = Field(default=0, ge=0, description="Display order in UI")

    # Invoice Line Item Mapping
    line_item_id: Optional[UUID] = Field(None, description="Mapped line item for invoice")
    custom_line_item_name: Optional[str] = Field(None, max_length=255, description="Custom line item name")
    custom_line_item_rate: Optional[float] = Field(None, ge=0, description="Custom rate for invoice")
    quantity_calc_type: str = Field('fixed', description="Quantity calculation: fixed, per_day, per_day_capped")
    max_days: Optional[int] = Field(None, ge=1, description="Max days for per_day_capped")
    default_invoice_note: Optional[str] = Field(None, description="Default note for invoice line item")

    @validator('default_include_in_debris', pre=True, always=True)
    def set_default_include_in_debris(cls, v):
        """Convert None to False for database records with NULL values"""
        return v if v is not None else False

    @validator('display_order', pre=True, always=True)
    def set_display_order(cls, v):
        """Convert None to 0 for database records with NULL values"""
        return v if v is not None else 0


class StandardScopeItemCreate(StandardScopeItemBase):
    """Create standard scope item request"""
    company_id: Optional[UUID] = Field(
        None,
        description="Company ID (NULL for system-wide templates)"
    )
    category_id: Optional[UUID] = Field(
        None,
        description="Category ID for grouping"
    )
    material_weight_id: Optional[UUID] = Field(
        None,
        description="Link to MaterialWeight for debris calculation"
    )


class StandardScopeItemUpdate(BaseModel):
    """Update standard scope item request (all fields optional)"""
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    item_type: Optional[str] = None
    category_id: Optional[UUID] = None
    unit: Optional[str] = None
    default_quantity: Optional[float] = Field(None, ge=0)
    material_weight_id: Optional[UUID] = None
    default_include_in_debris: Optional[bool] = None
    display_order: Optional[int] = Field(None, ge=0)
    is_active: Optional[bool] = None

    # Invoice Line Item Mapping
    line_item_id: Optional[UUID] = None
    custom_line_item_name: Optional[str] = Field(None, max_length=255)
    custom_line_item_rate: Optional[float] = Field(None, ge=0)
    quantity_calc_type: Optional[str] = None
    max_days: Optional[int] = Field(None, ge=1)
    default_invoice_note: Optional[str] = None


class LineItemBrief(BaseModel):
    """Brief line item info for standard scope item response"""
    id: UUID
    description: str
    unit: Optional[str] = None
    untaxed_unit_price: Optional[float] = None

    class Config:
        from_attributes = True


class StandardScopeItemResponse(StandardScopeItemBase):
    """Standard scope item response"""
    id: UUID
    company_id: Optional[UUID] = None
    category_id: Optional[UUID] = None
    category: Optional[ScopeItemCategoryBrief] = None  # Nested category info
    material_weight_id: Optional[UUID] = None
    line_item: Optional[LineItemBrief] = None  # Nested line item info
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class StandardScopeItemListResponse(BaseModel):
    """Paginated standard scope item list response"""
    items: List[StandardScopeItemResponse]
    total: int
    page: int
    page_size: int


class StandardScopeItemBrief(BaseModel):
    """Brief standard scope item info for dropdowns/selectors"""
    id: UUID
    name: str
    item_type: str
    unit: str
    category_id: Optional[UUID] = None
    display_order: int

    class Config:
        from_attributes = True


# =============================================================================
# Scope Invoice Schemas
# =============================================================================

class ScopeInvoiceItemInfo(BaseModel):
    """Information about a scope item to be invoiced"""
    scope_item_id: UUID
    quantity: Optional[float] = None  # Override quantity if needed
    rate: Optional[float] = None  # Override rate if needed


class GenerateInvoiceRequest(BaseModel):
    """Request to generate an invoice from scope items"""
    job_id: UUID
    template_id: UUID = Field(..., description="Line Item Template ID (WM Template)")
    billing_company_id: Optional[UUID] = Field(
        None,
        description="Billing company ID (defaults to job's company_id)"
    )
    invoice_date: Optional[datetime] = Field(
        None,
        description="Invoice date (defaults to now)"
    )
    scope_item_ids: Optional[List[UUID]] = Field(
        None,
        description="Specific scope items to invoice (all if not specified)"
    )
    notes: Optional[str] = Field(
        None,
        description="Notes for the invoice"
    )
    holiday_premium: bool = Field(
        False,
        description="Apply Holiday Premium (30% surcharge)"
    )


class GenerateInvoiceResponse(BaseModel):
    """Response from invoice generation"""
    success: bool
    message: str
    invoice_id: Optional[UUID] = None
    invoice_number: Optional[str] = None
    scope_invoice_id: Optional[UUID] = None
    items_invoiced: int = 0
    total_amount: Optional[float] = None
    warnings: List[str] = []


class ScopeItemInvoiceLinkResponse(BaseModel):
    """Response for scope item to invoice item link"""
    id: UUID
    scope_item_id: UUID
    invoice_item_id: UUID
    scope_item_name: Optional[str] = None
    invoice_item_description: Optional[str] = None

    class Config:
        from_attributes = True


class WMScopeInvoiceResponse(BaseModel):
    """Response for WM Scope Invoice link"""
    id: UUID
    job_id: UUID
    invoice_id: UUID
    invoice_number: Optional[str] = None
    invoice_total: Optional[float] = None
    generated_at: datetime
    generated_by_id: Optional[UUID] = None
    notes: Optional[str] = None
    item_links: List[ScopeItemInvoiceLinkResponse] = []
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class JobInvoiceHistoryResponse(BaseModel):
    """Response for job's invoice history"""
    invoices: List[WMScopeInvoiceResponse]
    total_invoiced: float
    invoice_count: int


class ScopeItemInvoiceStatusResponse(BaseModel):
    """Response for scope item's invoice status"""
    scope_item_id: UUID
    scope_item_name: str
    invoiced: bool
    invoiced_at: Optional[datetime] = None
    invoice_item_id: Optional[UUID] = None
    invoice_id: Optional[UUID] = None
    invoice_number: Optional[str] = None

# =============================================================================
# Invoice Item Configuration Schemas
# =============================================================================

class QuantityCalcType:
    """Quantity calculation types for invoice items"""
    FIXED = "fixed"  # Use scope item quantity as-is
    PER_DAY = "per_day"  # Multiply by mitigation days
    PER_DAY_CAPPED = "per_day_capped"  # Multiply by mitigation days, up to max_days


class InvoiceItemConfigBase(BaseModel):
    """Base schema for invoice item configuration"""
    scope_item_id: Optional[UUID] = Field(None, description="Specific scope item ID")
    standard_scope_item_id: Optional[UUID] = Field(None, description="Standard scope item for defaults")
    line_item_id: Optional[UUID] = Field(None, description="Target line item")
    
    # Custom line item data (when not using existing line_item)
    custom_name: Optional[str] = Field(None, max_length=255, description="Custom line item name")
    custom_description: Optional[str] = Field(None, description="Custom line item description")
    custom_rate: Optional[float] = Field(None, ge=0, description="Custom rate")
    custom_unit: Optional[str] = Field(None, max_length=20, description="Custom unit")
    
    # Quantity calculation
    quantity_calc_type: str = Field(
        default=QuantityCalcType.FIXED,
        description="Quantity calculation type: 'fixed', 'per_day', 'per_day_capped'"
    )
    max_days: Optional[int] = Field(None, ge=1, description="Maximum days for per_day_capped")
    
    # Default note
    default_note: Optional[str] = Field(None, description="Default note for invoice item")
    
    is_enabled: bool = Field(default=True, description="Whether to include in invoice")
    display_order: int = Field(default=0, description="Display order in UI")


class InvoiceItemConfigCreate(InvoiceItemConfigBase):
    """Schema for creating invoice item configuration"""
    job_id: UUID = Field(..., description="Water mitigation job ID")


class InvoiceItemConfigUpdate(BaseModel):
    """Schema for updating invoice item configuration"""
    scope_item_id: Optional[UUID] = None
    standard_scope_item_id: Optional[UUID] = None
    line_item_id: Optional[UUID] = None
    custom_name: Optional[str] = None
    custom_description: Optional[str] = None
    custom_rate: Optional[float] = None
    custom_unit: Optional[str] = None
    quantity_calc_type: Optional[str] = None
    max_days: Optional[int] = None
    default_note: Optional[str] = None
    is_enabled: Optional[bool] = None
    display_order: Optional[int] = None


class InvoiceItemConfigResponse(InvoiceItemConfigBase):
    """Response schema for invoice item configuration"""
    id: UUID
    job_id: UUID
    
    # Populated data for display
    scope_item_name: Optional[str] = None
    scope_item_quantity: Optional[float] = None
    scope_item_unit: Optional[str] = None
    location_name: Optional[str] = None
    line_item_description: Optional[str] = None
    line_item_rate: Optional[float] = None
    
    # Calculated values for preview
    calculated_quantity: Optional[float] = None
    effective_rate: Optional[float] = None
    calculated_amount: Optional[float] = None
    calculation_note: Optional[str] = None  # e.g., "3 units × 5 days = 15"
    
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class InvoiceItemConfigBulkCreate(BaseModel):
    """Schema for bulk creating invoice item configurations"""
    job_id: UUID
    configs: List[InvoiceItemConfigBase]


class InvoicePreviewItem(BaseModel):
    """Preview item for invoice generation"""
    config_id: Optional[UUID] = None
    scope_item_id: Optional[UUID] = None
    scope_item_name: str
    location_name: str
    line_item_description: str
    base_quantity: float
    calculated_quantity: float
    calculation_note: str  # e.g., "3 units × 5 days = 15"
    unit: str
    rate: float
    amount: float
    default_note: Optional[str] = None


class InvoicePreviewResponse(BaseModel):
    """Response for invoice preview"""
    items: List[InvoicePreviewItem]
    subtotal: float
    tax_rate: float = 0
    tax_amount: float = 0
    total: float
    mitigation_days: int
    mitigation_start: Optional[datetime] = None
    mitigation_end: Optional[datetime] = None
    warnings: List[str] = []
    unmapped_items: List[str] = []  # Scope items without line item mapping
