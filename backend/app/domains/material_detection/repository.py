"""
Material Detection Repository

Data access layer for material detection jobs and detected materials.
"""

from typing import List, Optional, Dict, Any
from uuid import UUID
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload
from app.core.database_factory import DatabaseSession
from app.common.base_repository import BaseRepository
from .models import MaterialDetectionJob, DetectedMaterial, JobStatus
from app.domains.file.models import File
import logging

logger = logging.getLogger(__name__)


class MaterialDetectionRepository(BaseRepository[MaterialDetectionJob, UUID]):
    """Repository for material detection operations."""

    def __init__(self, db: DatabaseSession):
        super().__init__(db, MaterialDetectionJob, "material_detection_jobs")

    # Implement required BaseRepository abstract methods
    def create(self, entity_data: Dict[str, Any]) -> MaterialDetectionJob:
        """Create a new material detection job from entity data."""
        job = MaterialDetectionJob(**entity_data)
        self.session.add(job)
        self.session.commit()
        self.session.refresh(job)
        return job

    def get_by_id(self, entity_id: UUID) -> Optional[MaterialDetectionJob]:
        """Get job by ID - delegates to get_job method."""
        return self.get_job(entity_id, include_materials=True)

    def update(self, entity_id: UUID, update_data: Dict[str, Any]) -> Optional[MaterialDetectionJob]:
        """Update a material detection job."""
        job = self.get_job(entity_id, include_materials=False)
        if not job:
            return None

        for key, value in update_data.items():
            if hasattr(job, key):
                setattr(job, key, value)

        self.session.commit()
        self.session.refresh(job)
        return job

    def delete(self, entity_id: UUID) -> bool:
        """Delete a material detection job."""
        job = self.get_job(entity_id, include_materials=False)
        if not job:
            return False

        self.session.delete(job)
        self.session.commit()
        return True

    def exists(self, entity_id: UUID) -> bool:
        """Check if job exists."""
        return self.get_job(entity_id, include_materials=False) is not None

    def get_all(self, skip: int = 0, limit: int = 100, filters: Optional[Dict[str, Any]] = None) -> List[MaterialDetectionJob]:
        """Get all jobs with optional filtering - delegates to list_jobs method."""
        created_by_id = filters.get("created_by_id") if filters else None
        status = filters.get("status") if filters else None
        return self.list_jobs(skip=skip, limit=limit, created_by_id=created_by_id, status=status)

    def count(self, filters: Optional[Dict[str, Any]] = None) -> int:
        """Count jobs with optional filtering - delegates to count_jobs method."""
        created_by_id = filters.get("created_by_id") if filters else None
        status = filters.get("status") if filters else None
        return self.count_jobs(created_by_id=created_by_id, status=status)

    # ===== Job Operations =====

    def create_job(
        self,
        job_name: Optional[str],
        provider: str,
        confidence_threshold: float,
        total_images: int,
        created_by_id: UUID,
        reconstruction_estimate_id: Optional[UUID] = None
    ) -> MaterialDetectionJob:
        """Create a new material detection job."""
        job = MaterialDetectionJob(
            job_name=job_name,
            status=JobStatus.PENDING,
            provider=provider,
            confidence_threshold=confidence_threshold,
            total_images=total_images,
            processed_images=0,
            total_materials_detected=0,
            created_by_id=created_by_id,
            reconstruction_estimate_id=reconstruction_estimate_id
        )

        self.session.add(job)
        self.session.commit()
        self.session.refresh(job)

        logger.info(f"Created material detection job {job.id} with {total_images} images")
        return job

    def get_job(self, job_id: UUID, include_materials: bool = True) -> Optional[MaterialDetectionJob]:
        """Get job by ID."""
        query = select(MaterialDetectionJob).where(MaterialDetectionJob.id == job_id)

        if include_materials:
            query = query.options(selectinload(MaterialDetectionJob.detected_materials))

        result = self.session.execute(query)
        return result.scalar_one_or_none()

    def list_jobs(
        self,
        skip: int = 0,
        limit: int = 20,
        created_by_id: Optional[UUID] = None,
        status: Optional[JobStatus] = None,
        reconstruction_estimate_id: Optional[UUID] = None
    ) -> List[MaterialDetectionJob]:
        """List jobs with optional filtering."""
        query = select(MaterialDetectionJob).options(
            selectinload(MaterialDetectionJob.detected_materials)
        )

        # Apply filters
        filters = []
        if created_by_id:
            filters.append(MaterialDetectionJob.created_by_id == created_by_id)
        if status:
            filters.append(MaterialDetectionJob.status == status)
        if reconstruction_estimate_id:
            filters.append(MaterialDetectionJob.reconstruction_estimate_id == reconstruction_estimate_id)

        if filters:
            query = query.where(and_(*filters))

        # Order by creation date (newest first)
        query = query.order_by(MaterialDetectionJob.created_at.desc())

        # Pagination
        query = query.offset(skip).limit(limit)

        result = self.session.execute(query)
        return list(result.scalars().all())

    def count_jobs(
        self,
        created_by_id: Optional[UUID] = None,
        status: Optional[JobStatus] = None
    ) -> int:
        """Count jobs with optional filtering."""
        query = select(func.count(MaterialDetectionJob.id))

        filters = []
        if created_by_id:
            filters.append(MaterialDetectionJob.created_by_id == created_by_id)
        if status:
            filters.append(MaterialDetectionJob.status == status)

        if filters:
            query = query.where(and_(*filters))

        result = self.session.execute(query)
        return result.scalar_one()

    def update_job_status(
        self,
        job_id: UUID,
        status: str,
        error_message: Optional[str] = None
    ) -> None:
        """Update job status - optimized without SELECT."""
        from sqlalchemy import update
        from datetime import datetime, timezone

        # Convert string to JobStatus enum for proper DB compatibility
        status_enum = JobStatus(status) if isinstance(status, str) else status

        values = {
            'status': status_enum,
            'updated_at': func.now()
        }

        if error_message:
            values['error_message'] = error_message

        if status_enum == JobStatus.COMPLETED:
            values['completed_at'] = datetime.now(timezone.utc)

        stmt = update(MaterialDetectionJob).where(
            MaterialDetectionJob.id == job_id
        ).values(**values)

        self.session.execute(stmt)
        self.session.commit()

    def update_job_progress(
        self,
        job_id: UUID,
        processed_images: int
    ) -> None:
        """Update job progress - optimized without SELECT."""
        from sqlalchemy import update

        stmt = update(MaterialDetectionJob).where(
            MaterialDetectionJob.id == job_id
        ).values(
            processed_images=processed_images,
            updated_at=func.now()
        )

        self.session.execute(stmt)
        self.session.commit()

    def update_job_statistics(
        self,
        job_id: UUID,
        total_materials_detected: int,
        avg_confidence: float,
        processing_time_ms: int
    ) -> None:
        """Update job statistics after completion - optimized without SELECT."""
        from sqlalchemy import update

        stmt = update(MaterialDetectionJob).where(
            MaterialDetectionJob.id == job_id
        ).values(
            total_materials_detected=total_materials_detected,
            avg_confidence=avg_confidence,
            processing_time_ms=processing_time_ms,
            updated_at=func.now()
        )

        self.session.execute(stmt)
        self.session.commit()

    # ===== Detected Material Operations =====

    def create_detected_material(
        self,
        job_id: UUID,
        image_id: UUID,
        material_data: Dict[str, Any],
        provider_used: str,
        detection_time_ms: int
    ) -> DetectedMaterial:
        """Create a detected material record."""
        material = DetectedMaterial(
            job_id=job_id,
            image_id=image_id,
            material_category=material_data.get("category", "Unknown"),
            material_type=material_data.get("type"),
            material_grade=material_data.get("grade"),
            material_finish=material_data.get("finish"),
            confidence_score=material_data.get("confidence", 0.0),
            provider_used=provider_used,
            bounding_box=material_data.get("bounding_box"),
            detection_time_ms=detection_time_ms,
            raw_response=material_data
        )

        self.session.add(material)
        self.session.commit()
        self.session.refresh(material)

        return material

    def get_detected_materials(
        self,
        job_id: UUID,
        min_confidence: Optional[float] = None
    ) -> List[DetectedMaterial]:
        """Get detected materials for a job."""
        query = select(DetectedMaterial).where(DetectedMaterial.job_id == job_id)

        if min_confidence is not None:
            query = query.where(DetectedMaterial.confidence_score >= min_confidence)

        query = query.order_by(DetectedMaterial.confidence_score.desc())

        result = self.session.execute(query)
        return list(result.scalars().all())

    def update_detected_material(
        self,
        material_id: UUID,
        updates: Dict[str, Any]
    ) -> DetectedMaterial:
        """Update detected material (for manual review)."""
        query = select(DetectedMaterial).where(DetectedMaterial.id == material_id)
        result = self.session.execute(query)
        material = result.scalar_one_or_none()

        if not material:
            raise ValueError(f"Detected material {material_id} not found")

        # Apply updates
        for key, value in updates.items():
            if hasattr(material, key):
                setattr(material, key, value)

        self.session.commit()
        self.session.refresh(material)

        return material

    # ===== Statistics =====

    def get_job_statistics_by_category(
        self,
        job_id: UUID
    ) -> List[Dict[str, Any]]:
        """Get material statistics by category for a job."""
        query = select(
            DetectedMaterial.material_category,
            func.count(DetectedMaterial.id).label('count'),
            func.avg(DetectedMaterial.confidence_score).label('avg_confidence')
        ).where(
            DetectedMaterial.job_id == job_id
        ).group_by(
            DetectedMaterial.material_category
        ).order_by(
            func.count(DetectedMaterial.id).desc()
        )

        result = self.session.execute(query)
        rows = result.all()

        return [
            {
                "category": row.material_category,
                "count": row.count,
                "avg_confidence": float(row.avg_confidence) if row.avg_confidence else 0.0
            }
            for row in rows
        ]

    def get_overall_statistics(self, created_by_id: Optional[UUID] = None) -> Dict[str, Any]:
        """Get overall material detection statistics."""
        # Base query for jobs
        jobs_query = select(func.count(MaterialDetectionJob.id))
        if created_by_id:
            jobs_query = jobs_query.where(MaterialDetectionJob.created_by_id == created_by_id)

        total_jobs = self.session.execute(jobs_query).scalar_one()

        # Statistics for materials
        materials_query = select(
            func.count(DetectedMaterial.id).label('total_materials'),
            func.avg(DetectedMaterial.confidence_score).label('avg_confidence')
        )

        if created_by_id:
            materials_query = materials_query.join(MaterialDetectionJob).where(
                MaterialDetectionJob.created_by_id == created_by_id
            )

        result = self.session.execute(materials_query)
        row = result.one()

        return {
            "total_jobs": total_jobs,
            "total_materials_detected": row.total_materials or 0,
            "avg_confidence": float(row.avg_confidence) if row.avg_confidence else 0.0
        }

    # ===== DetectedMaterial CRUD Operations =====

    def get_detected_material(
        self,
        material_id: UUID,
        include_job: bool = False
    ) -> Optional[DetectedMaterial]:
        """
        Get a detected material by ID.

        Args:
            material_id: Material ID
            include_job: Whether to eagerly load the parent job

        Returns:
            DetectedMaterial or None
        """
        query = select(DetectedMaterial).where(DetectedMaterial.id == material_id)

        if include_job:
            query = query.options(selectinload(DetectedMaterial.job))

        result = self.session.execute(query)
        return result.scalar_one_or_none()

    def update_detected_material(
        self,
        material_id: UUID,
        update_data: Dict[str, Any]
    ) -> Optional[DetectedMaterial]:
        """
        Update a detected material (for manual review/correction).

        Args:
            material_id: Material ID
            update_data: Fields to update

        Returns:
            Updated DetectedMaterial or None
        """
        material = self.get_detected_material(material_id)
        if not material:
            return None

        # Update fields
        for key, value in update_data.items():
            if hasattr(material, key) and value is not None:
                setattr(material, key, value)

        self.session.commit()
        self.session.refresh(material)

        logger.info(f"Updated detected material {material_id}")
        return material

    def delete_detected_material(self, material_id: UUID) -> bool:
        """
        Delete a detected material.

        Args:
            material_id: Material ID

        Returns:
            True if deleted, False if not found
        """
        material = self.get_detected_material(material_id)
        if not material:
            return False

        self.session.delete(material)
        self.session.commit()

        logger.info(f"Deleted detected material {material_id}")
        return True

    def get_materials_by_job(
        self,
        job_id: UUID,
        skip: int = 0,
        limit: int = 100,
        category_filter: Optional[str] = None,
        min_confidence: Optional[float] = None
    ) -> List[DetectedMaterial]:
        """
        Get detected materials for a specific job with filtering.

        Args:
            job_id: Job ID
            skip: Number of records to skip
            limit: Maximum number of records
            category_filter: Filter by material category
            min_confidence: Minimum confidence score

        Returns:
            List of DetectedMaterial
        """
        query = select(DetectedMaterial).where(DetectedMaterial.job_id == job_id)

        if category_filter:
            query = query.where(DetectedMaterial.material_category.ilike(f"%{category_filter}%"))

        if min_confidence is not None:
            query = query.where(DetectedMaterial.confidence_score >= min_confidence)

        query = query.order_by(DetectedMaterial.confidence_score.desc())
        query = query.offset(skip).limit(limit)

        result = self.session.execute(query)
        return list(result.scalars().all())

    def bulk_update_materials(
        self,
        material_ids: List[UUID],
        update_data: Dict[str, Any]
    ) -> int:
        """
        Bulk update multiple detected materials.

        Args:
            material_ids: List of material IDs
            update_data: Fields to update

        Returns:
            Number of materials updated
        """
        if not material_ids:
            return 0

        materials = self.session.execute(
            select(DetectedMaterial).where(DetectedMaterial.id.in_(material_ids))
        ).scalars().all()

        count = 0
        for material in materials:
            for key, value in update_data.items():
                if hasattr(material, key) and value is not None:
                    setattr(material, key, value)
            count += 1

        self.session.commit()

        logger.info(f"Bulk updated {count} materials")
        return count

    def bulk_delete_materials(self, material_ids: List[UUID]) -> int:
        """
        Bulk delete multiple detected materials.

        Args:
            material_ids: List of material IDs

        Returns:
            Number of materials deleted
        """
        if not material_ids:
            return 0

        materials = self.session.execute(
            select(DetectedMaterial).where(DetectedMaterial.id.in_(material_ids))
        ).scalars().all()

        count = len(materials)
        for material in materials:
            self.session.delete(material)

        self.session.commit()

        logger.info(f"Bulk deleted {count} materials")
        return count

    # ===== Helper Methods =====

    def get_job_images(self, job_id: UUID) -> List[File]:
        """Get image files associated with a job (placeholder - needs linking logic)."""
        # TODO: Implement proper image-job association
        # For now, return empty list - will be implemented with image upload logic
        return []
