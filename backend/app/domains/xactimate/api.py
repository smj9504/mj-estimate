"""
Xactimate domain API endpoints
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database_factory import get_db
from .service import XactimateCategoryService, XactimateItemService, XactimateComponentService, XactimateUnifiedService
from .schemas import (
    XactimateCategoryResponse, XactimateCategoryCreate, XactimateCategoryUpdate,
    XactimateItemResponse, XactimateItemCreate, XactimateItemUpdate,
    XactimateComponentResponse, XactimateComponentCreate, XactimateComponentUpdate,
    XactimateSearchRequest, XactimateSearchResponse,
    UnifiedSearchRequest, UnifiedSearchResponse
)

router = APIRouter(tags=["xactimate"])


# Category endpoints
@router.get("/categories", response_model=List[XactimateCategoryResponse])
async def get_categories(db: Session = Depends(get_db)):
    """Get all Xactimate categories"""
    service = XactimateCategoryService(db)
    return service.get_all()


@router.get("/categories/{category_code}", response_model=XactimateCategoryResponse)
async def get_category(category_code: str, db: Session = Depends(get_db)):
    """Get category by code"""
    service = XactimateCategoryService(db)
    category = service.get_by_code(category_code)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    return category


@router.post("/categories", response_model=XactimateCategoryResponse)
async def create_category(category_data: XactimateCategoryCreate, db: Session = Depends(get_db)):
    """Create new Xactimate category"""
    service = XactimateCategoryService(db)
    return service.create(category_data.dict())


@router.put("/categories/{category_code}", response_model=XactimateCategoryResponse)
async def update_category(category_code: str, category_data: XactimateCategoryUpdate, db: Session = Depends(get_db)):
    """Update Xactimate category"""
    service = XactimateCategoryService(db)
    
    # Check if category exists
    existing = service.get_by_code(category_code)
    if not existing:
        raise HTTPException(status_code=404, detail="Category not found")
    
    # Update using the category_code as the identifier
    updated = service.repository.db.query(service.repository.model).filter(
        service.repository.model.category_code == category_code
    ).first()
    
    if updated:
        for key, value in category_data.dict(exclude_unset=True).items():
            setattr(updated, key, value)
        service.repository.db.commit()
        service.repository.db.refresh(updated)
        return XactimateCategoryResponse.from_orm(updated)
    
    raise HTTPException(status_code=404, detail="Category not found")


@router.delete("/categories/{category_code}")
async def delete_category(category_code: str, db: Session = Depends(get_db)):
    """Delete Xactimate category"""
    service = XactimateCategoryService(db)
    
    # Check if category exists
    existing = service.get_by_code(category_code)
    if not existing:
        raise HTTPException(status_code=404, detail="Category not found")
    
    # Delete the category
    deleted_count = service.repository.db.query(service.repository.model).filter(
        service.repository.model.category_code == category_code
    ).delete()
    
    if deleted_count == 0:
        raise HTTPException(status_code=404, detail="Category not found")
    
    service.repository.db.commit()
    return {"message": "Category deleted successfully"}


# Item endpoints
@router.get("/items/search", response_model=XactimateSearchResponse)
async def search_items(
    search_term: Optional[str] = Query(None),
    category_code: Optional[str] = Query(None),
    item_code: Optional[str] = Query(None),
    price_year: Optional[int] = Query(None),
    price_month: Optional[int] = Query(None),
    min_price: Optional[float] = Query(None),
    max_price: Optional[float] = Query(None),
    has_components: Optional[bool] = Query(None),
    include_components: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db)
):
    """Search Xactimate items with advanced filters"""
    service = XactimateItemService(db)
    
    search_request = XactimateSearchRequest(
        search_term=search_term,
        category_code=category_code,
        item_code=item_code,
        price_year=price_year,
        price_month=price_month,
        min_price=min_price,
        max_price=max_price,
        has_components=has_components,
        include_components=include_components,
        page=page,
        page_size=page_size
    )
    
    return service.search(search_request)


@router.get("/items/{item_id}", response_model=XactimateItemResponse)
async def get_item(item_id: int, include_components: bool = Query(True), db: Session = Depends(get_db)):
    """Get Xactimate item by ID"""
    service = XactimateItemService(db)
    item = service.get_by_id(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.get("/items/by-code/{item_code}", response_model=XactimateItemResponse)
async def get_item_by_code(item_code: str, include_components: bool = Query(True), db: Session = Depends(get_db)):
    """Get Xactimate item by item code"""
    service = XactimateItemService(db)
    item = service.get_by_item_code(item_code, include_components)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.get("/items/by-category/{category_code}", response_model=List[XactimateItemResponse])
async def get_items_by_category(
    category_code: str, 
    limit: int = Query(100, ge=1, le=500),
    include_components: bool = Query(False),
    db: Session = Depends(get_db)
):
    """Get Xactimate items by category"""
    service = XactimateItemService(db)
    return service.get_by_category(category_code, limit, include_components)


@router.post("/items/latest", response_model=List[XactimateItemResponse])
async def get_latest_items(item_codes: List[str], db: Session = Depends(get_db)):
    """Get latest versions of items by codes"""
    service = XactimateItemService(db)
    return service.get_latest_by_item_codes(item_codes)


@router.get("/items/history/{item_code}", response_model=List[XactimateItemResponse])
async def get_price_history(item_code: str, db: Session = Depends(get_db)):
    """Get price history for an item"""
    service = XactimateItemService(db)
    return service.get_price_history(item_code)


@router.post("/items", response_model=XactimateItemResponse)
async def create_item(item_data: XactimateItemCreate, db: Session = Depends(get_db)):
    """Create new Xactimate item with components"""
    service = XactimateItemService(db)
    return service.create_with_components(item_data)


@router.put("/items/{item_id}", response_model=XactimateItemResponse)
async def update_item(
    item_id: int, 
    item_data: XactimateItemUpdate, 
    components_data: Optional[List[XactimateComponentCreate]] = None,
    db: Session = Depends(get_db)
):
    """Update Xactimate item and optionally replace components"""
    service = XactimateItemService(db)
    updated_item = service.update_with_components(item_id, item_data, components_data)
    if not updated_item:
        raise HTTPException(status_code=404, detail="Item not found")
    return updated_item


@router.delete("/items/{item_id}")
async def delete_item(item_id: int, db: Session = Depends(get_db)):
    """Delete Xactimate item"""
    service = XactimateItemService(db)
    deleted = service.delete(item_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"message": "Item deleted successfully"}


# Component endpoints
@router.get("/items/{item_id}/components", response_model=List[XactimateComponentResponse])
async def get_item_components(item_id: int, db: Session = Depends(get_db)):
    """Get all components for an item"""
    service = XactimateComponentService(db)
    return service.get_by_item_id(item_id)


@router.get("/components/by-type/{component_type}", response_model=List[XactimateComponentResponse])
async def get_components_by_type(
    component_type: str, 
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db)
):
    """Get components by type"""
    service = XactimateComponentService(db)
    return service.get_by_type(component_type, limit)


@router.post("/items/{item_id}/components", response_model=List[XactimateComponentResponse])
async def create_item_components(
    item_id: int, 
    components_data: List[XactimateComponentCreate], 
    db: Session = Depends(get_db)
):
    """Bulk create components for an item"""
    service = XactimateComponentService(db)
    return service.bulk_create_for_item(item_id, components_data)


@router.get("/components/{component_id}", response_model=XactimateComponentResponse)
async def get_component(component_id: int, db: Session = Depends(get_db)):
    """Get component by ID"""
    service = XactimateComponentService(db)
    component = service.get_by_id(component_id)
    if not component:
        raise HTTPException(status_code=404, detail="Component not found")
    return component


@router.put("/components/{component_id}", response_model=XactimateComponentResponse)
async def update_component(
    component_id: int, 
    component_data: XactimateComponentUpdate, 
    db: Session = Depends(get_db)
):
    """Update component"""
    service = XactimateComponentService(db)
    updated_component = service.update(component_id, component_data.dict(exclude_unset=True))
    if not updated_component:
        raise HTTPException(status_code=404, detail="Component not found")
    return updated_component


@router.delete("/components/{component_id}")
async def delete_component(component_id: int, db: Session = Depends(get_db)):
    """Delete component"""
    service = XactimateComponentService(db)
    deleted = service.delete(component_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Component not found")
    return {"message": "Component deleted successfully"}


# Unified search endpoint
@router.get("/unified/search", response_model=UnifiedSearchResponse)
async def unified_search(
    search_term: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    item_type: Optional[str] = Query("ALL"),
    company_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db)
):
    """Unified search across both Xactimate and Custom line items"""
    service = XactimateUnifiedService(db)
    
    search_request = UnifiedSearchRequest(
        search_term=search_term,
        category=category,
        item_type=item_type,
        company_id=company_id,
        page=page,
        page_size=page_size
    )
    
    return service.unified_search(search_request)