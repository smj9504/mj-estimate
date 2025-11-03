"""
Reconstruction Estimate API endpoints
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database_factory import get_db
from app.domains.auth.dependencies import get_current_user
from app.domains.staff.models import Staff

from .service import MaterialCategoryService, MaterialWeightService, DebrisCalculationService
from .schemas import (
    MaterialCategoryCreate, MaterialCategoryUpdate, MaterialCategoryResponse,
    MaterialWeightCreate, MaterialWeightUpdate, MaterialWeightResponse, MaterialWeightListResponse,
    DebrisCalculationCreate, DebrisCalculationUpdate, DebrisCalculationResponse, DebrisCalculationListResponse,
    QuickCalculationRequest, DebrisCalculationResult
)

router = APIRouter(prefix="/api/reconstruction-estimate", tags=["Reconstruction Estimate"])


# Material Category Endpoints
@router.get("/categories", response_model=List[MaterialCategoryResponse])
def get_categories(
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Get all active material categories"""
    service = MaterialCategoryService(db)
    categories = service.get_all_active()
    return categories


@router.post("/categories", response_model=MaterialCategoryResponse, status_code=status.HTTP_201_CREATED)
def create_category(
    data: MaterialCategoryCreate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Create new material category (admin only)"""
    # TODO: Add admin role check
    service = MaterialCategoryService(db)
    return service.create(data, str(current_user.id) if current_user else "system")


@router.put("/categories/{category_id}", response_model=MaterialCategoryResponse)
def update_category(
    category_id: str,
    data: MaterialCategoryUpdate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Update material category (admin only)"""
    # TODO: Add admin role check
    service = MaterialCategoryService(db)
    return service.update(category_id, data, str(current_user.id) if current_user else "system")


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: str,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Delete material category (admin only)"""
    # TODO: Add admin role check
    service = MaterialCategoryService(db)
    service.delete(category_id)
    return None


# Material Weight Endpoints
@router.get("/materials", response_model=MaterialWeightListResponse)
def get_materials(
    category_id: Optional[str] = Query(None, description="Filter by category ID"),
    active_only: bool = Query(True, description="Show only active materials"),
    search: Optional[str] = Query(None, description="Search by material type or description"),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Get all materials with optional filters"""
    service = MaterialWeightService(db)
    materials = service.get_all(category_id, active_only, search)

    # Add category name to response
    response_materials = []
    for material in materials:
        material_dict = MaterialWeightResponse.model_validate(material)
        material_dict.category_name = material.category.category_name if material.category else None
        response_materials.append(material_dict)

    return MaterialWeightListResponse(
        materials=response_materials,
        total=len(response_materials)
    )


@router.get("/materials/{material_id}", response_model=MaterialWeightResponse)
def get_material(
    material_id: str,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Get material by ID"""
    service = MaterialWeightService(db)
    material = service.get_by_id(material_id)

    response = MaterialWeightResponse.model_validate(material)
    response.category_name = material.category.category_name if material.category else None
    return response


@router.post("/materials", response_model=MaterialWeightResponse, status_code=status.HTTP_201_CREATED)
def create_material(
    data: MaterialWeightCreate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Create new material (admin only)"""
    # TODO: Add admin role check
    service = MaterialWeightService(db)
    material = service.create(data, str(current_user.id) if current_user else "system")

    response = MaterialWeightResponse.model_validate(material)
    response.category_name = material.category.category_name if material.category else None
    return response


@router.put("/materials/{material_id}", response_model=MaterialWeightResponse)
def update_material(
    material_id: str,
    data: MaterialWeightUpdate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Update material (admin only)"""
    # TODO: Add admin role check
    service = MaterialWeightService(db)
    material = service.update(material_id, data, str(current_user.id) if current_user else "system")

    response = MaterialWeightResponse.model_validate(material)
    response.category_name = material.category.category_name if material.category else None
    return response


@router.delete("/materials/{material_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_material(
    material_id: str,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Delete material (admin only)"""
    # TODO: Add admin role check
    service = MaterialWeightService(db)
    service.delete(material_id, str(current_user.id) if current_user else "system")
    return None


# Debris Calculation Endpoints
@router.post("/debris/calculate", response_model=DebrisCalculationResult)
def calculate_debris_quick(
    data: QuickCalculationRequest,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Quick debris calculation without saving"""
    service = DebrisCalculationService(db)
    return service.calculate_quick(data.items)


@router.post("/debris/calculations", response_model=DebrisCalculationResponse, status_code=status.HTTP_201_CREATED)
def create_debris_calculation(
    data: DebrisCalculationCreate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Save a debris calculation"""
    service = DebrisCalculationService(db)
    return service.create_calculation(data, str(current_user.id) if current_user else "system")


@router.get("/debris/calculations", response_model=DebrisCalculationListResponse)
def get_debris_calculations(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Get user's saved debris calculations"""
    service = DebrisCalculationService(db)
    calculations, total = service.get_user_calculations(
        str(current_user.id) if current_user else "system",
        limit,
        offset
    )

    return DebrisCalculationListResponse(
        calculations=calculations,
        total=total
    )


@router.get("/debris/calculations/{calculation_id}", response_model=DebrisCalculationResponse)
def get_debris_calculation(
    calculation_id: str,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Get a specific debris calculation"""
    service = DebrisCalculationService(db)
    return service.get_calculation(
        calculation_id,
        str(current_user.id) if current_user else "system"
    )


@router.put("/debris/calculations/{calculation_id}", response_model=DebrisCalculationResponse)
def update_debris_calculation(
    calculation_id: str,
    data: DebrisCalculationUpdate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Update a saved debris calculation"""
    service = DebrisCalculationService(db)
    return service.update_calculation(
        calculation_id,
        data,
        str(current_user.id) if current_user else "system"
    )


@router.delete("/debris/calculations/{calculation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_debris_calculation(
    calculation_id: str,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Delete a debris calculation"""
    service = DebrisCalculationService(db)
    service.delete_calculation(
        calculation_id,
        str(current_user.id) if current_user else "system"
    )
    return None


# Database Seeding Endpoint (Admin only)
@router.post("/admin/seed-materials")
def seed_materials_database(
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Seed database with comprehensive residential construction materials (Admin only)"""
    from .seed_materials import seed_materials

    try:
        stats = seed_materials(db)
        db.commit()
        return {
            "success": True,
            "message": "Materials database seeded successfully",
            "stats": stats
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to seed materials: {str(e)}"
        )
