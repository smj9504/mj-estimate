"""
Google Sheets sync service for Water Mitigation jobs
"""

import asyncio
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domains.client.client_sync_service import mark_sheet_clients
from app.domains.integrations.google_sheets.client import (
    GoogleSheetsClient,
    get_header_mapping,
)
from app.domains.integrations.google_sheets.row_matches import (
    DUPLICATE,
    find_companycam_lead,
    has_lead_match,
    has_manual_match,
    known_duplicate,
    mapped_job_match,
    pending_match,
)
from app.domains.integrations.google_sheets.row_moves import (
    plan_rows,
    row_is_job,
    rows_look_replaced,
    same_words,
)
from app.domains.integrations.google_sheets.utils import (
    addresses_match,
    parse_boolean_value,
    parse_date_value,
    parse_mitigation_period,
    parse_month_day_value,
    parse_numeric_value,
)
from app.domains.water_mitigation.models import WaterMitigationJob, WMSheetRowMatch, WMSyncLog
from app.domains.water_mitigation.schemas import JobStatus

logger = logging.getLogger(__name__)

# The sheet fills a job in until its documents go to the adjuster
SHEET_UPDATES_STATUSES = frozenset({JobStatus.LEAD, JobStatus.DOC_PREPPING})


def sheet_still_updates(job: WaterMitigationJob) -> bool:
    """Whether the sheet's values still go onto this job: only before 'Sent to adjuster'"""
    return (job.status or JobStatus.LEAD) in SHEET_UPDATES_STATUSES


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
            "moved": 0,
            "off_sheet": 0,
            "skipped": 0,
            "needs_review": 0,
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
                combined_stats["moved"] += stats.get("moved", 0)
                combined_stats["off_sheet"] += stats.get("off_sheet", 0)
                combined_stats["skipped"] += stats.get("skipped", 0)
                combined_stats["needs_review"] += stats.get("needs_review", 0)
                combined_stats["failed"] += stats.get("failed", 0)
                combined_stats["sheets_synced"].append({
                    "sheet_name": sheet_name,
                    "status": stats.get("status", "success"),
                    "processed": stats.get("processed", 0),
                    "created": stats.get("created", 0),
                    "updated": stats.get("updated", 0),
                    "moved": stats.get("moved", 0),
                    "off_sheet": stats.get("off_sheet", 0),
                    "skipped": stats.get("skipped", 0),
                    "needs_review": stats.get("needs_review", 0)
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
            f"moved={combined_stats['moved']}, "
            f"off_sheet={combined_stats['off_sheet']}, "
            f"skipped={combined_stats['skipped']}, "
            f"needs_review={combined_stats['needs_review']}"
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
            mark_sheet_clients(self.db)

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

            # Rows may have moved since the last sync: each job follows its own row
            # before anything is written to it
            followed = await asyncio.to_thread(self._follow_moved_rows, data_rows, start_row, sheet_name)

            stats = {
                "processed": 0,
                "created": 0,
                "updated": 0,
                "moved": followed["moved"],
                "off_sheet": followed["off_sheet"],
                "skipped": 0,
                "needs_review": 0,
                "failed": 0,
                "errors": []
            }

            # Process each row
            for row_idx, row in enumerate(data_rows, start=start_row + 1):
                try:
                    # Row matching loads/fuzzy-matches jobs; keep it off the event loop
                    result = await asyncio.to_thread(self._process_row, row, row_idx, sheet_name)
                    if result:
                        if result.get("created"):
                            stats["created"] += 1
                        elif result.get("updated"):
                            stats["updated"] += 1
                        elif result.get("off_sheet"):
                            stats["off_sheet"] += 1
                        elif result.get("skipped"):
                            stats["skipped"] += 1
                        elif result.get("needs_review"):
                            stats["needs_review"] += 1
                        stats["processed"] += 1
                except Exception as e:
                    self.db.rollback()
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
                "moved": stats["moved"],
                "off_sheet": stats["off_sheet"],
                "skipped": stats["skipped"],
                "needs_review": stats["needs_review"],
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
            Updated or created job, or None if row is empty or waiting on a decision
        """
        mark_sheet_clients(self.db)
        result = await asyncio.to_thread(self._process_row, row, row_number, sheet_name)
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
        1. First, try to find job by google_sheet_row_number + sheet_name (a full sync has
           already moved each job to its row, active or not; see _follow_moved_rows)
        2. If not found and someone said this row is a job that stays on another row,
           leave it alone. If a job or client entered by hand has this address, or a Lead
           job for this customer is already here (same phone, email or address), hold the
           row until someone says whether they are the same (see WMSheetRowMatch)
        3. If not, fill in a CompanyCam lead at this address (fuzzy match, active_only=True)
        4. If still not found, create new job
        5. If row is empty but job exists by row_number + sheet_name, take it off the sheet

        A job found at 'Sent to adjuster' or later keeps its row but takes none of its
        values (see sheet_still_updates).

        Args:
            row: Row data
            row_number: Row number in sheet
            sheet_name: Name of the sheet tab

        Returns:
            Dict with 'job', 'created', 'updated', 'off_sheet' and 'needs_review' keys,
            or None if row is truly empty
        """
        # Parse row data using sheet-specific column mapping
        header_mapping = get_header_mapping(sheet_name)
        row_data = self.client.parse_row_to_dict(row, header_mapping)

        # Check if row has address (required field)
        address = row_data.get("property_address")
        if not address or not address.strip():
            self._close_pending_match(row_number, sheet_name)
            # Row is empty - a job still on it has lost its row, not its data
            existing_job = self._find_job_by_row_number(row_number, sheet_name)
            if existing_job:
                self._take_off_sheet(existing_job)
                self.db.commit()
                self.db.refresh(existing_job)
                return {"job": existing_job, "created": False, "updated": False, "off_sheet": True}
            return None

        # Step 1: Try to find job by google_sheet_row_number + sheet_name (most accurate)
        # This matches the exact row that was previously synced, regardless of active status
        existing_job = self._find_job_by_row_number(row_number, sheet_name)

        # A full sync has already sorted this out. A single row can't see where the job's
        # row went, but it can see this row is someone else: the job comes off the sheet
        # rather than take this row's values, and the next full sync finds its row again.
        if existing_job and not row_is_job(existing_job, row_data):
            self._take_off_sheet(existing_job)
            self.db.commit()
            existing_job = None

        # The row is its job again (a full sync found where it went): nothing to ask
        if existing_job:
            self._close_pending_match(row_number, sheet_name)

        # Step 2: If not found by row number, ask before this row joins anything
        # entered by hand at this address: it may be the same job, or another one.
        # Jobs already on a different sheet row are only asked about while they are
        # Leads for this customer: past that, the same address can legitimately have
        # another WM job (a different claim or incident).
        if not existing_job:
            if known_duplicate(self.db, sheet_name, address):
                self._close_pending_match(row_number, sheet_name)
                self.db.commit()
                return {"job": None, "created": False, "updated": False, "skipped": True}
            if has_manual_match(self.db, address) or has_lead_match(self.db, row_data, address):
                self._hold_row(row_data, row_number, sheet_name, address)
                return {"job": None, "created": False, "updated": False, "needs_review": True}

            # Whatever it was held for has gone, or its address changed
            self._close_pending_match(row_number, sheet_name)

            # Step 3: A lead CompanyCam made for this address has nothing of anyone's
            # on it, so the row fills it in instead of creating a duplicate.
            existing_job = find_companycam_lead(self.db, address)
            if existing_job:
                logger.info(
                    f"Linking CompanyCam lead {existing_job.id} to row {row_number} "
                    f"(sheet {sheet_name}) by address match: {address}"
                )

        # Prepare update data. Dates typed without a year are placed relative to
        # when the job first appeared, so they keep their year on every later sync.
        anchor = (existing_job.created_at if existing_job else None) or datetime.utcnow()
        update_data = self._prepare_job_data(row_data, anchor)

        # Step 4: Update existing job or create new one
        if existing_job:
            # Skip update if job is inactive (soft-deleted or archived)
            if not existing_job.active:
                logger.info(
                    f"Skipping update for inactive job {existing_job.id} "
                    f"(row {row_number}, sheet {sheet_name})"
                )
                return {"job": existing_job, "created": False, "updated": False, "skipped": True}

            # Once documents have gone to the adjuster the job is kept here, not on the
            # sheet: the row stays linked to it, but its values aren't read any more
            if not sheet_still_updates(existing_job):
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

    def _hold_row(
        self,
        row_data: Dict[str, Any],
        row_number: int,
        sheet_name: str,
        address: str
    ) -> WMSheetRowMatch:
        """Keep a row waiting on a decision, with what it says as of this sync"""
        match = pending_match(self.db, row_number, sheet_name)
        if match:
            match.address = address.strip()
            match.row_data = row_data
        else:
            match = WMSheetRowMatch(
                sheet_name=sheet_name,
                row_number=row_number,
                address=address.strip(),
                row_data=row_data,
                status='pending',
            )
            self.db.add(match)
            logger.info(
                f"Row {row_number} (sheet {sheet_name}) has the address of something "
                f"entered by hand, waiting on a decision: {address}"
            )
        self.db.commit()
        return match

    def _close_pending_match(self, row_number: int, sheet_name: str) -> None:
        """The row no longer needs a decision: nothing is made here, the row carries on"""
        match = pending_match(self.db, row_number, sheet_name)
        if match:
            match.status = 'closed'
            self.db.commit()

    def _take_off_sheet(self, job: WaterMitigationJob) -> None:
        """
        The job's row is gone. Everything on the job stays, for the caller to commit.

        A job the sheet made keeps its tab name, so it is still known as the sheet's and
        finds its way back if a row with its address returns. A job entered by hand goes
        back to how it was before a row was linked to it.
        """
        logger.info(f"Job {job.id} has no row in sheet {job.google_sheet_name} any more, keeping its data")
        job.google_sheet_row_number = None
        match = mapped_job_match(self.db, job)
        if match:
            job.google_sheet_name = None
            job.sheets_last_sync = None
            match.status = 'unlinked'

    def _follow_moved_rows(
        self,
        data_rows: List[List[Any]],
        start_row: int,
        sheet_name: str
    ) -> Dict[str, int]:
        """
        Put every job of this tab on the row that is now its own (see row_moves), and
        take the ones whose row has gone off the sheet. Nothing is written if the rows
        don't look like this tab's jobs at all: the sync stops with an error instead.

        Args:
            data_rows: The tab's rows, without the header
            start_row: How many rows came before them
            sheet_name: Name of the sheet tab

        Returns:
            How many jobs moved and how many came off the sheet
        """
        header_mapping = get_header_mapping(sheet_name)
        rows = {}
        filled_rows = 0
        for row_number, row in enumerate(data_rows, start=start_row + 1):
            if any(str(cell).strip() for cell in row):
                filled_rows += 1
            row_data = self.client.parse_row_to_dict(row, header_mapping)
            if str(row_data.get("property_address") or "").strip():
                rows[row_number] = row_data

        jobs = self.db.execute(
            select(WaterMitigationJob).where(WaterMitigationJob.google_sheet_name == sheet_name)
        ).scalars().all()
        plan = plan_rows(jobs, rows)

        on_rows = sum(1 for job in jobs if job.google_sheet_row_number is not None)
        unknown_rows = len(plan.new_rows) + filled_rows - len(rows)
        if rows_look_replaced(len(plan.off_sheet), on_rows, unknown_rows, filled_rows):
            raise ValueError(
                f"{len(plan.off_sheet)} of the {on_rows} jobs on the {sheet_name} tab match no row, "
                f"and {unknown_rows} of its {filled_rows} rows match no job, so nothing was changed. "
                f"Check whether the tab's columns moved."
            )

        by_id = {job.id: job for job in jobs}

        # Two steps: the unique index on row + tab is checked at every update, so a job
        # can't take a row until the job that was on it has let go
        for job_id in plan.moves:
            by_id[job_id].google_sheet_row_number = None
        for job_id in plan.off_sheet:
            self._take_off_sheet(by_id[job_id])
        self.db.flush()
        for job_id, row_number in plan.moves.items():
            by_id[job_id].google_sheet_row_number = row_number

        # A row waiting on a decision is held again wherever it is now
        for match in self.db.query(WMSheetRowMatch).filter(
            WMSheetRowMatch.sheet_name == sheet_name,
            WMSheetRowMatch.status == 'pending',
        ).all():
            row = rows.get(match.row_number)
            if not row or not same_words(row.get("property_address"), match.address):
                match.status = 'closed'

        self.db.commit()

        if plan.moves or plan.off_sheet:
            logger.info(
                f"Sheet {sheet_name}: {len(plan.moves)} jobs followed their rows, "
                f"{len(plan.off_sheet)} came off the sheet"
            )
        return {"moved": len(plan.moves), "off_sheet": len(plan.off_sheet)}

    def _decide(
        self,
        match: WMSheetRowMatch,
        status: str,
        staff_id: Any,
        matched_type: Optional[str] = None,
        job_id: Any = None,
        client_id: Any = None
    ) -> None:
        match.status = status
        match.matched_type = matched_type
        match.job_id = job_id
        match.client_id = client_id
        match.decided_by_id = staff_id
        match.decided_at = datetime.utcnow()

    def link_row_to_job(
        self,
        match: WMSheetRowMatch,
        job: WaterMitigationJob,
        staff_id: Any
    ) -> WaterMitigationJob:
        """
        The row is this job: the job takes the row, and stays with its client. Sheet
        values replace the job's; empty cells leave it alone.

        A job on another row (a Lead entered twice, or moved to another tab) comes off
        it. That row is remembered as the same job and left alone, so it doesn't become
        a second one.
        """
        from app.domains.client.client_sync_service import sync_client_from_wm_job

        # Who that client is, before the sheet's name lands on the job and changes it
        client_id = sync_client_from_wm_job(self.db, job).get('client_id')
        if job.google_sheet_row_number is not None and job.google_sheet_name:
            self.remember_duplicate_row(
                job.google_sheet_name, job.google_sheet_row_number, job.property_address,
                job, client_id, staff_id,
            )
        self._decide(match, 'same', staff_id, matched_type='job', job_id=job.id, client_id=client_id)
        update_data = self._prepare_job_data(match.row_data, job.created_at or datetime.utcnow())
        return self._update_job(job, update_data, match.row_number, match.sheet_name)

    def remember_duplicate_row(
        self,
        sheet_name: str,
        row_number: int,
        address: str,
        job: WaterMitigationJob,
        client_id: Any,
        staff_id: Any
    ) -> WMSheetRowMatch:
        """A row that is this job, which is on another row: the sync leaves it alone
        (see known_duplicate). For the caller to commit."""
        record = WMSheetRowMatch(
            sheet_name=sheet_name,
            row_number=row_number,
            address=(address or '').strip(),
            row_data={},
            status=DUPLICATE,
        )
        self.db.add(record)
        self._decide(record, DUPLICATE, staff_id, matched_type='job', job_id=job.id, client_id=client_id)
        return record

    def link_row_to_client(self, match: WMSheetRowMatch, client: Any, staff_id: Any) -> WaterMitigationJob:
        """The row's homeowner is this client entered by hand: the row becomes that client's job"""
        self._decide(match, 'same', staff_id, matched_type='client', client_id=client.id)
        return self._job_from_match(match, company_id=client.company_id)

    def keep_row_separate(self, match: WMSheetRowMatch, staff_id: Any) -> WaterMitigationJob:
        """The row is something else: it becomes its own job and client, and what was
        entered by hand is left as it is"""
        self._decide(match, 'different', staff_id)
        return self._job_from_match(match)

    def _job_from_match(self, match: WMSheetRowMatch, company_id: Any = None) -> WaterMitigationJob:
        lead = find_companycam_lead(self.db, match.address)
        data = self._prepare_job_data(match.row_data, (lead.created_at if lead else None) or datetime.utcnow())
        if lead:
            match.job_id = lead.id
            return self._update_job(lead, data, match.row_number, match.sheet_name)
        if company_id:
            data['company_id'] = company_id
        return self._create_job(data, match.row_number, match.sheet_name, match=match)

    def _prepare_job_data(self, row_data: Dict[str, Any], anchor: datetime) -> Dict[str, Any]:
        """
        Prepare job data from row data with type conversion.

        IMPORTANT: Empty fields in Sheet are explicitly set to None so they
        will be cleared in the database. This ensures that when a field is
        emptied in the Sheet, the corresponding DB field is also cleared.

        Args:
            row_data: Raw row data dictionary
            anchor: When the job first appeared, for dates typed without a year

        Returns:
            Cleaned and typed job data (includes None for empty fields)
        """
        update_data = {}
        anchor = anchor.replace(tzinfo=None)

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
            if not value or not str(value).strip():
                update_data[field] = None
                continue

            parsed_date = parse_date_value(value)
            if not parsed_date and field == "date_of_loss":
                parsed_date = parse_month_day_value(value, anchor)

            if parsed_date:
                update_data[field] = parsed_date
            else:
                # Text we can't read ("TBD") isn't an emptied cell: the job keeps its value
                logger.warning(f"Could not read {field} from sheet value '{value}'")

        # Parse mitigation_period string into start/end dates
        # This handles formats like "12/25-12/27 (3)" from Google Sheets
        if row_data.get("mitigation_period") and str(row_data["mitigation_period"]).strip():
            period_str = str(row_data["mitigation_period"]).strip()

            # The year comes from date_of_loss, or failing that from when the job appeared
            reference = update_data.get("date_of_loss") or anchor

            # Parse the period string
            start_date, end_date = parse_mitigation_period(period_str, reference.year)

            # A December loss mitigated in January lands a year early on the first
            # try, and December work on a job that appeared in January a year late
            if start_date and abs((start_date - reference).days) > 180:
                year = reference.year + (1 if start_date < reference else -1)
                start_date, end_date = parse_mitigation_period(period_str, year)

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
        # An emptied cell clears a job the sheet made, not what was entered by hand
        if mapped_job_match(self.db, job):
            update_data = {key: value for key, value in update_data.items() if value is not None}

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

        # Apply PA mapping to linked Claim
        try:
            self.db.refresh(job)
            self._apply_pa_mapping(job)
        except Exception as e:
            logger.warning(f"PA mapping apply after job update failed (non-fatal): {e}")

        return job

    def _create_job(
        self,
        job_data: Dict[str, Any],
        row_number: int,
        sheet_name: str,
        match: Optional[WMSheetRowMatch] = None
    ) -> WaterMitigationJob:
        """
        Create new job from sheet data

        Args:
            job_data: Job data
            row_number: Sheet row number
            sheet_name: Name of the sheet tab
            match: The decision that released this row, saved along with the job

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
            if match:
                match.job_id = existing.id
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
            if match:
                self.db.flush()
                match.job_id = job.id
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

        # Apply PA mapping to linked Claim
        try:
            self.db.refresh(job)
            self._apply_pa_mapping(job)
        except Exception as e:
            logger.warning(f"PA mapping apply after job create failed (non-fatal): {e}")

        return job

    def _apply_pa_mapping(self, job: WaterMitigationJob) -> None:
        """
        If a Sheet→PA mapping exists for this job's sheet_name, put that PA
        on the linked Claim: pa_contact_id plus the pa_* mirror and
        has_public_adjuster, which the PA fee is counted from.
        """
        if not job.google_sheet_name:
            return
        if not job.claim_id:
            logger.debug(
                f"PA mapping skipped for job {job.id}: no claim linked yet "
                f"(sheet: {job.google_sheet_name})"
            )
            return

        from app.domains.water_mitigation.models import WMSheetPAMapping
        from app.domains.client.models import Claim

        mapping = self.db.execute(
            select(WMSheetPAMapping).where(
                WMSheetPAMapping.sheet_name == job.google_sheet_name
            )
        ).scalar_one_or_none()

        if not mapping or not mapping.pa_contact_id:
            return

        claim = self.db.execute(
            select(Claim).where(Claim.id == job.claim_id)
        ).scalar_one_or_none()
        if not claim:
            return

        # Only fill an empty link. A PA set by hand on the claim is a
        # deliberate choice (a PA that changed hands, or one the sheet tab
        # does not describe) and must survive the next sheet sync.
        if claim.pa_contact_id:
            if str(claim.pa_contact_id) != str(mapping.pa_contact_id):
                logger.debug(
                    f"Keeping existing PA {claim.pa_contact_id} on claim "
                    f"{job.claim_id}; sheet '{job.google_sheet_name}' maps to "
                    f"{mapping.pa_contact_id}"
                )
                return
            if claim.has_public_adjuster:
                return
            # Linked by a sync from before the mirror was filled: fill it now

        from app.domains.client.claim_pa import link_pa_contact
        link_pa_contact(self.db, claim, mapping.pa_contact_id)
        self.db.commit()
        logger.info(
            f"Applied PA contact {mapping.pa_contact_id} to claim {job.claim_id} "
            f"(sheet: {job.google_sheet_name})"
        )

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
