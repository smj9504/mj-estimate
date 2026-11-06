"""
What a public adjuster login may do with a supplement's bid items.

A public adjuster adds bid items (uploads) but can't change or delete the
ones anyone else put there. Items added by a public adjuster stay open to
every public adjuster who can see the supplement. Everyone else keeps full
control of every item. Items saved before the creator was recorded count as
not added by a public adjuster.
"""
from typing import Any, Dict, Iterable, List

from fastapi import HTTPException

PUBLIC_ADJUSTER = "public_adjuster"


def _session(db: Any) -> Any:
    return db._session if hasattr(db, "_session") else db


def is_public_adjuster(staff: Any) -> bool:
    role = getattr(staff, "role", None)
    return getattr(role, "value", role) == PUBLIC_ADJUSTER


def public_adjuster_ids(db: Any, staff_ids: Iterable[Any]) -> set:
    """The ids, as text, of the staff among these whose role is public adjuster"""
    from app.domains.staff.models import Staff

    ids = {str(i) for i in staff_ids if i}
    if not ids:
        return set()
    rows = _session(db).query(Staff.id, Staff.role).filter(Staff.id.in_(list(ids))).all()
    return {
        str(staff_id) for staff_id, role in rows
        if getattr(role, "value", role) == PUBLIC_ADJUSTER
    }


def mark_added_by_public_adjuster(db: Any, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Set added_by_public_adjuster on each bid item dict"""
    pa_ids = public_adjuster_ids(db, (i.get("created_by_id") for i in items))
    for item in items:
        creator = item.get("created_by_id")
        item["added_by_public_adjuster"] = bool(creator) and str(creator) in pa_ids
    return items


def require_may_change_bid_item(db: Any, staff: Any, item_id: Any) -> None:
    """403 when a public adjuster tries to change a bid item no public adjuster added"""
    if not is_public_adjuster(staff):
        return
    from app.domains.supplement.models import BidItemEstimate

    row = _session(db).query(BidItemEstimate.created_by_id).filter(
        BidItemEstimate.id == str(item_id)
    ).first()
    creator = row[0] if row else None
    if not creator or str(creator) not in public_adjuster_ids(db, [creator]):
        raise HTTPException(
            status_code=403,
            detail="A public adjuster can change only bid items a public adjuster added",
        )


def refuse_public_adjuster(staff: Any, action: str) -> None:
    if is_public_adjuster(staff):
        raise HTTPException(status_code=403, detail=f"A public adjuster can't {action}")
