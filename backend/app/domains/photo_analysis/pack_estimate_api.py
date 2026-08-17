"""
Pack Estimate API Endpoints

API endpoints for generating pack-out estimates from photos.
"""

import logging
from typing import List, Optional
from uuid import UUID
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field, HttpUrl
from sqlalchemy.orm import Session
from sqlalchemy import select, func, desc

from app.domains.photo_analysis.pack_estimate_service import (
    PackEstimateService,
    PackEstimateResult,
    Phase1Result,
    Phase2Result,
    PackEstimateLineItem,
    PackEstimateSummary
)
from app.domains.photo_analysis.models import PackEstimate, PackEstimateStatus
from app.domains.auth.dependencies import get_current_user_optional, get_current_user
from app.core.database_factory import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pack-estimate", tags=["Pack Estimate"])

# Service instance — created lazily on first use, not at import time.
# PackEstimateService.__init__ instantiates OpenAIVisionProvider, which
# imports the `openai` SDK (~30MB+ RSS). Since this module is imported
# from app.main at process startup, an eager instance here loaded that
# cost into every worker regardless of whether pack-estimate is ever used.
_pack_estimate_service: Optional[PackEstimateService] = None


def _get_pack_estimate_service() -> PackEstimateService:
    global _pack_estimate_service
    if _pack_estimate_service is None:
        _pack_estimate_service = PackEstimateService()
    return _pack_estimate_service


# ============================================================
# Request/Response Schemas
# ============================================================

class PackEstimateRequest(BaseModel):
    """Request for pack estimate generation"""
    photo_urls: List[HttpUrl] = Field(
        ...,
        min_length=1,
        max_length=20,
        description="URLs of photos to analyze (1-20)"
    )
    room_name: str = Field(
        default="Pack-Out Estimate",
        description="Name/identifier for the room/project"
    )
    custom_pricing_json: Optional[str] = Field(
        None,
        description="Optional custom pricing data as JSON string"
    )
    skip_phase2_ai: bool = Field(
        False,
        description="If True, use rule-based generation instead of AI for Phase 2"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "photo_urls": [
                    "https://example.com/room1.jpg",
                    "https://example.com/room2.jpg"
                ],
                "room_name": "Living Room Pack-Out",
                "skip_phase2_ai": False
            }
        }


class Phase1Request(BaseModel):
    """Request for Phase 1 only (photo analysis)"""
    photo_urls: List[HttpUrl] = Field(
        ...,
        min_length=1,
        max_length=20,
        description="URLs of photos to analyze"
    )
    room_name: str = Field(
        default="Unknown Room",
        description="Name/identifier for the room"
    )


class Phase2Request(BaseModel):
    """Request for Phase 2 only (estimate generation from existing inventory)"""
    inventory: Phase1Result = Field(
        ...,
        description="Inventory data from Phase 1"
    )
    custom_pricing_json: Optional[str] = Field(
        None,
        description="Optional custom pricing data as JSON string"
    )


class ExportToEstimateRequest(BaseModel):
    """Request to convert pack estimate to estimate editor format"""
    pack_result: PackEstimateResult = Field(
        ...,
        description="Pack estimate result to convert"
    )


class EstimateLineItemResponse(BaseModel):
    """Line item in estimate editor format"""
    id: str
    line_item_id: Optional[str] = None
    name: str
    description: Optional[str] = None
    note: Optional[str] = None
    quantity: float
    unit: str
    unit_price: float
    total: float
    taxable: bool = False
    primary_group: str = "Moving/Packing"
    secondary_group: Optional[str] = None
    sort_order: int = 0


class ExportToEstimateResponse(BaseModel):
    """Response with estimate editor compatible line items"""
    line_items: List[EstimateLineItemResponse]
    summary: PackEstimateSummary


class SetPricingRequest(BaseModel):
    """Request to set custom pricing data"""
    pricing_json: str = Field(
        ...,
        description="Pricing data as JSON string"
    )


# ============================================================
# API Endpoints
# ============================================================

@router.post(
    "/generate",
    response_model=PackEstimateResult,
    summary="Generate Pack Estimate",
    description="Generate a complete pack-out estimate from photos using AI analysis."
)
async def generate_pack_estimate(
    request: PackEstimateRequest,
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """
    Generate complete pack estimate from photos.

    Workflow:
    1. Phase 1: AI analyzes photos to create inventory
    2. Phase 2: Generate line items with pricing
    3. Return combined result ready for Estimate Editor
    """
    try:
        photo_urls = [str(url) for url in request.photo_urls]

        result = await _get_pack_estimate_service().generate_pack_estimate(
            photo_urls=photo_urls,
            room_name=request.room_name,
            custom_pricing=request.custom_pricing_json,
            skip_phase2_ai=request.skip_phase2_ai
        )

        logger.info(
            f"Pack estimate generated: {len(result.line_items)} items, "
            f"total ${result.summary.total:.2f}"
        )

        return result

    except Exception as e:
        logger.error(f"Error generating pack estimate: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate pack estimate: {str(e)}"
        )


@router.post(
    "/analyze-photos",
    response_model=Phase1Result,
    summary="Phase 1: Analyze Photos",
    description="Analyze photos to create content inventory (Phase 1 only)."
)
async def analyze_photos_phase1(
    request: Phase1Request,
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """
    Phase 1 only: Analyze photos to create inventory.

    Use this when you want to review the inventory before generating the estimate.
    """
    try:
        photo_urls = [str(url) for url in request.photo_urls]

        result = await _get_pack_estimate_service().analyze_photos_phase1(
            photo_urls=photo_urls,
            room_name=request.room_name
        )

        logger.info(f"Phase 1 complete: {len(result.items)} items detected")
        return result

    except Exception as e:
        logger.error(f"Error in Phase 1 analysis: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to analyze photos: {str(e)}"
        )


@router.post(
    "/generate-from-inventory",
    response_model=Phase2Result,
    summary="Phase 2: Generate Estimate from Inventory",
    description="Generate estimate line items from existing inventory data (Phase 2 only)."
)
async def generate_estimate_from_inventory(
    request: Phase2Request,
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """
    Phase 2 only: Generate estimate from existing inventory.

    Use this after reviewing/editing Phase 1 inventory results.
    """
    try:
        result = await _get_pack_estimate_service().generate_estimate_phase2(
            inventory=request.inventory,
            custom_pricing=request.custom_pricing_json
        )

        logger.info(f"Phase 2 complete: {len(result.line_items)} line items")
        return result

    except Exception as e:
        logger.error(f"Error in Phase 2 generation: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate estimate: {str(e)}"
        )


@router.post(
    "/export-to-estimate",
    response_model=ExportToEstimateResponse,
    summary="Export to Estimate Editor",
    description="Convert pack estimate result to Estimate Editor format."
)
async def export_to_estimate(
    request: ExportToEstimateRequest,
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """
    Convert PackEstimateResult to Estimate Editor compatible format.

    Returns line items that can be directly imported into the Estimate Editor.
    """
    try:
        estimate_items = _get_pack_estimate_service().convert_to_estimate_items(
            request.pack_result
        )

        line_items = [
            EstimateLineItemResponse(**item) for item in estimate_items
        ]

        return ExportToEstimateResponse(
            line_items=line_items,
            summary=request.pack_result.summary
        )

    except Exception as e:
        logger.error(f"Error exporting to estimate: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to export to estimate: {str(e)}"
        )


@router.post(
    "/set-pricing",
    summary="Set Custom Pricing Data",
    description="Set custom pricing data for estimate generation."
)
async def set_pricing_data(
    request: SetPricingRequest,
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """
    Set custom pricing data for the service.

    This pricing data will be used for all subsequent estimate generations
    until replaced or the server restarts.
    """
    try:
        _get_pack_estimate_service().set_pricing_data(request.pricing_json)
        return {"status": "success", "message": "Pricing data updated"}

    except Exception as e:
        logger.error(f"Error setting pricing data: {e}")
        raise HTTPException(
            status_code=400,
            detail=f"Failed to set pricing data: {str(e)}"
        )


@router.get(
    "/default-pricing",
    summary="Get Default Pricing Data",
    description="Get the default pricing data used when no custom pricing is provided."
)
async def get_default_pricing():
    """
    Get the default pricing data.

    Returns the built-in pricing reference data.
    """
    from app.domains.photo_analysis.prompts.pack_estimate_prompts import DEFAULT_PACK_PRICING_DATA
    return {"pricing_data": DEFAULT_PACK_PRICING_DATA}


@router.get(
    "/service-info",
    summary="Get Service Info",
    description="Get information about the pack estimate service."
)
async def get_service_info():
    """
    Get service information and status.
    """
    return {
        "service": "Pack Estimate Service",
        "version": "1.0.0",
        "features": {
            "phase1_photo_analysis": True,
            "phase2_estimate_generation": True,
            "custom_pricing": True,
            "export_to_estimate": True,
            "ai_provider": "OpenAI GPT-4 Vision"
        },
        "endpoints": {
            "generate": "POST /pack-estimate/generate - Full estimate generation",
            "analyze_photos": "POST /pack-estimate/analyze-photos - Phase 1 only",
            "generate_from_inventory": "POST /pack-estimate/generate-from-inventory - Phase 2 only",
            "export_to_estimate": "POST /pack-estimate/export-to-estimate - Convert to Estimate Editor format",
            "set_pricing": "POST /pack-estimate/set-pricing - Set custom pricing",
            "default_pricing": "GET /pack-estimate/default-pricing - Get default pricing",
            "save": "POST /pack-estimate/save - Save pack estimate",
            "list": "GET /pack-estimate/list - List pack estimates",
            "get": "GET /pack-estimate/{id} - Get pack estimate by ID"
        }
    }


# ============================================================
# Database CRUD Endpoints
# ============================================================

class SavePackEstimateRequest(BaseModel):
    """Request to save a pack estimate to database"""
    pack_result: PackEstimateResult = Field(..., description="Pack estimate result to save")
    job_id: Optional[str] = Field(None, description="External job reference ID")
    job_name: Optional[str] = Field(None, description="Job/project name")
    customer_name: Optional[str] = Field(None, description="Customer name")
    address: Optional[str] = Field(None, description="Job address")
    notes: Optional[str] = Field(None, description="Additional notes")

    class Config:
        json_schema_extra = {
            "example": {
                "pack_result": {},
                "job_id": "JOB-2024-001",
                "job_name": "Smith Residence Pack-Out",
                "customer_name": "John Smith",
                "address": "123 Main St, City, State 12345"
            }
        }


class PackEstimateResponse(BaseModel):
    """Response for a saved pack estimate"""
    id: int
    job_id: Optional[str] = None
    job_name: Optional[str] = None
    customer_name: Optional[str] = None
    address: Optional[str] = None
    room_name: str
    status: str
    photo_urls: List[str]
    items_detected_count: int
    total_boxes: int
    box_requirements: dict
    fragile_item_count: int
    heavy_item_count: int
    estimated_pack_time_hours: float
    crew_size_recommended: int
    special_equipment_needed: Optional[List[str]] = None
    line_items_count: int
    subtotal: float
    tax_rate: float
    tax_amount: float
    total: float
    notes: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PackEstimateListResponse(BaseModel):
    """Response for list of pack estimates"""
    items: List[PackEstimateResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class PackEstimateDetailResponse(PackEstimateResponse):
    """Detailed response including full inventory and line items"""
    phase1_inventory: Optional[dict] = None
    packing_summary: Optional[dict] = None
    line_items: Optional[List[dict]] = None
    processing_info: Optional[dict] = None


class UpdatePackEstimateRequest(BaseModel):
    """Request to update a pack estimate"""
    job_id: Optional[str] = None
    job_name: Optional[str] = None
    customer_name: Optional[str] = None
    address: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


@router.post(
    "/save",
    response_model=PackEstimateResponse,
    summary="Save Pack Estimate",
    description="Save a pack estimate to the database for later retrieval."
)
async def save_pack_estimate(
    request: SavePackEstimateRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Save a pack estimate result to the database.

    This allows storing generated estimates for later review, editing, or conversion
    to full estimate documents.
    """
    try:
        pack_result = request.pack_result
        phase1 = pack_result.phase1_inventory

        # Create PackEstimate record
        pack_estimate = PackEstimate(
            company_id=current_user.get("company_id"),
            job_id=request.job_id,
            job_name=request.job_name,
            customer_name=request.customer_name,
            address=request.address,
            room_name=phase1.room_name if phase1 else "Unknown Room",
            status=PackEstimateStatus.DRAFT,
            photo_urls=pack_result.processing_info.get("photo_urls", [])
            if pack_result.processing_info else [],
            created_by_id=current_user.get("id"),
            notes=request.notes
        )

        # Set Phase 1 data
        if phase1:
            pack_estimate.phase1_inventory = phase1.model_dump()
            pack_estimate.items_detected_count = len(phase1.items)

            # Get packing summary
            summary = phase1.get_summary()
            if summary:
                pack_estimate.packing_summary = summary.model_dump()
                pack_estimate.fragile_item_count = summary.fragile_item_count
                pack_estimate.heavy_item_count = summary.heavy_item_count
                pack_estimate.estimated_pack_time_hours = summary.estimated_total_pack_time_hours
                pack_estimate.crew_size_recommended = summary.crew_size_recommended
                pack_estimate.special_equipment_needed = summary.special_equipment_needed

                # Set box requirements
                if summary.box_requirements:
                    pack_estimate.set_box_requirements(
                        summary.box_requirements.model_dump()
                    )

        # Set Phase 2 data (line items)
        if pack_result.line_items:
            pack_estimate.line_items = [
                item.model_dump() for item in pack_result.line_items
            ]
            pack_estimate.line_items_count = len(pack_result.line_items)

        # Set summary data
        if pack_result.summary:
            pack_estimate.subtotal = pack_result.summary.subtotal
            pack_estimate.tax_rate = pack_result.summary.tax_rate
            pack_estimate.tax_amount = pack_result.summary.tax_amount
            pack_estimate.total = pack_result.summary.total

        # Set processing info
        if pack_result.processing_info:
            pack_estimate.processing_info = pack_result.processing_info
            # Extract photo_urls from processing_info if not already set
            if not pack_estimate.photo_urls:
                pack_estimate.photo_urls = pack_result.processing_info.get(
                    "photo_urls", []
                )

        db.add(pack_estimate)
        db.commit()
        db.refresh(pack_estimate)

        logger.info(f"Pack estimate saved: ID={pack_estimate.id}, job_id={request.job_id}")

        return PackEstimateResponse(
            id=pack_estimate.id,
            job_id=pack_estimate.job_id,
            job_name=pack_estimate.job_name,
            customer_name=pack_estimate.customer_name,
            address=pack_estimate.address,
            room_name=pack_estimate.room_name,
            status=pack_estimate.status,
            photo_urls=pack_estimate.photo_urls or [],
            items_detected_count=pack_estimate.items_detected_count,
            total_boxes=pack_estimate.total_boxes,
            box_requirements=pack_estimate.get_box_requirements_dict(),
            fragile_item_count=pack_estimate.fragile_item_count,
            heavy_item_count=pack_estimate.heavy_item_count,
            estimated_pack_time_hours=pack_estimate.estimated_pack_time_hours,
            crew_size_recommended=pack_estimate.crew_size_recommended,
            special_equipment_needed=pack_estimate.special_equipment_needed,
            line_items_count=pack_estimate.line_items_count,
            subtotal=pack_estimate.subtotal,
            tax_rate=pack_estimate.tax_rate,
            tax_amount=pack_estimate.tax_amount,
            total=pack_estimate.total,
            notes=pack_estimate.notes,
            created_at=pack_estimate.created_at,
            updated_at=pack_estimate.updated_at
        )

    except Exception as e:
        logger.error(f"Error saving pack estimate: {e}")
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save pack estimate: {str(e)}"
        )


@router.get(
    "/list",
    response_model=PackEstimateListResponse,
    summary="List Pack Estimates",
    description="List all saved pack estimates with pagination."
)
async def list_pack_estimates(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    status: Optional[str] = Query(None, description="Filter by status"),
    job_id: Optional[str] = Query(None, description="Filter by job ID"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    List all pack estimates for the current user's company.
    """
    try:
        company_id = current_user.get("company_id")

        # Build query
        query = select(PackEstimate).where(
            PackEstimate.company_id == company_id
        )

        if status:
            query = query.where(PackEstimate.status == status)
        if job_id:
            query = query.where(PackEstimate.job_id == job_id)

        # Count total
        count_query = select(func.count()).select_from(query.subquery())
        total_result = db.execute(count_query)
        total = total_result.scalar() or 0

        # Apply pagination
        query = query.order_by(desc(PackEstimate.created_at))
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = db.execute(query)
        estimates = result.scalars().all()

        items = []
        for est in estimates:
            items.append(PackEstimateResponse(
                id=est.id,
                job_id=est.job_id,
                job_name=est.job_name,
                customer_name=est.customer_name,
                address=est.address,
                room_name=est.room_name,
                status=est.status,
                photo_urls=est.photo_urls or [],
                items_detected_count=est.items_detected_count,
                total_boxes=est.total_boxes,
                box_requirements=est.get_box_requirements_dict(),
                fragile_item_count=est.fragile_item_count,
                heavy_item_count=est.heavy_item_count,
                estimated_pack_time_hours=est.estimated_pack_time_hours,
                crew_size_recommended=est.crew_size_recommended,
                special_equipment_needed=est.special_equipment_needed,
                line_items_count=est.line_items_count,
                subtotal=est.subtotal,
                tax_rate=est.tax_rate,
                tax_amount=est.tax_amount,
                total=est.total,
                notes=est.notes,
                created_at=est.created_at,
                updated_at=est.updated_at
            ))

        total_pages = (total + page_size - 1) // page_size

        return PackEstimateListResponse(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages
        )

    except Exception as e:
        logger.error(f"Error listing pack estimates: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list pack estimates: {str(e)}"
        )


@router.get(
    "/{estimate_id}",
    response_model=PackEstimateDetailResponse,
    summary="Get Pack Estimate",
    description="Get a pack estimate by ID with full details."
)
async def get_pack_estimate(
    estimate_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Get a pack estimate by ID with full details including inventory and line items.
    """
    try:
        company_id = current_user.get("company_id")

        query = select(PackEstimate).where(
            PackEstimate.id == estimate_id,
            PackEstimate.company_id == company_id
        )

        result = db.execute(query)
        estimate = result.scalar_one_or_none()

        if not estimate:
            raise HTTPException(
                status_code=404,
                detail=f"Pack estimate with ID {estimate_id} not found"
            )

        return PackEstimateDetailResponse(
            id=estimate.id,
            job_id=estimate.job_id,
            job_name=estimate.job_name,
            customer_name=estimate.customer_name,
            address=estimate.address,
            room_name=estimate.room_name,
            status=estimate.status,
            photo_urls=estimate.photo_urls or [],
            items_detected_count=estimate.items_detected_count,
            total_boxes=estimate.total_boxes,
            box_requirements=estimate.get_box_requirements_dict(),
            fragile_item_count=estimate.fragile_item_count,
            heavy_item_count=estimate.heavy_item_count,
            estimated_pack_time_hours=estimate.estimated_pack_time_hours,
            crew_size_recommended=estimate.crew_size_recommended,
            special_equipment_needed=estimate.special_equipment_needed,
            line_items_count=estimate.line_items_count,
            subtotal=estimate.subtotal,
            tax_rate=estimate.tax_rate,
            tax_amount=estimate.tax_amount,
            total=estimate.total,
            notes=estimate.notes,
            created_at=estimate.created_at,
            updated_at=estimate.updated_at,
            phase1_inventory=estimate.phase1_inventory,
            packing_summary=estimate.packing_summary,
            line_items=estimate.line_items,
            processing_info=estimate.processing_info
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting pack estimate: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get pack estimate: {str(e)}"
        )


@router.put(
    "/{estimate_id}",
    response_model=PackEstimateResponse,
    summary="Update Pack Estimate",
    description="Update pack estimate metadata (job info, status, notes)."
)
async def update_pack_estimate(
    estimate_id: int,
    request: UpdatePackEstimateRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Update a pack estimate's metadata.
    """
    try:
        company_id = current_user.get("company_id")

        query = select(PackEstimate).where(
            PackEstimate.id == estimate_id,
            PackEstimate.company_id == company_id
        )

        result = db.execute(query)
        estimate = result.scalar_one_or_none()

        if not estimate:
            raise HTTPException(
                status_code=404,
                detail=f"Pack estimate with ID {estimate_id} not found"
            )

        # Update fields if provided
        if request.job_id is not None:
            estimate.job_id = request.job_id
        if request.job_name is not None:
            estimate.job_name = request.job_name
        if request.customer_name is not None:
            estimate.customer_name = request.customer_name
        if request.address is not None:
            estimate.address = request.address
        if request.status is not None:
            estimate.status = request.status
        if request.notes is not None:
            estimate.notes = request.notes

        estimate.updated_by_id = current_user.get("id")

        db.commit()
        db.refresh(estimate)

        logger.info(f"Pack estimate updated: ID={estimate.id}")

        return PackEstimateResponse(
            id=estimate.id,
            job_id=estimate.job_id,
            job_name=estimate.job_name,
            customer_name=estimate.customer_name,
            address=estimate.address,
            room_name=estimate.room_name,
            status=estimate.status,
            photo_urls=estimate.photo_urls or [],
            items_detected_count=estimate.items_detected_count,
            total_boxes=estimate.total_boxes,
            box_requirements=estimate.get_box_requirements_dict(),
            fragile_item_count=estimate.fragile_item_count,
            heavy_item_count=estimate.heavy_item_count,
            estimated_pack_time_hours=estimate.estimated_pack_time_hours,
            crew_size_recommended=estimate.crew_size_recommended,
            special_equipment_needed=estimate.special_equipment_needed,
            line_items_count=estimate.line_items_count,
            subtotal=estimate.subtotal,
            tax_rate=estimate.tax_rate,
            tax_amount=estimate.tax_amount,
            total=estimate.total,
            notes=estimate.notes,
            created_at=estimate.created_at,
            updated_at=estimate.updated_at
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating pack estimate: {e}")
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update pack estimate: {str(e)}"
        )


@router.delete(
    "/{estimate_id}",
    summary="Delete Pack Estimate",
    description="Delete a pack estimate by ID."
)
async def delete_pack_estimate(
    estimate_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Delete a pack estimate.
    """
    try:
        company_id = current_user.get("company_id")

        query = select(PackEstimate).where(
            PackEstimate.id == estimate_id,
            PackEstimate.company_id == company_id
        )

        result = db.execute(query)
        estimate = result.scalar_one_or_none()

        if not estimate:
            raise HTTPException(
                status_code=404,
                detail=f"Pack estimate with ID {estimate_id} not found"
            )

        db.delete(estimate)
        db.commit()

        logger.info(f"Pack estimate deleted: ID={estimate_id}")

        return {"status": "success", "message": f"Pack estimate {estimate_id} deleted"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting pack estimate: {e}")
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete pack estimate: {str(e)}"
        )
