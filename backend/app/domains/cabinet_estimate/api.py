"""
Cabinet Estimate API endpoints
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.core.database_factory import get_db_session
from app.core.interfaces import DatabaseSession
from app.domains.auth.dependencies import get_current_user

from .pricing import (
    BACKSPLASH_TYPES,
    BASE_RATES,
    CROWN_MOLDING_PRICING,
    DOOR_STYLES,
    FINISH_MULTIPLIER,
    GLASS_DOOR_PREMIUM,
    ISLAND_PANEL_PRICING,
    LAYOUT_TYPES,
    MATERIAL_MULTIPLIER,
    PREFAB_ISLAND_INSTALL,
    PREFAB_ISLAND_PRICING,
    SCOPE_ITEMS,
    SPECIALTY_PREMIUM,
    TALL_CABINET_TYPES,
)
from .schemas import (
    CabinetEstimateCreate,
    CabinetEstimateListResponse,
    CabinetEstimateResponse,
    CabinetEstimateUpdate,
    CabinetTier,
    BoxMaterial,
    CabType,
    EstimateStatus,
    FinishType,
    HistoryResponse,
    PricingInfoResponse,
    PurchaseOrderResponse,
)
from .service import CabinetEstimateService

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
        "layout_types": LAYOUT_TYPES,
        "cab_types": CabType.choices(),
        "specialty_types": list(SPECIALTY_PREMIUM.keys()),
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
    }


# ── CRUD ──

@router.post("", response_model=CabinetEstimateResponse)
def create_estimate(
    data: CabinetEstimateCreate,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Create a new cabinet estimate."""
    service = CabinetEstimateService(session)
    result = service.create_estimate(data, created_by_id=current_user.id)
    return result


@router.get("", response_model=CabinetEstimateListResponse)
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
    """List cabinet estimates with filtering."""
    service = CabinetEstimateService(session)
    items, total = service.list_estimates(
        claim_id=claim_id,
        company_id=company_id,
        status=status,
        search=search,
        page=page,
        page_size=page_size,
    )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/{estimate_id}", response_model=CabinetEstimateResponse)
def get_estimate(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Get a cabinet estimate by ID."""
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
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Delete a cabinet estimate."""
    service = CabinetEstimateService(session)
    if not service.delete_estimate(estimate_id):
        raise HTTPException(status_code=404, detail="Estimate not found")
    return {"message": "Estimate deleted"}


# ── Calculation ──

@router.post("/{estimate_id}/calculate", response_model=CabinetEstimateResponse)
def calculate_estimate(
    estimate_id: str,
    data: Optional[CabinetEstimateUpdate] = None,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Save (if body provided) then calculate in one round-trip."""
    service = CabinetEstimateService(session)
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

@router.post("/{estimate_id}/clone", response_model=CabinetEstimateResponse)
def clone_estimate(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Clone an existing estimate into a new draft."""
    service = CabinetEstimateService(session)
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
    service = CabinetEstimateService(session)
    result = service.get_purchase_order(estimate_id)
    if not result:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return result


# ── Export (PDF / Excel) ──

@router.get("/{estimate_id}/export/pdf")
def export_pdf(
    estimate_id: str,
    show_signature: bool = Query(True),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Export estimate as PDF for insurance/customer."""
    from .export_service import CabinetExportService

    service = CabinetEstimateService(session)
    estimate = service.get_estimate(estimate_id)
    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    export_svc = CabinetExportService()
    pdf_bytes = export_svc.generate_pdf(
        estimate, show_signature=show_signature,
    )

    import re
    addr = estimate.get("property_address") or ""
    addr_slug = re.sub(r'[^a-zA-Z0-9]+', '_', addr).strip('_')[:60]
    filename = f"cabinet_estimate_{addr_slug}.pdf" if addr_slug else f"cabinet_estimate_{estimate_id[:8]}.pdf"

    return StreamingResponse(
        pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )


@router.get("/{estimate_id}/export/excel")
def export_excel(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Export purchase order as Excel for supplier."""
    from .export_service import CabinetExportService

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
