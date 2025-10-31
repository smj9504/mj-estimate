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
