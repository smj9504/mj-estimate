"""
Material Detection API Endpoints

REST API for material detection operations.
"""
# Updated: Added background task processing

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status, Query
from typing import Optional, List
from uuid import UUID
from app.core.database_factory import get_db, DatabaseSession
from app.domains.auth.dependencies import get_current_user
from app.domains.staff.models import Staff
from .service import MaterialDetectionService
from .schemas import (
    MaterialDetectionJobCreate,
    MaterialDetectionJobResponse,
    MaterialDetectionJobSummary,
    MaterialDetectionJobList,
    MaterialDetectionHealthResponse,
    DetectedMaterialResponse,
    DetectedMaterialUpdate,
    MaterialDetectionStats,
    ProviderHealthStatus
)
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


def get_service(db: DatabaseSession = Depends(get_db)) -> MaterialDetectionService:
    """Dependency for material detection service."""
    return MaterialDetectionService(db)


# ===== Job Management Endpoints =====

@router.post("/jobs", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_detection_job(
    job_data: MaterialDetectionJobCreate,
    background_tasks: BackgroundTasks,
    service: MaterialDetectionService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    Create a new material detection job.

    The job will be processed asynchronously in the background.

    - **job_name**: Optional name for the job
    - **provider**: Detection provider to use (roboflow, google_vision, etc.)
    - **confidence_threshold**: Minimum confidence score (0.0-1.0)
    - **image_ids**: List of image IDs to process
    - **reconstruction_estimate_id**: Optional link to reconstruction estimate
    """
    try:
        result = await service.create_detection_job(job_data, current_user.id)

        # Get image paths from database
        from app.domains.file.models import File
        from sqlalchemy import select

        image_paths = []
        logger.info(f"Processing {len(job_data.image_ids)} image IDs for job {result['job_id']}")

        for image_id in job_data.image_ids:
            # Handle both UUID and temporary string IDs
            if isinstance(image_id, str) and image_id.startswith('temp_'):
                # Skip temporary IDs - they will be uploaded separately
                logger.warning(f"Skipping temporary image ID: {image_id}")
                continue

            try:
                # Query file from database using service's db session
                # File.id is String type, not UUID - query directly as string
                stmt = select(File).where(File.id == str(image_id))
                file_result = service.db.execute(stmt)
                file = file_result.scalar_one_or_none()

                if file and file.url:
                    # File model uses 'url' attribute, not 'file_path'
                    image_paths.append(file.url)
                    logger.info(f"Found file URL for {image_id}: {file.url}")
                else:
                    logger.warning(f"File not found or no URL for image_id: {image_id}")
            except Exception as e:
                logger.error(f"Error getting file URL for {image_id}: {e}", exc_info=True)

        # Start background processing if we have valid image paths
        if image_paths:
            background_tasks.add_task(
                service.process_detection_job,
                UUID(result["job_id"]),
                image_paths
            )
            logger.info(f"Started background processing for job {result['job_id']} with {len(image_paths)} images")
        else:
            logger.warning(f"No valid image paths found for job {result['job_id']}")

        return result

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to create detection job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to create detection job")


@router.get("/jobs/{job_id}", response_model=MaterialDetectionJobResponse)
async def get_detection_job(
    job_id: UUID,
    service: MaterialDetectionService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    Get material detection job details.

    Returns complete job information including all detected materials.
    """
    job = service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Check authorization (user can only view their own jobs)
    if job.created_by_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to view this job")

    return job


@router.get("/jobs", response_model=MaterialDetectionJobList)
async def list_detection_jobs(
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=100, description="Maximum number of records to return"),
    status: Optional[str] = Query(None, description="Filter by job status"),
    reconstruction_estimate_id: Optional[UUID] = Query(None, description="Filter by estimate ID"),
    service: MaterialDetectionService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    List material detection jobs with pagination.

    Returns a paginated list of jobs for the current user.
    """
    try:
        jobs, total = service.list_jobs(
            skip=skip,
            limit=limit,
            user_id=current_user.id,
            status=status,
            reconstruction_estimate_id=reconstruction_estimate_id
        )

        page = skip // limit + 1

        return {
            "jobs": jobs,
            "total": total,
            "page": page,
            "page_size": limit,
            "has_next": (skip + limit) < total,
            "has_prev": skip > 0
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to list jobs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to list jobs")


@router.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_detection_job(
    job_id: UUID,
    service: MaterialDetectionService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    Delete a material detection job.

    This will also delete all associated detected materials.
    """
    # Check job exists and authorization
    job = service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.created_by_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this job")

    # Delete job
    success = service.delete_job(job_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to delete job")


# ===== Statistics Endpoints =====

@router.get("/jobs/{job_id}/statistics", response_model=dict)
async def get_job_statistics(
    job_id: UUID,
    service: MaterialDetectionService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    Get detailed statistics for a detection job.

    Returns material breakdown by category, confidence scores, and processing metrics.
    """
    try:
        # Check authorization
        job = service.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        if job.created_by_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized")

        stats = service.get_job_statistics(job_id)
        return stats

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to get job statistics: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to get statistics")


@router.get("/statistics", response_model=dict)
async def get_overall_statistics(
    service: MaterialDetectionService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    Get overall material detection statistics for the current user.

    Returns aggregate statistics across all jobs.
    """
    try:
        stats = service.get_overall_statistics(user_id=current_user.id)
        return stats

    except Exception as e:
        logger.error(f"Failed to get overall statistics: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to get statistics")


# ===== Health Check Endpoint =====

@router.get("/health", response_model=MaterialDetectionHealthResponse)
async def health_check(
    service: MaterialDetectionService = Depends(get_service)
):
    """
    Check material detection service health.

    Returns status of all available providers and their capabilities.
    """
    try:
        health = await service.get_provider_health()

        providers = [
            ProviderHealthStatus(
                provider_name=name,
                available=info["available"],
                error=info.get("error")
            )
            for name, info in health["providers"].items()
        ]

        return MaterialDetectionHealthResponse(
            status=health["status"],
            providers=providers,
            timestamp=datetime.utcnow()
        )

    except Exception as e:
        logger.error(f"Health check failed: {e}", exc_info=True)
        return MaterialDetectionHealthResponse(
            status="error",
            providers=[],
            timestamp=datetime.utcnow()
        )


# ===== Detected Materials Endpoints =====

@router.get("/materials/{material_id}", response_model=DetectedMaterialResponse)
async def get_detected_material(
    material_id: UUID,
    service: MaterialDetectionService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    Get details of a specific detected material.

    Returns complete material information including job context.
    """
    try:
        material = service.get_detected_material(material_id)
        if not material:
            raise HTTPException(status_code=404, detail="Material not found")

        # Check authorization (user owns the parent job)
        job = service.get_job(material.job_id)
        if not job or job.created_by_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized to view this material")

        return material

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get material {material_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to get material")


@router.put("/materials/{material_id}", response_model=DetectedMaterialResponse)
async def update_detected_material(
    material_id: UUID,
    updates: DetectedMaterialUpdate,
    service: MaterialDetectionService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    Update a detected material (for manual review/correction).

    Allows users to correct or enhance material detection results.
    """
    try:
        # Check authorization first
        material = service.get_detected_material(material_id)
        if not material:
            raise HTTPException(status_code=404, detail="Material not found")

        job = service.get_job(material.job_id)
        if not job or job.created_by_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized to update this material")

        # Update material
        updated_material = service.update_detected_material(
            material_id,
            updates,
            current_user.id
        )

        if not updated_material:
            raise HTTPException(status_code=500, detail="Failed to update material")

        return updated_material

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update material {material_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to update material")


@router.delete("/materials/{material_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_detected_material(
    material_id: UUID,
    service: MaterialDetectionService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    Delete a detected material.

    Removes material from detection results (does not affect parent job).
    """
    try:
        # Check authorization
        material = service.get_detected_material(material_id)
        if not material:
            raise HTTPException(status_code=404, detail="Material not found")

        job = service.get_job(material.job_id)
        if not job or job.created_by_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized to delete this material")

        # Delete material
        success = service.delete_detected_material(material_id)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to delete material")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete material {material_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to delete material")


# ===== Bulk Operations =====

@router.post("/materials/bulk-update")
async def bulk_update_materials(
    material_ids: List[UUID],
    updates: DetectedMaterialUpdate,
    service: MaterialDetectionService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    Bulk update multiple detected materials.

    Useful for batch review and correction operations.
    """
    try:
        # Verify all materials belong to user
        unauthorized = []
        for material_id in material_ids:
            material = service.get_detected_material(material_id)
            if material:
                job = service.get_job(material.job_id)
                if not job or job.created_by_id != current_user.id:
                    unauthorized.append(str(material_id))

        if unauthorized:
            raise HTTPException(
                status_code=403,
                detail=f"Not authorized to update materials: {', '.join(unauthorized[:5])}"
            )

        # Bulk update
        count = service.bulk_update_materials(material_ids, updates, current_user.id)

        return {
            "updated_count": count,
            "message": f"Successfully updated {count} material(s)"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Bulk update failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Bulk update failed")


@router.post("/materials/bulk-delete")
async def bulk_delete_materials(
    material_ids: List[UUID],
    service: MaterialDetectionService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    Bulk delete multiple detected materials.

    Useful for cleaning up false positives in batch.
    """
    try:
        # Verify all materials belong to user
        unauthorized = []
        for material_id in material_ids:
            material = service.get_detected_material(material_id)
            if material:
                job = service.get_job(material.job_id)
                if not job or job.created_by_id != current_user.id:
                    unauthorized.append(str(material_id))

        if unauthorized:
            raise HTTPException(
                status_code=403,
                detail=f"Not authorized to delete materials: {', '.join(unauthorized[:5])}"
            )

        # Bulk delete
        count = service.bulk_delete_materials(material_ids)

        return {
            "deleted_count": count,
            "message": f"Successfully deleted {count} material(s)"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Bulk delete failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Bulk delete failed")



# ===== Export Endpoints =====

from fastapi.responses import StreamingResponse
from ._export import export_materials_to_csv, export_materials_to_excel
from datetime import datetime as dt


@router.get("/jobs/{job_id}/export/csv")
async def export_job_materials_csv(
    job_id: UUID,
    service: MaterialDetectionService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    Export detected materials to CSV format.

    Returns CSV file with all materials for the specified job.
    """
    try:
        # Check authorization
        job = service.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        if job.created_by_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized")

        # Get materials
        materials = job.detected_materials or []
        if not materials:
            raise HTTPException(status_code=404, detail="No materials found for this job")

        # Export to CSV
        csv_buffer = export_materials_to_csv(materials)

        # Generate filename
        timestamp = dt.now().strftime('%Y%m%d_%H%M%S')
        filename = f"materials_{job_id}_{timestamp}.csv"

        # Return as streaming response
        return StreamingResponse(
            iter([csv_buffer.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"CSV export failed for job {job_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Export failed")


@router.get("/jobs/{job_id}/export/excel")
async def export_job_materials_excel(
    job_id: UUID,
    service: MaterialDetectionService = Depends(get_service),
    current_user: Staff = Depends(get_current_user)
):
    """
    Export detected materials to Excel format.

    Returns Excel file with all materials for the specified job.
    """
    try:
        # Check authorization
        job = service.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        if job.created_by_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized")

        # Get materials
        materials = job.detected_materials or []
        if not materials:
            raise HTTPException(status_code=404, detail="No materials found for this job")

        # Export to Excel
        excel_buffer = export_materials_to_excel(materials)

        # Generate filename
        timestamp = dt.now().strftime('%Y%m%d_%H%M%S')
        filename = f"materials_{job_id}_{timestamp}.xlsx"

        # Return as streaming response
        return StreamingResponse(
            iter([excel_buffer.getvalue()]),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )

    except HTTPException:
        raise
    except ImportError as e:
        logger.error("openpyxl not installed")
        raise HTTPException(
            status_code=500,
            detail="Excel export not available. Install openpyxl package."
        )
    except Exception as e:
        logger.error(f"Excel export failed for job {job_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Export failed")
