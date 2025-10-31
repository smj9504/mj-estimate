"""
ML Training API

REST API endpoints for training dataset management, auto-labeling, and model training.
"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
import logging

from app.core.database_factory import get_db
from app.domains.auth.dependencies import get_current_user
from app.domains.staff.models import Staff

from .service import TrainingService
from .schemas import (
    TrainingDatasetCreate,
    TrainingDatasetUpdate,
    TrainingDatasetResponse,
    TrainingImageCreate,
    TrainingImageLabel,
    TrainingImageResponse,
    AutoLabelRequest,
    AutoLabelResponse,
    CostEstimateRequest,
    CostEstimateResponse
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/training", tags=["ML Training"])


def get_service(db: Session = Depends(get_db)) -> TrainingService:
    """Get training service instance"""
    return TrainingService(db)


# ===== Dataset Endpoints =====

@router.post("/datasets", response_model=TrainingDatasetResponse, status_code=201)
async def create_dataset(
    dataset_data: TrainingDatasetCreate,
    service: TrainingService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    Create new training dataset

    Creates a new dataset for collecting and organizing training images.
    """
    try:
        dataset = service.create_dataset(
            name=dataset_data.name,
            description=dataset_data.description,
            train_split=dataset_data.train_split,
            val_split=dataset_data.val_split,
            test_split=dataset_data.test_split,
            augmentation_config=dataset_data.augmentation_config,
            created_by_id=current_user.id
        )
        return dataset

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to create dataset: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to create dataset")


@router.get("/datasets/{dataset_id}", response_model=TrainingDatasetResponse)
async def get_dataset(
    dataset_id: UUID,
    service: TrainingService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """Get dataset details"""
    dataset = service.get_dataset(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    return dataset


@router.get("/datasets", response_model=List[TrainingDatasetResponse])
async def list_datasets(
    status: Optional[str] = Query(None, description="Filter by status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    service: TrainingService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    List training datasets

    Returns paginated list of training datasets with optional status filter.
    """
    datasets = service.list_datasets(
        status=status,
        skip=skip,
        limit=limit
    )
    return datasets


@router.put("/datasets/{dataset_id}", response_model=TrainingDatasetResponse)
async def update_dataset(
    dataset_id: UUID,
    update_data: TrainingDatasetUpdate,
    service: TrainingService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """Update dataset"""
    dataset = service.update_dataset(
        dataset_id=dataset_id,
        **update_data.dict(exclude_unset=True)
    )

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    return dataset


@router.delete("/datasets/{dataset_id}", status_code=204)
async def delete_dataset(
    dataset_id: UUID,
    service: TrainingService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """Delete dataset and all associated images"""
    success = service.delete_dataset(dataset_id)
    if not success:
        raise HTTPException(status_code=404, detail="Dataset not found")


# ===== Image Management Endpoints =====

@router.post("/datasets/{dataset_id}/images", response_model=List[TrainingImageResponse], status_code=201)
async def add_images_to_dataset(
    dataset_id: UUID,
    file_ids: List[UUID],
    service: TrainingService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    Add images to dataset

    Upload and add multiple images to a training dataset.
    """
    try:
        images = service.add_images_to_dataset(
            dataset_id=dataset_id,
            file_ids=file_ids,
            created_by_id=current_user.id
        )
        return images

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to add images: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to add images")


@router.get("/datasets/{dataset_id}/images", response_model=List[TrainingImageResponse])
async def get_dataset_images(
    dataset_id: UUID,
    labeling_status: Optional[str] = Query(None, description="Filter by labeling status"),
    split_type: Optional[str] = Query(None, description="Filter by split type (train/val/test)"),
    service: TrainingService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    Get images from dataset

    Returns all images in a dataset with optional filters.
    """
    images = service.get_dataset_images(
        dataset_id=dataset_id,
        labeling_status=labeling_status,
        split_type=split_type
    )
    return images


@router.put("/images/{image_id}/label", response_model=TrainingImageResponse)
async def update_image_label(
    image_id: UUID,
    label_data: TrainingImageLabel,
    service: TrainingService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    Update image label (manual review/correction)

    Manually label or correct auto-labeled images.
    """
    image = service.update_image_label(
        image_id=image_id,
        reviewed_by_id=current_user.id,
        **label_data.dict(exclude_unset=True)
    )

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    return image


# ===== Auto-Labeling Endpoints =====

@router.post("/datasets/{dataset_id}/auto-label", response_model=dict)
async def auto_label_images(
    dataset_id: UUID,
    request: AutoLabelRequest,
    background_tasks: BackgroundTasks,
    service: TrainingService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    Auto-label images using GPT-4 Vision

    Automatically label construction materials in images using AI.

    **Cost**: ~$0.01 per image (high resolution)

    **Processing time**: ~2 seconds per image
    """
    try:
        # Validate dataset
        dataset = service.get_dataset(dataset_id)
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")

        # Estimate cost
        cost_estimate = service.estimate_labeling_cost(
            num_images=len(request.image_ids),
            detail=request.detail
        )

        # Start background labeling
        background_tasks.add_task(
            service.auto_label_images,
            dataset_id=dataset_id,
            image_ids=request.image_ids,
            temperature=request.temperature,
            detail=request.detail
        )

        return {
            "message": "Auto-labeling started",
            "dataset_id": str(dataset_id),
            "total_images": len(request.image_ids),
            "estimated_cost": cost_estimate["total_cost"],
            "estimated_time_minutes": cost_estimate["estimated_time_minutes"]
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to start auto-labeling: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to start auto-labeling")


@router.post("/cost-estimate", response_model=CostEstimateResponse)
async def estimate_labeling_cost(
    request: CostEstimateRequest,
    service: TrainingService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    Estimate auto-labeling cost

    Calculate estimated cost for labeling images with GPT-4 Vision.
    """
    cost_estimate = service.estimate_labeling_cost(
        num_images=request.num_images,
        detail=request.detail
    )
    return cost_estimate


# ===== Dataset Split Endpoint =====

@router.post("/datasets/{dataset_id}/assign-splits", response_model=dict)
async def assign_splits(
    dataset_id: UUID,
    service: TrainingService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    Assign train/val/test splits

    Randomly assign labeled images to train, validation, and test sets
    based on dataset split configuration.
    """
    try:
        counts = service.assign_splits(dataset_id)
        return {
            "dataset_id": str(dataset_id),
            "splits": counts,
            "message": "Splits assigned successfully"
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to assign splits: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to assign splits")


# ===== Training Job Endpoints =====

@router.post("/jobs", response_model=dict, status_code=201)
async def start_training(
    dataset_id: UUID = Query(..., description="Dataset ID to train on"),
    job_name: Optional[str] = Query(None, description="Optional job name"),
    epochs: int = Query(10, ge=1, le=100, description="Number of training epochs"),
    batch_size: int = Query(16, ge=1, le=64, description="Batch size"),
    learning_rate: float = Query(2e-5, gt=0, description="Learning rate"),
    model_name: str = Query("google/vit-base-patch16-224", description="Base model"),
    background_tasks: BackgroundTasks = None,
    service: TrainingService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    Start model training job

    Train a custom material detection model on a labeled dataset.

    **Requirements**:
    - Dataset must have train/val splits assigned
    - Images must be labeled (auto-labeled or manually verified)

    **Training Time**: 5-30 minutes depending on dataset size and epochs

    **Model**: Vision Transformer (ViT) with multi-attribute classification
    """
    try:
        job = service.start_training_job(
            dataset_id=dataset_id,
            created_by_id=current_user.id,
            job_name=job_name,
            epochs=epochs,
            batch_size=batch_size,
            learning_rate=learning_rate,
            model_name=model_name,
            background_tasks=background_tasks
        )

        return {
            "job_id": str(job.id),
            "dataset_id": str(dataset_id),
            "status": job.status,
            "message": "Training job started",
            "estimated_time_minutes": (epochs * 2),  # Rough estimate
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to start training: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to start training")


@router.get("/jobs/{job_id}", response_model=dict)
async def get_training_job(
    job_id: UUID,
    service: TrainingService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    Get training job status and metrics

    Returns current status, progress, and metrics for a training job.
    """
    job = service.get_training_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Training job not found")

    return {
        "job_id": str(job.id),
        "dataset_id": str(job.dataset_id),
        "job_name": job.job_name,
        "status": job.status,
        "current_epoch": job.current_epoch,
        "total_epochs": job.total_epochs,
        "model_architecture": job.model_architecture,
        "base_model": job.base_model,
        "hyperparameters": job.hyperparameters,
        "training_metrics": job.training_metrics,
        "validation_metrics": job.validation_metrics,
        "best_val_accuracy": job.best_val_accuracy,
        "best_val_loss": job.best_val_loss,
        "model_path": job.model_path,
        "error_message": job.error_message,
        "started_at": job.started_at,
        "completed_at": job.completed_at,
        "created_at": job.created_at
    }


@router.get("/jobs", response_model=List[dict])
async def list_training_jobs(
    dataset_id: Optional[UUID] = Query(None, description="Filter by dataset"),
    status: Optional[str] = Query(None, description="Filter by status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    service: TrainingService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    List training jobs

    Returns paginated list of training jobs with optional filters.
    """
    jobs = service.list_training_jobs(
        dataset_id=dataset_id,
        status=status,
        skip=skip,
        limit=limit
    )

    return [
        {
            "job_id": str(job.id),
            "dataset_id": str(job.dataset_id),
            "job_name": job.job_name,
            "status": job.status,
            "current_epoch": job.current_epoch,
            "total_epochs": job.total_epochs,
            "best_val_accuracy": job.best_val_accuracy,
            "started_at": job.started_at,
            "completed_at": job.completed_at,
            "created_at": job.created_at
        }
        for job in jobs
    ]
