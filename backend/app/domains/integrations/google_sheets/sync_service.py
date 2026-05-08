"""
Google Sheets sync service for Water Mitigation jobs
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domains.integrations.google_sheets.client import (
    WM_HEADER_MAPPING,
    GoogleSheetsClient,
)
from app.domains.integrations.google_sheets.utils import (
    addresses_match,
    parse_boolean_value,
    parse_date_value,
    parse_mitigation_period,
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

    async def sync_multiple_sheets(
        self,
        sheet_names: List[str],
        skip_header: bool = True
    ) -> Dict[str, Any]:
        """
        Sync all rows from multiple Google Sheets tabs

        Args:
            sheet_names: List of sheet tab names to sync (e.g., ["Angel", "Vanessa"])
            skip_header: Skip first row (header)

        Returns:
            Combined sync statistics dictionary
        """
        combined_stats = {
            "status": "success",
            "processed": 0,
            "created": 0,
            "updated": 0,
            "cleared": 0,
            "skipped": 0,
            "failed": 0,
            "sheets_synced": [],
            "errors": []
        }

        for sheet_name in sheet_names:
            try:
                logger.info(f"Syncing sheet: {sheet_name}")
                stats = await self.sync_all_rows(sheet_name=sheet_name, skip_header=skip_header)

                # Aggregate stats
                combined_stats["processed"] += stats.get("processed", 0)
                combined_stats["created"] += stats.get("created", 0)
                combined_stats["updated"] += stats.get("updated", 0)
                combined_stats["cleared"] += stats.get("cleared", 0)
                combined_stats["skipped"] += stats.get("skipped", 0)
                combined_stats["failed"] += stats.get("failed", 0)
                combined_stats["sheets_synced"].append({
                    "sheet_name": sheet_name,
                    "status": stats.get("status", "success"),
                    "processed": stats.get("processed", 0),
                    "created": stats.get("created", 0),
                    "updated": stats.get("updated", 0),
                    "cleared": stats.get("cleared", 0),
                    "skipped": stats.get("skipped", 0)
                })

                if stats.get("errors"):
                    for error in stats["errors"]:
                        error["sheet_name"] = sheet_name
                    combined_stats["errors"].extend(stats["errors"])

            except Exception as e:
                logger.error(f"Failed to sync sheet {sheet_name}: {e}", exc_info=True)
                combined_stats["failed"] += 1
                combined_stats["sheets_synced"].append({
                    "sheet_name": sheet_name,
                    "status": "failed",
                    "error": str(e)
                })
                combined_stats["errors"].append({
                    "sheet_name": sheet_name,
                    "error": str(e)
                })

        # Determine overall status
        if combined_stats["failed"] > 0:
            if combined_stats["processed"] > 0:
                combined_stats["status"] = "partial"
            else:
                combined_stats["status"] = "failed"

        logger.info(
            f"Multi-sheet sync completed: sheets={len(sheet_names)}, "
            f"processed={combined_stats['processed']}, "
            f"created={combined_stats['created']}, "
            f"updated={combined_stats['updated']}, "
            f"cleared={combined_stats['cleared']}, "
            f"skipped={combined_stats['skipped']}"
        )

        return combined_stats

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
                "cleared": 0,
                "skipped": 0,
                "failed": 0,
                "errors": []
            }

            # Process each row
            for row_idx, row in enumerate(data_rows, start=start_row + 1):
                try:
                    result = self._process_row(row, row_idx, sheet_name)
                    if result:
                        if result.get("created"):
                            stats["created"] += 1
                        elif result.get("updated"):
                            stats["updated"] += 1
                        elif result.get("cleared"):
                            stats["cleared"] += 1
                        elif result.get("skipped"):
                            stats["skipped"] += 1
                        stats["processed"] += 1
                except Exception as e:
                    logger.error(f"Failed to sync row {row_idx} in sheet {sheet_name}: {str(e)}", exc_info=True)
                    stats["failed"] += 1
                    stats["errors"].append({
                        "row": row_idx,
                        "sheet_name": sheet_name,
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
                "cleared": stats["cleared"],
                "skipped": stats["skipped"],
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
        row_number: int,
        sheet_name: str = "Sheet1"
    ) -> Optional[WaterMitigationJob]:
        """
        Sync a single row from Google Sheets

        Args:
            row: Row data (list of cell values)
            row_number: Row number in the sheet (1-based)
            sheet_name: Name of the sheet tab

        Returns:
            Updated or created job, or None if row is empty
        """
        result = self._process_row(row, row_number, sheet_name)
        return result.get("job") if result else None

    def _process_row(
        self,
        row: List[Any],
        row_number: int,
        sheet_name: str = "Sheet1"
    ) -> Optional[Dict[str, Any]]:
        """
        Process a single row and update/create job

        Matching strategy:
        1. First, try to find job by google_sheet_row_number + sheet_name (most accurate, active/inactive agnostic)
        2. If not found, try to find by street address (fuzzy match, active_only=True)
        3. If still not found, create new job
        4. If row is empty but job exists by row_number + sheet_name, clear its synced fields

        Args:
            row: Row data
            row_number: Row number in sheet
            sheet_name: Name of the sheet tab

        Returns:
            Dict with 'job', 'created', 'updated', and 'cleared' keys, or None if row is truly empty
        """
        # Parse row data
        row_data = self.client.parse_row_to_dict(row, WM_HEADER_MAPPING)

        # Check if row has address (required field)
        address = row_data.get("property_address")
        if not address or not address.strip():
            # Row is empty - check if there's an existing job linked to this row
            # If so, clear its Google Sheet-synced fields to NULL
            existing_job = self._find_job_by_row_number(row_number, sheet_name)
            if existing_job:
                job = self._clear_job_sheet_fields(existing_job)
                logger.info(
                    f"Cleared Google Sheet fields for job {job.id} "
                    f"(row {row_number} in sheet {sheet_name} is now empty)"
                )
                return {"job": job, "created": False, "updated": False, "cleared": True}
            return None

        # Prepare update data
        update_data = self._prepare_job_data(row_data)

        # Step 1: Try to find job by google_sheet_row_number + sheet_name (most accurate)
        # This matches the exact row that was previously synced, regardless of active status
        existing_job = self._find_job_by_row_number(row_number, sheet_name)

        # Step 2: If not found by row number, try address matching (fallback for new rows)
        if not existing_job:
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

            # Find existing job by street address (fuzzy match, active_only=True)
            # This prevents duplicate leads when the same address is created from different sources
            existing_job = self._find_job_by_street_address(
                street=street,
                city=city,
                state=state,
                full_address=address
            )

        # Step 3: Update existing job or create new one
        if existing_job:
            # Skip update if job is inactive (soft-deleted or archived)
            if not existing_job.active:
                logger.info(
                    f"Skipping update for inactive job {existing_job.id} "
                    f"(row {row_number}, sheet {sheet_name})"
                )
                return {"job": existing_job, "created": False, "updated": False, "skipped": True}

            # Update existing active job
            job = self._update_job(existing_job, update_data, row_number, sheet_name)
            return {"job": job, "created": False, "updated": True}
        else:
            # Create new job
            job = self._create_job(update_data, row_number, sheet_name)
            return {"job": job, "created": True, "updated": False}

    def _find_job_by_row_number(
        self,
        row_number: int,
        sheet_name: str
    ) -> Optional[WaterMitigationJob]:
        """
        Find job by Google Sheets row number and sheet name

        This is the most accurate matching method because it directly links
        a sheet row to a specific job, regardless of active status.

        IMPORTANT: Each sheet (e.g., "Angel", "Vanessa") has its own row numbering.
        Row 4 in "Angel" sheet is a DIFFERENT job from Row 4 in "Vanessa" sheet.
        Therefore, we MUST match both row_number AND sheet_name together.

        Args:
            row_number: Google Sheets row number (1-based)
            sheet_name: Name of the sheet tab

        Returns:
            Matching job or None
        """
        # Find by exact match (row_number + sheet_name)
        # We do NOT fall back to row_number-only matching because different sheets
        # have independent row numbering (Angel row 4 != Vanessa row 4)
        query = select(WaterMitigationJob).where(
            WaterMitigationJob.google_sheet_row_number == row_number,
            WaterMitigationJob.google_sheet_name == sheet_name
        ).order_by(WaterMitigationJob.created_at.desc())
        result = self.db.execute(query)
        jobs = result.scalars().all()

        if len(jobs) > 1:
            logger.warning(
                f"Found {len(jobs)} duplicate jobs for row {row_number}, "
                f"sheet {sheet_name}. Using most recently updated. "
                f"IDs: {[str(j.id) for j in jobs]}"
            )

        return jobs[0] if jobs else None

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
        - Street suffix present/missing (Street, St, Ave, etc.)

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

        # If we have street address, try the improved matching first
        if street:
            job = wm_service.get_by_street_address(
                street=street,
                city=city,
                state=state,
                active_only=True
            )
            if job:
                return job

        # Always try full address matching as fallback
        # This handles jobs where property_street is NULL but property_address exists
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
        Prepare job data from row data with type conversion.

        IMPORTANT: Empty fields in Sheet are explicitly set to None so they
        will be cleared in the database. This ensures that when a field is
        emptied in the Sheet, the corresponding DB field is also cleared.

        Args:
            row_data: Raw row data dictionary

        Returns:
            Cleaned and typed job data (includes None for empty fields)
        """
        update_data = {}

        # String fields (direct mapping)
        # Empty strings are converted to None to clear DB fields
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
            value = row_data.get(field)
            if value and str(value).strip():
                update_data[field] = str(value).strip()
            else:
                # Explicitly set to None to clear the field in DB
                update_data[field] = None

        # Date fields - empty values become None
        date_fields = [
            "date_of_loss", "mitigation_start_date", "mitigation_end_date",
            "inspection_date", "documents_sent_date", "check_date"
        ]
        for field in date_fields:
            value = row_data.get(field)
            parsed_date = parse_date_value(value) if value else None
            update_data[field] = parsed_date

        # Parse mitigation_period string into start/end dates
        # This handles formats like "12/25-12/27 (3)" from Google Sheets
        if row_data.get("mitigation_period") and str(row_data["mitigation_period"]).strip():
            period_str = str(row_data["mitigation_period"]).strip()

            # Determine reference year from date_of_loss if available
            reference_year = None
            if update_data.get("date_of_loss"):
                reference_year = update_data["date_of_loss"].year

            # Parse the period string
            start_date, end_date = parse_mitigation_period(period_str, reference_year)

            if start_date:
                update_data["mitigation_start_date"] = start_date
                logger.info(f"Parsed mitigation_start_date: {start_date} from '{period_str}'")

            if end_date:
                update_data["mitigation_end_date"] = end_date
                logger.info(f"Parsed mitigation_end_date: {end_date} from '{period_str}'")

        # Boolean fields - empty values become None
        value = row_data.get("mitigation_flag")
        if value is not None and str(value).strip():
            update_data["mitigation_flag"] = parse_boolean_value(value)
        else:
            update_data["mitigation_flag"] = None

        # Numeric fields - empty values become None
        numeric_fields = [
            ("invoice_amount", "invoice_amount"),
            ("check_amount", "check_amount")
        ]
        for source_field, target_field in numeric_fields:
            value = row_data.get(source_field)
            if value is not None and str(value).strip():
                parsed_value = parse_numeric_value(value)
                update_data[target_field] = parsed_value
            else:
                update_data[target_field] = None

        return update_data

    def _clear_job_sheet_fields(self, job: WaterMitigationJob) -> WaterMitigationJob:
        """
        Clear Google Sheet-synced fields when the corresponding sheet row is empty.

        This handles the case where a job was previously synced from a Sheet row,
        but that row's data has been cleared/deleted. We clear the synced fields
        to NULL to remove the corrupted/stale data.

        Note: We keep the job record intact (don't delete) and preserve:
        - job.id (primary key)
        - job.active (status)
        - job.status (workflow status)
        - job.google_sheet_row_number (link to the sheet row)
        - job.google_sheet_name (link to the sheet tab)
        - job.created_at, job.updated_at (timestamps)
        - CompanyCam data (companycam_project_id, companycam_last_sync, etc.)

        Args:
            job: Job to clear

        Returns:
            Updated job with cleared fields
        """
        # Fields synced from Google Sheets that should be cleared
        # These are the fields populated by _prepare_job_data()
        clearable_fields = [
            # Address fields
            "property_address", "property_street", "property_city",
            "property_state", "property_zipcode",
            # Homeowner fields
            "homeowner_name", "homeowner_phone", "homeowner_email",
            # Insurance fields
            "insurance_company", "insurance_policy_number", "claim_number",
            "adjuster_name", "adjuster_phone", "adjuster_email",
            # Date fields
            "date_of_loss", "mitigation_start_date", "mitigation_end_date",
            "inspection_date", "documents_sent_date", "check_date",
            # Other fields
            "mitigation_period", "mitigation_flag",
            "inspection_time", "plumbers_report",
            "invoice_number", "invoice_amount",
            "check_number", "check_amount"
        ]

        # Clear all synced fields to NULL
        for field in clearable_fields:
            if hasattr(job, field):
                setattr(job, field, None)

        # Update sync timestamp to indicate we processed this row
        job.sheets_last_sync = datetime.utcnow()

        self.db.commit()
        self.db.refresh(job)

        return job

    def _update_job(
        self,
        job: WaterMitigationJob,
        update_data: Dict[str, Any],
        row_number: int,
        sheet_name: str
    ) -> WaterMitigationJob:
        """
        Update existing job with new data

        Args:
            job: Existing job
            update_data: New data
            row_number: Sheet row number
            sheet_name: Name of the sheet tab

        Returns:
            Updated job
        """
        # Update fields
        for key, value in update_data.items():
            setattr(job, key, value)

        # Update sync metadata
        job.google_sheet_row_number = row_number
        job.google_sheet_name = sheet_name
        job.sheets_last_sync = datetime.utcnow()

        self.db.commit()
        self.db.refresh(job)

        # Auto-sync Client/Claim from updated WM Job
        try:
            from app.domains.client.client_sync_service import sync_client_from_wm_job
            sync_client_from_wm_job(self.db, job)
        except Exception as e:
            logger.warning(f"Client sync after job update failed (non-fatal): {e}")

        return job

    def _create_job(
        self,
        job_data: Dict[str, Any],
        row_number: int,
        sheet_name: str
    ) -> WaterMitigationJob:
        """
        Create new job from sheet data

        Args:
            job_data: Job data
            row_number: Sheet row number
            sheet_name: Name of the sheet tab

        Returns:
            Created job
        """
        # Guard: check for existing job one more time to prevent duplicates
        # (race condition or address-match miss could lead us here with a dup)
        existing = self._find_job_by_row_number(row_number, sheet_name)
        if existing:
            logger.warning(
                f"Duplicate prevented: job {existing.id} already exists "
                f"for row {row_number}, sheet {sheet_name}. Updating instead."
            )
            return self._update_job(existing, job_data, row_number, sheet_name)

        # Add sync metadata
        job_data["google_sheet_row_number"] = row_number
        job_data["google_sheet_name"] = sheet_name
        job_data["sheets_last_sync"] = datetime.utcnow()
        job_data["active"] = True
        job_data["status"] = "Lead"

        # Create job
        job = WaterMitigationJob(**job_data)
        self.db.add(job)
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            logger.warning(
                f"IntegrityError on create for row {row_number}, sheet {sheet_name}. "
                f"Fetching existing job instead."
            )
            existing = self._find_job_by_row_number(row_number, sheet_name)
            if existing:
                return self._update_job(existing, job_data, row_number, sheet_name)
            raise
        self.db.refresh(job)

        # Auto-sync Client/Claim from newly created WM Job
        try:
            from app.domains.client.client_sync_service import sync_client_from_wm_job
            sync_client_from_wm_job(self.db, job)
        except Exception as e:
            logger.warning(f"Client sync after job create failed (non-fatal): {e}")

        return job

    def cleanup_duplicate_jobs(self) -> Dict[str, Any]:
        """
        Find and remove duplicate jobs that share the same
        (google_sheet_row_number, google_sheet_name).

        For each duplicate group, keep the most recently updated job
        and soft-delete (active=False) the rest.

        Returns:
            Summary with duplicates found and cleaned count
        """
        # Find all (row, sheet) combos with more than 1 job
        dup_query = (
            select(
                WaterMitigationJob.google_sheet_row_number,
                WaterMitigationJob.google_sheet_name,
                func.count().label("cnt")
            )
            .where(
                WaterMitigationJob.google_sheet_row_number.isnot(None),
                WaterMitigationJob.google_sheet_name.isnot(None),
            )
            .group_by(
                WaterMitigationJob.google_sheet_row_number,
                WaterMitigationJob.google_sheet_name,
            )
            .having(func.count() > 1)
        )
        dup_groups = self.db.execute(dup_query).all()

        total_deactivated = 0
        details = []

        for row_number, sheet_name, count in dup_groups:
            # Get all jobs for this (row, sheet), ordered by updated_at desc
            jobs_query = (
                select(WaterMitigationJob)
                .where(
                    WaterMitigationJob.google_sheet_row_number == row_number,
                    WaterMitigationJob.google_sheet_name == sheet_name,
                )
                .order_by(WaterMitigationJob.updated_at.desc())
            )
            jobs = self.db.execute(jobs_query).scalars().all()

            # Keep the first (most recently updated), deactivate the rest
            keeper = jobs[0]
            duplicates_removed = []
            for dup in jobs[1:]:
                dup.active = False
                dup.google_sheet_row_number = None  # unlink from sheet
                duplicates_removed.append(str(dup.id))
                total_deactivated += 1

            details.append({
                "sheet": sheet_name,
                "row": row_number,
                "kept": str(keeper.id),
                "deactivated": duplicates_removed,
            })

        self.db.commit()

        logger.info(
            f"Duplicate cleanup completed: {len(dup_groups)} groups, "
            f"{total_deactivated} jobs deactivated"
        )

        return {
            "duplicate_groups": len(dup_groups),
            "jobs_deactivated": total_deactivated,
            "details": details,
        }

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
