"""
Google Sheets sync service for Water Mitigation jobs
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.integrations.google_sheets.client import (
    WM_HEADER_MAPPING,
    GoogleSheetsClient,
)
from app.domains.integrations.google_sheets.utils import (
    addresses_match,
    parse_boolean_value,
    parse_date_value,
    parse_numeric_value,
)
from app.domains.water_mitigation.models import WaterMitigationJob, WMSyncLog

logger = logging.getLogger(__name__)


class GoogleSheetsSyncService:
    """Service for syncing Google Sheets data with Water Mitigation jobs"""

    def __init__(self, db: Session, spreadsheet_id: str):
        """
        Initialize sync service

        Args:
            db: Database session (synchronous)
            spreadsheet_id: Google Sheets spreadsheet ID
        """
        self.db = db
        self.client = GoogleSheetsClient(spreadsheet_id)

    async def sync_all_rows(
        self,
        sheet_name: str = "Sheet1",
        skip_header: bool = True
    ) -> Dict[str, Any]:
        """
        Sync all rows from Google Sheets

        Args:
            sheet_name: Name of the sheet to sync
            skip_header: Skip first row (header)

        Returns:
            Sync statistics dictionary
        """
        sync_log = WMSyncLog(
            integration_type="google_sheets",
            sync_type="full",
            status="in_progress",
            started_at=datetime.utcnow()
        )

        try:
            # Get all sheet values
            range_name = f"{sheet_name}!A:Z"
            rows = await self.client.get_sheet_values(range_name)

            if not rows:
                sync_log.status = "success"
                sync_log.completed_at = datetime.utcnow()
                self.db.add(sync_log)
                self.db.commit()
                return {
                    "status": "success",
                    "processed": 0,
                    "created": 0,
                    "updated": 0,
                    "failed": 0
                }

            # Skip header row if needed
            start_row = 1 if skip_header else 0
            data_rows = rows[start_row:]

            stats = {
                "processed": 0,
                "created": 0,
                "updated": 0,
                "failed": 0,
                "errors": []
            }

            # Process each row
            for row_idx, row in enumerate(data_rows, start=start_row + 1):
                try:
                    result = self._process_row(row, row_idx)
                    if result:
                        if result.get("created"):
                            stats["created"] += 1
                        elif result.get("updated"):
                            stats["updated"] += 1
                        stats["processed"] += 1
                except Exception as e:
                    logger.error(f"Failed to sync row {row_idx}: {str(e)}", exc_info=True)
                    stats["failed"] += 1
                    stats["errors"].append({
                        "row": row_idx,
                        "error": str(e)
                    })

            # Update sync log
            sync_log.status = "success" if stats["failed"] == 0 else "partial"
            sync_log.rows_processed = stats["processed"]
            sync_log.rows_created = stats["created"]
            sync_log.rows_updated = stats["updated"]
            sync_log.rows_failed = stats["failed"]
            sync_log.completed_at = datetime.utcnow()

            self.db.add(sync_log)
            self.db.commit()

            # Add status field to response
            return {
                "status": "success" if stats["failed"] == 0 else ("partial" if stats["processed"] > 0 else "failed"),
                "processed": stats["processed"],
                "created": stats["created"],
                "updated": stats["updated"],
                "failed": stats["failed"],
                "errors": stats.get("errors", [])
            }

        except Exception as e:
            sync_log.status = "failed"
            sync_log.error_message = str(e)
            sync_log.completed_at = datetime.utcnow()
            self.db.add(sync_log)
            self.db.commit()
            raise

    async def sync_single_row(
        self,
        row: List[Any],
        row_number: int
    ) -> Optional[WaterMitigationJob]:
        """
        Sync a single row from Google Sheets

        Args:
            row: Row data (list of cell values)
            row_number: Row number in the sheet (1-based)

        Returns:
            Updated or created job, or None if row is empty
        """
        return await self._process_row(row, row_number)

    def _process_row(
        self,
        row: List[Any],
        row_number: int
    ) -> Optional[Dict[str, Any]]:
        """
        Process a single row and update/create job

        Args:
            row: Row data
            row_number: Row number in sheet

        Returns:
            Dict with 'job', 'created', and 'updated' keys, or None if row is empty
        """
        # Parse row data
        row_data = self.client.parse_row_to_dict(row, WM_HEADER_MAPPING)

        # Check if row has address (required field)
        address = row_data.get("property_address")
        if not address or not address.strip():
            return None

        # Extract street, city, state from row data
        street = row_data.get("property_street") or None
        city = row_data.get("property_city") or None
        state = row_data.get("property_state") or None

        # If street is not provided, try to extract from full address
        if not street and address:
            # Try to parse street from full address (assume first part before comma)
            parts = [p.strip() for p in address.split(',')]
            if parts:
                street = parts[0]

        # Find existing job by street address (fuzzy match)
        # This prevents duplicate leads when the same address is created from different sources
        existing_job = self._find_job_by_street_address(
            street=street,
            city=city,
            state=state,
            full_address=address
        )

        # Prepare update data
        update_data = self._prepare_job_data(row_data)

        if existing_job:
            # Update existing job
            job = self._update_job(existing_job, update_data, row_number)
            return {"job": job, "created": False, "updated": True}
        else:
            # Create new job
            job = self._create_job(update_data, row_number)
            return {"job": job, "created": True, "updated": False}

    def _find_job_by_street_address(
        self,
        street: Optional[str] = None,
        city: Optional[str] = None,
        state: Optional[str] = None,
        full_address: Optional[str] = None
    ) -> Optional[WaterMitigationJob]:
        """
        Find job by street address, city, and state using fuzzy matching
        
        This method prevents duplicate leads by matching addresses even when:
        - States are in different formats (Maryland vs MD, Virginia vs VA)
        - Zipcodes are present or missing
        - Address formatting differs slightly
        
        Args:
            street: Street address
            city: City name
            state: State name or abbreviation
            full_address: Full address string (used as fallback if street is not available)
            
        Returns:
            Matching job or None
        """
        from app.domains.water_mitigation.service import WaterMitigationService
        
        # Use WaterMitigationService with existing DB session
        wm_service = WaterMitigationService(self.db)
        
        # If we have street address, use the improved matching
        if street:
            return wm_service.get_by_street_address(
                street=street,
                city=city,
                state=state,
                active_only=True
            )
        
        # Fallback: If no street address, use full address matching (legacy)
        if full_address:
            return self._find_job_by_address(full_address)
        
        return None

    def _find_job_by_address(self, address: str) -> Optional[WaterMitigationJob]:
        """
        Find job by full address using fuzzy matching (legacy method)
        
        This is a fallback method when street address is not available.
        For better duplicate prevention, use _find_job_by_street_address instead.

        Args:
            address: Full address string

        Returns:
            Matching job or None
        """
        # Get all active jobs (or recent jobs)
        query = select(WaterMitigationJob).where(
            WaterMitigationJob.active.is_(True)
        )
        result = self.db.execute(query)
        jobs = result.scalars().all()

        # Fuzzy match addresses
        for job in jobs:
            if addresses_match(job.property_address, address):
                return job

        return None

    def _prepare_job_data(self, row_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Prepare job data from row data with type conversion

        Args:
            row_data: Raw row data dictionary

        Returns:
            Cleaned and typed job data
        """
        update_data = {}

        # String fields (direct mapping)
        string_fields = [
            "property_address", "property_street", "property_city",
            "property_state", "property_zipcode", "homeowner_name",
            "homeowner_phone", "homeowner_email", "insurance_company",
            "insurance_policy_number", "claim_number", "mitigation_period",
            "adjuster_name", "adjuster_phone", "adjuster_email",
            "inspection_time", "plumbers_report", "invoice_number",
            "check_number"
        ]
        for field in string_fields:
            if field in row_data and row_data[field]:
                update_data[field] = str(row_data[field]).strip()

        # Date fields
        date_fields = [
            "date_of_loss", "mitigation_start_date", "mitigation_end_date",
            "inspection_date", "documents_sent_date", "check_date"
        ]
        for field in date_fields:
            if field in row_data:
                parsed_date = parse_date_value(row_data[field])
                if parsed_date:
                    update_data[field] = parsed_date

        # Boolean fields
        if "mitigation_flag" in row_data:
            update_data["mitigation_flag"] = parse_boolean_value(row_data["mitigation_flag"])

        # Numeric fields
        numeric_fields = [
            ("invoice_amount", "invoice_amount"),
            ("check_amount", "check_amount")
        ]
        for source_field, target_field in numeric_fields:
            if source_field in row_data:
                parsed_value = parse_numeric_value(row_data[source_field])
                if parsed_value is not None:
                    update_data[target_field] = parsed_value

        return update_data

    def _update_job(
        self,
        job: WaterMitigationJob,
        update_data: Dict[str, Any],
        row_number: int
    ) -> WaterMitigationJob:
        """
        Update existing job with new data

        Args:
            job: Existing job
            update_data: New data
            row_number: Sheet row number

        Returns:
            Updated job
        """
        # Update fields
        for key, value in update_data.items():
            setattr(job, key, value)

        # Update sync metadata
        job.google_sheet_row_number = row_number
        job.sheets_last_sync = datetime.utcnow()

        self.db.commit()
        self.db.refresh(job)

        return job

    def _create_job(
        self,
        job_data: Dict[str, Any],
        row_number: int
    ) -> WaterMitigationJob:
        """
        Create new job from sheet data

        Args:
            job_data: Job data
            row_number: Sheet row number

        Returns:
            Created job
        """
        # Add sync metadata
        job_data["google_sheet_row_number"] = row_number
        job_data["sheets_last_sync"] = datetime.utcnow()
        job_data["active"] = True
        job_data["status"] = "Lead"

        # Create job
        job = WaterMitigationJob(**job_data)
        self.db.add(job)
        self.db.commit()
        self.db.refresh(job)

        return job

    async def get_sync_history(
        self,
        limit: int = 10
    ) -> List[WMSyncLog]:
        """
        Get recent sync history

        Args:
            limit: Maximum number of records to return

        Returns:
            List of sync logs
        """
        query = (
            select(WMSyncLog)
            .where(WMSyncLog.integration_type == "google_sheets")
            .order_by(WMSyncLog.started_at.desc())
            .limit(limit)
        )

        result = self.db.execute(query)
        return result.scalars().all()
