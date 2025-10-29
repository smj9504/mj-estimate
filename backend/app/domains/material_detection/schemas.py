"""
Material Detection Schemas

Pydantic models for request/response validation.
Updated to accept string image IDs including temporary IDs.
"""

from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Dict, Any, Union
from datetime import datetime
from decimal import Decimal
from uuid import UUID
from enum import Enum


class JobStatus(str, Enum):
    """Material detection job status"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class ProviderType(str, Enum):
    """Material detection provider types"""
    ROBOFLOW = "roboflow"
    GOOGLE_VISION = "google_vision"
    CUSTOM_VIT = "custom_vit"
    ENSEMBLE = "ensemble"


# ===== Request Schemas =====

class MaterialDetectionJobCreate(BaseModel):
    """Create material detection job request"""
    job_name: Optional[str] = Field(None, max_length=255, description="Optional job name")
    reconstruction_estimate_id: Optional[UUID] = Field(None, description="Link to reconstruction estimate")
    provider: ProviderType = Field(ProviderType.ROBOFLOW, description="Detection provider to use")
    confidence_threshold: Union[Decimal, float] = Field(0.70, ge=0.0, le=1.0, description="Minimum confidence score")
    image_ids: List[str] = Field(..., min_length=1, max_length=50, description="List of image IDs to process (UUID or temp string)")

    @field_validator('confidence_threshold', mode='before')
    @classmethod
    def validate_confidence(cls, v):
        # Convert to Decimal for consistent handling
        if isinstance(v, str):
            v = Decimal(v)
        elif isinstance(v, float):
            v = Decimal(str(v))
        elif not isinstance(v, Decimal):
            v = Decimal(str(v))

        if v < 0 or v > 1:
            raise ValueError('Confidence threshold must be between 0.0 and 1.0')
        return v

    @field_validator('image_ids', mode='before')
    @classmethod
    def validate_image_ids(cls, v):
        # Accept both UUID strings and temporary IDs
        if not isinstance(v, list):
            raise ValueError('image_ids must be a list')

        # Convert all items to strings
        return [str(item) for item in v]


class MaterialDetectionJobUpdate(BaseModel):
    """Update material detection job request"""
    job_name: Optional[str] = Field(None, max_length=255)
    status: Optional[JobStatus] = None


class DetectedMaterialUpdate(BaseModel):
    """Update detected material (for manual review)"""
    material_category: Optional[str] = Field(None, max_length=100)
    material_type: Optional[str] = Field(None, max_length=100)
    material_grade: Optional[str] = Field(None, max_length=100)
    material_finish: Optional[str] = Field(None, max_length=100)
    material_description: Optional[str] = None
    quantity_estimate: Optional[Decimal] = None
    unit_type: Optional[str] = Field(None, max_length=10)
    unit_price: Optional[Decimal] = None
    needs_review: Optional[bool] = None
    review_notes: Optional[str] = None


# ===== Response Schemas =====

class BoundingBox(BaseModel):
    """Bounding box coordinates"""
    x: int = Field(..., description="X coordinate (top-left)")
    y: int = Field(..., description="Y coordinate (top-left)")
    width: int = Field(..., description="Width in pixels")
    height: int = Field(..., description="Height in pixels")


class DetectedMaterialResponse(BaseModel):
    """Detected material response"""
    id: UUID
    job_id: UUID
    image_id: UUID
    image_url: Optional[str] = None

    # Material details
    material_category: str
    material_type: Optional[str] = None
    material_grade: Optional[str] = None
    material_finish: Optional[str] = None
    material_description: Optional[str] = None

    # Confidence & metadata
    confidence_score: Decimal
    provider_used: str
    bounding_box: Optional[BoundingBox] = None

    # Quantity estimation
    quantity_estimate: Optional[Decimal] = None
    unit_type: Optional[str] = None
    unit_price: Optional[Decimal] = None
    total_estimate: Optional[Decimal] = None

    # Performance
    detection_time_ms: Optional[int] = None

    # Debug info (Google Vision raw response)
    raw_response: Optional[Dict[str, Any]] = Field(None, description="Raw provider response for debugging")

    # Quality flags
    needs_review: bool = False
    reviewed_by_id: Optional[UUID] = None
    review_notes: Optional[str] = None

    # Timestamps
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class MaterialDetectionJobResponse(BaseModel):
    """Material detection job response"""
    id: UUID
    job_name: Optional[str] = None
    status: JobStatus
    reconstruction_estimate_id: Optional[UUID] = None

    # Configuration
    provider: str
    confidence_threshold: Decimal

    # Progress
    total_images: int
    processed_images: int
    total_materials_detected: int
    avg_confidence: Optional[Decimal] = None
    processing_time_ms: Optional[int] = None

    # Error handling
    error_message: Optional[str] = None

    # Debug info
    debug_info: Optional[Dict[str, Any]] = Field(None, description="Debug information for troubleshooting")

    # Audit
    created_by_id: UUID
    created_at: datetime
    completed_at: Optional[datetime] = None

    # Relationships
    detected_materials: List[DetectedMaterialResponse] = []

    class Config:
        from_attributes = True


class MaterialDetectionJobSummary(BaseModel):
    """Material detection job summary (without full material list)"""
    id: UUID
    job_name: Optional[str] = None
    status: JobStatus
    reconstruction_estimate_id: Optional[UUID] = None
    provider: str
    confidence_threshold: Decimal
    total_images: int
    processed_images: int
    total_materials_detected: int
    avg_confidence: Optional[Decimal] = None
    processing_time_ms: Optional[int] = None
    error_message: Optional[str] = None
    created_by_id: UUID
    created_at: datetime
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class MaterialDetectionJobList(BaseModel):
    """Paginated list of material detection jobs"""
    jobs: List[MaterialDetectionJobSummary]
    total: int
    page: int
    page_size: int
    has_next: bool
    has_prev: bool


class ProviderHealthStatus(BaseModel):
    """Provider health check status"""
    provider_name: str
    available: bool
    response_time_ms: Optional[int] = None
    error: Optional[str] = None


class MaterialDetectionHealthResponse(BaseModel):
    """Material detection service health check"""
    status: str  # 'healthy', 'degraded', 'unavailable'
    providers: List[ProviderHealthStatus]
    timestamp: datetime


# ===== Statistics Schemas =====

class MaterialCategoryStats(BaseModel):
    """Statistics for a material category"""
    category: str
    count: int
    avg_confidence: Decimal
    total_estimated_value: Optional[Decimal] = None


class MaterialDetectionStats(BaseModel):
    """Overall material detection statistics"""
    total_jobs: int
    total_images_processed: int
    total_materials_detected: int
    avg_confidence: Decimal
    by_category: List[MaterialCategoryStats]
    by_provider: Dict[str, int]
