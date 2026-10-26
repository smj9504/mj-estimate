"""
Cabinet Estimate API endpoints
"""

import logging
from typing import Any, Dict, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.core.database_factory import get_db, get_db_session
from app.core.interfaces import DatabaseSession
from app.domains.auth.company_scope import (
    document_condition,
    require_claim,
    require_document,
    sees_everything,
)
from app.domains.auth.dependencies import get_current_user
from sqlalchemy.orm import Session

from .models import CabinetEstimate
from .pricing import (
    APPLIANCE_RR_PRICING,
    BACKSPLASH_TYPES,
    BASE_RATES,
    COUNTERTOP_BACKSPLASH_PER_LF,
    COUNTERTOP_MATERIALS,
    COUNTERTOP_SUPPORT_RULE,
    CROWN_MOLDING_PRICING,
    DOOR_STYLES,
    END_PANEL_TYPES,
    FINISH_MULTIPLIER,
    GLASS_DOOR_PREMIUM,
    ISLAND_PANEL_PRICING,
    LAYOUT_TYPES,
    MATERIAL_MULTIPLIER,
    OVERLAY_STYLES,
    PREFAB_ISLAND_INSTALL,
    PREFAB_ISLAND_PRICING,
    SCOPE_ITEMS,
    SPECIALTY_PREMIUM,
    TALL_CABINET_TYPES,
)
from .rate_meta import Basis
from .schemas import (
    CabinetEstimateCreate,
    CabinetEstimateGroupResponse,
    CabinetEstimateListResponse,
    CabinetEstimateResponse,
    CabinetEstimateUpdate,
    CabinetTier,
    BoxMaterial,
    CabType,
    EstimateStatus,
    FinishType,
    HistoryResponse,
    OptionLabelUpdate,
    PricingInfoResponse,
    ProjectTypeUpdate,
    PurchaseOrderResponse,
    SelectionUpdate,
)
from .selections import SLOTS
from .service import CabinetEstimateService
from .sketch_schemas import (
    CabinetSketchAiPhotoRequest,
    CabinetSketchAiPhotoResponse,
    CabinetSketchOverlayData,
    CabinetSketchResponse,
    CabinetSketchUpdate,
)
from .sketch_ai_photo import AiPhotoError, make_photo
from .sketch_service import CabinetSketchService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/cabinet-estimates", tags=["Cabinet Estimates"])


# ── Pricing info (for frontend dropdowns) ──

@router.get("/pricing-info", response_model=PricingInfoResponse)
def get_pricing_info():
    """Get available options and pricing constants for the estimate form."""
    return {
        "tiers": CabinetTier.choices(),
        "materials": BoxMaterial.choices(),
        "finishes": FinishType.choices(),
        "door_styles": DOOR_STYLES,
        "overlay_styles": OVERLAY_STYLES,
        "pricing_bases": [
            {
                "key": Basis.INSURANCE_DR.value,
                "label": "Insurance claim",
                "description": (
                    "Xactimate detach & reset. Crew time only — no "
                    "per-appliance trip charge."
                ),
            },
            {
                "key": Basis.RETAIL_INSTALL.value,
                "label": "Retail remodel",
                "description": (
                    "Installer pricing. Carries a trip minimum on each "
                    "appliance."
                ),
            },
        ],
        "layout_types": LAYOUT_TYPES,
        "cab_types": CabType.choices(),
        "specialty_types": list(SPECIALTY_PREMIUM.keys()),
        "end_panel_types": END_PANEL_TYPES,
        "scope_items": SCOPE_ITEMS,
        "backsplash_types": [
            {"key": k, "label": v["label"], "material_per_sf": v["material_per_sf"], "install_per_sf": v["install_per_sf"]}
            for k, v in BACKSPLASH_TYPES.items()
        ],
        "glass_door_premiums": GLASS_DOOR_PREMIUM,
        "crown_molding_pricing": CROWN_MOLDING_PRICING,
        "island_panel_pricing": ISLAND_PANEL_PRICING,
        "prefab_island_pricing": PREFAB_ISLAND_PRICING,
        "prefab_island_install": PREFAB_ISLAND_INSTALL,
        "tall_cabinet_types": TALL_CABINET_TYPES,
        "appliance_rr_pricing": APPLIANCE_RR_PRICING,
        "countertop_materials": COUNTERTOP_MATERIALS,
        "countertop_backsplash_per_lf": COUNTERTOP_BACKSPLASH_PER_LF,
        "countertop_support_rule": COUNTERTOP_SUPPORT_RULE,
        "selection_slots": SLOTS,
    }


# ── Company scope ──

def _require_estimate(session, staff, estimate_id: str) -> None:
    """404 unless the staff member may see this estimate (its job's
    estimates share one claim and company, so this covers the group)."""
    require_document(session, staff, CabinetEstimate, estimate_id, "Estimate")


def _require_moved_claim(session, staff, estimate_id: str, claim_id: Optional[str]) -> None:
    """Moving an estimate onto another claim needs that claim to be visible"""
    if not claim_id or sees_everything(staff):
        return
    current = session.query(CabinetEstimate.claim_id).filter(
        CabinetEstimate.id == estimate_id
    ).scalar()
    if str(current or "") != str(claim_id):
        require_claim(session, staff, claim_id)


# ── CRUD ──

@router.post("", response_model=CabinetEstimateResponse)
def create_estimate(
    data: CabinetEstimateCreate,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Create a new cabinet estimate."""
    if data.claim_id:
        require_claim(session, current_user, data.claim_id)
    service = CabinetEstimateService(session)
    result = service.create_estimate(data, created_by_id=current_user.id)
    return result


@router.get("", response_model=CabinetEstimateListResponse)
def list_estimates(
    claim_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    kind: Optional[Literal["restore", "option"]] = Query(None),
    grouped: bool = Query(False, description="One row per kitchen job"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """List cabinet estimates with filtering."""
    service = CabinetEstimateService(session)
    items, total = service.list_estimates(
        claim_id=claim_id,
        company_id=company_id,
        status=status,
        search=search,
        kind=kind,
        grouped=grouped,
        page=page,
        page_size=page_size,
        scope=document_condition(
            session, current_user, CabinetEstimate.claim_id, CabinetEstimate.company_id
        ),
    )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/{estimate_id}", response_model=CabinetEstimateResponse)
def get_estimate(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Get a cabinet estimate by ID."""
    _require_estimate(session, current_user, estimate_id)
    service = CabinetEstimateService(session)
    result = service.get_estimate(estimate_id)
    if not result:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return result


@router.put("/{estimate_id}", response_model=CabinetEstimateResponse)
def update_estimate(
    estimate_id: str,
    data: CabinetEstimateUpdate,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Update a cabinet estimate."""
    _require_estimate(session, current_user, estimate_id)
    _require_moved_claim(session, current_user, estimate_id, data.claim_id)
    service = CabinetEstimateService(session)
    result = service.update_estimate(
        estimate_id, data, updated_by_id=current_user.id
    )
    if not result:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return result


@router.delete("/{estimate_id}")
def delete_estimate(
    estimate_id: str,
    whole_group: bool = Query(False, description="Delete every estimate of the job"),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Delete a cabinet estimate."""
    _require_estimate(session, current_user, estimate_id)
    service = CabinetEstimateService(session)
    try:
        deleted = service.delete_estimate(estimate_id, whole_group=whole_group)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if not deleted:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return {"message": "Estimate deleted"}


# ── Estimate group (restoration + options) ──

@router.get("/{estimate_id}/group", response_model=CabinetEstimateGroupResponse)
def get_estimate_group(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Every estimate of this one's job, with line items, for comparing them."""
    _require_estimate(session, current_user, estimate_id)
    service = CabinetEstimateService(session)
    result = service.get_group(estimate_id)
    if not result:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return result


@router.post("/{estimate_id}/options", response_model=CabinetEstimateResponse)
def add_option(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Add an option to the job, starting as a copy of this estimate."""
    _require_estimate(session, current_user, estimate_id)
    service = CabinetEstimateService(session)
    result = service.add_option(estimate_id, created_by_id=current_user.id)
    if not result:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return result


@router.put("/{estimate_id}/option-label", response_model=CabinetEstimateResponse)
def rename_option(
    estimate_id: str,
    data: OptionLabelUpdate,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Rename an option."""
    _require_estimate(session, current_user, estimate_id)
    service = CabinetEstimateService(session)
    try:
        result = service.rename_option(estimate_id, data.option_label)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not result:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return result


@router.put("/{estimate_id}/project-type", response_model=CabinetEstimateResponse)
def set_project_type(
    estimate_id: str,
    data: ProjectTypeUpdate,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Switch the whole job between an insurance claim and a remodel."""
    _require_estimate(session, current_user, estimate_id)
    service = CabinetEstimateService(session)
    result = service.set_project_type(estimate_id, data.project_type)
    if not result:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return result


# ── Products (an option's selections from the product library) ──

def _set_selection(service, estimate_id, slot, product_id, user_id):
    try:
        result = service.set_selection(estimate_id, slot, product_id, changed_by_id=user_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not result:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return result


@router.put("/{estimate_id}/selections/{slot}", response_model=CabinetEstimateResponse)
def set_selection(
    estimate_id: str,
    slot: str,
    data: SelectionUpdate,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Put a library product in an option's slot (a copy of it as it is now)."""
    _require_estimate(session, current_user, estimate_id)
    service = CabinetEstimateService(session)
    return _set_selection(service, estimate_id, slot, str(data.product_id), current_user.id)


@router.delete("/{estimate_id}/selections/{slot}", response_model=CabinetEstimateResponse)
def clear_selection(
    estimate_id: str,
    slot: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Empty an option's slot: that part goes back to the rate-table price."""
    _require_estimate(session, current_user, estimate_id)
    service = CabinetEstimateService(session)
    return _set_selection(service, estimate_id, slot, None, current_user.id)


# ── Calculation ──

@router.post("/{estimate_id}/calculate", response_model=CabinetEstimateResponse)
def calculate_estimate(
    estimate_id: str,
    data: Optional[CabinetEstimateUpdate] = None,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Save (if body provided) then calculate in one round-trip."""
    _require_estimate(session, current_user, estimate_id)
    service = CabinetEstimateService(session)
    if data is not None:
        _require_moved_claim(session, current_user, estimate_id, data.claim_id)
        service.update_estimate(
            estimate_id, data,
            updated_by_id=current_user.id,
            skip_full_read=True,
        )
    try:
        result = service.calculate(
            estimate_id, changed_by_id=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not result:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return result


# ── Clone ──

@router.post("/{estimate_id}/clone", response_model=CabinetEstimateResponse)
def clone_estimate(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Clone an existing estimate into a new draft."""
    _require_estimate(session, current_user, estimate_id)
    service = CabinetEstimateService(session)
    result = service.clone_estimate(estimate_id, created_by_id=current_user.id)
    if not result:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return result


# ── Sketch ──

def _ensure_estimate_exists(estimate_id: str, session: DatabaseSession, staff) -> None:
    """Reuse the existing estimate lookup so sketch endpoints 404 on a
    bogus/deleted estimate_id instead of silently creating an orphan
    CabinetSketch row for it."""
    _require_estimate(session, staff, estimate_id)
    service = CabinetEstimateService(session)
    if not service.get_estimate(estimate_id):
        raise HTTPException(status_code=404, detail="Estimate not found")


@router.get("/{estimate_id}/sketch", response_model=CabinetSketchResponse)
def get_sketch(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get (or lazily create) the layout sketch for an estimate."""
    _ensure_estimate_exists(estimate_id, session, current_user)
    return CabinetSketchService(db).get_or_create(UUID(estimate_id))


@router.put("/{estimate_id}/sketch", response_model=CabinetSketchResponse)
def update_sketch_meta(
    estimate_id: str,
    data: CabinetSketchUpdate,
    session: DatabaseSession = Depends(get_db_session),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Update sketch canvas metadata (size/scale) only."""
    _ensure_estimate_exists(estimate_id, session, current_user)
    return CabinetSketchService(db).update_meta(UUID(estimate_id), data)


@router.put("/{estimate_id}/sketch/overlay", response_model=CabinetSketchResponse)
def save_sketch_overlay(
    estimate_id: str,
    payload: CabinetSketchOverlayData,
    session: DatabaseSession = Depends(get_db_session),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Replace the sketch's overlay data (walls + cabinets) wholesale.

    Full replace, not a diff — mirrors the water mitigation sketch's
    saveOverlayData semantics.
    """
    _ensure_estimate_exists(estimate_id, session, current_user)
    return CabinetSketchService(db).save_overlay(UUID(estimate_id), payload)


@router.post("/{estimate_id}/sketch/ai-photo", response_model=CabinetSketchAiPhotoResponse)
def make_sketch_ai_photo(
    estimate_id: str,
    payload: CabinetSketchAiPhotoRequest,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Redraw the 3D view's realistic render as a photo of the finished kitchen.

    A concept picture from a Gemini image model (sketch_ai_photo.py): it is
    not stored, and may differ from the sketch in small ways.
    """
    _ensure_estimate_exists(estimate_id, session, current_user)
    try:
        image, model = make_photo(payload.image, payload.finish, payload.notes)
    except AiPhotoError as e:
        raise HTTPException(status_code=e.status, detail=str(e))
    logger.info("Cabinet AI photo for estimate %s by %s (%s)", estimate_id, current_user.id, model)
    return CabinetSketchAiPhotoResponse(image=image, model=model)


# ── History ──

@router.get("/{estimate_id}/history", response_model=list[HistoryResponse])
def get_history(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Get version history for an estimate."""
    _require_estimate(session, current_user, estimate_id)
    service = CabinetEstimateService(session)
    return service.get_history(estimate_id)


# ── Purchase Order ──

@router.get("/{estimate_id}/purchase-order", response_model=PurchaseOrderResponse)
def get_purchase_order(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Get grouped purchase order data for supplier."""
    _require_estimate(session, current_user, estimate_id)
    service = CabinetEstimateService(session)
    result = service.get_purchase_order(estimate_id)
    if not result:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return result


# ── Export (PDF / Excel) ──

def _image_loader(session):
    """Product pictures for a PDF, read from file storage."""
    from app.domains.product_library.service import image_bytes
    return lambda file_id: image_bytes(session, file_id)


def _estimate_pdf(estimate_id: str, show_signature: bool, render: Optional[str], session):
    from .export_service import CabinetExportService

    service = CabinetEstimateService(session)
    estimate = service.get_estimate(estimate_id)
    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    pdf_bytes = CabinetExportService().generate_pdf(
        estimate, show_signature=show_signature,
        image_loader=_image_loader(session), render=render,
    )

    import re
    addr = estimate.get("property_address") or ""
    addr_slug = re.sub(r'[^a-zA-Z0-9]+', '_', addr).strip('_')[:60]
    option = ""
    if estimate.get("kind") == "option":
        option = "_" + re.sub(r'[^a-zA-Z0-9]+', '_', estimate.get("option_label") or "option").strip('_')
    filename = (
        f"cabinet_estimate_{addr_slug}{option}.pdf" if addr_slug
        else f"cabinet_estimate_{estimate_id[:8]}{option}.pdf"
    )

    return StreamingResponse(
        pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )


@router.get("/{estimate_id}/export/pdf")
def export_pdf(
    estimate_id: str,
    show_signature: bool = Query(True),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Export estimate as PDF for insurance/customer."""
    _require_estimate(session, current_user, estimate_id)
    return _estimate_pdf(estimate_id, show_signature, None, session)


@router.post("/{estimate_id}/export/pdf")
def export_pdf_with_render(
    estimate_id: str,
    body: Dict[str, Any] = Body(...),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """An option's PDF with its 3D view ({render: base64, show_signature}).

    The restoration's PDF ignores a render: it goes to the carrier as it is.
    """
    _require_estimate(session, current_user, estimate_id)
    return _estimate_pdf(estimate_id, body.get("show_signature", True), body.get("render"), session)


def _proposal_pdf(estimate_id: str, show_signature: bool, renders: Optional[Dict[str, str]], session):
    from .export_service import CabinetExportService

    service = CabinetEstimateService(session)
    group = service.get_group(estimate_id)
    if not group:
        raise HTTPException(status_code=404, detail="Estimate not found")
    try:
        pdf_bytes = CabinetExportService().generate_proposal_pdf(
            group, show_signature=show_signature, renders=renders,
            image_loader=_image_loader(session),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return StreamingResponse(
        pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="kitchen_options_{estimate_id[:8]}.pdf"'
        },
    )


@router.get("/{estimate_id}/export/proposal-pdf")
def export_proposal_pdf(
    estimate_id: str,
    show_signature: bool = Query(True),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """The customer's comparison of every estimate of this one's job.

    For the customer only: the carrier gets the restoration's own PDF.
    """
    _require_estimate(session, current_user, estimate_id)
    return _proposal_pdf(estimate_id, show_signature, None, session)


@router.post("/{estimate_id}/export/proposal-pdf")
def export_proposal_pdf_with_renders(
    estimate_id: str,
    body: Dict[str, Any] = Body(...),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """The customer's comparison, with each estimate's 3D view ({renders: {id: base64}})."""
    _require_estimate(session, current_user, estimate_id)
    return _proposal_pdf(estimate_id, body.get("show_signature", True), body.get("renders"), session)


@router.get("/{estimate_id}/export/excel")
def export_excel(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Export purchase order as Excel for supplier."""
    from .export_service import CabinetExportService

    _require_estimate(session, current_user, estimate_id)
    service = CabinetEstimateService(session)
    result = service.get_purchase_order(estimate_id)
    if not result:
        raise HTTPException(status_code=404, detail="Estimate not found")

    estimate = service.get_estimate(estimate_id)
    export_svc = CabinetExportService()
    excel_bytes = export_svc.generate_excel(estimate, result)

    return StreamingResponse(
        excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="cabinet_purchase_order_{estimate_id[:8]}.xlsx"'
        },
    )
