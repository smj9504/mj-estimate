"""
Email Ingestion API endpoints.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from app.domains.email_ingestion.schemas import (
    BatchPollResponse,
    EmailAccountCreate,
    EmailAccountResponse,
    EmailAccountTestResponse,
    EmailAccountUpdate,
    IngestionLogResponse,
    IngestionStatsResponse,
    ManualAssignRequest,
    PollResponse,
    SkipRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_service():
    from app.domains.email_ingestion.service import EmailIngestionService
    return EmailIngestionService()


# ============================================================
# Email Account endpoints
# ============================================================

@router.get("/accounts", response_model=List[EmailAccountResponse])
async def list_accounts():
    """Get all email accounts"""
    service = _get_service()
    accounts = service.get_all_accounts()
    return accounts


@router.post("/accounts", response_model=EmailAccountResponse)
async def create_account(data: EmailAccountCreate):
    """Create a new email account"""
    service = _get_service()
    try:
        account = service.create_account(data.dict())
        return account
    except Exception as e:
        logger.error(f"Error creating email account: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/accounts/{account_id}", response_model=EmailAccountResponse)
async def get_account(account_id: str):
    """Get a single email account"""
    service = _get_service()
    account = service.get_account(account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


@router.put("/accounts/{account_id}", response_model=EmailAccountResponse)
async def update_account(account_id: str, data: EmailAccountUpdate):
    """Update an email account"""
    service = _get_service()
    try:
        update_data = data.dict(exclude_unset=True)
        account = service.update_account(account_id, update_data)
        if not account:
            raise HTTPException(status_code=404, detail="Account not found")
        return account
    except Exception as e:
        logger.error(f"Error updating email account: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/accounts/{account_id}")
async def delete_account(account_id: str):
    """Delete an email account"""
    service = _get_service()
    result = service.delete_account(account_id)
    if not result:
        raise HTTPException(status_code=404, detail="Account not found")
    return {"success": True}


@router.post("/accounts/{account_id}/test", response_model=EmailAccountTestResponse)
async def test_account(account_id: str):
    """Test IMAP connection for an account"""
    service = _get_service()
    return service.test_account(account_id)


# ============================================================
# Polling endpoints
# ============================================================

@router.post("/poll", response_model=BatchPollResponse)
async def poll_all():
    """Poll all active email accounts for new insurance estimates"""
    service = _get_service()
    try:
        return service.poll_all_accounts()
    except Exception as e:
        logger.error(f"Error polling all accounts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/poll/{account_id}", response_model=PollResponse)
async def poll_account(account_id: str):
    """Poll a specific email account"""
    service = _get_service()
    try:
        return service.poll_account(account_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error polling account {account_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Log endpoints
# ============================================================

@router.get("/logs", response_model=List[IngestionLogResponse])
async def list_logs(
    status: Optional[str] = Query(None, description="Filter by status"),
    account_id: Optional[str] = Query(None, description="Filter by account"),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
):
    """Get ingestion logs with optional filters"""
    service = _get_service()
    return service.get_logs(status=status, account_id=account_id, limit=limit, offset=offset)


@router.get("/logs/pending", response_model=List[IngestionLogResponse])
async def list_pending_logs():
    """Get logs that need manual review"""
    service = _get_service()
    return service.get_pending_logs()


@router.get("/stats", response_model=IngestionStatsResponse)
async def get_stats():
    """Get ingestion statistics"""
    service = _get_service()
    return service.get_stats()


@router.post("/logs/{log_id}/assign", response_model=IngestionLogResponse)
async def assign_log(log_id: str, data: ManualAssignRequest):
    """Manually assign a pending log to a client/claim"""
    service = _get_service()
    try:
        return service.manual_assign(log_id, data.dict())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error assigning log {log_id}: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/logs/{log_id}/skip", response_model=IngestionLogResponse)
async def skip_log(log_id: str, data: SkipRequest):
    """Skip a pending log"""
    service = _get_service()
    try:
        return service.skip_log(log_id, data.reason, data.reviewed_by)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error skipping log {log_id}: {e}")
        raise HTTPException(status_code=400, detail=str(e))
