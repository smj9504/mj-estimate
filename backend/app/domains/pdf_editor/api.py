"""
PDF Editor API endpoints
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.domains.auth.dependencies import get_current_user
from app.domains.pdf_editor.schemas import PDFEditRequest, PDFEditResponse
from app.domains.pdf_editor.service import PDFEditorService

router = APIRouter(prefix="/pdf-editor", tags=["PDF Editor"])
logger = logging.getLogger(__name__)


@router.post("/edit", response_model=PDFEditResponse)
async def edit_pdf(
    request: PDFEditRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Edit PDF with text operations (add, delete, modify)
    """
    try:
        service = PDFEditorService()
        
        # Get user ID
        user_id = str(current_user.get("id", ""))
        if not user_id:
            raise HTTPException(status_code=400, detail="User ID not found")

        result = service.edit_pdf(
            request=request,
            uploaded_by=user_id,
            context="pdf_editor",
            context_id=str(current_user.get("company_id", "default"))
        )

        return PDFEditResponse(**result)

    except ValueError as e:
        logger.error(f"Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error editing PDF: {e}", exc_info=True)
        msg = f"Failed to edit PDF: {str(e)}"
        raise HTTPException(status_code=500, detail=msg)


@router.post("/upload-and-edit")
async def upload_and_edit_pdf(
    file: UploadFile = File(...),
    request: Optional[str] = None,  # JSON string with edits
    current_user: dict = Depends(get_current_user)
):
    """
    Upload PDF and edit in one operation
    """
    try:
        import json

        from app.core.database_factory import get_database
        from app.domains.file.service import FileService

        # First upload the file
        file_service = FileService(get_database())
        file_content = await file.read()
        
        from io import BytesIO
        uploaded_file = await file_service.upload_file(
            file_data=BytesIO(file_content),
            original_filename=file.filename,
            content_type=file.content_type or "application/pdf",
            context="pdf_editor",
            context_id=str(current_user.get("company_id", "default")),
            category="pdf_upload",
            uploaded_by=str(current_user.get("id", ""))
        )
        file_service.repository.session.commit()

        # If edits provided, apply them
        if request:
            edit_request_data = json.loads(request)
            edit_request = PDFEditRequest(
                file_id=uploaded_file.get("id"),
                edits=edit_request_data.get("edits", [])
            )
            
            pdf_service = PDFEditorService()
            user_id = str(current_user.get("id", ""))
            company_id = str(
                current_user.get("company_id", "default")
            )
            result = pdf_service.edit_pdf(
                request=edit_request,
                uploaded_by=user_id,
                context="pdf_editor",
                context_id=company_id
            )
            return PDFEditResponse(**result)
        else:
            return PDFEditResponse(
                success=True,
                file_id=uploaded_file.get("id"),
                file_url=uploaded_file.get("url"),
                message="PDF uploaded successfully"
            )

    except Exception as e:
        logger.error(f"Error uploading/editing PDF: {e}", exc_info=True)
        msg = f"Failed to upload/edit PDF: {str(e)}"
        raise HTTPException(status_code=500, detail=msg)

