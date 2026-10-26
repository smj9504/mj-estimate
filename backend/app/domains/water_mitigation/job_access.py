"""
Which water mitigation jobs a staff member may see.

A job is visible when its claim is (claim_companies) or its company_id is one
of the staff member's companies. Photos, documents, scope, sketches and the
rest follow their job. Admins see everything: the conditions return None and
the require_* checks return straight away.
"""
from typing import Any, Iterable
from uuid import UUID

from fastapi import Depends, HTTPException, status
from sqlalchemy import select

from app.core.database_factory import get_db_session
from app.domains.auth.company_scope import (
    company_ids,
    document_condition,
    require_document,
    sees_everything,
)
from app.domains.auth.dependencies import get_current_staff

from .models import WaterMitigationJob, WMDocument, WMPhoto, WMScopeItem, WMScopeLocation


def job_condition(db: Any, staff: Any):
    """Jobs the staff member may see, or None for an admin"""
    return document_condition(
        db, staff, WaterMitigationJob.claim_id, WaterMitigationJob.company_id
    )


def job_child_condition(db: Any, staff: Any, job_id_column: Any):
    """Rows hanging off a job (photos, documents, ...) whose job is visible"""
    condition = job_condition(db, staff)
    if condition is None:
        return None
    return job_id_column.in_(select(WaterMitigationJob.id).where(condition))


def _not_found(label: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} not found")


def _uuid_str(value: Any):
    try:
        return str(UUID(str(value)))
    except (TypeError, ValueError):
        return None


def require_job(db: Any, staff: Any, job_id: Any, label: str = "Job") -> None:
    require_document(db, staff, WaterMitigationJob, job_id, label)


def _require_job_of(db: Any, staff: Any, query: Any, label: str) -> None:
    """404 unless query (selecting a job id) finds a row on a visible job"""
    row = query.first()
    if row is None or row[0] is None:
        raise _not_found(label)
    require_job(db, staff, row[0], label)


def require_job_row(db: Any, staff: Any, model: Any, row_id: Any, label: str,
                    job_attr: str = 'job_id', id_attr: str = 'id') -> None:
    """404 unless the row exists and its job is visible"""
    if sees_everything(staff):
        return
    row_id = _uuid_str(row_id)
    if row_id is None:
        raise _not_found(label)
    query = db.query(getattr(model, job_attr)).filter(getattr(model, id_attr) == row_id)
    _require_job_of(db, staff, query, label)


def require_photo(db: Any, staff: Any, photo_id: Any) -> None:
    require_job_row(db, staff, WMPhoto, photo_id, "Photo")


def require_scope_location(db: Any, staff: Any, location_id: Any) -> None:
    require_job_row(db, staff, WMScopeLocation, location_id, "Location")


def require_scope_item(db: Any, staff: Any, item_id: Any) -> None:
    """404 unless the scope item's location is on a visible job"""
    if sees_everything(staff):
        return
    item_id = _uuid_str(item_id)
    if item_id is None:
        raise _not_found("Item")
    query = db.query(WMScopeLocation.job_id).join(
        WMScopeItem, WMScopeItem.location_id == WMScopeLocation.id
    ).filter(WMScopeItem.id == item_id)
    _require_job_of(db, staff, query, "Item")


def require_photos(db: Any, staff: Any, photo_ids: Iterable[Any]) -> None:
    """404 if any of these photos is on a job the staff member may not see.
    Ids that don't exist are left to the route, which skips them as before."""
    condition = job_child_condition(db, staff, WMPhoto.job_id)
    if condition is None:
        return
    ids = [i for i in (_uuid_str(p) for p in photo_ids or []) if i]
    if not ids:
        return
    existing = {str(r[0]) for r in db.query(WMPhoto.id).filter(WMPhoto.id.in_(ids)).all()}
    visible = {
        str(r[0]) for r in db.query(WMPhoto.id).filter(WMPhoto.id.in_(ids), condition).all()
    }
    if existing - visible:
        raise _not_found("Photo")


def company_for_new_job(db: Any, staff: Any, company_id: Any):
    """The company a new job goes to. Someone who isn't an admin can only put
    a job in one of their own companies, or they couldn't see it afterwards."""
    ids = company_ids(db, staff)
    if ids is None:
        return company_id
    if company_id:
        if str(company_id) not in ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You can only create jobs for your own company.",
            )
        return company_id
    if len(ids) == 1:
        return UUID(ids[0])
    if not ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You aren't assigned to a company yet, so you can't create jobs.",
        )
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Choose which of your companies this job is for.",
    )


# Route dependencies: 404 unless the job / photo / document in the path is visible.
# Use as dependencies=[Depends(job_access)].

def job_access(
    job_id: UUID,
    db: Any = Depends(get_db_session),
    current_staff: Any = Depends(get_current_staff),
) -> Any:
    require_job(db, current_staff, job_id)
    return current_staff


def photo_access(
    photo_id: UUID,
    db: Any = Depends(get_db_session),
    current_staff: Any = Depends(get_current_staff),
) -> Any:
    require_photo(db, current_staff, photo_id)
    return current_staff


def document_access(
    document_id: UUID,
    db: Any = Depends(get_db_session),
    current_staff: Any = Depends(get_current_staff),
) -> Any:
    require_job_row(db, current_staff, WMDocument, document_id, "Document")
    return current_staff
