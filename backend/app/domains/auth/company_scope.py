"""
Which claims, cash jobs, clients and documents a staff member may see.

Admins see everything. Everyone else belongs to one or more companies
(staff_companies), or to every company including ones added later
(staff.all_companies), and sees:
- the claims and cash jobs one of their companies is assigned to
  (claim_companies), with everything on them;
- the clients of those, and clients their company manages (clients.company_id)
  so a new client shows before it has a claim;
- documents on those claims, and documents their company issued.
Someone with no company sees none of it.

The conditions below return None when there is nothing to filter (an admin),
so callers write `query = scoped(query, condition)`.
"""
import uuid
from typing import Any, Iterable, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import false, or_, select

from app.domains.staff.models import StaffRole

ALL_DATA_ROLES = (StaffRole.admin, StaffRole.super_admin)


def _session(db: Any) -> Any:
    """The SQLAlchemy session behind whatever wrapper the caller holds"""
    for attr in ('_session', 'session'):
        inner = getattr(db, attr, None)
        if inner is not None and hasattr(inner, 'query'):
            return inner
    return db


def _role(staff: Any) -> Any:
    role = getattr(staff, 'role', None)
    if isinstance(role, str):
        try:
            return StaffRole(role)
        except ValueError:
            return role
    return role


def sees_everything(staff: Any) -> bool:
    return staff is not None and _role(staff) in ALL_DATA_ROLES


def staff_company_ids(db: Any, staff_id: Any) -> List[str]:
    from app.domains.staff.models import StaffCompany

    rows = _session(db).query(StaffCompany.company_id).filter(
        StaffCompany.staff_id == str(staff_id)
    ).all()
    return [str(r[0]) for r in rows]


def _in_all_companies(db: Any, staff_id: Any) -> bool:
    # Read from the row, not the staff object: the auth cache doesn't carry it
    from app.domains.staff.models import Staff

    return bool(_session(db).query(Staff.all_companies).filter(
        Staff.id == str(staff_id)
    ).scalar())


def company_ids(db: Any, staff: Any) -> Optional[List[str]]:
    """The staff member's companies, or None for an admin (no limit)"""
    from app.domains.company.models import Company

    if sees_everything(staff):
        return None
    if _in_all_companies(db, staff.id):
        return [str(r[0]) for r in _session(db).query(Company.id).all()]
    return staff_company_ids(db, staff.id)


def home_company_ids(db: Any, staff: Any) -> Optional[List[str]]:
    """The companies new work of theirs goes to when none is chosen: the ones
    picked for them, even when they belong to every company. None for an admin."""
    if sees_everything(staff):
        return None
    return staff_company_ids(db, staff.id)


def _visible_claim_ids(ids: List[str]):
    from app.domains.contract.models import ClaimCompany

    return select(ClaimCompany.claim_id).where(ClaimCompany.company_id.in_(ids))


def claim_condition(db: Any, staff: Any, claim_id_column: Any):
    """Rows whose claim the staff member may see. A row on no claim fails it."""
    ids = company_ids(db, staff)
    if ids is None:
        return None
    if not ids:
        return false()
    return claim_id_column.in_(_visible_claim_ids(ids))


def document_condition(db: Any, staff: Any, claim_id_column: Any = None,
                       company_id_column: Any = None):
    """Documents on a claim the staff member may see, or issued by their company"""
    ids = company_ids(db, staff)
    if ids is None:
        return None
    if not ids:
        return false()
    parts = []
    if claim_id_column is not None:
        parts.append(claim_id_column.in_(_visible_claim_ids(ids)))
    if company_id_column is not None:
        parts.append(company_id_column.in_(ids))
    return or_(*parts) if parts else false()


def client_condition(db: Any, staff: Any, client_id_column: Any = None):
    """Clients with a claim the staff member may see, or managed by their company"""
    from app.domains.client.models import Claim, Client

    ids = company_ids(db, staff)
    if ids is None:
        return None
    if not ids:
        return false()
    column = client_id_column if client_id_column is not None else Client.id
    with_claims = select(Claim.client_id).where(Claim.id.in_(_visible_claim_ids(ids)))
    managed = select(Client.id).where(Client.company_id.in_(ids))
    return or_(column.in_(with_claims), column.in_(managed))


def scoped(query: Any, condition: Any) -> Any:
    return query if condition is None else query.filter(condition)


def _is_uuid(value: Any) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except (TypeError, ValueError):
        return False


def can_see_claim(db: Any, staff: Any, claim_id: Any) -> bool:
    from app.domains.client.models import Claim

    if sees_everything(staff):
        return True
    if not claim_id or not _is_uuid(claim_id):
        return False
    query = _session(db).query(Claim.id).filter(Claim.id == str(claim_id))
    return scoped(query, claim_condition(db, staff, Claim.id)).first() is not None


def can_see_client(db: Any, staff: Any, client_id: Any) -> bool:
    from app.domains.client.models import Client

    if sees_everything(staff):
        return True
    if not client_id or not _is_uuid(client_id):
        return False
    query = _session(db).query(Client.id).filter(Client.id == str(client_id))
    return scoped(query, client_condition(db, staff)).first() is not None


def can_see_document(db: Any, staff: Any, claim_id: Any = None, company_id: Any = None) -> bool:
    """A document on a claim the staff member may see, or issued by their company"""
    ids = company_ids(db, staff)
    if ids is None:
        return True
    if company_id and str(company_id) in ids:
        return True
    return bool(claim_id) and can_see_claim(db, staff, claim_id)


def _not_found(label: str) -> HTTPException:
    # 404 rather than 403, so whether it exists isn't given away
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} not found")


def require_claim(db: Any, staff: Any, claim_id: Any, label: str = "Claim") -> None:
    if not can_see_claim(db, staff, claim_id):
        raise _not_found(label)


def require_client(db: Any, staff: Any, client_id: Any, label: str = "Client") -> None:
    if not can_see_client(db, staff, client_id):
        raise _not_found(label)


def require_document(db: Any, staff: Any, model: Any, document_id: Any, label: str,
                     claim_attr: str = 'claim_id', company_attr: Optional[str] = 'company_id') -> None:
    """404 unless the row exists and is on a claim the staff member may see
    (or, with company_attr, was issued by their company)"""
    if sees_everything(staff):
        return
    if not _is_uuid(document_id):
        raise _not_found(label)
    columns = [getattr(model, claim_attr)]
    if company_attr:
        columns.append(getattr(model, company_attr))
    row = _session(db).query(*columns).filter(model.id == str(document_id)).first()
    if row is None:
        raise _not_found(label)
    company_id = row[1] if company_attr else None
    if not can_see_document(db, staff, row[0], company_id):
        raise _not_found(label)


def visible_claim_id_set(db: Any, staff: Any, claim_ids: Iterable[Any]) -> Optional[set]:
    """Of these claim ids, the ones the staff member may see (None = all of them)"""
    from app.domains.client.models import Claim

    if sees_everything(staff):
        return None
    wanted = [str(c) for c in claim_ids if c and _is_uuid(c)]
    if not wanted:
        return set()
    query = _session(db).query(Claim.id).filter(Claim.id.in_(wanted))
    return {str(r[0]) for r in scoped(query, claim_condition(db, staff, Claim.id)).all()}
