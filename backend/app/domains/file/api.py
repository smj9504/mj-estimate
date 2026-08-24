"""
File API endpoints for file upload and management
"""

import io
import logging
import mimetypes
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse as FastAPIFileResponse

from app.core.database_factory import get_database
from app.domains.auth.dependencies import get_current_staff
from app.domains.staff.models import Staff

from .schemas import (
    CategoryListResponse,
    FileCountResponse,
    FileResponse,
    FilesResponse,
    FileUpdate,
    FileUploadRequest,
)
from .service import FileService

router = APIRouter()
logger = logging.getLogger(__name__)


def get_file_service():
    """Dependency to get file service"""
    return FileService(get_database())


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
        allowed_types = ['image/*', 'application/pdf', 'application/msword',
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
            if not service.validate_file_type(file.content_type, allowed_types) and file_ext not in allowed_extensions:
                raise HTTPException(
                    status_code=400,
                    detail=f"File type {file.content_type} not allowed for {file.filename}"
                )

            # Read file content and validate size
            file_content = await file.read()
            if not service.validate_file_size(len(file_content), max_file_size):
                raise HTTPException(
                    status_code=400,
                    detail=f"File {file.filename} exceeds maximum size of 20MB"
                )

            # Reset file pointer for upload
            from io import BytesIO
            file_data = BytesIO(file_content)

            # Upload file
            uploaded_file = await service.upload_file(
                file_data=file_data,
                original_filename=file.filename,
                content_type=file.content_type,
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


@router.get("/download/{file_id}")
async def download_file(
    file_id: str,
    inline: bool = Query(False, description="If true, display in browser instead of downloading"),
    service: FileService = Depends(get_file_service)
):
    """Download a file by ID (supports both local and cloud storage).
    Use ?inline=true to open in browser tab instead of downloading.
    """
    try:
        from fastapi.responses import StreamingResponse

        from app.domains.file.service import get_storage_provider

        file_record = service.repository.get_by_id(file_id)
        if not file_record or not file_record.get('is_active', True):
            raise HTTPException(status_code=404, detail="File not found")

        file_url = file_record.get('url', '')
        storage = get_storage_provider()

        # Determine media type
        media_type = file_record.get('content_type')
        if not media_type:
            media_type, _ = mimetypes.guess_type(file_record.get('original_name', ''))
            media_type = media_type or 'application/octet-stream'

        disposition = "inline" if inline else "attachment"
        filename = file_record["original_name"]

        # Check if file is in cloud storage (gs://, b2://, or other remote URL)
        if file_url.startswith('gs://') or file_url.startswith('b2://') or file_url.startswith('https://') or file_url.startswith('http://'):
            # Get file from storage provider
            try:
                file_data = storage.download(file_url)
                return StreamingResponse(
                    io.BytesIO(file_data),
                    media_type=media_type,
                    headers={"Content-Disposition": f'{disposition}; filename="{filename}"'}
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


@router.get("/preview/{file_id}")
async def preview_file(
    file_id: str,
    service: FileService = Depends(get_file_service)
):
    """Get file preview (for images, returns thumbnail if available)"""
    try:
        from fastapi.responses import StreamingResponse

        from app.domains.file.service import get_storage_provider

        file_record = service.repository.get_by_id(file_id)
        if not file_record or not file_record.get('is_active', True):
            raise HTTPException(status_code=404, detail="File not found")

        file_url = file_record.get('url', '')
        storage = get_storage_provider()

        # Check if file is in cloud storage (gs://, b2://, or other remote URL)
        if file_url.startswith('gs://') or file_url.startswith('b2://') or file_url.startswith('https://') or file_url.startswith('http://'):
            # Get file from storage provider
            try:
                # For images, try thumbnail first
                if (file_record.get('content_type', '').startswith('image/') and
                    file_record.get('thumbnail_url')):
                    thumb_url = file_record['thumbnail_url']
                    if thumb_url.startswith('gs://') or thumb_url.startswith('b2://') or thumb_url.startswith('http'):
                        file_data = storage.download(thumb_url)
                        return StreamingResponse(
                            io.BytesIO(file_data),
                            media_type='image/jpeg',
                            headers={"Content-Disposition": "inline"}
                        )

                # Download original file
                file_data = storage.download(file_url)
                media_type = file_record.get('content_type', 'application/octet-stream')
                content_disposition = "inline" if media_type.startswith('image/') or media_type == 'application/pdf' else "attachment"

                return StreamingResponse(
                    io.BytesIO(file_data),
                    media_type=media_type,
                    headers={"Content-Disposition": content_disposition}
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
async def preview_wm_photo(
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

        # Cloud storage
        if storage_provider not in ('local', ''):
            try:
                from app.domains.storage.factory import StorageFactory
                storage = StorageFactory.get_instance(storage_provider)
                download_key = storage_file_id or file_path_str
                file_bytes = storage.download(download_key)
                from starlette.responses import Response
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
async def get_files(
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
async def get_file_count(
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
async def get_categories(
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
async def update_file_metadata(
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
async def delete_file(
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