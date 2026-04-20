"""
Water Mitigation API endpoints
"""

import logging
import math
from datetime import date, datetime, time
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.core.database_factory import get_db_session
from app.core.interfaces import DatabaseSession
from app.domains.auth.dependencies import get_current_user

from .models import WMPhoto
from .schemas import (
    BulkUpdateDateRequest,
    BulkUpdatePhotoDatesByCategoryRequest,
    BulkUpdatePhotoDatesByCategoryResponse,
    CategoryCreate,
    CategoryResponse,
    GenerateDocumentRequest,
    GenerateReportRequest,
    GenerateReportResponse,
    JobCreate,
    JobFilters,
    JobListResponse,
    JobResponse,
    JobStatusUpdate,
    JobUpdate,
    PhotoListResponse,
    ReportConfigCreate,
    ReportConfigResponse,
    ReportConfigUpdate,
    StatusHistoryResponse,
    WMDocumentResponse,
)
from .service import WaterMitigationService
from .template_api import router as template_router

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/water-mitigation", tags=["Water Mitigation"])

# Include template router as sub-router
router.include_router(template_router)


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

        # Auto-sync Client/Claim from WM Job
        try:
            from app.domains.client.client_sync_service import sync_client_from_wm_job
            wm_job = service.get_job(created_job['id'])
            if wm_job:
                sync_result = sync_client_from_wm_job(db, wm_job)
                created_job['client_sync'] = sync_result
        except Exception as sync_err:
            logger.warning(f"Client sync after WM job create failed (non-fatal): {sync_err}")

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
    active: Optional[bool] = True,  # Default to True - only show active jobs
    page: int = 1,
    page_size: int = 50,
    service: WaterMitigationService = Depends(get_wm_service)
):
    """List water mitigation jobs with filters (active jobs only by default)"""
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

    # Auto-sync Client/Claim from updated WM Job
    try:
        from app.domains.client.client_sync_service import sync_client_from_wm_job
        sync_client_from_wm_job(db, updated_job)
    except Exception as sync_err:
        logger.warning(f"Client sync after WM job update failed (non-fatal): {sync_err}")

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


class ToggleActiveRequest(BaseModel):
    """Toggle active status request schema"""
    active: bool


@router.patch("/jobs/{job_id}/active")
def toggle_job_active(
    job_id: UUID,
    request: ToggleActiveRequest,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Toggle job active status"""
    updated_job = service.toggle_job_active(job_id, request.active)
    if not updated_job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Commit the transaction
    db.commit()

    return {"id": str(job_id), "active": request.active}


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


@router.put("/categories/{category_id}", response_model=CategoryResponse)
def update_category(
    category_id: UUID,
    category_name: Optional[str] = None,
    color_code: Optional[str] = None,
    display_order: Optional[int] = None,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Update category"""
    try:
        category = service.get_category(category_id)
        if not category:
            raise HTTPException(status_code=404, detail="Category not found")

        # Build update data from provided parameters
        update_data = {}
        if category_name is not None:
            update_data['category_name'] = category_name
        if color_code is not None:
            update_data['color_code'] = color_code
        if display_order is not None:
            update_data['display_order'] = display_order

        if not update_data:
            raise HTTPException(status_code=400, detail="No fields provided for update")

        updated_category = service.category_repo.update(category_id, update_data)

        # Commit the transaction
        db.commit()

        return service.category_repo._convert_to_dict(updated_category)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update category: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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

        _invalidate_photo_list_cache()

        return service.photo_repo._convert_to_dict(photo)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to upload photo: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs/{job_id}/photos", response_model=PhotoListResponse)
async def list_photos(
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
    import time as _time

    # In-memory response cache for photo listings (30-second TTL)
    # Dramatically reduces DB load for repeated requests (tab switches, polling)
    if not hasattr(list_photos, '_cache'):
        list_photos._cache = {}
        list_photos._cache_ts = {}

    cache_key = f"{job_id}:{page}:{page_size}:{sort_by}:{sort_order}:{category_filter}:{uncategorized_only}"
    cached = list_photos._cache.get(cache_key)
    cached_ts = list_photos._cache_ts.get(cache_key, 0)
    if cached and (_time.time() - cached_ts) < 30:
        return cached

    # Limit page_size to prevent excessive queries
    page_size = min(page_size, 200)
    page = max(page, 1)

    # Parse category filter
    categories = None
    if category_filter:
        categories = [c.strip() for c in category_filter.split(',') if c.strip()]
        if not categories:
            categories = None

    # Get paginated photos with filters applied at database level (more efficient)
    photos, total = service.photo_repo.find_by_job_paginated(
        job_id=job_id,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        sort_order=sort_order,
        category_filter=categories,
        uncategorized_only=uncategorized_only
    )

    # Calculate total pages (handle None total for performance optimization)
    if total is not None and total > 0:
        total_pages = math.ceil(total / page_size)
    else:
        total_pages = None

    # Identify CompanyCam photos that need URL resolution
    companycam_photos = []
    companycam_external_ids = []

    for photo in photos:
        if photo.source == 'companycam' and photo.external_id:
            companycam_photos.append(photo)
            try:
                companycam_external_ids.append(int(photo.external_id))
            except (ValueError, TypeError):
                continue

    # Only fetch CompanyCam URLs if there are CompanyCam photos (skip entirely otherwise)
    companycam_urls = {}  # {external_id: {'thumbnail': url, 'web': url}}
    if companycam_external_ids:
        from app.core.cache import get_cache
        from app.core.config import settings

        cache = get_cache()

        # Check cache and file_path for existing URLs
        for photo in companycam_photos:
            try:
                external_id = int(photo.external_id)
                cache_key_thumbnail = f"companycam:photo:url:{external_id}:thumbnail"
                cache_key_web = f"companycam:photo:url:{external_id}:web"
                thumbnail_url = await cache.get(cache_key_thumbnail)
                web_url = await cache.get(cache_key_web)

                # Also check if file_path contains a CompanyCam URL
                if not thumbnail_url and photo.file_path and \
                   photo.file_path.startswith('https://img.companycam.com'):
                    web_url = photo.file_path
                    if 'rs:fit:400:400' in photo.file_path:
                        thumbnail_url = photo.file_path.replace(
                            'rs:fit:400:400', 'rs:fit:250:250'
                        )
                    elif 'rs:fit:4032:4032' in photo.file_path:
                        thumbnail_url = photo.file_path.replace(
                            'rs:fit:4032:4032', 'rs:fit:250:250'
                        )

                if thumbnail_url and web_url:
                    companycam_urls[external_id] = {
                        'thumbnail': thumbnail_url,
                        'web': web_url
                    }
            except (ValueError, TypeError):
                continue

        # Fetch missing URLs from API in batch with timeout
        missing_ids = [eid for eid in companycam_external_ids if eid not in companycam_urls]
        if missing_ids and settings.ENABLE_INTEGRATIONS and settings.COMPANYCAM_API_KEY:
            try:
                import asyncio

                from ..integrations.companycam.client import CompanyCamClient

                companycam_client = CompanyCamClient(api_key=settings.COMPANYCAM_API_KEY)

                try:
                    photos_data = await asyncio.wait_for(
                        companycam_client.get_photos_batch(missing_ids),
                        timeout=2.0
                    )

                    for external_id in missing_ids:
                        photo_data = photos_data.get(external_id)
                        if not photo_data or 'uris' not in photo_data:
                            continue

                        uris = photo_data['uris']
                        if not isinstance(uris, list):
                            continue

                        thumbnail_url = None
                        web_url = None

                        for uri_item in uris:
                            if not isinstance(uri_item, dict):
                                continue

                            uri_type = uri_item.get('type')
                            uri_value = uri_item.get('uri') or uri_item.get('url')

                            if not uri_type or not uri_value:
                                continue

                            # Cache all size URLs
                            cache_key = f"companycam:photo:url:{external_id}:{uri_type}"
                            await cache.set(cache_key, uri_value, ttl=86400)

                            if uri_type == 'thumbnail':
                                thumbnail_url = uri_value
                            elif uri_type == 'web':
                                web_url = uri_value

                        if thumbnail_url or web_url:
                            companycam_urls[external_id] = {
                                'thumbnail': thumbnail_url,
                                'web': web_url
                            }
                except asyncio.TimeoutError:
                    logger.warning(f"CompanyCam batch fetch timed out after 2s for {len(missing_ids)} photos, using preview endpoints")
                except Exception as e:
                    logger.warning(f"Failed to batch fetch CompanyCam URLs: {e}")
            except Exception as e:
                logger.warning(f"Failed to batch fetch CompanyCam URLs: {e}")

    # Convert photos to dict and add preview URLs
    items = []
    for photo in photos:
        photo_dict = service.photo_repo._convert_to_dict(photo)

        # Generate preview URL based on photo source and storage
        preview_url = None
        thumbnail_url = None
        fallback_preview = f"/api/water-mitigation/photos/{photo.id}/preview?size=web"
        fallback_thumbnail = f"/api/water-mitigation/photos/{photo.id}/preview?size=thumbnail"

        storage_prov = getattr(photo, 'storage_provider', None)
        db_thumb = getattr(photo, 'storage_thumbnail_url', None) or ''
        db_web = getattr(photo, 'storage_web_url', None) or ''

        # Priority 1: DB-stored CDN URLs (fastest — no API/proxy needed)
        if storage_prov != 'gdrive':
            if db_thumb.startswith('http') and db_web.startswith('http'):
                thumbnail_url = db_thumb
                preview_url = db_web
            elif db_thumb.startswith('http'):
                thumbnail_url = db_thumb
                preview_url = db_thumb

        # Priority 2: CompanyCam Redis-cached CDN URLs
        if not thumbnail_url and photo.source == 'companycam' and photo.external_id:
            try:
                external_id = int(photo.external_id)
                urls = companycam_urls.get(external_id, {})

                if urls.get('thumbnail') and urls.get('web'):
                    thumbnail_url = urls['thumbnail']
                    preview_url = urls['web']
            except (ValueError, TypeError):
                pass

        # Priority 3: Fallback to preview endpoint (proxy)
        if not thumbnail_url:
            thumbnail_url = fallback_thumbnail
            preview_url = fallback_preview

        photo_dict['preview_url'] = preview_url
        photo_dict['thumbnail_url'] = thumbnail_url
        items.append(photo_dict)

    result = {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages
    }

    # Cache result (evict old entries if cache grows too large)
    list_photos._cache[cache_key] = result
    list_photos._cache_ts[cache_key] = _time.time()
    if len(list_photos._cache) > 100:
        # Evict oldest entries
        oldest_keys = sorted(list_photos._cache_ts, key=list_photos._cache_ts.get)[:50]
        for k in oldest_keys:
            list_photos._cache.pop(k, None)
            list_photos._cache_ts.pop(k, None)

    return result


class BatchPreviewRequest(BaseModel):
    """Batch preview request schema"""
    photo_ids: List[str]
    size: str = "web"


@router.post("/photos/batch-preview")
async def batch_preview_photos(
    request: BatchPreviewRequest,
    service: WaterMitigationService = Depends(get_wm_service)
):
    """Get photo preview URLs in batch - optimized for CompanyCam photos

    Args:
        photo_ids: List of photo UUIDs
        size: Image size - 'thumbnail' (250px), 'web' (400px), or 'original' (full size)

    Returns:
        Dictionary mapping photo_id to preview URL
        {photo_id: url, ...}
    """
    from app.core.cache import get_cache

    result = {}
    cache = get_cache()

    # Convert photo_ids to UUIDs
    from uuid import UUID as UUIDType
    photo_uuid_ids = []
    for photo_id in request.photo_ids:
        try:
            photo_uuid_ids.append(UUIDType(photo_id))
        except (ValueError, TypeError):
            logger.warning(f"Invalid photo ID format: {photo_id}")
            continue

    if not photo_uuid_ids:
        return result

    # Get all photos from database in a single query (optimized - no N+1 problem)
    photos = service.photo_repo.find_by_ids(photo_uuid_ids)
    photos_by_id = {str(photo.id): photo for photo in photos}

        # Collect CompanyCam photo IDs for batch processing
    companycam_photo_ids = []
    for photo in photos:
        if photo.source == 'companycam' and photo.external_id:
            try:
                companycam_photo_ids.append((str(photo.id), int(photo.external_id)))
            except (ValueError, TypeError):
                logger.warning(f"Invalid external_id for photo {photo.id}: {photo.external_id}")

    # Batch fetch CompanyCam photo URLs
    if companycam_photo_ids:
        from app.core.config import settings

        from ..integrations.companycam.client import CompanyCamClient

        if not settings.ENABLE_INTEGRATIONS or not settings.COMPANYCAM_API_KEY:
            logger.error("CompanyCam integration disabled or API key missing")
        else:
            try:
                companycam_client = CompanyCamClient(api_key=settings.COMPANYCAM_API_KEY)

                # Get only the external IDs
                external_ids = [ext_id for _, ext_id in companycam_photo_ids]

                # Batch fetch photo data
                photos_data = await companycam_client.get_photos_batch(external_ids)

                # Process each photo
                for photo_id, external_id in companycam_photo_ids:
                    photo_data = photos_data.get(external_id)
                    if not photo_data:
                        continue

                    # Extract URLs from response
                    photo_url = None
                    size_url = None

                    if 'uris' in photo_data:
                        uris = photo_data['uris']
                        if isinstance(uris, list):
                            for uri_item in uris:
                                if isinstance(uri_item, dict):
                                    uri_type = uri_item.get('type')
                                    uri_value = uri_item.get('uri') or uri_item.get('url')

                                    # Cache all size URLs
                                    if uri_type and uri_value:
                                        cache_key = f"companycam:photo:url:{external_id}:{uri_type}"
                                        await cache.set(cache_key, uri_value, ttl=86400)

                                    # Get requested size
                                    if uri_type == request.size:
                                        size_url = uri_value
                                    elif uri_type == 'original' and not photo_url:
                                        photo_url = uri_value

                    # Use size-specific URL if available, otherwise fallback to original
                    result[photo_id] = size_url or photo_url

                    # Cache the URL
                    if result[photo_id]:
                        cache_key = f"companycam:photo:url:{external_id}"
                        await cache.set(cache_key, result[photo_id], ttl=86400)

            except Exception as e:
                logger.error(f"Failed to batch fetch CompanyCam photos: {e}")

    # Handle local/cloud storage photos
    for photo_id, photo in photos_by_id.items():
        if photo_id in result:
            continue

        if photo.source != 'companycam':
            # For local storage, return the preview endpoint URL
            result[photo_id] = f"/api/water-mitigation/photos/{photo_id}/preview?size={request.size}"

    return result


@router.get("/photos/{photo_id}/preview")
async def preview_photo(
    photo_id: UUID,
    size: Optional[str] = Query("web", description="Image size: thumbnail, web, or original"),
    service: WaterMitigationService = Depends(get_wm_service)
):
    """Get photo preview - supports CompanyCam, local, and cloud storage
    
    Args:
        photo_id: Photo UUID
        size: Image size - 'thumbnail' (250px), 'web' (400px), or 'original' (full size)
    """
    import base64

    from app.core.cache import get_cache
    
    photo = service.photo_repo.get_by_id(str(photo_id))

    if photo is None:
        logger.warning(f"Photo not found in database for ID: {photo_id}")
        raise HTTPException(status_code=404, detail="Photo not found")

    # Extract photo properties
    source = photo.get('source') if isinstance(photo, dict) else photo.source
    external_id = photo.get('external_id') if isinstance(photo, dict) else photo.external_id
    storage_provider = photo.get('storage_provider') if isinstance(photo, dict) else photo.storage_provider
    file_path = photo.get('file_path') if isinstance(photo, dict) else photo.file_path
    mime_type = photo.get('mime_type') if isinstance(photo, dict) else photo.mime_type
    media_type = mime_type or 'image/jpeg'

    # Handle CompanyCam photos - proxy the image to avoid CORS issues
    if source == 'companycam' and external_id:
        try:
            import io

            from fastapi.responses import StreamingResponse

            from app.core.config import settings

            from ..integrations.companycam.client import CompanyCamClient

            if not settings.ENABLE_INTEGRATIONS or not settings.COMPANYCAM_API_KEY:
                logger.error(f"CompanyCam integration disabled or API key missing for photo {photo_id}")
                raise HTTPException(status_code=503, detail="CompanyCam integration not available")

            cache = get_cache()
            
            # Check cache for photo bytes first (fastest)
            cache_key_bytes = f"companycam:photo:bytes:{external_id}:{size}"
            cached_bytes = await cache.get(cache_key_bytes)
            
            if cached_bytes:
                try:
                    photo_bytes = base64.b64decode(cached_bytes)
                    logger.debug(f"Serving cached photo bytes for {external_id} (size: {size})")
                    return StreamingResponse(
                        io.BytesIO(photo_bytes),
                        media_type=media_type,
                        headers={
                            "Content-Disposition": "inline",
                            "Cache-Control": "public, max-age=86400"  # Cache for 24 hours
                        }
                    )
                except Exception as e:
                    logger.warning(f"Failed to decode cached photo bytes: {e}")

            # Check cache for photo URL
            cache_key_url = f"companycam:photo:url:{external_id}"
            photo_url = await cache.get(cache_key_url)
            
            # If not cached, get from API or use file_path if it's a URL
            if not photo_url:
                # Try using file_path if it's a CompanyCam URL
                if file_path and file_path.startswith('https://img.companycam.com'):
                    photo_url = file_path
                    logger.debug(f"Using stored photo URL from file_path for {external_id}")
                else:
                    # Get from CompanyCam API
                    companycam_client = CompanyCamClient(api_key=settings.COMPANYCAM_API_KEY)
                    photo_url = companycam_client.get_photo_url(external_id)
                    
                    if photo_url:
                        # Cache the URL for 24 hours
                        await cache.set(cache_key_url, photo_url, ttl=86400)
                    else:
                        logger.error(f"Failed to get CompanyCam URL for external_id: {external_id}")
                        raise HTTPException(status_code=404, detail="CompanyCam photo URL not found")
            else:
                logger.debug(f"Using cached photo URL for {external_id}")

            # Try to get size-specific URL from CompanyCam CDN (faster than proxying)
            # Check if we have size-specific URL cached
            cache_key_size_url = f"companycam:photo:url:{external_id}:{size}"
            size_url = await cache.get(cache_key_size_url)
            
            if not size_url:
                # Try to get size-specific URL from API
                companycam_client = CompanyCamClient(api_key=settings.COMPANYCAM_API_KEY)
                try:
                    photo_data = await companycam_client.get_photo(int(external_id))
                    backfill_thumb = None
                    backfill_web = None
                    if 'uris' in photo_data:
                        uris = photo_data['uris']
                        # Handle dict format: {original: url, large: url, thumbnail: url}
                        if isinstance(uris, dict):
                            size_url = uris.get(size) or uris.get('original') or uris.get('large')
                            backfill_thumb = uris.get('thumbnail')
                            backfill_web = uris.get('web')
                            if size_url:
                                await cache.set(cache_key_size_url, size_url, ttl=86400)
                                logger.debug(f"Using {size} size URL (dict) for {external_id}")
                        # Handle list format: [{type: 'original', uri: url}, ...]
                        elif isinstance(uris, list):
                            for uri_item in uris:
                                if isinstance(uri_item, dict):
                                    uri_type = uri_item.get('type') or uri_item.get('size')
                                    uri_value = uri_item.get('uri') or uri_item.get('url')
                                    if uri_type == 'thumbnail':
                                        backfill_thumb = uri_value
                                    elif uri_type == 'web':
                                        backfill_web = uri_value
                                    if uri_type == size:
                                        size_url = uri_value
                                        if size_url:
                                            await cache.set(cache_key_size_url, size_url, ttl=86400)
                                            logger.debug(f"Using {size} size URL (list) for {external_id}")
                            # If original not found, try to get the largest available
                            if not size_url and size == 'original':
                                for uri_item in uris:
                                    if isinstance(uri_item, dict):
                                        uri_type = uri_item.get('type') or uri_item.get('size')
                                        if uri_type in ('original', 'large', 'full'):
                                            size_url = uri_item.get('uri') or uri_item.get('url')
                                            if size_url:
                                                await cache.set(cache_key_size_url, size_url, ttl=86400)
                                                logger.debug(f"Using {uri_type} size URL as fallback for {external_id}")
                                                break

                    # Backfill DB: persist CDN URLs so future requests skip API entirely
                    if backfill_thumb or backfill_web:
                        try:
                            from app.domains.water_mitigation.models import WMPhoto
                            from app.core.database_factory import get_database
                            db = get_database()
                            with db.get_session() as backfill_session:
                                db_photo = backfill_session.query(WMPhoto).filter(
                                    WMPhoto.id == photo_id
                                ).first()
                                if db_photo:
                                    if backfill_thumb and not db_photo.storage_thumbnail_url:
                                        db_photo.storage_thumbnail_url = backfill_thumb
                                    if backfill_web and not getattr(db_photo, 'storage_web_url', None):
                                        db_photo.storage_web_url = backfill_web
                                    backfill_session.commit()
                                    logger.info(f"Backfilled CDN URLs for photo {photo_id}")
                        except Exception as bf_err:
                            logger.warning(f"CDN URL backfill failed for {photo_id}: {bf_err}")

                except Exception as e:
                    logger.warning(f"Failed to get size-specific URL: {e}")
            
            # If we have a size-specific URL, redirect directly (faster)
            if size_url:
                from fastapi.responses import RedirectResponse
                return RedirectResponse(
                    url=size_url,
                    status_code=302,
                    headers={
                        "Cache-Control": "public, max-age=86400"
                    }
                )

            # Fallback: proxy through server using default photo_url
            logger.info(f"Proxying CompanyCam photo {external_id} from URL: {photo_url}")
            companycam_client = CompanyCamClient(api_key=settings.COMPANYCAM_API_KEY)
            photo_bytes = await companycam_client.download_photo(photo_url)

            # Cache photo bytes for 24 hours
            try:
                await cache.set(
                    cache_key_bytes,
                    base64.b64encode(photo_bytes).decode('utf-8'),
                    ttl=86400
                )
            except Exception as e:
                logger.warning(f"Failed to cache photo bytes: {e}")

            # Return image as streaming response
            return StreamingResponse(
                io.BytesIO(photo_bytes),
                media_type=media_type,
                headers={
                    "Content-Disposition": "inline",
                    "Cache-Control": "public, max-age=86400"
                }
            )

        except ImportError:
            logger.error(f"CompanyCam integration not available for photo {photo_id}")
            raise HTTPException(status_code=503, detail="CompanyCam integration not available")
        except Exception as e:
            logger.error(f"Failed to proxy CompanyCam photo for {photo_id}: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to access CompanyCam photo: {str(e)}")

    # Handle cloud storage (Google Drive, GCS, S3, etc.)
    if storage_provider and storage_provider != 'local':
        try:
            import io

            from fastapi.responses import StreamingResponse

            from ..storage.factory import StorageFactory
            storage = StorageFactory.get_instance(storage_provider)

            # For Google Drive and GCS: download and proxy through backend
            # (Shared Drive / private GCS files aren't publicly accessible;
            #  GCS signed URL generation requires IAM signing which may not be
            #  available on non-GCP hosting like Render)
            storage_file_id = photo.get('storage_file_id') if isinstance(photo, dict) else photo.storage_file_id
            if storage_provider in ('gdrive', 'gcs') and hasattr(storage, 'download') and storage_file_id:
                photo_bytes = storage.download(storage_file_id)
                return StreamingResponse(
                    io.BytesIO(photo_bytes),
                    media_type=media_type,
                    headers={
                        "Content-Disposition": "inline",
                        "Cache-Control": "public, max-age=86400"
                    }
                )

            # For other cloud providers (S3, Azure, etc.): redirect to signed URL
            from fastapi.responses import RedirectResponse
            signed_url = storage.get_url(file_path, expires_in=3600)
            return RedirectResponse(url=signed_url, status_code=302)
        except Exception as e:
            logger.error(f"Failed to serve cloud storage photo {photo_id}: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to access photo: {str(e)}")

    # Handle local storage - optimize and serve file
    local_file_path = Path(file_path)
    if not local_file_path.exists():
        # Try with STORAGE_BASE_DIR prefix (file_path is relative to storage root)
        from app.core.config import settings as app_settings
        local_file_path = Path(app_settings.STORAGE_BASE_DIR) / file_path
    if not local_file_path.exists():
        # Fallback: try cloud storage using configured provider (e.g. gdrive in production)
        storage_file_id = photo.get('storage_file_id') if isinstance(photo, dict) else getattr(photo, 'storage_file_id', None)
        if storage_file_id:
            try:
                import io

                from fastapi.responses import StreamingResponse

                from ..storage.factory import StorageFactory
                from app.core.config import settings as app_settings_cs
                configured_provider = app_settings_cs.STORAGE_PROVIDER.lower()
                if configured_provider != 'local':
                    logger.info(f"Local file missing for photo {photo_id}, trying {configured_provider} with file_id {storage_file_id}")
                    storage = StorageFactory.get_instance(configured_provider)
                    if hasattr(storage, 'download'):
                        photo_bytes = storage.download(storage_file_id)
                        return StreamingResponse(
                            io.BytesIO(photo_bytes),
                            media_type=media_type,
                            headers={
                                "Content-Disposition": "inline",
                                "Cache-Control": "public, max-age=86400"
                            }
                        )
            except Exception as cs_err:
                logger.warning(f"Cloud storage fallback failed for photo {photo_id}: {cs_err}")

        logger.error(f"Local file not found for photo {photo_id}: {file_path}")
        raise HTTPException(status_code=404, detail="Photo file not found on disk")

    # Optimize image for web/thumbnail sizes with disk cache
    if size in ("thumbnail", "web") and media_type.startswith('image/'):
        try:
            import io

            from fastapi.responses import Response

            from ..storage.optimization import ImageOptimizer

            # Determine target size
            max_size = (250, 250) if size == "thumbnail" else (800, 800)
            quality = 80 if size == "thumbnail" else 85

            # Build disk cache path: .cache/previews/<size>/<photo_id>.webp
            cache_dir = local_file_path.parent / ".cache" / "previews" / size
            cache_file = cache_dir / f"{photo_id}.webp"

            # Check disk cache first - skip optimization entirely if cached
            if cache_file.exists():
                # Validate cache is newer than original
                if cache_file.stat().st_mtime >= local_file_path.stat().st_mtime:
                    return FileResponse(
                        path=str(cache_file),
                        media_type='image/webp',
                        headers={
                            "Content-Disposition": "inline",
                            "Cache-Control": "public, max-age=604800, immutable",
                        }
                    )

            # Cache miss - optimize and save to disk
            with open(local_file_path, 'rb') as f:
                file_data = io.BytesIO(f.read())

            optimizer = ImageOptimizer()
            optimized_file, metadata = optimizer.optimize(
                file_data,
                max_size=max_size,
                quality=quality,
                format='WebP',
                preserve_exif=False
            )

            optimized_bytes = optimized_file.read()

            # Write to disk cache (async-safe: write to temp then rename)
            try:
                cache_dir.mkdir(parents=True, exist_ok=True)
                tmp_file = cache_file.with_suffix('.tmp')
                tmp_file.write_bytes(optimized_bytes)
                tmp_file.rename(cache_file)
                logger.debug(
                    f"Cached {size} preview for photo {photo_id}: "
                    f"{metadata.get('compression_ratio', '0%')} reduction"
                )
            except Exception as cache_err:
                logger.warning(f"Failed to cache preview for {photo_id}: {cache_err}")

            return Response(
                content=optimized_bytes,
                media_type='image/webp',
                headers={
                    "Content-Disposition": "inline",
                    "Cache-Control": "public, max-age=604800, immutable",
                }
            )
        except Exception as e:
            logger.warning(f"Image optimization failed for photo {photo_id}: {e}, serving original")
            # Fallback to original file

    return FileResponse(
        path=str(local_file_path),
        media_type=media_type,
        headers={
            "Content-Disposition": "inline",
            "Cache-Control": "public, max-age=3600"
        }
    )


@router.get("/photos/{photo_id}/download")
async def download_photo(
    photo_id: UUID,
    service: WaterMitigationService = Depends(get_wm_service)
):
    """Download photo as attachment (original quality)"""
    import io
    from fastapi.responses import StreamingResponse

    photo = service.photo_repo.get_by_id(str(photo_id))
    if photo is None:
        raise HTTPException(status_code=404, detail="Photo not found")

    source = photo.get('source') if isinstance(photo, dict) else photo.source
    external_id = photo.get('external_id') if isinstance(photo, dict) else photo.external_id
    storage_provider = photo.get('storage_provider') if isinstance(photo, dict) else photo.storage_provider
    file_path = photo.get('file_path') if isinstance(photo, dict) else photo.file_path
    mime_type = photo.get('mime_type') if isinstance(photo, dict) else photo.mime_type
    original_filename = photo.get('original_filename') if isinstance(photo, dict) else photo.original_filename
    media_type = mime_type or 'image/jpeg'
    safe_filename = original_filename or f"photo_{photo_id}.jpg"

    # CompanyCam photos
    if source == 'companycam' and external_id:
        try:
            from app.core.config import settings
            from ..integrations.companycam.client import CompanyCamClient

            if not settings.ENABLE_INTEGRATIONS or not settings.COMPANYCAM_API_KEY:
                raise HTTPException(status_code=503, detail="CompanyCam integration not available")

            companycam_client = CompanyCamClient(api_key=settings.COMPANYCAM_API_KEY)
            photo_url = file_path if file_path and file_path.startswith('https://') else None
            if not photo_url:
                photo_url = companycam_client.get_photo_url(external_id)
            if not photo_url:
                raise HTTPException(status_code=404, detail="CompanyCam photo URL not found")

            photo_bytes = await companycam_client.download_photo(photo_url)
            return StreamingResponse(
                io.BytesIO(photo_bytes),
                media_type=media_type,
                headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'}
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to download CompanyCam photo {photo_id}: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to download photo")

    # Cloud storage
    if storage_provider and storage_provider != 'local':
        try:
            from ..storage.factory import StorageFactory
            storage = StorageFactory.get_instance(storage_provider)
            storage_file_id = photo.get('storage_file_id') if isinstance(photo, dict) else photo.storage_file_id
            if storage_file_id and hasattr(storage, 'download'):
                photo_bytes = storage.download(storage_file_id)
                return StreamingResponse(
                    io.BytesIO(photo_bytes),
                    media_type=media_type,
                    headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'}
                )
        except Exception as e:
            logger.error(f"Failed to download cloud photo {photo_id}: {e}")
            raise HTTPException(status_code=500, detail="Failed to download photo")

    # Local storage
    local_file_path = Path(file_path)
    if not local_file_path.exists():
        from app.core.config import settings as app_settings
        local_file_path = Path(app_settings.STORAGE_BASE_DIR) / file_path
    if not local_file_path.exists():
        # Fallback to cloud storage
        storage_file_id = photo.get('storage_file_id') if isinstance(photo, dict) else getattr(photo, 'storage_file_id', None)
        if storage_file_id:
            try:
                from ..storage.factory import StorageFactory
                from app.core.config import settings as app_settings_cs
                configured_provider = app_settings_cs.STORAGE_PROVIDER.lower()
                if configured_provider != 'local':
                    storage = StorageFactory.get_instance(configured_provider)
                    if hasattr(storage, 'download'):
                        photo_bytes = storage.download(storage_file_id)
                        return StreamingResponse(
                            io.BytesIO(photo_bytes),
                            media_type=media_type,
                            headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'}
                        )
            except Exception:
                pass
        raise HTTPException(status_code=404, detail="Photo file not found")

    return FileResponse(
        path=str(local_file_path),
        media_type=media_type,
        filename=safe_filename,
        headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'}
    )


@router.patch("/photos/{photo_id}/category")
def update_photo_category(
    photo_id: UUID,
    category: str = Query(None),
    category_form: Optional[str] = Form(None),
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Update photo category (accepts query param or form field)"""
    # Support both query param and form data
    resolved_category = category or category_form
    if not resolved_category:
        raise HTTPException(status_code=400, detail="category is required")

    try:
        photo = service.photo_repo.get_by_id(str(photo_id))
        if not photo:
            raise HTTPException(status_code=404, detail="Photo not found")

        # Update category
        updated = service.photo_repo.update(
            str(photo_id),
            {"category": resolved_category}
        )

        db.commit()
        _invalidate_photo_list_cache()

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
    """Bulk update photo categories (optimized single query)

    Args:
        request.photo_ids: List of photo IDs to update
        request.category: Category to set (None or empty string to clear)
    """
    photo_ids = request.photo_ids
    category = request.category
    try:
        # If category is None or empty, set to empty string to clear category
        category_value = category if category else ''

        # Use optimized bulk update (single UPDATE query)
        updated_count = service.photo_repo.bulk_update_category(
            photo_ids, category_value
        )

        db.commit()
        _invalidate_photo_list_cache()

        return {
            "updated_count": updated_count,
            "category": category_value
        }
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to bulk update categories: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class BulkSetCategoriesRequest(BaseModel):
    """Set different categories for multiple photos at once"""
    updates: List[Dict[str, str]]  # [{"photo_id": "...", "category": "..."}]


@router.post("/photos/bulk-set-categories")
def bulk_set_categories(
    request: BulkSetCategoriesRequest,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """
    Set individual categories for multiple photos in a single request.
    Each item has its own photo_id and category.
    """
    from .models import WMPhoto

    applied = 0
    failed = 0

    try:
        for item in request.updates:
            photo_id = item.get("photo_id")
            category = item.get("category")
            if not photo_id or not category:
                failed += 1
                continue
            try:
                db.query(WMPhoto).filter(
                    WMPhoto.id == photo_id
                ).update({"category": category})
                applied += 1
            except Exception:
                failed += 1

        db.commit()
        _invalidate_photo_list_cache()

        return {
            "applied": applied,
            "failed": failed,
        }
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to bulk set categories: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/photos/duplicates")
def find_duplicate_photos(
    job_id: Optional[UUID] = Query(None, description="Job ID to check"),
    service: WaterMitigationService = Depends(get_wm_service)
):
    """Find duplicate photos by external_id"""
    try:
        duplicates = service.photo_repo.find_duplicates_by_external_id(job_id)
        return {
            "duplicate_count": len(duplicates),
            "duplicates": duplicates
        }
    except Exception as e:
        logger.error(f"Failed to find duplicates: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/photos/duplicates")
def delete_duplicate_photos(
    job_id: Optional[UUID] = Query(None, description="Job ID to clean"),
    dry_run: bool = Query(True, description="If true, only report"),
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Delete duplicate photos, keeping the oldest one per external_id"""
    try:
        result = service.photo_repo.delete_duplicate_photos(job_id, dry_run)
        if not dry_run:
            db.commit()
        return result
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to delete duplicates: {e}")
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


@router.put(
    "/jobs/{job_id}/photos/bulk-update-dates-by-category",
    response_model=BulkUpdatePhotoDatesByCategoryResponse
)
def bulk_update_photo_dates_by_category(
    job_id: UUID,
    request: BulkUpdatePhotoDatesByCategoryRequest,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """
    Bulk update photo dates based on category matching.

    Date mapping rules:
    - Day 2 category photos -> mitigation_start_date + 1 day
    - Day 3 category photos -> mitigation_end_date
    - All other categorized photos -> mitigation_start_date

    Photos without categories are not updated.
    """
    try:
        # Verify job exists
        job = service.job_repo.get_by_id(str(job_id))
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        # Call service method to perform bulk update
        result = service.bulk_update_photo_dates_by_category(
            job_id=job_id,
            start_date=request.mitigation_start_date,
            end_date=request.mitigation_end_date
        )

        # Commit the transaction
        db.commit()

        return result

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to bulk update photo dates by category: {e}")
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

    _invalidate_photo_list_cache()

    return {"message": "Photo deleted successfully"}


def _invalidate_photo_list_cache():
    """Clear the in-memory photo list cache"""
    if hasattr(list_photos, '_cache'):
        list_photos._cache.clear()
        list_photos._cache_ts.clear()


@router.post("/photos/{photo_id}/trash")
def trash_photo(
    photo_id: UUID,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session),
    current_user=Depends(get_current_user)
):
    """Move photo to trash (soft delete)"""
    success = service.trash_photo(photo_id, trashed_by_id=current_user.id, reason='manual')
    if not success:
        raise HTTPException(status_code=404, detail="Photo not found")

    db.commit()

    # Invalidate photo list cache so trashed photo disappears immediately
    _invalidate_photo_list_cache()

    return {"message": "Photo moved to trash"}


@router.post("/photos/{photo_id}/restore")
def restore_photo(
    photo_id: UUID,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Restore photo from trash"""
    success = service.restore_photo(photo_id)
    if not success:
        raise HTTPException(status_code=404, detail="Photo not found")

    db.commit()

    # Invalidate photo list cache so restored photo appears immediately
    _invalidate_photo_list_cache()

    return {"message": "Photo restored from trash"}


@router.get("/photos/trash")
def list_trashed_photos(
    job_id: Optional[UUID] = None,
    service: WaterMitigationService = Depends(get_wm_service)
):
    """List all trashed photos (optionally filtered by job)"""
    photos = service.list_trashed_photos(job_id=job_id)
    return {"items": photos, "total": len(photos)}


@router.get("/photos/trash/stats")
def get_trash_stats(
    job_id: Optional[UUID] = None,
    service: WaterMitigationService = Depends(get_wm_service)
):
    """Get trash statistics (total count, expiring soon, retention policy)"""
    try:
        return service.get_trash_stats(job_id=job_id)
    except Exception as e:
        logger.error(f"Failed to get trash stats: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/photos/trash/cleanup")
def cleanup_trash(
    retention_days: int = 30,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Manually trigger cleanup of photos in trash for more than retention_days.
    Permanently deletes from cloud storage and database."""
    result = service.cleanup_expired_trash(retention_days=retention_days)
    db.commit()
    return result


# CompanyCam project search endpoint
@router.get("/jobs/{job_id}/search-companycam-projects")
async def search_companycam_projects(
    job_id: UUID,
    query: Optional[str] = Query(None, description="Search query (if not provided, uses job address)"),
    service: WaterMitigationService = Depends(get_wm_service)
):
    """
    Search CompanyCam projects by address to find matching project for this job.

    If no query is provided, uses the job's street address to search.
    Returns list of matching CompanyCam projects with address comparison scores.

    Args:
        job_id: Water mitigation job ID
        query: Optional search query (uses job address if not provided)

    Returns:
        List of matching CompanyCam projects with match scores
    """
    from difflib import SequenceMatcher

    from app.domains.integrations.companycam.client import CompanyCamClient

    try:
        # Get the job to extract address
        job = service.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

        # Get job address - WM jobs use property_street, property_address fields
        if isinstance(job, dict):
            job_street = job.get('property_street') or job.get('property_address') or ''
            job_city = job.get('property_city') or ''
            job_state = job.get('property_state') or ''
            job_zipcode = job.get('property_zipcode') or ''
        else:
            job_street = getattr(job, 'property_street', '') or getattr(job, 'property_address', '') or ''
            job_city = getattr(job, 'property_city', '') or ''
            job_state = getattr(job, 'property_state', '') or ''
            job_zipcode = getattr(job, 'property_zipcode', '') or ''

        # Build full address for display
        job_address_parts = [p for p in [job_street, job_city, job_state, job_zipcode] if p]
        job_address = ', '.join(job_address_parts)

        logger.info(f"Job {job_id} address fields: street='{job_street}', city='{job_city}', state='{job_state}', zip='{job_zipcode}'")

        # Use provided query or extract just the street name for search
        if query:
            search_query = query
        elif job_street:
            # Extract just the street portion (before any comma)
            # e.g., "4215 Middlebrook Street, Fairfax 22032" -> "4215 Middlebrook Street"
            search_query = job_street.split(',')[0].strip()
        else:
            search_query = ''

        if not search_query:
            raise HTTPException(
                status_code=400,
                detail="No search query provided and job has no address"
            )

        logger.info(f"Searching CompanyCam projects with query: '{search_query}'")

        # Search CompanyCam projects
        client = CompanyCamClient()

        # Try search first
        results = await client.search_projects(search_query, per_page=50)

        # Log raw CompanyCam response for debugging
        logger.info(f"CompanyCam search API response type: {type(results)}")
        if isinstance(results, dict):
            logger.info(f"CompanyCam response keys: {list(results.keys())}")
        logger.info(f"CompanyCam search raw response (first 2000 chars): {str(results)[:2000]}")

        # If search returns empty, fetch all projects and filter locally
        project_list = results if isinstance(results, list) else results.get('data', results.get('projects', []))

        if not project_list:
            logger.info("Search returned empty results. Fetching all projects to filter locally...")

            # Fetch multiple pages of projects
            all_projects = []
            for page_num in range(1, 6):  # Fetch up to 5 pages (500 projects)
                page_results = await client.list_projects(page=page_num, per_page=100)
                page_list = page_results if isinstance(page_results, list) else page_results.get('data', page_results.get('projects', []))

                if not page_list:
                    break

                all_projects.extend(page_list)
                logger.info(f"Fetched page {page_num}: {len(page_list)} projects (total: {len(all_projects)})")

                # Stop if we got fewer than requested (last page)
                if len(page_list) < 100:
                    break

            # Use all fetched projects
            results = all_projects
            logger.info(f"Total projects fetched for local filtering: {len(results)}")

        # Process and score results
        projects = []
        job_street_lower = job_street.lower().strip()
        job_address_lower = job_address.lower().strip()

        # Handle both list and dict response formats
        project_list = results if isinstance(results, list) else results.get('data', results.get('projects', []))

        logger.info(f"Found {len(project_list)} projects from CompanyCam")

        for project in project_list:
            project_id = project.get('id')
            project_name = project.get('name') or ''  # Handle None explicitly

            # Log each project for debugging
            logger.info(f"CompanyCam project: id={project_id}, name='{project_name}', keys={list(project.keys())}")

            # Get project address - CompanyCam may have it in different formats
            project_address = ''
            if 'address' in project:
                addr = project['address']
                logger.info(f"  Project address field: type={type(addr)}, value={addr}")
                if isinstance(addr, str):
                    project_address = addr
                elif isinstance(addr, dict):
                    # Build address string from components
                    parts = [
                        addr.get('street_address_1', ''),
                        addr.get('street_address_2', ''),
                        addr.get('city', ''),
                        addr.get('state', ''),
                        addr.get('postal_code', '')
                    ]
                    project_address = ', '.join(p for p in parts if p)

            # Calculate match score using SequenceMatcher
            # Compare project name with job street (since project name is often the street address)
            project_name_lower = project_name.lower().strip()
            project_address_lower = project_address.lower().strip()

            # Multiple comparisons to find best match
            # 1. Project name vs job street address (most common match)
            name_vs_street_score = SequenceMatcher(None, job_street_lower, project_name_lower).ratio()
            # 2. Project address vs job full address
            addr_vs_addr_score = SequenceMatcher(None, job_address_lower, project_address_lower).ratio() if project_address else 0
            # 3. Project name vs job full address
            name_vs_addr_score = SequenceMatcher(None, job_address_lower, project_name_lower).ratio()

            # Use best match score
            match_score = max(name_vs_street_score, addr_vs_addr_score, name_vs_addr_score)

            logger.info(f"  Match scores: name_vs_street={name_vs_street_score:.2f}, addr_vs_addr={addr_vs_addr_score:.2f}, name_vs_addr={name_vs_addr_score:.2f} -> best={match_score:.2f}")

            projects.append({
                'id': str(project_id),
                'name': project_name,
                'address': project_address,
                'match_score': round(match_score * 100, 1),  # Convert to percentage
                'photo_count': project.get('photo_count', 0),
                'created_at': project.get('created_at'),
                'updated_at': project.get('updated_at')
            })

        # Sort by match score descending
        projects.sort(key=lambda x: x['match_score'], reverse=True)

        # Filter to only show projects with at least some match (>10%)
        # but include all if we did a local search (from list_projects)
        min_score = 10 if project_list else 0
        filtered_projects = [p for p in projects if p['match_score'] >= min_score]

        # Take top 20 results
        top_projects = filtered_projects[:20]

        logger.info(
            f"Returning {len(top_projects)} projects "
            f"(filtered from {len(projects)} total, min_score={min_score}%)"
        )

        return {
            'job_address': job_address,
            'search_query': search_query,
            'projects': top_projects,
            'total': len(top_projects)
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to search CompanyCam projects: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


# CompanyCam sync endpoint
@router.post("/jobs/{job_id}/sync-companycam-photos")
async def sync_companycam_photos(
    job_id: UUID,
    background_tasks: BackgroundTasks,
    companycam_project_id: Optional[str] = Query(None, description="CompanyCam project ID to sync from (will be saved to job if provided)"),
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """
    Manually sync photos from CompanyCam project to Water Mitigation job.

    This endpoint:
    - Starts a background task to fetch all photos from CompanyCam
    - Returns immediately with status 'started'
    - Poll GET /sync-companycam-photos/status for progress
    - If companycam_project_id is provided, it will be saved to the job

    Use this when webhook sync fails or to force a full sync.

    Args:
        companycam_project_id: Optional CompanyCam project ID. If provided and job doesn't have one, it will be saved.

    Returns:
        Confirmation that sync has started
    """
    import json

    from app.core.cache import get_cache

    try:
        # Check if job exists
        job = service.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

        # Get existing project ID or use provided one
        existing_project_id = job.get('companycam_project_id') if isinstance(job, dict) else getattr(job, 'companycam_project_id', None)

        # Use provided project ID if given, otherwise use existing
        project_id_to_use = companycam_project_id or existing_project_id

        if not project_id_to_use:
            raise HTTPException(
                status_code=400,
                detail="No CompanyCam project ID provided and job has no project linked"
            )

        # If a new project ID was provided and it's different from existing, update the job
        if companycam_project_id and companycam_project_id != existing_project_id:
            job_update_data = JobUpdate(companycam_project_id=companycam_project_id)
            service.update_job(job_id, job_update_data)
            db.commit()
            logger.info(f"Updated job {job_id} with CompanyCam project ID: {companycam_project_id}")

        # Check if sync is already running
        cache = get_cache()
        sync_key = f"companycam_sync:{job_id}"
        status_json = await cache.get(sync_key)
        if status_json:
            try:
                status = json.loads(status_json)
                if status.get('status') == 'running':
                    return {
                        "success": False,
                        "message": "Sync already in progress",
                        "status": "running"
                    }
            except (json.JSONDecodeError, TypeError, KeyError) as e:
                logger.warning(f"Failed to parse sync status: {e}")

        # Set initial status
        await cache.set(sync_key, json.dumps({
            'status': 'running',
            'synced_count': 0,
            'skipped_existing': 0,
            'skipped_trashed': 0,
            'total_companycam': 0,
            'current_page': 0,
            'errors': [],
            'message': 'Starting sync...'
        }), ttl=3600)

        # Start background task (creates its own DB session)
        background_tasks.add_task(
            run_sync_in_background,
            job_id=job_id
        )

        return {
            "success": True,
            "message": "Sync started in background",
            "status": "running"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to start CompanyCam sync for job {job_id}: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


def run_sync_in_background(job_id: UUID):
    """Background task to run CompanyCam sync (sync wrapper for async)"""
    import asyncio
    logger.info(f"Background sync task starting for job {job_id}")

    # Create a new event loop for this thread (more stable than asyncio.run in threads)
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_run_sync_async(job_id))
    finally:
        # Clean up properly
        try:
            # Cancel any pending tasks
            pending = asyncio.all_tasks(loop)
            for task in pending:
                task.cancel()
            # Wait for cancellation
            if pending:
                loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
        finally:
            loop.close()


async def _run_sync_async(job_id: UUID):
    """Actual async sync implementation"""
    from app.core.database_factory import get_database

    from .service import WaterMitigationService

    logger.info(f"Background sync started for job {job_id}")

    # Get session from database factory
    database = get_database()
    db_session = database.get_session()
    try:
        service = WaterMitigationService(db_session)

        result = await service.sync_companycam_photos(job_id)
        db_session.commit()

        logger.info(f"Background sync completed for job {job_id}: {result}")
    except Exception as e:
        logger.error(f"Background sync failed for job {job_id}: {e}")
        import traceback
        logger.error(traceback.format_exc())
        db_session.rollback()
    finally:
        db_session.close()


@router.get("/jobs/{job_id}/sync-companycam-photos/status")
async def get_sync_status(job_id: UUID):
    """
    Get current status of CompanyCam photo sync.

    Returns:
        Sync status with progress information
    """
    import json

    from app.core.cache import get_cache

    cache = get_cache()
    sync_key = f"companycam_sync:{job_id}"

    status_json = await cache.get(sync_key)
    if not status_json:
        return {
            'status': 'idle',
            'message': 'No sync in progress'
        }

    try:
        return json.loads(status_json)
    except (json.JSONDecodeError, TypeError) as e:
        logger.warning(f"Failed to parse sync status JSON: {e}")
        return {
            'status': 'unknown',
            'message': 'Could not parse sync status'
        }


@router.post("/jobs/{job_id}/sync-companycam-photos/cancel")
async def cancel_sync(job_id: UUID):
    """
    Cancel an ongoing CompanyCam photo sync.

    Returns:
        Confirmation message
    """
    import json

    from app.core.cache import get_cache

    cache = get_cache()
    sync_key = f"companycam_sync:{job_id}"

    # Get current status
    status_json = await cache.get(sync_key)
    if not status_json:
        return {
            'success': False,
            'message': 'No sync in progress to cancel'
        }

    try:
        status = json.loads(status_json)
        if status.get('status') != 'running':
            return {
                'success': False,
                'message': f"Sync is not running (status: {status.get('status')})"
            }

        # Set cancelled flag and message
        status['status'] = 'cancelled'
        status['message'] = f"Sync cancelled. Synced {status.get('synced_count', 0)} photos before cancellation."
        await cache.set(sync_key, json.dumps(status), ttl=3600)

        # Verify cancellation was saved
        verify_json = await cache.get(sync_key)
        logger.info(f"Sync cancellation requested for job {job_id}, verified cache: {verify_json}")
        return {
            'success': True,
            'message': 'Cancellation requested. Sync will stop after current photo.'
        }
    except Exception as e:
        logger.error(f"Failed to cancel sync for job {job_id}: {e}")
        return {
            'success': False,
            'message': f'Failed to cancel: {str(e)}'
        }


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

    Supports multiple storage sources:
    - Local filesystem
    - Google Cloud Storage (GCS)
    - CompanyCam (remote download)
    """
    import tempfile
    temp_files = []  # Track temp files for cleanup

    try:
        import json
        import os
        from pathlib import Path

        from app.common.services.pdf_service import (
            generate_ewa_pdf,
            generate_images_pdf,
        )
        from app.core.config import settings
        from app.domains.storage.factory import StorageFactory

        # Get job to retrieve company_code for template selection
        job_dict = service.get_job(job_id)
        company_code = None
        if job_dict:
            logger.info(f"Job found: {job_dict.get('property_address')}")
            logger.info(f"Job company data: {job_dict.get('company')}")
            if job_dict.get('company'):
                company_code = job_dict['company'].get('company_code')
                logger.info(f"EWA generation using company_code: {company_code}")
            else:
                logger.warning(f"No company assigned to job {job_id}")

        # Get photo file paths and build rotation mapping
        photo_paths = []
        path_to_id = {}  # Map file path to photo_id for rotation lookup

        for photo_id in request.photo_ids:
            photo = service.photo_repo.get_by_id(str(photo_id))
            if not photo:
                raise HTTPException(status_code=404, detail=f"Photo {photo_id} not found")

            photo_dict = service.photo_repo._convert_to_dict(photo)
            file_path_str = photo_dict.get('file_path', '')
            source = photo_dict.get('source', 'local')
            external_id = photo_dict.get('external_id')
            storage_provider = settings.STORAGE_PROVIDER

            local_path = Path(file_path_str)
            photo_added = False

            # Check if local file exists (absolute or relative path)
            if local_path.exists():
                resolved = str(local_path.resolve())
                photo_paths.append(resolved)
                path_to_id[resolved] = str(photo_id)
                logger.debug(f"Using local file for photo {photo_id}: {resolved}")
                photo_added = True

            # Try cloud storage (GCS, GDrive, etc.)
            elif storage_provider and storage_provider.lower() != 'local':
                try:
                    storage = StorageFactory.get_instance(storage_provider)
                    logger.info(f"Downloading photo {photo_id} from {storage_provider}: {file_path_str}")
                    photo_bytes = storage.download(file_path_str)

                    if photo_bytes:
                        mime_type = photo_dict.get('mime_type', 'image/jpeg')
                        ext = '.jpg'
                        if 'png' in mime_type:
                            ext = '.png'
                        elif 'webp' in mime_type:
                            ext = '.webp'

                        temp_fd, temp_path = tempfile.mkstemp(suffix=ext)
                        os.write(temp_fd, photo_bytes)
                        os.close(temp_fd)
                        temp_files.append(temp_path)

                        photo_paths.append(temp_path)
                        path_to_id[temp_path] = str(photo_id)
                        logger.info(f"Downloaded cloud photo to temp: {temp_path}")
                        photo_added = True

                except Exception as e:
                    logger.error(f"Failed to download from {storage_provider}: {e}")

            # Try CompanyCam for remote photos (fallback if cloud storage failed)
            if not photo_added and source == 'companycam' and external_id:
                if not settings.ENABLE_INTEGRATIONS or not settings.COMPANYCAM_API_KEY:
                    raise HTTPException(
                        status_code=503,
                        detail="CompanyCam integration not available"
                    )

                try:
                    from app.core.cache import get_cache

                    from ..integrations.companycam.client import CompanyCamClient

                    cache = get_cache()
                    companycam_client = CompanyCamClient(api_key=settings.COMPANYCAM_API_KEY)

                    cache_key = f"companycam:photo:url:{external_id}:original"
                    photo_url = await cache.get(cache_key)

                    if not photo_url:
                        photo_data = await companycam_client.get_photo(int(external_id))
                        if 'uris' in photo_data:
                            uris = photo_data['uris']
                            if isinstance(uris, list):
                                for uri in uris:
                                    if isinstance(uri, dict) and uri.get('type') == 'original':
                                        photo_url = uri.get('uri') or uri.get('url')
                                        if photo_url:
                                            await cache.set(cache_key, photo_url, ttl=86400)
                                        break

                    if not photo_url:
                        raise HTTPException(status_code=404, detail=f"No URL for CompanyCam photo: {photo_id}")

                    logger.info(f"Downloading CompanyCam photo {external_id}")
                    photo_bytes = await companycam_client.download_photo(photo_url)

                    mime_type = photo_dict.get('mime_type', 'image/jpeg')
                    ext = '.webp' if 'webp' in mime_type else '.png' if 'png' in mime_type else '.jpg'

                    temp_fd, temp_path = tempfile.mkstemp(suffix=ext)
                    os.write(temp_fd, photo_bytes)
                    os.close(temp_fd)
                    temp_files.append(temp_path)

                    photo_paths.append(temp_path)
                    path_to_id[temp_path] = str(photo_id)
                    logger.info(f"Downloaded CompanyCam photo to: {temp_path}")
                    photo_added = True

                except HTTPException:
                    raise
                except Exception as e:
                    logger.error(f"Failed to download CompanyCam photo {photo_id}: {e}")
                    raise HTTPException(status_code=500, detail=f"Failed to download photo: {photo_id}")

            if not photo_added:
                raise HTTPException(status_code=404, detail=f"Photo file not found: {photo_id}")

        # Build rotations dict using photo_id as key (to match paths in pdf_service)
        rotations = None
        if request.rotations:
            rotations = {str(k): v for k, v in request.rotations.items()}
            logger.info(f"Photo rotations requested: {rotations}")

        # Generate filename
        doc_type_names = {
            'COS': 'Certificate of Satisfaction',
            'EWA': 'Emergency Work Agreement & Authorization',
            'Custom': 'Custom Document'
        }

        # Use custom filename if provided for Custom type
        if request.document_type == 'Custom' and request.custom_filename:
            filename = f"{request.custom_filename}.pdf"
            doc_name = 'Custom Document'
        else:
            doc_name = doc_type_names.get(request.document_type, request.document_type)
            filename = f"{request.job_address} - {doc_name}.pdf"

        # Create output directory
        output_dir = Path("storage/water-mitigation/documents") / str(job_id)
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / filename

        # Generate PDF based on document type
        if request.document_type == 'EWA':
            # EWA: Template with overlay + 1 photo
            # EWA uses date_of_loss for the date field
            if not request.date_of_loss:
                raise HTTPException(
                    status_code=400,
                    detail="date_of_loss is required for EWA document generation"
                )

            # Get rotation for the EWA photo (if any)
            ewa_rotation = 0
            if rotations and request.photo_ids:
                ewa_rotation = rotations.get(str(request.photo_ids[0]), 0)

            generate_ewa_pdf(
                job_address=request.job_address,
                date_of_loss=request.date_of_loss,
                photo_path=photo_paths[0],  # EWA requires exactly 1 photo (validated in schema)
                output_path=str(output_path),
                rotation=ewa_rotation,
                company_code=company_code,
                compress=request.compress
            )
        else:
            # COS: Images only (multiple photos)
            generate_images_pdf(photo_paths, str(output_path), rotations=rotations)

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
    finally:
        # Clean up temp files
        for temp_path in temp_files:
            try:
                if os.path.exists(temp_path):
                    os.unlink(temp_path)
                    logger.debug(f"Cleaned up temp file: {temp_path}")
            except Exception as e:
                logger.warning(f"Failed to cleanup temp file {temp_path}: {e}")


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
        import mimetypes

        from fastapi.responses import Response

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


@router.post("/jobs/{job_id}/documents/upload-annotated-pdf", response_model=WMDocumentResponse)
async def upload_annotated_pdf(
    job_id: UUID,
    pdf_file: UploadFile = File(...),
    filename: str = Form(...),
    annotation_data: str = Form(None),
    document_id: str = Form(None),
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Upload an annotated PDF with annotation data for re-editing.

    If document_id is provided, updates the existing document.
    Otherwise creates a new document record.
    """
    import json
    import os

    try:
        # Validate file type
        if not pdf_file.filename.lower().endswith('.pdf'):
            raise HTTPException(status_code=400, detail="Only PDF files are allowed")

        # Create output directory
        output_dir = Path("storage/water-mitigation/documents") / str(job_id)
        output_dir.mkdir(parents=True, exist_ok=True)

        safe_filename = filename if filename.endswith('.pdf') else f"{filename}.pdf"
        output_path = output_dir / safe_filename

        # Write PDF file
        content = await pdf_file.read()
        with open(output_path, 'wb') as f:
            f.write(content)

        file_size = os.path.getsize(output_path)

        if document_id:
            # Update existing document
            existing = service.document_repo.get_by_id(document_id)
            if not existing:
                raise HTTPException(status_code=404, detail="Document not found")

            # Delete old file if path changed
            existing_dict = service.document_repo._convert_to_dict(existing)
            old_path = Path(existing_dict.get('file_path', ''))
            if old_path.exists() and str(old_path) != str(output_path):
                try:
                    os.unlink(old_path)
                except Exception:
                    pass

            update_data = {
                "filename": safe_filename,
                "file_path": str(output_path),
                "file_size": file_size,
                "annotation_data": annotation_data,
            }
            updated = service.document_repo.update(document_id, update_data)
            db.commit()
            return updated
        else:
            # Create new document
            document_data = {
                "job_id": str(job_id),
                "document_type": "annotated_pdf",
                "filename": safe_filename,
                "file_path": str(output_path),
                "file_size": file_size,
                "mime_type": "application/pdf",
                "title": safe_filename,
                "annotation_data": annotation_data,
                "photo_count": 0,
                "is_active": True,
            }
            created = service.document_repo.create(document_data)
            db.commit()
            return created

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to upload annotated PDF: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/jobs/{job_id}/documents/upload-source-pdf")
async def upload_source_pdf(
    job_id: UUID,
    pdf_file: UploadFile = File(...)
):
    """Upload a source PDF for annotation. Returns the PDF as a proxied URL.

    Stores the file temporarily so the frontend can access it via URL.
    """
    import os

    try:
        if not pdf_file.filename.lower().endswith('.pdf'):
            raise HTTPException(status_code=400, detail="Only PDF files are allowed")

        # Store in a temp/source directory
        output_dir = Path("storage/water-mitigation/documents") / str(job_id) / "source"
        output_dir.mkdir(parents=True, exist_ok=True)

        safe_filename = pdf_file.filename or "upload.pdf"
        output_path = output_dir / safe_filename

        content = await pdf_file.read()
        with open(output_path, 'wb') as f:
            f.write(content)

        file_size = os.path.getsize(output_path)

        return {
            "filename": safe_filename,
            "file_path": str(output_path),
            "file_size": file_size,
            "url": f"/api/water-mitigation/jobs/{job_id}/documents/source-pdf/{safe_filename}"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to upload source PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs/{job_id}/documents/source-pdf/{filename}")
def serve_source_pdf(
    job_id: UUID,
    filename: str
):
    """Serve a source PDF file for annotation viewer."""
    file_path = Path("storage/water-mitigation/documents") / str(job_id) / "source" / filename

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Source PDF not found")

    return FileResponse(
        path=str(file_path),
        media_type="application/pdf",
        filename=filename
    )


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
        from datetime import datetime
        from pathlib import Path

        from app.common.services.pdf_service import generate_water_mitigation_report_pdf

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

        # Get company data - prioritize assigned company, fall back to client company
        company_data = None

        # Check if job has company relationship already loaded
        if job.get('company'):
            # Company relationship is loaded (from lazy="joined" in model)
            company_obj = job['company']
            company_data = {
                'name': company_obj.get('name', '') if isinstance(company_obj, dict) else getattr(company_obj, 'name', ''),
                'logo': company_obj.get('logo', '') if isinstance(company_obj, dict) else getattr(company_obj, 'logo', '')
            }
            logger.info(f"Using job's assigned company: {company_data['name']}")
        elif job.get('company_id'):
            # Fetch assigned company if not loaded
            from app.domains.company.repository import CompanyRepository
            company_repo = CompanyRepository(db)
            company = company_repo.get_by_id(job['company_id'])
            if company:
                company_dict = company_repo._convert_to_dict(company)
                company_data = {
                    'name': company_dict.get('name', ''),
                    'logo': company_dict.get('logo', '')
                }
                logger.info(f"Fetched assigned company: {company_data['name']}")
        elif job.get('client_id'):
            # Fall back to client company for backwards compatibility
            from app.domains.company.repository import CompanyRepository
            company_repo = CompanyRepository(db)
            company = company_repo.get_by_id(job['client_id'])
            if company:
                company_dict = company_repo._convert_to_dict(company)
                company_data = {
                    'name': company_dict.get('name', ''),
                    'logo': company_dict.get('logo', '')
                }
                logger.info(f"Using client company: {company_data['name']}")

        # Generate filename
        property_address = job.get('property_address', 'Property')
        report_date = datetime.now().strftime('%Y-%m-%d')
        filename = f"{property_address} - Water Mitigation Report - {report_date}.pdf"

        # Create output directory
        output_dir = Path("storage/water-mitigation/reports") / str(job_id)
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / filename

        # Generate PDF
        logger.info(f"Generating photo report for job {job_id} (compress={request.compress})")
        generate_water_mitigation_report_pdf(
            job_data=job,
            config=config_dict,
            photos=photos_list,
            output_path=str(output_path),
            company_data=company_data,
            report_date=request.report_date,
            compress=request.compress
        )

        logger.info(f"Report generated: {output_path}")

        # Create file record in database
        import os

        from app.domains.file.repository import FileRepository

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


# Debug endpoint to check photo counts for a job
@router.get("/jobs/{job_id}/photos/debug-count")
async def debug_photo_count(
    job_id: UUID,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """
    Debug endpoint to analyze photo count discrepancies.

    Returns detailed breakdown of photo counts for troubleshooting.
    """
    from sqlalchemy import distinct, func

    # Total photos for this job
    total = db.query(func.count(WMPhoto.id)).filter(WMPhoto.job_id == job_id).scalar()

    # Non-trashed photos
    non_trashed = db.query(func.count(WMPhoto.id)).filter(
        WMPhoto.job_id == job_id,
        WMPhoto.is_trashed.is_(False)
    ).scalar()

    # Trashed photos
    trashed = db.query(func.count(WMPhoto.id)).filter(
        WMPhoto.job_id == job_id,
        WMPhoto.is_trashed.is_(True)
    ).scalar()

    # CompanyCam photos
    companycam_total = db.query(func.count(WMPhoto.id)).filter(
        WMPhoto.job_id == job_id,
        WMPhoto.source == 'companycam'
    ).scalar()

    # Unique CompanyCam external_ids
    unique_external_ids = db.query(func.count(distinct(WMPhoto.external_id))).filter(
        WMPhoto.job_id == job_id,
        WMPhoto.source == 'companycam'
    ).scalar()

    # Check for duplicates
    duplicate_external_ids = db.query(
        WMPhoto.external_id,
        func.count(WMPhoto.id).label('count')
    ).filter(
        WMPhoto.job_id == job_id,
        WMPhoto.source == 'companycam',
        WMPhoto.external_id.isnot(None)
    ).group_by(WMPhoto.external_id).having(func.count(WMPhoto.id) > 1).all()

    # Photos by source
    by_source = db.query(
        WMPhoto.source,
        func.count(WMPhoto.id).label('count')
    ).filter(WMPhoto.job_id == job_id).group_by(WMPhoto.source).all()

    return {
        'job_id': str(job_id),
        'total_photos': total,
        'non_trashed': non_trashed,
        'trashed': trashed,
        'companycam_photos': {
            'total': companycam_total,
            'unique_external_ids': unique_external_ids,
            'has_duplicates': len(duplicate_external_ids) > 0,
            'duplicates': [
                {'external_id': ext_id, 'count': count}
                for ext_id, count in duplicate_external_ids
            ] if duplicate_external_ids else []
        },
        'by_source': {
            source: count for source, count in by_source
        },
        'count_by_job_result': service.photo_repo.count_by_job(job_id)
    }


# Admin/Migration endpoint to update thumbnail URLs for existing CompanyCam photos
@router.post("/admin/migrate-thumbnail-urls")
async def migrate_thumbnail_urls(
    batch_size: int = Query(50, description="Number of photos to process per batch"),
    dry_run: bool = Query(False, description="If true, only count photos without updating"),
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """
    Migrate existing CompanyCam photos to use CDN thumbnail URLs.
    
    This endpoint fetches thumbnail URLs from CompanyCam API for photos
    that don't have storage_thumbnail_url set.
    
    Args:
        batch_size: Number of photos to process in one call
        dry_run: If True, only count photos needing migration
        
    Returns:
        Migration statistics
    """
    from app.core.config import settings
    from app.domains.integrations.companycam.client import CompanyCamClient
    
    if not settings.ENABLE_INTEGRATIONS or not settings.COMPANYCAM_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="CompanyCam integration not enabled"
        )
    
    # Find CompanyCam photos without thumbnail URL
    photos_to_update = db.query(WMPhoto).filter(
        WMPhoto.source == 'companycam',
        WMPhoto.external_id.isnot(None),
        (WMPhoto.storage_thumbnail_url.is_(None) | (WMPhoto.storage_thumbnail_url == ''))
    ).limit(batch_size).all()
    
    if dry_run:
        # Count total photos needing migration
        total_count = db.query(WMPhoto).filter(
            WMPhoto.source == 'companycam',
            WMPhoto.external_id.isnot(None),
            (WMPhoto.storage_thumbnail_url.is_(None) | (WMPhoto.storage_thumbnail_url == ''))
        ).count()
        
        return {
            'dry_run': True,
            'photos_needing_migration': total_count,
            'batch_size': batch_size,
            'estimated_batches': (total_count + batch_size - 1) // batch_size if total_count > 0 else 0
        }
    
    if not photos_to_update:
        return {
            'success': True,
            'message': 'No photos need migration',
            'updated': 0,
            'failed': 0,
            'remaining': 0
        }
    
    # Initialize CompanyCam client
    companycam_client = CompanyCamClient(api_key=settings.COMPANYCAM_API_KEY)
    
    updated = 0
    failed = 0
    errors = []
    
    # Batch fetch photo data from CompanyCam
    external_ids = [int(p.external_id) for p in photos_to_update if p.external_id]
    
    try:
        photos_data = await companycam_client.get_photos_batch(external_ids)
        
        for photo in photos_to_update:
            try:
                external_id = int(photo.external_id)
                photo_data = photos_data.get(external_id)
                
                if not photo_data or 'uris' not in photo_data:
                    failed += 1
                    errors.append(f"No data for photo {photo.id} (external_id: {external_id})")
                    continue
                
                uris = photo_data['uris']
                thumbnail_url = None
                
                if isinstance(uris, list):
                    for uri in uris:
                        if isinstance(uri, dict) and uri.get('type') == 'thumbnail':
                            thumbnail_url = uri.get('uri')
                            break
                
                if thumbnail_url:
                    photo.storage_thumbnail_url = thumbnail_url
                    updated += 1
                    logger.info(f"Updated thumbnail URL for photo {photo.id}")
                else:
                    failed += 1
                    errors.append(f"No thumbnail URL found for photo {photo.id}")
                    
            except Exception as e:
                failed += 1
                errors.append(f"Error processing photo {photo.id}: {str(e)}")
                logger.error(f"Error migrating photo {photo.id}: {e}")
        
        # Commit changes
        db.commit()
        
    except Exception as e:
        db.rollback()
        logger.error(f"Batch fetch failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch from CompanyCam: {str(e)}")
    
    # Count remaining photos
    remaining = db.query(WMPhoto).filter(
        WMPhoto.source == 'companycam',
        WMPhoto.external_id.isnot(None),
        (WMPhoto.storage_thumbnail_url.is_(None) | (WMPhoto.storage_thumbnail_url == ''))
    ).count()
    
    return {
        'success': True,
        'message': f'Migrated {updated} photos, {failed} failed',
        'updated': updated,
        'failed': failed,
        'remaining': remaining,
        'errors': errors[:10] if errors else []
    }


# =============================================================================
# AI Photo Classification Endpoints
# =============================================================================

class AIClassifyRequest(BaseModel):
    """Request for AI classification"""
    photo_ids: List[str]
    force_refresh: bool = False


class AIClassifyResponse(BaseModel):
    """Response for AI classification"""
    success: bool
    classified: int
    failed: int
    results: List[dict]


@router.get("/jobs/{job_id}/ai-results")
async def get_ai_results_for_job(
    job_id: UUID,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """
    Get all cached AI classification results for a job's photos.
    Returns results without re-running classification.
    """
    from .models import PhotoAnalysisCache, WMPhoto

    # Get all photo IDs for this job that have cached results
    rows = db.query(
        WMPhoto.id,
        PhotoAnalysisCache.ai_result,
        PhotoAnalysisCache.updated_at,
    ).join(
        PhotoAnalysisCache,
        PhotoAnalysisCache.photo_id == WMPhoto.id,
    ).filter(
        WMPhoto.job_id == job_id,
        WMPhoto.is_trashed == False,
    ).all()

    results = []
    for photo_id, ai_result, updated_at in rows:
        if ai_result:
            results.append({
                "photo_id": str(photo_id),
                "cached": True,
                "analyzed_at": updated_at.isoformat() if updated_at else None,
                **ai_result,
            })

    return {
        "total": len(results),
        "results": results,
    }


@router.post("/photos/ai-classify", response_model=AIClassifyResponse)
async def ai_classify_photos(
    request: AIClassifyRequest,
    background_tasks: BackgroundTasks,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """
    Classify photos using AI (Gemini Vision).

    This endpoint analyzes photos and suggests categories based on:
    - Moisture meter color (red/yellow/green)
    - Demolition state
    - Equipment presence and status
    - Mold detection

    Args:
        request.photo_ids: List of photo IDs to classify
        request.force_refresh: If True, re-classify even if cached result exists

    Returns:
        Classification results for each photo
    """
    from app.core.config import settings
    from .ai_classification_service import ai_classification_service

    if not settings.ENABLE_AI_PHOTO_CLASSIFICATION:
        raise HTTPException(
            status_code=400,
            detail="AI photo classification is disabled"
        )

    if not settings.GEMINI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY is not configured"
        )

    results = []
    classified = 0
    failed = 0

    for photo_id in request.photo_ids:
        try:
            # Get photo from database
            photo = service.photo_repo.get_by_id(photo_id)
            if not photo:
                results.append({
                    "photo_id": photo_id,
                    "error": "Photo not found"
                })
                failed += 1
                continue

            # Check cache first (unless force refresh)
            if not request.force_refresh:
                cached = ai_classification_service.get_cached_result(db, photo_id)
                if cached:
                    results.append({
                        "photo_id": photo_id,
                        "cached": True,
                        **cached
                    })
                    classified += 1
                    continue

            # Get photo file path and read image
            photo_dict = service.photo_repo._convert_to_dict(photo)
            file_path = photo_dict.get('file_path')

            if not file_path:
                results.append({
                    "photo_id": photo_id,
                    "error": "Photo file path not found"
                })
                failed += 1
                continue

            # Read image data
            image_data = None
            mime_type = photo_dict.get('mime_type', 'image/jpeg')
            storage_file_id = photo_dict.get('storage_file_id')
            photo_storage_provider = photo_dict.get('storage_provider', '')

            try:
                # 1) Try local file
                from app.core.config import settings as app_settings
                base_dir = Path(app_settings.STORAGE_BASE_DIR)

                # Try file_path directly (may be absolute)
                direct_path = Path(file_path)
                if direct_path.is_absolute() and direct_path.exists():
                    with open(direct_path, 'rb') as f:
                        image_data = f.read()
                else:
                    # Try relative to base_dir
                    local_path = base_dir / file_path
                    if local_path.exists():
                        with open(local_path, 'rb') as f:
                            image_data = f.read()

                # 2) Try cloud storage with storage_file_id
                #    Only try providers that could have this file
                if image_data is None and storage_file_id:
                    from ..storage.factory import StorageFactory

                    providers_to_try = []

                    # Try the photo's own storage provider first
                    if photo_storage_provider and photo_storage_provider != 'local':
                        providers_to_try.append(photo_storage_provider)

                    # Then try currently configured provider
                    configured = app_settings.STORAGE_PROVIDER.lower()
                    if configured != 'local' and configured not in providers_to_try:
                        providers_to_try.append(configured)

                    for provider in providers_to_try:
                        try:
                            storage = StorageFactory.create(provider)
                            if hasattr(storage, 'download'):
                                image_data = storage.download(
                                    storage_file_id
                                )
                                logger.info(
                                    f"AI classify: photo {photo_id} "
                                    f"from {provider}"
                                )
                                break
                        except Exception:
                            continue

                # 3) CompanyCam CDN fallback for companycam-sourced photos
                if image_data is None and photo_dict.get('source') == 'companycam':
                    thumbnail_url = photo_dict.get('storage_thumbnail_url', '')
                    if thumbnail_url and thumbnail_url.startswith('http'):
                        try:
                            import httpx
                            async with httpx.AsyncClient(timeout=15) as client:
                                resp = await client.get(thumbnail_url)
                                if resp.status_code == 200:
                                    image_data = resp.content
                                    logger.info(
                                        f"AI classify: photo {photo_id} "
                                        f"from CompanyCam CDN fallback"
                                    )
                        except Exception as cdn_err:
                            logger.warning(
                                f"CompanyCam CDN fallback failed "
                                f"for {photo_id}: {cdn_err}"
                            )

                if image_data is None:
                    results.append({
                        "photo_id": photo_id,
                        "error": "Photo file not accessible"
                    })
                    failed += 1
                    continue

            except Exception as e:
                results.append({
                    "photo_id": photo_id,
                    "error": f"Failed to read image: {str(e)}"
                })
                failed += 1
                continue

            # Classify photo
            result = await ai_classification_service.classify_photo_two_phase(
                image_data,
                mime_type
            )

            if "error" not in result:
                # Save to cache
                ai_classification_service.save_result(db, photo_id, result)
                results.append({
                    "photo_id": photo_id,
                    "cached": False,
                    **result
                })
                classified += 1
            else:
                results.append({
                    "photo_id": photo_id,
                    **result
                })
                failed += 1

        except Exception as e:
            logger.error(f"AI classification failed for photo {photo_id}: {e}")
            results.append({
                "photo_id": photo_id,
                "error": str(e)
            })
            failed += 1

    return AIClassifyResponse(
        success=failed == 0,
        classified=classified,
        failed=failed,
        results=results
    )


@router.post("/photos/{photo_id}/ai-classify")
async def ai_classify_single_photo(
    photo_id: UUID,
    force_refresh: bool = Query(False, description="Force re-classification even if cached"),
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """
    Classify a single photo using AI.

    Returns the AI-suggested category and metadata without changing the photo's category.
    Use PATCH /photos/{photo_id}/category to actually update the category.
    """
    request = AIClassifyRequest(
        photo_ids=[str(photo_id)],
        force_refresh=force_refresh
    )
    response = await ai_classify_photos(
        request=request,
        background_tasks=BackgroundTasks(),
        service=service,
        db=db
    )

    if response.results:
        return response.results[0]
    else:
        raise HTTPException(status_code=500, detail="Classification failed")


@router.post("/photos/{photo_id}/ai-apply")
async def apply_ai_classification(
    photo_id: UUID,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """
    Apply AI classification result to a photo.

    This will:
    1. Get the AI classification result (from cache or run new classification)
    2. Update the photo's category to the AI-suggested category

    Returns the updated photo.
    """
    from .ai_classification_service import ai_classification_service

    # Get cached result
    cached = ai_classification_service.get_cached_result(db, str(photo_id))

    if not cached:
        # Run classification first
        classify_response = await ai_classify_single_photo(
            photo_id=photo_id,
            force_refresh=False,
            service=service,
            db=db
        )
        if "error" in classify_response:
            raise HTTPException(
                status_code=400,
                detail=f"Classification failed: {classify_response.get('error')}"
            )
        cached = classify_response

    # Get suggested category
    suggested_category = cached.get("category", "uncategorized")

    # Update photo category
    photo = service.photo_repo.get_by_id(str(photo_id))
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    updated = service.photo_repo.update(
        str(photo_id),
        {"category": suggested_category}
    )
    db.commit()

    return {
        "success": True,
        "photo_id": str(photo_id),
        "applied_category": suggested_category,
        "ai_confidence": cached.get("confidence"),
        "rule_applied": cached.get("rule_applied"),
        "photo": service.photo_repo._convert_to_dict(updated)
    }


@router.patch("/photos/{photo_id}/category-correction")
def correct_photo_category(
    photo_id: UUID,
    category: str = Form(..., description="User-corrected category"),
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """
    Correct a photo's category (marks as user-corrected for analytics).

    Use this endpoint when:
    - User disagrees with AI classification and wants to set a different category
    - User wants to manually categorize a photo

    This tracks the correction for pattern analysis (not used for training).
    """
    from .ai_classification_service import ai_classification_service

    photo = service.photo_repo.get_by_id(str(photo_id))
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    # Mark as user corrected in cache (for analytics)
    ai_classification_service.mark_user_corrected(db, str(photo_id), category)

    # Update photo category
    updated = service.photo_repo.update(
        str(photo_id),
        {"category": category}
    )
    db.commit()

    return {
        "success": True,
        "photo_id": str(photo_id),
        "category": category,
        "user_corrected": True,
        "photo": service.photo_repo._convert_to_dict(updated)
    }


# =============================================================================
# Google Drive Export Endpoints
# =============================================================================

@router.post("/jobs/{job_id}/export-to-gdrive")
async def export_photos_to_gdrive(
    job_id: UUID,
    background_tasks: BackgroundTasks,
    service: WaterMitigationService = Depends(get_wm_service),
    db: DatabaseSession = Depends(get_db_session),
    current_user = Depends(get_current_user)
):
    """
    Export CompanyCam photos to Google Drive.

    Photos are organized in: CompanyCam/{job_address}/

    This endpoint:
    - Starts a background task to export photos
    - Returns immediately with status 'started'
    - Poll GET /export-to-gdrive/status for progress

    Only exports photos with source='companycam' (excludes manual uploads).
    Duplicate filenames in target folder are skipped.

    Returns:
        Confirmation that export has started
    """
    import json

    from app.core.cache import get_cache

    from .gdrive_export_service import GDriveExportService

    try:
        # Check if job exists
        job = service.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

        # Get job address
        job_address = (
            job.get('property_address') if isinstance(job, dict)
            else getattr(job, 'property_address', None)
        )
        if not job_address:
            raise HTTPException(
                status_code=400,
                detail="Job has no address set. Cannot create Drive folder."
            )

        # Get current user's Google Drive settings
        from app.core.config import settings
        from app.core.encryption import decrypt_text
        from app.domains.staff.service import StaffService

        # StaffService needs to be called without arguments to use the default DatabaseProvider
        # The 'db' parameter is a SQLAlchemy Session, not a DatabaseProvider
        staff_service = StaffService()
        staff = staff_service.get_by_id(current_user.id) if current_user else None
        logger.info(f"Retrieved staff: {staff is not None}, staff_id: {current_user.id if current_user else None}")

        # Initialize credential variables
        user_gdrive_json = None
        user_gdrive_folder_id = None
        oauth_tokens = None  # For OAuth authentication

        if staff:
            user_gdrive_folder_id = staff.get('gdrive_root_folder_id')
            gdrive_enabled = staff.get('gdrive_enabled', False)
            logger.info(f"Staff GDrive settings: enabled={gdrive_enabled}, folder_id={user_gdrive_folder_id}")

            if gdrive_enabled:
                # Priority 1: Check for OAuth tokens
                encrypted_refresh_token = staff.get('gdrive_oauth_refresh_token')
                logger.info(f"OAuth refresh token present: {bool(encrypted_refresh_token)}")
                if encrypted_refresh_token:
                    try:
                        oauth_tokens = {
                            'access_token': decrypt_text(staff.get('gdrive_oauth_access_token') or ''),
                            'refresh_token': decrypt_text(encrypted_refresh_token),
                            'token_expiry': staff.get('gdrive_oauth_token_expiry'),
                        }
                        logger.info(f"Successfully decrypted OAuth tokens, expiry: {oauth_tokens.get('token_expiry')}")
                    except Exception as e:
                        logger.warning(f"Failed to decrypt user OAuth tokens: {e}")

                # Priority 2: Check for Service Account JSON (only if no OAuth tokens)
                if not oauth_tokens:
                    encrypted_json = staff.get('gdrive_service_account_json')
                    if encrypted_json:
                        try:
                            user_gdrive_json = decrypt_text(encrypted_json)
                        except Exception as e:
                            logger.warning(f"Failed to decrypt user GDrive credentials: {e}")

        # Fall back to environment variables if user settings not available
        has_env_config = (
            settings.GDRIVE_SERVICE_ACCOUNT_FILE and
            settings.GDRIVE_ROOT_FOLDER_ID
        )

        if not oauth_tokens and not user_gdrive_json and not has_env_config:
            raise HTTPException(
                status_code=503,
                detail="Google Drive is not configured. "
                       "Please set up Google Drive in your Profile settings."
            )

        # Check if folder is selected (required for organized uploads)
        if not user_gdrive_folder_id and not settings.GDRIVE_ROOT_FOLDER_ID:
            raise HTTPException(
                status_code=400,
                detail="Google Drive folder not selected. "
                       "Please select a destination folder in your Profile settings."
            )

        # Check if export is already running
        cache = get_cache()
        export_key = f"{GDriveExportService.CACHE_KEY_PREFIX}:{job_id}"
        status_json = await cache.get(export_key)
        if status_json:
            try:
                status = json.loads(status_json)
                if status.get('status') == 'running':
                    return {
                        "success": False,
                        "message": "Export already in progress",
                        "status": "running"
                    }
            except (json.JSONDecodeError, TypeError, KeyError) as e:
                logger.warning(f"Failed to parse export status: {e}")

        # Count CompanyCam photos
        companycam_count = db.query(WMPhoto).filter(
            WMPhoto.job_id == job_id,
            WMPhoto.is_trashed.is_(False),
            WMPhoto.source == 'companycam'
        ).count()

        if companycam_count == 0:
            return {
                "success": False,
                "message": "No CompanyCam photos to export",
                "status": "idle"
            }

        # Set initial status
        await cache.set(export_key, json.dumps({
            'status': 'running',
            'total_photos': companycam_count,
            'uploaded_count': 0,
            'skipped_count': 0,
            'error_count': 0,
            'current_photo': 0,
            'current_filename': '',
            'errors': [],
            'message': 'Starting export to Google Drive...',
            'drive_folder_url': None
        }), ttl=3600)

        # Start background task with user credentials
        logger.info(f"Starting export with: oauth_tokens={bool(oauth_tokens)}, service_account={bool(user_gdrive_json)}, folder_id={user_gdrive_folder_id}")
        background_tasks.add_task(
            run_gdrive_export_in_background,
            job_id=job_id,
            service_account_json=user_gdrive_json,
            root_folder_id=user_gdrive_folder_id,
            oauth_tokens=oauth_tokens
        )

        return {
            "success": True,
            "message": f"Export started for {companycam_count} CompanyCam photos",
            "status": "running",
            "total_photos": companycam_count
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to start Google Drive export for job {job_id}: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


def run_gdrive_export_in_background(
    job_id: UUID,
    service_account_json: Optional[str] = None,
    root_folder_id: Optional[str] = None,
    oauth_tokens: Optional[Dict[str, Any]] = None
):
    """Background task to run Google Drive export (sync wrapper for async)"""
    import asyncio
    logger.info(f"Background Google Drive export task starting for job {job_id}")

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_run_gdrive_export_async(
            job_id,
            service_account_json=service_account_json,
            root_folder_id=root_folder_id,
            oauth_tokens=oauth_tokens
        ))
    finally:
        try:
            pending = asyncio.all_tasks(loop)
            for task in pending:
                task.cancel()
            if pending:
                loop.run_until_complete(
                    asyncio.gather(*pending, return_exceptions=True)
                )
        finally:
            loop.close()


async def _run_gdrive_export_async(
    job_id: UUID,
    service_account_json: Optional[str] = None,
    root_folder_id: Optional[str] = None,
    oauth_tokens: Optional[Dict[str, Any]] = None
):
    """Actual async export implementation"""
    from app.core.database_factory import get_database

    from .gdrive_export_service import GDriveExportService

    logger.info(f"Background Google Drive export started for job {job_id}")

    database = get_database()
    db_session = database.get_session()
    try:
        # Build OAuth credentials if tokens provided
        oauth_credentials = None
        if oauth_tokens and oauth_tokens.get('refresh_token'):
            try:
                from google.oauth2.credentials import Credentials
                from google.auth.transport.requests import Request
                from app.core.config import settings

                # Convert token_expiry to datetime if it's a string
                token_expiry = oauth_tokens.get('token_expiry')
                if token_expiry and isinstance(token_expiry, str):
                    from dateutil.parser import parse as parse_datetime
                    token_expiry = parse_datetime(token_expiry)

                oauth_credentials = Credentials(
                    token=oauth_tokens.get('access_token'),
                    refresh_token=oauth_tokens.get('refresh_token'),
                    token_uri="https://oauth2.googleapis.com/token",
                    client_id=settings.GOOGLE_OAUTH_CLIENT_ID,
                    client_secret=settings.GOOGLE_OAUTH_CLIENT_SECRET,
                    expiry=token_expiry,
                )

                # Refresh token if expired
                if oauth_credentials.expired and oauth_credentials.refresh_token:
                    oauth_credentials.refresh(Request())
                    logger.info("OAuth token refreshed during export")

                logger.info(f"Successfully built OAuth credentials for export")

            except Exception as e:
                logger.error(f"Failed to build OAuth credentials: {e}")
                import traceback
                logger.error(traceback.format_exc())

        export_service = GDriveExportService(
            db_session,
            service_account_json=service_account_json,
            root_folder_id=root_folder_id,
            oauth_credentials=oauth_credentials
        )
        result = await export_service.export_to_gdrive(job_id)
        db_session.commit()
        logger.info(f"Background export completed for job {job_id}: {result}")
    except Exception as e:
        logger.error(f"Background export failed for job {job_id}: {e}")
        import traceback
        logger.error(traceback.format_exc())
        db_session.rollback()
    finally:
        db_session.close()


@router.get("/jobs/{job_id}/export-to-gdrive/status")
async def get_gdrive_export_status(job_id: UUID):
    """
    Get current status of Google Drive photo export.

    Returns:
        Export status with progress information including:
        - status: 'idle', 'running', 'completed', 'cancelled', 'failed'
        - total_photos: Total CompanyCam photos to export
        - uploaded_count: Successfully uploaded count
        - skipped_count: Skipped due to duplicate filename
        - error_count: Failed uploads
        - current_photo: Current processing index
        - current_filename: Current file being processed
        - drive_folder_url: Google Drive folder URL (after first upload)
        - errors: List of last 10 error messages
    """
    from .gdrive_export_service import get_gdrive_export_status as get_status

    status = await get_status(job_id)
    if not status:
        return {
            'status': 'idle',
            'message': 'No export in progress'
        }

    return status


@router.post("/jobs/{job_id}/export-to-gdrive/cancel")
async def cancel_gdrive_export(job_id: UUID):
    """
    Cancel an ongoing Google Drive photo export.

    Returns:
        Confirmation message
    """
    from .gdrive_export_service import cancel_gdrive_export as cancel_export

    success = await cancel_export(job_id)

    if success:
        return {
            'success': True,
            'message': 'Cancellation requested. Export will stop after current photo.'
        }
    else:
        return {
            'success': False,
            'message': 'No export in progress to cancel or already completed'
        }
