"""
Company prices for the bathroom and kitchen cabinet estimates.

Behind the "unit_prices" screen. A company's prices can be read and
changed by someone with that screen who belongs to the company (admins:
every company).
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict

from app.core.database_factory import get_db
from app.domains.auth import company_scope
from app.domains.auth.dependencies import require_screen

from . import catalog
from .service import UnitPriceError, UnitPriceService

router = APIRouter(prefix="/unit-prices", tags=["Unit Prices"])

SCREEN = "unit_prices"


class PriceChange(BaseModel):
    """Leave a side out to keep it; send null to put it back to the default."""
    model_config = ConfigDict(extra="forbid")

    material: Optional[float] = None
    labor: Optional[float] = None


class PriceChanges(BaseModel):
    prices: Dict[str, PriceChange]


def _domain(domain: str) -> str:
    try:
        catalog.get_domain(domain)
    except KeyError:
        raise HTTPException(status_code=404, detail="No such price list")
    return domain


def _require_company(db: Any, staff: Any, company_id: Optional[str]) -> str:
    if not company_id:
        raise HTTPException(status_code=400, detail="Pick a company")
    allowed = company_scope.company_ids(db, staff)
    if allowed is not None and str(company_id) not in {str(c) for c in allowed}:
        raise HTTPException(status_code=403, detail="You don't have access to this company")
    from app.domains.company.models import Company

    if not company_scope._session(db).query(Company.id).filter(Company.id == str(company_id)).first():
        raise HTTPException(status_code=404, detail="Company not found")
    return str(company_id)


def _fail(e: UnitPriceError) -> HTTPException:
    return HTTPException(status_code=e.status, detail=str(e))


@router.get("/companies")
def list_companies(db: Any = Depends(get_db), staff: Any = Depends(require_screen(SCREEN))) -> List[Dict[str, Any]]:
    """The companies this person may price."""
    from app.domains.company.models import Company

    query = company_scope._session(db).query(Company.id, Company.name)
    allowed = company_scope.company_ids(db, staff)
    if allowed is not None:
        if not allowed:
            return []
        query = query.filter(Company.id.in_(allowed))
    return [{"id": str(cid), "name": name} for cid, name in query.order_by(Company.name).all()]


@router.get("/domains")
def list_domains(staff: Any = Depends(require_screen(SCREEN))) -> List[Dict[str, Any]]:
    return [{"key": d.key, "label": d.label, "count": len(d.items())} for d in catalog.domains()]


@router.get("/{domain}")
def get_prices(
    domain: str,
    company_id: Optional[str] = Query(None),
    db: Any = Depends(get_db),
    staff: Any = Depends(require_screen(SCREEN)),
) -> Dict[str, Any]:
    domain = _domain(domain)
    company_id = _require_company(db, staff, company_id)
    return UnitPriceService(db).price_list(domain, company_id)


@router.put("/{domain}")
def save_prices(
    domain: str,
    body: PriceChanges,
    company_id: Optional[str] = Query(None),
    db: Any = Depends(get_db),
    staff: Any = Depends(require_screen(SCREEN)),
) -> Dict[str, Any]:
    domain = _domain(domain)
    company_id = _require_company(db, staff, company_id)
    changes = {key: change.model_dump(exclude_unset=True) for key, change in body.prices.items()}
    try:
        return UnitPriceService(db).save(domain, company_id, changes, staff_id=str(staff.id))
    except UnitPriceError as e:
        raise _fail(e)


@router.get("/{domain}/history")
def get_history(
    domain: str,
    company_id: Optional[str] = Query(None),
    db: Any = Depends(get_db),
    staff: Any = Depends(require_screen(SCREEN)),
) -> List[Dict[str, Any]]:
    domain = _domain(domain)
    company_id = _require_company(db, staff, company_id)
    return UnitPriceService(db).history(domain, company_id)
