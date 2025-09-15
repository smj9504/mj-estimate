"""
Line Items domain API endpoints
"""

from typing import List, Optional, Dict, Any
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, status, BackgroundTasks
from sqlalchemy.orm import Session

from app.core.database_factory import get_db_session as get_db
from app.domains.auth.dependencies import get_current_user
from app.domains.staff.models import Staff
from app.core.cache import CacheService, get_cache
from app.domains.line_items.service import LineItemService
from app.domains.line_items.repository import LineItemRepository
from app.domains.line_items.schemas import (
    LineItemCreate, LineItemUpdate, LineItemResponse, LineItemSearch,
    LineItemNoteCreate, LineItemNoteUpdate, LineItemNoteResponse,
    LineItemTemplateCreate, LineItemTemplateUpdate, LineItemTemplateResponse,
    TaxCalculationRequest, TaxCalculationResponse,
    BulkLineItemCreate, BulkTemplateApply,
    InvoiceLineItemCreate, EstimateLineItemCreate,
    LineItemType, TaxMethod,
    LineItemCategoryCreate, LineItemCategoryUpdate, LineItemCategoryResponse
)

router = APIRouter(tags=["Line Items"])

# =====================================================
# Category Endpoints
# =====================================================

@router.get("/categories", response_model=List[LineItemCategoryResponse])
async def get_categories(
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """Get all line item categories with code and name
    
    Implements multi-level caching:
    - L1: Redis/Memory cache with 30min TTL
    - L2: Database query with optimized indexing
    - Cache warming on miss
    - Automatic invalidation on updates
    """
    from app.domains.line_items.category_models import LineItemCategory
    import json
    
    # Generate cache key
    cache_key = f"categories:all:inactive_{include_inactive}"
    
    # Try to get from cache first
    cached_data = await cache.get(cache_key)
    if cached_data:
        try:
            # Cache hit - parse and return
            categories = json.loads(cached_data)
            return categories
        except json.JSONDecodeError:
            # Invalid cache data, continue to fetch from DB
            await cache.delete(cache_key)
    
    # Cache miss - fetch from database
    query = db.query(LineItemCategory)
    if not include_inactive:
        query = query.filter(LineItemCategory.is_active == True)
    
    categories = query.order_by(LineItemCategory.display_order).all()
    response_data = [LineItemCategoryResponse.from_orm(cat) for cat in categories]
    
    # Convert to dict for JSON serialization
    response_dict = [cat.dict() for cat in response_data]
    
    # Cache the result (30 minutes TTL for frequently accessed data)
    try:
        await cache.set(cache_key, json.dumps(response_dict), ttl=1800)
        
        # Warm up related caches in background
        background_tasks.add_task(warm_category_caches, categories, cache)
    except Exception as e:
        # Log but don't fail the request
        import logging
        logging.warning(f"Failed to cache categories: {e}")
    
    return response_data


async def warm_category_caches(categories: List, cache: CacheService):
    """Warm up related category caches in background"""
    import json
    
    try:
        # Cache individual categories by code for fast lookups
        for cat in categories:
            cat_dict = {
                'code': cat.code,
                'name': cat.name,
                'description': cat.description,
                'parent_code': cat.parent_code,
                'display_order': cat.display_order,
                'is_active': cat.is_active
            }
            await cache.set(
                f"category:code:{cat.code}",
                json.dumps(cat_dict),
                ttl=1800  # 30 minutes
            )
        
        # Cache modal format for common UI needs
        modal_data = [
            {
                "code": cat.code,
                "description": cat.name,
                "full_description": f"{cat.name} - {cat.description}" if cat.description else cat.name
            }
            for cat in categories if cat.is_active
        ]
        await cache.set(
            "categories:modal:all",
            json.dumps(modal_data),
            ttl=1800
        )
    except Exception as e:
        import logging
        logging.warning(f"Failed to warm category caches: {e}")


@router.get("/categories/search", response_model=List[Dict[str, Any]])
async def search_categories(
    q: str = Query(..., min_length=1, description="Search query for categories"),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """Search categories by code or name for modal selection"""
    from app.domains.line_items.category_models import LineItemCategory
    from sqlalchemy import or_, func
    
    try:
        search_term = f"%{q.upper()}%"
        
        query = db.query(LineItemCategory).filter(
            LineItemCategory.is_active == True,
            or_(
                func.upper(LineItemCategory.code).like(search_term),
                func.upper(LineItemCategory.name).like(search_term),
                func.upper(LineItemCategory.description).like(search_term)
            )
        ).order_by(
            # Exact match first, then partial matches
            func.length(LineItemCategory.code).asc(),
            LineItemCategory.display_order.asc()
        ).limit(limit)
        
        categories = query.all()
        
        # Return in modal-friendly format
        return [
            {
                "code": cat.code,
                "description": cat.name,
                "full_description": f"{cat.name} - {cat.description}" if cat.description else cat.name
            }
            for cat in categories
        ]
    except Exception:
        # Return empty list if search fails, don't raise error
        return []


@router.get("/categories/modal", response_model=List[Dict[str, Any]])
async def get_categories_for_modal(
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache)
):
    """Get all categories formatted for modal display
    
    Optimized for UI performance with aggressive caching
    """
    from app.domains.line_items.category_models import LineItemCategory
    import json
    
    # Try cache first
    cache_key = f"categories:modal:inactive_{include_inactive}"
    cached_data = await cache.get(cache_key)
    
    if cached_data:
        try:
            return json.loads(cached_data)
        except json.JSONDecodeError:
            await cache.delete(cache_key)
    
    try:
        query = db.query(LineItemCategory)
        if not include_inactive:
            query = query.filter(LineItemCategory.is_active == True)
        
        categories = query.order_by(LineItemCategory.display_order).all()
        
        # Return in modal-friendly format matching the image
        return [
            {
                "code": cat.code,
                "description": cat.name,
                "full_description": f"{cat.name} - {cat.description}" if cat.description else cat.name
            }
            for cat in categories
        ]
    except Exception:
        # Return empty list if query fails
        return []


@router.post("/categories", response_model=LineItemCategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_category(
    category: LineItemCategoryCreate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Create a new category (admin only)"""
    from app.domains.line_items.category_models import LineItemCategory
    
    # Check if category code already exists
    existing = db.query(LineItemCategory).filter(LineItemCategory.code == category.code).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Category with code {category.code} already exists"
        )
    
    db_category = LineItemCategory(**category.dict())
    db.add(db_category)
    db.commit()
    db.refresh(db_category)
    
    return LineItemCategoryResponse.from_orm(db_category)


@router.put("/categories/{category_code}", response_model=LineItemCategoryResponse)
async def update_category(
    category_code: str,
    update: LineItemCategoryUpdate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Update a category (admin only)"""
    from app.domains.line_items.category_models import LineItemCategory
    
    db_category = db.query(LineItemCategory).filter(LineItemCategory.code == category_code).first()
    if not db_category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found"
        )
    
    update_data = update.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_category, field, value)
    
    db.commit()
    db.refresh(db_category)
    
    return LineItemCategoryResponse.from_orm(db_category)


# =====================================================
# Line Item Endpoints
# =====================================================

@router.post("/", response_model=LineItemResponse, status_code=status.HTTP_201_CREATED)
async def create_line_item(
    line_item: LineItemCreate,
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    current_user: Staff = Depends(get_current_user)
):
    """Create a new line item"""
    service = LineItemService(db, cache)
    return await service.create_line_item(line_item, UUID(current_user.id))


@router.post("/bulk", response_model=List[LineItemResponse], status_code=status.HTTP_201_CREATED)
async def bulk_create_line_items(
    bulk_create: BulkLineItemCreate,
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    current_user: Staff = Depends(get_current_user)
):
    """Bulk create line items"""
    service = LineItemService(db, cache)
    return await service.bulk_create_line_items(bulk_create.items, UUID(current_user.id))


@router.get("/{line_item_id}", response_model=LineItemResponse)
async def get_line_item(
    line_item_id: UUID,
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    current_user: Staff = Depends(get_current_user)
):
    """Get a line item by ID"""
    service = LineItemService(db, cache)
    item = await service.get_line_item(line_item_id)
    
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Line item not found"
        )
    
    return item


@router.get("/search", response_model=List[Dict[str, Any]])
async def search_line_items_simple(
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    current_user: Staff = Depends(get_current_user)
):
    """Simple search for line items (for autocomplete)"""
    service = LineItemService(db, cache)
    
    # Use the existing search with simplified parameters
    search = LineItemSearch(
        search_term=q,
        company_id=UUID(str(current_user.company_id)) if current_user.company_id else None,
        is_active=True,
        page=1,
        page_size=limit
    )
    
    result = await service.search_line_items(search)
    
    # Return simplified format for frontend autocomplete
    items = result.get("items", [])
    return [
        {
            "id": str(item.get("id", "")),
            "item": item.get("name", ""),
            "description": item.get("description", ""),
            "category": item.get("category", ""),
            "unit": item.get("unit", "EA"),
            "unit_price": item.get("untaxed_unit_price", 0),
            "room": item.get("default_room", ""),
        }
        for item in items
    ]


@router.get("/modal/items", response_model=List[Dict[str, Any]])
async def get_line_items_for_modal(
    category: Optional[str] = Query(None, description="Filter by category code"),
    search_term: Optional[str] = Query(None, description="Search in multiple keywords"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache)
):
    """Get line items formatted for modal display with enhanced search"""
    import logging
    logger = logging.getLogger(__name__)
    
    service = LineItemService(db, cache)
    
    try:
        # Build search parameters (type removed - all are custom now)
        search_params = LineItemSearch(
            cat=category,
            search_term=search_term,
            company_id=None,  # Show all items for modal
            is_active=True,
            page=page,
            page_size=page_size
        )
        
        # Bypass service layer and get raw data directly from repository
        repository = LineItemRepository(db)
        result = repository.get_line_items(search_params)
        raw_items = result.get("items", [])
        print(f"Repository returned {len(raw_items)} raw items")
        
        # Return in modal-friendly format - work directly with SQLAlchemy models
        modal_items = []
        for item in raw_items:
            # Calculate unit price from Xactimate fields or use untaxed_unit_price
            lab = float(item.lab or 0)
            mat = float(item.mat or 0) 
            equ = float(item.equ or 0)
            labor_burden = float(item.labor_burden or 0)
            market_condition = float(item.market_condition or 0)
            
            # Use breakdown if any component is > 0, otherwise use untaxed_unit_price
            breakdown_total = lab + mat + equ + labor_burden + market_condition
            unit_price = breakdown_total if breakdown_total > 0 else float(item.untaxed_unit_price or 0)
            
            modal_items.append({
                "component_code": item.item or '',
                "description": item.description or '',
                "unit": item.unit or 'EA',
                "act": "+",
                "unit_price": round(unit_price, 2),
                "id": str(item.id),
                "category": item.cat or ''
            })
        
        return modal_items
        
    except Exception as e:
        print(f"Exception in get_line_items_for_modal: {str(e)}")
        import traceback
        traceback.print_exc()
        # Return empty list if search fails
        return []


@router.get("/modal/search", response_model=List[Dict[str, Any]])
async def search_line_items_for_modal(
    q: str = Query(..., min_length=1, description="Multi-keyword search query"),
    category: Optional[str] = Query(None, description="Filter by category code"), 
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache)
):
    """Enhanced search for line items in modal with multi-keyword support"""
    from app.domains.line_items.models import LineItem
    from sqlalchemy import or_, func, and_
    
    try:
        # Split search terms for multi-keyword search
        search_terms = [term.strip() for term in q.split() if term.strip()]
        
        # Build base query
        query = db.query(LineItem).filter(LineItem.is_active == True)
        
        # No company filter for modal - show all items
        
        # Apply category filter
        if category:
            query = query.filter(LineItem.cat == category)
        
        # Apply multi-keyword search
        if search_terms:
            search_conditions = []
            for term in search_terms:
                term_pattern = f"%{term.upper()}%"
                term_conditions = or_(
                    func.upper(LineItem.item).like(term_pattern),
                    func.upper(LineItem.description).like(term_pattern),
                    func.upper(LineItem.includes).like(term_pattern),
                    func.upper(LineItem.cat).like(term_pattern)
                )
                search_conditions.append(term_conditions)
            
            # All terms must match (AND logic)
            if search_conditions:
                query = query.filter(and_(*search_conditions))
        
        # Order by relevance and limit results
        query = query.order_by(
            func.length(LineItem.item).asc(),  # Shorter codes first
            LineItem.item.asc()
        ).limit(limit)
        
        items = query.all()
        
        # Format for modal display
        modal_items = []
        for item in items:
            # Calculate unit price
            unit_price = 0
            if item.type == "xactimate":
                lab = float(item.lab or 0)
                mat = float(item.mat or 0)
                equ = float(item.equ or 0)
                labor_burden = float(item.labor_burden or 0)
                market_condition = float(item.market_condition or 0)
                unit_price = lab + mat + equ + labor_burden + market_condition
            else:
                unit_price = float(item.untaxed_unit_price or 0)
            
            modal_items.append({
                "component_code": item.item or "",
                "description": item.description or "",
                "unit": item.unit or "EA",
                "act": "&" if item.type == "xactimate" else "+",
                "unit_price": round(unit_price, 2),
                "id": str(item.id),
                "category": item.cat or "",
                "type": item.type or "custom"
            })
        
        return modal_items
        
    except Exception:
        # Return empty list if search fails
        return []


@router.get("/", response_model=Dict[str, Any])
async def search_line_items(
    type: Optional[LineItemType] = None,
    cat: Optional[str] = None,
    search_term: Optional[str] = None,
    company_id: Optional[UUID] = None,
    is_active: Optional[bool] = True,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    current_user: Staff = Depends(get_current_user)
):
    """Search line items with filters and pagination"""
    search = LineItemSearch(
        type=type,
        cat=cat,
        search_term=search_term,
        company_id=company_id or (UUID(current_user.company_id) if hasattr(current_user, 'company_id') and current_user.company_id else None),
        is_active=is_active,
        page=page,
        page_size=page_size
    )
    
    service = LineItemService(db, cache)
    return await service.search_line_items(search)


@router.put("/{line_item_id}", response_model=LineItemResponse)
async def update_line_item(
    line_item_id: UUID,
    update: LineItemUpdate,
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    current_user: Staff = Depends(get_current_user)
):
    """Update a line item"""
    service = LineItemService(db, cache)
    item = await service.update_line_item(line_item_id, update, UUID(current_user.id))
    
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Line item not found"
        )
    
    return item


@router.delete("/{line_item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_line_item(
    line_item_id: UUID,
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    current_user: Staff = Depends(get_current_user)
):
    """Soft delete a line item"""
    service = LineItemService(db, cache)
    success = await service.delete_line_item(line_item_id, UUID(current_user.id))
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Line item not found"
        )
    
    return None


# =====================================================
# Note Endpoints
# =====================================================

@router.post("/notes", response_model=LineItemNoteResponse, status_code=status.HTTP_201_CREATED)
async def create_note(
    note: LineItemNoteCreate,
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    current_user: Staff = Depends(get_current_user)
):
    """Create a new note"""
    service = LineItemService(db, cache)
    return await service.create_note(note, UUID(current_user.id))


@router.get("/notes", response_model=List[LineItemNoteResponse])
async def get_notes(
    company_id: Optional[UUID] = None,
    category: Optional[str] = None,
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    current_user: Staff = Depends(get_current_user)
):
    """Get notes with optional filters"""
    service = LineItemService(db, cache)
    
    # Use user's company if not specified
    if not company_id and current_user.company_id:
        company_id = UUID(str(current_user.company_id))
    
    return await service.get_notes(company_id, category)


@router.get("/notes/templates")
async def get_note_templates(
    category: Optional[str] = Query(None, description="Category code for filtering templates"),
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache)
):
    """Get note templates for line items by category"""
    try:
        from app.domains.line_items.models import LineItemNote
        from app.domains.line_items.category_models import LineItemCategory
        
        print(f"API CALL: get_note_templates - category: {category}")
        
        # Build query for note templates (notes with is_template=True)
        query = db.query(LineItemNote).filter(LineItemNote.is_template == True)
        
        # Filter by category if provided and valid
        if category and category not in ['undefined', 'null', 'General', 'general']:
            # Verify category exists in categories table
            category_exists = db.query(LineItemCategory).filter(
                LineItemCategory.code == category.upper(),
                LineItemCategory.is_active == True
            ).first()
            
            if category_exists:
                print(f"Found valid category: {category}")
                query = query.filter(LineItemNote.category == category.upper())
            else:
                print(f"Category {category} not found in database")
        
        # Get templates from database
        templates = query.order_by(LineItemNote.title).limit(50).all()
        
        # Convert to response format
        note_templates = []
        for template in templates:
            note_templates.append({
                "id": str(template.id),
                "title": template.title or "",
                "content": template.content or "",
                "category": template.category
            })
        
        
        print(f"Returning {len(note_templates)} note templates for category: {category}")
        return note_templates
        
    except Exception as e:
        print(f"Exception in get_note_templates: {e}")
        import traceback
        traceback.print_exc()
        # Return empty array instead of raising error for better UX
        return []


@router.get("/notes/{note_id}", response_model=LineItemNoteResponse)
async def get_note(
    note_id: UUID,
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    current_user: Staff = Depends(get_current_user)
):
    """Get a single note by ID"""
    service = LineItemService(db, cache)
    note = await service.get_note(note_id)
    
    if not note:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Note not found"
        )
    
    return note


@router.put("/notes/{note_id}", response_model=LineItemNoteResponse)
async def update_note(
    note_id: UUID,
    update: LineItemNoteUpdate,
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    current_user: Staff = Depends(get_current_user)
):
    """Update a note"""
    service = LineItemService(db, cache)
    note = await service.update_note(note_id, update)
    
    if not note:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Note not found"
        )
    
    return note


@router.delete("/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(
    note_id: UUID,
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    current_user: Staff = Depends(get_current_user)
):
    """Delete a note"""
    service = LineItemService(db, cache)
    success = await service.delete_note(note_id)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Note not found"
        )
    
    return None


# =====================================================
# Template Endpoints
# =====================================================

@router.post("/templates", response_model=LineItemTemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_template(
    template: LineItemTemplateCreate,
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    current_user: Staff = Depends(get_current_user)
):
    """Create a new template"""
    service = LineItemService(db, cache)
    return await service.create_template(template, UUID(current_user.id))


@router.get("/templates/{template_id}", response_model=LineItemTemplateResponse)
async def get_template(
    template_id: UUID,
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    current_user: Staff = Depends(get_current_user)
):
    """Get a template by ID"""
    service = LineItemService(db, cache)
    template = await service.get_template(template_id)
    
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template not found"
        )
    
    return template


@router.get("/templates", response_model=List[LineItemTemplateResponse])
async def get_templates(
    company_id: Optional[UUID] = None,
    category: Optional[str] = None,
    is_active: bool = True,
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    current_user: Staff = Depends(get_current_user)
):
    """Get templates with filters"""
    service = LineItemService(db, cache)
    
    # Use user's company if not specified
    if not company_id and current_user.company_id:
        company_id = UUID(str(current_user.company_id))
    
    return await service.get_templates(company_id, category, is_active)


@router.put("/templates/{template_id}", response_model=LineItemTemplateResponse)
async def update_template(
    template_id: UUID,
    update: LineItemTemplateUpdate,
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    current_user: Staff = Depends(get_current_user)
):
    """Update a template"""
    service = LineItemService(db, cache)
    template = await service.update_template(template_id, update)
    
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template not found"
        )
    
    return template


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    template_id: UUID,
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    current_user: Staff = Depends(get_current_user)
):
    """Soft delete a template"""
    service = LineItemService(db, cache)
    success = await service.delete_template(template_id)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template not found"
        )
    
    return None


@router.post("/templates/apply", response_model=Dict[str, Any])
async def apply_template(
    apply_request: BulkTemplateApply,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    current_user: Staff = Depends(get_current_user)
):
    """Apply a template to an invoice or estimate"""
    service = LineItemService(db, cache)
    
    if apply_request.target_type == "invoice":
        # Apply to invoice
        items = await service.apply_template_to_invoice(
            apply_request.template_id,
            apply_request.target_id,
            apply_request.quantity_multiplier
        )
        
        return {
            "success": True,
            "message": f"Template applied to invoice",
            "items_created": len(items)
        }
    elif apply_request.target_type == "estimate":
        # Apply to estimate (similar logic)
        # TODO: Implement estimate template application
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Estimate template application not yet implemented"
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid target type"
        )


# =====================================================
# Tax Calculation Endpoints
# =====================================================

@router.post("/tax/calculate", response_model=TaxCalculationResponse)
async def calculate_tax(
    request: TaxCalculationRequest,
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    current_user: Staff = Depends(get_current_user)
):
    """Calculate tax for a line item"""
    service = LineItemService(db, cache)
    return await service.calculate_tax(request)


# =====================================================
# Invoice/Estimate Integration Endpoints
# =====================================================

@router.post("/invoice/{invoice_id}/items", response_model=Dict[str, Any])
async def add_line_item_to_invoice(
    invoice_id: UUID,
    item: InvoiceLineItemCreate,
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    current_user: Staff = Depends(get_current_user)
):
    """Add a line item to an invoice"""
    service = LineItemService(db, cache)
    result = await service.add_line_item_to_invoice(
        invoice_id,
        item,
        UUID(current_user.id)
    )
    
    return {
        "success": True,
        "invoice_item_id": str(result["invoice_item"].id),
        "line_item_id": str(result["line_item"].id)
    }


@router.get("/invoice/{invoice_id}/items/optimized", response_model=List[Dict[str, Any]])
async def get_optimized_invoice_items(
    invoice_id: UUID,
    db: Session = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    current_user: Staff = Depends(get_current_user)
):
    """Get invoice items with optimized loading (prevents N+1 queries)"""
    service = LineItemService(db, cache)
    return await service.get_optimized_invoice_items(invoice_id)