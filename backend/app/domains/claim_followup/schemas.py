"""
Claim Follow-up Pydantic schemas for request/response validation.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, validator


# ============================================================
# FollowUpTask schemas
# ============================================================

class FollowUpTaskBase(BaseModel):
    task_type: str = Field(..., description="docs_sent | payment_check | estimate_request | supplement_sent | depreciation_recovery | general")
    title: str
    description: Optional[str] = None
    due_date: Optional[datetime] = None
    next_followup_date: Optional[datetime] = None
    priority: str = Field("normal", description="low | normal | high | urgent")
    assigned_to_name: Optional[str] = None
    assigned_to_email: Optional[str] = None
    assigned_to_phone: Optional[str] = None
    assigned_to_role: str = Field("adjuster", description="adjuster | public_adjuster | contractor")
    auto_followup_enabled: bool = False
    followup_interval_days: int = 3
    max_followup_count: int = 5

    @validator('task_type')
    def validate_task_type(cls, v):
        allowed = ['wm_docs_sent', 'supplement_sent', 'depreciation_recovery', 'estimate_request', 'payment_check', 'wm_payment_check', 'docs_sent', 'general', 'dispute', 'appraisal', 'attorney_referral']
        if v not in allowed:
            raise ValueError(f"task_type must be one of {allowed}")
        return v

    @validator('priority')
    def validate_priority(cls, v):
        allowed = ['low', 'normal', 'high', 'urgent']
        if v not in allowed:
            raise ValueError(f"priority must be one of {allowed}")
        return v


class FollowUpTaskCreate(FollowUpTaskBase):
    claim_id: UUID
    wm_job_id: Optional[UUID] = None


class FollowUpTaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    due_date: Optional[datetime] = None
    priority: Optional[str] = None
    assigned_to_name: Optional[str] = None
    assigned_to_email: Optional[str] = None
    assigned_to_phone: Optional[str] = None
    assigned_to_role: Optional[str] = None
    auto_followup_enabled: Optional[bool] = None
    followup_interval_days: Optional[int] = None
    max_followup_count: Optional[int] = None
    resolution_notes: Optional[str] = None
    payment_status: Optional[str] = None
    payment_note: Optional[str] = None

    @validator('status')
    def validate_status(cls, v):
        if v is not None:
            allowed = ['pending', 'awaiting_response', 'responded', 'resolved', 'overdue', 'cancelled']
            if v not in allowed:
                raise ValueError(f"status must be one of {allowed}")
        return v


class FollowUpTaskResolve(BaseModel):
    """Request body for resolving a follow-up task with outcome"""
    resolution_notes: Optional[str] = None
    outcome: Optional[str] = None
    denied_action: Optional[str] = None

    @validator('outcome')
    def validate_outcome(cls, v):
        if v is not None:
            allowed = [
                'estimate_received', 'wm_estimate_only',
                'denied', 'estimate_requested', 'other',
            ]
            if v not in allowed:
                raise ValueError(
                    f"outcome must be one of {allowed}"
                )
        return v

    @validator('denied_action')
    def validate_denied_action(cls, v):
        if v is not None:
            allowed = [
                'complete', 'dispute',
                'appraisal', 'attorney',
            ]
            if v not in allowed:
                raise ValueError(
                    f"denied_action must be one of {allowed}"
                )
        return v


class FollowUpTaskResponse(FollowUpTaskBase):
    id: UUID
    claim_id: UUID
    wm_job_id: Optional[UUID] = None
    status: str
    last_contacted_at: Optional[datetime] = None
    next_followup_date: Optional[datetime] = None
    contact_count: int = 0
    resolved_at: Optional[datetime] = None
    resolution_notes: Optional[str] = None
    payment_status: Optional[str] = None
    payment_note: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    # Nested data (optional, loaded when detail view)
    communications_count: Optional[int] = None
    sent_emails_count: Optional[int] = None
    claim_number: Optional[str] = None
    property_address: Optional[str] = None
    insurance_company: Optional[str] = None

    class Config:
        from_attributes = True


# ============================================================
# EmailTemplate schemas
# ============================================================

class EmailTemplateBase(BaseModel):
    name: str
    description: Optional[str] = None
    template_type: str = Field(..., description="initial_send | first_followup | second_followup | urgent_notice | payment_inquiry | estimate_request | supplement_followup | custom")
    subject_template: str
    body_template: str
    available_variables: List[str] = Field(default_factory=lambda: [
        "claim_number", "property_address", "homeowner_name",
        "adjuster_name", "insurance_company", "invoice_amount",
        "documents_sent_date", "company_name", "sender_name", "sender_phone"
    ])
    language: str = "en"


class EmailTemplateCreate(EmailTemplateBase):
    company_id: Optional[UUID] = None


class EmailTemplateUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    template_type: Optional[str] = None
    subject_template: Optional[str] = None
    body_template: Optional[str] = None
    available_variables: Optional[List[str]] = None
    language: Optional[str] = None
    is_active: Optional[bool] = None


class EmailTemplateResponse(EmailTemplateBase):
    id: UUID
    is_active: bool = True
    is_system: bool = False
    usage_count: int = 0
    company_id: Optional[UUID] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ============================================================
# CommunicationLog schemas
# ============================================================

class CommunicationLogBase(BaseModel):
    communication_type: str = Field(..., description="email | phone | text | in_person | other")
    direction: str = Field("outbound", description="outbound | inbound")
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    subject: Optional[str] = None
    summary: Optional[str] = None


class CommunicationLogCreate(CommunicationLogBase):
    claim_id: UUID
    followup_task_id: Optional[UUID] = None
    sent_email_id: Optional[UUID] = None


class CommunicationLogUpdate(BaseModel):
    response_received: Optional[bool] = None
    response_date: Optional[datetime] = None
    response_summary: Optional[str] = None
    summary: Optional[str] = None


class CommunicationLogResponse(CommunicationLogBase):
    id: UUID
    claim_id: UUID
    followup_task_id: Optional[UUID] = None
    sent_email_id: Optional[UUID] = None
    response_received: bool = False
    response_date: Optional[datetime] = None
    response_summary: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ============================================================
# SentEmail schemas
# ============================================================

class EmailAttachment(BaseModel):
    filename: str
    file_id: str
    mime_type: Optional[str] = "application/pdf"
    size: Optional[int] = None


class SendEmailRequest(BaseModel):
    """Request to send an email"""
    claim_id: UUID
    followup_task_id: Optional[UUID] = None
    email_account_id: Optional[UUID] = None
    to_addresses: List[str]
    cc_addresses: List[str] = Field(default_factory=list)
    subject: str
    body_html: str
    attachments: List[EmailAttachment] = Field(default_factory=list)
    template_id: Optional[UUID] = None
    template_variables: Optional[Dict[str, Any]] = None
    scheduled_at: Optional[datetime] = None
    # Water mitigation document re-attachment for follow-up emails
    wm_job_id: Optional[UUID] = Field(None, description="WM job ID to attach documents from")
    wm_documents: Optional[List[str]] = Field(
        None,
        description="WM document types to attach: photo_report, invoice, w9, cos, ewa, sketch"
    )


class SendFromTemplateRequest(BaseModel):
    """Request to send email using a template"""
    claim_id: UUID
    followup_task_id: Optional[UUID] = None
    email_account_id: Optional[UUID] = None
    template_id: UUID
    to_addresses: List[str]
    cc_addresses: List[str] = Field(default_factory=list)
    variables: Dict[str, str] = Field(default_factory=dict)
    attachments: List[EmailAttachment] = Field(default_factory=list)
    scheduled_at: Optional[datetime] = None


class GenerateAIEmailRequest(BaseModel):
    """Request AI to generate email content"""
    claim_id: UUID
    followup_task_id: Optional[UUID] = None
    context_type: str = Field(..., description="initial_send | followup | payment_inquiry | supplement | general")
    tone: str = Field("professional", description="professional | friendly | urgent | formal")
    language: str = "en"
    additional_context: Optional[str] = None


class GenerateAIEmailResponse(BaseModel):
    """AI-generated email content"""
    subject: str
    body_html: str
    body_text: str
    variables_used: Dict[str, Any] = Field(default_factory=dict)


class MarkReplyRequest(BaseModel):
    reply_summary: Optional[str] = None


class SentEmailResponse(BaseModel):
    id: UUID
    claim_id: UUID
    followup_task_id: Optional[UUID] = None
    email_account_id: Optional[UUID] = None
    from_address: str
    to_addresses: List[str]
    cc_addresses: List[str] = []
    subject: str
    body_html: str
    attachments: List[Dict[str, Any]] = []
    template_id: Optional[UUID] = None
    is_ai_generated: bool = False
    status: str
    sent_at: Optional[datetime] = None
    error_message: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    reply_received: bool = False
    reply_received_at: Optional[datetime] = None
    reply_summary: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ============================================================
# Dashboard / Summary schemas
# ============================================================

class FollowUpDashboardStats(BaseModel):
    """Dashboard summary statistics"""
    total_tasks: int = 0
    pending: int = 0
    awaiting_response: int = 0
    overdue: int = 0
    resolved_this_week: int = 0
    by_type: Dict[str, int] = Field(default_factory=dict)
    by_priority: Dict[str, int] = Field(default_factory=dict)


class FollowUpTaskListParams(BaseModel):
    """Query parameters for task list"""
    status: Optional[str] = None
    task_type: Optional[str] = None
    priority: Optional[str] = None
    claim_id: Optional[UUID] = None
    assigned_to_email: Optional[str] = None
    overdue_only: bool = False
    page: int = 1
    page_size: int = 20
    sort_by: str = "due_date"
    sort_order: str = "asc"
