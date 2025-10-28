"""
Google Sheets integration API endpoints
"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List

from app.core.database_factory import get_db
from app.domains.integrations.google_sheets.schemas import (
    SyncRequest,
    SyncRowRequest,
    SyncStats,
    SyncLogResponse,
    WebhookPayload,
    WebhookResponse
)
from app.domains.integrations.google_sheets.sync_service import GoogleSheetsSyncService
from app.domains.integrations.google_sheets.client import GoogleSheetsClient

router = APIRouter()


@router.post("/sync", response_model=SyncStats)
async def sync_google_sheets(
    request: SyncRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Trigger full sync from Google Sheets

    This will:
    1. Read all rows from the specified sheet
    2. Match rows to existing jobs by address (fuzzy matching)
    3. Update existing jobs or create new ones
    """
    sync_service = GoogleSheetsSyncService(db, request.spreadsheet_id)

    # Run sync in background for large sheets
    if request.sync_type == "full":
        # For now, run synchronously for testing
        # In production, consider using background_tasks
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
                message=f"Row {request.row_number} is empty or invalid",
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
                message=f"Row {payload.row_number} is empty or invalid",
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
