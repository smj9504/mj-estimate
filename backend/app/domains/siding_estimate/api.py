"""
Siding Estimate API endpoints
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from app.core.database_factory import get_db_session
from app.core.interfaces import DatabaseSession
from app.domains.auth.dependencies import get_current_user

from .eagleview_parser import parse_eagleview_xml
from .schemas import (
    EagleViewParseResponse,
    SidingEstimateCreate,
    SidingEstimateLineItemCreate,
    SidingEstimateLineItemUpdate,
    SidingEstimateListResponse,
    SidingEstimateResponse,
    SidingEstimateUpdate,
    SIDING_PHASE_LABELS,
)
from .service import SidingEstimateService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/siding-estimates", tags=["Siding Estimates"])


def _get_service(session: DatabaseSession = Depends(get_db_session)) -> SidingEstimateService:
    return SidingEstimateService(session)


# ── EagleView Upload ──


@router.post("/upload-eagleview", response_model=EagleViewParseResponse)
async def upload_eagleview(
    file: UploadFile = File(...),
    service: SidingEstimateService = Depends(_get_service),
    current_user=Depends(get_current_user),
):
    """Upload an EagleView XML file and parse it."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    # Read file content
    content = await file.read()

    # Detect file type
    filename_lower = file.filename.lower()
    if filename_lower.endswith(".xml"):
        xml_content = content.decode("utf-8")
    elif filename_lower.endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="PDF parsing not yet supported. Please upload the XML file.",
        )
    else:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Please upload .xml file.",
        )

    try:
        report = service.parse_eagleview(xml_content)
    except Exception as e:
        logger.error(f"EagleView parse error: {e}")
        raise HTTPException(
            status_code=422,
            detail=f"Failed to parse EagleView XML: {str(e)}",
        )

    # Convert to response
    report_dict = report.to_dict()
    return EagleViewParseResponse(
        report_id=report.report_id,
        claim_id=report.claim_id,
        address=report.address,
        city=report.city,
        state=report.state,
        zip_code=report.zip_code,
        latitude=report.latitude,
        longitude=report.longitude,
        total_wall_area=report.total_wall_area,
        total_wall_area_less_penetrations=report.total_wall_area_less_penetrations,
        total_siding_area=report.total_siding_area,
        total_siding_area_less_penetrations=report.total_siding_area_less_penetrations,
        total_masonry_area=report.total_masonry_area,
        total_masonry_area_less_penetrations=report.total_masonry_area_less_penetrations,
        total_wall_facets=report.total_wall_facets,
        total_windows_and_doors=report.total_windows_and_doors,
        total_windows_and_doors_area=report.total_windows_and_doors_area,
        total_windows_and_doors_perimeter=report.total_windows_and_doors_perimeter,
        fascia_lf=report.fascia_lf,
        inside_corners_lf=report.inside_corners_lf,
        outside_corners_lf=report.outside_corners_lf,
        obtuse_inside_corners_lf=report.obtuse_inside_corners_lf,
        obtuse_outside_corners_lf=report.obtuse_outside_corners_lf,
        inside_siding_corners_lf=report.inside_siding_corners_lf,
        outside_siding_corners_lf=report.outside_siding_corners_lf,
        top_siding_walls_lf=report.top_siding_walls_lf,
        bottom_siding_walls_lf=report.bottom_siding_walls_lf,
        materials=report.materials,
        sub_types=report.sub_types,
        walls=report_dict.get("walls", []),
        raw_data=report_dict,
    )


# ── CRUD ──


@router.get("/", response_model=SidingEstimateListResponse)
async def list_estimates(
    claim_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    service: SidingEstimateService = Depends(_get_service),
    current_user=Depends(get_current_user),
):
    items, total = service.get_list(
        claim_id=claim_id,
        company_id=company_id,
        status=status,
        search=search,
        page=page,
        page_size=page_size,
    )
    return SidingEstimateListResponse(
        items=items, total=total, page=page, page_size=page_size
    )


@router.get("/phase-labels")
async def get_phase_labels(current_user=Depends(get_current_user)):
    """Get phase label definitions."""
    return SIDING_PHASE_LABELS


@router.get("/{estimate_id}", response_model=SidingEstimateResponse)
async def get_estimate(
    estimate_id: str,
    service: SidingEstimateService = Depends(_get_service),
    current_user=Depends(get_current_user),
):
    estimate = service.get_by_id(estimate_id)
    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return estimate


@router.post("/", response_model=SidingEstimateResponse, status_code=201)
async def create_estimate(
    data: SidingEstimateCreate,
    service: SidingEstimateService = Depends(_get_service),
    current_user=Depends(get_current_user),
):
    estimate = service.create(
        data.model_dump(exclude_none=True),
        created_by_id=str(current_user.id) if current_user else None,
    )
    return estimate


@router.put("/{estimate_id}", response_model=SidingEstimateResponse)
async def update_estimate(
    estimate_id: str,
    data: SidingEstimateUpdate,
    service: SidingEstimateService = Depends(_get_service),
    current_user=Depends(get_current_user),
):
    estimate = service.update(estimate_id, data.model_dump(exclude_none=True))
    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return estimate


@router.delete("/{estimate_id}")
async def delete_estimate(
    estimate_id: str,
    service: SidingEstimateService = Depends(_get_service),
    current_user=Depends(get_current_user),
):
    if not service.delete(estimate_id):
        raise HTTPException(status_code=404, detail="Estimate not found")
    return {"success": True}


# ── Line Items ──


@router.post("/{estimate_id}/line-items")
async def add_line_item(
    estimate_id: str,
    data: SidingEstimateLineItemCreate,
    service: SidingEstimateService = Depends(_get_service),
    current_user=Depends(get_current_user),
):
    item = service.add_line_item(estimate_id, data.model_dump())
    if not item:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return item


@router.put("/{estimate_id}/line-items/{item_id}")
async def update_line_item(
    estimate_id: str,
    item_id: str,
    data: SidingEstimateLineItemUpdate,
    service: SidingEstimateService = Depends(_get_service),
    current_user=Depends(get_current_user),
):
    item = service.update_line_item(item_id, data.model_dump(exclude_none=True))
    if not item:
        raise HTTPException(status_code=404, detail="Line item not found")
    return item


@router.delete("/{estimate_id}/line-items/{item_id}")
async def delete_line_item(
    estimate_id: str,
    item_id: str,
    service: SidingEstimateService = Depends(_get_service),
    current_user=Depends(get_current_user),
):
    if not service.delete_line_item(item_id):
        raise HTTPException(status_code=404, detail="Line item not found")
    return {"success": True}


@router.delete("/{estimate_id}/phases/{phase}")
async def delete_phase(
    estimate_id: str,
    phase: int,
    service: SidingEstimateService = Depends(_get_service),
    current_user=Depends(get_current_user),
):
    count = service.delete_phase(estimate_id, phase)
    return {"success": True, "deleted_count": count}


# ── Generate & Calculate ──


@router.post("/{estimate_id}/generate", response_model=SidingEstimateResponse)
async def generate_line_items(
    estimate_id: str,
    service: SidingEstimateService = Depends(_get_service),
    current_user=Depends(get_current_user),
):
    """Auto-generate line items from measurements and specs."""
    estimate = service.generate_line_items(estimate_id)
    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return estimate


@router.post("/{estimate_id}/recalculate", response_model=SidingEstimateResponse)
async def recalculate_totals(
    estimate_id: str,
    service: SidingEstimateService = Depends(_get_service),
    current_user=Depends(get_current_user),
):
    """Recalculate subtotal, O&P, and total."""
    estimate = service.recalculate(estimate_id)
    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return estimate
