"""
ML Training Domain Models

Database models for training datasets, labeling, and model training jobs.
"""

from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey, Index, Boolean, Enum as SQLEnum, JSON
from sqlalchemy.orm import relationship
from app.core.database_factory import Base
from app.core.base_models import BaseModel
from app.core.database_types import UUIDType
import enum


class DatasetStatus(enum.Enum):
    """Dataset status"""
    DRAFT = "draft"
    LABELING = "labeling"
    READY = "ready"
    ARCHIVED = "archived"


class LabelingStatus(enum.Enum):
    """Image labeling status"""
    PENDING = "pending"
    AUTO_LABELED = "auto_labeled"
    MANUAL_REVIEW = "manual_review"
    VERIFIED = "verified"
    REJECTED = "rejected"


class TrainingJobStatus(enum.Enum):
    """Training job status"""
    PENDING = "pending"
    PREPARING = "preparing"
    TRAINING = "training"
    EVALUATING = "evaluating"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TrainingDataset(Base, BaseModel):
    """
    Training Dataset

    Collection of labeled images for model training.
    """
    __tablename__ = "training_datasets"
    __table_args__ = (
        Index('ix_training_datasets_user', 'created_by_id'),
        Index('ix_training_datasets_status', 'status'),
        Index('ix_training_datasets_created', 'created_at'),
        {'extend_existing': True}
    )

    # Dataset metadata
    name = Column(String(255), nullable=False)
    description = Column(Text)
    status = Column(SQLEnum(DatasetStatus), nullable=False, default=DatasetStatus.DRAFT)

    # Dataset statistics
    total_images = Column(Integer, default=0, nullable=False)
    labeled_images = Column(Integer, default=0, nullable=False)
    verified_images = Column(Integer, default=0, nullable=False)

    # Split configuration (percentages)
    train_split = Column(Integer, default=70, nullable=False)  # 70%
    val_split = Column(Integer, default=20, nullable=False)    # 20%
    test_split = Column(Integer, default=10, nullable=False)   # 10%

    # Augmentation settings
    augmentation_config = Column(JSON)  # Albumentations config

    # Audit fields
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"), nullable=False)
    updated_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationships
    images = relationship(
        "TrainingImage",
        back_populates="dataset",
        cascade="all, delete-orphan",
        lazy="selectin"
    )
    training_jobs = relationship(
        "TrainingJob",
        back_populates="dataset",
        lazy="selectin"
    )
    created_by = relationship("Staff", foreign_keys=[created_by_id])
    updated_by = relationship("Staff", foreign_keys=[updated_by_id])


class TrainingImage(Base, BaseModel):
    """
    Training Image

    Individual image in a training dataset with labels.
    """
    __tablename__ = "training_images"
    __table_args__ = (
        Index('ix_training_images_dataset', 'dataset_id'),
        Index('ix_training_images_status', 'labeling_status'),
        Index('ix_training_images_split', 'split_type'),
        {'extend_existing': True}
    )

    # Dataset relationship
    dataset_id = Column(UUIDType(), ForeignKey("training_datasets.id"), nullable=False)

    # Image reference
    file_id = Column(String, ForeignKey("files.id"), nullable=False)  # files.id is VARCHAR
    image_url = Column(Text)  # GCS URL or local path

    # Labeling
    labeling_status = Column(SQLEnum(LabelingStatus), nullable=False, default=LabelingStatus.PENDING)
    auto_labeled = Column(Boolean, default=False)

    # Split assignment
    split_type = Column(String(20))  # 'train', 'val', 'test'

    # Multi-attribute labels
    material_category = Column(String(100))
    material_type = Column(String(100))
    material_species = Column(String(100))
    material_grade = Column(String(100))
    material_width = Column(String(50))
    material_finish = Column(String(100))
    material_color = Column(String(100))
    material_thickness = Column(String(50))

    # Additional material specs (for comprehensive material detection)
    material_density = Column(String(100))  # Critical for carpet pricing
    material_pattern = Column(String(100))  # Critical for carpet/tile pricing
    material_condition = Column(String(100))  # Damage assessment
    additional_specs = Column(Text)  # Other pricing factors (R-value, gauge, etc.)
    secondary_materials = Column(Text)  # Note other materials in image

    # Confidence scores (from auto-labeling)
    category_confidence = Column(Integer)  # 0-100
    type_confidence = Column(Integer)
    species_confidence = Column(Integer)
    grade_confidence = Column(Integer)
    density_confidence = Column(Integer)
    pattern_confidence = Column(Integer)

    # GPT-4 Vision response
    gpt4_response = Column(JSON)

    # Review notes
    review_notes = Column(Text)
    reviewed_by_id = Column(UUIDType(), ForeignKey("staff.id"))
    reviewed_at = Column(DateTime(timezone=True))

    # Audit fields
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"), nullable=False)

    # Relationships
    dataset = relationship("TrainingDataset", back_populates="images")
    file = relationship("File")
    reviewed_by = relationship("Staff", foreign_keys=[reviewed_by_id])
    created_by = relationship("Staff", foreign_keys=[created_by_id])
    detected_materials = relationship("TrainingDetectedMaterial", back_populates="training_image", cascade="all, delete-orphan")


class TrainingJob(Base, BaseModel):
    """
    Model Training Job

    Represents a model training run with hyperparameters and results.
    """
    __tablename__ = "training_jobs"
    __table_args__ = (
        Index('ix_training_jobs_dataset', 'dataset_id'),
        Index('ix_training_jobs_status', 'status'),
        Index('ix_training_jobs_created', 'created_at'),
        {'extend_existing': True}
    )

    # Job metadata
    job_name = Column(String(255), nullable=False)
    description = Column(Text)
    status = Column(SQLEnum(TrainingJobStatus), nullable=False, default=TrainingJobStatus.PENDING)

    # Dataset
    dataset_id = Column(UUIDType(), ForeignKey("training_datasets.id"), nullable=False)

    # Model configuration
    model_type = Column(String(50), nullable=False)  # 'multi_attribute_cnn', 'yolov8', etc.
    backbone = Column(String(50))  # 'resnet50', 'efficientnet_b0', etc.

    # Hyperparameters
    hyperparameters = Column(JSON)  # Learning rate, batch size, epochs, etc.

    # Training progress
    current_epoch = Column(Integer, default=0)
    total_epochs = Column(Integer, nullable=False)

    # Results
    training_metrics = Column(JSON)  # Loss, accuracy per epoch
    validation_metrics = Column(JSON)  # Validation accuracy per attribute
    test_metrics = Column(JSON)  # Final test set metrics

    # Model artifacts
    model_version = Column(String(50))
    model_path = Column(Text)  # Path to saved model (.pt, .h5, etc.)
    checkpoint_path = Column(Text)  # Path to checkpoints

    # Performance
    training_time_seconds = Column(Integer)
    gpu_used = Column(String(100))

    # Error handling
    error_message = Column(Text)
    error_traceback = Column(Text)

    # Deployment
    deployed = Column(Boolean, default=False)
    deployed_at = Column(DateTime(timezone=True))

    # Audit fields
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"), nullable=False)
    started_at = Column(DateTime(timezone=True))
    completed_at = Column(DateTime(timezone=True))

    # Relationships
    dataset = relationship("TrainingDataset", back_populates="training_jobs")
    created_by = relationship("Staff")


class ModelVersion(Base, BaseModel):
    """
    Model Version Registry

    Tracks deployed model versions for A/B testing and rollback.
    """
    __tablename__ = "model_versions"
    __table_args__ = (
        Index('ix_model_versions_active', 'is_active'),
        Index('ix_model_versions_deployed', 'deployed_at'),
        {'extend_existing': True}
    )

    # Version metadata
    version = Column(String(50), nullable=False, unique=True)  # e.g., 'v1.0.0'
    name = Column(String(255))
    description = Column(Text)

    # Training job reference
    training_job_id = Column(UUIDType(), ForeignKey("training_jobs.id"))

    # Model artifacts
    model_path = Column(Text, nullable=False)
    model_type = Column(String(50), nullable=False)

    # Performance metrics
    accuracy_metrics = Column(JSON)

    # Deployment
    is_active = Column(Boolean, default=False)
    deployed_at = Column(DateTime(timezone=True))
    deprecated_at = Column(DateTime(timezone=True))

    # Traffic allocation (for A/B testing)
    traffic_percentage = Column(Integer, default=0)  # 0-100

    # Audit fields
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"), nullable=False)

    # Relationships
    training_job = relationship("TrainingJob")
    created_by = relationship("Staff")


class TrainingDetectedMaterial(Base, BaseModel):
    """
    Training Detected Material

    Individual construction material detected in a training image.
    One image can have multiple detected materials (e.g., flooring + trim + wall).
    """
    __tablename__ = "training_detected_materials"
    __table_args__ = (
        Index('idx_training_detected_materials_image_id', 'training_image_id'),
        Index('idx_training_detected_materials_category', 'category'),
    )

    # Parent relationship
    training_image_id = Column(UUIDType(), ForeignKey("training_images.id"), nullable=False)

    # Material ordering and coverage
    material_order = Column(Integer, default=1)  # 1=primary, 2=secondary, etc.
    coverage_percentage = Column(Integer)  # 0-100: how much of image this material occupies
    location_in_image = Column(String(50))  # center, top, bottom, left, right, background

    # Material classification
    category = Column(String(100))  # Flooring, Carpet, Tile, Trim, Siding, Roofing, Insulation, Drywall, Paint
    subcategory = Column(String(100))  # Berber, Plush, Oak Hardwood, Vinyl Siding, etc.
    material_type = Column(String(100))

    # Material composition
    species = Column(String(100))  # Wood: Oak/Maple, Carpet: Nylon/Polyester/Wool

    # Quality and specifications
    grade = Column(String(100))  # Economy, Builder Grade, Standard, Premium, Luxury, Commercial
    width = Column(String(50))  # 2.25in, 3.25in, 5in, 12ft, 15ft, 12x12, 18x18
    thickness = Column(String(50))  # 3/4in, 1/2in, 12mm, Pile: Low/Medium/High
    finish = Column(String(100))  # Matte, Glossy, Satin, Smooth, Textured, Hand-scraped, Stain Resistant
    color = Column(String(100))  # Solid Beige, Multi-tone Gray, Dark Walnut, Natural Oak, Patterned

    # CRITICAL pricing factors
    density = Column(String(100))  # For carpet: Low (<2000), Medium (2000-3000), High (3000-4000), Premium (>4000)
    pattern = Column(String(100))  # For carpet/tile: Solid, Berber Loop, Geometric, Striped, Textured, Multi-level

    # Condition assessment
    condition = Column(String(100))  # New, Good, Fair, Worn, Damaged, Water Damaged, Mold, Stained

    # Additional specifications (JSON or text)
    additional_specs = Column(Text)  # R-value, Gauge, Profile style, Face weight oz/sqyd, Pile height, etc.

    # AI confidence scores (0-100)
    category_confidence = Column(Integer)
    subcategory_confidence = Column(Integer)
    grade_confidence = Column(Integer)
    density_confidence = Column(Integer)
    pattern_confidence = Column(Integer)

    # Pricing metadata
    pricing_notes = Column(Text)  # Key factors affecting cost

    # GPT-4 Vision response for this specific material
    gpt4_response = Column(JSON)

    # Relationships
    training_image = relationship("TrainingImage", back_populates="detected_materials")
