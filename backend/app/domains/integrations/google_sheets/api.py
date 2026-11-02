"""
Google Sheets integration API endpoints
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing import List

from app.core.database_factory import get_db
from app.domains.auth.dependencies import require_screen
from app.domains.client.models import Client
from app.domains.integrations.google_sheets.row_matches import candidates_for, list_pending
from app.domains.integrations.google_sheets.schemas import (
    RowMatchDecision,
    SyncRequest,
    SyncRowRequest,
    SyncStats,
    SyncLogResponse,
    WebhookPayload,
    WebhookResponse
)
from app.domains.integrations.google_sheets.sync_service import GoogleSheetsSyncService
from app.domains.integrations.google_sheets.client import GoogleSheetsClient
from app.domains.water_mitigation.models import WaterMitigationJob, WMSheetRowMatch

logger = logging.getLogger(__name__)

router = APIRouter()

# The View grant (water_mitigation_view) has no sheet sync
_sheet_sync_access = Depends(require_screen("water_mitigation"))


@router.post("/sync", response_model=SyncStats)
async def sync_google_sheets(
    request: SyncRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Trigger full sync from Google Sheets

    This will:
    1. Read all rows from the specified sheet(s)
    2. Match rows to existing jobs by address (fuzzy matching)
    3. Update existing jobs or create new ones

    Supports both single sheet and multiple sheets:
    - Single sheet: Use sheet_name parameter
    - Multiple sheets: Use sheet_names parameter (e.g., ["Angel", "Vanessa"])
    """
    sync_service = GoogleSheetsSyncService(db, request.spreadsheet_id)

    # Run sync in background for large sheets
    if request.sync_type == "full":
        # Check if multiple sheets requested
        if request.sheet_names and len(request.sheet_names) > 0:
            # Multi-sheet sync
            stats = await sync_service.sync_multiple_sheets(
                sheet_names=request.sheet_names,
                skip_header=True
            )
        else:
            # Single sheet sync (backward compatible)
            stats = await sync_service.sync_all_rows(
                sheet_name=request.sheet_name,
                skip_header=True
            )
        return stats
    else:
        raise HTTPException(
            status_code=400,
            detail="Only 'full' sync type is currently supported"
        )


@router.post("/sync-row", response_model=WebhookResponse)
async def sync_single_row(
    request: SyncRowRequest,
    db: Session = Depends(get_db)
):
    """
    Sync a single row from Google Sheets

    This is useful for:
    - Testing individual row updates
    - Manual sync after editing a specific row
    """
    try:
        sync_service = GoogleSheetsSyncService(db, request.spreadsheet_id)
        client = GoogleSheetsClient(request.spreadsheet_id)

        # Get the specific row
        range_name = f"{request.sheet_name}!A{request.row_number}:Z{request.row_number}"
        rows = await client.get_sheet_values(range_name)

        if not rows:
            raise HTTPException(
                status_code=404,
                detail=f"Row {request.row_number} not found in sheet"
            )

        row = rows[0]
        job = await sync_service.sync_single_row(row, request.row_number)

        if job:
            return WebhookResponse(
                status="success",
                message=f"Row {request.row_number} synced successfully",
                job_id=str(job.id),
                changes_detected=True
            )
        else:
            return WebhookResponse(
                status="skipped",
                message=f"Row {request.row_number} is empty, invalid or waiting on a decision",
                changes_detected=False
            )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to sync row: {str(e)}"
        )


@router.post("/webhook", response_model=WebhookResponse)
async def handle_sheet_webhook(
    payload: WebhookPayload,
    db: Session = Depends(get_db)
):
    """
    Handle webhook from Google Sheets

    This endpoint is designed to be called by:
    - Google Apps Script (when row is edited)
    - Zapier/Make.com automation
    - Other webhook services

    Expected payload format:
    ```json
    {
        "spreadsheet_id": "your-spreadsheet-id",
        "sheet_name": "Sheet1",
        "row_number": 5,
        "event_type": "row_update",
        "row_data": ["123 Main St", "John Doe", "555-1234", ...]
    }
    ```
    """
    try:
        sync_service = GoogleSheetsSyncService(db, payload.spreadsheet_id)

        # If row_data is provided in webhook, use it directly
        if payload.row_data:
            row = payload.row_data
        else:
            # Otherwise, fetch from Google Sheets
            client = GoogleSheetsClient(payload.spreadsheet_id)
            range_name = f"{payload.sheet_name}!A{payload.row_number}:Z{payload.row_number}"
            rows = await client.get_sheet_values(range_name)

            if not rows:
                return WebhookResponse(
                    status="error",
                    message=f"Row {payload.row_number} not found",
                    changes_detected=False
                )

            row = rows[0]

        # Sync the row
        job = await sync_service.sync_single_row(row, payload.row_number)

        if job:
            return WebhookResponse(
                status="success",
                message=f"Webhook processed: {payload.event_type} on row {payload.row_number}",
                job_id=str(job.id),
                changes_detected=True
            )
        else:
            return WebhookResponse(
                status="skipped",
                message=f"Row {payload.row_number} is empty, invalid or waiting on a decision",
                changes_detected=False
            )

    except Exception as e:
        return WebhookResponse(
            status="error",
            message=f"Webhook processing failed: {str(e)}",
            changes_detected=False
        )


@router.get("/sync-history", response_model=List[SyncLogResponse])
async def get_sync_history(
    limit: int = 10,
    db: Session = Depends(get_db)
):
    """
    Get recent Google Sheets sync history
    """
    # Use empty spreadsheet_id since we're just querying logs
    sync_service = GoogleSheetsSyncService(db, "")
    logs = await sync_service.get_sync_history(limit)

    return [
        SyncLogResponse(
            id=str(log.id),
            integration_type=log.integration_type,
            sync_type=log.sync_type,
            status=log.status,
            rows_processed=log.rows_processed or 0,
            rows_created=log.rows_created or 0,
            rows_updated=log.rows_updated or 0,
            rows_failed=log.rows_failed or 0,
            error_message=log.error_message,
            started_at=log.started_at,
            completed_at=log.completed_at
        )
        for log in logs
    ]


@router.post("/cleanup-duplicates")
def cleanup_duplicate_jobs(
    db: Session = Depends(get_db)
):
    """
    Find and deactivate duplicate jobs that share the same
    (google_sheet_row_number, google_sheet_name).

    Keeps the most recently updated job and deactivates the rest.
    This should be run once to clean up existing duplicates before
    applying the unique index migration.
    """
    sync_service = GoogleSheetsSyncService(db, "")
    result = sync_service.cleanup_duplicate_jobs()
    return result


@router.get("/row-matches")
def list_row_matches(
    db: Session = Depends(get_db),
    current_staff=_sheet_sync_access
):
    """Sheet rows waiting on whether they are the same as something entered by hand"""
    return list_pending(db, current_staff)


@router.post("/row-matches/{match_id}/resolve")
def resolve_row_match(
    match_id: str,
    body: RowMatchDecision,
    db: Session = Depends(get_db),
    current_staff=_sheet_sync_access
):
    """
    Decide a held sheet row.

    same: the row joins the job or client picked (candidate_type, candidate_id).
    different: the row becomes its own job and client.
    """
    match = db.query(WMSheetRowMatch).filter(WMSheetRowMatch.id == match_id).first()
    if not match:
        raise HTTPException(status_code=404, detail="Row match not found")
    if match.status != 'pending':
        raise HTTPException(status_code=409, detail="Someone has already decided this row.")
    # As the list hides a row whose candidates the staff member can't see
    candidates = candidates_for(db, current_staff, match)
    if not candidates:
        raise HTTPException(status_code=404, detail="Row match not found")

    sync_service = GoogleSheetsSyncService(db, "")
    if sync_service._find_job_by_row_number(match.row_number, match.sheet_name):
        match.status = 'closed'
        db.commit()
        raise HTTPException(status_code=409, detail="This row is already on a job.")

    try:
        if body.decision == 'different':
            job = sync_service.keep_row_separate(match, current_staff.id)
        else:
            if not any(c['type'] == body.candidate_type and c['id'] == body.candidate_id for c in candidates):
                raise HTTPException(status_code=409, detail="That job or client is no longer at this address.")
            if body.candidate_type == 'job':
                record = db.query(WaterMitigationJob).filter(WaterMitigationJob.id == body.candidate_id).first()
                job = sync_service.link_row_to_job(match, record, current_staff.id)
            else:
                record = db.query(Client).filter(Client.id == body.candidate_id).first()
                job = sync_service.link_row_to_client(match, record, current_staff.id)
    except IntegrityError as e:
        db.rollback()
        logger.error(f"Could not save the decision on row match {match_id}: {e}")
        raise HTTPException(
            status_code=409,
            detail="The decision couldn't be saved. The row may have just gone onto a job, so reload and check.",
        )

    return {'status': match.status, 'job_id': str(job.id)}


@router.get("/sheet-metadata")
async def get_sheet_metadata(
    spreadsheet_id: str
):
    """
    Get Google Sheets metadata (sheet names, properties, etc.)

    Useful for:
    - Discovering available sheets
    - Validating spreadsheet access
    """
    try:
        client = GoogleSheetsClient(spreadsheet_id)
        metadata = await client.get_sheet_metadata()

        return {
            "spreadsheet_id": metadata.get("spreadsheetId"),
            "title": metadata.get("properties", {}).get("title"),
            "sheets": [
                {
                    "name": sheet["properties"]["title"],
                    "sheet_id": sheet["properties"]["sheetId"],
                    "row_count": sheet["properties"]["gridProperties"]["rowCount"],
                    "column_count": sheet["properties"]["gridProperties"]["columnCount"]
                }
                for sheet in metadata.get("sheets", [])
            ]
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get sheet metadata: {str(e)}"
        )
