"""
File API endpoints for file upload and management
"""

import asyncio
import logging
import mimetypes
from pathlib import Path
from typing import Any, Dict, List, Optional
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse as FastAPIFileResponse
from fastapi.responses import RedirectResponse, Response
from starlette.background import BackgroundTask

from app.common.services.media_types import as_jpeg_name, is_heic, is_video, media_type_of
from app.core.database_factory import get_database
from app.domains.auth.dependencies import get_current_staff
from app.domains.staff.models import Staff

from . import thumbnails
from .repository import FileRepository
from .schemas import (
    CategoryListResponse,
    FileCountResponse,
    FileResponse,
    FilesResponse,
    FileUpdate,
    FileUploadRequest,
)
from .service import FileService
from .video_service import (
    MAX_VIDEO_UPLOAD_BYTES,
    OWNER_FILE,
    OWNER_WM_PHOTO,
    download_response,
    poster_response,
    queue_processing,
    video_fields,
    video_response,
)

router = APIRouter()
logger = logging.getLogger(__name__)

# What's stored under a file's id never changes, so a browser needn't ask twice
KEEP_IN_BROWSER = {"Cache-Control": "private, max-age=604800, immutable"}

# A page asks for all its thumbnails at once. Waiting here takes no thread, so other
# requests don't queue behind them. Reading one back is light; making one holds a whole
# photo in memory.
_thumbnail_read_slots = asyncio.Semaphore(8)
_thumbnail_make_slots = asyncio.Semaphore(3)


def get_file_service():
    """Dependency to get file service. Its session is closed here because nothing else
    would: left to the garbage collector, a page of thumbnails keeps every connection in
    the pool long after it has been answered, and all requests behind it fail."""
    service = FileService(get_database())
    try:
        yield service
    finally:
        service.repository.session.close()


@router.post("/upload", response_model=FilesResponse, response_model_by_alias=True)
async def upload_files(
    files: List[UploadFile] = File(...),
    context: str = Form(...),
    context_id: str = Form(...),
    category: str = Form("general"),
    description: Optional[str] = Form(None),
    service: FileService = Depends(get_file_service),
    current_staff: Staff = Depends(get_current_staff)
):
    """Upload one or more files"""
    try:
        # Validate file types and sizes
        allowed_types = ['image/*', 'video/*', 'application/pdf', 'application/msword',
                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        'application/vnd.ms-excel',
                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        'text/plain', 'text/csv']
        # Extensions allowed regardless of MIME type (e.g. Xactimate .esx)
        allowed_extensions = {'.esx', '.esc', '.exc'}
        max_file_size = 20 * 1024 * 1024  # 20MB

        uploaded_files = []

        for file in files:
            # Validate file type (by MIME type or extension)
            file_ext = Path(file.filename).suffix.lower() if file.filename else ''
            content_type = media_type_of(file.filename, file.content_type)
            if not service.validate_file_type(content_type, allowed_types) and file_ext not in allowed_extensions:
                raise HTTPException(
                    status_code=400,
                    detail=f"File type {content_type} not allowed for {file.filename}"
                )

            filename = file.filename
            if is_video(content_type):
                # Off the disk spool UploadFile wrote it to: an iPhone clip doesn't
                # fit in this server's memory
                if file.size and file.size > MAX_VIDEO_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=400,
                        detail=f"File {filename} exceeds the {MAX_VIDEO_UPLOAD_BYTES // 1024 ** 3}GB limit for a video"
                    )
                file_data = file.file
            else:
                # Read file content and validate size
                file_content = await file.read()
                if not service.validate_file_size(len(file_content), max_file_size):
                    raise HTTPException(
                        status_code=400,
                        detail=f"File {filename} exceeds maximum size of 20MB"
                    )

                # Windows and Chrome can't show an iPhone's HEIC, so it isn't stored as one
                if is_heic(content_type):
                    from app.domains.storage.optimization import heic_to_jpeg
                    try:
                        file_content = await asyncio.to_thread(heic_to_jpeg, file_content)
                    except Exception as e:
                        raise HTTPException(status_code=400, detail=f"{filename} could not be read as a photo: {e}")
                    filename = as_jpeg_name(filename)
                    content_type = 'image/jpeg'

                # Reset file pointer for upload
                from io import BytesIO
                file_data = BytesIO(file_content)

            # Upload file
            uploaded_file = await service.upload_file(
                file_data=file_data,
                original_filename=filename,
                content_type=content_type,
                context=context,
                context_id=context_id,
                category=category,
                description=description,
                uploaded_by=str(current_staff.id)
            )

            uploaded_files.append(uploaded_file)

        # Commit transaction to save files to database
        service.repository.session.commit()
        logger.info(f"✅ Transaction committed for {len(uploaded_files)} file(s)")

        for uploaded in uploaded_files:
            if is_video(uploaded.get('content_type')):
                queue_processing(OWNER_WM_PHOTO if context == 'water-mitigation' else OWNER_FILE, uploaded['id'])

        # Convert dict to FileResponse models for proper alias generation
        file_responses = [FileResponse(**file_dict) for file_dict in uploaded_files]

        logger.info(f"Successfully uploaded {len(file_responses)} file(s)")

        return FilesResponse(
            data=file_responses,
            total=len(file_responses),
            message=f"Successfully uploaded {len(file_responses)} file(s)"
        )

    except HTTPException:
        service.repository.session.rollback()
        logger.error("❌ Transaction rolled back due to HTTPException")
        raise
    except Exception as e:
        service.repository.session.rollback()
        logger.error(f"❌ Transaction rolled back due to error: {e}")
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@router.api_route("/video/{file_id}", methods=["GET", "HEAD"])
def play_video(file_id: str, request: Request):
    """A video for a <video> element, which can't send a token and asks for ranges
    of it. Open like the preview and download routes below it."""
    return video_response(request, OWNER_FILE, file_id)


@router.get("/download/{file_id}")
def download_file(
    file_id: str,
    request: Request,
    inline: bool = Query(False, description="If true, display in browser instead of downloading"),
    service: FileService = Depends(get_file_service)
):
    """Download a file by ID (supports both local and cloud storage).
    Use ?inline=true to open in browser tab instead of downloading.
    """
    try:
        from app.domains.storage.factory import StorageFactory

        file_record = service.repository.get_by_id(file_id)
        # The rest waits on storage, which is no time to sit on a connection
        service.repository.session.close()
        if not file_record or not file_record.get('is_active', True):
            raise HTTPException(status_code=404, detail="File not found")

        if is_video(file_record.get('content_type')):
            return (video_response if inline else download_response)(request, OWNER_FILE, file_id)

        file_url = file_record.get('url', '')
        storage_provider = file_record.get('storage_provider')

        # Determine media type
        media_type = file_record.get('content_type')
        if not media_type:
            media_type, _ = mimetypes.guess_type(file_record.get('original_name', ''))
            media_type = media_type or 'application/octet-stream'

        disposition = "inline" if inline else "attachment"
        filename = file_record["original_name"]

        if thumbnails.stored_in_cloud(file_record):
            # Pass the record's own provider so a file stored under a
            # different provider than the currently-configured default
            # still resolves correctly (common during a provider migration).
            storage = StorageFactory.get_instance(storage_provider)
            # Get file from storage provider
            try:
                file_data = storage.download(file_url)
                return Response(
                    content=file_data,
                    media_type=media_type,
                    headers={
                        "Content-Disposition": f'{disposition}; filename="{filename}"',
                        **(KEEP_IN_BROWSER if inline else {}),
                    },
                )
            except Exception as e:
                logger.error(f"Error downloading file from storage: {e}")
                raise HTTPException(status_code=404, detail=f"File not accessible: {str(e)}")

        # Local file handling
        file_path = Path(file_record['url'])
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="File not found on disk")

        return FastAPIFileResponse(
            path=str(file_path),
            filename=file_record['original_name'],
            media_type=media_type,
            headers={"Content-Disposition": f'{disposition}; filename="{filename}"'}
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error downloading file {file_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Download failed: {str(e)}")


def _read_file_record(file_id: str) -> Optional[Dict[str, Any]]:
    """Off a session that's gone again at once. Call this on a worker thread: waiting for
    a connection on the event loop stops the very requests that could hand one back."""
    session = get_database().get_session()
    try:
        return FileRepository(session).get_by_id(file_id)
    finally:
        session.close()


@router.get("/thumbnail/{file_id}")
async def file_thumbnail(file_id: str):
    """The small picture for a grid: a photo's thumbnail or a video's poster. Open like
    the routes around it, since an <img> can't send a token."""
    try:
        file_id = str(uuid.UUID(file_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="File not found")

    record = await asyncio.to_thread(_read_file_record, file_id)
    if not record or not record.get('is_active', True):
        raise HTTPException(status_code=404, detail="File not found")

    content_type = record.get('content_type') or ''
    if is_video(content_type):
        return await asyncio.to_thread(poster_response, OWNER_FILE, file_id)
    if not content_type.startswith('image/'):
        return RedirectResponse(url=f"../preview/{file_id}", status_code=302)

    cached = thumbnails.cache_path(file_id)
    if cached.exists():
        return FastAPIFileResponse(path=str(cached), media_type='image/jpeg', headers=KEEP_IN_BROWSER)

    async with _thumbnail_read_slots:
        kept = await asyncio.to_thread(thumbnails.read_kept, record)
    if kept:
        return Response(content=kept, media_type='image/jpeg', headers=KEEP_IN_BROWSER)

    async with _thumbnail_make_slots:
        made = await asyncio.to_thread(thumbnails.make, record)
    if not made:
        return RedirectResponse(url=f"../preview/{file_id}", status_code=302)
    return Response(
        content=made,
        media_type='image/jpeg',
        headers=KEEP_IN_BROWSER,
        background=BackgroundTask(thumbnails.keep, file_id, record.get('storage_provider'), made),
    )


@router.get("/preview/{file_id}")
def preview_file(
    file_id: str,
    service: FileService = Depends(get_file_service)
):
    """Get file preview (for images, returns thumbnail if available)"""
    try:
        from app.domains.storage.factory import StorageFactory

        file_record = service.repository.get_by_id(file_id)
        # The rest waits on storage, and a page of thumbnails asks for dozens at once
        service.repository.session.close()
        if not file_record or not file_record.get('is_active', True):
            raise HTTPException(status_code=404, detail="File not found")

        if is_video(file_record.get('content_type')):
            return poster_response(OWNER_FILE, file_id)

        file_url = file_record.get('url', '')
        storage_provider = file_record.get('storage_provider')

        if thumbnails.stored_in_cloud(file_record):
            # Pass the record's own provider so a file stored under a
            # different provider than the currently-configured default
            # still resolves correctly (common during a provider migration).
            storage = StorageFactory.get_instance(storage_provider)
            # Get file from storage provider
            try:
                # For images, try thumbnail first
                if (file_record.get('content_type', '').startswith('image/') and
                    file_record.get('thumbnail_url')):
                    thumb_url = file_record['thumbnail_url']
                    if thumb_url.startswith('gs://') or thumb_url.startswith('b2://') or thumb_url.startswith('http'):
                        file_data = storage.download(thumb_url)
                        return Response(
                            content=file_data,
                            media_type='image/jpeg',
                            headers={"Content-Disposition": "inline", **KEEP_IN_BROWSER},
                        )

                # Download original file
                file_data = storage.download(file_url)
                media_type = file_record.get('content_type', 'application/octet-stream')
                # Stored before uploads were converted: browsers can't show it as it is
                if is_heic(media_type):
                    from app.domains.storage.optimization import heic_to_jpeg
                    file_data = heic_to_jpeg(file_data)
                    media_type = 'image/jpeg'
                content_disposition = "inline" if media_type.startswith('image/') or media_type == 'application/pdf' else "attachment"

                return Response(
                    content=file_data,
                    media_type=media_type,
                    headers={"Content-Disposition": content_disposition, **KEEP_IN_BROWSER},
                )
            except Exception as e:
                logger.error(f"Error downloading file from storage: {e}")
                raise HTTPException(status_code=404, detail=f"File not accessible: {str(e)}")

        # Local file handling (existing logic)
        # For images, try to return thumbnail first
        if (file_record.get('content_type', '').startswith('image/') and
            file_record.get('thumbnail_url')):
            thumb_path = Path(file_record['thumbnail_url'])
            if thumb_path.exists():
                return FastAPIFileResponse(
                    path=str(thumb_path),
                    media_type='image/jpeg',
                    headers={"Content-Disposition": "inline"}
                )

        # Otherwise return the original file
        file_path = Path(file_record['url'])
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="File not found on disk")

        media_type = file_record.get('content_type', 'application/octet-stream')
        content_disposition = "inline" if media_type in ['application/pdf'] or media_type.startswith('image/') else "attachment"

        return FastAPIFileResponse(
            path=str(file_path),
            media_type=media_type,
            headers={"Content-Disposition": content_disposition}
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error previewing file {file_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Preview failed: {str(e)}")


@router.get("/wm-photo/{photo_id}/preview")
def preview_wm_photo(
    photo_id: str,
    service: FileService = Depends(get_file_service)
):
    """Get water mitigation photo preview"""
    try:
        from app.domains.water_mitigation.repository import WMPhotoRepository

        wm_photo_repo = WMPhotoRepository(service.repository.session)
        photo = wm_photo_repo.get_by_id(photo_id)

        if not photo:
            raise HTTPException(status_code=404, detail="Photo not found")

        # Get file path and storage info
        file_path_str = photo.get('file_path') if isinstance(photo, dict) else photo.file_path
        storage_provider = (photo.get('storage_provider') if isinstance(photo, dict) else getattr(photo, 'storage_provider', None)) or 'local'
        storage_file_id = (photo.get('storage_file_id') if isinstance(photo, dict) else getattr(photo, 'storage_file_id', None)) or ''
        mime_type = (photo.get('mime_type') if isinstance(photo, dict) else photo.mime_type) or 'image/jpeg'
        service.repository.session.close()

        # Cloud storage
        if storage_provider not in ('local', ''):
            try:
                from app.domains.storage.factory import StorageFactory
                storage = StorageFactory.get_instance(storage_provider)
                download_key = storage_file_id or file_path_str
                file_bytes = storage.download(download_key)
                return Response(
                    content=file_bytes,
                    media_type=mime_type,
                    headers={"Content-Disposition": "inline"}
                )
            except Exception as e:
                logger.warning(f"Cloud download failed for WM photo {photo_id}: {e}")

        # Fallback to local
        file_path = Path(file_path_str)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Photo file not found")

        return FastAPIFileResponse(
            path=str(file_path),
            media_type=mime_type,
            headers={"Content-Disposition": "inline"}
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error previewing WM photo {photo_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Preview failed: {str(e)}")


@router.get("/{context}/{context_id}", response_model=FilesResponse, response_model_by_alias=True)
def get_files(
    context: str,
    context_id: str,
    category: Optional[str] = Query(None, description="Filter by category"),
    file_type: Optional[str] = Query(None, description="Filter by file type (image/document)"),
    search: Optional[str] = Query(None, description="Search query"),
    is_active: bool = Query(True, description="Filter by active status"),
    service: FileService = Depends(get_file_service)
):
    """Get files by context and context_id"""
    try:
        logger.info(f"📥 GET request - context={context}, context_id={context_id}, file_type={file_type}, is_active={is_active}")

        if search:
            file_dicts = service.search_files(context, context_id, search, is_active)
        elif file_type:
            file_dicts = service.get_files_by_type(context, context_id, file_type, is_active)
        else:
            file_dicts = service.get_files_by_context(context, context_id, category, is_active)

        logger.info(f"📊 Retrieved {len(file_dicts) if file_dicts else 0} file dicts from repository")
        if file_dicts:
            logger.info(f"📄 First file dict keys: {list(file_dicts[0].keys())}")
            logger.info(f"📄 First file dict: {file_dicts[0]}")

        # Ensure files is always a list
        if file_dicts is None:
            file_dicts = []

        # A job's videos are in wm_photos and listed through the job's own routes
        if context != 'water-mitigation':
            videos = video_fields(OWNER_FILE, [str(f['id']) for f in file_dicts if is_video(f.get('content_type'))])
            for file_dict in file_dicts:
                file_dict.update(videos.get(str(file_dict['id']), {}))

        # Convert dict to FileResponse models for proper alias generation
        files = [FileResponse(**file_dict) for file_dict in file_dicts]

        logger.info(f"✅ Returning {len(files)} files for context={context}, context_id={context_id}, file_type={file_type}")

        return FilesResponse(data=files, total=len(files))

    except Exception as e:
        logger.error(f"❌ Error retrieving files for context={context}, context_id={context_id}, file_type={file_type}: {e}")
        logger.exception(e)
        # Return empty result instead of error for non-existent data
        return FilesResponse(data=[], total=0)


@router.get("/{context}/{context_id}/count", response_model=FileCountResponse)
def get_file_count(
    context: str,
    context_id: str,
    category: Optional[str] = Query(None, description="Filter by category"),
    file_type: Optional[str] = Query(None, description="Filter by file type (image/document)"),
    is_active: bool = Query(True, description="Filter by active status"),
    service: FileService = Depends(get_file_service)
):
    """Get file count by context and context_id"""
    try:
        if file_type:
            count = service.get_file_count_by_type(context, context_id, file_type, is_active)
        else:
            count = service.get_file_count(context, context_id, category, is_active)

        # Ensure count is always a number
        if count is None:
            count = 0

        return FileCountResponse(
            count=count,
            context=context,
            context_id=context_id,
            category=category
        )

    except Exception as e:
        logger.error(f"Error getting file count for context={context}, context_id={context_id}, file_type={file_type}: {e}")
        # Return zero count instead of error for non-existent data
        return FileCountResponse(
            count=0,
            context=context,
            context_id=context_id,
            category=category
        )


@router.get("/{context}/{context_id}/categories", response_model=CategoryListResponse)
def get_categories(
    context: str,
    context_id: str,
    is_active: bool = Query(True, description="Filter by active status"),
    service: FileService = Depends(get_file_service)
):
    """Get available categories for a context"""
    try:
        categories = service.get_categories(context, context_id, is_active)

        # Ensure categories is always a list
        if categories is None:
            categories = []

        return CategoryListResponse(
            categories=categories,
            context=context
        )

    except Exception as e:
        logger.error(f"Error getting categories for context={context}, context_id={context_id}: {e}")
        # Return empty categories instead of error for non-existent data
        return CategoryListResponse(
            categories=[],
            context=context
        )


@router.put("/{file_id}", response_model=FileResponse)
def update_file_metadata(
    file_id: str,
    file_update: FileUpdate,
    service: FileService = Depends(get_file_service),
    current_staff: Staff = Depends(get_current_staff)
):
    """Update file metadata"""
    try:
        updated_file = service.update_file_metadata(file_id, file_update)
        if not updated_file:
            raise HTTPException(status_code=404, detail="File not found")

        return FileResponse(**updated_file)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating file {file_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Update failed: {str(e)}")


@router.delete("/{file_id}")
def delete_file(
    file_id: str,
    hard_delete: bool = Query(False, description="Permanently delete file"),
    context: Optional[str] = Query(None, description="File context (for special handling)"),
    service: FileService = Depends(get_file_service),
    current_staff: Staff = Depends(get_current_staff)
):
    """Delete a file (soft delete by default)"""
    try:
        if hard_delete:
            success = service.hard_delete_file(file_id)
        else:
            success = service.delete_file(file_id, context)

        if not success:
            raise HTTPException(status_code=404, detail="File not found")

        return {"message": "File deleted successfully"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting file {file_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Delete failed: {str(e)}")