"""
API endpoints for Plumber Reports
"""

from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import FileResponse, StreamingResponse
import json
import io

from app.core.database_factory import get_db_session as get_db
from app.domains.auth.dependencies import get_current_staff
from app.domains.staff.models import Staff
from app.domains.plumber_report.schemas import (
    PlumberReportCreate,
    PlumberReportUpdate,
    PlumberReportResponse,
    PlumberReportListResponse,
    PlumberReportPDFRequest
)
from app.domains.plumber_report.service import PlumberReportService
from app.common.services.pdf_service import PDFService
from sqlalchemy.orm import Session

router = APIRouter()


@router.post("/", response_model=PlumberReportResponse)
async def create_plumber_report(
    report: PlumberReportCreate,
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff)
):
    """Create a new plumber report"""
    try:
        db_report = PlumberReportService.create_report(
            db=db,
            report_data=report,
            created_by=str(current_staff.id)
        )
        return PlumberReportResponse.from_orm(db_report)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/", response_model=PlumberReportListResponse)
async def get_plumber_reports(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """Get list of plumber reports"""
    reports = PlumberReportService.get_reports(
        db=db,
        skip=skip,
        limit=limit,
        status=status,
        search=search
    )
    
    total = PlumberReportService.get_report_count(
        db=db,
        status=status,
        search=search
    )
    
    return PlumberReportListResponse(
        reports=[PlumberReportResponse.from_orm(r) for r in reports],
        total=total,
        page=skip // limit + 1,
        limit=limit
    )


@router.get("/{report_id}", response_model=PlumberReportResponse)
async def get_plumber_report(
    report_id: UUID,
    db: Session = Depends(get_db)
):
    """Get a single plumber report"""
    report = PlumberReportService.get_report(db, report_id)
    
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    return PlumberReportResponse.from_orm(report)


@router.put("/{report_id}", response_model=PlumberReportResponse)
async def update_plumber_report(
    report_id: UUID,
    report_update: PlumberReportUpdate,
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff)
):
    """Update a plumber report"""
    updated_report = PlumberReportService.update_report(
        db=db,
        report_id=report_id,
        report_update=report_update,
        updated_by=str(current_staff.id)
    )
    
    if not updated_report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    return PlumberReportResponse.from_orm(updated_report)


@router.delete("/{report_id}")
async def delete_plumber_report(
    report_id: UUID,
    db: Session = Depends(get_db)
):
    """Delete a plumber report"""
    success = PlumberReportService.delete_report(db, report_id)
    
    if not success:
        raise HTTPException(status_code=404, detail="Report not found")
    
    return {"message": "Report deleted successfully"}


@router.post("/{report_id}/upload-photo")
async def upload_report_photo(
    report_id: UUID,
    file: UploadFile = File(...),
    category: str = Form(...),
    caption: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    """Upload a photo for a plumber report"""
    # TODO: Implement file upload to storage service
    # For now, return mock response
    return {
        "id": "photo_123",
        "url": f"/api/photos/{report_id}/photo_123.jpg",
        "category": category,
        "caption": caption
    }


@router.post("/{report_id}/generate-pdf")
async def generate_pdf(
    report_id: UUID,
    db: Session = Depends(get_db)
):
    """Generate PDF for a plumber report"""
    report = PlumberReportService.get_report(db, report_id)
    
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    try:
        # Convert report to dict for PDF generation
        report_dict = report.to_dict()
        
        # Generate PDF using PDF service
        pdf_bytes = PDFService.generate_plumber_report_pdf(report_dict)
        
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"attachment; filename=plumber_report_{report.report_number}.pdf"
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")


@router.post("/preview-pdf")
async def preview_pdf(
    pdf_request: PlumberReportPDFRequest
):
    """Preview PDF without saving (for draft preview)"""
    try:
        # Convert request to dict for PDF generation
        report_dict = pdf_request.report_data.dict()
        
        # Generate PDF
        pdf_bytes = PDFService.generate_plumber_report_pdf(
            report_dict,
            include_photos=pdf_request.include_photos,
            include_financial=pdf_request.include_financial
        )
        
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={
                "Content-Disposition": "inline; filename=preview.pdf"
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF preview failed: {str(e)}")


@router.get("/{report_id}/duplicate")
async def duplicate_report(
    report_id: UUID,
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff)
):
    """Duplicate an existing plumber report"""
    original_report = PlumberReportService.get_report(db, report_id)
    
    if not original_report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    # Create a copy with new report number
    report_dict = original_report.to_dict()
    report_dict.pop("id")
    report_dict.pop("created_at")
    report_dict.pop("updated_at")
    report_dict["report_number"] = PlumberReportService.generate_report_number()
    report_dict["status"] = "draft"
    
    # Convert dict to create schema
    create_data = PlumberReportCreate(**report_dict)
    
    new_report = PlumberReportService.create_report(
        db=db,
        report_data=create_data,
        created_by=str(current_staff.id)
    )
    
    return PlumberReportResponse.from_orm(new_report)