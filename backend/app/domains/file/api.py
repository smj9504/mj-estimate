"""
File API endpoints for file upload and management
"""

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Query
from fastapi.responses import FileResponse as FastAPIFileResponse
from typing import List, Optional
import logging
import mimetypes
from pathlib import Path

from .schemas import (
    FilesResponse, FileResponse, FileUploadRequest,
    FileCountResponse, CategoryListResponse, FileUpdate
)
from .service import FileService
from app.core.database_factory import get_database
from app.domains.auth.dependencies import get_current_staff
from app.domains.staff.models import Staff


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
        max_file_size = 20 * 1024 * 1024  # 20MB

        uploaded_files = []

        for file in files:
            # Validate file type
            if not service.validate_file_type(file.content_type, allowed_types):
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
                uploaded_by=current_staff.username if hasattr(current_staff, 'username') else str(current_staff.id)
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
    service: FileService = Depends(get_file_service)
):
    """Download a file by ID"""
    try:
        file_record = service.repository.get_by_id(file_id)
        if not file_record or not file_record.get('is_active', True):
            raise HTTPException(status_code=404, detail="File not found")

        file_path = Path(file_record['url'])
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="File not found on disk")

        # Determine media type
        media_type = file_record.get('content_type')
        if not media_type:
            media_type, _ = mimetypes.guess_type(str(file_path))
            media_type = media_type or 'application/octet-stream'

        return FastAPIFileResponse(
            path=str(file_path),
            filename=file_record['original_name'],
            media_type=media_type
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
        file_record = service.repository.get_by_id(file_id)
        if not file_record or not file_record.get('is_active', True):
            raise HTTPException(status_code=404, detail="File not found")

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

        # For PDFs and images, use inline display
        # For other files, use attachment (download)
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
    service: FileService = Depends(get_file_service),
    current_staff: Staff = Depends(get_current_staff)
):
    """Delete a file (soft delete by default)"""
    try:
        if hard_delete:
            success = service.hard_delete_file(file_id)
        else:
            success = service.delete_file(file_id)

        if not success:
            raise HTTPException(status_code=404, detail="File not found")

        return {"message": "File deleted successfully"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting file {file_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Delete failed: {str(e)}")