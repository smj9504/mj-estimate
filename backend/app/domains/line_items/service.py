"""
Line Items domain service layer
"""

from typing import List, Optional, Dict, Any
from uuid import UUID
from decimal import Decimal, ROUND_HALF_UP
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
import asyncio
import json
import logging
from functools import lru_cache
from datetime import datetime, timedelta

from app.domains.line_items.repository import LineItemRepository
from app.domains.line_items.schemas import (
    LineItemCreate, LineItemUpdate, LineItemSearch, LineItemResponse,
    LineItemNoteCreate, LineItemNoteUpdate, LineItemNoteResponse,
    LineItemTemplateCreate, LineItemTemplateUpdate, LineItemTemplateResponse,
    TaxCalculationRequest, TaxCalculationResponse,
    BulkTemplateApply, InvoiceLineItemCreate, EstimateLineItemCreate,
    LineItemOverride, TaxMethod
)
from app.domains.line_items.models import LineItem, LineItemType
from app.core.cache import CacheService
from app.core.interfaces import ValidationError

# BusinessError as a simple alias
class BusinessError(Exception):
    pass

logger = logging.getLogger(__name__)


class LineItemService:
    """Service layer for line item operations"""
    
    def __init__(self, db: Session, cache: Optional[CacheService] = None):
        self.db = db
        self.repository = LineItemRepository(db)
        self.cache = cache or CacheService()
    
    # =====================================================
    # Line Item Operations
    # =====================================================
    
    async def create_line_item(
        self, 
        line_item: LineItemCreate, 
        user_id: UUID
    ) -> LineItemResponse:
        """Create a new line item with validation"""
        try:
            # Validate Xactimate vs Custom requirements
            self._validate_line_item_type(line_item)
            
            # Create line item
            db_item = self.repository.create_line_item(line_item, user_id)
            
            # Clear cache
            self._invalidate_line_item_cache()
            
            # Create audit log
            self.repository.create_audit_entry(
                line_item_id=db_item.id,
                action='CREATE',
                new_values=db_item.to_dict(),
                changed_by=user_id
            )
            
            return LineItemResponse.from_orm(db_item)
            
        except IntegrityError as e:
            logger.error(f"Database error creating line item: {e}")
            raise BusinessError("Failed to create line item")
    
    async def get_line_item(self, line_item_id: UUID) -> Optional[LineItemResponse]:
        """Get a line item by ID with caching"""
        # Check cache first
        cache_key = f"line_item:{line_item_id}"
        cached = await self.cache.get(cache_key)
        if cached:
            return LineItemResponse(**json.loads(cached))
        
        # Get from database
        db_item = self.repository.get_line_item(line_item_id)
        if not db_item:
            return None
        
        # Handle Pydantic v2
        try:
            if hasattr(LineItemResponse, 'model_validate'):
                response = LineItemResponse.model_validate(db_item)
            else:
                response = LineItemResponse.from_orm(db_item)
        except Exception as e:
            print(f"Error converting single item {db_item.id}: {e}")
            # Create manual conversion as fallback
            response = LineItemResponse(
                id=db_item.id,
                cat=db_item.cat,
                item=db_item.item,
                description=db_item.description,
                includes=db_item.includes,
                unit=db_item.unit,
                lab=db_item.lab,
                mat=db_item.mat,
                equ=db_item.equ,
                labor_burden=db_item.labor_burden,
                market_condition=db_item.market_condition,
                untaxed_unit_price=db_item.untaxed_unit_price,
                is_active=db_item.is_active,
                version=db_item.version,
                company_id=db_item.company_id,
                created_by=db_item.created_by,
                created_at=db_item.created_at,
                updated_at=db_item.updated_at,
                notes=[]
            )
        
        # Cache the result
        await self.cache.set(cache_key, response.json(), ttl=3600)
        
        return response
    
    async def search_line_items(
        self, 
        search: LineItemSearch
    ) -> Dict[str, Any]:
        """Search line items with advanced filtering"""
        # Create cache key from search params
        cache_key = f"line_items_search:{search.json()}"
        
        # Check cache for search results
        cached = await self.cache.get(cache_key)
        if cached:
            return json.loads(cached)
        
        # Get from database
        result = self.repository.get_line_items(search)
        
        # Convert to response schemas - handle Pydantic v2
        converted_items = []
        for item in result['items']:
            try:
                # Use model_validate for Pydantic v2
                if hasattr(LineItemResponse, 'model_validate'):
                    converted_items.append(LineItemResponse.model_validate(item))
                else:
                    # Fallback for Pydantic v1
                    converted_items.append(LineItemResponse.from_orm(item))
            except Exception as e:
                print(f"Error converting item {item.id}: {e}")
                # Create manual conversion as fallback
                converted_items.append(LineItemResponse(
                    id=item.id,
                    cat=item.cat,
                    item=item.item,
                    description=item.description,
                    includes=item.includes,
                    unit=item.unit,
                    lab=item.lab,
                    mat=item.mat,
                    equ=item.equ,
                    labor_burden=item.labor_burden,
                    market_condition=item.market_condition,
                    untaxed_unit_price=item.untaxed_unit_price,
                    is_active=item.is_active,
                    version=item.version,
                    company_id=item.company_id,
                    created_by=item.created_by,
                    created_at=item.created_at,
                    updated_at=item.updated_at,
                    notes=[]
                ))
        result['items'] = converted_items
        
        # Cache the result for 5 minutes
        await self.cache.set(cache_key, json.dumps(result, default=str), ttl=300)
        
        return result
    
    async def update_line_item(
        self, 
        line_item_id: UUID, 
        update: LineItemUpdate,
        user_id: UUID
    ) -> Optional[LineItemResponse]:
        """Update a line item with audit logging"""
        # Get existing item for audit
        existing = self.repository.get_line_item(line_item_id)
        if not existing:
            return None
        
        old_values = existing.to_dict()
        
        # Update the item
        db_item = self.repository.update_line_item(line_item_id, update)
        if not db_item:
            return None
        
        # Clear cache
        self._invalidate_line_item_cache(line_item_id)
        
        # Create audit log
        self.repository.create_audit_entry(
            line_item_id=line_item_id,
            action='UPDATE',
            old_values=old_values,
            new_values=db_item.to_dict(),
            changed_by=user_id
        )
        
        return LineItemResponse.from_orm(db_item)
    
    async def delete_line_item(self, line_item_id: UUID, user_id: UUID) -> bool:
        """Soft delete a line item"""
        success = self.repository.delete_line_item(line_item_id)
        
        if success:
            # Clear cache
            self._invalidate_line_item_cache(line_item_id)
            
            # Create audit log
            self.repository.create_audit_entry(
                line_item_id=line_item_id,
                action='DELETE',
                changed_by=user_id
            )
        
        return success
    
    async def bulk_create_line_items(
        self, 
        items: List[LineItemCreate], 
        user_id: UUID
    ) -> List[LineItemResponse]:
        """Bulk create line items with validation"""
        # Validate all items first
        for item in items:
            self._validate_line_item_type(item)
        
        # Create items in bulk
        db_items = self.repository.bulk_create_line_items(items, user_id)
        
        # Clear cache
        self._invalidate_line_item_cache()
        
        return [LineItemResponse.from_orm(item) for item in db_items]
    
    # =====================================================
    # Note Operations
    # =====================================================
    
    async def create_note(
        self, 
        note: LineItemNoteCreate, 
        user_id: UUID
    ) -> LineItemNoteResponse:
        """Create a new note"""
        db_note = self.repository.create_note(note, user_id)
        return LineItemNoteResponse.from_orm(db_note)
    
    async def get_notes(
        self, 
        company_id: Optional[UUID] = None,
        category: Optional[str] = None
    ) -> List[LineItemNoteResponse]:
        """Get notes with filters"""
        db_notes = self.repository.get_notes(company_id, category)
        return [LineItemNoteResponse.from_orm(note) for note in db_notes]
    
    async def get_note(self, note_id: UUID) -> Optional[LineItemNoteResponse]:
        """Get a single note by ID"""
        db_note = self.repository.get_note(note_id)
        if not db_note:
            return None
        return LineItemNoteResponse.from_orm(db_note)
    
    async def update_note(
        self, 
        note_id: UUID, 
        update: LineItemNoteUpdate
    ) -> Optional[LineItemNoteResponse]:
        """Update a note"""
        db_note = self.repository.update_note(note_id, update)
        if not db_note:
            return None
        return LineItemNoteResponse.from_orm(db_note)
    
    async def delete_note(self, note_id: UUID) -> bool:
        """Delete a note"""
        return self.repository.delete_note(note_id)
    
    # =====================================================
    # Template Operations
    # =====================================================
    
    async def create_template(
        self, 
        template: LineItemTemplateCreate, 
        user_id: UUID
    ) -> LineItemTemplateResponse:
        """Create a new template"""
        db_template = self.repository.create_template(template, user_id)
        return LineItemTemplateResponse.from_orm(db_template)
    
    async def get_template(self, template_id: UUID) -> Optional[LineItemTemplateResponse]:
        """Get a template by ID"""
        # Check cache
        cache_key = f"template:{template_id}"
        cached = await self.cache.get(cache_key)
        if cached:
            return LineItemTemplateResponse(**json.loads(cached))
        
        db_template = self.repository.get_template(template_id)
        if not db_template:
            return None
        
        response = LineItemTemplateResponse.from_orm(db_template)
        
        # Cache for 1 hour
        await self.cache.set(cache_key, response.json(), ttl=3600)
        
        return response
    
    async def get_templates(
        self,
        company_id: Optional[UUID] = None,
        category: Optional[str] = None,
        is_active: bool = True
    ) -> List[LineItemTemplateResponse]:
        """Get templates with filters"""
        db_templates = self.repository.get_templates(company_id, category, is_active)
        return [LineItemTemplateResponse.from_orm(t) for t in db_templates]
    
    async def update_template(
        self, 
        template_id: UUID, 
        update: LineItemTemplateUpdate
    ) -> Optional[LineItemTemplateResponse]:
        """Update a template"""
        db_template = self.repository.update_template(template_id, update)
        if not db_template:
            return None
        
        # Clear cache
        cache_key = f"template:{template_id}"
        await self.cache.delete(cache_key)
        
        return LineItemTemplateResponse.from_orm(db_template)
    
    async def delete_template(self, template_id: UUID) -> bool:
        """Soft delete a template"""
        success = self.repository.delete_template(template_id)
        
        if success:
            # Clear cache
            cache_key = f"template:{template_id}"
            await self.cache.delete(cache_key)
        
        return success
    
    async def apply_template_to_invoice(
        self,
        template_id: UUID,
        invoice_id: UUID,
        quantity_multiplier: Decimal = Decimal('1')
    ) -> List[Dict]:
        """Apply a template to an invoice"""
        from app.domains.invoice.models import InvoiceItem
        
        # Get template
        template = self.repository.get_template(template_id)
        if not template:
            raise BusinessError("Template not found")
        
        # Create invoice items from template
        created_items = []
        for template_item in template.template_items:
            line_item = template_item.line_item
            
            # Create invoice item
            invoice_item = InvoiceItem(
                invoice_id=invoice_id,
                line_item_id=line_item.id,
                description=line_item.description,
                quantity=template_item.quantity_multiplier * quantity_multiplier,
                unit=line_item.unit,
                rate=float(line_item.untaxed_unit_price or 0),
                order_index=template_item.order_index
            )
            
            self.db.add(invoice_item)
            created_items.append({
                'invoice_item': invoice_item,
                'line_item': line_item
            })
        
        self.db.commit()
        
        return created_items
    
    # =====================================================
    # Tax Calculation
    # =====================================================
    
    async def calculate_tax(
        self, 
        request: TaxCalculationRequest
    ) -> TaxCalculationResponse:
        """Calculate tax for a line item"""
        # Get line item
        line_item = self.repository.get_line_item(request.line_item_id)
        if not line_item:
            raise BusinessError("Line item not found")
        
        # Apply overrides if provided
        if request.override_values:
            line_item = self._apply_overrides(line_item, request.override_values)
        
        # Calculate base amounts
        unit_price = line_item.calculate_untaxed_unit_price()
        subtotal = unit_price * request.quantity
        
        # Calculate taxable amount based on type and method
        if request.tax_method == TaxMethod.percentage:
            if line_item.type == LineItemType.XACTIMATE:
                # Only material is taxable for Xactimate
                taxable_amount = Decimal(str(line_item.mat or 0)) * request.quantity
            else:
                # Entire amount is taxable for custom
                taxable_amount = subtotal
            
            tax_amount = (taxable_amount * request.tax_rate / 100).quantize(
                Decimal('0.01'),
                rounding=ROUND_HALF_UP
            )
        elif request.tax_method == TaxMethod.specific:
            taxable_amount = subtotal
            tax_amount = request.tax_rate
        else:
            taxable_amount = Decimal('0')
            tax_amount = Decimal('0')
        
        total = subtotal + tax_amount
        
        # Create breakdown
        breakdown = {
            'unit_price': unit_price,
            'quantity': request.quantity,
            'subtotal': subtotal,
            'taxable_amount': taxable_amount,
            'tax_rate': request.tax_rate,
            'tax_amount': tax_amount,
            'total': total
        }
        
        if line_item.type == LineItemType.XACTIMATE:
            breakdown.update({
                'lab': Decimal(str(line_item.lab or 0)),
                'mat': Decimal(str(line_item.mat or 0)),
                'equ': Decimal(str(line_item.equ or 0)),
                'labor_burden': Decimal(str(line_item.labor_burden or 0)),
                'market_condition': Decimal(str(line_item.market_condition or 0))
            })
        
        return TaxCalculationResponse(
            subtotal=subtotal,
            taxable_amount=taxable_amount,
            tax_amount=tax_amount,
            total=total,
            breakdown=breakdown
        )
    
    # =====================================================
    # Invoice/Estimate Integration
    # =====================================================
    
    async def add_line_item_to_invoice(
        self,
        invoice_id: UUID,
        item: InvoiceLineItemCreate,
        user_id: UUID
    ) -> Dict:
        """Add a line item to an invoice"""
        from app.domains.invoice.models import InvoiceItem
        
        # Handle custom inline item creation
        if item.custom_item and not item.line_item_id:
            # Create custom line item
            custom_create = LineItemCreate(
                type=LineItemType.custom,
                **item.custom_item.dict()
            )
            db_line_item = self.repository.create_line_item(custom_create, user_id)
            line_item_id = db_line_item.id
        elif item.line_item_id:
            line_item_id = item.line_item_id
            db_line_item = self.repository.get_line_item(line_item_id)
            if not db_line_item:
                raise BusinessError("Line item not found")
        else:
            raise ValidationError("Either line_item_id or custom_item must be provided")
        
        # Create invoice item
        invoice_item = InvoiceItem(
            invoice_id=invoice_id,
            line_item_id=line_item_id,
            quantity=float(item.quantity),
            order_index=item.order_index,
            is_custom_override=bool(item.override_values),
            override_values=item.override_values.dict() if item.override_values else None
        )
        
        # Set base values from line item
        invoice_item.description = db_line_item.description
        invoice_item.unit = db_line_item.unit
        invoice_item.rate = float(db_line_item.untaxed_unit_price or 0)
        
        self.db.add(invoice_item)
        self.db.commit()
        self.db.refresh(invoice_item)
        
        return {
            'invoice_item': invoice_item,
            'line_item': db_line_item
        }
    
    # =====================================================
    # Performance Optimization
    # =====================================================
    
    async def get_optimized_invoice_items(self, invoice_id: UUID) -> List[Dict]:
        """Get invoice items with optimized loading"""
        return self.repository.get_line_items_for_invoice(invoice_id)
    
    @lru_cache(maxsize=100)
    def _get_cached_line_item(self, line_item_id: str) -> Optional[Dict]:
        """LRU cached line item retrieval"""
        db_item = self.repository.get_line_item(UUID(line_item_id))
        return db_item.to_dict() if db_item else None
    
    # =====================================================
    # Helper Methods
    # =====================================================
    
    def _validate_line_item_type(self, line_item: LineItemCreate):
        """Validate line item based on type"""
        if line_item.type == LineItemType.xactimate:
            # Xactimate items should have component prices
            if not any([line_item.lab, line_item.mat, line_item.equ, 
                       line_item.labor_burden, line_item.market_condition]):
                raise ValidationError(
                    "Xactimate items must have at least one price component"
                )
        else:
            # Custom items must have untaxed_unit_price
            if not line_item.untaxed_unit_price or line_item.untaxed_unit_price <= 0:
                raise ValidationError(
                    "Custom items must have a positive untaxed_unit_price"
                )
    
    def _apply_overrides(
        self, 
        line_item: LineItem, 
        overrides: LineItemOverride
    ) -> LineItem:
        """Apply override values to a line item (non-persistent)"""
        override_dict = overrides.dict(exclude_unset=True)
        for field, value in override_dict.items():
            if hasattr(line_item, field) and value is not None:
                setattr(line_item, field, value)
        return line_item
    
    def _invalidate_line_item_cache(self, line_item_id: Optional[UUID] = None):
        """Invalidate cache for line items"""
        if line_item_id:
            cache_key = f"line_item:{line_item_id}"
            asyncio.create_task(self.cache.delete(cache_key))
        
        # Clear search cache
        asyncio.create_task(self.cache.delete_pattern("line_items_search:*"))