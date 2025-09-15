"""
Document API endpoints (combined estimates and invoices)
"""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from typing import Optional
import io
from app.domains.document.schemas import Document, DocumentFilter, PaginatedDocuments
from app.domains.document.service import DocumentService

router = APIRouter()

@router.get("/", response_model=PaginatedDocuments)
async def get_documents(
    type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100)
):
    """Get documents with filters and pagination"""
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        logger.info(f"Getting documents with filters: type={type}, status={status}, page={page}, pageSize={pageSize}")
        # Don't pass db to DocumentService, it will get its own database provider
        service = DocumentService()
        
        filter_params = DocumentFilter(
            type=type,
            status=status,
            company_id=company_id,
            date_from=date_from,
            date_to=date_to,
            search=search
        )
        
        result = service.get_documents(filter_params, page, pageSize)
        logger.info(f"Documents retrieved: total={result.total}, items={len(result.items)}")
        return result
    except Exception as e:
        logger.error(f"Error getting documents: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise

@router.get("/{document_id}")
async def get_document(document_id: str):
    """Get single document by ID"""
    service = DocumentService()
    document = service.get_document(document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"data": document}

@router.delete("/{document_id}")
async def delete_document(document_id: str):
    """Delete document"""
    service = DocumentService()
    success = service.delete_document(document_id)
    if not success:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"message": "Document deleted successfully"}

@router.post("/{document_id}/duplicate")
async def duplicate_document(document_id: str):
    """Duplicate document"""
    service = DocumentService()
    try:
        new_document = service.duplicate_document(document_id)
        if not new_document:
            raise HTTPException(status_code=404, detail="Document not found")
        return {"data": new_document, "message": "Document duplicated successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/{document_id}/pdf")
async def generate_pdf(document_id: str):
    """Generate PDF for document"""
    service = DocumentService()
    
    try:
        pdf_bytes = service.generate_pdf(document_id)
        if not pdf_bytes:
            raise HTTPException(status_code=404, detail="Document not found")
        
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"attachment; filename=document_{document_id}.pdf"
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{document_id}/send")
async def send_document(document_id: str, email: str):
    """Send document via email"""
    service = DocumentService()
    try:
        success = service.send_document(document_id, email)
        if not success:
            raise HTTPException(status_code=404, detail="Document not found")
        return {"message": f"Document sent to {email}"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/export")
async def export_documents(filter_params: DocumentFilter):
    """Export documents to Excel"""
    service = DocumentService()
    try:
        excel_bytes = service.export_to_excel(filter_params)
        
        return StreamingResponse(
            io.BytesIO(excel_bytes),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": "attachment; filename=documents_export.xlsx"
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))