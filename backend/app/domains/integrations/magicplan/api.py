"""
MagicPlan Integration API Endpoints

Provides endpoints for:
- Searching MagicPlan projects and matching to WM jobs
- Syncing photos from MagicPlan
- Importing floor plans for WM sketches
"""

import asyncio
import logging
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database_factory import get_database

from .client import MagicPlanClient
from .schemas import (
    MagicPlanFloorPlanImportRequest,
    MagicPlanFloorPlanImportResult,
    MagicPlanFloorPlanInfo,
    MagicPlanProjectSearchRequest,
    MagicPlanProjectSearchResponse,
    MagicPlanSyncProgress,
    MagicPlanSyncRequest,
    MagicPlanSyncResult,
)
from .sync_service import (
    MagicPlanSyncService,
    SYNC_RESULT_TTL,
    read_sync_status,
    write_sync_status,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["MagicPlan"])


def get_db():
    database = get_database()
    db = database.get_session()
    try:
        yield db
    finally:
        db.close()


def _check_configured():
    if not settings.MAGICPLAN_API_KEY or not settings.MAGICPLAN_CUSTOMER_ID:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MagicPlan integration is not configured",
        )


# ── Project Search ───────────────────────────────────────────

@router.get(
    "/projects/search",
    response_model=MagicPlanProjectSearchResponse,
    summary="Search MagicPlan projects for a WM job",
)
async def search_projects(
    job_id: str,
    query: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Search MagicPlan projects and match against a WM job address.
    Returns auto-matched project (if found) and candidate list.
    """
    _check_configured()

    service = MagicPlanSyncService(db)
    return await service.search_projects_for_job(job_id, job_address=query)


@router.get(
    "/projects",
    summary="List all MagicPlan projects",
)
async def list_projects(
    query: Optional[str] = None,
    page: int = 1,
    per_page: int = 50,
):
    """List or search MagicPlan projects."""
    _check_configured()

    async with MagicPlanClient() as client:
        if query:
            projects = await client.search_projects(query)
        else:
            projects = await client.list_projects(page=page, per_page=per_page)
    return projects


# ── Photo Sync ───────────────────────────────────────────────

def run_sync_in_background(job_id: str, project_id: str, project_name: str) -> None:
    """On a worker thread with an event loop and a DB session of its own"""
    async def run():
        database = get_database()
        db = database.get_session()
        try:
            result = await MagicPlanSyncService(db).sync_photos(job_id, project_id, project_name)
            if not result.success and result.errors:
                logger.error(f"MagicPlan sync errors for job {job_id}: {result.errors}")
        except Exception as e:
            logger.error(f"MagicPlan sync crashed for job {job_id}: {e}", exc_info=True)
            await write_sync_status(
                job_id, {"status": "failed", "message": f"MagicPlan sync failed: {e}"}, ttl=SYNC_RESULT_TTL
            )
        finally:
            db.close()

    asyncio.run(run())


@router.post(
    "/jobs/{job_id}/sync",
    response_model=MagicPlanSyncProgress,
    summary="Start syncing photos and videos from a MagicPlan project to a WM job",
)
async def sync_magicplan_photos(
    job_id: str,
    request: MagicPlanSyncRequest,
    background_tasks: BackgroundTasks,
):
    """
    Start syncing a MagicPlan project's photos and videos to a Water Mitigation job,
    creating WMPhoto records with source='magicplan'. Poll /sync/status for how it goes.
    """
    _check_configured()

    current = await read_sync_status(job_id)
    if current and current.get("status") == "running":
        return MagicPlanSyncProgress(status="running", message="Sync already in progress")

    await write_sync_status(job_id, {"status": "running", "message": "Starting sync..."})
    background_tasks.add_task(
        run_sync_in_background,
        job_id,
        request.magicplan_project_id,
        request.magicplan_project_name or "",
    )
    return MagicPlanSyncProgress(status="running", message="Sync started in background")


@router.get(
    "/jobs/{job_id}/sync/status",
    response_model=MagicPlanSyncProgress,
    summary="How a MagicPlan sync is getting on",
)
async def magicplan_sync_status(job_id: str):
    current = await read_sync_status(job_id)
    return MagicPlanSyncProgress(**current) if current else MagicPlanSyncProgress(status="idle")


@router.post(
    "/jobs/{job_id}/sync/cancel",
    response_model=MagicPlanSyncProgress,
    summary="Stop a MagicPlan sync after the file it's on",
)
async def cancel_magicplan_sync(job_id: str):
    current = await read_sync_status(job_id)
    if not current or current.get("status") != "running":
        return MagicPlanSyncProgress(status="idle", message="No sync in progress to cancel")
    current["status"] = "cancelled"
    current["message"] = "Stopping after the current file..."
    await write_sync_status(job_id, current)
    return MagicPlanSyncProgress(**current)


# ── Floor Plan Import ────────────────────────────────────────

@router.get(
    "/projects/{project_id}/floor-plans",
    response_model=List[MagicPlanFloorPlanInfo],
    summary="Get available floor plans from MagicPlan project",
)
async def get_floor_plans(
    project_id: str,
    db: Session = Depends(get_db),
):
    """Get available floor plan images from a MagicPlan project."""
    _check_configured()

    service = MagicPlanSyncService(db)
    return await service.get_available_floor_plans(project_id)


@router.post(
    "/jobs/{job_id}/import-floor-plan",
    response_model=MagicPlanFloorPlanImportResult,
    summary="Import floor plan from MagicPlan into WM sketch",
)
async def import_floor_plan(
    job_id: str,
    request: MagicPlanFloorPlanImportRequest,
    db: Session = Depends(get_db),
):
    """
    Import a floor plan image from MagicPlan as background for WM sketch.
    """
    _check_configured()

    service = MagicPlanSyncService(db)
    result = await service.import_floor_plan(
        job_id=job_id,
        magicplan_project_id=request.magicplan_project_id,
        plan_id=request.plan_id,
        floor_index=request.floor_index or 0,
        target_wm_floor_id=request.target_wm_floor_id,
    )

    if not result.success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result.error_message or "Failed to import floor plan",
        )

    return result


# ── Health Check ─────────────────────────────────────────────

@router.get("/health", summary="MagicPlan integration health check")
async def magicplan_health():
    """Check MagicPlan API connectivity."""
    if not settings.MAGICPLAN_API_KEY or not settings.MAGICPLAN_CUSTOMER_ID:
        return {
            "service": "magicplan",
            "configured": False,
            "healthy": False,
        }

    async with MagicPlanClient() as client:
        healthy = await client.health_check()

    return {
        "service": "magicplan",
        "configured": True,
        "healthy": healthy,
    }
