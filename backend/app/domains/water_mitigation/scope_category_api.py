"""
Scope Item Category API

REST API endpoints for managing scope item categories.
"""

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database_factory import get_db
from app.domains.auth.dependencies import get_current_user
from app.domains.staff.models import Staff

from .scope_category_service import ScopeItemCategoryService
from .schemas import (
    ScopeItemCategoryCreate,
    ScopeItemCategoryUpdate,
    ScopeItemCategoryResponse,
    ScopeItemCategoryListResponse,
)

router = APIRouter(
    prefix="/scope-item-categories",
    tags=["Water Mitigation - Scope Item Categories"]
)


@router.get(
    "",
    response_model=ScopeItemCategoryListResponse,
    summary="List scope item categories"
)
def list_categories(
    company_id: Optional[UUID] = Query(None, description="Filter by company ID"),
    is_active: Optional[bool] = Query(True, description="Filter by active status"),
    search: Optional[str] = Query(None, description="Search by name"),
    include_system: bool = Query(True, description="Include system-wide categories"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(50, ge=1, le=100, description="Items per page"),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    List scope item categories with filters and pagination.

    - System-wide categories (company_id=NULL) are shared templates
    - Company-specific categories are custom for that company
    - Use include_system=true to get both when filtering by company
    """
    service = ScopeItemCategoryService(db)
    items, total = service.list_categories(
        company_id=company_id,
        is_active=is_active,
        search=search,
        include_system=include_system,
        page=page,
        page_size=page_size
    )

    return ScopeItemCategoryListResponse(
        items=[ScopeItemCategoryResponse.model_validate(item) for item in items],
        total=total,
        page=page,
        page_size=page_size
    )


@router.get(
    "/{category_id}",
    response_model=ScopeItemCategoryResponse,
    summary="Get a scope item category"
)
def get_category(
    category_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Get a scope item category by ID"""
    service = ScopeItemCategoryService(db)
    category = service.get_category(category_id)

    if not category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found"
        )

    return ScopeItemCategoryResponse.model_validate(category)


@router.post(
    "",
    response_model=ScopeItemCategoryResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a scope item category"
)
def create_category(
    data: ScopeItemCategoryCreate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Create a new scope item category.

    - Set company_id=null for system-wide categories
    - Set company_id to a specific company for company-specific categories
    """
    service = ScopeItemCategoryService(db)
    try:
        category = service.create_category(data, created_by_id=current_user.id)
        db.commit()
        db.refresh(category)
        return ScopeItemCategoryResponse.model_validate(category)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.put(
    "/{category_id}",
    response_model=ScopeItemCategoryResponse,
    summary="Update a scope item category"
)
def update_category(
    category_id: UUID,
    data: ScopeItemCategoryUpdate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Update a scope item category"""
    service = ScopeItemCategoryService(db)
    try:
        category = service.update_category(category_id, data, updated_by_id=current_user.id)
        db.commit()
        db.refresh(category)
        return ScopeItemCategoryResponse.model_validate(category)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )


@router.delete(
    "/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a scope item category"
)
def delete_category(
    category_id: UUID,
    hard_delete: bool = Query(False, description="Permanently delete instead of soft delete"),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Delete a scope item category.

    - Default: Soft delete (set is_active=false)
    - hard_delete=true: Permanently remove from database
    """
    service = ScopeItemCategoryService(db)
    try:
        service.delete_category(category_id, hard_delete=hard_delete, deleted_by_id=current_user.id)
        db.commit()
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )


@router.post(
    "/{category_id}/restore",
    response_model=ScopeItemCategoryResponse,
    summary="Restore a deleted scope item category"
)
def restore_category(
    category_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Restore a soft-deleted scope item category"""
    service = ScopeItemCategoryService(db)
    try:
        category = service.restore_category(category_id, restored_by_id=current_user.id)
        db.commit()
        db.refresh(category)
        return ScopeItemCategoryResponse.model_validate(category)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )


@router.post(
    "/{category_id}/duplicate",
    response_model=ScopeItemCategoryResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Duplicate a scope item category"
)
def duplicate_category(
    category_id: UUID,
    new_name: Optional[str] = Query(None, description="Name for the duplicate"),
    target_company_id: Optional[UUID] = Query(None, description="Company for the duplicate"),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Create a copy of an existing scope item category.

    - Optionally specify a new name
    - Optionally specify a different target company
    """
    service = ScopeItemCategoryService(db)
    try:
        category = service.duplicate_category(
            category_id,
            new_name=new_name,
            target_company_id=target_company_id,
            created_by_id=current_user.id
        )
        db.commit()
        db.refresh(category)
        return ScopeItemCategoryResponse.model_validate(category)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post(
    "/reorder",
    response_model=List[ScopeItemCategoryResponse],
    summary="Reorder scope item categories"
)
def reorder_categories(
    category_orders: List[dict],
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Reorder multiple scope item categories.

    Send a list of {id, display_order} objects to update the order.
    """
    service = ScopeItemCategoryService(db)
    categories = service.reorder_categories(category_orders, updated_by_id=current_user.id)
    db.commit()
    return [ScopeItemCategoryResponse.model_validate(cat) for cat in categories]


@router.post(
    "/seed-defaults",
    response_model=List[ScopeItemCategoryResponse],
    summary="Seed default scope item categories"
)
def seed_default_categories(
    company_id: Optional[UUID] = Query(None, description="Company to create categories for"),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Seed database with default scope item categories.

    Only creates categories that don't already exist.
    """
    service = ScopeItemCategoryService(db)
    categories = service.seed_default_categories(
        company_id=company_id,
        created_by_id=current_user.id
    )
    db.commit()
    return [ScopeItemCategoryResponse.model_validate(cat) for cat in categories]
