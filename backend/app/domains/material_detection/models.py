"""
Material Detection Domain Models

Database models for material detection jobs and detected materials.
"""

from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey, Index, DECIMAL, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from app.core.database_factory import Base
from app.core.base_models import BaseModel
from app.core.database_types import UUIDType
import enum


class JobStatus(enum.Enum):
    """Material detection job status"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class MaterialDetectionJob(Base, BaseModel):
    """
    Material detection job

    Represents a batch of images to be processed for material detection.
    """
    __tablename__ = "material_detection_jobs"
    __table_args__ = (
        Index('ix_material_detection_jobs_user', 'created_by_id'),
        Index('ix_material_detection_jobs_status', 'status'),
        Index('ix_material_detection_jobs_estimate', 'reconstruction_estimate_id'),
        Index('ix_material_detection_jobs_created', 'created_at'),
        {'extend_existing': True}
    )

    # Job metadata
    job_name = Column(String(255))
    status = Column(SQLEnum(JobStatus), nullable=False, default=JobStatus.PENDING)

    # Optional link to reconstruction estimate
    reconstruction_estimate_id = Column(UUIDType(), nullable=True)

    # Configuration
    provider = Column(String(50))  # 'roboflow', 'google_vision', 'custom_vit', 'ensemble'
    confidence_threshold = Column(DECIMAL(3, 2), default=0.70)

    # Progress tracking
    total_images = Column(Integer, default=0, nullable=False)
    processed_images = Column(Integer, default=0, nullable=False)

    # Results summary
    total_materials_detected = Column(Integer, default=0, nullable=False)
    avg_confidence = Column(DECIMAL(5, 4))
    processing_time_ms = Column(Integer)

    # Error handling
    error_message = Column(Text)

    # Audit fields
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"), nullable=False)
    updated_by_id = Column(UUIDType(), ForeignKey("staff.id"))
    completed_at = Column(DateTime(timezone=True))

    # Relationships
    detected_materials = relationship(
        "DetectedMaterial",
        back_populates="job",
        cascade="all, delete-orphan",
        lazy="selectin"
    )
    created_by = relationship("Staff", foreign_keys=[created_by_id])
    updated_by = relationship("Staff", foreign_keys=[updated_by_id])


class DetectedMaterial(Base, BaseModel):
    """
    Individual detected material result

    Represents a material detected in a single image.
    """
    __tablename__ = "detected_materials"
    __table_args__ = (
        Index('ix_detected_materials_job', 'job_id'),
        Index('ix_detected_materials_image', 'image_id'),
        Index('ix_detected_materials_category', 'material_category'),
        Index('ix_detected_materials_confidence', 'confidence_score'),
        {'extend_existing': True}
    )

    # Parent job
    job_id = Column(UUIDType(), ForeignKey("material_detection_jobs.id", ondelete="CASCADE"), nullable=False)

    # Source image (files table uses String for id, not UUID)
    image_id = Column(String, ForeignKey("files.id"), nullable=False)
    image_url = Column(String(1000))

    # Detection results
    material_category = Column(String(100), nullable=False)  # e.g., 'Hardwood Flooring'
    material_type = Column(String(100))                      # e.g., 'White Oak'
    material_grade = Column(String(100))                     # e.g., 'Natural #1'
    material_finish = Column(String(100))                    # e.g., 'Solid', '3/4"'
    material_description = Column(Text)                      # Additional details

    # Confidence & metadata
    confidence_score = Column(DECIMAL(5, 4), nullable=False)  # 0.0000 - 1.0000
    provider_used = Column(String(50), nullable=False)
    bounding_box = Column(JSONB)  # {x: int, y: int, width: int, height: int}

    # Optional quantity estimation
    quantity_estimate = Column(DECIMAL(10, 2))  # Estimated quantity
    unit_type = Column(String(10))              # 'SF', 'LF', 'EA'
    unit_price = Column(DECIMAL(10, 2))         # Price per unit
    total_estimate = Column(DECIMAL(12, 2))     # Total estimated cost

    # Performance tracking
    detection_time_ms = Column(Integer)
    raw_response = Column(JSONB)  # Full API response for debugging/analysis

    # Quality flags
    needs_review = Column(Integer, default=0, nullable=False)  # Boolean as int for compatibility
    reviewed_by_id = Column(UUIDType(), ForeignKey("staff.id"))
    review_notes = Column(Text)

    # Relationships
    job = relationship("MaterialDetectionJob", back_populates="detected_materials")
    image = relationship("File")
    reviewed_by = relationship("Staff", foreign_keys=[reviewed_by_id])
