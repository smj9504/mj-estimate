"""
Line Items domain repository
"""

from typing import List, Optional, Dict, Any
from uuid import UUID
from sqlalchemy import and_, or_, func
from sqlalchemy.orm import Session, selectinload, joinedload
from sqlalchemy.exc import IntegrityError
import logging

# from app.common.base_repository import SQLAlchemyRepository  # 제거 - 더 이상 필요하지 않음
from app.domains.line_items.models import (
    LineItem, LineItemNote, LineItemNoteMapping,
    LineItemTemplate, TemplateLineItem, LineItemAudit,
    LineItemType
)
from app.domains.line_items.schemas import (
    LineItemCreate, LineItemUpdate, LineItemSearch,
    LineItemNoteCreate, LineItemNoteUpdate,
    LineItemTemplateCreate, LineItemTemplateUpdate,
    TemplateLineItemCreate
)

logger = logging.getLogger(__name__)


class LineItemRepository:
    """Repository for line item operations - 직접 SQLAlchemy 사용으로 단순화"""
    
    def __init__(self, db: Session):
        self.db = db
        # super().__init__(db, LineItem)  # 제거 - SQLAlchemyRepository 상속 불필요
    
    # =====================================================
    # Line Item CRUD Operations
    # =====================================================
    
    def create_line_item(self, line_item: LineItemCreate, created_by: UUID) -> LineItem:
        """Create a new line item"""
        db_line_item = LineItem(
            type=line_item.type,
            cat=line_item.cat,
            item=line_item.item,
            description=line_item.description,
            includes=line_item.includes,
            unit=line_item.unit,
            lab=line_item.lab,
            mat=line_item.mat,
            equ=line_item.equ,
            labor_burden=line_item.labor_burden,
            market_condition=line_item.market_condition,
            untaxed_unit_price=line_item.untaxed_unit_price,
            company_id=line_item.company_id,
            is_active=line_item.is_active,
            created_by=created_by
        )
        
        self.db.add(db_line_item)
        self.db.flush()
        
        # Attach notes if provided
        if line_item.note_ids:
            self._attach_notes_to_line_item(db_line_item.id, line_item.note_ids)
        
        self.db.commit()
        self.db.refresh(db_line_item)
        
        return db_line_item
    
    def get_line_item(self, line_item_id: UUID) -> Optional[LineItem]:
        """Get a line item by ID with notes"""
        return self.db.query(LineItem)\
            .options(selectinload(LineItem.notes))\
            .filter(LineItem.id == line_item_id)\
            .first()
    
    def get_line_items(self, search: LineItemSearch) -> Dict[str, Any]:
        """Search line items with pagination"""
        query = self.db.query(LineItem)\
            .options(selectinload(LineItem.notes))
        
        # Apply filters
        if search.cat:
            query = query.filter(LineItem.cat == search.cat)
        
        if search.company_id:
            query = query.filter(or_(
                LineItem.company_id == search.company_id,
                LineItem.company_id.is_(None)  # Include global items
            ))
        
        if search.is_active is not None:
            query = query.filter(LineItem.is_active == search.is_active)
        
        if search.search_term:
            search_pattern = f"%{search.search_term}%"
            query = query.filter(or_(
                LineItem.description.ilike(search_pattern),
                LineItem.includes.ilike(search_pattern),
                LineItem.cat.ilike(search_pattern),
                LineItem.item.ilike(search_pattern)
            ))
        
        # Get total count
        total = query.count()
        
        # Apply pagination
        offset = (search.page - 1) * search.page_size
        items = query.offset(offset).limit(search.page_size).all()
        
        return {
            "items": items,
            "total": total,
            "page": search.page,
            "page_size": search.page_size,
            "total_pages": (total + search.page_size - 1) // search.page_size
        }
    
    def update_line_item(self, line_item_id: UUID, update: LineItemUpdate) -> Optional[LineItem]:
        """Update a line item"""
        db_item = self.get_line_item(line_item_id)
        if not db_item:
            return None
        
        # Update fields
        update_data = update.dict(exclude_unset=True, exclude={'note_ids'})
        for field, value in update_data.items():
            setattr(db_item, field, value)
        
        # Increment version
        db_item.version += 1
        
        # Update notes if provided
        if update.note_ids is not None:
            self._update_line_item_notes(line_item_id, update.note_ids)
        
        self.db.commit()
        self.db.refresh(db_item)
        
        return db_item
    
    def delete_line_item(self, line_item_id: UUID) -> bool:
        """Soft delete a line item"""
        db_item = self.get_line_item(line_item_id)
        if not db_item:
            return False
        
        db_item.is_active = False
        self.db.commit()
        
        return True
    
    def bulk_create_line_items(self, items: List[LineItemCreate], created_by: UUID) -> List[LineItem]:
        """Bulk create line items"""
        created_items = []
        
        for item in items:
            db_item = self.create_line_item(item, created_by)
            created_items.append(db_item)
        
        return created_items
    
    # =====================================================
    # Line Item Note Operations
    # =====================================================
    
    def create_note(self, note: LineItemNoteCreate, created_by: UUID) -> LineItemNote:
        """Create a new note"""
        db_note = LineItemNote(
            title=note.title,
            content=note.content,
            category=note.category,
            is_template=note.is_template,
            company_id=note.company_id,
            created_by=created_by
        )
        
        self.db.add(db_note)
        self.db.commit()
        self.db.refresh(db_note)
        
        return db_note
    
    def get_note(self, note_id: UUID) -> Optional[LineItemNote]:
        """Get a note by ID"""
        return self.db.query(LineItemNote)\
            .filter(LineItemNote.id == note_id)\
            .first()
    
    def get_notes(self, company_id: Optional[UUID] = None, category: Optional[str] = None) -> List[LineItemNote]:
        """Get notes with optional filters"""
        query = self.db.query(LineItemNote)
        
        if company_id:
            query = query.filter(or_(
                LineItemNote.company_id == company_id,
                LineItemNote.company_id.is_(None)
            ))
        
        if category:
            query = query.filter(LineItemNote.category == category)
        
        return query.all()
    
    def update_note(self, note_id: UUID, update: LineItemNoteUpdate) -> Optional[LineItemNote]:
        """Update a note"""
        db_note = self.get_note(note_id)
        if not db_note:
            return None
        
        update_data = update.dict(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_note, field, value)
        
        self.db.commit()
        self.db.refresh(db_note)
        
        return db_note
    
    def delete_note(self, note_id: UUID) -> bool:
        """Delete a note"""
        db_note = self.get_note(note_id)
        if not db_note:
            return False
        
        self.db.delete(db_note)
        self.db.commit()
        
        return True
    
    def _attach_notes_to_line_item(self, line_item_id: UUID, note_ids: List[UUID]):
        """Attach notes to a line item"""
        for idx, note_id in enumerate(note_ids):
            mapping = LineItemNoteMapping(
                line_item_id=line_item_id,
                note_id=note_id,
                order_index=idx
            )
            self.db.add(mapping)
    
    def _update_line_item_notes(self, line_item_id: UUID, note_ids: List[UUID]):
        """Update notes attached to a line item"""
        # Remove existing mappings
        self.db.query(LineItemNoteMapping)\
            .filter(LineItemNoteMapping.line_item_id == line_item_id)\
            .delete()
        
        # Add new mappings
        self._attach_notes_to_line_item(line_item_id, note_ids)
    
    # =====================================================
    # Template Operations
    # =====================================================
    
    def create_template(self, template: LineItemTemplateCreate, created_by: UUID) -> LineItemTemplate:
        """Create a new template"""
        db_template = LineItemTemplate(
            name=template.name,
            description=template.description,
            category=template.category,
            company_id=template.company_id,
            created_by=created_by
        )
        
        self.db.add(db_template)
        self.db.flush()
        
        # Add line items to template
        if template.line_item_ids:
            for item in template.line_item_ids:
                template_item = TemplateLineItem(
                    template_id=db_template.id,
                    line_item_id=item.line_item_id,
                    quantity_multiplier=item.quantity_multiplier,
                    order_index=item.order_index
                )
                self.db.add(template_item)
        
        self.db.commit()
        self.db.refresh(db_template)
        
        return db_template
    
    def get_template(self, template_id: UUID) -> Optional[LineItemTemplate]:
        """Get a template with its line items"""
        return self.db.query(LineItemTemplate)\
            .options(
                selectinload(LineItemTemplate.template_items)
                .selectinload(TemplateLineItem.line_item)
                .selectinload(LineItem.notes)
            )\
            .filter(LineItemTemplate.id == template_id)\
            .first()
    
    def get_templates(
        self, 
        company_id: Optional[UUID] = None, 
        category: Optional[str] = None,
        is_active: bool = True
    ) -> List[LineItemTemplate]:
        """Get templates with filters"""
        query = self.db.query(LineItemTemplate)\
            .options(
                selectinload(LineItemTemplate.template_items)
                .selectinload(TemplateLineItem.line_item)
            )
        
        if company_id:
            query = query.filter(or_(
                LineItemTemplate.company_id == company_id,
                LineItemTemplate.company_id.is_(None)
            ))
        
        if category:
            query = query.filter(LineItemTemplate.category == category)
        
        if is_active is not None:
            query = query.filter(LineItemTemplate.is_active == is_active)
        
        return query.all()
    
    def update_template(self, template_id: UUID, update: LineItemTemplateUpdate) -> Optional[LineItemTemplate]:
        """Update a template"""
        db_template = self.get_template(template_id)
        if not db_template:
            return None
        
        # Update basic fields
        update_data = update.dict(exclude_unset=True, exclude={'line_item_ids'})
        for field, value in update_data.items():
            setattr(db_template, field, value)
        
        # Update line items if provided
        if update.line_item_ids is not None:
            # Remove existing items
            self.db.query(TemplateLineItem)\
                .filter(TemplateLineItem.template_id == template_id)\
                .delete()
            
            # Add new items
            for item in update.line_item_ids:
                template_item = TemplateLineItem(
                    template_id=template_id,
                    line_item_id=item.line_item_id,
                    quantity_multiplier=item.quantity_multiplier,
                    order_index=item.order_index
                )
                self.db.add(template_item)
        
        self.db.commit()
        self.db.refresh(db_template)
        
        return db_template
    
    def delete_template(self, template_id: UUID) -> bool:
        """Soft delete a template"""
        db_template = self.get_template(template_id)
        if not db_template:
            return False
        
        db_template.is_active = False
        self.db.commit()
        
        return True
    
    # =====================================================
    # Audit Operations
    # =====================================================
    
    def get_line_item_audit_trail(self, line_item_id: UUID) -> List[LineItemAudit]:
        """Get audit trail for a line item"""
        return self.db.query(LineItemAudit)\
            .filter(LineItemAudit.line_item_id == line_item_id)\
            .order_by(LineItemAudit.changed_at.desc())\
            .all()
    
    def create_audit_entry(
        self,
        line_item_id: UUID,
        action: str,
        old_values: Optional[Dict] = None,
        new_values: Optional[Dict] = None,
        changed_by: Optional[UUID] = None
    ) -> LineItemAudit:
        """Create an audit log entry"""
        audit = LineItemAudit(
            line_item_id=line_item_id,
            action=action,
            old_values=old_values,
            new_values=new_values,
            changed_by=changed_by
        )
        
        # Calculate price verification if applicable
        if action in ['CREATE', 'UPDATE'] and new_values:
            if new_values.get('type') == 'xactimate':
                calculated = sum([
                    new_values.get('lab', 0),
                    new_values.get('mat', 0),
                    new_values.get('equ', 0),
                    new_values.get('labor_burden', 0),
                    new_values.get('market_condition', 0)
                ])
                stored = new_values.get('untaxed_unit_price', 0)
                audit.calculated_price = calculated
                audit.stored_price = stored
                audit.price_match = abs(calculated - stored) < 0.01
        
        self.db.add(audit)
        self.db.commit()
        
        return audit
    
    # =====================================================
    # Performance Optimized Queries
    # =====================================================
    
    def get_line_items_for_invoice(self, invoice_id: UUID) -> List[Dict]:
        """Get line items for an invoice with optimized loading"""
        from app.domains.invoice.models import InvoiceItem
        
        result = self.db.query(
            InvoiceItem,
            LineItem,
            func.json_agg(
                func.json_build_object(
                    'id', LineItemNote.id,
                    'title', LineItemNote.title,
                    'content', LineItemNote.content
                )
            ).label('notes')
        )\
        .join(LineItem, InvoiceItem.line_item_id == LineItem.id, isouter=True)\
        .join(LineItemNoteMapping, LineItem.id == LineItemNoteMapping.line_item_id, isouter=True)\
        .join(LineItemNote, LineItemNoteMapping.note_id == LineItemNote.id, isouter=True)\
        .filter(InvoiceItem.invoice_id == invoice_id)\
        .group_by(InvoiceItem.id, LineItem.id)\
        .all()
        
        return [
            {
                'invoice_item': item[0],
                'line_item': item[1],
                'notes': item[2] if item[2] else []
            }
            for item in result
        ]
    
    def search_line_items_fulltext(self, search_term: str, limit: int = 20) -> List[LineItem]:
        """Full-text search using PostgreSQL trigram"""
        return self.db.query(LineItem)\
            .filter(
                func.similarity(LineItem.description, search_term) > 0.3
            )\
            .order_by(
                func.similarity(LineItem.description, search_term).desc()
            )\
            .limit(limit)\
            .all()