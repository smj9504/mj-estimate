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
