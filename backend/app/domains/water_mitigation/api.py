"""
Water Mitigation API endpoints
"""

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from fastapi.responses import FileResponse
from typing import List, Optional
from uuid import UUID
from pathlib import Path
from datetime import datetime, date, time
import logging
import math
from pydantic import BaseModel

from app.core.database_factory import get_db_session
from app.core.interfaces import DatabaseSession
from .schemas import (
    JobCreate,
    JobUpdate,
    JobStatusUpdate,
    JobResponse,
    JobListResponse,
    CategoryCreate,
    CategoryResponse,
    JobFilters,
    StatusHistoryResponse,
    BulkUpdateDateRequest,
    PhotoListResponse,
    ReportConfigCreate,
    ReportConfigUpdate,
    ReportConfigResponse,
    GenerateReportRequest,
    GenerateReportResponse,
    WMDocumentResponse,
    GenerateDocumentRequest
)
from .service import WaterMitigationService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/water-mitigation", tags=["Water Mitigation"])


def get_wm_service(db: DatabaseSession = Depends(get_db_session)) -> WaterMitigationService:
    """Get water mitigation service instance"""
    return WaterMitigationService(db)


# Job endpoints
@router.post("/jobs", response_model=JobResponse)
def create_job(
    job: JobCreate,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Create new water mitigation job"""
    try:
        created_job = service.create_job(job)

        # Commit the transaction
        db.commit()

        # Already a dict from service
        created_job['photo_count'] = 0

        return created_job
    except Exception as e:
        logger.error(f"Failed to create job: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs", response_model=JobListResponse)
def list_jobs(
    search: Optional[str] = None,
    status: Optional[str] = None,
    active: Optional[bool] = None,
    page: int = 1,
    page_size: int = 50,
    service: WaterMitigationService = Depends(get_wm_service)
):
    """List water mitigation jobs with filters"""
    try:
        # Parse status filter (comma-separated)
        status_list = status.split(',') if status else None

        jobs, total = service.list_jobs(
            search=search,
            status=status_list,
            active=active,
            page=page,
            page_size=page_size
        )

        # Convert to response
        job_dicts = []
        for job in jobs:
            job_dict = service.job_repo._convert_to_dict(job)
            job_dict['photo_count'] = getattr(job, 'photo_count', 0)
            job_dicts.append(job_dict)

        total_pages = math.ceil(total / page_size) if total > 0 else 0

        return {
            'items': job_dicts,
            'total': total,
            'page': page,
            'page_size': page_size,
            'total_pages': total_pages
        }
    except Exception as e:
        logger.error(f"Failed to list jobs: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs/{job_id}", response_model=JobResponse)
def get_job(
    job_id: UUID,
    service: WaterMitigationService = Depends(get_wm_service)
):
    """Get job by ID"""
    job = service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    job_dict = service.job_repo._convert_to_dict(job)
    photo_count = service.photo_repo.count_by_job(job_id)
    job_dict['photo_count'] = photo_count

    return job_dict


@router.put("/jobs/{job_id}", response_model=JobResponse)
def update_job(
    job_id: UUID,
    job_update: JobUpdate,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Update job"""
    updated_job = service.update_job(job_id, job_update)
    if not updated_job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Commit the transaction
    db.commit()

    job_dict = service.job_repo._convert_to_dict(updated_job)
    photo_count = service.photo_repo.count_by_job(job_id)
    job_dict['photo_count'] = photo_count

    return job_dict


@router.patch("/jobs/{job_id}/status", response_model=JobResponse)
def update_job_status(
    job_id: UUID,
    status_update: JobStatusUpdate,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Update job status"""
    updated_job = service.update_job_status(job_id, status_update)
    if not updated_job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Commit the transaction
    db.commit()

    job_dict = service.job_repo._convert_to_dict(updated_job)
    photo_count = service.photo_repo.count_by_job(job_id)
    job_dict['photo_count'] = photo_count

    return job_dict


@router.patch("/jobs/{job_id}/active")
def toggle_job_active(
    job_id: UUID,
    active: bool,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Toggle job active status"""
    updated_job = service.toggle_job_active(job_id, active)
    if not updated_job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Commit the transaction
    db.commit()

    return {"id": str(job_id), "active": active}


@router.delete("/jobs/{job_id}")
def delete_job(
    job_id: UUID,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Delete job"""
    success = service.delete_job(job_id)
    if not success:
        raise HTTPException(status_code=404, detail="Job not found")

    # Commit the transaction
    db.commit()

    return {"message": "Job deleted successfully"}


# Category endpoints
@router.post("/categories", response_model=CategoryResponse)
def create_category(
    category: CategoryCreate,
    client_id: UUID,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Create new category"""
    try:
        created_category = service.create_category(category, client_id)

        # Commit the transaction
        db.commit()

        return service.category_repo._convert_to_dict(created_category)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to create category: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/categories", response_model=List[CategoryResponse])
def list_categories(
    client_id: UUID,
    service: WaterMitigationService = Depends(get_wm_service)
):
    """List categories for client"""
    categories = service.get_categories(client_id)
    return [service.category_repo._convert_to_dict(category) for category in categories]


@router.delete("/categories/{category_id}")
def delete_category(
    category_id: UUID,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Delete category"""
    success = service.delete_category(category_id)
    if not success:
        raise HTTPException(status_code=404, detail="Category not found")

    # Commit the transaction
    db.commit()

    return {"message": "Category deleted successfully"}


# Status history endpoint
@router.get("/jobs/{job_id}/status-history", response_model=List[StatusHistoryResponse])
def get_status_history(
    job_id: UUID,
    service: WaterMitigationService = Depends(get_wm_service)
):
    """Get job status history"""
    history = service.get_status_history(job_id)
    return [service.status_history_repo._convert_to_dict(h) for h in history]


# Photo endpoints
@router.post("/jobs/{job_id}/photos")
async def upload_photo(
    job_id: UUID,
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Upload photo to job"""
    try:
        photo = await service.upload_photo(job_id, file, title, description)

        # Commit the transaction
        db.commit()

        return service.photo_repo._convert_to_dict(photo)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to upload photo: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs/{job_id}/photos", response_model=PhotoListResponse)
def list_photos(
    job_id: UUID,
    category_filter: Optional[str] = None,
    uncategorized_only: bool = False,
    page: int = 1,
    page_size: int = 50,
    sort_by: str = 'captured_date',
    sort_order: str = 'desc',
    service: WaterMitigationService = Depends(get_wm_service)
):
    """List photos for job with pagination and optional category filtering

    Args:
        job_id: Job UUID
        category_filter: Comma-separated list of categories to filter by (OR logic)
        uncategorized_only: If True, only return photos without category
        page: Page number (1-indexed)
        page_size: Number of items per page (default: 50, max: 200)
        sort_by: Field to sort by (default: captured_date)
        sort_order: Sort order 'asc' or 'desc' (default: desc)
    """
    # Limit page_size to prevent excessive queries
    page_size = min(page_size, 200)
    page = max(page, 1)

    # Get paginated photos
    photos, total = service.photo_repo.find_by_job_paginated(
        job_id=job_id,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        sort_order=sort_order
    )

    # Apply filters (note: filtering after pagination may reduce actual items returned)
    if uncategorized_only:
        # Filter photos that have no category or empty category
        photos = [p for p in photos if not getattr(p, 'category', None) or getattr(p, 'category', '') == '']
    elif category_filter:
        # Parse comma-separated categories
        categories = [c.strip() for c in category_filter.split(',') if c.strip()]
        if categories:
            # Filter by multiple categories (OR logic)
            photos = [p for p in photos if getattr(p, 'category', None) in categories]

    # Calculate total pages
    total_pages = math.ceil(total / page_size) if total > 0 else 1

    return {
        "items": [service.photo_repo._convert_to_dict(photo) for photo in photos],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages
    }


@router.get("/photos/{photo_id}/preview")
def preview_photo(
    photo_id: UUID,
    service: WaterMitigationService = Depends(get_wm_service)
):
    """Get photo preview"""
    photo = service.photo_repo.get_by_id(str(photo_id))
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    # Get file path
    file_path = Path(photo.get('file_path') if isinstance(photo, dict) else photo.file_path)

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Photo file not found on disk")

    mime_type = photo.get('mime_type') if isinstance(photo, dict) else photo.mime_type
    media_type = mime_type or 'image/jpeg'

    return FileResponse(
        path=str(file_path),
        media_type=media_type,
        headers={"Content-Disposition": "inline"}
    )


@router.patch("/photos/{photo_id}/category")
def update_photo_category(
    photo_id: UUID,
    category: str = Form(...),
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Update photo category"""
    try:
        photo = service.photo_repo.get_by_id(str(photo_id))
        if not photo:
            raise HTTPException(status_code=404, detail="Photo not found")

        # Update category
        updated = service.photo_repo.update(
            str(photo_id),
            {"category": category}
        )

        db.commit()

        return service.photo_repo._convert_to_dict(updated)
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to update photo category: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class BulkUpdateCategoryRequest(BaseModel):
    """Bulk update category request schema"""
    photo_ids: List[str]
    category: Optional[str] = None


@router.post("/photos/bulk-update-category")
def bulk_update_category(
    request: BulkUpdateCategoryRequest,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Bulk update photo categories

    Args:
        request.photo_ids: List of photo IDs to update
        request.category: Category to set (None or empty string to clear category)
    """
    photo_ids = request.photo_ids
    category = request.category
    try:
        updated_photos = []
        # If category is None or empty, set to empty string to clear category
        category_value = category if category else ''

        for photo_id in photo_ids:
            photo = service.photo_repo.get_by_id(photo_id)
            if photo:
                updated = service.photo_repo.update(
                    photo_id,
                    {"category": category_value}
                )
                updated_photos.append(service.photo_repo._convert_to_dict(updated))

        db.commit()

        return {
            "updated_count": len(updated_photos),
            "photos": updated_photos
        }
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to bulk update categories: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/photos/bulk-update-date")
def bulk_update_date(
    request: BulkUpdateDateRequest,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Bulk update photo captured dates

    Updates the date portion of captured_date while preserving the time.
    If captured_date is None, uses created_at time with the new date.

    Args:
        request.photo_ids: List of photo IDs to update
        request.new_date: New date to set (time will be preserved from existing data)
    """
    try:
        updated_photos = []

        for photo_id in request.photo_ids:
            photo = service.photo_repo.get_by_id(str(photo_id))
            if photo:
                # Get photo dict for easier access
                photo_dict = service.photo_repo._convert_to_dict(photo)

                # Determine the time component to use
                # Determine which datetime to use for time component
                existing_datetime = None
                if photo_dict.get('captured_date'):
                    # Use existing captured_date's time
                    captured = photo_dict['captured_date']
                    if isinstance(captured, str):
                        existing_datetime = datetime.fromisoformat(captured.replace('Z', '+00:00'))
                    else:
                        existing_datetime = captured
                elif photo_dict.get('created_at'):
                    # Fallback to created_at's time
                    created = photo_dict['created_at']
                    if isinstance(created, str):
                        existing_datetime = datetime.fromisoformat(created.replace('Z', '+00:00'))
                    else:
                        existing_datetime = created
                else:
                    # Default to midnight if no datetime available
                    existing_datetime = datetime.min

                # Combine new date with existing time
                new_datetime = datetime.combine(
                    request.new_date,
                    existing_datetime.time()
                )

                # Update the photo
                updated = service.photo_repo.update(
                    str(photo_id),
                    {"captured_date": new_datetime}
                )
                updated_photos.append(service.photo_repo._convert_to_dict(updated))

        db.commit()

        return {
            "updated_count": len(updated_photos),
            "photos": updated_photos
        }
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to bulk update dates: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/photos/{photo_id}")
def delete_photo(
    photo_id: UUID,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Delete photo"""
    success = service.delete_photo(photo_id)
    if not success:
        raise HTTPException(status_code=404, detail="Photo not found")

    # Commit the transaction
    db.commit()

    return {"message": "Photo deleted successfully"}


# Document generation endpoints
@router.post("/jobs/{job_id}/documents/generate-pdf", response_model=WMDocumentResponse)
async def generate_document_pdf(
    job_id: UUID,
    request: GenerateDocumentRequest,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Generate PDF document from photos

    Creates a PDF with each image taking up one full page with no margins.
    Filename format: {job_address} - {document_type}.pdf

    Document types:
    - COS: Certificate of Satisfaction (multiple photos, images only)
    - EWA: Emergency Work Agreement & Authorization (1 photo, template + overlay + photo)
    """
    try:
        from app.common.services.pdf_service import generate_images_pdf, generate_ewa_pdf
        from pathlib import Path
        import json
        import os

        # Get photo file paths
        photo_paths = []
        for photo_id in request.photo_ids:
            photo = service.photo_repo.get_by_id(str(photo_id))
            if not photo:
                raise HTTPException(status_code=404, detail=f"Photo {photo_id} not found")

            photo_dict = service.photo_repo._convert_to_dict(photo)
            file_path = Path(photo_dict['file_path'])

            if not file_path.exists():
                raise HTTPException(status_code=404, detail=f"Photo file not found: {photo_id}")

            photo_paths.append(str(file_path))

        # Generate filename
        doc_type_names = {
            'COS': 'Certificate of Satisfaction',
            'EWA': 'Emergency Work Agreement & Authorization'
        }
        doc_name = doc_type_names.get(request.document_type, request.document_type)
        filename = f"{request.job_address} - {doc_name}.pdf"

        # Create output directory
        output_dir = Path("storage/water-mitigation/documents") / str(job_id)
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / filename

        # Generate PDF based on document type
        if request.document_type == 'EWA':
            # EWA: Template with overlay + 1 photo
            if not request.date_of_loss:
                raise HTTPException(
                    status_code=400,
                    detail="date_of_loss is required for EWA document generation"
                )

            generate_ewa_pdf(
                job_address=request.job_address,
                date_of_loss=request.date_of_loss,
                photo_path=photo_paths[0],  # EWA requires exactly 1 photo (validated in schema)
                output_path=str(output_path)
            )
        else:
            # COS: Images only (multiple photos)
            generate_images_pdf(photo_paths, str(output_path))

        logger.info(f"Generated PDF: {output_path}")

        # Get file size
        file_size = os.path.getsize(output_path)

        # Create WMDocument record
        document_data = {
            "job_id": str(job_id),
            "document_type": request.document_type,
            "filename": filename,
            "file_path": str(output_path),
            "file_size": file_size,
            "mime_type": "application/pdf",
            "title": doc_name,
            "source_photo_ids": json.dumps(request.photo_ids),
            "photo_count": len(request.photo_ids),
            "is_active": True
        }

        created_document = service.document_repo.create(document_data)

        # Commit the transaction
        db.commit()

        logger.info(f"Created document record: {created_document.id}")

        # Return created document (schema will automatically exclude file_path)
        return created_document

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to generate PDF: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs/{job_id}/documents", response_model=List[WMDocumentResponse])
def list_documents(
    job_id: UUID,
    document_type: Optional[str] = None,
    is_active: bool = True,
    service: WaterMitigationService = Depends(get_wm_service)
):
    """List documents for a job"""
    try:
        if document_type:
            documents = service.document_repo.get_by_type(str(job_id), document_type, is_active)
        else:
            documents = service.document_repo.get_by_job(str(job_id), is_active)

        return documents
    except Exception as e:
        logger.error(f"Failed to list documents: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/documents/{document_id}/download")
def download_document(
    document_id: UUID,
    service: WaterMitigationService = Depends(get_wm_service)
):
    """Download document file"""
    try:
        document = service.document_repo.get_by_id(str(document_id))
        if not document:
            raise HTTPException(status_code=404, detail="Document not found")

        document_dict = service.document_repo._convert_to_dict(document)
        file_path = Path(document_dict['file_path'])

        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Document file not found on disk")

        return FileResponse(
            path=str(file_path),
            media_type=document_dict.get('mime_type', 'application/pdf'),
            filename=document_dict['filename']
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to download document: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/documents/{document_id}/preview")
def preview_document(
    document_id: UUID,
    service: WaterMitigationService = Depends(get_wm_service)
):
    """Preview document file in browser (inline display)"""
    try:
        document = service.document_repo.get_by_id(str(document_id))
        if not document:
            raise HTTPException(status_code=404, detail="Document not found")

        document_dict = service.document_repo._convert_to_dict(document)
        file_path = Path(document_dict['file_path'])

        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Document file not found on disk")

        # Return with inline disposition for browser preview
        from fastapi.responses import Response
        import mimetypes

        with open(file_path, 'rb') as f:
            content = f.read()

        return Response(
            content=content,
            media_type=document_dict.get('mime_type', 'application/pdf'),
            headers={
                'Content-Disposition': f'inline; filename="{document_dict["filename"]}"'
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to preview document: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/documents/{document_id}")
def delete_document(
    document_id: UUID,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Delete document (soft delete)"""
    try:
        success = service.document_repo.soft_delete(str(document_id))
        if not success:
            raise HTTPException(status_code=404, detail="Document not found")

        db.commit()
        return {"message": "Document deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to delete document: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Report config endpoints
@router.get("/jobs/{job_id}/report-config", response_model=ReportConfigResponse)
def get_report_config(
    job_id: UUID,
    service: WaterMitigationService = Depends(get_wm_service)
):
    """Get report config for job"""
    config = service.get_report_config(job_id)
    if not config:
        raise HTTPException(status_code=404, detail="Report config not found")
    return config


@router.post("/jobs/{job_id}/report-config", response_model=ReportConfigResponse)
def create_report_config(
    job_id: UUID,
    config: ReportConfigCreate,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Create or update report config for job"""
    try:
        # Ensure job_id in path matches body
        if config.job_id != job_id:
            raise HTTPException(status_code=400, detail="Job ID in path and body must match")

        created_config = service.create_report_config(config)
        db.commit()

        return created_config
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to create report config: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/jobs/{job_id}/report-config", response_model=ReportConfigResponse)
def update_report_config(
    job_id: UUID,
    config_update: ReportConfigUpdate,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Update report config"""
    try:
        updated_config = service.update_report_config(job_id, config_update)
        if not updated_config:
            raise HTTPException(status_code=404, detail="Report config not found")

        db.commit()
        return updated_config
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to update report config: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/jobs/{job_id}/report-config")
def delete_report_config(
    job_id: UUID,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Delete report config"""
    try:
        success = service.delete_report_config(job_id)
        if not success:
            raise HTTPException(status_code=404, detail="Report config not found")

        db.commit()
        return {"message": "Report config deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to delete report config: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/jobs/{job_id}/generate-report", response_class=FileResponse)
async def generate_photo_report(
    job_id: UUID,
    request: GenerateReportRequest,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Generate photo report PDF from configuration

    Can use saved config or provide inline config.
    Optionally saves the config for future use.
    """
    try:
        from app.common.services.pdf_service import generate_water_mitigation_report_pdf
        from pathlib import Path
        from datetime import datetime

        # Get job data
        job = service.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        # Get or create config
        config_dict = None
        config_id = None

        if request.config_id:
            # Use saved config
            config = service.get_report_config(job_id)
            if not config:
                raise HTTPException(status_code=404, detail="Report config not found")
            config_dict = config
            config_id = config['id']
        elif request.config:
            # Use inline config
            from .schemas import ReportConfigCreate
            config_data = request.config
            config_dict = config_data.dict()

            # Save config if requested
            if request.save_config:
                saved_config = service.create_report_config(config_data)
                db.commit()
                config_id = saved_config['id']
        else:
            raise HTTPException(status_code=400, detail="Either config_id or config must be provided")

        # Get all photos for the job
        photos = service.get_job_photos(job_id)
        photos_list = [service.photo_repo._convert_to_dict(p) for p in photos]

        # Get company data (if available)
        company_data = None
        if job.get('client_id'):
            from app.domains.company.repository import CompanyRepository
            company_repo = CompanyRepository(db)
            company = company_repo.get_by_id(job['client_id'])
            if company:
                company_dict = company_repo._convert_to_dict(company)
                company_data = {
                    'name': company_dict.get('name', ''),
                    'logo': company_dict.get('logo', '')
                }

        # Generate filename
        property_address = job.get('property_address', 'Property')
        report_date = datetime.now().strftime('%Y-%m-%d')
        filename = f"{property_address} - Water Mitigation Report - {report_date}.pdf"

        # Create output directory
        output_dir = Path("storage/water-mitigation/reports") / str(job_id)
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / filename

        # Generate PDF
        logger.info(f"Generating photo report for job {job_id}")
        generate_water_mitigation_report_pdf(
            job_data=job,
            config=config_dict,
            photos=photos_list,
            output_path=str(output_path),
            company_data=company_data
        )

        logger.info(f"Report generated: {output_path}")

        # Create file record in database
        from app.domains.file.repository import FileRepository
        import os

        file_repo = FileRepository(db)
        file_size = os.path.getsize(output_path)

        file_data = {
            "context": "water-mitigation",
            "context_id": str(job_id),
            "filename": filename,
            "original_name": filename,
            "content_type": "application/pdf",
            "size": file_size,
            "url": str(output_path),
            "category": "report",
            "is_active": True
        }

        created_file = file_repo.create(file_data)
        db.commit()

        file_id = created_file.get('id') if isinstance(created_file, dict) else str(created_file.id)
        logger.info(f"Created file record: {file_id}")

        # Return the PDF file directly for preview/download
        return FileResponse(
            path=str(output_path),
            media_type="application/pdf",
            filename=filename,
            headers={
                "X-File-Id": str(file_id),
                "X-Config-Id": str(config_id) if config_id else ""
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to generate report: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))
