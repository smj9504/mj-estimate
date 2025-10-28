"""
Water Mitigation domain models
"""

from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey, Boolean, Index, DECIMAL
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database_factory import Base
from app.core.base_models import BaseModel
from app.core.database_types import UUIDType


class WaterMitigationJob(Base, BaseModel):
    """Water mitigation job/lead"""
    __tablename__ = "water_mitigation_jobs"
    __table_args__ = (
        Index('ix_wm_jobs_active_status', 'active', 'status'),
        {'extend_existing': True}
    )

    # Client relationship
    client_id = Column(UUIDType(), ForeignKey("companies.id"))

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
    adjuster_phone = Column(String(50))
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

    # External integration references
    companycam_project_id = Column(String(255), unique=True, index=True)
    google_sheet_row_number = Column(Integer, index=True)

    # Sync timestamps
    companycam_last_sync = Column(DateTime(timezone=True))
    sheets_last_sync = Column(DateTime(timezone=True))

    # Audit fields
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"))
    updated_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationships
    photos = relationship("WMPhoto", back_populates="job", cascade="all, delete-orphan")
    documents = relationship("WMDocument", back_populates="job", cascade="all, delete-orphan")
    status_history = relationship("WMJobStatusHistory", back_populates="job", cascade="all, delete-orphan")
    report_config = relationship("WMReportConfig", back_populates="job", uselist=False, cascade="all, delete-orphan")


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
        {'extend_existing': True}
    )

    job_id = Column(UUIDType(), ForeignKey("water_mitigation_jobs.id"), nullable=False)

    source = Column(String(50), nullable=False)  # 'companycam' | 'manual_upload'
    external_id = Column(String(255), unique=True)

    # File information
    file_name = Column(String(500), nullable=False)
    file_path = Column(String(1000), nullable=False)
    file_size = Column(Integer)
    mime_type = Column(String(100))
    file_type = Column(String(20))  # 'photo' | 'video'

    # Metadata
    title = Column(String(500))
    description = Column(Text)
    captured_date = Column(DateTime(timezone=True))
    category = Column(String(100), default='')  # Photo category - empty by default

    upload_status = Column(String(50), default='completed')
    uploaded_by_id = Column(UUIDType(), ForeignKey("staff.id"))

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


class WMReportConfig(Base, BaseModel):
    """Water mitigation photo report configuration"""
    __tablename__ = "wm_report_configs"
    __table_args__ = (
        Index('ix_wm_report_configs_job', 'job_id'),
        {'extend_existing': True}
    )

    job_id = Column(UUIDType(), ForeignKey("water_mitigation_jobs.id", ondelete="CASCADE"), nullable=False, unique=True)

    # Cover Page
    cover_title = Column(String(255), default='Water Mitigation Report')
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
