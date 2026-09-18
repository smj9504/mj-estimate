"""
Roofing Estimate API endpoints
"""

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from app.core.database_factory import get_db_session
from app.core.interfaces import DatabaseSession
from app.domains.auth.dependencies import get_current_user

from .formula import FUNCTION_NAMES
from .formula import validate as validate_formula
from .material_basis import (
    basis_options,
    formula_variable_docs,
    formula_variables,
)
from .pricing import (
    BUILDING_TYPES,
    DECKING_MATERIALS,
    DECKING_RATES,
    DOWNSPOUT_SIZES,
    EXISTING_MATERIALS,
    GUTTER_GUARD_TYPES,
    GUTTER_MATERIALS,
    GUTTER_SCOPES,
    GUTTER_SIZES,
    GUTTER_STYLES,
    GUTTER_TYPES,
    PERMIT_FEES,
    PIPE_BOOT_TYPES,
    PITCH_MULTIPLIERS,
    ROOF_COMPLEXITIES,
    SHINGLE_BRANDS,
    SHINGLE_RATES,
    SHINGLE_TYPES,
    UNDERLAYMENT_TYPES,
    WASTE_FACTORS,
)
from .schemas import (
    HistoryResponse,
    MaterialCostResponse,
    MaterialCostUpdate,
    MaterialPriceCreate,
    MaterialPriceEntry,
    MaterialPriceUpdate,
    PricingSettingsResponse,
    PricingSettingsUpdate,
    PricingInfoResponse,
    RoofingEstimateCreate,
    RoofingEstimateListResponse,
    RoofingEstimateResponse,
    RoofingEstimateUpdate,
)
from .service import RoofingEstimateService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/roofing-estimates", tags=["Roofing Estimates"])


# ── Pricing info (for frontend dropdowns) ──

@router.get("/pricing-info", response_model=PricingInfoResponse)
def get_pricing_info():
    """Get available options and pricing constants for the estimate form."""
    return {
        "building_types": BUILDING_TYPES,
        "roof_complexities": ROOF_COMPLEXITIES,
        "existing_materials": EXISTING_MATERIALS,
        "shingle_types": SHINGLE_TYPES,
        "shingle_brands": SHINGLE_BRANDS,
        "decking_materials": DECKING_MATERIALS,
        "underlayment_types": UNDERLAYMENT_TYPES,
        "pipe_boot_types": PIPE_BOOT_TYPES,
        "gutter_materials": GUTTER_MATERIALS,
        "gutter_styles": GUTTER_STYLES,
        "gutter_sizes": GUTTER_SIZES,
        "gutter_types": GUTTER_TYPES,
        "gutter_scopes": GUTTER_SCOPES,
        "downspout_sizes": DOWNSPOUT_SIZES,
        "gutter_guard_types": GUTTER_GUARD_TYPES,
        "shingle_rates": SHINGLE_RATES,
        "decking_rates": DECKING_RATES,
        "pitch_multipliers": PITCH_MULTIPLIERS,
        "waste_factors": WASTE_FACTORS,
        "permit_fees": PERMIT_FEES,
    }


# ── CRUD ──

# ── Default material price book (internal) ──
# Declared before /{estimate_id} so the literal path wins the match.

@router.get("/material-prices", response_model=list[MaterialPriceEntry])
def list_material_prices(
    company_id: Optional[str] = Query(None),
    include_inactive: bool = Query(
        False, description="Include retired materials",
    ),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Editable default supplier costs, seeded on first use."""
    service = RoofingEstimateService(session)
    return service.list_material_prices(
        company_id=company_id, include_inactive=include_inactive,
    )


@router.get("/material-bases")
def list_material_bases(
    current_user: dict = Depends(get_current_user),
):
    """Measurements a material quantity formula can be written against."""
    return basis_options()


@router.post("/material-formula/validate")
def validate_material_formula(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Check a quantity formula and show what it yields on a sample roof.

    Lets the price-book screen report a typo while it is being typed,
    rather than at costing time on a real estimate.
    """
    sample = {
        "squares": 28.25, "squares_no_waste": 25.0, "total_sf": 2500.0,
        "eave_lf": 120.0, "rake_lf": 60.0, "drip_edge_lf": 180.0,
        "ridge_lf": 40.0, "hip_lf": 10.0, "ridge_hip_lf": 50.0,
        "valley_lf": 20.0, "eave_valley_lf": 140.0, "flashing_lf": 30.0,
        "penetrations": 4.0, "chimneys": 1.0, "skylights": 0.0,
        "gutter_lf": 150.0, "downspout_lf": 60.0, "fixed": 0.0,
    }
    result = validate_formula(
        body.get("formula") or "", formula_variables(sample),
    )
    result["sample"] = sample
    return result


@router.get("/material-formula/variables")
def list_formula_variables(
    current_user: dict = Depends(get_current_user),
):
    """Variables and functions a quantity formula may use."""
    return {
        "variables": formula_variable_docs(),
        "functions": FUNCTION_NAMES,
    }


@router.post("/material-prices", response_model=MaterialPriceEntry)
def create_material_price(
    data: MaterialPriceCreate,
    company_id: Optional[str] = Query(None),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Add a material the seed catalog does not cover.

    Retiring a material is an update setting is_active=false, not a
    delete: estimates priced with it must keep resolving.
    """
    service = RoofingEstimateService(session)
    return service.create_material_price(
        data.dict(exclude_unset=True),
        company_id=company_id,
        created_by_id=current_user.id,
    )


@router.put("/material-prices", response_model=list[MaterialPriceEntry])
def update_material_prices(
    data: MaterialPriceUpdate,
    company_id: Optional[str] = Query(None),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Change default costs. Existing estimates keep their own snapshot."""
    service = RoofingEstimateService(session)
    prices = {
        key: patch.dict(exclude_unset=True)
        for key, patch in data.prices.items()
    }
    return service.update_material_prices(
        prices, company_id=company_id, updated_by_id=current_user.id,
    )


@router.get("/pricing-settings", response_model=PricingSettingsResponse)
def list_pricing_settings(
    company_id: Optional[str] = Query(None),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Editable calculation rates — installed rates, multipliers, tax, fees.

    Material costs are not here; they belong to /material-prices, which
    stays the single place a supplier cost is edited.
    """
    service = RoofingEstimateService(session)
    return service.list_pricing_settings(company_id=company_id)


@router.put("/pricing-settings", response_model=PricingSettingsResponse)
def update_pricing_settings(
    data: PricingSettingsUpdate,
    company_id: Optional[str] = Query(None),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Change calculation rates. A null value resets to the default.

    Existing estimates keep the totals they were last calculated with;
    they re-price only when someone calculates them again.
    """
    service = RoofingEstimateService(session)
    try:
        return service.update_pricing_settings(
            [p.dict(exclude_unset=True) for p in data.settings],
            company_id=company_id,
            updated_by_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("", response_model=RoofingEstimateResponse)
def create_estimate(
    data: RoofingEstimateCreate,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    service = RoofingEstimateService(session)
    result = service.create_estimate(data, created_by_id=current_user.id)
    return result


@router.get("", response_model=RoofingEstimateListResponse)
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
    service = RoofingEstimateService(session)
    items, total = service.list_estimates(
        claim_id=claim_id,
        company_id=company_id,
        status=status,
        search=search,
        page=page,
        page_size=page_size,
    )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/{estimate_id}", response_model=RoofingEstimateResponse)
def get_estimate(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    service = RoofingEstimateService(session)
    result = service.get_estimate(estimate_id)
    if not result:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return result


@router.put("/{estimate_id}", response_model=RoofingEstimateResponse)
def update_estimate(
    estimate_id: str,
    data: RoofingEstimateUpdate,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    service = RoofingEstimateService(session)
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
    service = RoofingEstimateService(session)
    if not service.delete_estimate(estimate_id):
        raise HTTPException(status_code=404, detail="Estimate not found")
    return {"message": "Estimate deleted"}


# ── EagleView Parsing ──

@router.post("/parse-eagleview")
def parse_eagleview_upload(
    file: UploadFile = File(...),
    selected_structures: Optional[str] = Query(
        None,
        description="Comma-separated structure indices (0-based)",
    ),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Parse an EagleView export file and return measurement data."""
    try:
        content = file.file.read()
        raw_data = json.loads(content)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid JSON file: {str(e)}"
        )

    struct_indices = None
    if selected_structures:
        struct_indices = [
            int(s.strip()) for s in selected_structures.split(",")
        ]

    service = RoofingEstimateService(session)
    try:
        measurements = service.parse_eagleview_file(
            raw_data, selected_structures=struct_indices,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return measurements


@router.post("/{estimate_id}/apply-eagleview",
             response_model=RoofingEstimateResponse)
def apply_eagleview_measurement(
    estimate_id: str,
    file: UploadFile = File(...),
    selected_faces: Optional[str] = Query(
        None,
        description="Comma-separated face IDs for partial roof",
    ),
    selected_structures: Optional[str] = Query(
        None,
        description="Comma-separated structure indices (0-based)",
    ),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Upload EagleView file and apply measurements to estimate."""
    try:
        content = file.file.read()
        raw_data = json.loads(content)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid JSON file: {str(e)}"
        )

    face_ids = None
    if selected_faces:
        face_ids = [f.strip() for f in selected_faces.split(",")]

    struct_indices = None
    if selected_structures:
        struct_indices = [
            int(s.strip()) for s in selected_structures.split(",")
        ]

    service = RoofingEstimateService(session)
    try:
        result = service.apply_eagleview_measurement(
            estimate_id, raw_data, face_ids, struct_indices,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not result:
        raise HTTPException(
            status_code=404, detail="Estimate not found",
        )
    return result


# ── Calculation ──

@router.post("/{estimate_id}/calculate", response_model=RoofingEstimateResponse)
def calculate_estimate(
    estimate_id: str,
    data: Optional[RoofingEstimateUpdate] = None,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Save (if body provided) then calculate in one round-trip."""
    service = RoofingEstimateService(session)
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

# ── Internal material cost (not customer-facing) ──

@router.get(
    "/{estimate_id}/material-costs", response_model=MaterialCostResponse,
)
def get_material_costs(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Material cost breakdown with tax, for internal profit analysis.

    Quantities are derived from the roof measurements, so this stays in
    sync with the estimate without anything being entered by hand.
    """
    service = RoofingEstimateService(session)
    result = service.get_material_costs(estimate_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return result


@router.put(
    "/{estimate_id}/material-costs", response_model=MaterialCostResponse,
)
def update_material_costs(
    estimate_id: str,
    data: MaterialCostUpdate,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Record actual supplier costs that differ from the defaults."""
    service = RoofingEstimateService(session)
    overrides = None
    if data.overrides is not None:
        overrides = {
            key: value.dict(exclude_none=True)
            for key, value in data.overrides.items()
        }
    result = service.update_material_costs(
        estimate_id, overrides=overrides, tax_rate=data.tax_rate,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return result


@router.post("/{estimate_id}/clone", response_model=RoofingEstimateResponse)
def clone_estimate(
    estimate_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    service = RoofingEstimateService(session)
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
    service = RoofingEstimateService(session)
    return service.get_history(estimate_id)


# ── Export (PDF) ──

@router.get("/{estimate_id}/export/pdf")
def export_pdf(
    estimate_id: str,
    show_signature: bool = Query(True),
    pricing_mode: str = Query("detailed"),  # detailed | lumpsum
    gutter_separate: bool = Query(False),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    from .export_service import RoofingExportService

    service = RoofingEstimateService(session)
    estimate = service.get_estimate(estimate_id)
    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    export_svc = RoofingExportService()
    pdf_bytes = export_svc.generate_pdf(
        estimate,
        show_signature=show_signature,
        pricing_mode=pricing_mode,
        gutter_separate=gutter_separate,
    )

    return StreamingResponse(
        pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="roofing_estimate_{estimate_id[:8]}.pdf"'
        },
    )


@router.get("/{estimate_id}/export/invoice")
def export_invoice(
    estimate_id: str,
    completion_date: str = Query(""),
    pricing_mode: str = Query("detailed"),
    invoice_date: str = Query(""),
    due_date: str = Query(""),
    payment_amount: float = Query(0),
    payment_date: str = Query(""),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    from .export_service import RoofingExportService

    service = RoofingEstimateService(session)
    estimate = service.get_estimate(estimate_id)
    if not estimate:
        raise HTTPException(
            status_code=404, detail="Estimate not found",
        )

    export_svc = RoofingExportService()
    pdf_bytes = export_svc.generate_invoice_pdf(
        estimate,
        completion_date=completion_date,
        pricing_mode=pricing_mode,
        invoice_date=invoice_date,
        due_date=due_date,
        payment_amount=payment_amount,
        payment_date=payment_date,
    )

    return StreamingResponse(
        pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'attachment; filename='
                f'"roofing_invoice_{estimate_id[:8]}.pdf"'
            )
        },
    )


@router.get("/{estimate_id}/export/warranty-cert")
def export_warranty_cert(
    estimate_id: str,
    completion_date: str = Query(""),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    from .export_service import RoofingExportService

    service = RoofingEstimateService(session)
    estimate = service.get_estimate(estimate_id)
    if not estimate:
        raise HTTPException(
            status_code=404, detail="Estimate not found",
        )

    export_svc = RoofingExportService()
    pdf_bytes = export_svc.generate_warranty_cert_pdf(
        estimate, completion_date=completion_date,
    )

    return StreamingResponse(
        pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'attachment; filename='
                f'"roofing_warranty_{estimate_id[:8]}.pdf"'
            )
        },
    )
