"""
Water Mitigation Scope of Work API

REST API endpoints for scope locations, scope items,
and debris calculation.
"""

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from app.core.database_factory import get_db
from app.domains.auth.dependencies import get_current_user
from app.domains.staff.models import Staff
from app.domains.water_mitigation.scope_service import ScopeService
from app.domains.water_mitigation.schemas import (
    # Location schemas
    ScopeLocationCreate,
    ScopeLocationUpdate,
    ScopeLocationResponse,
    ScopeLocationListResponse,
    # Item schemas
    ScopeItemCreate,
    ScopeItemUpdate,
    ScopeItemResponse,
    # Debris schemas
    WMDebrisCalculationResponse,
    CalculateDebrisRequest,
    CalculateDebrisResponse,
    CategoryBreakdown,
    DumpsterRecommendation,
    DebrisItemDetail,
    # Bulk operations
    AddStandardItemsRequest,
    # Formula
    CalculateFormulaRequest,
    CalculateFormulaResponse,
    # Constants
    STANDARD_SCOPE_ITEMS,
)

router = APIRouter(prefix="/scope", tags=["Water Mitigation - Scope of Work"])


# =============================================================================
# Scope Location Endpoints
# =============================================================================

@router.get(
    "/jobs/{job_id}/locations",
    response_model=ScopeLocationListResponse,
    summary="Get all scope locations for a job"
)
def get_locations_for_job(
    job_id: UUID,
    include_items: bool = Query(True, description="Include scope items"),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Get all scope locations for a job"""
    service = ScopeService(db)
    locations = service.get_locations_for_job(job_id, include_items)

    return ScopeLocationListResponse(
        items=[ScopeLocationResponse.from_orm(loc) for loc in locations],
        total=len(locations)
    )


@router.get(
    "/locations/{location_id}",
    response_model=ScopeLocationResponse,
    summary="Get a scope location by ID"
)
def get_location(
    location_id: UUID,
    include_items: bool = Query(True, description="Include scope items"),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Get a scope location by ID"""
    service = ScopeService(db)
    location = service.get_location(location_id, include_items)

    if not location:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Location not found"
        )

    return ScopeLocationResponse.from_orm(location)


@router.post(
    "/locations",
    response_model=ScopeLocationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new scope location"
)
def create_location(
    data: ScopeLocationCreate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Create a new scope location"""
    service = ScopeService(db)
    location = service.create_location(data)
    db.commit()
    db.refresh(location)
    return ScopeLocationResponse.from_orm(location)


@router.put(
    "/locations/{location_id}",
    response_model=ScopeLocationResponse,
    summary="Update a scope location"
)
def update_location(
    location_id: UUID,
    data: ScopeLocationUpdate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Update a scope location"""
    service = ScopeService(db)
    try:
        location = service.update_location(location_id, data)
        db.commit()
        db.refresh(location)
        return ScopeLocationResponse.from_orm(location)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )


@router.delete(
    "/locations/{location_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a scope location"
)
def delete_location(
    location_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Delete a scope location and all its items"""
    service = ScopeService(db)
    try:
        service.delete_location(location_id)
        db.commit()
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )


# =============================================================================
# Scope Item Endpoints
# =============================================================================

@router.get(
    "/locations/{location_id}/items",
    response_model=List[ScopeItemResponse],
    summary="Get all scope items for a location"
)
def get_items_for_location(
    location_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Get all scope items for a location"""
    service = ScopeService(db)
    items = service.get_items_for_location(location_id)
    return [ScopeItemResponse.from_orm(item) for item in items]


@router.get(
    "/items/{item_id}",
    response_model=ScopeItemResponse,
    summary="Get a scope item by ID"
)
def get_item(
    item_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Get a scope item by ID"""
    service = ScopeService(db)
    item = service.get_item(item_id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found"
        )

    return ScopeItemResponse.from_orm(item)


@router.post(
    "/items",
    response_model=ScopeItemResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new scope item"
)
def create_item(
    data: ScopeItemCreate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Create a new scope item"""
    service = ScopeService(db)
    try:
        item = service.create_item(data)
        db.commit()
        # Refresh to get relationships
        item = service.get_item(item.id)
        return ScopeItemResponse.from_orm(item)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.put(
    "/items/{item_id}",
    response_model=ScopeItemResponse,
    summary="Update a scope item"
)
def update_item(
    item_id: UUID,
    data: ScopeItemUpdate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Update a scope item"""
    service = ScopeService(db)
    try:
        item = service.update_item(item_id, data)
        db.commit()
        # Refresh to get relationships
        item = service.get_item(item.id)
        return ScopeItemResponse.from_orm(item)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )


@router.delete(
    "/items/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a scope item"
)
def delete_item(
    item_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Delete a scope item"""
    service = ScopeService(db)
    try:
        service.delete_item(item_id)
        db.commit()
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )


@router.post(
    "/locations/{location_id}/add-standard-items",
    response_model=List[ScopeItemResponse],
    summary="Add standard scope items to a location"
)
def add_standard_items(
    location_id: UUID,
    include_items: Optional[List[str]] = Query(
        None, description="List of item names to include (all if not specified)"
    ),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Add standard scope items to a location"""
    service = ScopeService(db)
    try:
        items = service.add_standard_items_to_location(location_id, include_items)
        db.commit()
        return [ScopeItemResponse.from_orm(item) for item in items]
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.get(
    "/standard-items",
    summary="Get list of standard scope items"
)
def get_standard_items():
    """Get list of predefined standard scope items"""
    return STANDARD_SCOPE_ITEMS


# =============================================================================
# Debris Calculation Endpoints
# =============================================================================

@router.post(
    "/jobs/{job_id}/calculate-debris",
    response_model=CalculateDebrisResponse,
    summary="Calculate debris weight for a job"
)
def calculate_debris(
    job_id: UUID,
    request: CalculateDebrisRequest = CalculateDebrisRequest(),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Calculate debris weight for all demolition items in a job.

    Uses material weights from the admin material management system.
    Items without material mappings will have 0 weight and generate warnings.
    """
    service = ScopeService(db)
    calculation_data, warnings = service.calculate_debris_for_job(
        job_id,
        save_result=request.save_result,
        user_id=current_user.id
    )

    # Build response
    if not calculation_data.get("item_details"):
        return CalculateDebrisResponse(
            success=True,
            calculation=None,
            message="No demolition items found for debris calculation",
            warnings=warnings
        )

    # Get saved calculation if we saved it
    saved_calc = None
    if request.save_result:
        saved_calc = service.get_debris_calculation(job_id)

    # Build calculation response
    calc_response = WMDebrisCalculationResponse(
        id=saved_calc.id if saved_calc else job_id,  # Use job_id if not saved
        job_id=job_id,
        total_weight_lb=calculation_data["total_weight_lb"],
        total_weight_ton=calculation_data["total_weight_ton"],
        category_breakdown=[
            CategoryBreakdown(**cb)
            for cb in calculation_data["category_breakdown"]
        ],
        dumpster_recommendation=(
            DumpsterRecommendation(**calculation_data["dumpster_recommendation"])
            if calculation_data.get("dumpster_recommendation")
            else None
        ),
        item_details=[
            DebrisItemDetail(**item)
            for item in calculation_data["item_details"]
        ],
        calculated_at=calculation_data["calculated_at"],
        calculated_by_id=current_user.id
    )

    return CalculateDebrisResponse(
        success=True,
        calculation=calc_response,
        message=f"Calculated debris for {len(calculation_data['item_details'])} items",
        warnings=warnings
    )


@router.get(
    "/jobs/{job_id}/debris-calculation",
    response_model=Optional[WMDebrisCalculationResponse],
    summary="Get saved debris calculation for a job"
)
def get_debris_calculation(
    job_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Get saved debris calculation for a job"""
    service = ScopeService(db)
    calc = service.get_debris_calculation(job_id)

    if not calc:
        return None

    # Parse JSON fields
    category_breakdown = calc.category_breakdown or []
    dumpster_rec = calc.dumpster_recommendation
    item_details = calc.item_details or []

    return WMDebrisCalculationResponse(
        id=calc.id,
        job_id=calc.job_id,
        total_weight_lb=float(calc.total_weight_lb or 0),
        total_weight_ton=float(calc.total_weight_ton or 0),
        category_breakdown=[
            CategoryBreakdown(**cb) if isinstance(cb, dict) else cb
            for cb in category_breakdown
        ],
        dumpster_recommendation=(
            DumpsterRecommendation(**dumpster_rec)
            if dumpster_rec
            else None
        ),
        item_details=[
            DebrisItemDetail(**item) if isinstance(item, dict) else item
            for item in item_details
        ],
        calculated_at=calc.calculated_at,
        calculated_by_id=calc.calculated_by_id
    )


# =============================================================================
# Utility Endpoints
# =============================================================================

@router.post(
    "/calculate-formula",
    response_model=CalculateFormulaResponse,
    summary="Calculate a mathematical formula"
)
def calculate_formula(
    request: CalculateFormulaRequest,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Calculate a mathematical formula.

    Supports: +, -, *, /, parentheses, and decimal numbers.
    Example: "10*12+5*8" = 160
    """
    service = ScopeService(db)
    success, result, error = service.calculate_formula(request.formula)

    return CalculateFormulaResponse(
        success=success,
        formula=request.formula,
        result=result,
        error=error
    )
