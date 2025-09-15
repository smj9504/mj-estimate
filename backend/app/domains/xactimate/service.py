"""
Xactimate domain service
"""

from typing import List, Optional, Tuple, Dict, Any
from sqlalchemy.orm import Session
from decimal import Decimal
import math

from app.common.base_service import BaseService
from .models import XactimateCategory, XactimateItem, XactimateComponent
from .repository import XactimateCategoryRepository, XactimateItemRepository, XactimateComponentRepository, XactimateUnifiedRepository
from .schemas import (
    XactimateCategoryCreate, XactimateCategoryUpdate, XactimateCategoryResponse,
    XactimateItemCreate, XactimateItemUpdate, XactimateItemResponse,
    XactimateComponentCreate, XactimateComponentUpdate, XactimateComponentResponse,
    XactimateSearchRequest, XactimateSearchResponse,
    UnifiedSearchRequest, UnifiedSearchResponse, UnifiedLineItemResponse
)


class XactimateCategoryService(BaseService[XactimateCategory, str]):
    """Service for Xactimate categories"""
    
    def __init__(self, db: Session):
        self.db = db
        self.repository = XactimateCategoryRepository(db)
        super().__init__()
    
    def get_repository(self) -> XactimateCategoryRepository:
        """Return the repository instance"""
        return self.repository
    
    def get_by_code(self, category_code: str) -> Optional[XactimateCategoryResponse]:
        """Get category by code"""
        category = self.repository.get_by_code(category_code)
        if category:
            return XactimateCategoryResponse.from_orm(category)
        return None
    
    def get_all(self) -> List[XactimateCategoryResponse]:
        """Get all categories"""
        categories = self.repository.get_all()
        return [XactimateCategoryResponse.from_orm(cat) for cat in categories]


class XactimateItemService(BaseService[XactimateItem, int]):
    """Service for Xactimate items with business logic"""
    
    def __init__(self, db: Session):
        self.db = db
        self.repository = XactimateItemRepository(db)
        self.component_repository = XactimateComponentRepository(db)
        super().__init__()
    
    def get_repository(self) -> XactimateItemRepository:
        """Return the repository instance"""
        return self.repository
    
    def create_with_components(self, item_data: XactimateItemCreate) -> XactimateItemResponse:
        """Create item with components"""
        # Create the main item first
        item_dict = item_data.dict(exclude={'components'})
        item = self.repository.create(item_dict)
        
        # Create components if provided
        if item_data.components:
            components_data = [comp.dict() for comp in item_data.components]
            self.component_repository.bulk_create_for_item(item.id, components_data)
        
        # Commit the transaction
        self.repository.db.commit()
        
        # Refresh and return with components
        self.repository.db.refresh(item)
        item_with_components = self.repository.get_by_id(item.id)
        
        return XactimateItemResponse.from_orm(item_with_components)
    
    def update_with_components(self, item_id: int, item_data: XactimateItemUpdate, 
                             components_data: Optional[List[XactimateComponentCreate]] = None) -> Optional[XactimateItemResponse]:
        """Update item and optionally replace components"""
        # Update the main item
        updated_item = self.repository.update(item_id, item_data.dict(exclude_unset=True))
        if not updated_item:
            return None
        
        # Replace components if provided
        if components_data is not None:
            # Delete existing components
            self.component_repository.delete_by_item_id(item_id)
            
            # Create new components
            if components_data:
                components_dict = [comp.dict() for comp in components_data]
                self.component_repository.bulk_create_for_item(item_id, components_dict)
        
        # Commit the transaction
        self.repository.db.commit()
        
        # Return updated item with components
        item_with_components = self.repository.get_by_id(item_id)
        return XactimateItemResponse.from_orm(item_with_components)
    
    def get_by_item_code(self, item_code: str, include_components: bool = True) -> Optional[XactimateItemResponse]:
        """Get item by code with optional components"""
        item = self.repository.get_by_item_code(item_code, include_components)
        if item:
            return XactimateItemResponse.from_orm(item)
        return None
    
    def get_by_category(self, category_code: str, limit: int = 100, include_components: bool = False) -> List[XactimateItemResponse]:
        """Get items by category"""
        items = self.repository.get_by_category(category_code, limit, include_components)
        return [XactimateItemResponse.from_orm(item) for item in items]
    
    def search(self, search_request: XactimateSearchRequest) -> XactimateSearchResponse:
        """Search items with advanced filters"""
        items, total_count = self.repository.search(search_request)
        
        # Calculate pagination info
        total_pages = math.ceil(total_count / search_request.page_size)
        
        return XactimateSearchResponse(
            items=[XactimateItemResponse.from_orm(item) for item in items],
            total_count=total_count,
            page=search_request.page,
            page_size=search_request.page_size,
            total_pages=total_pages
        )
    
    def get_latest_by_item_codes(self, item_codes: List[str]) -> List[XactimateItemResponse]:
        """Get latest version of items by codes"""
        items = self.repository.get_latest_by_item_codes(item_codes)
        return [XactimateItemResponse.from_orm(item) for item in items]
    
    def get_price_history(self, item_code: str) -> List[XactimateItemResponse]:
        """Get price history for an item"""
        items = self.repository.get_price_history(item_code)
        return [XactimateItemResponse.from_orm(item) for item in items]
    
    def calculate_tax_for_item(self, item_id: int, tax_rate: Decimal) -> Dict[str, Decimal]:
        """Calculate tax for an item (material cost only for Xactimate)"""
        item = self.repository.get_by_id(item_id)
        if not item:
            raise ValueError(f"Item with id {item_id} not found")
        
        taxable_amount = item.get_taxable_amount()  # Material cost only
        tax_amount = (taxable_amount * tax_rate / 100).quantize(Decimal('0.01'))
        total_with_tax = item.untaxed_unit_price + tax_amount
        
        return {
            'taxable_amount': taxable_amount,
            'tax_amount': tax_amount,
            'untaxed_total': item.untaxed_unit_price,
            'total_with_tax': total_with_tax
        }


class XactimateComponentService(BaseService[XactimateComponent, int]):
    """Service for Xactimate components"""
    
    def __init__(self, db: Session):
        self.db = db
        self.repository = XactimateComponentRepository(db)
        super().__init__()
    
    def get_repository(self) -> XactimateComponentRepository:
        """Return the repository instance"""
        return self.repository
    
    def get_by_item_id(self, item_id: int) -> List[XactimateComponentResponse]:
        """Get all components for an item"""
        components = self.repository.get_by_item_id(item_id)
        return [XactimateComponentResponse.from_orm(comp) for comp in components]
    
    def get_by_type(self, component_type: str, limit: int = 100) -> List[XactimateComponentResponse]:
        """Get components by type"""
        components = self.repository.get_by_type(component_type, limit)
        return [XactimateComponentResponse.from_orm(comp) for comp in components]
    
    def bulk_create_for_item(self, item_id: int, components_data: List[XactimateComponentCreate]) -> List[XactimateComponentResponse]:
        """Bulk create components for an item"""
        components_dict = [comp.dict() for comp in components_data]
        components = self.repository.bulk_create_for_item(item_id, components_dict)
        self.repository.db.commit()
        
        return [XactimateComponentResponse.from_orm(comp) for comp in components]


class XactimateUnifiedService:
    """Service for unified search across Xactimate and Custom line items"""
    
    def __init__(self, db: Session):
        self.db = db
        self.unified_repository = XactimateUnifiedRepository(db)
    
    def unified_search(self, search_request: UnifiedSearchRequest) -> UnifiedSearchResponse:
        """Unified search across both Xactimate and Custom line items"""
        items_data, counts = self.unified_repository.unified_search(
            search_term=search_request.search_term,
            category=search_request.category,
            item_type=search_request.item_type,
            company_id=search_request.company_id,
            page=search_request.page,
            page_size=search_request.page_size
        )
        
        # Convert to response objects
        items = []
        for item_data in items_data:
            items.append(UnifiedLineItemResponse(**item_data))
        
        # Calculate pagination
        total_pages = math.ceil(counts['total_count'] / search_request.page_size)
        
        return UnifiedSearchResponse(
            items=items,
            total_count=counts['total_count'],
            page=search_request.page,
            page_size=search_request.page_size,
            total_pages=total_pages,
            xactimate_count=counts['xactimate_count'],
            custom_count=counts['custom_count']
        )