"""
Standard Scope Item API

REST API endpoints for managing standard/template scope items.
"""

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database_factory import get_db
from app.domains.auth.dependencies import get_current_user
from app.domains.staff.models import Staff

from .standard_scope_service import StandardScopeItemService
from .schemas import (
    StandardScopeItemCreate,
    StandardScopeItemUpdate,
    StandardScopeItemResponse,
    StandardScopeItemListResponse,
)

router = APIRouter(
    prefix="/standard-scope-items",
    tags=["Water Mitigation - Standard Scope Items"]
)


@router.get(
    "",
    response_model=StandardScopeItemListResponse,
    summary="List standard scope items"
)
def list_standard_scope_items(
    company_id: Optional[UUID] = Query(None, description="Filter by company ID"),
    item_type: Optional[str] = Query(None, description="Filter by item type"),
    category_id: Optional[UUID] = Query(None, description="Filter by category ID"),
    is_active: Optional[bool] = Query(True, description="Filter by active status"),
    search: Optional[str] = Query(None, description="Search by name"),
    include_system: bool = Query(True, description="Include system-wide items"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(50, ge=1, le=100, description="Items per page"),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    List standard scope items with filters and pagination.

    - System-wide items (company_id=NULL) are shared templates
    - Company-specific items are custom templates for that company
    - Use include_system=true to get both when filtering by company
    """
    service = StandardScopeItemService(db)
    items, total = service.list_items(
        company_id=company_id,
        item_type=item_type,
        category_id=category_id,
        is_active=is_active,
        search=search,
        include_system=include_system,
        page=page,
        page_size=page_size
    )

    return StandardScopeItemListResponse(
        items=[StandardScopeItemResponse.model_validate(item) for item in items],
        total=total,
        page=page,
        page_size=page_size
    )


@router.get(
    "/{item_id}",
    response_model=StandardScopeItemResponse,
    summary="Get a standard scope item"
)
def get_standard_scope_item(
    item_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Get a standard scope item by ID"""
    service = StandardScopeItemService(db)
    item = service.get_item(item_id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Standard scope item not found"
        )

    return StandardScopeItemResponse.model_validate(item)


@router.post(
    "",
    response_model=StandardScopeItemResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a standard scope item"
)
def create_standard_scope_item(
    data: StandardScopeItemCreate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Create a new standard scope item.

    - Set company_id=null for system-wide templates
    - Set company_id to a specific company for company-specific templates
    """
    service = StandardScopeItemService(db)
    try:
        item = service.create_item(data, created_by_id=current_user.id)
        db.commit()
        db.refresh(item)
        return StandardScopeItemResponse.model_validate(item)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.put(
    "/{item_id}",
    response_model=StandardScopeItemResponse,
    summary="Update a standard scope item"
)
def update_standard_scope_item(
    item_id: UUID,
    data: StandardScopeItemUpdate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Update a standard scope item"""
    service = StandardScopeItemService(db)
    try:
        item = service.update_item(item_id, data, updated_by_id=current_user.id)
        db.commit()
        db.refresh(item)
        return StandardScopeItemResponse.model_validate(item)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )


@router.delete(
    "/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a standard scope item"
)
def delete_standard_scope_item(
    item_id: UUID,
    hard_delete: bool = Query(False, description="Permanently delete instead of soft delete"),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Delete a standard scope item.

    - Default: Soft delete (set is_active=false)
    - hard_delete=true: Permanently remove from database
    """
    service = StandardScopeItemService(db)
    try:
        service.delete_item(item_id, hard_delete=hard_delete, deleted_by_id=current_user.id)
        db.commit()
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )


@router.post(
    "/{item_id}/restore",
    response_model=StandardScopeItemResponse,
    summary="Restore a deleted standard scope item"
)
def restore_standard_scope_item(
    item_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Restore a soft-deleted standard scope item"""
    service = StandardScopeItemService(db)
    try:
        item = service.restore_item(item_id, restored_by_id=current_user.id)
        db.commit()
        db.refresh(item)
        return StandardScopeItemResponse.model_validate(item)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )


@router.post(
    "/{item_id}/duplicate",
    response_model=StandardScopeItemResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Duplicate a standard scope item"
)
def duplicate_standard_scope_item(
    item_id: UUID,
    new_name: Optional[str] = Query(None, description="Name for the duplicate"),
    target_company_id: Optional[UUID] = Query(None, description="Company for the duplicate"),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Create a copy of an existing standard scope item.

    - Optionally specify a new name
    - Optionally specify a different target company
    """
    service = StandardScopeItemService(db)
    try:
        item = service.duplicate_item(
            item_id,
            new_name=new_name,
            target_company_id=target_company_id,
            created_by_id=current_user.id
        )
        db.commit()
        db.refresh(item)
        return StandardScopeItemResponse.model_validate(item)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post(
    "/reorder",
    response_model=List[StandardScopeItemResponse],
    summary="Reorder standard scope items"
)
def reorder_standard_scope_items(
    item_orders: List[dict],
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Reorder multiple standard scope items.

    Send a list of {id, display_order} objects to update the order.
    """
    service = StandardScopeItemService(db)
    items = service.reorder_items(item_orders, updated_by_id=current_user.id)
    db.commit()
    return [StandardScopeItemResponse.model_validate(item) for item in items]


@router.post(
    "/seed-defaults",
    response_model=List[StandardScopeItemResponse],
    summary="Seed default standard scope items"
)
def seed_default_items(
    company_id: Optional[UUID] = Query(None, description="Company to create items for"),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Seed database with default standard scope items.

    This migrates the hardcoded STANDARD_SCOPE_ITEMS to the database.
    Only creates items that don't already exist.
    """
    service = StandardScopeItemService(db)
    items = service.seed_default_items(
        company_id=company_id,
        created_by_id=current_user.id
    )
    db.commit()
    return [StandardScopeItemResponse.model_validate(item) for item in items]
