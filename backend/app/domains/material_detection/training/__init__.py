"""
ML Training Domain

Dataset management, auto-labeling, and model training for material detection.
"""

from .models import (
    TrainingDataset,
    TrainingImage,
    TrainingJob,
    ModelVersion,
    DatasetStatus,
    LabelingStatus,
    TrainingJobStatus
)
from .service import TrainingService
from .gpt4_labeler import GPT4VisionLabeler
from .api import router

__all__ = [
    "TrainingDataset",
    "TrainingImage",
    "TrainingJob",
    "ModelVersion",
    "DatasetStatus",
    "LabelingStatus",
    "TrainingJobStatus",
    "TrainingService",
    "GPT4VisionLabeler",
    "router"
]
