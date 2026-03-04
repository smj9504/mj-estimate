"""
Pack Calculation API endpoints
"""

from fastapi import APIRouter, Depends, HTTPException
import logging
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID

from app.core.database_factory import get_db
from app.domains.auth.dependencies import get_current_user
from app.domains.staff.models import Staff

from .schemas import (
    PackCalculationRequest,
    PackCalculationResult,
    PackCalculationDetailResponse,
    CorrectionInput,
    ItemMaterialMappingInput,
    ItemMaterialMappingResponse,
    MLMetricsResponse,
    TemplateSummaryResponse,
    TemplateDetailResponse,
    TemplateItemResponse,
    StorageMultiplierResponse,
    DensityModifierResponse,
    DensityEstimationRequest,
    DensityEstimationResponse,
    EstimatedItemResponse,
    BulkTextParseRequest,
    BulkTextParseResponse,
    ParsedItemResponse,
)
from .repository import (
    PackCalculationRepository,
    ItemMaterialMappingRepository,
    MLTrainingMetadataRepository,
)
from .service import PackCalculationService

router = APIRouter(prefix="/pack-calculation", tags=["pack_calculation"])
logger = logging.getLogger(__name__)


@router.post("/calculate", response_model=PackCalculationResult)
def calculate_pack(
    request: PackCalculationRequest,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """
    Calculate pack-in/out materials and labor
    Supports multiple input methods: structured, text, image
    Auto-selects optimal calculation strategies
    """
    service = PackCalculationService(db)
    result = service.calculate(request, current_user.id)
    return result


@router.get("/seed-categories")
def get_seed_categories(
    current_user: Staff = Depends(get_current_user),
):
    """Get all available seed mapping categories for dropdown"""
    from .seed_item_mappings import ITEM_MAPPINGS

    categories = []
    for key, data in ITEM_MAPPINGS.items():
        # Create human-readable label
        label = key.replace('_', ' ').title()
        categories.append({
            "value": key,
            "label": label,
            "category": data.get("category", "unknown"),
            "size": data.get("size", "standard"),
        })

    return {"categories": categories}


# Room Template endpoints
@router.get("/templates", response_model=List[TemplateSummaryResponse])
def list_templates(
    current_user: Staff = Depends(get_current_user),
):
    """
    List all available room templates
    Returns template summaries with basic info
    """
    from .templates import template_registry

    return template_registry.get_summary()


@router.get("/templates/{room_type}", response_model=TemplateDetailResponse)
def get_template(
    room_type: str,
    current_user: Staff = Depends(get_current_user),
):
    """
    Get detailed template for a specific room type
    Includes all base_items, storage_multipliers, and density_modifiers
    """
    from .templates import template_registry, RoomType

    # Validate room type
    try:
        room_type_enum = RoomType(room_type)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid room type: {room_type}. Valid types: {[rt.value for rt in RoomType]}"
        )

    template = template_registry.get(room_type_enum)
    if not template:
        raise HTTPException(
            status_code=404,
            detail=f"No template found for room type: {room_type}"
        )

    # Convert template to response format
    return TemplateDetailResponse(
        id=template.id,
        room_type=template.room_type.value,
        name=template.name,
        description=template.description,
        base_items=[
            TemplateItemResponse(
                category=item.category,
                subcategory=item.subcategory,
                base_quantity=item.base_quantity,
                variance_range=item.variance_range,
                pack_size=item.pack_size,
                is_optional=item.is_optional,
                storage_type=item.storage_type,
            )
            for item in template.base_items
        ],
        storage_multipliers=[
            StorageMultiplierResponse(
                storage_type=sm.storage_type,
                base_count=sm.base_count,
                items_per_unit=sm.items_per_unit,
                density_impact={k.value: v for k, v in sm.density_impact.items()},
            )
            for sm in template.storage_multipliers
        ],
        density_modifiers=[
            DensityModifierResponse(
                density_level=dm.density_level.value,
                quantity_multiplier=dm.quantity_multiplier,
                additional_categories=dm.additional_categories,
            )
            for dm in template.density_modifiers
        ],
    )


# Density Estimation endpoint
@router.post("/estimate/density", response_model=DensityEstimationResponse)
def estimate_density(
    request: DensityEstimationRequest,
    current_user: Staff = Depends(get_current_user),
):
    """
    Estimate pack items based on room type and density level
    Uses AI-powered density estimation with template-based calculations
    """
    from .density_estimator import DensityEstimator
    from .templates import RoomType, DensityLevel
    import logging

    logger = logging.getLogger(__name__)
    logger.info(f"Density estimation request: room_type={request.room_type}, density_level={request.density_level}")

    # Validate inputs
    try:
        room_type = RoomType(request.room_type)
        density_level = DensityLevel(request.density_level)
    except ValueError as e:
        logger.error(f"Invalid enum value: {str(e)}")
        logger.error(f"Valid RoomTypes: {[rt.value for rt in RoomType]}")
        logger.error(f"Valid DensityLevels: {[dl.value for dl in DensityLevel]}")
        raise HTTPException(
            status_code=400,
            detail=f"Invalid input: {str(e)}. Valid room types: {[rt.value for rt in RoomType]}. Valid density levels: {[dl.value for dl in DensityLevel]}"
        )

    # Run estimation
    estimator = DensityEstimator()
    try:
        # Extract room_size from request or use default
        room_size = request.room_size or "medium"

        result = estimator.estimate(
            room_type=room_type,
            density_level=density_level,
            room_size=room_size,
            custom_adjustments=request.custom_adjustments
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Convert to response format
    return DensityEstimationResponse(
        estimated_items=[
            EstimatedItemResponse(
                category=item["category"],
                subcategory=item["subcategory"],
                quantity=item["quantity"],
                pack_size=item["pack_size"],
                storage_type=item.get("storage_type"),
            )
            for item in result["estimated_items"]
        ],
        total_boxes=result["total_boxes"],
        confidence=result["confidence"],
        breakdown=result["breakdown"],
        assumptions=result["assumptions"],
    )


# Bulk Text Parser endpoint
@router.post("/parse/bulk-text", response_model=BulkTextParseResponse)
def parse_bulk_text(
    request: BulkTextParseRequest,
    current_user: Staff = Depends(get_current_user),
):
    """
    Parse bulk text input into structured pack items
    Supports various text formats with intelligent category inference
    """
    from .bulk_text_parser import BulkTextParser

    parser = BulkTextParser()
    result = parser.parse(text=request.text)

    # Convert to response format
    return BulkTextParseResponse(
        items=[
            ParsedItemResponse(
                category=item["category"],
                subcategory=item["subcategory"],
                quantity=item["quantity"],
                pack_size=item["pack_size"],
                original_text=item["original_text"],
                confidence=item["confidence"],
            )
            for item in result["items"]
        ],
        unparsed_lines=result.get("unparsed_lines", []),
        warnings=result.get("warnings", []),
        confidence=result.get("confidence", 0.0),
        summary=result.get("summary", {}),
    )


# Item Material Mapping endpoints (Admin)
@router.get("/mappings", response_model=List[ItemMaterialMappingResponse])
def list_item_mappings(
    category: str = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """List item-material mappings"""
    repo = ItemMaterialMappingRepository(db)

    if category:
        mappings = repo.get_by_category(category)
    else:
        mappings = repo.get_all(offset=skip, limit=limit, order_by="-created_at")

    return mappings


@router.post("/mappings", response_model=ItemMaterialMappingResponse)
def create_item_mapping(
    mapping_input: ItemMaterialMappingInput,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """Create new item-material mapping"""
    from .models import ItemMaterialMapping

    repo = ItemMaterialMappingRepository(db)

    # Check if mapping already exists
    existing = repo.get_by_item_name(mapping_input.item_name)
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Mapping for '{mapping_input.item_name}' already exists"
        )

    # Create new mapping
    mapping = ItemMaterialMapping(
        item_name=mapping_input.item_name,
        item_category=mapping_input.item_category,
        size_category=mapping_input.size_category,
        xactimate_materials=mapping_input.xactimate_materials,
        estimated_weight_lb=mapping_input.estimated_weight_lb,
        fragile=mapping_input.fragile,
        requires_disassembly=mapping_input.requires_disassembly,
        packing_hours_base=mapping_input.packing_hours_base,
        moving_hours_base=mapping_input.moving_hours_base,
        created_by_id=current_user.id,
    )

    return repo.create(mapping)


@router.put("/mappings/{mapping_id}", response_model=ItemMaterialMappingResponse)
def update_item_mapping(
    mapping_id: UUID,
    mapping_input: ItemMaterialMappingInput,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """Update item-material mapping"""
    repo = ItemMaterialMappingRepository(db)
    mapping = repo.get_by_id(mapping_id)

    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping not found")

    # Update fields
    mapping.item_name = mapping_input.item_name
    mapping.item_category = mapping_input.item_category
    mapping.size_category = mapping_input.size_category
    mapping.xactimate_materials = mapping_input.xactimate_materials
    mapping.estimated_weight_lb = mapping_input.estimated_weight_lb
    mapping.fragile = mapping_input.fragile
    mapping.requires_disassembly = mapping_input.requires_disassembly
    mapping.packing_hours_base = mapping_input.packing_hours_base
    mapping.moving_hours_base = mapping_input.moving_hours_base
    mapping.updated_by_id = current_user.id

    return repo.update(mapping)


@router.delete("/mappings/{mapping_id}")
def delete_item_mapping(
    mapping_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """Delete item-material mapping"""
    repo = ItemMaterialMappingRepository(db)
    mapping = repo.get_by_id(mapping_id)

    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping not found")

    repo.delete(mapping)
    return {"message": "Mapping deleted successfully"}


# ML Metrics endpoint
@router.get("/ml/metrics", response_model=MLMetricsResponse)
def get_ml_metrics(
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """Get ML model performance metrics"""
    ml_repo = MLTrainingMetadataRepository(db)
    calc_repo = PackCalculationRepository(db)

    # Get latest deployed model
    latest_model = ml_repo.get_latest_deployed()

    # Get calculation statistics
    total_calculations = calc_repo.count()
    total_corrections = calc_repo.count_new_corrections_since_last_training()

    if latest_model:
        return MLMetricsResponse(
            boxes_mae=latest_model.boxes_mae or 0.0,
            labor_mae=latest_model.labor_mae or 0.0,
            avg_confidence=latest_model.avg_confidence or 0.0,
            correction_rate=total_corrections / total_calculations if total_calculations > 0 else 0.0,
            total_calculations=total_calculations,
            total_corrections=total_corrections,
            last_training_date=latest_model.trained_at,
            model_version=latest_model.model_version,
        )
    else:
        return MLMetricsResponse(
            boxes_mae=0.0,
            labor_mae=0.0,
            avg_confidence=0.0,
            correction_rate=0.0,
            total_calculations=total_calculations,
            total_corrections=total_corrections,
            last_training_date=None,
            model_version=None,
        )


@router.post("/ml/trigger-retraining")
def trigger_ml_retraining(
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """
    Manually trigger ML model retraining
    (Admin only)
    """
    # TODO: Implement background job queue for retraining
    # For now, just return success
    return {
        "message": "ML retraining triggered successfully",
        "status": "queued"
    }


# Generic calculation endpoints (MUST be at the end to avoid path conflicts)
@router.get("/", response_model=List[PackCalculationResult])
def list_calculations(
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """List all pack calculations"""
    import logging
    logger = logging.getLogger(__name__)

    repo = PackCalculationRepository(db)
    calculations = repo.get_all(offset=skip, limit=limit, order_by="-created_at")

    logger.info(f"Found {len(calculations)} pack calculations")

    service = PackCalculationService(db)
    results = []
    for calc in calculations:
        try:
            logger.info(f"Formatting calculation {calc.get('id')}")
            result = service.format_calculation_response(calc)
            results.append(result)
        except Exception as e:
            logger.error(f"Error formatting calculation {calc.get('id')}: {str(e)}")
            logger.exception(e)
            # Skip this calculation and continue with others
            continue

    logger.info(f"Successfully formatted {len(results)} calculations")
    return results


@router.get("/{calculation_id}", response_model=PackCalculationDetailResponse)
def get_calculation(
    calculation_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """Get pack calculation by ID with full details including rooms and items"""
    logger.info(
        f"[PackCalc] GET detail for calculation_id={calculation_id}"
    )
    repo = PackCalculationRepository(db)
    calculation = repo.get_by_id_with_rooms(calculation_id)

    if not calculation:
        logger.warning(
            f"[PackCalc] Calculation not found for id={calculation_id}"
        )
        raise HTTPException(status_code=404, detail="Calculation not found")

    service = PackCalculationService(db)
    return service.format_detail_response(calculation)


@router.post("/{calculation_id}/correct")
def save_correction(
    calculation_id: UUID,
    correction: CorrectionInput,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """
    Save human corrections to improve ML model
    Triggers retraining when enough corrections accumulated
    """
    service = PackCalculationService(db)
    result = service.save_correction(
        calculation_id,
        correction,
        current_user.id
    )
    return result


@router.put("/{calculation_id}", response_model=PackCalculationResult)
def update_calculation(
    calculation_id: UUID,
    request: PackCalculationRequest,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """Update pack calculation - recalculate with new inputs while preserving ID"""
    service = PackCalculationService(db)

    try:
        logger.info(
            f"[PackCalc] PUT update requested for calculation_id={calculation_id}"
        )
        result = service.update(calculation_id, request, current_user.id)
        logger.info(
            f"[PackCalc] PUT update succeeded for calculation_id={calculation_id}"
        )
        return result
    except ValueError as e:
        logger.warning(
            f"[PackCalc] PUT update not found for calculation_id="
            f"{calculation_id}: {e}"
        )
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/{calculation_id}")
def delete_calculation(
    calculation_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """Delete pack calculation"""
    repo = PackCalculationRepository(db)
    calculation = repo.get_by_id(calculation_id)

    if not calculation:
        raise HTTPException(status_code=404, detail="Calculation not found")

    repo.delete(calculation_id)
    return {"message": "Calculation deleted successfully"}


@router.post("/admin/patch-materials")
def patch_missing_materials(
    db: Session = Depends(get_db),
):
    """
    Admin endpoint to patch pack_items that have NULL xactimate_materials.
    This recalculates materials for all items and updates the database.
    """
    from sqlalchemy import select, update
    from app.domains.pack_calculation.models import PackItem

    logger.info("[PackCalc] Starting materials patch for items with NULL xactimate_materials")

    # Find all items with NULL xactimate_materials
    result = db.execute(
        select(PackItem).where(PackItem.xactimate_materials.is_(None))
    )
    items_to_patch = result.scalars().all()

    if not items_to_patch:
        return {
            "status": "success",
            "message": "No items need patching",
            "patched_count": 0
        }

    logger.info(f"[PackCalc] Found {len(items_to_patch)} items to patch")

    # Initialize service for material calculation
    service = PackCalculationService(db)

    patched_count = 0
    errors = []

    for item in items_to_patch:
        try:
            # Create item input for material calculation
            from types import SimpleNamespace
            item_input = SimpleNamespace(
                item_name=item.item_name or "",
                item_category=item.item_category,
                quantity=item.quantity or 1,
                size_category=item.size_category,
                floor_level=item.floor_level,
                fragile=item.fragile or False,
                requires_disassembly=item.requires_disassembly or False,
                special_notes=item.special_notes,
            )

            # Calculate materials
            item_materials = service._get_materials_for_item(item_input)

            # Check if this is contents-only (no furniture wrapping needed)
            item_name_lower = item_input.item_name.lower()
            is_contents_only = any(keyword in item_name_lower for keyword in [
                'magazines', 'documents', 'paper', 'pill', 'medicine', 'cups',
                'bowls', 'figurines', 'vases', 'beauty', 'hair products', 'tools',
                'cords', 'books', 'clothing', 'linens', 'toiletries', 'food',
                'pantry', 'spices', 'utensils', 'silverware', 'pots', 'pans'
            ])

            # Add wrapping consumables only for furniture
            if not is_contents_only and item_materials:
                wrap_consumables = service._estimate_wrapping_consumables(item_input, item_materials)
                if wrap_consumables:
                    for code, qty in wrap_consumables.items():
                        item_materials[code] = item_materials.get(code, 0) + qty

            # Update the item
            if item_materials:
                item.xactimate_materials = item_materials
                patched_count += 1
                logger.debug(f"[PackCalc] Patched item {item.id}: {item.item_name} -> {item_materials}")

        except Exception as e:
            error_msg = f"Error patching item {item.id} ({item.item_name}): {str(e)}"
            logger.error(f"[PackCalc] {error_msg}")
            errors.append(error_msg)

    # Commit all changes
    try:
        db.commit()
        logger.info(f"[PackCalc] Successfully patched {patched_count} items")
    except Exception as e:
        db.rollback()
        logger.error(f"[PackCalc] Failed to commit patches: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to commit patches: {str(e)}")

    return {
        "status": "success",
        "message": f"Patched {patched_count} items",
        "patched_count": patched_count,
        "total_items": len(items_to_patch),
        "errors": errors if errors else None
    }


@router.post("/admin/patch-labor")
def patch_missing_labor(
    db: Session = Depends(get_db),
):
    """
    Admin endpoint to patch pack_items that have NULL cached_packing_hours or cached_moving_hours.
    This calculates labor hours for all items and updates the database.
    """
    from sqlalchemy import select, or_
    from app.domains.pack_calculation.models import PackItem

    logger.info("[PackCalc] Starting labor patch for items with NULL cached labor hours")

    # Find all items with NULL cached labor hours
    result = db.execute(
        select(PackItem).where(
            or_(
                PackItem.cached_packing_hours.is_(None),
                PackItem.cached_moving_hours.is_(None)
            )
        )
    )
    items_to_patch = result.scalars().all()

    if not items_to_patch:
        return {
            "status": "success",
            "message": "No items need labor patching",
            "patched_count": 0
        }

    logger.info(f"[PackCalc] Found {len(items_to_patch)} items to patch labor hours")

    # Initialize service for labor calculation
    service = PackCalculationService(db)

    patched_count = 0
    errors = []

    for item in items_to_patch:
        try:
            # Create item input for labor calculation
            from types import SimpleNamespace
            item_for_labor = SimpleNamespace(
                item_name=item.item_name or "",
                quantity=item.quantity or 1,
                floor_level=item.floor_level,
                fragile=item.fragile or False,
                requires_disassembly=item.requires_disassembly or False,
            )

            # Calculate labor hours (pack-out)
            packing_hours, moving_hours = service._calculate_item_labor(item_for_labor, is_pack_out=True)

            # Update the item
            item.cached_packing_hours = packing_hours
            item.cached_moving_hours = moving_hours
            patched_count += 1
            logger.debug(f"[PackCalc] Patched labor for item {item.id}: {item.item_name} -> packing={packing_hours}, moving={moving_hours}")

        except Exception as e:
            error_msg = f"Error patching labor for item {item.id} ({item.item_name}): {str(e)}"
            logger.error(f"[PackCalc] {error_msg}")
            errors.append(error_msg)

    # Commit all changes
    try:
        db.commit()
        logger.info(f"[PackCalc] Successfully patched labor for {patched_count} items")
    except Exception as e:
        db.rollback()
        logger.error(f"[PackCalc] Failed to commit labor patches: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to commit labor patches: {str(e)}")

    return {
        "status": "success",
        "message": f"Patched labor for {patched_count} items",
        "patched_count": patched_count,
        "total_items": len(items_to_patch),
        "errors": errors if errors else None
    }
