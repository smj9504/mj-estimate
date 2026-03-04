"""
Photo Analysis Database Models

Database models for caching photo analysis results.
"""

from sqlalchemy import Column, String, DateTime, JSON, Float, Index, Integer, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType


class PhotoAnalysisCache(Base, BaseModel):
    """Cache table for photo analysis results"""
    __tablename__ = "photo_analysis_cache"
    __table_args__ = (
        Index('ix_photo_analysis_cache_key', 'cache_key', unique=True),
        Index('ix_photo_analysis_cache_user_id', 'user_id'),
        Index('ix_photo_analysis_cache_expires_at', 'expires_at'),
        {'extend_existing': True}
    )

    cache_key = Column(String(255), unique=True, nullable=False)
    room_type = Column(String(50), nullable=False)
    photo_urls = Column(JSON, nullable=False)  # List of photo URLs
    analysis_result = Column(JSON, nullable=False)  # Full PhotoAnalysisResponse as JSON
    confidence_score = Column(Float, nullable=False)
    user_id = Column(UUIDType(), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)

    # Timestamps from BaseModel: created_at, updated_at

    def __repr__(self):
        return f"<PhotoAnalysisCache(cache_key={self.cache_key}, room_type={self.room_type})>"


class PhotoAnalysis(Base, BaseModel):
    """Main photo analysis record"""
    __tablename__ = "photo_analyses"
    __table_args__ = (
        Index('ix_photo_analyses_company_id', 'company_id'),
        Index('ix_photo_analyses_job_id', 'job_id'),
        {'extend_existing': True}
    )

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(UUIDType(), ForeignKey('companies.id'), nullable=False)
    job_id = Column(String(100), nullable=True)
    room_name = Column(String(100), nullable=True)
    photo_urls = Column(JSON, nullable=False)  # List of photo URLs
    analysis_type = Column(String(50), nullable=False)  # 'water_mitigation', 'packout', 'general'
    analysis_results = Column(JSON, nullable=False)  # Full analysis results
    confidence_score = Column(Float, nullable=False)
    user_id = Column(UUIDType(), nullable=True)

    # Relationships
    packout_analysis = relationship("PhotoAnalysisPackout", back_populates="photo_analysis", uselist=False)
    pack_estimate = relationship("PackEstimate", back_populates="photo_analysis", uselist=False)

    def __repr__(self):
        return f"<PhotoAnalysis(id={self.id}, job_id={self.job_id}, room_name={self.room_name})>"


class PackEstimateStatus:
    """Pack Estimate status constants"""
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    CONVERTED = "converted"  # Converted to estimate document


class PackEstimate(Base, BaseModel):
    """
    Pack-Out Estimate generated from photo analysis.

    Stores the complete pack estimate result including:
    - Phase 1 inventory (items detected from photos)
    - Phase 2 line items (pricing and labor)
    - Packing summary (box requirements, supplies, crew info)
    """
    __tablename__ = "pack_estimates"
    __table_args__ = (
        Index('ix_pack_estimates_company_id', 'company_id'),
        Index('ix_pack_estimates_job_id', 'job_id'),
        Index('ix_pack_estimates_status', 'status'),
        Index('ix_pack_estimates_created_at', 'created_at'),
        {'extend_existing': True}
    )

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(UUIDType(), ForeignKey('companies.id'), nullable=False)
    photo_analysis_id = Column(Integer, ForeignKey('photo_analyses.id'), nullable=True)

    # Job/Project Reference
    job_id = Column(String(100), nullable=True)  # External job reference (indexed via __table_args__)
    job_name = Column(String(255), nullable=True)
    customer_name = Column(String(255), nullable=True)
    address = Column(String(500), nullable=True)

    # Room/Location info
    room_name = Column(String(100), nullable=False)

    # Status tracking
    status = Column(String(50), nullable=False, default=PackEstimateStatus.DRAFT)

    # Photo URLs used for analysis
    photo_urls = Column(JSON, nullable=False)  # List[str]

    # Phase 1 Results: Inventory
    phase1_inventory = Column(JSON, nullable=True)  # Phase1Result as JSON
    items_detected_count = Column(Integer, default=0)

    # Box Requirements (denormalized for easy querying)
    box_small_count = Column(Integer, default=0)
    box_medium_count = Column(Integer, default=0)
    box_large_count = Column(Integer, default=0)
    box_extra_large_count = Column(Integer, default=0)
    box_wardrobe_count = Column(Integer, default=0)
    box_dish_pack_count = Column(Integer, default=0)
    box_picture_count = Column(Integer, default=0)
    box_long_count = Column(Integer, default=0)
    box_lamp_count = Column(Integer, default=0)
    box_tv_count = Column(Integer, default=0)
    box_tube_count = Column(Integer, default=0)
    box_other_count = Column(Integer, default=0)
    total_boxes = Column(Integer, default=0)

    # Packing Summary
    packing_summary = Column(JSON, nullable=True)  # PackingSummary as JSON
    fragile_item_count = Column(Integer, default=0)
    heavy_item_count = Column(Integer, default=0)
    estimated_pack_time_hours = Column(Float, default=0.0)
    crew_size_recommended = Column(Integer, default=2)
    special_equipment_needed = Column(JSON, nullable=True)  # List[str]

    # Phase 2 Results: Line Items
    line_items = Column(JSON, nullable=True)  # List[PackEstimateLineItem] as JSON
    line_items_count = Column(Integer, default=0)

    # Estimate Summary (Pricing)
    subtotal = Column(Float, default=0.0)
    tax_rate = Column(Float, default=0.0)
    tax_amount = Column(Float, default=0.0)
    total = Column(Float, default=0.0)

    # Processing metadata
    processing_info = Column(JSON, nullable=True)  # Dict with processing details

    # Audit fields
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"), nullable=True)
    updated_by_id = Column(UUIDType(), ForeignKey("staff.id"), nullable=True)
    approved_by_id = Column(UUIDType(), ForeignKey("staff.id"), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)

    # Notes
    notes = Column(String(2000), nullable=True)

    # Converted estimate reference (if converted to full estimate document)
    converted_estimate_id = Column(UUIDType(), nullable=True)
    converted_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    photo_analysis = relationship("PhotoAnalysis", back_populates="pack_estimate", lazy="noload")

    def __repr__(self):
        return f"<PackEstimate(id={self.id}, job_id={self.job_id}, room={self.room_name}, status={self.status})>"

    def get_box_requirements_dict(self) -> dict:
        """Get box requirements as a dictionary"""
        return {
            "SMALL_BOX": self.box_small_count,
            "MEDIUM_BOX": self.box_medium_count,
            "LARGE_BOX": self.box_large_count,
            "EXTRA_LARGE_BOX": self.box_extra_large_count,
            "WARDROBE_BOX": self.box_wardrobe_count,
            "DISH_PACK_BOX": self.box_dish_pack_count,
            "PICTURE_BOX": self.box_picture_count,
            "LONG_BOX": self.box_long_count,
            "LAMP_BOX": self.box_lamp_count,
            "TV_BOX": self.box_tv_count,
            "TUBE_BOX": self.box_tube_count,
            "OTHER": self.box_other_count,
        }

    def set_box_requirements(self, box_req: dict) -> None:
        """Set box requirements from a dictionary"""
        self.box_small_count = box_req.get("SMALL_BOX", 0)
        self.box_medium_count = box_req.get("MEDIUM_BOX", 0)
        self.box_large_count = box_req.get("LARGE_BOX", 0)
        self.box_extra_large_count = box_req.get("EXTRA_LARGE_BOX", 0)
        self.box_wardrobe_count = box_req.get("WARDROBE_BOX", 0)
        self.box_dish_pack_count = box_req.get("DISH_PACK_BOX", 0)
        self.box_picture_count = box_req.get("PICTURE_BOX", 0)
        self.box_long_count = box_req.get("LONG_BOX", 0)
        self.box_lamp_count = box_req.get("LAMP_BOX", 0)
        self.box_tv_count = box_req.get("TV_BOX", 0)
        self.box_tube_count = box_req.get("TUBE_BOX", 0)
        self.box_other_count = box_req.get("OTHER", 0)

        # Calculate total
        self.total_boxes = sum([
            self.box_small_count, self.box_medium_count, self.box_large_count,
            self.box_extra_large_count, self.box_wardrobe_count, self.box_dish_pack_count,
            self.box_picture_count, self.box_long_count, self.box_lamp_count,
            self.box_tv_count, self.box_tube_count, self.box_other_count
        ])
