"""
ML Training Service

Business logic for training dataset management, auto-labeling, and model training.
"""

from typing import List, Dict, Any, Optional
from uuid import UUID, uuid4
from sqlalchemy.orm import Session
from datetime import datetime
import logging
import random

from .models import (
    TrainingDataset, TrainingImage, TrainingJob, TrainingDetectedMaterial,
    DatasetStatus, LabelingStatus, TrainingJobStatus
)
from .gpt4_labeler import GPT4VisionLabeler
from app.domains.file.models import File
from app.domains.analytics.models import ApiUsageLog

logger = logging.getLogger(__name__)


class TrainingService:
    """Training service for dataset management and model training"""

    def __init__(self, db: Session):
        self.db = db
        self.gpt4_labeler = None  # Lazy initialization

    # ===== Dataset Management =====

    def create_dataset(
        self,
        name: str,
        created_by_id: UUID,
        description: Optional[str] = None,
        train_split: int = 70,
        val_split: int = 20,
        test_split: int = 10,
        augmentation_config: Optional[Dict[str, Any]] = None
    ) -> TrainingDataset:
        """Create new training dataset"""
        dataset = TrainingDataset(
            id=uuid4(),
            name=name,
            description=description,
            status=DatasetStatus.DRAFT,
            train_split=train_split,
            val_split=val_split,
            test_split=test_split,
            augmentation_config=augmentation_config,
            created_by_id=created_by_id
        )

        self.db.add(dataset)
        self.db.commit()
        self.db.refresh(dataset)

        logger.info(f"Created training dataset: {dataset.id} ({name})")
        return dataset

    def get_dataset(self, dataset_id: UUID) -> Optional[TrainingDataset]:
        """Get dataset by ID"""
        return self.db.query(TrainingDataset).filter(
            TrainingDataset.id == dataset_id
        ).first()

    def list_datasets(
        self,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 20
    ) -> List[TrainingDataset]:
        """List training datasets"""
        query = self.db.query(TrainingDataset)

        if status:
            query = query.filter(TrainingDataset.status == status)

        return query.order_by(
            TrainingDataset.created_at.desc()
        ).offset(skip).limit(limit).all()

    def update_dataset(
        self,
        dataset_id: UUID,
        **kwargs
    ) -> Optional[TrainingDataset]:
        """Update dataset"""
        dataset = self.get_dataset(dataset_id)
        if not dataset:
            return None

        for key, value in kwargs.items():
            if hasattr(dataset, key) and value is not None:
                setattr(dataset, key, value)

        self.db.commit()
        self.db.refresh(dataset)

        logger.info(f"Updated dataset {dataset_id}")
        return dataset

    def delete_dataset(self, dataset_id: UUID) -> bool:
        """Delete dataset and all associated images"""
        dataset = self.get_dataset(dataset_id)
        if not dataset:
            return False

        self.db.delete(dataset)
        self.db.commit()

        logger.info(f"Deleted dataset {dataset_id}")
        return True

    # ===== Image Management =====

    def add_images_to_dataset(
        self,
        dataset_id: UUID,
        file_ids: List[UUID],
        created_by_id: UUID
    ) -> List[TrainingImage]:
        """Add multiple images to dataset"""
        dataset = self.get_dataset(dataset_id)
        if not dataset:
            raise ValueError(f"Dataset {dataset_id} not found")

        images = []
        for file_id in file_ids:
            # Get file info
            file = self.db.query(File).filter(File.id == str(file_id)).first()
            if not file:
                logger.warning(f"File {file_id} not found, skipping")
                continue

            # Create training image
            image = TrainingImage(
                id=uuid4(),
                dataset_id=dataset_id,
                file_id=file_id,
                image_url=file.url,
                labeling_status=LabelingStatus.PENDING,
                created_by_id=created_by_id
            )
            images.append(image)
            self.db.add(image)

        # Update dataset statistics
        dataset.total_images += len(images)

        self.db.commit()

        for image in images:
            self.db.refresh(image)

        logger.info(f"Added {len(images)} images to dataset {dataset_id}")
        return images

    def get_dataset_images(
        self,
        dataset_id: UUID,
        labeling_status: Optional[str] = None,
        split_type: Optional[str] = None
    ) -> List[TrainingImage]:
        """Get images from dataset"""
        query = self.db.query(TrainingImage).filter(
            TrainingImage.dataset_id == dataset_id
        )

        if labeling_status:
            query = query.filter(TrainingImage.labeling_status == labeling_status)

        if split_type:
            query = query.filter(TrainingImage.split_type == split_type)

        return query.all()

    def update_image_label(
        self,
        image_id: UUID,
        reviewed_by_id: UUID,
        **label_data
    ) -> Optional[TrainingImage]:
        """Update image label (manual review/correction)"""
        image = self.db.query(TrainingImage).filter(
            TrainingImage.id == image_id
        ).first()

        if not image:
            return None

        # Update label fields
        for key, value in label_data.items():
            if hasattr(image, key) and value is not None:
                setattr(image, key, value)

        # Update review status
        image.labeling_status = LabelingStatus.VERIFIED
        image.reviewed_by_id = reviewed_by_id
        image.reviewed_at = datetime.utcnow()

        self.db.commit()
        self.db.refresh(image)

        # Update dataset statistics
        self._update_dataset_statistics(image.dataset_id)

        logger.info(f"Updated label for image {image_id}")
        return image

    # ===== Auto-Labeling =====

    def auto_label_images(
        self,
        dataset_id: UUID,
        image_ids: List[UUID],
        temperature: float = 0.0,
        detail: str = "high",
        progress_callback: Optional[callable] = None
    ) -> Dict[str, Any]:
        """
        Auto-label images using GPT-4 Vision

        Args:
            dataset_id: Dataset ID
            image_ids: List of image IDs to label
            temperature: GPT-4 temperature (0 = deterministic)
            detail: Image resolution ('low', 'high')
            progress_callback: Callback(processed, total, result)

        Returns:
            {
                "total": int,
                "successful": int,
                "failed": int,
                "results": List[Dict]
            }
        """
        if not self.gpt4_labeler:
            self.gpt4_labeler = GPT4VisionLabeler()

        dataset = self.get_dataset(dataset_id)
        if not dataset:
            raise ValueError(f"Dataset {dataset_id} not found")

        # Get images
        images = self.db.query(TrainingImage).filter(
            TrainingImage.id.in_([str(id) for id in image_ids])
        ).all()

        if not images:
            raise ValueError("No images found")

        # Prepare image paths
        image_paths = [img.image_url for img in images if img.image_url]

        # Auto-label images
        results = self.gpt4_labeler.batch_label_images(
            image_paths=image_paths,
            batch_size=10,
            progress_callback=progress_callback
        )

        # Update database with labels
        successful = 0
        failed = 0

        for idx, result in enumerate(results):
            if result["status"] == "success" and not result["labels"].get("error"):
                image = images[idx]
                labels = result["labels"]

                # Update image status
                image.auto_labeled = True
                image.labeling_status = LabelingStatus.AUTO_LABELED
                image.gpt4_response = labels

                # Parse materials array (GPT-4 now returns array of materials)
                materials_array = labels if isinstance(labels, list) else [labels]

                # Create TrainingDetectedMaterial records for each material
                for material_idx, material_data in enumerate(materials_array, start=1):
                    # Extract specifications from nested structure if present
                    specs = material_data.get("specifications", {})
                    confidence = material_data.get("confidence", {})
                    detected_material = TrainingDetectedMaterial(
                        training_image_id=image.id,
                        material_order=material_idx,
                        coverage_percentage=material_data.get("coverage_percentage"),
                        location_in_image=material_data.get("location_in_image"),

                        # Classification
                        category=material_data.get("category"),
                        subcategory=material_data.get("subcategory") or material_data.get("type"),
                        material_type=material_data.get("material_type") or material_data.get("type"),
                        species=material_data.get("species") or specs.get("wood_species") or specs.get("carpet_fiber"),

                        # Specifications
                        grade=material_data.get("grade"),
                        width=material_data.get("width") or specs.get("width"),
                        thickness=material_data.get("thickness") or specs.get("thickness"),
                        finish=material_data.get("finish") or specs.get("finish"),
                        color=material_data.get("color") or specs.get("color"),

                        # Critical pricing factors
                        density=material_data.get("density") or specs.get("carpet_density"),
                        pattern=material_data.get("pattern") or specs.get("carpet_pattern"),
                        condition=material_data.get("condition"),
                        additional_specs=material_data.get("additional_specs") or str(specs) if specs else None,

                        # Confidence scores
                        category_confidence=confidence.get("category"),
                        subcategory_confidence=confidence.get("subcategory") or confidence.get("type"),
                        grade_confidence=confidence.get("grade"),
                        density_confidence=confidence.get("density"),
                        pattern_confidence=confidence.get("pattern"),

                        # Metadata
                        pricing_notes=material_data.get("pricing_notes") or material_data.get("description"),
                        gpt4_response=material_data
                    )

                    self.db.add(detected_material)

                    # Update legacy fields with primary material (first in array) for backward compatibility
                    if material_idx == 1:
                        image.material_category = material_data.get("category")
                        image.material_type = material_data.get("subcategory") or material_data.get("type")
                        image.material_species = material_data.get("species")
                        image.material_grade = material_data.get("grade")
                        image.material_width = material_data.get("width")
                        image.material_finish = material_data.get("finish")
                        image.material_color = material_data.get("color")
                        image.material_thickness = material_data.get("thickness")
                        image.material_density = material_data.get("density")
                        image.material_pattern = material_data.get("pattern")
                        image.material_condition = material_data.get("condition")

                        image.category_confidence = confidence.get("category")
                        image.type_confidence = confidence.get("subcategory") or confidence.get("type")
                        image.species_confidence = confidence.get("species")
                        image.grade_confidence = confidence.get("grade")
                        image.density_confidence = confidence.get("density")
                        image.pattern_confidence = confidence.get("pattern")

                successful += 1
            else:
                failed += 1

        self.db.commit()

        # Update dataset statistics
        self._update_dataset_statistics(dataset_id)

        logger.info(f"Auto-labeled {successful}/{len(images)} images in dataset {dataset_id}")

        # Log API usage (approximate cost based on estimate)
        try:
            estimate = self.gpt4_labeler.estimate_cost(num_images=len(image_paths), detail=detail)
            usage_log = ApiUsageLog(
                provider="openai",
                service_name="material_detection_auto_label",
                model="gpt-4o",
                usage_type="image",
                input_count=len(image_paths),
                cost_usd=estimate.get("total_cost"),
                meta={
                    "dataset_id": str(dataset_id),
                    "detail": detail,
                    "estimate": estimate,
                }
            )
            self.db.add(usage_log)
            self.db.commit()
        except Exception as e:
            logger.warning(f"Failed to log API usage: {e}")

        return {
            "total": len(images),
            "successful": successful,
            "failed": failed,
            "results": results
        }

    # ===== Dataset Split =====

    def assign_splits(self, dataset_id: UUID) -> Dict[str, int]:
        """
        Assign train/val/test splits to images

        Returns counts per split
        """
        dataset = self.get_dataset(dataset_id)
        if not dataset:
            raise ValueError(f"Dataset {dataset_id} not found")

        # Get all labeled images
        images = self.db.query(TrainingImage).filter(
            TrainingImage.dataset_id == dataset_id,
            TrainingImage.labeling_status.in_([
                LabelingStatus.AUTO_LABELED,
                LabelingStatus.MANUAL_REVIEW,
                LabelingStatus.VERIFIED
            ])
        ).all()

        if not images:
            raise ValueError("No labeled images found")

        # Shuffle images
        random.shuffle(images)

        # Calculate split sizes
        total = len(images)
        train_size = int(total * dataset.train_split / 100)
        val_size = int(total * dataset.val_split / 100)
        # test_size is the remainder

        # Assign splits
        for idx, image in enumerate(images):
            if idx < train_size:
                image.split_type = "train"
            elif idx < train_size + val_size:
                image.split_type = "val"
            else:
                image.split_type = "test"

        self.db.commit()

        counts = {
            "train": train_size,
            "val": val_size,
            "test": total - train_size - val_size
        }

        logger.info(f"Assigned splits to dataset {dataset_id}: {counts}")
        return counts

    # ===== Helper Methods =====

    def _update_dataset_statistics(self, dataset_id: UUID):
        """Update dataset image counts"""
        dataset = self.get_dataset(dataset_id)
        if not dataset:
            return

        # Count images by status
        labeled_count = self.db.query(TrainingImage).filter(
            TrainingImage.dataset_id == dataset_id,
            TrainingImage.labeling_status.in_([
                LabelingStatus.AUTO_LABELED,
                LabelingStatus.MANUAL_REVIEW,
                LabelingStatus.VERIFIED
            ])
        ).count()

        verified_count = self.db.query(TrainingImage).filter(
            TrainingImage.dataset_id == dataset_id,
            TrainingImage.labeling_status == LabelingStatus.VERIFIED
        ).count()

        dataset.labeled_images = labeled_count
        dataset.verified_images = verified_count

        self.db.commit()

    def estimate_labeling_cost(
        self,
        num_images: int,
        detail: str = "high"
    ) -> Dict[str, Any]:
        """Estimate GPT-4 Vision labeling cost"""
        if not self.gpt4_labeler:
            self.gpt4_labeler = GPT4VisionLabeler()

        cost_estimate = self.gpt4_labeler.estimate_cost(num_images, detail)

        # Add time estimate (rough: 2 seconds per image)
        cost_estimate["estimated_time_minutes"] = int((num_images * 2) / 60)

        return cost_estimate

    # ===== Model Training =====

    def start_training_job(
        self,
        dataset_id: UUID,
        created_by_id: UUID,
        job_name: Optional[str] = None,
        epochs: int = 10,
        batch_size: int = 16,
        learning_rate: float = 2e-5,
        model_name: str = "google/vit-base-patch16-224",
        background_tasks = None
    ) -> TrainingJob:
        """
        Start a model training job

        Args:
            dataset_id: Dataset to train on
            created_by_id: User ID
            job_name: Optional job name
            epochs: Number of training epochs
            batch_size: Batch size
            learning_rate: Learning rate
            model_name: Pre-trained model name
            background_tasks: FastAPI BackgroundTasks

        Returns:
            TrainingJob record
        """
        dataset = self.get_dataset(dataset_id)
        if not dataset:
            raise ValueError(f"Dataset {dataset_id} not found")

        # Check dataset has splits assigned
        train_images = self.get_dataset_images(dataset_id, split_type="train")
        val_images = self.get_dataset_images(dataset_id, split_type="val")

        if not train_images or not val_images:
            raise ValueError("Dataset must have train/val splits assigned")

        # Create training job
        job = TrainingJob(
            id=uuid4(),
            dataset_id=dataset_id,
            job_name=job_name or f"Training {dataset.name}",
            status=TrainingJobStatus.PENDING,
            model_architecture="ViT Multi-Attribute",
            base_model=model_name,
            hyperparameters={
                "epochs": epochs,
                "batch_size": batch_size,
                "learning_rate": learning_rate,
                "optimizer": "AdamW",
                "weight_decay": 0.01
            },
            total_epochs=epochs,
            created_by_id=created_by_id
        )

        self.db.add(job)
        self.db.commit()
        self.db.refresh(job)

        logger.info(f"Created training job {job.id} for dataset {dataset_id}")

        # Start training in background
        if background_tasks:
            background_tasks.add_task(self._run_training_job, job.id)
        else:
            # Synchronous training (for testing)
            self._run_training_job(job.id)

        return job

    def _run_training_job(self, job_id: UUID):
        """Run training job (background task)"""
        from .pytorch_trainer import MaterialTrainer

        job = self.db.query(TrainingJob).filter(TrainingJob.id == job_id).first()
        if not job:
            logger.error(f"Training job {job_id} not found")
            return

        try:
            # Update status
            job.status = TrainingJobStatus.TRAINING
            job.started_at = datetime.utcnow()
            self.db.commit()

            # Prepare datasets
            train_images = self.get_dataset_images(job.dataset_id, split_type="train")
            val_images = self.get_dataset_images(job.dataset_id, split_type="val")
            test_images = self.get_dataset_images(job.dataset_id, split_type="test")

            # Convert to dict format
            train_data = [self._image_to_dict(img) for img in train_images]
            val_data = [self._image_to_dict(img) for img in val_images]
            test_data = [self._image_to_dict(img) for img in test_images] if test_images else None

            # Initialize trainer
            trainer = MaterialTrainer(
                model_name=job.base_model
            )

            trainer.prepare_datasets(train_data, val_data, test_data)

            # Progress callback
            def progress_callback(epoch, metrics):
                job.current_epoch = epoch
                job.training_metrics = metrics
                self.db.commit()

            # Start training
            hyperparams = job.hyperparameters or {}
            results = trainer.train(
                job_id=job_id,
                epochs=hyperparams.get('epochs', 10),
                batch_size=hyperparams.get('batch_size', 16),
                learning_rate=hyperparams.get('learning_rate', 2e-5),
                progress_callback=progress_callback
            )

            # Update job with results
            job.status = TrainingJobStatus.COMPLETED
            job.completed_at = datetime.utcnow()
            job.training_metrics = results['final_metrics']
            job.validation_metrics = results['test_metrics']
            job.best_val_accuracy = results['final_metrics']['accuracy']['category']
            job.best_val_loss = results['best_val_loss']
            job.model_path = f"./models/training_jobs/{job_id}/best_model.pt"

            self.db.commit()

            logger.info(f"Training job {job_id} completed successfully")

        except Exception as e:
            logger.error(f"Training job {job_id} failed: {e}", exc_info=True)

            job.status = TrainingJobStatus.FAILED
            job.error_message = str(e)
            job.completed_at = datetime.utcnow()
            self.db.commit()

    def _image_to_dict(self, image: TrainingImage) -> Dict[str, Any]:
        """Convert TrainingImage model to dict"""
        return {
            'image_url': image.image_url,
            'material_category': image.material_category,
            'material_type': image.material_type,
            'material_grade': image.material_grade,
            'material_finish': image.material_finish,
        }

    def get_training_job(self, job_id: UUID) -> Optional[TrainingJob]:
        """Get training job by ID"""
        return self.db.query(TrainingJob).filter(
            TrainingJob.id == job_id
        ).first()

    def list_training_jobs(
        self,
        dataset_id: Optional[UUID] = None,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 20
    ) -> List[TrainingJob]:
        """List training jobs"""
        query = self.db.query(TrainingJob)

        if dataset_id:
            query = query.filter(TrainingJob.dataset_id == dataset_id)

        if status:
            query = query.filter(TrainingJob.status == status)

        return query.order_by(
            TrainingJob.created_at.desc()
        ).offset(skip).limit(limit).all()
