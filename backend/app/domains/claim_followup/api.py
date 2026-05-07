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


@router.post("/tasks/{task_id}/resolve")
async def resolve_task(
    task_id: str,
    outcome: Optional[str] = Form(None),
    resolution_notes: Optional[str] = Form(None),
    acv_amount: Optional[float] = Form(None),
    rcv_amount: Optional[float] = Form(None),
    depreciation_amount: Optional[float] = Form(None),
    deductible: Optional[float] = Form(None),
    wm_cost_status: Optional[str] = Form(None),
    wm_estimate_amount: Optional[float] = Form(None),
    sections_data: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
):
    """Mark a follow-up task as resolved with optional outcome, amounts, and file"""
    service = _get_service()

    # Handle file upload if provided
    file_id = None
    file_name = None
    if file and file.filename:
        try:
            import io
            import os as _os
            from app.core.database_factory import get_database
            from app.domains.file.service import FileService
            from app.domains.claim_followup.models import FollowUpTask as FUTask
            from app.domains.client.models import Claim, ClaimNegotiation, Client
            from sqlalchemy import func as sqlfunc

            db = get_database()
            session = db.get_session()
            try:
                # Build filename: [address]-[version].pdf
                ext = _os.path.splitext(file.filename)[1] or '.pdf'
                address_part = ''
                version = 1
                task_obj = session.query(FUTask).filter(FUTask.id == task_id).first()
                if task_obj and task_obj.claim_id:
                    claim_obj = session.query(Claim).filter(Claim.id == task_obj.claim_id).first()
                    if claim_obj:
                        client_obj = session.query(Client).filter(Client.id == claim_obj.client_id).first()
                        if client_obj and client_obj.address:
                            address_part = client_obj.address.strip()
                        max_rev = session.query(sqlfunc.max(ClaimNegotiation.revision_number)).filter(
                            ClaimNegotiation.claim_id == str(claim_obj.id)
                        ).scalar() or 0
                        version = max_rev + 1

                if address_part:
                    # Sanitize address for filename
                    safe_address = address_part.replace('/', '-').replace('\\', '-').replace(':', '').replace('"', '')
                    upload_filename = f"{safe_address}-v{version}{ext}"
                else:
                    upload_filename = f"Insurance-Estimate-v{version}{ext}"

                file_service = FileService(db)
                file_content = await file.read()
                file_record = await file_service.upload_file(
                    file_data=io.BytesIO(file_content),
                    original_filename=upload_filename,
                    content_type=file.content_type or "application/pdf",
                    context="insurance_estimate",
                    context_id=task_id,
                )
                session.commit()
                file_id = str(file_record.get("id", ""))
                file_name = upload_filename
            finally:
                session.close()
        except Exception as e:
            logger.error(f"File upload failed during resolve: {e}")

    # Parse sections_data JSON string
    parsed_sections = None
    if sections_data:
        try:
            import json
            parsed_sections = json.loads(sections_data)
        except Exception:
            pass

    estimate_data = None
    if acv_amount is not None or rcv_amount is not None or file_id:
        estimate_data = {
            'acv_amount': acv_amount or 0,
            'rcv_amount': rcv_amount or 0,
            'depreciation_amount': depreciation_amount or 0,
            'deductible': deductible or 0,
            'file_id': file_id,
            'file_name': file_name,
            'sections_data': parsed_sections,
            'wm_cost_status': wm_cost_status,
            'wm_estimate_amount': wm_estimate_amount,
        }

    result = service.resolve_task(
        task_id,
        resolution_notes=resolution_notes,
        outcome=outcome,
        estimate_data=estimate_data,
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

        return {
            "sections": result["sections"],
            "totals": result["totals"],
            "validation": result.get("validation", {}),
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
