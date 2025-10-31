"""
ML Training Schemas

Pydantic schemas for training API requests and responses.
"""

from pydantic import BaseModel, Field, validator
from typing import Optional, List, Dict, Any
from datetime import datetime
from uuid import UUID


# ===== Dataset Schemas =====

class TrainingDatasetCreate(BaseModel):
    """Create new training dataset"""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    train_split: int = Field(70, ge=0, le=100)
    val_split: int = Field(20, ge=0, le=100)
    test_split: int = Field(10, ge=0, le=100)
    augmentation_config: Optional[Dict[str, Any]] = None

    @validator('test_split')
    def validate_splits(cls, v, values):
        """Ensure splits sum to 100"""
        train = values.get('train_split', 70)
        val = values.get('val_split', 20)
        if train + val + v != 100:
            raise ValueError(f"Splits must sum to 100% (got {train + val + v}%)")
        return v


class TrainingDatasetUpdate(BaseModel):
    """Update training dataset"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    status: Optional[str] = None  # 'draft', 'labeling', 'ready', 'archived'
    train_split: Optional[int] = Field(None, ge=0, le=100)
    val_split: Optional[int] = Field(None, ge=0, le=100)
    test_split: Optional[int] = Field(None, ge=0, le=100)
    augmentation_config: Optional[Dict[str, Any]] = None


class TrainingDatasetResponse(BaseModel):
    """Training dataset response"""
    id: UUID
    name: str
    description: Optional[str]
    status: str

    # Statistics
    total_images: int
    labeled_images: int
    verified_images: int

    # Split configuration
    train_split: int
    val_split: int
    test_split: int

    # Augmentation
    augmentation_config: Optional[Dict[str, Any]]

    # Audit
    created_by_id: UUID
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


# ===== Training Image Schemas =====

class TrainingImageCreate(BaseModel):
    """Add image to training dataset"""
    dataset_id: UUID
    file_id: UUID
    image_url: Optional[str] = None


class TrainingImageLabel(BaseModel):
    """Manual label or correction"""
    material_category: Optional[str] = None
    material_type: Optional[str] = None
    material_species: Optional[str] = None
    material_grade: Optional[str] = None
    material_width: Optional[str] = None
    material_finish: Optional[str] = None
    material_color: Optional[str] = None
    material_thickness: Optional[str] = None
    review_notes: Optional[str] = None


class TrainingDetectedMaterialResponse(BaseModel):
    """Individual training detected material response"""
    id: UUID
    training_image_id: UUID
    material_order: int
    coverage_percentage: Optional[int]
    location_in_image: Optional[str]

    # Classification
    category: Optional[str]
    subcategory: Optional[str]
    material_type: Optional[str]
    species: Optional[str]

    # Specifications
    grade: Optional[str]
    width: Optional[str]
    thickness: Optional[str]
    finish: Optional[str]
    color: Optional[str]

    # Critical pricing factors
    density: Optional[str]
    pattern: Optional[str]
    condition: Optional[str]
    additional_specs: Optional[str]

    # Confidence scores
    category_confidence: Optional[int]
    subcategory_confidence: Optional[int]
    grade_confidence: Optional[int]
    density_confidence: Optional[int]
    pattern_confidence: Optional[int]

    # Pricing metadata
    pricing_notes: Optional[str]

    # Timestamps
    created_at: datetime

    class Config:
        from_attributes = True


class TrainingImageResponse(BaseModel):
    """Training image response"""
    id: UUID
    dataset_id: UUID
    file_id: UUID
    image_url: Optional[str]

    # Status
    labeling_status: str
    auto_labeled: bool
    split_type: Optional[str]

    # Detected materials (multi-material support)
    detected_materials: List["TrainingDetectedMaterialResponse"] = []

    # Legacy labels (deprecated - kept for backward compatibility)
    material_category: Optional[str]
    material_type: Optional[str]
    material_species: Optional[str]
    material_grade: Optional[str]
    material_width: Optional[str]
    material_finish: Optional[str]
    material_color: Optional[str]
    material_thickness: Optional[str]

    # Confidence
    category_confidence: Optional[int]
    type_confidence: Optional[int]
    species_confidence: Optional[int]
    grade_confidence: Optional[int]

    # Review
    review_notes: Optional[str]
    reviewed_by_id: Optional[UUID]
    reviewed_at: Optional[datetime]

    # Audit
    created_at: datetime

    class Config:
        from_attributes = True


# ===== Auto-Labeling Schemas =====

class AutoLabelRequest(BaseModel):
    """Request auto-labeling for images"""
    image_ids: List[UUID]  # Images to label
    temperature: float = Field(0.0, ge=0.0, le=2.0)
    detail: str = Field("high", pattern="^(low|high)$")
    batch_size: int = Field(10, ge=1, le=100)


class AutoLabelProgress(BaseModel):
    """Auto-labeling progress update"""
    processed: int
    total: int
    successful: int
    failed: int
    current_image: Optional[str] = None
    estimated_cost: float


class AutoLabelResponse(BaseModel):
    """Auto-labeling job response"""
    job_id: UUID
    dataset_id: UUID
    total_images: int
    estimated_cost: float
    message: str


# ===== Training Job Schemas =====

class TrainingJobCreate(BaseModel):
    """Create new training job"""
    job_name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    dataset_id: UUID
    model_type: str = Field("multi_attribute_cnn")  # 'multi_attribute_cnn', 'yolov8'
    backbone: str = Field("resnet50")  # 'resnet50', 'efficientnet_b0', etc.
    hyperparameters: Dict[str, Any] = Field(default_factory=lambda: {
        "learning_rate": 0.001,
        "batch_size": 32,
        "epochs": 50,
        "optimizer": "adam",
        "weight_decay": 0.0001,
        "scheduler": "step_lr",
        "patience": 10
    })


class TrainingJobResponse(BaseModel):
    """Training job response"""
    id: UUID
    job_name: str
    description: Optional[str]
    status: str

    # Dataset
    dataset_id: UUID

    # Model configuration
    model_type: str
    backbone: Optional[str]
    hyperparameters: Optional[Dict[str, Any]]

    # Progress
    current_epoch: int
    total_epochs: int

    # Metrics
    training_metrics: Optional[Dict[str, Any]]
    validation_metrics: Optional[Dict[str, Any]]
    test_metrics: Optional[Dict[str, Any]]

    # Model artifacts
    model_version: Optional[str]
    model_path: Optional[str]

    # Performance
    training_time_seconds: Optional[int]
    gpu_used: Optional[str]

    # Error
    error_message: Optional[str]

    # Deployment
    deployed: bool
    deployed_at: Optional[datetime]

    # Audit
    created_by_id: UUID
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]

    class Config:
        from_attributes = True


# ===== Model Version Schemas =====

class ModelVersionCreate(BaseModel):
    """Create new model version"""
    version: str = Field(..., pattern=r"^v\d+\.\d+\.\d+$")  # e.g., 'v1.0.0'
    name: Optional[str] = None
    description: Optional[str] = None
    training_job_id: UUID
    model_path: str
    model_type: str
    accuracy_metrics: Dict[str, Any]


class ModelVersionDeploy(BaseModel):
    """Deploy model version"""
    is_active: bool = True
    traffic_percentage: int = Field(100, ge=0, le=100)


class ModelVersionResponse(BaseModel):
    """Model version response"""
    id: UUID
    version: str
    name: Optional[str]
    description: Optional[str]
    training_job_id: Optional[UUID]
    model_path: str
    model_type: str
    accuracy_metrics: Optional[Dict[str, Any]]
    is_active: bool
    deployed_at: Optional[datetime]
    deprecated_at: Optional[datetime]
    traffic_percentage: int
    created_by_id: UUID
    created_at: datetime

    class Config:
        from_attributes = True


# ===== Cost Estimation Schemas =====

class CostEstimateRequest(BaseModel):
    """Estimate labeling cost"""
    num_images: int = Field(..., ge=1)
    detail: str = Field("high", pattern="^(low|high)$")


class CostEstimateResponse(BaseModel):
    """Cost estimation response"""
    total_cost: float
    cost_per_image: float
    num_images: int
    detail: str
    estimated_time_minutes: int  # Rough estimate
