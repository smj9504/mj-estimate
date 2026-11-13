"""
Flooring Estimate API endpoints

The line items are rebuilt from the sketch and the scope on every
calculation, so they are changed through the scope (an item switched on or
off, a quantity or price typed in, a custom item), never edited directly.
"""

import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.core.database_factory import get_db_session
from app.core.interfaces import DatabaseSession
from app.domains.auth.company_scope import document_condition, require_claim, require_document, sees_everything
from app.domains.auth.dependencies import get_current_user
from app.domains.unit_prices.tables import use_prices

from .models import FlooringEstimate
from .schemas import (
    FlooringEstimateCreate,
    FlooringEstimateListResponse,
    FlooringEstimateResponse,
    FlooringEstimateUpdate,
    HistoryResponse,
    SketchUpdate,
)
from .service import FlooringEstimateService, pricing_info

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/flooring-estimates", tags=["Flooring Estimates"])


def _require_estimate(session, staff, estimate_id: str) -> None:
    """404 unless the staff member may see this estimate"""
    require_document(session, staff, FlooringEstimate, estimate_id, "Estimate")


def _require_moved_claim(session, staff, estimate_id: str, claim_id: Optional[str]) -> None:
    """Moving an estimate onto another claim needs that claim to be visible"""
    if not claim_id or sees_everything(staff):
        return
    current = session.query(FlooringEstimate.claim_id).filter(FlooringEstimate.id == estimate_id).scalar()
    if str(current or "") != str(claim_id):
        require_claim(session, staff, claim_id)


def _found(result):
    if not result:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return result


@router.get("/pricing-info")
def get_pricing_info(
    estimate_id: Optional[str] = Query(
        None, description="Quote this estimate's prices (its price book, or its company's today)",
    ),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """The floors, patterns and items an estimate can use, and their prices.

    With an estimate, the prices it is priced with; without, the defaults."""
    if not estimate_id:
        return pricing_info()
    _require_estimate(session, current_user, estimate_id)
    service = FlooringEstimateService(session)
    estimate = session.query(FlooringEstimate).filter(FlooringEstimate.id == estimate_id).first()
    with use_prices(service.prices_for(estimate)):
        return pricing_info()


@router.post("", response_model=FlooringEstimateResponse)
def create_estimate(
    data: FlooringEstimateCreate,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    if data.claim_id:
        require_claim(session, current_user, data.claim_id)
    return FlooringEstimateService(session).create_estimate(data, created_by_id=current_user.id)


@router.get("", response_model=FlooringEstimateListResponse)
def list_estimates(
    claim_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    items, total = FlooringEstimateService(session).list_estimates(
        claim_id=claim_id, company_id=company_id, status=status, search=search,
        page=page, page_size=page_size,
        scope=document_condition(session, current_user, FlooringEstimate.claim_id, FlooringEstimate.company_id),
    )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/{estimate_id}", response_model=FlooringEstimateResponse)
def get_estimate(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    _require_estimate(session, current_user, estimate_id)
    return _found(FlooringEstimateService(session).get_estimate(estimate_id))


@router.put("/{estimate_id}", response_model=FlooringEstimateResponse)
def update_estimate(
    estimate_id: str,
    data: FlooringEstimateUpdate,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    _require_estimate(session, current_user, estimate_id)
    _require_moved_claim(session, current_user, estimate_id, data.claim_id)
    return _found(FlooringEstimateService(session).update_estimate(estimate_id, data))


@router.put("/{estimate_id}/sketch", response_model=FlooringEstimateResponse)
def save_sketch(
    estimate_id: str,
    data: SketchUpdate,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Save the drawing (the editor saves as it is drawn)."""
    _require_estimate(session, current_user, estimate_id)
    return _found(FlooringEstimateService(session).save_sketch(estimate_id, data.sketch_data))


@router.delete("/{estimate_id}")
def delete_estimate(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    _require_estimate(session, current_user, estimate_id)
    _found(FlooringEstimateService(session).delete_estimate(estimate_id))
    return {"message": "Estimate deleted"}


@router.post("/{estimate_id}/calculate", response_model=FlooringEstimateResponse)
def calculate_estimate(
    estimate_id: str,
    data: Optional[FlooringEstimateUpdate] = None,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Save (if a body is sent) then calculate in one round-trip."""
    _require_estimate(session, current_user, estimate_id)
    service = FlooringEstimateService(session)
    if data is not None:
        _require_moved_claim(session, current_user, estimate_id, data.claim_id)
        service.update_estimate(estimate_id, data, skip_full_read=True)
    return _found(service.calculate(estimate_id, changed_by_id=current_user.id))


@router.post("/{estimate_id}/use-current-prices", response_model=FlooringEstimateResponse)
def use_current_prices(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Reprice at today's prices (the defaults with the company's own
    figures). Until this is asked for, an estimate keeps the prices it was
    first priced with."""
    _require_estimate(session, current_user, estimate_id)
    return _found(FlooringEstimateService(session).use_current_prices(estimate_id, changed_by_id=current_user.id))


@router.post("/{estimate_id}/clone", response_model=FlooringEstimateResponse)
def clone_estimate(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    _require_estimate(session, current_user, estimate_id)
    return _found(FlooringEstimateService(session).clone_estimate(estimate_id, created_by_id=current_user.id))


@router.get("/{estimate_id}/export/pdf")
def export_pdf(
    estimate_id: str,
    show_signature: bool = Query(True),
    layout: str = Query("rooms", pattern="^(rooms|trades|proposal)$"),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """The estimate as a PDF, laid out as room cards, by trade or as a
    proposal (export_service.LAYOUTS), then the plan of every level. It
    prints what was last calculated."""
    _require_estimate(session, current_user, estimate_id)
    from .export_service import FlooringExportService

    estimate = _found(FlooringEstimateService(session).get_estimate(estimate_id))
    if not estimate.get("line_items"):
        raise HTTPException(status_code=400, detail="Calculate the estimate first: it has no lines to print yet.")
    pdf = FlooringExportService().generate_pdf(estimate, show_signature=show_signature, layout=layout)
    street = re.sub(r"[^A-Za-z0-9]+", "_", estimate.get("property_address") or "").strip("_")[:40]
    name = f"flooring_estimate_{street or estimate_id[:8]}.pdf"
    return Response(
        content=pdf.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.get("/{estimate_id}/history", response_model=list[HistoryResponse])
def get_history(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    _require_estimate(session, current_user, estimate_id)
    return FlooringEstimateService(session).get_history(estimate_id)
