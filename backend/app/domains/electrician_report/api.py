"""
API endpoints for Electrician Inspection Reports
"""

from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import StreamingResponse, HTMLResponse
from pydantic import BaseModel as PydanticBaseModel
import io
import logging

from app.core.database_factory import get_db_session as get_db
from app.domains.auth.dependencies import get_current_staff
from app.domains.staff.models import Staff
from app.domains.electrician_report.schemas import (
    ElectricianReportCreate,
    ElectricianReportUpdate,
    ElectricianReportResponse,
    ElectricianReportListResponse,
    ElectricianReportPDFRequest,
    ElectricianReportNumberResponse
)
from app.domains.electrician_report.service import ElectricianReportService
from app.common.services.pdf_service import PDFService
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/generate-number", response_model=ElectricianReportNumberResponse)
async def generate_report_number(
    company_id: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """Generate next ELC report number"""
    try:
        report_number = ElectricianReportService.generate_report_number_with_company(
            db=db, company_id=company_id
        )
        return ElectricianReportNumberResponse(report_number=report_number)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate report number: {str(e)}")


@router.post("/", response_model=ElectricianReportResponse)
async def create_electrician_report(
    report: ElectricianReportCreate,
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff)
):
    """Create a new electrician report"""
    try:
        db_report = ElectricianReportService.create_report(
            db=db, report_data=report, created_by=str(current_staff.id)
        )
    except Exception as e:
        logger.error(f"Failed to create electrician report: {type(e).__name__}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create report: {str(e)}")

    try:
        return ElectricianReportResponse.model_validate(db_report.to_dict())
    except Exception as e:
        logger.error(f"Report created but serialization failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Report created but response serialization failed: {str(e)}")


@router.get("/", response_model=ElectricianReportListResponse)
async def get_electrician_reports(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """Get list of electrician reports"""
    reports = ElectricianReportService.get_reports(db=db, skip=skip, limit=limit, status=status, search=search)
    total = ElectricianReportService.get_report_count(db=db, status=status, search=search)

    return ElectricianReportListResponse(
        reports=[ElectricianReportResponse.model_validate(r.to_dict()) for r in reports],
        total=total,
        page=skip // limit + 1,
        limit=limit
    )


@router.get("/{report_id}", response_model=ElectricianReportResponse)
async def get_electrician_report(
    report_id: UUID,
    db: Session = Depends(get_db)
):
    """Get a single electrician report"""
    report = ElectricianReportService.get_report(db, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    claim_id = ElectricianReportService.get_claim_id_for_report(db, report_id)
    return ElectricianReportResponse.model_validate(report.to_dict(claim_id=claim_id))


@router.put("/{report_id}", response_model=ElectricianReportResponse)
async def update_electrician_report(
    report_id: UUID,
    report_update: ElectricianReportUpdate,
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff)
):
    """Update an electrician report"""
    updated_report = ElectricianReportService.update_report(
        db=db, report_id=report_id, report_update=report_update, updated_by=str(current_staff.id)
    )
    if not updated_report:
        raise HTTPException(status_code=404, detail="Report not found")
    return ElectricianReportResponse.model_validate(updated_report.to_dict())


@router.delete("/{report_id}")
async def delete_electrician_report(
    report_id: UUID,
    db: Session = Depends(get_db)
):
    """Delete an electrician report"""
    success = ElectricianReportService.delete_report(db, report_id)
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
    """Upload a photo for an electrician report"""
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
    """Generate PDF for an electrician report"""
    report = ElectricianReportService.get_report(db, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    try:
        report_dict = report.to_dict()
        pdf_bytes = PDFService.generate_electrician_report_pdf(report_dict)
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=electrician_report_{report.report_number}.pdf"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")


@router.post("/preview-pdf")
async def preview_pdf(pdf_request: ElectricianReportPDFRequest):
    """Preview PDF without saving"""
    try:
        report_dict = pdf_request.report_data.model_dump()
        pdf_bytes = PDFService.generate_electrician_report_pdf(
            report_dict,
            include_photos=pdf_request.include_photos,
            include_financial=pdf_request.include_financial
        )
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": "inline; filename=preview.pdf"}
        )
    except Exception as e:
        logger.exception("PDF preview failed")
        raise HTTPException(status_code=500, detail=f"PDF preview failed: {str(e)}")


@router.post("/preview-html")
async def preview_html(pdf_request: ElectricianReportPDFRequest):
    """Preview report as HTML"""
    try:
        report_dict = pdf_request.report_data.model_dump()
        html_content = PDFService.generate_electrician_report_html(
            report_dict,
            include_photos=pdf_request.include_photos,
            include_financial=pdf_request.include_financial
        )
        return HTMLResponse(content=html_content)
    except Exception as e:
        logger.exception("HTML preview failed")
        raise HTTPException(status_code=500, detail=f"HTML preview failed: {str(e)}")


@router.get("/{report_id}/duplicate")
async def duplicate_report(
    report_id: UUID,
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff)
):
    """Duplicate an existing electrician report"""
    original = ElectricianReportService.get_report(db, report_id)
    if not original:
        raise HTTPException(status_code=404, detail="Report not found")

    report_dict = original.to_dict()
    report_dict.pop("id")
    report_dict.pop("created_at")
    report_dict.pop("updated_at")
    report_dict["report_number"] = ElectricianReportService.generate_report_number()
    report_dict["status"] = "draft"

    create_data = ElectricianReportCreate(**report_dict)
    new_report = ElectricianReportService.create_report(
        db=db, report_data=create_data, created_by=str(current_staff.id)
    )
    return ElectricianReportResponse.model_validate(new_report.to_dict())


# ================================================================
# Send Electrician Report to PA
# ================================================================

class SendElectricianReportRequest(PydanticBaseModel):
    """Request schema for sending electrician report to PA."""
    to_addresses: List[str]
    cc_addresses: List[str] = []
    subject: str
    body_html: str
    email_account_id: Optional[str] = None
    from_address: Optional[str] = None


@router.get("/{report_id}/pa-email-info")
async def get_pa_email_info(
    report_id: UUID,
    db: Session = Depends(get_db)
):
    """Get PA contact info for sending electrician report."""
    from app.domains.client.models import Claim
    from app.domains.company.models import CompanyContact, Company
    from app.domains.water_mitigation.models import WaterMitigationJob, WMSheetPAMapping

    report = ElectricianReportService.get_report(db, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    claim_id = ElectricianReportService.get_claim_id_for_report(db, report_id)
    if not claim_id:
        return {"to": [], "cc": [], "job": None, "claim_id": None, "email_accounts": [],
                "message": "No claim linked to this report."}

    claim = db.query(Claim).filter(Claim.id == claim_id).first()
    if not claim:
        return {"to": [], "cc": [], "job": None, "claim_id": claim_id, "email_accounts": [],
                "message": "Claim not found."}

    wm_job = db.query(WaterMitigationJob).filter(
        WaterMitigationJob.claim_id == claim_id, WaterMitigationJob.active == True
    ).first()

    pa_contact = None
    pa_company_id = None
    if claim.pa_contact_id:
        pa_contact = db.query(CompanyContact).filter(CompanyContact.id == claim.pa_contact_id).first()
    if not pa_contact and wm_job and wm_job.google_sheet_name:
        mapping = db.query(WMSheetPAMapping).filter(WMSheetPAMapping.sheet_name == wm_job.google_sheet_name).first()
        if mapping and mapping.pa_contact_id:
            pa_contact = db.query(CompanyContact).filter(CompanyContact.id == mapping.pa_contact_id).first()

    to_list, cc_list = [], []
    if pa_contact and pa_contact.email:
        pa_company_id = pa_contact.company_id
        to_list.append({"name": pa_contact.name or "", "email": pa_contact.email, "title": pa_contact.title or ""})
        if pa_company_id:
            siblings = db.query(CompanyContact).filter(
                CompanyContact.company_id == pa_company_id, CompanyContact.is_active == True,
                CompanyContact.id != pa_contact.id, CompanyContact.email.isnot(None), CompanyContact.email != ""
            ).all()
            for s in siblings:
                cc_list.append({"name": s.name or "", "email": s.email, "title": s.title or ""})

    if not to_list:
        pa_email = getattr(claim, 'pa_email', '') or ''
        pa_name = getattr(claim, 'pa_name', '') or ''
        if pa_email:
            to_list.append({"name": pa_name, "email": pa_email, "title": ""})

    email_accounts = []
    try:
        from app.domains.email_ingestion.models import EmailAccount
        accounts = db.query(EmailAccount).filter(EmailAccount.is_active == True).all()
        for a in accounts:
            email_accounts.append({
                "id": str(a.id), "email_address": a.email_address,
                "display_name": getattr(a, 'display_name', '') or a.email_address,
                "company_id": str(a.company_id) if a.company_id else None,
            })
    except Exception:
        pass

    job_info = None
    if wm_job:
        job_info = {
            "id": str(wm_job.id), "property_address": wm_job.property_address or "",
            "homeowner_name": wm_job.homeowner_name or "", "claim_number": wm_job.claim_number or "",
            "insurance_company": wm_job.insurance_company or "",
        }

    pa_company_name = ""
    if pa_company_id:
        co = db.query(Company).filter(Company.id == pa_company_id).first()
        if co:
            pa_company_name = co.name or ""

    return {
        "to": to_list, "cc": cc_list, "pa_company": pa_company_name,
        "job": job_info, "claim_id": claim_id, "email_accounts": email_accounts,
        "report": {
            "id": str(report.id), "report_number": report.report_number,
            "property_address": report.property_address or "", "client_name": report.client_name or "",
        },
    }


@router.post("/{report_id}/send-to-pa")
async def send_electrician_report_to_pa(
    report_id: UUID,
    request: SendElectricianReportRequest,
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
):
    """Send electrician report PDF to PA via email."""
    report = ElectricianReportService.get_report(db, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if not request.to_addresses:
        raise HTTPException(status_code=400, detail="No recipients")

    try:
        report_dict = report.to_dict()
        pdf_bytes = PDFService.generate_electrician_report_pdf(report_dict)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {e}")

    address_short = (report.property_address or "property").split(",")[0].strip()
    attachments = [{
        "filename": f"Electrician Report {report.report_number} - {address_short}.pdf",
        "data": pdf_bytes, "mime_type": "application/pdf",
    }]

    try:
        from app.domains.claim_followup.service import ClaimFollowUpService
        email_service = ClaimFollowUpService()
        claim_id = ElectricianReportService.get_claim_id_for_report(db, report_id)

        send_payload = {
            "claim_id": claim_id, "email_account_id": request.email_account_id,
            "to_addresses": request.to_addresses, "cc_addresses": request.cc_addresses,
            "bcc_addresses": [], "subject": request.subject, "body_html": request.body_html,
            "attachments": attachments,
        }
        if request.from_address:
            send_payload["from_address"] = request.from_address

        email_result = email_service.send_email(send_payload)
        if report.status != 'sent':
            report.status = 'sent'
            db.commit()

        return {"success": True, "email_id": str(email_result.get("id") or ""),
                "recipients": request.to_addresses, "cc": request.cc_addresses}
    except Exception as e:
        logger.error(f"Failed to send electrician report email: {e}")
        raise HTTPException(status_code=500, detail=f"Email send failed: {e}")
