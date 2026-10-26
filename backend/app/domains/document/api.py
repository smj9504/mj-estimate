"""
Document API endpoints (combined estimates and invoices)
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from typing import Optional
import io
import uuid
from app.core.database_factory import get_db_session as get_db
from app.domains.auth.company_scope import document_condition, require_document
from app.domains.auth.dependencies import get_current_staff
from app.domains.auth.document_access import owner_to_list, require_document_access
from app.domains.document.schemas import Document, DocumentFilter, PaginatedDocuments
from app.domains.document.service import DocumentService
from app.domains.estimate.models import Estimate
from app.domains.invoice.models import Invoice

router = APIRouter()


def _visible(db, current_staff) -> dict:
    """The estimates and invoices this person's companies may see, as SQL conditions"""
    return {
        'estimate_scope': document_condition(db, current_staff, Estimate.claim_id, Estimate.company_id),
        'invoice_scope': document_condition(db, current_staff, Invoice.claim_id, Invoice.company_id),
    }


def require_document_row_access(
    document_id: str,
    current_staff=Depends(get_current_staff),
    db=Depends(get_db),
):
    """The signed-in person, if they may open this estimate or invoice (404 otherwise)"""
    not_found = HTTPException(status_code=404, detail="Document not found")
    try:
        uuid.UUID(str(document_id))
    except ValueError:
        raise not_found
    # The service looks an id up as an invoice first, then as an estimate
    model = next(
        (m for m in (Invoice, Estimate) if db.query(m.id).filter(m.id == str(document_id)).first()),
        None,
    )
    if model is None:
        raise not_found
    require_document_access(db, model, document_id, current_staff, "Document")
    require_document(db, current_staff, model, document_id, "Document")
    return current_staff


@router.get("/", response_model=PaginatedDocuments)
def get_documents(
    type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    scope: str = Query('mine'),
    current_staff=Depends(get_current_staff),
    db=Depends(get_db),
):
    """Get the signed-in person's documents with filters and pagination
    (a super admin may ask for scope=all)"""
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
        
        result = service.get_documents(
            filter_params, page, pageSize,
            owner_id=owner_to_list(current_staff, scope),
            **_visible(db, current_staff),
        )
        logger.info(f"Documents retrieved: total={result.total}, items={len(result.items)}")
        return result
    except Exception as e:
        logger.error(f"Error getting documents: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise

@router.get("/{document_id}")
def get_document(document_id: str, _staff=Depends(require_document_row_access)):
    """Get single document by ID"""
    service = DocumentService()
    document = service.get_document(document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"data": document}

@router.delete("/{document_id}")
def delete_document(document_id: str, _staff=Depends(require_document_row_access)):
    """Delete document"""
    service = DocumentService()
    success = service.delete_document(document_id)
    if not success:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"message": "Document deleted successfully"}

@router.post("/{document_id}/duplicate")
def duplicate_document(document_id: str, _staff=Depends(require_document_row_access)):
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
def generate_pdf(document_id: str, _staff=Depends(require_document_row_access)):
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
def send_document(document_id: str, email: str, _staff=Depends(require_document_row_access)):
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
def export_documents(
    filter_params: DocumentFilter,
    scope: str = Query('mine'),
    current_staff=Depends(get_current_staff),
    db=Depends(get_db),
):
    """Export the signed-in person's documents to Excel (a super admin may ask for scope=all)"""
    service = DocumentService()
    try:
        excel_bytes = service.export_to_excel(
            filter_params,
            owner_id=owner_to_list(current_staff, scope),
            **_visible(db, current_staff),
        )
        
        return StreamingResponse(
            io.BytesIO(excel_bytes),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": "attachment; filename=documents_export.xlsx"
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))