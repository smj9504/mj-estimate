"""
Sheet rows with the same address as something entered by hand.

What comes off the Google Sheet and what staff enter by hand stay apart unless
someone says they are the same. The sync holds a row at the address of a manual
job or client (see WMSheetRowMatch), and this finds what it matches and lists the
rows waiting on a decision. Candidates are looked up each time rather than stored,
so one that was deleted or linked since simply drops off.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import or_

from app.domains.auth.company_scope import client_condition, scoped
from app.domains.client.client_sync_service import SHEET_SOURCE
from app.domains.client.models import Claim, Client
from app.domains.integrations.google_sheets.utils import (
    addresses_match,
    parse_date_value,
    parse_month_day_value,
)
from app.domains.water_mitigation.job_access import job_condition
from app.domains.water_mitigation.models import WaterMitigationJob, WMSheetRowMatch


def is_companycam_lead(job: WaterMitigationJob) -> bool:
    """A lead the CompanyCam webhook made: nobody entered it, and there is nothing
    on it but the project's address and name, so a sheet row just fills it in."""
    return bool(job.companycam_project_id) and not any((
        job.created_by_id, job.claim_id, job.homeowner_phone, job.homeowner_email,
        job.insurance_company, job.claim_number, job.google_sheet_name,
    ))


def _unlinked_jobs(db: Any) -> List[WaterMitigationJob]:
    """Active jobs on no row: entered by hand, or the sheet's with their row gone"""
    return db.query(WaterMitigationJob).filter(
        WaterMitigationJob.active.is_(True),
        WaterMitigationJob.google_sheet_row_number.is_(None),
    ).all()


def _manual_clients(db: Any) -> List[Client]:
    """Active clients the sheet didn't make: entered here, or from the AccuLynx archive"""
    return db.query(Client).filter(
        Client.is_active.is_(True),
        Client.address.isnot(None),
        or_(Client.source.is_(None), Client.source != SHEET_SOURCE),
    ).all()


def client_address(client: Client) -> str:
    place = ' '.join(part for part in (client.state, client.zipcode) if part)
    return ', '.join(part for part in (client.address, client.city, place) if part)


def _jobs_at(jobs: List[WaterMitigationJob], address: str) -> List[WaterMitigationJob]:
    return [job for job in jobs if addresses_match(job.property_address, address)]


def _clients_at(clients: List[Client], address: str) -> List[Client]:
    return [client for client in clients if addresses_match(client_address(client), address)]


def has_manual_match(db: Any, address: str) -> bool:
    """Whether a job entered by hand that isn't on a sheet row, or a client the sheet
    didn't make, is at this address"""
    return (
        any(not is_companycam_lead(job) for job in _jobs_at(_unlinked_jobs(db), address))
        or bool(_clients_at(_manual_clients(db), address))
    )


def find_companycam_lead(db: Any, address: str) -> Optional[WaterMitigationJob]:
    return next((job for job in _jobs_at(_unlinked_jobs(db), address) if is_companycam_lead(job)), None)


def pending_match(db: Any, row_number: int, sheet_name: str) -> Optional[WMSheetRowMatch]:
    return db.query(WMSheetRowMatch).filter(
        WMSheetRowMatch.sheet_name == sheet_name,
        WMSheetRowMatch.row_number == row_number,
        WMSheetRowMatch.status == 'pending',
    ).first()


def mapped_job_match(db: Any, job: WaterMitigationJob) -> Optional[WMSheetRowMatch]:
    """The decision that linked this job, entered by hand, to the sheet row it is on"""
    return db.query(WMSheetRowMatch).filter(
        WMSheetRowMatch.job_id == job.id,
        WMSheetRowMatch.status == 'same',
        WMSheetRowMatch.matched_type == 'job',
    ).first()


def _day(value: Optional[datetime]) -> Optional[str]:
    return value.strftime('%Y-%m-%d') if value else None


def _clean(value: Any) -> Optional[str]:
    return str(value).strip() or None if value is not None else None


def _row_summary(match: WMSheetRowMatch) -> Dict[str, Any]:
    row = match.row_data or {}
    loss = _clean(row.get('date_of_loss'))
    parsed = None
    if loss:
        parsed = parse_date_value(loss) or parse_month_day_value(
            loss, (match.created_at or datetime.utcnow()).replace(tzinfo=None)
        )
    return {
        'homeowner_name': _clean(row.get('homeowner_name')),
        'homeowner_phone': _clean(row.get('homeowner_phone')),
        'homeowner_email': _clean(row.get('homeowner_email')),
        'insurance_company': _clean(row.get('insurance_company')),
        'claim_number': _clean(row.get('claim_number')),
        'date_of_loss': _day(parsed) or loss,
    }


def _job_candidate(db: Any, job: WaterMitigationJob) -> Dict[str, Any]:
    client = None
    if job.claim_id:
        client = db.query(Client).join(Claim, Claim.client_id == Client.id).filter(
            Claim.id == job.claim_id
        ).first()
    return {
        'type': 'job',
        'id': str(job.id),
        'address': job.property_address,
        'homeowner_name': job.homeowner_name,
        'homeowner_phone': job.homeowner_phone,
        'homeowner_email': job.homeowner_email,
        'insurance_company': job.insurance_company,
        'claim_number': job.claim_number,
        'date_of_loss': _day(job.date_of_loss),
        'status': job.status,
        # The tab it was on, when its row is gone from there
        'sheet_name': job.google_sheet_name,
        'client_id': str(client.id) if client else None,
        'created_at': job.created_at.isoformat() if job.created_at else None,
    }


def _client_candidate(db: Any, client: Client) -> Dict[str, Any]:
    claims = db.query(Claim.claim_number, Claim.date_of_loss).filter(Claim.client_id == client.id).all()
    return {
        'type': 'client',
        'id': str(client.id),
        'address': client_address(client),
        'homeowner_name': client.display_name,
        'homeowner_phone': client.phone,
        'homeowner_email': client.email,
        'insurance_company': client.insurance_company,
        'claim_number': ', '.join(claim.claim_number for claim in claims if claim.claim_number) or None,
        'date_of_loss': _day(claims[0].date_of_loss) if len(claims) == 1 else None,
        'source': client.source,
        'created_at': client.created_at.isoformat() if client.created_at else None,
    }


def _visible_jobs(db: Any, staff: Any, jobs: List[WaterMitigationJob]) -> List[WaterMitigationJob]:
    condition = job_condition(db, staff)
    if condition is None or not jobs:
        return jobs
    ids = {
        row[0] for row in db.query(WaterMitigationJob.id).filter(
            WaterMitigationJob.id.in_([job.id for job in jobs]), condition
        ).all()
    }
    return [job for job in jobs if job.id in ids]


def _visible_clients(db: Any, staff: Any, clients: List[Client]) -> List[Client]:
    if not clients:
        return clients
    query = db.query(Client.id).filter(Client.id.in_([client.id for client in clients]))
    ids = {row[0] for row in scoped(query, client_condition(db, staff)).all()}
    return [client for client in clients if client.id in ids]


def _candidates(
    db: Any,
    staff: Any,
    address: str,
    jobs: List[WaterMitigationJob],
    clients: List[Client],
) -> List[Dict[str, Any]]:
    """What a row at this address may be, among what the staff member may see. Jobs
    first; a client already shown as a job's client isn't listed a second time."""
    manual_jobs = [job for job in _jobs_at(jobs, address) if not is_companycam_lead(job)]
    found = [_job_candidate(db, job) for job in _visible_jobs(db, staff, manual_jobs)]
    shown = {job['client_id'] for job in found}
    return found + [
        _client_candidate(db, client)
        for client in _visible_clients(db, staff, _clients_at(clients, address))
        if str(client.id) not in shown
    ]


def candidates_for(db: Any, staff: Any, match: WMSheetRowMatch) -> List[Dict[str, Any]]:
    return _candidates(db, staff, match.address, _unlinked_jobs(db), _manual_clients(db))


def list_pending(db: Any, staff: Any) -> List[Dict[str, Any]]:
    """Rows waiting on a decision. One whose candidates are gone, or that this staff
    member can't see any of, isn't listed; the next sync closes the first kind."""
    matches = db.query(WMSheetRowMatch).filter(WMSheetRowMatch.status == 'pending').order_by(
        WMSheetRowMatch.created_at, WMSheetRowMatch.sheet_name, WMSheetRowMatch.row_number,
    ).all()
    if not matches:
        return []

    jobs, clients = _unlinked_jobs(db), _manual_clients(db)
    pending = []
    for match in matches:
        candidates = _candidates(db, staff, match.address, jobs, clients)
        if candidates:
            pending.append({
                'id': str(match.id),
                'sheet_name': match.sheet_name,
                'row_number': match.row_number,
                'address': match.address,
                'row': _row_summary(match),
                'candidates': candidates,
                'created_at': match.created_at.isoformat() if match.created_at else None,
            })
    return pending
