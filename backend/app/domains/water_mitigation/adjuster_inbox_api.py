"""
Adjuster mail endpoints for water mitigation jobs: what the adjuster has
sent about a job, and an inbox check to run before following up.
"""

import asyncio
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.domains.auth.dependencies import require_screen

from .adjuster_inbox import AdjusterInboxService
from .job_access import job_access

logger = logging.getLogger(__name__)

# Adjuster correspondence stays with the full grant, like sending to the
# adjuster; the View grant doesn't see it
router = APIRouter(dependencies=[Depends(require_screen("water_mitigation"))])

# 404 unless the job is one the staff member may see
_job_access = Depends(job_access)


@router.get("/jobs/{job_id}/adjuster-emails", dependencies=[_job_access])
def list_adjuster_emails(job_id: UUID):
    """Inbound mail about the job already found by the inbox polls."""
    try:
        return AdjusterInboxService().list_job_emails(str(job_id))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/jobs/{job_id}/adjuster-emails/check", dependencies=[_job_access])
async def check_adjuster_emails(job_id: UUID):
    """Search the connected inboxes for the job's adjuster mail now, then
    list everything on the job."""
    service = AdjusterInboxService()
    try:
        # IMAP round-trips per account: keep them off the event loop
        result = await asyncio.to_thread(service.check_job_inbox, str(job_id))
        return {**result, **service.list_job_emails(str(job_id))}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error checking adjuster emails: {e}")
        raise HTTPException(status_code=500, detail=f"Inbox check failed: {e}")
