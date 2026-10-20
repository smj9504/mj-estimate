"""
Who may see an estimate or invoice.

Each person sees the documents they own. A super admin sees everyone's.
"""
import uuid
from typing import Any, Optional

from fastapi import HTTPException, status

from app.domains.staff.models import StaffRole


def sees_all_documents(staff: Any) -> bool:
    return staff.role == StaffRole.super_admin


def can_access_document(owner_id: Any, staff: Any) -> bool:
    if sees_all_documents(staff):
        return True
    return owner_id is not None and str(owner_id) == str(staff.id)


def owner_to_list(staff: Any, scope: str = 'mine') -> Optional[str]:
    """The owner whose documents a list shows, or None for everyone's.

    Only a super admin can ask for everyone's (scope='all').
    """
    if scope == 'all' and sees_all_documents(staff):
        return None
    return str(staff.id)


def require_document_access(db: Any, model: Any, document_id: str, staff: Any, label: str) -> None:
    """404 unless the document exists and this person may open it.

    Someone else's document answers 404 rather than 403, so whether it
    exists isn't given away.
    """
    not_found = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} not found")
    try:
        uuid.UUID(str(document_id))
    except ValueError:
        raise not_found
    row = db.query(model.owner_id).filter(model.id == str(document_id)).first()
    if row is None or not can_access_document(row[0], staff):
        raise not_found


def owner_names(db: Any, owner_ids: Any) -> dict:
    """Display names for the given staff ids, keyed by id string"""
    from app.domains.staff.models import Staff

    ids = {str(i) for i in owner_ids if i}
    if not ids:
        return {}
    rows = db.query(Staff.id, Staff.first_name, Staff.last_name).filter(Staff.id.in_(ids)).all()
    return {str(r.id): f"{r.first_name} {r.last_name}".strip() for r in rows}
