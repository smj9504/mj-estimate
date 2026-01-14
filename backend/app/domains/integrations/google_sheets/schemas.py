"""
Google Sheets integration schemas
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime

from app.core.config import settings


def get_default_sheet_name() -> str:
    """Get default sheet name from settings"""
    return settings.GOOGLE_SHEETS_WATER_MITIGATION_SHEET_NAME or "Sheet1"


def get_default_sheet_names() -> Optional[List[str]]:
    """Get default sheet names from settings"""
    if settings.GOOGLE_SHEETS_WATER_MITIGATION_SHEET_NAMES:
        return [s.strip() for s in settings.GOOGLE_SHEETS_WATER_MITIGATION_SHEET_NAMES.split(",")]
    return None


class GoogleSheetConfig(BaseModel):
    """Google Sheets configuration"""
    spreadsheet_id: str = Field(..., description="Google Sheets spreadsheet ID")
    sheet_name: str = Field(default_factory=get_default_sheet_name, description="Sheet name to sync")
    skip_header: bool = Field(True, description="Skip first row as header")


class SyncRequest(BaseModel):
    """Request to trigger sync"""
    spreadsheet_id: str = Field(..., description="Google Sheets spreadsheet ID")
    sheet_name: str = Field(default_factory=get_default_sheet_name, description="Sheet name to sync (single sheet)")
    sheet_names: Optional[List[str]] = Field(default_factory=get_default_sheet_names, description="Multiple sheet names to sync (e.g., ['Angel', 'Vanessa'])")
    sync_type: str = Field("full", description="Sync type: full or incremental")


class SyncRowRequest(BaseModel):
    """Request to sync a single row"""
    spreadsheet_id: str = Field(..., description="Google Sheets spreadsheet ID")
    sheet_name: str = Field(default_factory=get_default_sheet_name, description="Sheet name")
    row_number: int = Field(..., ge=1, description="Row number to sync (1-based)")


class SheetSyncResult(BaseModel):
    """Result of syncing a single sheet"""
    sheet_name: str = Field(..., description="Name of the synced sheet")
    status: str = Field(..., description="Sync status for this sheet")
    processed: int = Field(0, description="Number of rows processed")
    created: int = Field(0, description="Number of jobs created")
    updated: int = Field(0, description="Number of jobs updated")
    skipped: int = Field(0, description="Number of inactive jobs skipped")
    error: Optional[str] = Field(None, description="Error message if failed")


class SyncStats(BaseModel):
    """Sync statistics"""
    status: str = Field(..., description="Sync status: success, partial, or failed")
    processed: int = Field(0, description="Number of rows processed")
    created: int = Field(0, description="Number of jobs created")
    updated: int = Field(0, description="Number of jobs updated")
    skipped: int = Field(0, description="Number of inactive jobs skipped")
    failed: int = Field(0, description="Number of rows failed")
    sheets_synced: Optional[List[SheetSyncResult]] = Field(default=[], description="List of sheet sync results")
    errors: Optional[List[Dict[str, Any]]] = Field(default=[], description="List of errors")


class SyncLogResponse(BaseModel):
    """Sync log response"""
    id: str
    integration_type: str
    sync_type: str
    status: str
    rows_processed: int
    rows_created: int
    rows_updated: int
    rows_failed: int
    error_message: Optional[str] = None
    started_at: datetime
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class WebhookPayload(BaseModel):
    """
    Webhook payload from Google Sheets (via Google Apps Script or Zapier)

    Expected format:
    {
        "spreadsheet_id": "...",
        "sheet_name": "Angel",
        "row_number": 5,
        "event_type": "row_update",
        "row_data": ["address", "name", "phone", ...]
    }
    """
    spreadsheet_id: str = Field(..., description="Spreadsheet ID")
    sheet_name: str = Field(default_factory=get_default_sheet_name, description="Sheet name")
    row_number: int = Field(..., ge=1, description="Row number (1-based)")
    event_type: str = Field("row_update", description="Event type: row_update, row_insert, row_delete")
    row_data: Optional[List[Any]] = Field(None, description="Row data (optional)")


class WebhookResponse(BaseModel):
    """Webhook response"""
    status: str = Field(..., description="Processing status")
    message: str = Field(..., description="Status message")
    job_id: Optional[str] = Field(None, description="Updated job ID")
    changes_detected: bool = Field(False, description="Whether changes were detected")
