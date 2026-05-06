"""
Claim Follow-up API endpoints.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

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
async def resolve_task(task_id: str, resolution_notes: Optional[str] = None):
    """Mark a follow-up task as resolved"""
    service = _get_service()
    result = service.resolve_task(task_id, resolution_notes)
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
