"""
Bathroom Estimate API endpoints
"""

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.core.database_factory import get_db_session
from app.core.interfaces import DatabaseSession
from app.domains.auth.dependencies import get_current_user

from .pricing import (
    ACCESSORY_FINISHES,
    ACCESSORY_GRADES,
    BASEBOARD_MATERIALS,
    BATHROOM_DESIGNATIONS,
    BATHROOM_FUNCTIONS,
    BATHTUB_MATERIALS,
    BATHTUB_TYPES,
    BUILDING_TYPES,
    ENCLOSURE_TYPES,
    SHOWER_DOOR_TYPES,
    TILE_SIZES,
    EXHAUST_FAN_CFMS,
    EXHAUST_FAN_SWITCH_TYPES,
    FAUCET_TYPES,
    MIRROR_TYPES,
    PAINT_GRADES,
    SHOWER_TYPES,
    SHOWERHEAD_TYPES,
    TILE_MATERIALS,
    TILE_PATTERNS,
    TOILET_TYPES,
    TRIM_GRADES,
    VANITY_MOUNTINGS,
    VANITY_SOURCES,
    VANITY_TOP_MATERIALS,
    VANITY_WIDTHS,
    WATERPROOF_TYPES,
)
from .schemas import (
    BathroomEstimateCreate,
    BathroomEstimateListResponse,
    BathroomEstimateResponse,
    BathroomEstimateUpdate,
    HistoryResponse,
    PricingInfoResponse,
)
from .service import BathroomEstimateService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/bathroom-estimates", tags=["Bathroom Estimates"])


# ── Pricing info (for frontend dropdowns) ──

@router.get("/pricing-info", response_model=PricingInfoResponse)
def get_pricing_info():
    """Get available options and pricing constants for the estimate form."""
    return {
        "building_types": BUILDING_TYPES,
        "designations": BATHROOM_DESIGNATIONS,
        "bath_functions": BATHROOM_FUNCTIONS,
        "shower_types": SHOWER_TYPES,
        "enclosure_types": ENCLOSURE_TYPES,
        "shower_door_types": SHOWER_DOOR_TYPES,
        "showerhead_types": SHOWERHEAD_TYPES,
        "trim_grades": TRIM_GRADES,
        "bathtub_types": BATHTUB_TYPES,
        "bathtub_materials": BATHTUB_MATERIALS,
        "vanity_widths": VANITY_WIDTHS,
        "vanity_sources": VANITY_SOURCES,
        "vanity_top_materials": VANITY_TOP_MATERIALS,
        "vanity_mountings": VANITY_MOUNTINGS,
        "faucet_types": FAUCET_TYPES,
        "mirror_types": MIRROR_TYPES,
        "toilet_types": TOILET_TYPES,
        "tile_materials": TILE_MATERIALS,
        "tile_patterns": TILE_PATTERNS,
        "tile_sizes": TILE_SIZES,
        "waterproof_types": WATERPROOF_TYPES,
        "accessory_finishes": ACCESSORY_FINISHES,
        "accessory_grades": ACCESSORY_GRADES,
        "exhaust_fan_cfms": EXHAUST_FAN_CFMS,
        "exhaust_fan_switch_types": EXHAUST_FAN_SWITCH_TYPES,
        "paint_grades": PAINT_GRADES,
        "baseboard_materials": BASEBOARD_MATERIALS,
    }


# ── CRUD ──

@router.post("", response_model=BathroomEstimateResponse)
def create_estimate(
    data: BathroomEstimateCreate,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Create a new bathroom estimate."""
    service = BathroomEstimateService(session)
    result = service.create_estimate(data, created_by_id=current_user.id)
    return result


@router.get("", response_model=BathroomEstimateListResponse)
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
    """List bathroom estimates with filtering."""
    service = BathroomEstimateService(session)
    items, total = service.list_estimates(
        claim_id=claim_id,
        company_id=company_id,
        status=status,
        search=search,
        page=page,
        page_size=page_size,
    )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/{estimate_id}", response_model=BathroomEstimateResponse)
def get_estimate(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Get a bathroom estimate by ID."""
    service = BathroomEstimateService(session)
    result = service.get_estimate(estimate_id)
    if not result:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return result


@router.put("/{estimate_id}", response_model=BathroomEstimateResponse)
def update_estimate(
    estimate_id: str,
    data: BathroomEstimateUpdate,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Update a bathroom estimate."""
    service = BathroomEstimateService(session)
    result = service.update_estimate(
        estimate_id, data, updated_by_id=current_user.id
    )
    if not result:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return result


@router.delete("/{estimate_id}")
def delete_estimate(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Delete a bathroom estimate."""
    service = BathroomEstimateService(session)
    if not service.delete_estimate(estimate_id):
        raise HTTPException(status_code=404, detail="Estimate not found")
    return {"message": "Estimate deleted"}


# ── Calculation ──

@router.post("/{estimate_id}/calculate", response_model=BathroomEstimateResponse)
def calculate_estimate(
    estimate_id: str,
    data: Optional[BathroomEstimateUpdate] = None,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Save (if body provided) then calculate in one round-trip."""
    service = BathroomEstimateService(session)
    if data is not None:
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

@router.post("/{estimate_id}/clone", response_model=BathroomEstimateResponse)
def clone_estimate(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Clone an existing estimate into a new draft."""
    service = BathroomEstimateService(session)
    result = service.clone_estimate(estimate_id, created_by_id=current_user.id)
    if not result:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return result


# ── History ──

@router.get("/{estimate_id}/history", response_model=list[HistoryResponse])
def get_history(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Get version history for an estimate."""
    service = BathroomEstimateService(session)
    return service.get_history(estimate_id)


# ── Overview Note Generation ──

@router.post("/{estimate_id}/generate-overview")
def generate_overview(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Generate AI-powered overview note based on estimate specs."""
    service = BathroomEstimateService(session)
    overview = service.generate_overview(estimate_id)
    if overview is None:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return {"overview_text": overview}


# ── Export Validation ──

def _validate_allowances(estimate: Dict[str, Any]) -> list:
    """Check for missing brand/model or allowance specs.

    Returns list of warning strings for items that should have
    material allowance or brand/model specified before export.
    """
    warnings = []

    # Tile — check if material specified
    floor_spec = estimate.get("floor_spec") or {}
    if estimate.get("replace_floor") and not floor_spec.get("material"):
        warnings.append(
            "Floor tile: material not specified. "
            "Add tile material and $/SF allowance."
        )

    # Vanity — check for brand/model or source
    vanity_spec = estimate.get("vanity_spec") or {}
    if estimate.get("replace_vanity"):
        items = vanity_spec.get("items") or [vanity_spec]
        for i, v in enumerate(items):
            if not v:
                continue
            if not v.get("brand") and not v.get("model"):
                label = f" #{i+1}" if len(items) > 1 else ""
                warnings.append(
                    f"Vanity{label}: no brand/model specified. "
                    f"Specify brand or confirm allowance."
                )
            if not v.get("faucet_brand") and not v.get("faucet_model"):
                label = f" #{i+1}" if len(items) > 1 else ""
                warnings.append(
                    f"Faucet{label}: no brand/model specified."
                )

    # Toilet
    toilet_spec = estimate.get("toilet_spec") or {}
    if (estimate.get("replace_toilet")
            and not toilet_spec.get("brand")
            and not toilet_spec.get("model")):
        warnings.append(
            "Toilet: no brand/model specified. "
            "Specify model or confirm allowance."
        )

    # Shower fixtures
    shower_spec = estimate.get("shower_spec") or {}
    if (estimate.get("replace_shower")
            and not shower_spec.get("fixture_brand")
            and not shower_spec.get("fixture_model")):
        warnings.append(
            "Shower fixture: no brand/model specified."
        )

    return warnings


@router.get("/{estimate_id}/export/validate")
def validate_for_export(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Validate estimate before PDF export.

    Returns warnings for missing allowance/brand/model specs.
    """
    service = BathroomEstimateService(session)
    estimate = service.get_estimate(estimate_id)
    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    warnings = _validate_allowances(estimate)
    return {
        "valid": len(warnings) == 0,
        "warnings": warnings,
    }


# ── Export (PDF) ──

@router.get("/{estimate_id}/export/pdf")
def export_pdf(
    estimate_id: str,
    show_signature: bool = Query(True),
    show_breakdown_prices: bool = Query(True),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Export estimate as PDF for customer (no sketch image)."""
    from .export_service import BathroomExportService

    service = BathroomEstimateService(session)
    estimate = service.get_estimate(estimate_id)
    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    export_svc = BathroomExportService()
    pdf_bytes = export_svc.generate_pdf(
        estimate, show_signature=show_signature,
        show_breakdown_prices=show_breakdown_prices,
    )

    return StreamingResponse(
        pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="bathroom_estimate_{estimate_id[:8]}.pdf"'
        },
    )


@router.post("/{estimate_id}/export/pdf")
def export_pdf_with_sketch(
    estimate_id: str,
    body: Dict[str, Any] = Body(default={}),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Export estimate as PDF with optional sketch image."""
    from .export_service import BathroomExportService

    service = BathroomEstimateService(session)
    estimate = service.get_estimate(estimate_id)
    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    sketch_image = body.get("sketch_image")
    show_signature = body.get("show_signature", True)
    show_breakdown_prices = body.get("show_breakdown_prices", True)

    export_svc = BathroomExportService()
    pdf_bytes = export_svc.generate_pdf(
        estimate,
        show_signature=show_signature,
        sketch_image_base64=sketch_image,
        show_breakdown_prices=show_breakdown_prices,
    )

    return StreamingResponse(
        pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="bathroom_estimate_{estimate_id[:8]}.pdf"'
        },
    )
