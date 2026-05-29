"""
Claim Follow-up API endpoints.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from app.domains.claim_followup.schemas import (
    CommunicationLogCreate,
    CommunicationLogResponse,
    CommunicationLogUpdate,
    EmailTemplateCreate,
    EmailTemplateResponse,
    EmailTemplateUpdate,
    FollowUpDashboardStats,
    FollowUpTaskCreate,
    FollowUpTaskResponse,
    FollowUpTaskUpdate,
    GenerateAIEmailRequest,
    GenerateAIEmailResponse,
    SendEmailRequest,
    SendFromTemplateRequest,
    SentEmailResponse,
    MarkReplyRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _build_summary_from_items(items, merged_pages) -> tuple:
    """Build section summaries from insurance_extraction parsed items.

    Groups items by room, computes subtotals, and extracts O&P / tax
    from the merged page text (summary page).
    """
    import re
    from collections import OrderedDict

    # Group items by room → compute room subtotals
    rooms: OrderedDict = OrderedDict()
    for item in items:
        room = item.room or "General"
        if room not in rooms:
            rooms[room] = {"total": 0.0, "count": 0}
        rcv = float(item.rcv or 0) if item.rcv else (
            float(item.unit_price or 0) * float(item.quantity or 1)
        )
        rooms[room]["total"] += rcv
        rooms[room]["count"] += 1

    line_item_total = sum(r["total"] for r in rooms.values())

    # Extract O&P, tax, deductible from merged page text
    all_text = "\n".join(merged_pages)
    overhead_amount = 0.0
    profit_amount = 0.0
    sales_tax = 0.0
    deductible = 0.0
    estimate_subtotal = 0.0
    estimate_total = 0.0

    oh_m = re.search(
        r"(?:Add\s+)?[\d.]+%?\s*overhead.*?\$?([\d,]+\.\d+)",
        all_text, re.IGNORECASE,
    )
    if oh_m:
        overhead_amount = float(oh_m.group(1).replace(",", ""))

    pr_m = re.search(
        r"(?:Add\s+)?[\d.]+%?\s*profit.*?\$?([\d,]+\.\d+)",
        all_text, re.IGNORECASE,
    )
    if pr_m:
        profit_amount = float(pr_m.group(1).replace(",", ""))

    tax_m = re.search(
        r"Sales\s+Tax.*?\$?([\d,]+\.\d+)",
        all_text, re.IGNORECASE,
    )
    if tax_m:
        sales_tax = float(tax_m.group(1).replace(",", ""))

    ded_m = re.search(
        r"Deductible.*?\$?\(?([\d,]+\.\d+)\)?",
        all_text, re.IGNORECASE,
    )
    if ded_m:
        deductible = float(ded_m.group(1).replace(",", ""))

    est_sub_m = re.search(
        r"Estimate\s+Subtotal:\s+\$?([\d,]+\.\d+)",
        all_text, re.IGNORECASE,
    )
    if est_sub_m:
        estimate_subtotal = float(est_sub_m.group(1).replace(",", ""))

    est_total_m = re.search(
        r"Estimate\s+Total:\s+\$?([\d,]+\.\d+)",
        all_text, re.IGNORECASE,
    )
    if est_total_m:
        estimate_total = float(est_total_m.group(1).replace(",", ""))

    # Compute RCV
    rcv = estimate_subtotal or (
        line_item_total + sales_tax + overhead_amount + profit_amount
    )
    net_acv = estimate_total or (rcv - deductible)
    depreciation = rcv - net_acv - deductible if rcv > net_acv else 0.0

    # Build single section
    section = {
        "section_name": "Structure",
        "line_item_total": round(line_item_total, 2),
        "material_sales_tax": round(sales_tax, 2),
        "subtotal": round(line_item_total + sales_tax, 2),
        "overhead_amount": round(overhead_amount, 2),
        "profit_amount": round(profit_amount, 2),
        "rcv": round(rcv, 2),
        "depreciation": round(max(depreciation, 0), 2),
        "deductible": round(deductible, 2),
        "net_acv": round(net_acv, 2),
        "recoverable_depreciation": 0,
        "non_recoverable_depreciation": 0,
        "total_if_incurred": 0,
    }

    totals = {
        "rcv_amount": section["rcv"],
        "acv_amount": section["net_acv"],
        "depreciation_amount": section["depreciation"],
        "deductible": section["deductible"],
    }

    return [section], totals


def _get_service():
    from app.domains.claim_followup.service import ClaimFollowUpService
    return ClaimFollowUpService()


# ============================================================
# Follow-Up Tasks
# ============================================================

@router.get("/tasks", response_model=List[FollowUpTaskResponse])
async def list_tasks(
    status: Optional[str] = Query(None),
    task_type: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    claim_id: Optional[str] = Query(None),
    assigned_to_email: Optional[str] = Query(None),
    overdue_only: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort_by: str = Query("due_date"),
    sort_order: str = Query("asc"),
):
    """List follow-up tasks with filtering and pagination"""
    service = _get_service()
    tasks, total = service.get_tasks({
        "status": status,
        "task_type": task_type,
        "priority": priority,
        "claim_id": claim_id,
        "assigned_to_email": assigned_to_email,
        "overdue_only": overdue_only,
        "page": page,
        "page_size": page_size,
        "sort_by": sort_by,
        "sort_order": sort_order,
    })
    return tasks


@router.get("/tasks/stats", response_model=FollowUpDashboardStats)
async def get_dashboard_stats():
    """Get dashboard statistics"""
    service = _get_service()
    return service.get_dashboard_stats()


@router.get("/tasks/by-claim/{claim_id}", response_model=List[FollowUpTaskResponse])
async def get_tasks_by_claim(claim_id: str):
    """Get all follow-up tasks for a specific claim"""
    service = _get_service()
    return service.get_tasks_by_claim(claim_id)


@router.get("/tasks/{task_id}", response_model=FollowUpTaskResponse)
async def get_task(task_id: str):
    """Get a single follow-up task"""
    service = _get_service()
    task = service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("/tasks", response_model=FollowUpTaskResponse)
async def create_task(data: FollowUpTaskCreate):
    """Create a new follow-up task"""
    service = _get_service()
    try:
        return service.create_task(data.dict())
    except Exception as e:
        logger.error(f"Error creating follow-up task: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/tasks/{task_id}", response_model=FollowUpTaskResponse)
async def update_task(task_id: str, data: FollowUpTaskUpdate):
    """Update a follow-up task"""
    service = _get_service()
    update_data = data.dict(exclude_unset=True)
    result = service.update_task(task_id, update_data)
    if not result:
        raise HTTPException(status_code=404, detail="Task not found")
    return result


async def _upload_pdf_file(
    db,
    file: UploadFile,
    context: str,
    context_id: str,
    address_part: str,
    version: int,
    label: str,
) -> tuple:
    """Upload a PDF file and return (file_id, filename)."""
    import io
    import os as _os
    from app.domains.file.service import FileService

    ext = _os.path.splitext(file.filename)[1] or '.pdf'
    if address_part:
        safe_address = address_part.replace('/', '-').replace('\\', '-').replace(':', '').replace('"', '')
        upload_filename = f"{safe_address}-{label}-v{version}{ext}"
    else:
        upload_filename = f"{label}-v{version}{ext}"

    file_service = FileService(db)
    file_content = await file.read()
    file_record = await file_service.upload_file(
        file_data=io.BytesIO(file_content),
        original_filename=upload_filename,
        content_type=file.content_type or "application/pdf",
        context=context,
        context_id=context_id,
    )
    file_service.repository.db_session.commit()
    file_service.repository.db_session.close()
    return str(file_record.get("id", "")), upload_filename


def _parse_pdf_amount(file_content: bytes) -> Optional[float]:
    """Parse a PDF and return total RCV/amount. Returns None if parsing fails."""
    import os
    import tempfile
    tmp_path = None
    try:
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".pdf")
        try:
            with os.fdopen(tmp_fd, "wb") as f:
                f.write(file_content)
        except Exception:
            try:
                os.close(tmp_fd)
            except OSError:
                pass
            raise

        from app.domains.client.negotiation_pdf_service import extract_summary_from_pdf
        result = extract_summary_from_pdf(tmp_path)
        totals = result.get("totals", {})
        rcv = totals.get("rcv_amount") or totals.get("acv_amount")
        if rcv:
            return float(rcv)

        # Fallback: insurance_extraction pipeline
        try:
            from app.domains.insurance_extraction.extractors.ocr_fallback_extractor import OcrFallbackExtractor
            from app.domains.insurance_extraction.extractors.pdf_text_extractor import PdfTextExtractor
            from app.domains.insurance_extraction.orchestrator.pipeline import InsuranceExtractionOrchestrator
            from app.domains.insurance_extraction.parsers.resolver import InsuranceParserResolver

            orchestrator = InsuranceExtractionOrchestrator(
                text_extractor=PdfTextExtractor(),
                ocr_extractor=OcrFallbackExtractor(),
                parser_resolver=InsuranceParserResolver(),
            )
            pipeline_result = orchestrator.run(tmp_path)
            if pipeline_result.items:
                total = sum(float(item.rcv or item.unit_price or 0) * float(item.quantity or 1)
                            for item in pipeline_result.items)
                if total > 0:
                    return total
        except Exception:
            pass
    except Exception as e:
        logger.warning(f"PDF parsing failed: {e}")
    finally:
        if tmp_path and os.path.isfile(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
    return None


@router.post("/tasks/{task_id}/resolve")
async def resolve_task(
    task_id: str,
    outcome: Optional[str] = Form(None),
    resolution_notes: Optional[str] = Form(None),
    denied_action: Optional[str] = Form(None),
    acv_amount: Optional[float] = Form(None),
    rcv_amount: Optional[float] = Form(None),
    depreciation_amount: Optional[float] = Form(None),
    deductible: Optional[float] = Form(None),
    wm_cost_status: Optional[str] = Form(None),
    wm_estimate_amount: Optional[float] = Form(None),
    sections_data: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    wm_estimate_file: Optional[UploadFile] = File(None),
):
    """Mark a follow-up task as resolved with optional outcome, amounts, and files.

    - file: Insurance estimate PDF (rebuild)
    - wm_estimate_file: Separate WM estimate PDF (when wm_cost_status='separate_estimate')
    """
    service = _get_service()

    # Verify task exists before doing any work (e.g. file upload)
    existing_task = service.get_task(task_id)
    if not existing_task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Category → file label mapping (add new types here)
    CATEGORY_FILE_LABELS = {
        'combined': 'Insurance-Estimate',
        'reconstruction': 'Reconstruction-Estimate',
        'water_mitigation': 'WM-Estimate',
        'mold_remediation': 'Mold-Estimate',
    }

    # Resolve address and per-category version info
    address_part = ''
    category_versions: dict = {}  # {category: next_version}
    try:
        from app.core.database_factory import get_database
        from app.domains.claim_followup.models import FollowUpTask as FUTask
        from app.domains.client.models import Claim, ClaimNegotiation, Client
        from sqlalchemy import func as sqlfunc

        db = get_database()
        session = db.get_session()
        try:
            task_obj = session.query(FUTask).filter(FUTask.id == task_id).first()
            if task_obj and task_obj.claim_id:
                claim_obj = session.query(Claim).filter(Claim.id == task_obj.claim_id).first()
                if claim_obj:
                    client_obj = session.query(Client).filter(Client.id == claim_obj.client_id).first()
                    if client_obj and client_obj.address:
                        address_part = client_obj.address.strip()
                    claim_id_str = str(claim_obj.id)
                    for cat in CATEGORY_FILE_LABELS:
                        max_rev = session.query(sqlfunc.max(ClaimNegotiation.revision_number)).filter(
                            ClaimNegotiation.claim_id == claim_id_str,
                            ClaimNegotiation.estimate_category == cat,
                        ).scalar() or 0
                        category_versions[cat] = max_rev + 1
        finally:
            session.close()
    except Exception as e:
        logger.error(f"Failed to fetch address info for file naming: {e}")

    # Determine main estimate category based on WM cost status
    is_separate = wm_cost_status == 'separate_estimate'
    main_category = 'reconstruction' if is_separate else 'combined'
    main_label = CATEGORY_FILE_LABELS.get(main_category, 'Insurance-Estimate')
    main_version = category_versions.get(main_category, 1)

    # Handle insurance estimate file upload
    file_id = None
    file_name = None
    if file and file.filename:
        try:
            db = get_database()
            file_id, file_name = await _upload_pdf_file(
                db, file, "insurance_estimate", task_id,
                address_part, main_version, main_label,
            )
        except Exception as e:
            logger.error(f"Insurance estimate file upload failed: {e}")

    # Handle WM estimate file upload + auto-parse amount
    wm_file_id = None
    wm_file_name = None
    parsed_wm_amount = wm_estimate_amount  # keep manually entered amount as fallback
    if wm_estimate_file and wm_estimate_file.filename:
        try:
            db = get_database()
            wm_file_content = await wm_estimate_file.read()
            # Auto-parse amount from PDF
            auto_amount = _parse_pdf_amount(wm_file_content)
            if auto_amount and not wm_estimate_amount:
                parsed_wm_amount = auto_amount
                logger.info(f"Auto-parsed WM estimate amount from PDF: ${auto_amount:,.2f}")

            import io
            wm_estimate_file.file.seek(0) if hasattr(wm_estimate_file.file, 'seek') else None
            from app.domains.file.service import FileService
            import os as _os
            ext = _os.path.splitext(wm_estimate_file.filename)[1] or '.pdf'
            wm_label = CATEGORY_FILE_LABELS.get('water_mitigation', 'WM-Estimate')
            wm_ver = category_versions.get('water_mitigation', 1)
            if address_part:
                safe_address = address_part.replace('/', '-').replace('\\', '-').replace(':', '').replace('"', '')
                wm_upload_filename = f"{safe_address}-{wm_label}-v{wm_ver}{ext}"
            else:
                wm_upload_filename = f"{wm_label}-v{wm_ver}{ext}"

            db2 = get_database()
            fs = FileService(db2)
            wm_record = await fs.upload_file(
                file_data=io.BytesIO(wm_file_content),
                original_filename=wm_upload_filename,
                content_type=wm_estimate_file.content_type or "application/pdf",
                context="wm_estimate",
                context_id=task_id,
            )
            fs.repository.db_session.commit()
            fs.repository.db_session.close()
            wm_file_id = str(wm_record.get("id", ""))
            wm_file_name = wm_upload_filename
        except Exception as e:
            logger.error(f"WM estimate file upload failed: {e}")

    # Parse sections_data JSON string
    parsed_sections = None
    if sections_data:
        try:
            import json
            parsed_sections = json.loads(sections_data)
        except Exception:
            pass

    estimate_data = None
    if acv_amount is not None or rcv_amount is not None or file_id or wm_file_id:
        estimate_data = {
            'acv_amount': acv_amount or 0,
            'rcv_amount': rcv_amount or 0,
            'depreciation_amount': depreciation_amount or 0,
            'deductible': deductible or 0,
            'file_id': file_id,
            'file_name': file_name,
            'sections_data': parsed_sections,
            'wm_cost_status': wm_cost_status,
            'wm_estimate_amount': parsed_wm_amount,
            'wm_file_id': wm_file_id,
            'wm_file_name': wm_file_name,
        }

    result = service.resolve_task(
        task_id,
        resolution_notes=resolution_notes,
        outcome=outcome,
        estimate_data=estimate_data,
        denied_action=denied_action,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Task not found")
    return result


@router.post("/tasks/parse-estimate")
async def parse_estimate_pdf(file: UploadFile = File(...)):
    """Parse insurance estimate PDF and return extracted sections + totals"""
    import os
    import tempfile

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    tmp_path = None
    try:
        file_content = await file.read()

        # Write to temp file
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".pdf")
        try:
            with os.fdopen(tmp_fd, "wb") as tmp_f:
                tmp_f.write(file_content)
        except Exception:
            try:
                os.close(tmp_fd)
            except OSError:
                pass
            raise

        from app.domains.client.negotiation_pdf_service import extract_summary_from_pdf
        result = extract_summary_from_pdf(tmp_path)

        # Check if summary extraction found meaningful data
        has_sections = bool(result.get("sections"))
        if has_sections:
            return {
                "sections": result["sections"],
                "totals": result["totals"],
                "validation": result.get("validation", {}),
            }

        # Fallback: use insurance_extraction pipeline for non-Xactimate formats
        logger.info("Summary parser found no sections, trying insurance_extraction pipeline")
        try:
            from app.domains.insurance_extraction.extractors.ocr_fallback_extractor import OcrFallbackExtractor
            from app.domains.insurance_extraction.extractors.pdf_text_extractor import PdfTextExtractor
            from app.domains.insurance_extraction.orchestrator.pipeline import InsuranceExtractionOrchestrator
            from app.domains.insurance_extraction.parsers.resolver import InsuranceParserResolver

            orchestrator = InsuranceExtractionOrchestrator(
                text_extractor=PdfTextExtractor(),
                ocr_extractor=OcrFallbackExtractor(),
                parser_resolver=InsuranceParserResolver(),
            )
            pipeline_result = orchestrator.run(tmp_path)

            if pipeline_result.items:
                sections, totals = _build_summary_from_items(
                    pipeline_result.items,
                    pipeline_result.merged_pages,
                )
                return {
                    "sections": sections,
                    "totals": totals,
                    "validation": {"is_valid": True, "warnings": []},
                    "metadata": {
                        "strategy": f"insurance_extraction_{pipeline_result.metadata.get('strategy', '')}",
                        "carrier": pipeline_result.carrier,
                        "item_count": len(pipeline_result.items),
                    },
                }
        except Exception as fallback_err:
            logger.warning(f"Insurance extraction fallback failed: {fallback_err}")

        # Return empty result if all strategies failed
        return {
            "sections": [],
            "totals": {"rcv_amount": 0, "acv_amount": 0, "depreciation_amount": 0, "deductible": 0},
            "validation": {"is_valid": False, "warnings": ["No data could be extracted from this PDF format"]},
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error parsing estimate PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path and os.path.isfile(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


@router.post("/tasks/{task_id}/reopen")
async def reopen_task(task_id: str):
    """Reopen a resolved follow-up task"""
    service = _get_service()
    result = service.reopen_task(task_id)
    if not result:
        raise HTTPException(status_code=404, detail="Task not found")
    return result


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str):
    """Delete a follow-up task"""
    service = _get_service()
    success = service.delete_task(task_id)
    if not success:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"success": True}


# ============================================================
# Email Templates
# ============================================================

@router.get("/templates", response_model=List[EmailTemplateResponse])
async def list_templates(
    template_type: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
):
    """List active email templates"""
    service = _get_service()
    return service.get_templates(template_type, company_id)


@router.get("/templates/{template_id}", response_model=EmailTemplateResponse)
async def get_template(template_id: str):
    """Get a single email template"""
    service = _get_service()
    template = service.get_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.post("/templates", response_model=EmailTemplateResponse)
async def create_template(data: EmailTemplateCreate):
    """Create a new email template"""
    service = _get_service()
    try:
        return service.create_template(data.dict())
    except Exception as e:
        logger.error(f"Error creating template: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/templates/{template_id}", response_model=EmailTemplateResponse)
async def update_template(template_id: str, data: EmailTemplateUpdate):
    """Update an email template"""
    service = _get_service()
    update_data = data.dict(exclude_unset=True)
    result = service.update_template(template_id, update_data)
    if not result:
        raise HTTPException(status_code=404, detail="Template not found")
    return result


@router.delete("/templates/{template_id}")
async def delete_template(template_id: str):
    """Delete (deactivate) an email template"""
    service = _get_service()
    success = service.delete_template(template_id)
    if not success:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"success": True}


@router.post("/templates/{template_id}/render")
async def render_template(template_id: str, variables: dict):
    """Preview template with variable substitution"""
    service = _get_service()
    try:
        return service.render_template(template_id, variables)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ============================================================
# Communication Logs
# ============================================================

@router.get("/communications/by-claim/{claim_id}", response_model=List[CommunicationLogResponse])
async def get_communications_by_claim(claim_id: str):
    """Get all communications for a claim"""
    service = _get_service()
    return service.get_communications_by_claim(claim_id)


@router.get("/communications/by-task/{task_id}", response_model=List[CommunicationLogResponse])
async def get_communications_by_task(task_id: str):
    """Get all communications for a task"""
    service = _get_service()
    return service.get_communications_by_task(task_id)


@router.post("/communications", response_model=CommunicationLogResponse)
async def log_communication(data: CommunicationLogCreate):
    """Log a communication event (phone call, email, etc.)"""
    service = _get_service()
    try:
        return service.log_communication(data.dict())
    except Exception as e:
        logger.error(f"Error logging communication: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/communications/{log_id}", response_model=CommunicationLogResponse)
async def update_communication(log_id: str, data: CommunicationLogUpdate):
    """Update a communication log (e.g., mark response received)"""
    service = _get_service()
    update_data = data.dict(exclude_unset=True)
    result = service.update_communication(log_id, update_data)
    if not result:
        raise HTTPException(status_code=404, detail="Communication log not found")
    return result


# ============================================================
# Email Sending
# ============================================================

@router.get("/emails/by-claim/{claim_id}", response_model=List[SentEmailResponse])
async def get_sent_emails_by_claim(claim_id: str):
    """Get all sent emails for a claim"""
    service = _get_service()
    return service.get_sent_emails_by_claim(claim_id)


@router.get("/emails/by-task/{task_id}", response_model=List[SentEmailResponse])
async def get_sent_emails_by_task(task_id: str):
    """Get all sent emails for a task"""
    service = _get_service()
    return service.get_sent_emails_by_task(task_id)


@router.post("/emails/send", response_model=SentEmailResponse)
async def send_email(data: SendEmailRequest):
    """Send an email directly"""
    service = _get_service()
    try:
        return service.send_email(data.dict())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error sending email: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to send email: {str(e)}")


@router.post("/emails/send-from-template", response_model=SentEmailResponse)
async def send_from_template(data: SendFromTemplateRequest):
    """Send an email using a template"""
    service = _get_service()
    try:
        return service.send_from_template(data.dict())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error sending template email: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to send email: {str(e)}")


@router.post("/emails/generate-ai", response_model=GenerateAIEmailResponse)
async def generate_ai_email(data: GenerateAIEmailRequest):
    """Generate email content using AI"""
    service = _get_service()
    try:
        return service.generate_ai_email(data.dict())
    except Exception as e:
        logger.error(f"Error generating AI email: {e}")
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")


@router.post("/emails/{email_id}/mark-reply", response_model=SentEmailResponse)
async def mark_reply_received(email_id: str, data: MarkReplyRequest):
    """Mark a sent email as having received a reply"""
    service = _get_service()
    result = service.mark_reply(email_id, data.reply_summary)
    if not result:
        raise HTTPException(status_code=404, detail="Email not found")
    return result


@router.post("/emails/test-smtp")
async def test_smtp(account_id: Optional[str] = None):
    """Test SMTP connection"""
    from app.domains.claim_followup.smtp_service import test_smtp_connection
    result = test_smtp_connection(account_id)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    return result


# ============================================================
# Automatic Reply Tracking
# ============================================================

@router.post("/emails/check-replies")
async def check_replies(account_id: Optional[str] = Query(None)):
    """Check IMAP inboxes for replies to sent follow-up emails.

    Automatically updates SentEmail, FollowUpTask status,
    CommunicationLog, and ClaimActivity when replies are detected.
    Can be called manually or scheduled via cron/scheduler.
    """
    from app.domains.claim_followup.reply_tracker import ReplyTracker
    try:
        tracker = ReplyTracker()
        result = tracker.check_replies(account_id)
        return result
    except Exception as e:
        logger.error(f"Reply check failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Reply check failed: {str(e)}",
        )


# ============================================================
# Claim Company Info (for email account auto-selection)
# ============================================================

@router.get("/claim-companies/{claim_id}")
async def get_claim_companies(claim_id: str):
    """Get company assignments for a claim.
    Returns WM company and rebuild company IDs so the frontend
    can auto-select the correct email account.
    """
    from app.core.database_factory import get_database
    database = get_database()
    session = database.get_readonly_session()
    try:
        from app.domains.client.models import Claim
        from app.domains.water_mitigation.models import WaterMitigationJob
        from app.domains.company.models import Company

        claim = session.query(Claim).filter(
            Claim.id == claim_id
        ).first()
        if not claim:
            raise HTTPException(status_code=404, detail="Claim not found")

        result: Dict[str, Any] = {
            "rebuild_company_id": (
                str(claim.company_id) if claim.company_id else None
            ),
            "rebuild_company_name": None,
            "wm_company_id": None,
            "wm_company_name": None,
        }

        # Get rebuild company name
        if claim.company_id:
            co = session.query(Company.name).filter(
                Company.id == claim.company_id
            ).first()
            if co:
                result["rebuild_company_name"] = co.name

        # Get WM job company
        wm_job = session.query(
            WaterMitigationJob.company_id
        ).filter(
            WaterMitigationJob.claim_id == claim_id
        ).order_by(
            WaterMitigationJob.created_at.desc()
        ).first()
        if wm_job and wm_job.company_id:
            result["wm_company_id"] = str(wm_job.company_id)
            co = session.query(Company.name).filter(
                Company.id == wm_job.company_id
            ).first()
            if co:
                result["wm_company_name"] = co.name

        return result
    finally:
        session.close()
