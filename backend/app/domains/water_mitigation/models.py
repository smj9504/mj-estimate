"""
Water Mitigation domain models
"""

from sqlalchemy import (
    DECIMAL,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType


class WaterMitigationJob(Base, BaseModel):
    """Water mitigation job/lead"""
    __tablename__ = "water_mitigation_jobs"
    __table_args__ = (
        Index('ix_wm_jobs_active_status', 'active', 'status'),
        Index('ix_wm_jobs_company', 'company_id'),
        Index('ix_wm_jobs_company_status', 'company_id', 'status'),
        Index(
            'uq_wm_jobs_sheet_row',
            'google_sheet_row_number', 'google_sheet_name',
            unique=True,
            postgresql_where=Column('google_sheet_row_number').isnot(None)
        ),
        {'extend_existing': True}
    )

    # Client relationship (legacy: points to companies table)
    client_id = Column(UUIDType(), ForeignKey("companies.id"))

    # Claim linkage (links to Client management system via Claim → Client)
    claim_id = Column(
        UUIDType(),
        ForeignKey("claims.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Company assignment (the service provider company responsible for this job)
    company_id = Column(
        UUIDType(),
        ForeignKey("companies.id", ondelete="SET NULL"),
        nullable=True,
        comment="Company responsible for/assigned to this job"
    )

    # Status management
    active = Column(Boolean, default=True, nullable=False)
    status = Column(String(50), default='Lead', nullable=False)

    # Google Sheets fields (A-P columns)
    property_address = Column(String(500), nullable=False, index=True)  # Full address (for search & compatibility)
    property_street = Column(String(255))  # Street address
    property_city = Column(String(100))  # City
    property_state = Column(String(50))  # State/Province
    property_zipcode = Column(String(20))  # Zipcode/Postal code
    homeowner_name = Column(String(255))
    homeowner_phone = Column(String(50))
    homeowner_email = Column(String(255))

    insurance_company = Column(String(255))
    insurance_policy_number = Column(String(100))
    claim_number = Column(String(100), index=True)

    date_of_loss = Column(DateTime(timezone=True))
    mitigation_period = Column(String(100))
    mitigation_start_date = Column(DateTime(timezone=True))
    mitigation_end_date = Column(DateTime(timezone=True))

    adjuster_name = Column(String(255))
    adjuster_phone = Column(String(100))
    adjuster_email = Column(String(255))

    inspection_date = Column(DateTime(timezone=True))
    inspection_time = Column(String(20))
    plumbers_report = Column(String(100))
    mitigation_flag = Column(Boolean, default=False)

    # Financial/Documents Information
    # Documents sent to adjuster (Invoice + COS + EWA + Photo Report)
    documents_sent_date = Column(DateTime(timezone=True))

    invoice_number = Column(String(100))
    invoice_amount = Column(DECIMAL(10, 2))

    # Payment Information
    check_number = Column(String(100))
    check_date = Column(DateTime(timezone=True))
    check_amount = Column(DECIMAL(10, 2))
    payment_status = Column(String(50), comment="pending | issued | homeowner_holding | lost | reissued | received | partial")
    payment_note = Column(Text)

    # External integration references
    companycam_project_id = Column(String(255), unique=True, index=True)
    google_sheet_row_number = Column(Integer, index=True)
    google_sheet_name = Column(String(100), index=True)  # Sheet tab name (e.g., "Angel", "Vanessa")

    # Sync timestamps
    companycam_last_sync = Column(DateTime(timezone=True))
    sheets_last_sync = Column(DateTime(timezone=True))

    # Audit fields
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"))
    updated_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationships
    claim_ref = relationship(
        "Claim", foreign_keys=[claim_id], lazy='select'
    )
    company = relationship(
        "Company",
        foreign_keys=[company_id],
        lazy="select"
    )
    photos = relationship(
        "WMPhoto",
        back_populates="job",
        cascade="all, delete-orphan"
    )
    documents = relationship(
        "WMDocument",
        back_populates="job",
        cascade="all, delete-orphan"
    )
    status_history = relationship(
        "WMJobStatusHistory",
        back_populates="job",
        cascade="all, delete-orphan"
    )
    report_config = relationship(
        "WMReportConfig",
        back_populates="job",
        uselist=False,
        cascade="all, delete-orphan"
    )
    scope_locations = relationship(
        "WMScopeLocation",
        back_populates="job",
        cascade="all, delete-orphan",
        order_by="WMScopeLocation.display_order"
    )
    debris_calculation = relationship(
        "WMDebrisCalculation",
        back_populates="job",
        uselist=False,
        cascade="all, delete-orphan"
    )
    floor_sketches = relationship(
        "WMFloorSketch",
        back_populates="job",
        cascade="all, delete-orphan",
        order_by="WMFloorSketch.floor_order",
    )


class PhotoCategory(Base, BaseModel):
    """Photo categories (predefined + user-created)"""
    __tablename__ = "photo_categories"
    __table_args__ = (
        Index('ix_photo_categories_client', 'client_id'),
        {'extend_existing': True}
    )

    client_id = Column(UUIDType(), ForeignKey("companies.id"))

    category_name = Column(String(100), nullable=False)
    category_type = Column(String(50), default='custom')  # 'predefined' | 'custom'
    color_code = Column(String(7), default='#1890ff')
    display_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)

    # Relationships
    photo_associations = relationship("WMPhotoCategory", back_populates="category", cascade="all, delete-orphan")


class WMPhoto(Base, BaseModel):
    """Water mitigation photos/videos"""
    __tablename__ = "wm_photos"
    __table_args__ = (
        Index('ix_wm_photos_job', 'job_id'),
        Index('ix_wm_photos_job_trashed', 'job_id', 'is_trashed'),
        Index('ix_wm_photos_category', 'category'),
        Index('ix_wm_photos_captured_date', 'captured_date'),
        {'extend_existing': True}
    )

    job_id = Column(UUIDType(), ForeignKey("water_mitigation_jobs.id"), nullable=False)

    source = Column(String(50), nullable=False)  # 'companycam' | 'manual_upload'
    external_id = Column(String(255), unique=True)

    # File information
    file_name = Column(String(500), nullable=False)
    file_path = Column(String(1000), nullable=False)  # URL from storage provider
    file_size = Column(Integer)
    mime_type = Column(String(100))
    file_type = Column(String(20))  # 'photo' | 'video'

    # Storage provider information (for flexible storage)
    storage_provider = Column(String(20), default='local')  # 'local' | 'gdrive' | 's3' | 'azure'
    storage_file_id = Column(String(500))  # Provider-specific file ID
    storage_thumbnail_url = Column(String(1000))  # Thumbnail URL from provider
    storage_web_url = Column(String(1000))  # Web-size URL from provider (e.g. CompanyCam CDN)
    storage_folder_path = Column(String(500))  # Hierarchical path in storage

    # Metadata
    title = Column(String(500))
    description = Column(Text)
    captured_date = Column(DateTime(timezone=True))
    category = Column(String(100), default='')  # Photo category - empty by default

    upload_status = Column(String(50), default='completed')
    uploaded_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Crew upload metadata (populated when source='crew_upload')
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    device_model = Column(String(200), nullable=True)
    upload_link_id = Column(UUIDType(), ForeignKey("upload_links.id"), nullable=True)

    # Trash/Deletion tracking
    is_trashed = Column(Boolean, default=False)
    trashed_at = Column(DateTime(timezone=True))
    trashed_by_id = Column(UUIDType(), ForeignKey("staff.id"))
    trash_reason = Column(String(100))  # 'user_deleted' | 'companycam_deleted' | 'manual'

    # Relationships
    job = relationship("WaterMitigationJob", back_populates="photos")
    category_associations = relationship("WMPhotoCategory", back_populates="photo", cascade="all, delete-orphan")


class WMDocument(Base, BaseModel):
    """Water mitigation documents (PDFs, certificates, agreements)"""
    __tablename__ = "wm_documents"
    __table_args__ = (
        Index('ix_wm_documents_job', 'job_id'),
        Index('ix_wm_documents_type', 'document_type'),
        {'extend_existing': True}
    )

    job_id = Column(UUIDType(), ForeignKey("water_mitigation_jobs.id"), nullable=False)

    # Document information
    document_type = Column(String(50), nullable=False)  # 'COS', 'EWA', 'invoice', 'report', etc.
    filename = Column(String(500), nullable=False)
    file_path = Column(String(1000), nullable=False)
    file_size = Column(Integer)
    mime_type = Column(String(100), default='application/pdf')

    # Metadata
    title = Column(String(500))
    description = Column(Text)

    # Source photos used to generate this document (JSON array of photo IDs)
    source_photo_ids = Column(Text)  # JSON: ["uuid1", "uuid2", ...]
    photo_count = Column(Integer, default=0)

    # Annotation data for re-editing (JSON: texts, signatures per page)
    annotation_data = Column(Text)  # JSON: PdfAnnotationData

    # Invoice-specific fields
    invoice_amount = Column(DECIMAL(10, 2))  # Amount for invoice documents

    # Upload source: 'generated' (from photos), 'manual_upload'
    upload_source = Column(String(50), default='generated')

    # Storage provider info (for manual uploads via StorageFactory)
    storage_provider = Column(String(50))  # 'local', 'gdrive', 's3', etc.
    storage_file_id = Column(String(500))  # Provider-specific file ID

    # Status
    is_active = Column(Boolean, default=True)
    generated_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationships
    job = relationship("WaterMitigationJob", back_populates="documents")


class WMPhotoCategory(Base):
    """Photo-Category association (many-to-many)"""
    __tablename__ = "wm_photo_categories"
    __table_args__ = (
        Index('ix_wm_photo_categories_photo', 'photo_id'),
        Index('ix_wm_photo_categories_category', 'category_id'),
        {'extend_existing': True}
    )

    id = Column(UUIDType(), primary_key=True, default=func.gen_random_uuid())
    photo_id = Column(UUIDType(), ForeignKey("wm_photos.id"), nullable=False)
    category_id = Column(UUIDType(), ForeignKey("photo_categories.id"), nullable=False)

    categorized_at = Column(DateTime(timezone=True), default=func.now())
    categorized_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationships
    photo = relationship("WMPhoto", back_populates="category_associations")
    category = relationship("PhotoCategory", back_populates="photo_associations")


class WMJobStatusHistory(Base, BaseModel):
    """Job status change history"""
    __tablename__ = "wm_job_status_history"
    __table_args__ = (
        Index('ix_wm_status_history_job', 'job_id'),
        {'extend_existing': True}
    )

    job_id = Column(UUIDType(), ForeignKey("water_mitigation_jobs.id"), nullable=False)

    previous_status = Column(String(50))
    new_status = Column(String(50), nullable=False)

    changed_by_id = Column(UUIDType(), ForeignKey("staff.id"))
    changed_at = Column(DateTime(timezone=True), default=func.now())
    notes = Column(Text)

    # Relationships
    job = relationship("WaterMitigationJob", back_populates="status_history")


class WMSyncLog(Base, BaseModel):
    """Integration sync log"""
    __tablename__ = "wm_sync_log"
    __table_args__ = (
        Index('ix_wm_sync_log_type', 'integration_type', 'status'),
        {'extend_existing': True}
    )

    integration_type = Column(String(50), nullable=False)  # 'companycam' | 'google_sheets'
    sync_type = Column(String(50), nullable=False)  # 'full' | 'incremental' | 'manual'
    status = Column(String(50), nullable=False)  # 'success' | 'partial' | 'failed'

    rows_processed = Column(Integer, default=0)
    rows_created = Column(Integer, default=0)
    rows_updated = Column(Integer, default=0)
    rows_failed = Column(Integer, default=0)

    error_message = Column(Text)
    error_details = Column(Text)  # JSON string

    started_at = Column(DateTime(timezone=True), nullable=False)
    completed_at = Column(DateTime(timezone=True))


class WMReportTemplate(Base, BaseModel):
    """
    Water mitigation photo report templates.

    Templates define reusable report structures with predefined sections.
    Each template can have multiple sections with specific layouts and descriptions.
    """
    __tablename__ = "wm_report_templates"
    __table_args__ = (
        Index('ix_wm_report_templates_type', 'template_type'),
        Index('ix_wm_report_templates_company', 'company_id'),
        Index('ix_wm_report_templates_default', 'template_type', 'is_default'),
        {'extend_existing': True}
    )

    # Template identification
    name = Column(String(255), nullable=False)
    description = Column(Text)
    template_type = Column(String(50), nullable=False, default='photo_report')  # 'photo_report', 'damage_assessment', etc.

    # Default template flag (only one default per type per company)
    is_default = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    # Company ownership (for multi-company support)
    # NULL means system-wide template
    company_id = Column(
        UUIDType(),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=True,
        comment="Company that owns this template (NULL for system templates)"
    )

    # Audit fields
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationships
    company = relationship("Company", foreign_keys=[company_id])
    sections = relationship(
        "WMReportTemplateSection",
        back_populates="template",
        cascade="all, delete-orphan",
        order_by="WMReportTemplateSection.display_order"
    )


class WMReportTemplateSection(Base, BaseModel):
    """
    Sections within a report template.

    Each section defines a part of the report with:
    - Title and optional prefilled description/summary
    - Photo layout configuration
    - Display order for sorting
    """
    __tablename__ = "wm_report_template_sections"
    __table_args__ = (
        Index('ix_wm_template_sections_template', 'template_id'),
        Index('ix_wm_template_sections_order', 'template_id', 'display_order'),
        {'extend_existing': True}
    )

    template_id = Column(
        UUIDType(),
        ForeignKey("wm_report_templates.id", ondelete="CASCADE"),
        nullable=False
    )

    # Section content
    title = Column(String(255), nullable=False)  # e.g., "Wet Area", "Pre-Mitigation Moving", "Demolition"
    summary = Column(Text)  # Optional prefilled description/summary

    # Layout configuration
    # 'single' = 1 photo/page, 'two' = 2 photos/page, etc.
    photo_layout = Column(String(20), nullable=False, default='four')
    default_photos_per_page = Column(Integer, nullable=False, default=2)

    # Display order for section sequencing
    display_order = Column(Integer, nullable=False, default=0)

    # Optional: dynamic placeholder markers for summary
    # e.g., "{{monitoring_dates}}" can be replaced when creating report config
    # Stored as JSON: {"monitoring_dates": "Monitoring performed on {dates}"}
    placeholders = Column(JSONB, default=dict)

    # Relationships
    template = relationship("WMReportTemplate", back_populates="sections")


class WMDemolitionType(Base, BaseModel):
    """
    Water Mitigation Demolition Type Reference.

    Stores predefined demolition types that can be reused across jobs.
    Each type can be mapped to a MaterialWeight for debris calculation.
    """
    __tablename__ = "wm_demolition_types"
    __table_args__ = (
        Index('ix_wm_demolition_types_active', 'is_active'),
        Index('ix_wm_demolition_types_category', 'category'),
        {'extend_existing': True}
    )

    # Basic information
    name = Column(String(255), nullable=False, unique=True)  # e.g., "Carpet", "Drywall 2ft from floor"
    category = Column(String(100))  # e.g., "Flooring", "Wall", "Trim"
    description = Column(Text)

    # Unit configuration
    default_unit = Column(String(20), nullable=False, default='SF')  # SF, LF, EA

    # Material mapping for debris calculation (optional link to MaterialWeight)
    material_weight_id = Column(
        UUIDType(),
        ForeignKey("material_weights.id", ondelete="SET NULL"),
        nullable=True,
        comment="Link to MaterialWeight for automatic debris calculation"
    )

    # Display
    display_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)

    # Audit
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"))
    updated_by_id = Column(UUIDType(), ForeignKey("staff.id"))


class WMScopeLocation(Base, BaseModel):
    """
    Water Mitigation Scope Location (Room/Area).

    Represents a physical location within a property where mitigation work is performed.
    Examples: "1st Floor - Bathroom", "Basement", "2nd Floor - Master Bedroom"
    """
    __tablename__ = "wm_scope_locations"
    __table_args__ = (
        Index('ix_wm_scope_locations_job', 'job_id'),
        Index('ix_wm_scope_locations_order', 'job_id', 'display_order'),
        {'extend_existing': True}
    )

    job_id = Column(UUIDType(), ForeignKey("water_mitigation_jobs.id", ondelete="CASCADE"), nullable=False)

    # Location information
    name = Column(String(255), nullable=False)  # e.g., "1st Floor - Bathroom"
    floor = Column(String(50))  # e.g., "1st Floor", "2nd Floor", "Basement"
    room_type = Column(String(100))  # e.g., "Bathroom", "Kitchen", "Bedroom"
    description = Column(Text)

    # Display
    display_order = Column(Integer, default=0)

    # Relationships
    job = relationship("WaterMitigationJob", back_populates="scope_locations")
    scope_items = relationship(
        "WMScopeItem",
        back_populates="location",
        cascade="all, delete-orphan",
        order_by="WMScopeItem.display_order"
    )


class WMScopeItem(Base, BaseModel):
    """
    Water Mitigation Scope of Work Item.

    Individual work items within a location. Can be:
    - Standard items: Floor Protection, Content Protection, Containment, Air Mover, etc.
    - Demolition items: Items with material_weight for debris calculation
    - Custom items: User-defined work items
    """
    __tablename__ = "wm_scope_items"
    __table_args__ = (
        Index('ix_wm_scope_items_location', 'location_id'),
        Index('ix_wm_scope_items_type', 'item_type'),
        # Performance indexes for foreign key joins (debris calculation, invoice lookup)
        Index('ix_wm_scope_items_material_weight', 'material_weight_id'),
        Index('ix_wm_scope_items_line_item', 'line_item_id'),
        # Composite index for debris query pattern
        Index('ix_wm_scope_items_debris', 'item_type', 'include_in_debris'),
        {'extend_existing': True}
    )

    location_id = Column(UUIDType(), ForeignKey("wm_scope_locations.id", ondelete="CASCADE"), nullable=False)

    # Item type classification
    item_type = Column(String(50), nullable=False)  # 'standard', 'demolition', 'custom'

    # Item details
    name = Column(String(255), nullable=False)  # e.g., "Floor Protection", "Carpet"
    description = Column(Text)

    # Measurement
    quantity = Column(DECIMAL(12, 4))  # Can store calculated result
    quantity_formula = Column(String(500))  # e.g., "10*12+5*8" - stores the original formula
    unit = Column(String(20), nullable=False, default='SF')  # SF, LF, EA

    # For debris calculation - direct link to MaterialWeight
    material_weight_id = Column(
        UUIDType(),
        ForeignKey("material_weights.id", ondelete="SET NULL"),
        nullable=True,
        comment="Link to MaterialWeight for debris calculation"
    )
    include_in_debris = Column(Boolean, default=True)  # Whether to include in debris calculation

    # Line Item reference for invoice rate lookup
    line_item_id = Column(
        UUIDType(),
        ForeignKey("line_items.id", ondelete="SET NULL"),
        nullable=True,
        comment="Link to LineItem for invoice rate lookup"
    )

    # Invoice tracking
    invoiced = Column(Boolean, default=False, comment="Whether this item has been invoiced")
    invoiced_at = Column(DateTime(timezone=True), comment="When this item was invoiced")

    # Display
    display_order = Column(Integer, default=0)

    # Relationships
    location = relationship("WMScopeLocation", back_populates="scope_items")
    material_weight = relationship("MaterialWeight")
    line_item = relationship("LineItem")


class WMDebrisCalculation(Base, BaseModel):
    """
    Water Mitigation Job Debris Calculation Summary.

    Stores the calculated debris totals for a job based on scope items.
    """
    __tablename__ = "wm_debris_calculations"
    __table_args__ = (
        Index('ix_wm_debris_calc_job', 'job_id'),
        {'extend_existing': True}
    )

    job_id = Column(UUIDType(), ForeignKey("water_mitigation_jobs.id", ondelete="CASCADE"), nullable=False, unique=True)

    # Calculation results
    total_weight_lb = Column(DECIMAL(12, 2))
    total_weight_ton = Column(DECIMAL(10, 4))

    # 42-gallon contractor bag count
    bag_count = Column(Integer, comment="Number of 42-gallon contractor bags needed")

    # Breakdown by category (JSON)
    category_breakdown = Column(JSONB, default=dict)  # {category_name: {weight_lb, weight_ton}}

    # Dumpster recommendation
    dumpster_recommendation = Column(JSONB)  # {size: "20 yard", capacity_tons: 3, count: 1}

    # Item details (JSON) - snapshot of items used in calculation
    item_details = Column(JSONB, default=list)  # [{item_id, name, quantity, unit, weight_lb, weight_ton}]

    # Calculation metadata
    calculated_at = Column(DateTime(timezone=True), default=func.now())
    calculated_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationships
    job = relationship("WaterMitigationJob", back_populates="debris_calculation")


class PhotoAnalysisCache(Base, BaseModel):
    """
    AI photo classification analysis cache.

    Stores AI analysis results and user corrections for Water Mitigation photos.
    Used to:
    - Cache expensive AI Vision API calls
    - Track user corrections for analytics
    - Provide pattern analysis data
    """
    __tablename__ = "photo_analysis_cache"
    __table_args__ = (
        Index('ix_photo_analysis_photo', 'photo_id'),
        Index('ix_photo_analysis_corrected', 'user_corrected'),
        {'extend_existing': True}
    )

    photo_id = Column(UUIDType(), ForeignKey("wm_photos.id", ondelete="CASCADE"), nullable=False, unique=True)

    # AI Analysis Result (JSON structure)
    # {
    #   "category": "wet-area",
    #   "confidence": 0.85,
    #   "metadata": {
    #     "meter_visible": true,
    #     "meter_color": "red",
    #     "is_demolished": false,
    #     "equipment_count": 0,
    #     "equipment_status": null,
    #     "mold_visible": false
    #   },
    #   "rule_applied": "meter_color_red_no_demo",
    #   "original_category": "day-1",  # Before rule correction
    #   "analyzed_at": "2024-01-15T10:30:00Z"
    # }
    ai_result = Column(JSONB, nullable=False)

    # User correction tracking (for analytics, not Few-shot learning)
    user_corrected = Column(Boolean, default=False)

    # Relationships
    photo = relationship("WMPhoto")


class WMScopeItemCategory(Base, BaseModel):
    """
    Water Mitigation Scope Item Category.

    Manages categories for grouping standard scope items.
    Categories can be system-wide (company_id NULL) or company-specific.

    Examples: "Equipment", "Protection", "Demolition", "Flooring"
    """
    __tablename__ = "wm_scope_item_categories"
    __table_args__ = (
        Index('ix_wm_scope_item_categories_active', 'is_active'),
        Index('ix_wm_scope_item_categories_company', 'company_id'),
        Index('ix_wm_scope_item_categories_order', 'display_order'),
        {'extend_existing': True}
    )

    # Company ownership (NULL = system-wide category)
    company_id = Column(
        UUIDType(),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=True,
        comment="Company that owns this category (NULL for system-wide categories)"
    )

    # Category details
    name = Column(String(100), nullable=False, comment="Category name (e.g., 'Equipment')")
    description = Column(Text, comment="Description of the category")
    color = Column(String(7), default='#1890ff', comment="Hex color code for UI display")
    icon = Column(String(50), comment="Icon identifier for UI display")

    # UI/Display configuration
    display_order = Column(Integer, default=0, comment="Order in UI lists")

    # Status
    is_active = Column(Boolean, default=True, nullable=False, comment="Soft delete flag")

    # Audit fields
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"))
    updated_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationships
    company = relationship("Company", foreign_keys=[company_id])
    scope_items = relationship("WMStandardScopeItem", back_populates="category_rel")


class WMStandardScopeItem(Base, BaseModel):
    """
    Water Mitigation Standard Scope Item Template.

    Stores predefined/template scope items that can be reused across jobs.
    Admins can manage these items dynamically instead of hardcoding.

    Features:
    - Company-specific items (company_id set) or system-wide items (company_id NULL)
    - Soft delete via is_active flag
    - Ordering via display_order
    - Category grouping for UI organization (via FK to WMScopeItemCategory)
    """
    __tablename__ = "wm_standard_scope_items"
    __table_args__ = (
        Index('ix_wm_standard_scope_items_active', 'is_active'),
        Index('ix_wm_standard_scope_items_company', 'company_id'),
        Index('ix_wm_standard_scope_items_type', 'item_type'),
        Index('ix_wm_standard_scope_items_category', 'category_id'),
        Index('ix_wm_standard_scope_items_order', 'display_order'),
        {'extend_existing': True}
    )

    # Company ownership (NULL = system-wide template available to all companies)
    company_id = Column(
        UUIDType(),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=True,
        comment="Company that owns this item (NULL for system-wide templates)"
    )

    # Item classification
    item_type = Column(
        String(50),
        nullable=False,
        default='standard',
        comment="Item type: 'standard', 'demolition', 'custom'"
    )

    # Category FK (replaces string category field)
    category_id = Column(
        UUIDType(),
        ForeignKey("wm_scope_item_categories.id", ondelete="SET NULL"),
        nullable=True,
        comment="Foreign key to WMScopeItemCategory"
    )

    # Item details
    name = Column(String(255), nullable=False, comment="Item name (e.g., 'Floor Protection')")
    description = Column(Text, comment="Detailed description of the item")

    # Unit configuration
    unit = Column(
        String(20),
        nullable=False,
        default='SF',
        comment="Default unit: 'SF', 'LF', 'EA'"
    )

    # Default values (can be overridden when adding to a location)
    default_quantity = Column(
        DECIMAL(12, 4),
        nullable=True,
        comment="Default quantity (if applicable)"
    )

    # Material mapping for demolition items (debris calculation)
    material_weight_id = Column(
        UUIDType(),
        ForeignKey("material_weights.id", ondelete="SET NULL"),
        nullable=True,
        comment="Link to MaterialWeight for debris calculation"
    )
    default_include_in_debris = Column(
        Boolean,
        default=False,
        comment="Default setting for debris inclusion"
    )

    # ========================================
    # Invoice Line Item Mapping
    # ========================================
    # Direct mapping to a line item for invoice generation
    line_item_id = Column(
        UUIDType(),
        ForeignKey("line_items.id", ondelete="SET NULL"),
        nullable=True,
        comment="Mapped line item for invoice generation"
    )

    # Custom line item data (when not using existing line_item)
    custom_line_item_name = Column(
        String(255),
        nullable=True,
        comment="Custom line item name for invoice (if no line_item_id)"
    )
    custom_line_item_rate = Column(
        DECIMAL(12, 4),
        nullable=True,
        comment="Custom rate for invoice (if no line_item_id)"
    )

    # Quantity calculation settings for invoice
    # 'fixed': Use scope item quantity as-is
    # 'per_day': Multiply by mitigation days
    # 'per_day_capped': Multiply by mitigation days up to max_days
    quantity_calc_type = Column(
        String(30),
        nullable=False,
        default='fixed',
        comment="Quantity calculation: fixed, per_day, per_day_capped"
    )
    max_days = Column(
        Integer,
        nullable=True,
        comment="Maximum days for per_day_capped calculation"
    )

    # Default note for invoice line item
    default_invoice_note = Column(
        Text,
        nullable=True,
        comment="Default note to include in invoice line item"
    )

    # UI/Display configuration
    display_order = Column(Integer, default=0, comment="Order in UI lists")

    # Status
    is_active = Column(Boolean, default=True, nullable=False, comment="Soft delete flag")

    # Audit fields
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"))
    updated_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationships
    company = relationship("Company", foreign_keys=[company_id])
    material_weight = relationship("MaterialWeight", foreign_keys=[material_weight_id])
    category_rel = relationship("WMScopeItemCategory", back_populates="scope_items")
    line_item = relationship("LineItem", foreign_keys=[line_item_id])


class WMScopeInvoice(Base, BaseModel):
    """
    Water Mitigation Scope Invoice link.

    Links a WM Job to a generated Invoice.
    Tracks when invoices are generated from scope items.
    """
    __tablename__ = "wm_scope_invoices"
    __table_args__ = (
        Index('ix_wm_scope_invoices_job', 'job_id'),
        Index('ix_wm_scope_invoices_invoice', 'invoice_id'),
        {'extend_existing': True}
    )

    job_id = Column(
        UUIDType(),
        ForeignKey("water_mitigation_jobs.id", ondelete="CASCADE"),
        nullable=False,
        comment="Water mitigation job reference"
    )
    invoice_id = Column(
        UUIDType(),
        ForeignKey("invoices.id", ondelete="CASCADE"),
        nullable=False,
        comment="Generated invoice reference"
    )
    generated_at = Column(DateTime(timezone=True), default=func.now(), nullable=False)
    generated_by_id = Column(UUIDType(), ForeignKey("staff.id", ondelete="SET NULL"))
    notes = Column(Text, comment="Optional notes about this invoice generation")

    # Relationships
    job = relationship("WaterMitigationJob")
    invoice = relationship("Invoice")
    item_links = relationship(
        "WMScopeItemInvoiceLink",
        back_populates="scope_invoice",
        cascade="all, delete-orphan"
    )


class WMScopeItemInvoiceLink(Base, BaseModel):
    """
    Link between WM Scope Item and Invoice Line Item.

    Provides bidirectional tracking between scope items and their
    corresponding invoice line items for traceability.
    """
    __tablename__ = "wm_scope_item_invoice_links"
    __table_args__ = (
        Index('ix_wm_scope_item_invoice_links_scope_invoice', 'wm_scope_invoice_id'),
        Index('ix_wm_scope_item_invoice_links_scope_item', 'scope_item_id'),
        Index('ix_wm_scope_item_invoice_links_invoice_item', 'invoice_item_id'),
        {'extend_existing': True}
    )

    wm_scope_invoice_id = Column(
        UUIDType(),
        ForeignKey("wm_scope_invoices.id", ondelete="CASCADE"),
        nullable=False,
        comment="Parent scope invoice record"
    )
    scope_item_id = Column(
        UUIDType(),
        ForeignKey("wm_scope_items.id", ondelete="CASCADE"),
        nullable=False,
        comment="WM Scope item reference"
    )
    invoice_item_id = Column(
        UUIDType(),
        ForeignKey("invoice_items.id", ondelete="CASCADE"),
        nullable=False,
        comment="Invoice line item reference"
    )

    # Relationships
    scope_invoice = relationship("WMScopeInvoice", back_populates="item_links")
    scope_item = relationship("WMScopeItem")
    invoice_item = relationship("InvoiceItem")


class WMReportConfig(Base, BaseModel):
    """Water mitigation photo report configuration"""
    __tablename__ = "wm_report_configs"
    __table_args__ = (
        Index('ix_wm_report_configs_job', 'job_id'),
        Index('ix_wm_report_configs_template', 'template_id'),
        {'extend_existing': True}
    )

    job_id = Column(UUIDType(), ForeignKey("water_mitigation_jobs.id", ondelete="CASCADE"), nullable=False, unique=True)

    # Optional reference to the template this config was created from
    template_id = Column(
        UUIDType(),
        ForeignKey("wm_report_templates.id", ondelete="SET NULL"),
        nullable=True,
        comment="Template this config was created from (for tracking/updates)"
    )

    # Cover Page
    cover_title = Column(String(255), default='Water Mitigation Photos')
    cover_description = Column(Text)

    # Sections (JSON array)
    # Structure: [
    #   {
    #     "id": "section-1",
    #     "title": "Damage Assessment",
    #     "summary": "Initial inspection findings...",
    #     "photos": [
    #       {
    #         "photo_id": "uuid",
    #         "caption": "Living room water damage",
    #         "show_date": true,
    #         "show_description": true
    #       }
    #     ],
    #     "layout": "four",  // 'single', 'two', 'three', 'four', 'six'
    #     "display_order": 1
    #   }
    # ]
    sections = Column(JSONB, nullable=False, default=list)

    # Metadata
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationships
    job = relationship("WaterMitigationJob")
    template = relationship("WMReportTemplate", foreign_keys=[template_id])


class WMSheetPAMapping(Base, BaseModel):
    """
    Maps a Google Sheet tab name to a PA (Public Adjuster) CompanyContact.

    When a WM job is synced from a sheet named e.g. "Angel", this table
    tells the system which PA contact "Angel" refers to, so the linked
    Claim is automatically updated with that PA's contact info.
    """
    __tablename__ = "wm_sheet_pa_mappings"
    __table_args__ = (
        {'extend_existing': True}
    )

    sheet_name = Column(String(100), nullable=False, unique=True, index=True,
                        comment="Google Sheet tab name (e.g. 'Angel', 'Vanessa')")
    pa_contact_id = Column(String(36), nullable=True,
                           comment="FK to company_contacts.id")


class WMInvoiceItemConfig(Base, BaseModel):
    """
    Water Mitigation Invoice Item Configuration.

    Stores per-job invoice item settings for generating invoices from scope items.
    Each config maps a scope item to an invoice line item with custom settings.

    Features:
    - Map to existing Line Item or create custom line item
    - Quantity calculation: fixed, per_day (based on mitigation period)
    - Default note that gets included in invoice item description
    - Equipment items can auto-calculate quantity based on mitigation days
    """
    __tablename__ = "wm_invoice_item_configs"
    __table_args__ = (
        Index('ix_wm_invoice_item_configs_job', 'job_id'),
        Index('ix_wm_invoice_item_configs_scope_item', 'scope_item_id'),
        Index('ix_wm_invoice_item_configs_line_item', 'line_item_id'),
        {'extend_existing': True}
    )

    job_id = Column(
        UUIDType(),
        ForeignKey("water_mitigation_jobs.id", ondelete="CASCADE"),
        nullable=False,
        comment="Water mitigation job reference"
    )

    # Source scope item (optional - for item-specific config)
    scope_item_id = Column(
        UUIDType(),
        ForeignKey("wm_scope_items.id", ondelete="CASCADE"),
        nullable=True,
        comment="Specific scope item this config applies to"
    )

    # Standard scope item (optional - for template-level default config)
    standard_scope_item_id = Column(
        UUIDType(),
        ForeignKey("wm_standard_scope_items.id", ondelete="SET NULL"),
        nullable=True,
        comment="Standard scope item for default config (if no specific scope_item)"
    )

    # Target Line Item (existing)
    line_item_id = Column(
        UUIDType(),
        ForeignKey("line_items.id", ondelete="SET NULL"),
        nullable=True,
        comment="Target line item for invoice"
    )

    # Custom line item data (when not using existing line_item)
    custom_name = Column(String(255), comment="Custom line item name")
    custom_description = Column(Text, comment="Custom line item description")
    custom_rate = Column(DECIMAL(12, 4), comment="Custom rate")
    custom_unit = Column(String(20), comment="Custom unit (SF, LF, EA)")

    # Quantity calculation settings
    # 'fixed': Use scope item quantity as-is
    # 'per_day': Multiply by mitigation days
    # 'per_day_capped': Multiply by mitigation days up to max_days
    # 'auto_calculated': System-calculated quantity (e.g., for General Conditions)
    quantity_calc_type = Column(
        String(30),
        nullable=False,
        default='fixed',
        comment="Quantity calculation type: 'fixed', 'per_day', 'per_day_capped', 'auto_calculated'"
    )
    max_days = Column(
        Integer,
        nullable=True,
        comment="Maximum days for per_day_capped calculation"
    )

    # Pre-calculated quantity (for General Conditions auto-calculated items)
    # When set, this overrides the scope_item.quantity in invoice generation
    calculated_quantity = Column(
        DECIMAL(12, 4),
        nullable=True,
        comment="Pre-calculated quantity for auto-calculated items (e.g., debris hrs, equipment monitoring hrs)"
    )

    # Default note for this item (gets added to invoice item description)
    default_note = Column(
        Text,
        nullable=True,
        comment="Default note to include in invoice item description"
    )

    # Whether to include this item in invoice generation
    is_enabled = Column(Boolean, default=True, comment="Whether to include in invoice")

    # Display order in configuration UI
    display_order = Column(Integer, default=0)

    # Relationships
    job = relationship("WaterMitigationJob")
    scope_item = relationship("WMScopeItem")
    standard_scope_item = relationship("WMStandardScopeItem")
    line_item = relationship("LineItem")
