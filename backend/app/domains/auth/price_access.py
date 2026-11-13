"""
Who may change a price list that several companies share a table for.

A row with a company belongs to that company: its people may change it
(admins: any company). A row with no company is the default every company
falls back to, so only an admin may change it. Callers check the screen
that edits the list (require_screen) as well.
"""
from typing import Any, Optional

from fastapi import HTTPException, status

from . import company_scope


def require_price_company(db: Any, staff: Any, company_id: Optional[Any]) -> Optional[str]:
    """The company whose prices this person may change, or None for the defaults."""
    if not company_id:
        if not company_scope.sees_everything(staff):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only an admin can change the default prices every company uses",
            )
        return None
    allowed = company_scope.company_ids(db, staff)
    if allowed is not None and str(company_id) not in {str(c) for c in allowed}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this company",
        )
    return str(company_id)
