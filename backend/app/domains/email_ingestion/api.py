"""
Email Ingestion API endpoints.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, false, or_, select
from sqlalchemy.orm import aliased

from app.core.database_factory import get_db_session as get_db
from app.domains.auth.company_scope import (
    claim_condition,
    company_ids,
    require_claim,
    require_client,
)
from app.domains.auth.dependencies import get_current_staff
from app.domains.email_ingestion.models import EmailAccount, EmailIngestionLog, ReceivedEmail
from app.domains.staff.models import Staff
from app.domains.email_ingestion.schemas import (
    BatchPollResponse,
    EmailAccountCreate,
    EmailAccountOAuthConnect,
    EmailAccountResponse,
    EmailAccountTestResponse,
    EmailAccountUpdate,
    EstimateExtractionResponse,
    InboxCheckResponse,
    IngestionLogResponse,
    IngestionStatsResponse,
    ManualAssignRequest,
    PollResponse,
    ReceivedAttachmentResponse,
    ReceivedEmailAssignRequest,
    ReceivedEmailDetailResponse,
    ReceivedEmailListResponse,
    ReceivedEmailResponse,
    SkipRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_service():
    from app.domains.email_ingestion.service import EmailIngestionService
    return EmailIngestionService()


def _is_uuid(value) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except (TypeError, ValueError):
        return False


def _require_account(db, staff, account_id: str, manage: bool = False) -> None:
    """404 unless the account is the staff member's own or belongs to one of
    their companies. manage (edit, test, delete): someone else's own mailbox
    is the owner's or an admin's alone - 403 for a colleague (audit 2026-11)."""
    from app.domains.email_ingestion.access import may_manage

    ids = company_ids(db, staff)
    if ids is None:
        return
    row = db.query(EmailAccount.company_id, EmailAccount.owner_staff_id).filter(
        EmailAccount.id == account_id
    ).first() if _is_uuid(account_id) else None
    if row is not None and row[1] and str(row[1]) == str(staff.id):
        return
    if row is None or not row[0] or str(row[0]) not in ids:
        raise HTTPException(status_code=404, detail="Account not found")
    account = {"company_id": row[0], "owner_staff_id": row[1]}
    if manage and not may_manage(db, staff, account):
        raise HTTPException(
            status_code=403,
            detail="This is someone else's own mailbox. Only they or an admin can change it.",
        )


def _require_own_company(db, staff, company_id) -> None:
    """Someone who isn't an admin files an account under one of their companies"""
    ids = company_ids(db, staff)
    if ids is not None and (not company_id or str(company_id) not in ids):
        raise HTTPException(
            status_code=400, detail="Choose one of your companies for this account"
        )


def _mail_scope(db, staff, model):
    """Mail on a claim the staff member may see, or unmatched mail that came
    into one of their companies' accounts (None = no limit)"""
    ids = company_ids(db, staff)
    if ids is None:
        return None
    if not ids:
        return false()
    own_accounts = select(EmailAccount.id).where(EmailAccount.company_id.in_(ids))
    parts = [
        claim_condition(db, staff, model.matched_claim_id),
        and_(model.matched_claim_id.is_(None), model.email_account_id.in_(own_accounts)),
    ]
    if model is EmailIngestionLog:
        # The other attachments of an email that matched a visible claim
        matched = aliased(EmailIngestionLog)
        parts.append(model.message_id.in_(
            select(matched.message_id).where(
                claim_condition(db, staff, matched.matched_claim_id)
            )
        ))
    return or_(*parts)


def _require_mail(db, staff, model, row_id: str, label: str) -> None:
    scope = _mail_scope(db, staff, model)
    if scope is None:
        if not _is_uuid(row_id):
            raise HTTPException(status_code=404, detail=f"{label} not found")
        return
    row = db.query(model.id).filter(
        model.id == row_id, scope
    ).first() if _is_uuid(row_id) else None
    if row is None:
        raise HTTPException(status_code=404, detail=f"{label} not found")


def require_visible_log(db, staff, log_id: str) -> None:
    """404 unless the staff member may see this attachment's review log -
    for filing it on a claim from outside this router"""
    _require_mail(db, staff, EmailIngestionLog, log_id, "Email attachment")


def _serve(entry, label: str):
    """A stored file, read from storage with no database connection held"""
    from app.domains.client import document_files

    if entry is None:
        raise HTTPException(status_code=404, detail=f"{label} not found")
    try:
        data = document_files.read_hub_file(entry)
    except Exception as e:
        logger.warning(f"{label} could not be read: {e}")
        raise HTTPException(status_code=404, detail="The file could not be read from storage")
    return document_files.inline_response(data, entry["filename"], entry["mime_type"])


# ============================================================
# Email Account endpoints
# ============================================================

@router.get("/accounts", response_model=List[EmailAccountResponse])
def list_accounts(
    mine: bool = Query(False, description="Only the accounts that are the caller's own mailboxes (My Profile)"),
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Get all email accounts"""
    service = _get_service()
    accounts = service.get_all_accounts()
    if mine:
        return [
            a for a in accounts
            if a.get('owner_staff_id') and str(a['owner_staff_id']) == str(current_staff.id)
        ]
    ids = company_ids(db, current_staff)
    if ids is not None:
        # The accounts they may send from (access.may_send_from): their
        # companies' and their own mailboxes
        accounts = [
            a for a in accounts
            if (a.get('company_id') and str(a['company_id']) in ids)
            or (a.get('owner_staff_id') and str(a['owner_staff_id']) == str(current_staff.id))
        ]
    return accounts


@router.post("/accounts", response_model=EmailAccountResponse)
def create_account(
    data: EmailAccountCreate,
    mine: bool = Query(False, description="The caller's own mailbox (added from My Profile)"),
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Create a new email account"""
    _require_own_company(db, current_staff, data.company_id)
    service = _get_service()
    try:
        payload = data.dict()
        if mine:
            payload['owner_staff_id'] = str(current_staff.id)
        account = service.create_account(payload)
        return account
    except Exception as e:
        logger.error(f"Error creating email account: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/accounts/{account_id}", response_model=EmailAccountResponse)
def get_account(
    account_id: str,
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Get a single email account"""
    _require_account(db, current_staff, account_id)
    service = _get_service()
    account = service.get_account(account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


@router.put("/accounts/{account_id}", response_model=EmailAccountResponse)
def update_account(
    account_id: str,
    data: EmailAccountUpdate,
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Update an email account"""
    from app.domains.email_ingestion.access import check_credential_destination

    _require_account(db, current_staff, account_id, manage=True)
    if 'company_id' in data.dict(exclude_unset=True):
        _require_own_company(db, current_staff, data.company_id)
    service = _get_service()
    update_data = data.dict(exclude_unset=True)
    stored = service.get_account(account_id)
    if not stored:
        raise HTTPException(status_code=404, detail="Account not found")
    try:
        check_credential_destination(stored, update_data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        account = service.update_account(account_id, update_data)
        if not account:
            raise HTTPException(status_code=404, detail="Account not found")
        return account
    except Exception as e:
        logger.error(f"Error updating email account: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/accounts/{account_id}")
def delete_account(
    account_id: str,
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Delete an email account"""
    _require_account(db, current_staff, account_id, manage=True)
    service = _get_service()
    result = service.delete_account(account_id)
    if not result:
        raise HTTPException(status_code=404, detail="Account not found")
    return {"success": True}


@router.post("/accounts/{account_id}/test", response_model=EmailAccountTestResponse)
def test_account(
    account_id: str,
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Test IMAP connection for an account"""
    _require_account(db, current_staff, account_id, manage=True)
    service = _get_service()
    return service.test_account(account_id)


# ============================================================
# OAuth endpoints
# ============================================================

@router.get("/oauth/authorize")
def get_oauth_url(current_staff: Staff = Depends(get_current_staff)):
    """Get Google OAuth authorization URL for email account"""
    service = _get_service()
    try:
        return service.get_oauth_url()
    except Exception as e:
        logger.error(f"Error generating OAuth URL: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/oauth/callback", response_model=EmailAccountResponse)
def oauth_callback(
    data: EmailAccountOAuthConnect,
    mine: bool = Query(False, description="The caller's own mailbox (connected from My Profile)"),
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Complete OAuth flow and create/update email account"""
    _require_own_company(db, current_staff, data.company_id)
    service = _get_service()
    try:
        extra = {}
        if data.company_id:
            extra["company_id"] = str(data.company_id)
        if mine:
            # Signing in to the mailbox proves it's theirs, even if it was added before
            extra["owner_staff_id"] = str(current_staff.id)
        if data.sender_name:
            extra["sender_name"] = data.sender_name
        if data.sender_phone:
            extra["sender_phone"] = data.sender_phone
        result = service.connect_oauth(data.code, extra)
        return result
    except Exception as e:
        logger.error(f"OAuth callback error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# ============================================================
# Polling endpoints
# ============================================================

def _parse_since(since: Optional[str]) -> Optional[datetime]:
    """Parse a YYYY-MM-DD backfill date into a tz-aware datetime."""
    if not since:
        return None
    try:
        return datetime.strptime(since, "%Y-%m-%d").replace(
            tzinfo=timezone.utc
        )
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid 'since' date {since!r}; expected YYYY-MM-DD",
        )

@router.post("/poll", response_model=BatchPollResponse)
def poll_all(
    since: Optional[str] = Query(
        None, description="Backfill from this date (YYYY-MM-DD)"
    ),
    limit: int = Query(200, le=5000, description="Max emails per account"),
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Poll all active email accounts for new insurance estimates.

    Matches are queued for review, not applied - a claim and its revision are
    only created once a reviewer confirms via /logs/{id}/assign.
    """
    service = _get_service()
    try:
        return service.poll_all_accounts(
            since_date=_parse_since(since), limit=limit,
            company_ids=company_ids(db, current_staff),
        )
    except Exception as e:
        logger.error(f"Error polling all accounts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/poll/{account_id}", response_model=PollResponse)
def poll_account(
    account_id: str,
    since: Optional[str] = Query(
        None, description="Backfill from this date (YYYY-MM-DD)"
    ),
    limit: int = Query(200, le=5000, description="Max emails to scan"),
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Poll a specific email account"""
    _require_account(db, current_staff, account_id)
    service = _get_service()
    try:
        return service.poll_account(
            account_id, since_date=_parse_since(since), limit=limit,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error polling account {account_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Log endpoints
# ============================================================

@router.get("/logs", response_model=List[IngestionLogResponse])
def list_logs(
    status: Optional[str] = Query(None, description="Filter by status"),
    account_id: Optional[str] = Query(None, description="Filter by account"),
    claim_id: Optional[str] = Query(None, description="Filter by matched claim"),
    has_attachment: bool = Query(
        False, description="Only rows whose attachment was stored"
    ),
    search: Optional[str] = Query(
        None,
        description="Subject / sender / file name / email body, or the matched "
                    "client's name, address, policy number or claim number contains",
    ),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Get ingestion logs with optional filters"""
    service = _get_service()
    return service.get_logs(
        status=status, account_id=account_id, limit=limit, offset=offset,
        claim_id=claim_id, has_attachment=has_attachment, search=search,
        scope=_mail_scope(db, current_staff, EmailIngestionLog),
    )


@router.get("/logs/pending", response_model=List[IngestionLogResponse])
def list_pending_logs(
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Get logs that need manual review"""
    service = _get_service()
    return service.get_pending_logs(
        scope=_mail_scope(db, current_staff, EmailIngestionLog)
    )


@router.get("/stats", response_model=IngestionStatsResponse)
def get_stats(
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Get ingestion statistics"""
    service = _get_service()
    return service.get_stats(
        scope=_mail_scope(db, current_staff, EmailIngestionLog)
    )


@router.post("/logs/{log_id}/assign", response_model=IngestionLogResponse)
def assign_log(
    log_id: str,
    data: ManualAssignRequest,
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Manually assign a pending log to a client/claim"""
    _require_mail(db, current_staff, EmailIngestionLog, log_id, "Log")
    require_client(db, current_staff, data.client_id)
    if data.claim_id:
        require_claim(db, current_staff, data.claim_id)
    service = _get_service()
    try:
        return service.manual_assign(log_id, data.dict())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error assigning log {log_id}: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/logs/{log_id}/skip", response_model=IngestionLogResponse)
def skip_log(
    log_id: str,
    data: SkipRequest,
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Skip a pending log"""
    _require_mail(db, current_staff, EmailIngestionLog, log_id, "Log")
    service = _get_service()
    try:
        return service.skip_log(log_id, data.reason, data.reviewed_by)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error skipping log {log_id}: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# ============================================================
# Received emails (all inbound mail, attachment or not)
# ============================================================

@router.get("/received", response_model=ReceivedEmailListResponse)
def list_received_emails(
    claim_id: Optional[str] = Query(None, description="Only emails linked to this claim"),
    account_id: Optional[str] = Query(None, description="Filter by account"),
    unmatched: bool = Query(False, description="Only emails not linked to a claim"),
    search: Optional[str] = Query(None, description="Subject / sender / snippet contains"),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """List received emails, newest first (bodies omitted)."""
    service = _get_service()
    return service.get_received_emails(
        claim_id=claim_id, account_id=account_id, unmatched=unmatched,
        search=search, limit=limit, offset=offset,
        scope=_mail_scope(db, current_staff, ReceivedEmail),
    )


@router.post("/claims/{claim_id}/check-inbox", response_model=InboxCheckResponse)
def check_claim_inbox(
    claim_id: str,
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Search the connected inboxes for the claim's mail now instead of at
    the next morning poll. What's found is listed by /received?claim_id=.

    A plain def, so FastAPI runs it - IMAP round-trips per account - on a
    worker thread rather than the event loop.
    """
    if not _is_uuid(claim_id):
        raise HTTPException(status_code=404, detail="Claim not found")
    require_claim(db, current_staff, claim_id)
    # Give the connection back before the slow part: Neon drops ones left
    # idle in a transaction
    db.rollback()
    from app.domains.email_ingestion.claim_inbox import ClaimInboxService
    try:
        return ClaimInboxService().check_claim_inbox(claim_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error checking inbox for claim {claim_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Inbox check failed: {e}")


@router.get("/received/{email_id}", response_model=ReceivedEmailDetailResponse)
def get_received_email(
    email_id: str,
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """One received email with its body."""
    _require_mail(db, current_staff, ReceivedEmail, email_id, "Received email")
    service = _get_service()
    email = service.get_received_email(email_id)
    if not email:
        raise HTTPException(status_code=404, detail="Received email not found")
    return email


@router.get("/received/{email_id}/attachments", response_model=List[ReceivedAttachmentResponse])
def list_received_attachments(
    email_id: str,
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """The files on one received email: the ones stored open through
    /received/{id}/files/{file_id}, and a PDF waiting for review can be
    filed on the claim."""
    _require_mail(db, current_staff, ReceivedEmail, email_id, "Received email")
    items = _get_service().get_received_attachments(email_id)
    if items is None:
        raise HTTPException(status_code=404, detail="Received email not found")
    return items


@router.get("/received/{email_id}/files/{file_id}")
def get_received_attachment_file(
    email_id: str,
    file_id: str,
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """One stored file of a received email, shown in the page. Takes a
    login and serves only a file on an email the person may see, unlike
    the files router's download URLs."""
    _require_mail(db, current_staff, ReceivedEmail, email_id, "Received email")
    db.rollback()
    return _serve(
        _get_service().received_attachment_file(email_id, file_id), "Attachment"
    )


@router.get("/logs/{log_id}/file")
def get_log_file(
    log_id: str,
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """A review log's stored PDF, with the same login and scope as the log"""
    _require_mail(db, current_staff, EmailIngestionLog, log_id, "Log")
    db.rollback()
    return _serve(_get_service().log_file(log_id), "Attachment")


@router.post("/logs/{log_id}/extract-estimate", response_model=EstimateExtractionResponse)
def extract_log_estimate(
    log_id: str,
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Read an emailed PDF as an insurance estimate - its sections and
    amounts - for the claim's Add revision dialog, as the dialog reads an
    uploaded one. Nothing is saved: the revision is made when the dialog
    is saved, with the log's id (see client/api.py add_negotiation).

    A plain def: reading the PDF (and the vision fallback) runs on a worker
    thread."""
    import os
    import tempfile

    from app.domains.client import document_files
    from app.domains.client.negotiation_pdf_service import extract_summary_from_pdf

    _require_mail(db, current_staff, EmailIngestionLog, log_id, "Log")
    db.rollback()
    service = _get_service()
    try:
        file_id = service.pending_log_file_id(log_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    entry = service.log_file(log_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Attachment not found")
    try:
        data = document_files.read_hub_file(entry)
    except Exception as e:
        logger.warning(f"Attachment of log {log_id} could not be read: {e}")
        raise HTTPException(status_code=404, detail="The file could not be read from storage")

    fd, path = tempfile.mkstemp(suffix=".pdf")
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data)
        del data
        result = extract_summary_from_pdf(path)
    except Exception as e:
        logger.error(f"Estimate extraction failed for log {log_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Couldn't read the estimate: {e}")
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
    return {
        "sections": result["sections"],
        "totals": result["totals"],
        "validation": result["validation"],
        "file_id": file_id,
        "file_name": entry["filename"],
    }


@router.post("/received/{email_id}/assign", response_model=ReceivedEmailResponse)
def assign_received_email(
    email_id: str,
    data: ReceivedEmailAssignRequest,
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Link a received email to a claim, or unlink it (claim_id null)."""
    _require_mail(db, current_staff, ReceivedEmail, email_id, "Received email")
    if data.claim_id:
        require_claim(db, current_staff, data.claim_id)
    service = _get_service()
    try:
        return service.assign_received_email(
            email_id, str(data.claim_id) if data.claim_id else None
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
