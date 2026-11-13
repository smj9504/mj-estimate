"""
Rebuild Estimate API: one estimate for a claim's rebuild, the flooring,
bathroom and kitchen cabinet estimates imported into it and the other
repairs added on, room by room.
"""

import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.core.database_factory import get_db_session
from app.core.interfaces import DatabaseSession
from app.domains.auth.company_scope import (
    document_condition, require_claim, require_document, sees_everything,
)
from app.domains.auth.dependencies import get_current_user

from .models import RebuildEstimate
from .assemblies import assemblies
from .schemas import ImportRequest, RebuildEstimateCreate, RebuildEstimateUpdate, SourceRoomRequest, WordingRequest
from .service import RebuildEstimateService
from .sources import model_of
from .wording import save_wording, saved_wordings
from .xactimate_search import search as xactimate_search

router = APIRouter(prefix="/rebuild-estimates", tags=["Rebuild Estimates"])


def _require(session, staff, estimate_id: str) -> None:
    require_document(session, staff, RebuildEstimate, estimate_id, "Estimate")


def _found(result):
    if result is None:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return result


def _company_of(session, estimate_id: Optional[str]) -> Optional[str]:
    if not estimate_id:
        return None
    company = session.query(RebuildEstimate.company_id).filter(RebuildEstimate.id == estimate_id).scalar()
    return str(company) if company else None


def _require_claim_move(session, staff, estimate_id: Optional[str], claim_id: Optional[str]) -> None:
    if not claim_id or sees_everything(staff):
        return
    if estimate_id:
        current = session.query(RebuildEstimate.claim_id).filter(RebuildEstimate.id == estimate_id).scalar()
        if str(current or "") == str(claim_id):
            return
    require_claim(session, staff, claim_id)


@router.get("/xactimate-search")
def search_xactimate(
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(25, ge=1, le=100),
    estimate_id: Optional[str] = Query(None, description="Word them as this estimate's company does"),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Repairs from the latest Xactimate price list, each with the
    activities it can be added as, their prices and our words for them"""
    if estimate_id:
        _require(session, current_user, estimate_id)
    return xactimate_search(session, q, limit, saved_wordings(session, _company_of(session, estimate_id)))


@router.get("")
def list_estimates(
    claim_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    items, total = RebuildEstimateService(session).list(
        claim_id=claim_id, search=search, page=page, page_size=page_size,
        scope=document_condition(session, current_user, RebuildEstimate.claim_id, RebuildEstimate.company_id),
    )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.post("")
def create_estimate(
    data: RebuildEstimateCreate,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    _require_claim_move(session, current_user, None, data.claim_id)
    return RebuildEstimateService(session).create(data, created_by_id=current_user.id)


@router.get("/{estimate_id}")
def get_estimate(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    _require(session, current_user, estimate_id)
    return _found(RebuildEstimateService(session).get(estimate_id))


@router.put("/{estimate_id}")
def update_estimate(
    estimate_id: str,
    data: RebuildEstimateUpdate,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    _require(session, current_user, estimate_id)
    _require_claim_move(session, current_user, estimate_id, data.claim_id)
    return _found(RebuildEstimateService(session).update(estimate_id, data))


@router.delete("/{estimate_id}")
def delete_estimate(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    _require(session, current_user, estimate_id)
    if not RebuildEstimateService(session).delete(estimate_id):
        raise HTTPException(status_code=404, detail="Estimate not found")
    return {"message": "Estimate deleted"}


@router.get("/{estimate_id}/assemblies")
def list_assemblies(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """The sets of repairs a room can take at once (new drywall primed and
    painted, insulation, repainting...), worded as the company words them"""
    _require(session, current_user, estimate_id)
    return assemblies(session, saved_wordings(session, _company_of(session, estimate_id)))


@router.put("/{estimate_id}/wordings")
def put_wording(
    estimate_id: str,
    data: WordingRequest,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Keep these words for a price list line: every estimate of the
    estimate's company (everyone's, when it has none) words it so from now on"""
    _require(session, current_user, estimate_id)
    save_wording(session, _company_of(session, estimate_id), data.code, data.activity, data.text,
                 getattr(current_user, "id", None))
    return {"code": data.code, "activity": data.activity, "text": data.text}


@router.get("/{estimate_id}/importable")
def list_importable(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """The flooring, bathroom and kitchen cabinet estimates on its claim (or at its address)"""
    _require(session, current_user, estimate_id)
    return RebuildEstimateService(session).importable(estimate_id, current_user)


@router.post("/{estimate_id}/sources")
def import_estimate(
    estimate_id: str,
    data: ImportRequest,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Bring every line of a calculated trade estimate in, each room onto a room here"""
    _require(session, current_user, estimate_id)
    require_document(session, current_user, model_of(data.kind), data.estimate_id, "Estimate")
    return _found(RebuildEstimateService(session).import_source(estimate_id, data))


def _require_source(session, staff, estimate_id: str, source_id: str) -> None:
    est = session.query(RebuildEstimate).filter(RebuildEstimate.id == estimate_id).first()
    src = next((s for s in (est.sources or []) if s.get("id") == source_id), None) if est else None
    if src is not None:
        require_document(session, staff, model_of(src["kind"]), src["estimate_id"], "Estimate")


@router.post("/{estimate_id}/sources/{source_id}/refresh")
def refresh_estimate(
    estimate_id: str,
    source_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Take an imported estimate's lines again, as it is now"""
    _require(session, current_user, estimate_id)
    _require_source(session, current_user, estimate_id, source_id)
    return _found(RebuildEstimateService(session).refresh_source(estimate_id, source_id))


@router.put("/{estimate_id}/sources/{source_id}/room")
def move_estimate(
    estimate_id: str,
    source_id: str,
    data: SourceRoomRequest,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    _require(session, current_user, estimate_id)
    return _found(RebuildEstimateService(session).move_source(estimate_id, source_id, data))


@router.delete("/{estimate_id}/sources/{source_id}")
def remove_estimate(
    estimate_id: str,
    source_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    _require(session, current_user, estimate_id)
    return _found(RebuildEstimateService(session).remove_source(estimate_id, source_id))


@router.get("/{estimate_id}/export/pdf")
def export_pdf(
    estimate_id: str,
    show_signature: bool = Query(True),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    _require(session, current_user, estimate_id)
    from .export_service import RebuildExportService

    estimate = _found(RebuildEstimateService(session).get(estimate_id))
    if not estimate["assembled"]["rooms"]:
        raise HTTPException(status_code=400, detail="Nothing to print yet: import an estimate or add a repair.")
    pdf = RebuildExportService().generate_pdf(estimate, show_signature=show_signature)
    street = re.sub(r"[^A-Za-z0-9]+", "_", estimate.get("property_address") or "").strip("_")[:40]
    name = f"rebuild_estimate_{street or estimate_id[:8]}.pdf"
    return Response(content=pdf.getvalue(), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})
