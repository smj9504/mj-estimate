"""
Material Detection Service

Business logic for material detection operations.
"""

from typing import Dict, Any, List, Optional
from uuid import UUID
from .repository import MaterialDetectionRepository
from .providers import (
    RoboflowProvider,
    GoogleVisionProvider,
    CustomViTProvider,
    EnsembleProvider
)
from .providers.base import MaterialDetectionProvider
from .schemas import MaterialDetectionJobCreate, ProviderType, JobStatus
from .models import MaterialDetectionJob
from app.core.database_factory import DatabaseSession
from app.core.config import settings
from app.domains.file.models import File
import logging
import asyncio

logger = logging.getLogger(__name__)


class ProviderManager:
    """
    Singleton manager for material detection providers.

    Providers are initialized once on application startup and reused across requests.
    """
    _instance = None
    _providers: Dict[str, MaterialDetectionProvider] = {}
    _initialized = False

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def initialize_providers(self):
        """Initialize available material detection providers (once)."""
        if self._initialized:
            logger.debug("Providers already initialized, skipping")
            return

        logger.info("🚀 Initializing material detection providers...")

        # Google Vision provider (uses existing GCS credentials)
        try:
            self._providers[ProviderType.GOOGLE_VISION.value] = GoogleVisionProvider()
            logger.info("✓ Google Vision provider initialized")
        except Exception as e:
            logger.error(f"Failed to initialize Google Vision provider: {e}")

        # Custom ViT provider (local model, no API key needed)
        try:
            self._providers[ProviderType.CUSTOM_VIT.value] = CustomViTProvider()
            logger.info("✓ Custom ViT provider initialized")
        except Exception as e:
            logger.warning(f"Failed to initialize Custom ViT provider: {e}")
            logger.info("Install with: pip install transformers torch pillow")

        # Ensemble provider (combines all available models)
        try:
            # Only initialize if we have at least 2 providers
            if len(self._providers) >= 2:
                # Pass existing providers to avoid re-initialization
                self._providers[ProviderType.ENSEMBLE.value] = EnsembleProvider(
                    existing_providers=self._providers.copy()
                )
                logger.info("✓ Ensemble provider initialized (reusing existing providers)")
        except Exception as e:
            logger.warning(f"Failed to initialize Ensemble provider: {e}")

        # Roboflow provider (DISABLED - 405 errors)
        # if settings.ROBOFLOW_API_KEY:
        #     try:
        #         self._providers[ProviderType.ROBOFLOW.value] = RoboflowProvider()
        #         logger.info("✓ Roboflow provider initialized")
        #     except Exception as e:
        #         logger.error(f"Failed to initialize Roboflow provider: {e}")

        if not self._providers:
            logger.warning("⚠ No material detection providers available")
        else:
            logger.info(f"📊 Total providers initialized: {len(self._providers)}")

        self._initialized = True

    @property
    def providers(self) -> Dict[str, MaterialDetectionProvider]:
        """Get initialized providers."""
        if not self._initialized:
            self.initialize_providers()
        return self._providers


# Global singleton instance
_provider_manager = ProviderManager()


def initialize_material_detection():
    """
    Initialize material detection providers on application startup.

    This should be called once when the FastAPI application starts.
    """
    _provider_manager.initialize_providers()


class MaterialDetectionService:
    """
    Material detection orchestration service.

    Manages job creation, provider selection, and detection workflow.
    Uses singleton ProviderManager for optimal performance.
    """

    def __init__(self, db: DatabaseSession):
        self.db = db
        self.repository = MaterialDetectionRepository(db)
        # Use shared providers from singleton manager
        self.providers = _provider_manager.providers

    async def create_detection_job(
        self,
        job_data: MaterialDetectionJobCreate,
        user_id: UUID
    ) -> Dict[str, Any]:
        """
        Create a new material detection job.

        Args:
            job_data: Job creation data
            user_id: ID of user creating the job

        Returns:
            Job creation result with job_id and status
        """
        # Validate provider
        provider_name = job_data.provider.value
        if provider_name not in self.providers:
            available = list(self.providers.keys())
            raise ValueError(
                f"Provider '{provider_name}' not available. "
                f"Available providers: {available}"
            )

        # Validate images exist
        image_count = len(job_data.image_ids)
        # TODO: Validate image IDs exist in database
        # For now, just use the count

        # Create job record
        job = self.repository.create_job(
            job_name=job_data.job_name,
            provider=provider_name,
            confidence_threshold=float(job_data.confidence_threshold),
            total_images=image_count,
            created_by_id=user_id,
            reconstruction_estimate_id=job_data.reconstruction_estimate_id
        )

        logger.info(
            f"Created detection job {job.id} "
            f"(provider: {provider_name}, images: {image_count})"
        )

        return {
            "job_id": str(job.id),
            "status": "pending",
            "message": f"Job created successfully with {image_count} images"
        }

    async def process_detection_job(self, job_id: UUID, image_paths: List[str]):
        """
        Process a detection job (background task).

        Args:
            job_id: Job ID to process
            image_paths: List of image file paths to process
        """
        try:
            # Get job details
            job = self.repository.get_job(job_id, include_materials=False)
            if not job:
                raise ValueError(f"Job {job_id} not found")

            # Update status to processing
            self.repository.update_job_status(job_id, JobStatus.PROCESSING.value)

            # Get provider
            provider = self.providers.get(job.provider)
            if not provider:
                raise ValueError(f"Provider {job.provider} not available")

            # Process each image
            total_materials = 0
            total_confidence = 0.0
            total_processing_time = 0

            for idx, image_path in enumerate(image_paths):
                try:
                    # Detect materials in image
                    result = await provider.detect(
                        image_path,
                        float(job.confidence_threshold)
                    )

                    materials = result.get("materials", [])
                    processing_time = result.get("processing_time_ms", 0)

                    # Save detected materials
                    for material_data in materials:
                        # Get image_id from path (placeholder - needs proper mapping)
                        image_id = job.id  # TODO: Get actual image_id

                        self.repository.create_detected_material(
                            job_id=job_id,
                            image_id=image_id,
                            material_data=material_data,
                            provider_used=job.provider,
                            detection_time_ms=processing_time
                        )

                        total_materials += 1
                        total_confidence += float(material_data.get("confidence", 0.0))

                    total_processing_time += processing_time

                    # Update progress
                    self.repository.update_job_progress(job_id, idx + 1)

                    logger.info(
                        f"Processed image {idx + 1}/{len(image_paths)} "
                        f"for job {job_id}: {len(materials)} materials detected"
                    )

                except Exception as e:
                    logger.error(f"Failed to process image {image_path} for job {job_id}: {e}")
                    # Continue with next image

            # Calculate statistics
            avg_confidence = total_confidence / total_materials if total_materials > 0 else 0.0

            # Update job statistics
            self.repository.update_job_statistics(
                job_id=job_id,
                total_materials_detected=total_materials,
                avg_confidence=avg_confidence,
                processing_time_ms=total_processing_time
            )

            # Mark as completed
            self.repository.update_job_status(job_id, JobStatus.COMPLETED.value)

            logger.info(
                f"Job {job_id} completed successfully: "
                f"{total_materials} materials detected, "
                f"avg confidence: {avg_confidence:.2f}"
            )

        except Exception as e:
            logger.error(f"Job {job_id} failed: {e}", exc_info=True)
            self.repository.update_job_status(
                job_id,
                JobStatus.FAILED.value,
                error_message=str(e)
            )
            raise

    def get_job(self, job_id: UUID) -> Optional[MaterialDetectionJob]:
        """Get job by ID with detected materials."""
        return self.repository.get_job(job_id, include_materials=True)

    def list_jobs(
        self,
        skip: int = 0,
        limit: int = 20,
        user_id: Optional[UUID] = None,
        status: Optional[str] = None,
        reconstruction_estimate_id: Optional[UUID] = None
    ) -> tuple[List[MaterialDetectionJob], int]:
        """
        List jobs with pagination.

        Returns:
            Tuple of (jobs, total_count)
        """
        status_enum = JobStatus(status) if status else None

        jobs = self.repository.list_jobs(
            skip=skip,
            limit=limit,
            created_by_id=user_id,
            status=status_enum,
            reconstruction_estimate_id=reconstruction_estimate_id
        )

        total = self.repository.count_jobs(
            created_by_id=user_id,
            status=status_enum
        )

        return jobs, total

    def get_job_statistics(self, job_id: UUID) -> Dict[str, Any]:
        """Get detailed statistics for a job."""
        job = self.repository.get_job(job_id, include_materials=False)
        if not job:
            raise ValueError(f"Job {job_id} not found")

        # Get category breakdown
        category_stats = self.repository.get_job_statistics_by_category(job_id)

        return {
            "job_id": str(job_id),
            "status": job.status.value,
            "total_images": job.total_images,
            "processed_images": job.processed_images,
            "total_materials_detected": job.total_materials_detected,
            "avg_confidence": float(job.avg_confidence) if job.avg_confidence else 0.0,
            "processing_time_ms": job.processing_time_ms,
            "by_category": category_stats
        }

    def get_overall_statistics(self, user_id: Optional[UUID] = None) -> Dict[str, Any]:
        """Get overall statistics for all jobs."""
        return self.repository.get_overall_statistics(created_by_id=user_id)

    async def get_provider_health(self) -> Dict[str, Any]:
        """
        Check health of all providers.

        Returns:
            Health status for each provider
        """
        health_checks = {}

        for name, provider in self.providers.items():
            try:
                is_healthy = await provider.health_check()
                health_checks[name] = {
                    "available": is_healthy,
                    "capabilities": provider.get_capabilities()
                }
            except Exception as e:
                logger.error(f"Health check failed for {name}: {e}")
                health_checks[name] = {
                    "available": False,
                    "error": str(e)
                }

        overall_status = "healthy" if any(
            h["available"] for h in health_checks.values()
        ) else "unavailable"

        return {
            "status": overall_status,
            "providers": health_checks
        }

    def delete_job(self, job_id: UUID) -> bool:
        """
        Delete a detection job and all associated materials.

        Args:
            job_id: Job ID to delete

        Returns:
            True if deleted successfully
        """
        job = self.repository.get_job(job_id, include_materials=False)
        if not job:
            return False

        self.db.delete(job)
        self.db.commit()

        logger.info(f"Deleted detection job {job_id}")
        return True

    # ===== DetectedMaterial CRUD =====

    def get_detected_material(self, material_id: UUID):
        """Get a detected material by ID."""
        return self.repository.get_detected_material(material_id)

    def update_detected_material(
        self,
        material_id: UUID,
        updates,
        reviewed_by_id: UUID
    ):
        """
        Update a detected material (manual review).

        Args:
            material_id: Material ID
            updates: DetectedMaterialUpdate schema
            reviewed_by_id: ID of user performing review

        Returns:
            Updated material
        """
        update_data = updates.dict(exclude_unset=True)

        # Add review metadata if any field is updated
        if update_data:
            update_data['reviewed_by_id'] = reviewed_by_id

        return self.repository.update_detected_material(material_id, update_data)

    def delete_detected_material(self, material_id: UUID) -> bool:
        """Delete a detected material."""
        return self.repository.delete_detected_material(material_id)

    def bulk_update_materials(
        self,
        material_ids: List[UUID],
        updates,
        reviewed_by_id: UUID
    ) -> int:
        """
        Bulk update multiple materials.

        Args:
            material_ids: List of material IDs
            updates: DetectedMaterialUpdate schema
            reviewed_by_id: ID of user performing review

        Returns:
            Number of materials updated
        """
        update_data = updates.dict(exclude_unset=True)

        # Add review metadata
        if update_data:
            update_data['reviewed_by_id'] = reviewed_by_id

        return self.repository.bulk_update_materials(material_ids, update_data)

    def bulk_delete_materials(self, material_ids: List[UUID]) -> int:
        """
        Bulk delete multiple materials.

        Args:
            material_ids: List of material IDs

        Returns:
            Number of materials deleted
        """
        return self.repository.bulk_delete_materials(material_ids)
