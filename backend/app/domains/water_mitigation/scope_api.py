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
    # Formula
    CalculateFormulaRequest,
    CalculateFormulaResponse,
    # Invoice schemas
    GenerateInvoiceRequest,
    GenerateInvoiceResponse,
    JobInvoiceHistoryResponse,
    WMScopeInvoiceResponse,
    ScopeItemInvoiceStatusResponse,
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
    """
    Create a new scope location.

    By default, standard scope items (Floor Protection, Content Protection,
    Containment, Air Mover, Dehumidifier, Air Scrubber) are automatically
    added to the location. Set auto_add_standard_items=false to create
    an empty location.
    """
    service = ScopeService(db)
    location = service.create_location(data)
    db.commit()
    # Re-fetch location with items to ensure relationships are loaded
    location = service.get_location(location.id, include_items=True)
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
        bag_count=calculation_data.get("bag_count"),  # Include bag count in response
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
        bag_count=calc.bag_count,  # Include bag count in response
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


# =============================================================================
# Scope Invoice Endpoints
# =============================================================================

@router.post(
    "/jobs/{job_id}/generate-invoice",
    response_model=GenerateInvoiceResponse,
    summary="Generate an invoice from scope items"
)
def generate_invoice(
    job_id: UUID,
    request: GenerateInvoiceRequest,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Generate an invoice from scope items.

    Uses the specified template to look up pricing for each scope item.
    Creates invoice items and links them to scope items for traceability.
    """
    from app.domains.water_mitigation.scope_invoice_service import ScopeInvoiceService

    # Validate job_id matches request
    if request.job_id != job_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Job ID in URL must match job_id in request"
        )

    service = ScopeInvoiceService(db)

    try:
        result, warnings = service.generate_invoice_from_scope(
            job_id=job_id,
            template_id=request.template_id,
            user_id=current_user.id,
            billing_company_id=request.billing_company_id,
            invoice_date=request.invoice_date,
            scope_item_ids=request.scope_item_ids,
            notes=request.notes,
            holiday_premium=request.holiday_premium,
        )

        return GenerateInvoiceResponse(
            success=True,
            message=f"Invoice generated successfully with {result['items_invoiced']} items",
            invoice_id=result["invoice_id"],
            invoice_number=result["invoice_number"],
            scope_invoice_id=result["scope_invoice_id"],
            items_invoiced=result["items_invoiced"],
            total_amount=result["total_amount"],
            warnings=warnings,
        )

    except ValueError as e:
        return GenerateInvoiceResponse(
            success=False,
            message=str(e),
            warnings=[],
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate invoice: {str(e)}"
        )


@router.get(
    "/jobs/{job_id}/invoice-history",
    response_model=JobInvoiceHistoryResponse,
    summary="Get invoice history for a job"
)
def get_invoice_history(
    job_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Get all invoices generated for a job"""
    from app.domains.water_mitigation.scope_invoice_service import ScopeInvoiceService

    service = ScopeInvoiceService(db)
    result = service.get_job_invoice_history(job_id)

    return JobInvoiceHistoryResponse(
        invoices=[WMScopeInvoiceResponse(**inv) for inv in result["invoices"]],
        total_invoiced=result["total_invoiced"],
        invoice_count=result["invoice_count"],
    )


@router.get(
    "/jobs/{job_id}/scope-items/invoice-status",
    response_model=List[ScopeItemInvoiceStatusResponse],
    summary="Get invoice status for all scope items"
)
def get_scope_items_invoice_status(
    job_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Get invoice status for all scope items in a job"""
    from app.domains.water_mitigation.scope_invoice_service import ScopeInvoiceService

    service = ScopeInvoiceService(db)
    items = service.get_scope_item_invoice_status(job_id)

    return [ScopeItemInvoiceStatusResponse(**item) for item in items]


@router.get(
    "/jobs/{job_id}/uninvoiced-count",
    summary="Get count of uninvoiced scope items"
)
def get_uninvoiced_count(
    job_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Get the count of scope items that have not been invoiced"""
    from app.domains.water_mitigation.scope_invoice_service import ScopeInvoiceService

    service = ScopeInvoiceService(db)
    count = service.get_uninvoiced_items_count(job_id)

    return {"uninvoiced_count": count}


# =============================================================================
# Invoice Item Configuration Endpoints
# =============================================================================

@router.get(
    "/jobs/{job_id}/invoice-configs",
    summary="Get all invoice item configurations for a job"
)
def get_invoice_item_configs(
    job_id: UUID,
    include_calculated: bool = Query(True, description="Include calculated values based on mitigation period"),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Get all invoice item configurations for a job.
    If include_calculated=True, calculates quantity based on mitigation period for per_day items.
    """
    from app.domains.water_mitigation.invoice_config_service import InvoiceConfigService

    service = InvoiceConfigService(db)
    configs = service.get_invoice_item_configs(job_id, include_calculated)

    return {
        "items": configs,
        "total": len(configs)
    }


@router.post(
    "/jobs/{job_id}/invoice-configs",
    status_code=status.HTTP_201_CREATED,
    summary="Create invoice item configuration"
)
def create_invoice_item_config(
    job_id: UUID,
    config_data: dict,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Create a new invoice item configuration"""
    from app.domains.water_mitigation.invoice_config_service import InvoiceConfigService
    from app.domains.water_mitigation.schemas import InvoiceItemConfigCreate

    # Add job_id to config data
    config_data["job_id"] = str(job_id)
    config = InvoiceItemConfigCreate(**config_data)

    service = InvoiceConfigService(db)
    result = service.create_invoice_item_config(config)

    return result


@router.post(
    "/jobs/{job_id}/invoice-configs/bulk",
    status_code=status.HTTP_201_CREATED,
    summary="Bulk create invoice item configurations"
)
def bulk_create_invoice_item_configs(
    job_id: UUID,
    configs: List[dict],
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Bulk create invoice item configurations for a job"""
    from app.domains.water_mitigation.invoice_config_service import InvoiceConfigService
    from app.domains.water_mitigation.schemas import InvoiceItemConfigCreate

    service = InvoiceConfigService(db)
    results = []

    for config_data in configs:
        config_data["job_id"] = str(job_id)
        config = InvoiceItemConfigCreate(**config_data)
        result = service.create_invoice_item_config(config)
        results.append(result)

    return {
        "created": len(results),
        "items": results
    }


@router.put(
    "/invoice-configs/{config_id}",
    summary="Update invoice item configuration"
)
def update_invoice_item_config(
    config_id: UUID,
    config_data: dict,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Update an invoice item configuration"""
    from app.domains.water_mitigation.invoice_config_service import InvoiceConfigService
    from app.domains.water_mitigation.schemas import InvoiceItemConfigUpdate

    update_data = InvoiceItemConfigUpdate(**config_data)

    service = InvoiceConfigService(db)
    result = service.update_invoice_item_config(config_id, update_data)

    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Invoice item config not found: {config_id}"
        )

    return result


@router.delete(
    "/invoice-configs/{config_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete invoice item configuration"
)
def delete_invoice_item_config(
    config_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Delete an invoice item configuration"""
    from app.domains.water_mitigation.invoice_config_service import InvoiceConfigService

    service = InvoiceConfigService(db)
    success = service.delete_invoice_item_config(config_id)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Invoice item config not found: {config_id}"
        )


@router.post(
    "/jobs/{job_id}/invoice-configs/auto-generate",
    summary="Auto-generate invoice item configurations from scope items"
)
def auto_generate_invoice_configs(
    job_id: UUID,
    template_id: UUID = Query(..., description="Line item template to use for matching"),
    overwrite: bool = Query(False, description="Overwrite existing configurations"),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Auto-generate invoice item configurations based on scope items.

    This will:
    1. Get all scope items for the job
    2. Try to match each scope item to a line item in the template
    3. Auto-detect equipment items and set quantity_calc_type to 'per_day'
    4. Create configurations for matched items
    """
    from app.domains.water_mitigation.invoice_config_service import (
        InvoiceConfigService
    )

    service = InvoiceConfigService(db)
    result = service.auto_generate_invoice_configs(
        job_id, template_id, overwrite
    )

    return result


@router.post(
    "/jobs/{job_id}/preview-invoice",
    summary="Preview invoice generation"
)
def preview_invoice(
    job_id: UUID,
    template_id: UUID = Query(..., description="Line item template ID"),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Preview invoice generation without actually creating the invoice.

    Returns calculated line items with quantities based on:
    - Fixed quantities from scope items
    - Per-day calculations based on mitigation period
    - Mapped rates from line item template
    """
    from app.domains.water_mitigation.invoice_config_service import (
        InvoiceConfigService
    )

    service = InvoiceConfigService(db)
    preview = service.preview_invoice(job_id, template_id)

    return preview


@router.post(
    "/jobs/{job_id}/reset-invoice-status",
    summary="Reset scope items invoiced status"
)
def reset_scope_items_invoice_status(
    job_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Reset all scope items' invoiced status for a job.

    Use this when:
    - An invoice was deleted outside of WM flow
    - Need to re-invoice scope items
    - Fixing inconsistent invoice status
    """
    from app.domains.water_mitigation.scope_invoice_service import (
        ScopeInvoiceService
    )

    service = ScopeInvoiceService(db)
    result = service.reset_scope_items_for_job(job_id)

    return result


@router.delete(
    "/invoices/{invoice_id}",
    summary="Delete WM invoice and reset scope items"
)
def delete_wm_invoice(
    invoice_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Delete a Water Mitigation invoice and reset scope items' invoiced status.

    This ensures scope items can be re-invoiced after deletion.
    """
    from app.domains.water_mitigation.scope_invoice_service import (
        ScopeInvoiceService
    )

    service = ScopeInvoiceService(db)
    result = service.delete_invoice_and_reset_scope(invoice_id)

    if not result.get("success"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=result.get("message", "Failed to delete invoice")
        )

    return result


# =============================================================================
# Standard Scope Item Mapping Endpoints (New Approach)
# =============================================================================

@router.get(
    "/standard-item-mappings",
    summary="Get all standard scope item invoice mappings"
)
def get_standard_scope_item_mappings(
    company_id: Optional[UUID] = Query(None, description="Filter by company (includes system-wide items)"),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Get all Standard Scope Items with their invoice line item mappings.

    This is the recommended approach for invoice configuration:
    - Configure mappings once at the standard item level
    - All jobs using these items will inherit the mappings
    - No duplicate configuration needed per scope item

    Returns:
    - List of standard items with their line item mappings
    - Items without mappings (unmapped) are also included
    """
    from app.domains.water_mitigation.invoice_config_service import (
        InvoiceConfigService
    )

    service = InvoiceConfigService(db)
    mappings = service.get_standard_scope_item_mappings(company_id)

    return {
        "items": mappings,
        "total": len(mappings),
        "mapped_count": len([m for m in mappings if m["has_mapping"]]),
        "unmapped_count": len([m for m in mappings if not m["has_mapping"]]),
    }


@router.put(
    "/standard-item-mappings/{standard_item_id}",
    summary="Update standard scope item invoice mapping"
)
def update_standard_scope_item_mapping(
    standard_item_id: UUID,
    mapping_data: dict,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Update invoice mapping for a Standard Scope Item.

    This configures how this scope item type maps to invoice line items.
    The mapping will be used for all jobs that use this standard item.

    Fields:
    - line_item_id: Reference to an existing line item
    - custom_line_item_name: Custom name (when not using existing line item)
    - custom_line_item_rate: Custom rate (when not using existing line item)
    - quantity_calc_type: 'fixed', 'per_day', or 'per_day_capped'
    - max_days: Maximum days for per_day_capped calculation
    - default_invoice_note: Note to include in invoice line item
    """
    from app.domains.water_mitigation.invoice_config_service import (
        InvoiceConfigService
    )

    service = InvoiceConfigService(db)
    result = service.update_standard_scope_item_mapping(
        standard_item_id=standard_item_id,
        line_item_id=mapping_data.get("line_item_id"),
        custom_line_item_name=mapping_data.get("custom_line_item_name"),
        custom_line_item_rate=mapping_data.get("custom_line_item_rate"),
        quantity_calc_type=mapping_data.get("quantity_calc_type"),
        max_days=mapping_data.get("max_days"),
        default_invoice_note=mapping_data.get("default_invoice_note"),
    )

    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Standard scope item not found: {standard_item_id}"
        )

    return result


@router.post(
    "/jobs/{job_id}/preview-invoice-from-mappings",
    summary="Preview invoice using standard scope item mappings"
)
def preview_invoice_from_standard_mappings(
    job_id: UUID,
    company_id: Optional[UUID] = Query(None, description="Company ID for company-specific mappings"),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Preview invoice generation using Standard Scope Item mappings.

    This is the NEW recommended approach:
    1. Aggregates quantities per item type across all locations
    2. Uses pre-configured mappings from Standard Scope Items
    3. No duplicate configurations needed

    Benefits:
    - No duplicate line item mapping per scope item
    - Consistent pricing across all jobs
    - Single point of configuration for each item type

    Returns:
    - Aggregated line items with calculated quantities
    - List of unmapped items that need configuration
    - Total and subtotal amounts
    """
    from app.domains.water_mitigation.invoice_config_service import (
        InvoiceConfigService
    )

    service = InvoiceConfigService(db)
    preview = service.generate_invoice_preview_from_standard_mappings(
        job_id, company_id
    )

    return preview


# =============================================================================
# General Conditions Template Management Endpoints
# =============================================================================

@router.get(
    "/general-conditions/status",
    summary="Get General Conditions template status"
)
def get_general_conditions_status(
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Get the status of the General Conditions template.

    Returns:
    - Whether the template exists
    - Number of line items in the template
    - List of items with their details
    """
    from app.domains.water_mitigation.invoice_config_service import (
        InvoiceConfigService
    )

    service = InvoiceConfigService(db)
    return service.get_general_conditions_template_status()


@router.post(
    "/general-conditions/seed",
    summary="Seed General Conditions template with line items"
)
def seed_general_conditions_template(
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Seed the General Conditions template with necessary line items.

    This will:
    1. Create the General Conditions template if it doesn't exist
    2. Find matching line items (Emergency service call, Hand loading disposal, Equipment monitoring)
    3. Link them to the template

    Call this endpoint if General Conditions items are not appearing in invoices.
    """
    from app.domains.water_mitigation.invoice_config_service import (
        InvoiceConfigService
    )

    service = InvoiceConfigService(db)
    return service.seed_general_conditions_template()
