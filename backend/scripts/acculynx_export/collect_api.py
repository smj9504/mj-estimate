"""
Phase 1: dump everything the AccuLynx API can read into local raw JSON.

Layout (under ACCULYNX_EXPORT_DIR/raw/api):
    company/<name>.json         company settings, lookups, users
    job_index.json              every job id seen in the job listings
    jobs/<jobId>.json           one file per job with all its sub-resources
    contacts/<contactId>.json   one file per contact with emails/phones/custom fields/jobs
    appointments.json           all calendar appointments

Re-running skips jobs/contacts that already have a file, so an interrupted
run can be resumed. Pass --refresh to re-download everything.
"""

import json
import logging
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from .api_reader import AccuLynxReader, NotFound
from .config import ExportConfig

logger = logging.getLogger(__name__)

COMPANY_ENDPOINTS = {
    "company_settings": ("/company-settings", False),
    "document_folders": ("/company-settings/job-file-settings/document-folders", True),
    "photo_video_tags": ("/company-settings/job-file-settings/photo-video-tags", True),
    "insurance_companies": ("/company-settings/job-file-settings/insurance-companies", True),
    "job_categories": ("/company-settings/job-file-settings/job-categories", True),
    "trade_types": ("/company-settings/job-file-settings/trade-types", True),
    "work_types": ("/company-settings/job-file-settings/work-types", True),
    "workflow_milestones": ("/company-settings/job-file-settings/workflow-milestones", True),
    "lead_sources": ("/company-settings/leads/lead-sources", True),
    "account_types": ("/company-settings/location-settings/account-types", True),
    "custom_field_definitions": ("/company-settings/custom-fields", True),
    "contact_types": ("/contacts/contact-types", True),
    "calendars": ("/calendars", True),
}

USER_STATUSES = ["Active", "Inactive", "Archived", "Deleted"]


def _write(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    tmp.replace(path)


def _read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


class ApiCollector:
    def __init__(self, cfg: ExportConfig, reader: AccuLynxReader, refresh: bool = False):
        self.cfg = cfg
        self.api = reader
        self.refresh = refresh
        self.root = cfg.raw_api_dir

    # ---------------- company-wide ----------------

    def collect_company(self) -> None:
        for name, (path, paginated) in COMPANY_ENDPOINTS.items():
            out = self.root / "company" / f"{name}.json"
            if out.exists() and not self.refresh:
                continue
            try:
                data = self.api.get_all(path, page_size=100) if paginated else self.api.get_optional(path)
            except Exception as e:  # keep going - one lookup failing shouldn't stop the export
                logger.error(f"company/{name}: {e}")
                data = {"_error": str(e)}
            _write(out, data)

        # Milestone statuses (only exist with custom workflows)
        milestones = _read(self.root / "company" / "workflow_milestones.json")
        out = self.root / "company" / "milestone_statuses.json"
        if isinstance(milestones, list) and (self.refresh or not out.exists()):
            statuses = {}
            for m in milestones:
                key = m.get("name") or m.get("id")
                if key:
                    statuses[key] = self.api.get_all(
                        f"/company-settings/job-file-settings/workflow-milestones/{key}/statuses"
                    )
            _write(out, statuses)

        out = self.root / "company" / "users.json"
        if self.refresh or not out.exists():
            users: Dict[str, Dict] = {}
            for status in USER_STATUSES:
                for u in self.api.get_all("/users", {"status": status}, page_size=100):
                    users[u["id"]] = u
            _write(out, list(users.values()))

    # ---------------- jobs ----------------

    def list_job_ids(self) -> List[Dict]:
        """
        List every job, assigned and unassigned. Date range covers the whole
        account history; results are keyed by id so overlaps don't duplicate.
        """
        jobs: Dict[str, Dict] = {}
        end = (date.today() + timedelta(days=1)).isoformat()
        for assignment in ("assigned", "unassigned"):
            params = {
                "startDate": self.cfg.history_start_date,
                "endDate": end,
                "dateFilterType": "CreatedDate",
                "sortBy": "CreatedDate",
                "sortOrder": "Ascending",
                "assignment": assignment,
                "includes": "contact",
            }
            for job in self.api.paginate("/jobs", params, page_size=25):
                job["_assignment"] = assignment
                jobs[job["id"]] = job
            logger.info(f"Listed {len(jobs)} jobs so far (after '{assignment}')")
        index = list(jobs.values())
        _write(self.root / "job_index.json", index)
        return index

    def _job_estimates(self, job_id: str) -> List[Dict]:
        estimates = []
        for summary in self.api.get_all(f"/jobs/{job_id}/estimates"):
            est_id = summary["id"]
            est = self.api.get_optional(
                f"/estimates/{est_id}", {"includes": "job,createdBy,modifiedBy,sections"}
            ) or summary
            sections = self.api.get_all(f"/estimates/{est_id}/sections", {"includes": "createdBy,modifiedBy"})
            for section in sections:
                section["items"] = self.api.get_all(f"/estimates/{est_id}/sections/{section['id']}/items", page_size=100)
            est["sections"] = sections
            estimates.append(est)
        return estimates

    def _job_financials(self, job_id: str) -> Optional[Dict]:
        fin = self.api.get_optional(f"/jobs/{job_id}/financials", {"includes": "worksheet,amendments"})
        if not fin or not fin.get("id"):
            return fin
        fid = fin["id"]
        fin["worksheet_detail"] = self.api.get_optional(f"/financials/{fid}/worksheet")
        amendments = []
        for a in self.api.get_all(f"/financials/{fid}/amendments"):
            amendments.append(self.api.get_optional(f"/financials/{fid}/amendments/{a['id']}") or a)
        fin["amendments_detail"] = amendments
        return fin

    def _job_supplements(self, job_id: str) -> List[Dict]:
        supplements = []
        for s in self.api.get_all("/supplements", {"jobId": job_id}):
            sid = s["id"]
            full = self.api.get_optional(f"/supplements/{sid}") or s
            full["items_detail"] = self.api.get_all(f"/supplements/{sid}/items", page_size=100)
            full["notations_detail"] = self.api.get_all(f"/supplements/{sid}/notations", page_size=100)
            supplements.append(full)
        return supplements

    def collect_job(self, listing: Dict) -> Dict:
        job_id = listing["id"]
        out = self.root / "jobs" / f"{job_id}.json"
        if out.exists() and not self.refresh:
            return _read(out)

        errors: Dict[str, str] = {}

        def safe(name, fn):
            try:
                return fn()
            except NotFound:
                return None
            except Exception as e:
                logger.error(f"job {job_id} {name}: {e}")
                errors[name] = str(e)
                return None

        a = self.api
        record: Dict[str, Any] = {"listing": listing, "collected_at": datetime.utcnow().isoformat() + "Z"}
        record["job"] = safe("job", lambda: a.get(f"/jobs/{job_id}", {"includes": "contact,initialAppointment"}))
        record["contacts"] = safe("contacts", lambda: a.get_all(f"/jobs/{job_id}/contacts", {"includes": "contact"}))
        record["insurance"] = safe("insurance", lambda: a.get(f"/jobs/{job_id}/insurance"))
        record["adjuster"] = safe("adjuster", lambda: a.get(f"/jobs/{job_id}/adjuster"))
        record["representatives"] = safe("representatives", lambda: a.get_all(f"/jobs/{job_id}/representatives"))
        record["company_representative"] = safe("company_rep", lambda: a.get(f"/jobs/{job_id}/representatives/company"))
        record["sales_owner"] = safe("sales_owner", lambda: a.get(f"/jobs/{job_id}/representatives/sales-owner"))
        record["ar_owner"] = safe("ar_owner", lambda: a.get(f"/jobs/{job_id}/representatives/ar-owner"))
        record["initial_appointment"] = safe("initial_appointment", lambda: a.get(f"/jobs/{job_id}/initial-appointment"))
        record["custom_fields"] = safe("custom_fields", lambda: a.get_all(f"/jobs/{job_id}/custom-fields", page_size=100))
        record["current_milestone"] = safe("current_milestone", lambda: a.get(f"/jobs/{job_id}/milestones/current", {"includes": "status"}))
        record["milestone_history"] = safe("milestone_history", lambda: a.get_all(f"/jobs/{job_id}/milestone-history"))
        record["history"] = safe("history", lambda: a.get_all(f"/jobs/{job_id}/history", {"includes": "createdBy"}, page_size=100))
        record["lead_history"] = safe("lead_history", lambda: a.get_all(f"/leads/{job_id}/history", {"includes": "createdBy"}))
        record["estimates"] = safe("estimates", lambda: self._job_estimates(job_id))
        record["financials"] = safe("financials", lambda: self._job_financials(job_id))
        record["invoices"] = safe("invoices", lambda: [
            a.get_optional(f"/invoices/{inv['id']}") or inv for inv in a.get_all(f"/jobs/{job_id}/invoices")
        ])
        record["payments"] = safe("payments", lambda: a.get(f"/jobs/{job_id}/payments"))
        record["payments_overview"] = safe("payments_overview", lambda: a.get(f"/jobs/{job_id}/payments/overview"))
        record["supplements"] = safe("supplements", lambda: self._job_supplements(job_id))
        record["accounting_integration_status"] = safe(
            "accounting_status", lambda: a.get(f"/jobs/{job_id}/accounting/integration-status")
        )
        record["errors"] = errors
        _write(out, record)
        return record

    # ---------------- contacts ----------------

    def collect_contacts(self, extra_ids: List[str]) -> None:
        ids: Dict[str, Dict] = {}
        for c in self.api.paginate("/contacts", {"includes": "emailAddress,phoneNumber"}, page_size=25):
            ids[c["id"]] = c
        for cid in extra_ids:
            ids.setdefault(cid, {"id": cid})
        logger.info(f"Collecting {len(ids)} contacts")

        for n, (cid, listing) in enumerate(ids.items(), 1):
            self._collect_contact(cid, listing)
            if n % 50 == 0:
                logger.info(f"  contacts {n}/{len(ids)}")

    def _collect_contact(self, cid: str, listing: Dict) -> None:
        out = self.root / "contacts" / f"{cid}.json"
        if out.exists() and not self.refresh:
            return
        a = self.api
        _write(out, {
            "listing": listing,
            "contact": a.get_optional(f"/contacts/{cid}", {"includes": "emailAddress,phoneNumber"}),
            "email_addresses": a.get_all(f"/contacts/{cid}/email-addresses"),
            "phone_numbers": a.get_all(f"/contacts/{cid}/phone-numbers"),
            "custom_fields": a.get_all(f"/contacts/{cid}/custom-fields", page_size=100),
            "jobs": a.get_all(f"/contacts/{cid}/jobs"),
        })

    # ---------------- appointments ----------------

    def collect_appointments(self) -> None:
        out = self.root / "appointments.json"
        if out.exists() and not self.refresh:
            return
        calendars = _read(self.root / "company" / "calendars.json")
        if not isinstance(calendars, list):
            calendars = []
        appointments: Dict[str, Dict] = {}
        start = date.fromisoformat(self.cfg.history_start_date)
        stop = date.today() + timedelta(days=365)
        for cal in calendars:
            cursor = start
            while cursor < stop:
                window_end = min(cursor + timedelta(days=89), stop)
                for appt in self.api.get_all(
                    f"/calendars/{cal['id']}/appointments",
                    {"startDate": cursor.isoformat(), "endDate": window_end.isoformat()},
                    page_size=100,
                ):
                    appt["_calendar"] = {"id": cal["id"], "name": cal.get("name")}
                    appointments[appt["id"]] = appt
                cursor = window_end + timedelta(days=1)
        _write(out, list(appointments.values()))

    # ---------------- driver ----------------

    def run(self, only_job_ids: Optional[List[str]] = None, limit: Optional[int] = None) -> None:
        self.collect_company()

        if only_job_ids:
            index = [{"id": j} for j in only_job_ids]
        else:
            index = self.list_job_ids()
        if limit:
            index = index[:limit]

        contact_ids = set()
        for n, listing in enumerate(index, 1):
            record = self.collect_job(listing)
            for jc in record.get("contacts") or []:
                cid = (jc.get("contact") or {}).get("id")
                if cid:
                    contact_ids.add(cid)
            if n % 10 == 0 or n == len(index):
                logger.info(f"Jobs {n}/{len(index)} (API calls so far: {self.api.call_count})")

        # A limited/test run only pulls contacts tied to those jobs
        if only_job_ids or limit:
            for cid in sorted(contact_ids):
                self._collect_contact(cid, {"id": cid})
        else:
            self.collect_contacts(sorted(contact_ids))
        self.collect_appointments()
        logger.info(f"API collection done - {self.api.call_count} calls")
