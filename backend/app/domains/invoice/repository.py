"""
Invoice domain repository implementations for different database providers.
"""

import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from app.common.base_repository import SQLAlchemyRepository, SupabaseRepository
from app.core.config import settings
from app.core.interfaces import DatabaseSession
from app.domains.invoice.models import Invoice, InvoiceItem

logger = logging.getLogger(__name__)


class InvoiceRepositoryMixin:
    """Mixin with invoice-specific methods"""
    
    def get_by_invoice_number(self, invoice_number: str) -> Optional[Dict[str, Any]]:
        """Get invoice by invoice number"""
        invoices = self.get_all(filters={'invoice_number': invoice_number}, limit=1)
        return invoices[0] if invoices else None
    
    def get_invoices_by_status(self, status: str) -> List[Dict[str, Any]]:
        """Get invoices by status"""
        return self.get_all(filters={'status': status}, order_by='-updated_at')
    
    def get_invoices_by_company(self, company_id: str) -> List[Dict[str, Any]]:
        """Get invoices for a specific company"""
        return self.get_all(filters={'company_id': company_id}, order_by='-updated_at')
    
    def get_invoices_by_date_range(self, 
                                   start_date: date, 
                                   end_date: date) -> List[Dict[str, Any]]:
        """Get invoices within a date range"""
        # This will be implemented differently for each database type
        raise NotImplementedError("Subclasses must implement get_invoices_by_date_range")
    
    def get_overdue_invoices(self) -> List[Dict[str, Any]]:
        """Get overdue invoices"""
        # This will be implemented differently for each database type
        raise NotImplementedError("Subclasses must implement get_overdue_invoices")
    
    def calculate_totals(self, invoice_data: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate invoice totals based on items and tax configuration"""
        items = invoice_data.get('items', [])
        tax_method = invoice_data.get('tax_method', 'percentage')
        tax_rate = invoice_data.get('tax_rate', 0)
        tax_amount = invoice_data.get('tax_amount', 0)
        
        subtotal = Decimal('0')
        item_level_tax = Decimal('0')
        
        # Calculate subtotal and item-level taxes
        for item in items:
            quantity = Decimal(str(item.get('quantity', 1)))
            rate = Decimal(str(item.get('rate', 0)))
            taxable = item.get('taxable', True)
            item_tax_rate = Decimal(str(item.get('tax_rate', 0)))
            
            item_amount = quantity * rate
            subtotal += item_amount
            
            # Add item-level tax if taxable and item has tax rate
            if taxable and item_tax_rate > 0:
                item_tax = item_amount * (item_tax_rate / 100)
                item_level_tax += item_tax
        
        # Calculate invoice-level tax
        invoice_tax = Decimal('0')
        if tax_method == 'percentage' and tax_rate > 0:
            # Apply percentage to subtotal
            invoice_tax = subtotal * (Decimal(str(tax_rate)) / 100)
        elif tax_method == 'specific' and tax_amount > 0:
            # Use specific tax amount
            invoice_tax = Decimal(str(tax_amount))
        
        # Total tax is sum of item-level and invoice-level taxes
        total_tax = item_level_tax + invoice_tax
        
        # Apply discount
        discount = Decimal(str(invoice_data.get('discount_amount', 0)))
        total = subtotal + total_tax - discount
        
        return {
            'subtotal': float(subtotal),
            'tax_amount': float(total_tax),
            'total_amount': float(total)
        }


class InvoiceSQLAlchemyRepository(SQLAlchemyRepository, InvoiceRepositoryMixin):
    """SQLAlchemy-based invoice repository for SQLite/PostgreSQL"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, Invoice)

    def _generate_item_code(self, description: str) -> str:
        """
        Generate item code from description.
        Uses uppercase letters, numbers, and underscores only.
        """
        import re
        from datetime import datetime
        
        if not description or not description.strip():
            return f"ITEM_{datetime.now().strftime('%H%M%S')[:6]}"
        
        # Extract alphanumeric words
        words = re.findall(r'[a-zA-Z0-9]+', description)
        
        if not words:
            return f"ITEM_{datetime.now().strftime('%H%M%S')[:6]}"
        
        # Filter out very short words (< 2 chars) unless it's the only word
        meaningful_words = [w for w in words if len(w) >= 2] or words[:1]
        
        code = ''
        if len(meaningful_words) == 1:
            # Single word: take first 7 chars
            code = meaningful_words[0][:7]
        elif len(meaningful_words) == 2:
            # Two words: 4 chars from first + 3 chars from second
            code = meaningful_words[0][:4] + meaningful_words[1][:3]
        else:
            # Multiple words: 3+2+2 chars from first 3 words
            code = (meaningful_words[0][:3] +
                   meaningful_words[1][:2] +
                   meaningful_words[2][:2])
        
        # Ensure minimum length of 3
        if len(code) < 3:
            timestamp = datetime.now().strftime('%H%M%S')
            code = (code + timestamp)[:7]
        
        # Truncate to max 7 chars and uppercase
        return code[:7].upper()

    def _ensure_line_item_id(
            self, item_data: Dict[str, Any],
            company_id: Optional[str] = None
    ) -> Optional[str]:
        """
        Ensure invoice item has line_item_id by creating in library if needed.
        Returns the line_item_id (existing or newly created).
        """
        # If item already has line_item_id, return it
        if item_data.get('line_item_id'):
            logger.info(
                f"Item already has line_item_id: "
                f"{item_data.get('line_item_id')}"
            )
            return item_data.get('line_item_id')

        # Create line item in library
        try:
            from app.domains.line_items.models import LineItem, LineItemType

            # Get description for item code generation
            description = item_data.get(
                'name', item_data.get('description', '')
            )

            # Prepare line item data
            line_item_data = {
                'type': LineItemType.CUSTOM,
                'cat': None,  # NULL for custom items (FK constraint)
                'item': self._generate_item_code(description),
                'description': description,
                'includes': item_data.get('description', ''),
                'unit': item_data.get('unit', 'EA'),
                'untaxed_unit_price': Decimal(
                    str(item_data.get('rate', 0))
                ),
                'company_id': company_id,
                'is_active': True,
            }

            # Create line item
            line_item = LineItem(**line_item_data)
            self.db_session.add(line_item)
            self.db_session.flush()  # Flush to get the ID

            logger.info(
                f"Created line item in library with ID: {line_item.id}, "
                f"item code: {line_item.item}"
            )
            return str(line_item.id)

        except Exception as e:
            logger.warning(
                f"Failed to create line item in library: {e}"
            )
            # Don't fail invoice creation/update if library save fails
            return None
    
    def get_by_id(self, entity_id: str) -> Optional[Dict[str, Any]]:
        """Override to include items when getting invoice by ID"""
        return self.get_with_items(entity_id)
    
    def get_invoices_by_date_range(self, 
                                   start_date: date, 
                                   end_date: date) -> List[Dict[str, Any]]:
        """Get invoices within a date range using SQLAlchemy"""
        try:
            entities = self.db_session.query(Invoice).filter(
                Invoice.invoice_date >= start_date,
                Invoice.invoice_date <= end_date
            ).order_by(Invoice.updated_at.desc()).all()
            
            return [self._convert_to_dict(entity) for entity in entities]
            
        except Exception as e:
            logger.error(f"Error getting invoices by date range: {e}")
            raise Exception(f"Failed to get invoices by date range: {e}")
    
    def get_overdue_invoices(self) -> List[Dict[str, Any]]:
        """Get overdue invoices using SQLAlchemy"""
        try:
            current_date = datetime.utcnow().date()
            
            entities = self.db_session.query(Invoice).filter(
                Invoice.due_date < current_date,
                Invoice.status.in_(['pending', 'sent'])
            ).order_by(Invoice.due_date.asc()).all()
            
            return [self._convert_to_dict(entity) for entity in entities]
            
        except Exception as e:
            logger.error(f"Error getting overdue invoices: {e}")
            raise Exception(f"Failed to get overdue invoices: {e}")
    
    def get_with_items(self, invoice_id: str) -> Optional[Dict[str, Any]]:
        """Get invoice with its items and company info"""
        try:
            # Query invoice - don't use joinedload for company as we'll fetch fresh
            invoice = self.db_session.query(Invoice).filter(
                Invoice.id == invoice_id
            ).first()

            if not invoice:
                return None

            # Refresh to ensure we have latest company_id
            self.db_session.refresh(invoice)

            invoice_dict = self._convert_to_dict(invoice)

            # Add company info if available
            # Always fetch fresh company info from company_id
            # to ensure it's up-to-date
            company_id = invoice_dict.get('company_id') or invoice.company_id
            logger.info(f"get_with_items: invoice_id={invoice_id}, company_id={company_id}")
            if company_id:
                try:
                    from app.domains.company.repository import get_company_repository
                    company_repo = get_company_repository(self.db_session)
                    company_info = company_repo.get_by_id(
                        str(company_id)
                    )
                    logger.info(f"get_with_items: fetched company_info={company_info.get('name') if company_info else None}")
                    if company_info:
                        invoice_dict['company_name'] = (
                            company_info.get('name', '')
                        )
                        invoice_dict['company_address'] = (
                            company_info.get('address', '')
                        )
                        invoice_dict['company_city'] = (
                            company_info.get('city', '')
                        )
                        invoice_dict['company_state'] = (
                            company_info.get('state', '')
                        )
                        invoice_dict['company_zip'] = (
                            company_info.get('zipcode', '')
                        )
                        invoice_dict['company_phone'] = (
                            company_info.get('phone', '')
                        )
                        invoice_dict['company_email'] = (
                            company_info.get('email', '')
                        )
                        invoice_dict['company_logo'] = (
                            company_info.get('logo')
                        )
                    elif invoice.company:
                        # Fallback to relationship if repository fails
                        invoice_dict['company_name'] = (
                            invoice.company.name or ''
                        )
                        invoice_dict['company_address'] = (
                            invoice.company.address or ''
                        )
                        invoice_dict['company_city'] = (
                            invoice.company.city or ''
                        )
                        invoice_dict['company_state'] = (
                            invoice.company.state or ''
                        )
                        invoice_dict['company_zip'] = (
                            invoice.company.zipcode or ''
                        )
                        invoice_dict['company_phone'] = (
                            invoice.company.phone or ''
                        )
                        invoice_dict['company_email'] = (
                            invoice.company.email or ''
                        )
                        invoice_dict['company_logo'] = (
                            invoice.company.logo or None
                        )
                except Exception as e:
                    logger.warning(
                        f"Error fetching company info from repository, "
                        f"using relationship: {e}"
                    )
                    # Fallback to relationship
                    if invoice.company:
                        invoice_dict['company_name'] = (
                            invoice.company.name or ''
                        )
                        invoice_dict['company_address'] = (
                            invoice.company.address or ''
                        )
                        invoice_dict['company_city'] = (
                            invoice.company.city or ''
                        )
                        invoice_dict['company_state'] = (
                            invoice.company.state or ''
                        )
                        invoice_dict['company_zip'] = (
                            invoice.company.zipcode or ''
                        )
                        invoice_dict['company_phone'] = (
                            invoice.company.phone or ''
                        )
                        invoice_dict['company_email'] = (
                            invoice.company.email or ''
                        )
                        invoice_dict['company_logo'] = (
                            invoice.company.logo or None
                        )

            # Get items
            items = self.db_session.query(InvoiceItem).filter(
                InvoiceItem.invoice_id == invoice_id
            ).order_by(InvoiceItem.order_index).all()

            # Note: We no longer auto-create line_item_id
            # Items without line_item_id are one-time use items
            # that user chose not to save to library

            # Debug logging removed for performance

            invoice_dict['items'] = [self._convert_to_dict(item) for item in items]

            return invoice_dict

        except Exception as e:
            logger.error(f"Error getting invoice with items: {e}")
            raise Exception(f"Failed to get invoice with items: {e}")
    
    def create_with_items(self, invoice_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create invoice with items in a transaction"""
        try:
            # Calculate totals
            totals = self.calculate_totals(invoice_data)
            # Remove non-model fields from totals before updating invoice_data
            totals.pop('items_subtotal', None)
            totals.pop('adjustments', None)
            totals.pop('op_amount', None)
            invoice_data.update(totals)

            # Remove non-model fields from invoice_data that may have been added by service layer
            invoice_data.pop('items_subtotal', None)
            invoice_data.pop('adjustments', None)
            invoice_data.pop('op_amount', None)

            # Extract items
            items_data = invoice_data.pop('items', [])

            # Create invoice
            invoice = self.create(invoice_data)
            invoice_id = invoice['id']

            # Create items
            for idx, item_data in enumerate(items_data):
                # Only use line_item_id if provided by frontend
                # Don't auto-create - respect user's choice
                line_item_id = item_data.get('line_item_id')

                # Calculate item amount and tax
                quantity = float(item_data.get('quantity', 1))
                rate = float(item_data.get('rate', 0))
                amount = quantity * rate

                # Calculate item tax if taxable
                taxable = item_data.get('taxable', True)
                item_tax_rate = float(item_data.get('tax_rate', 0))
                tax_amount = (amount * (item_tax_rate / 100)
                             if taxable and item_tax_rate > 0 else 0)

                # Filter and map fields for InvoiceItem model
                valid_fields = {
                    'invoice_id': invoice_id,
                    'order_index': idx,
                    'name': item_data.get(
                        'name', item_data.get('description', '')
                    ),
                    'description': item_data.get('description'),
                    'note': item_data.get('note'),
                    'quantity': quantity,
                    'unit': item_data.get('unit', 'ea'),
                    'rate': rate,
                    'amount': amount,
                    'taxable': taxable,
                    'tax_rate': item_tax_rate,
                    'tax_amount': tax_amount,
                    'line_item_id': line_item_id,  # Use provided ID only
                    'is_custom_override': item_data.get(
                        'is_custom_override', False
                    ),
                    'override_values': item_data.get('override_values'),
                    # Section/Group fields
                    'primary_group': item_data.get('primary_group'),
                    'secondary_group': item_data.get('secondary_group'),
                    'sort_order': item_data.get('sort_order', 0)
                }

                # Remove None values except for nullable fields (note, description, etc.)
                nullable_fields = {'note', 'description', 'line_item_id', 'override_values', 'secondary_group'}
                filtered_fields = {k: v for k, v in valid_fields.items() if v is not None or k in nullable_fields}

                item_entity = InvoiceItem(**filtered_fields)
                self.db_session.add(item_entity)

            self.db_session.flush()
            self.db_session.commit()

            # Return invoice with items
            return self.get_with_items(invoice_id)

        except Exception as e:
            logger.error(f"Error creating invoice with items: {e}")
            self.db_session.rollback()
            raise Exception(f"Failed to create invoice with items: {e}")
    
    def update_with_items(self, invoice_id: str, update_data: Dict[str, Any]) -> Dict[str, Any]:
        """Update invoice with items in a transaction"""
        try:
            # Extract items if present
            items_data = update_data.pop('items', None)
            
            # Items data will be handled separately - totals are already calculated in service layer
            
            # Update invoice fields (without items)
            invoice = self.db_session.query(Invoice).filter(
                Invoice.id == invoice_id
            ).first()
            
            if not invoice:
                raise Exception(f"Invoice {invoice_id} not found")
            
            # Update invoice fields
            logger.info(f"Updating invoice fields: {list(update_data.keys())}")
            if 'company_id' in update_data:
                logger.info(f"Updating company_id from {invoice.company_id} to {update_data['company_id']}")
            
            for key, value in update_data.items():
                if hasattr(invoice, key):
                    old_value = getattr(invoice, key, None)
                    
                    # Handle company_id - UUIDType will handle conversion
                    # Just ensure it's a valid string format if it's a string
                    if key == 'company_id' and value is not None:
                        # UUIDType accepts both string and UUID, but let's ensure it's a valid format
                        if isinstance(value, str):
                            try:
                                import uuid
                                # Validate UUID format but keep as string
                                uuid.UUID(value)
                            except (ValueError, AttributeError):
                                logger.warning(f"Invalid UUID format for company_id: {value}")
                                value = None
                    
                    setattr(invoice, key, value)
                    new_value = getattr(invoice, key, None)
                    if key == 'company_id':
                        logger.info(f"Set company_id: {old_value} -> {new_value} (type: {type(new_value)})")
                        # Force SQLAlchemy to detect the change even if value appears the same
                        from sqlalchemy.orm.attributes import flag_modified
                        flag_modified(invoice, 'company_id')
                else:
                    logger.warning(f"Field {key} not found on Invoice model")
            
            # Update timestamp
            if hasattr(invoice, 'updated_at'):
                invoice.updated_at = datetime.utcnow()
            
            # Verify company_id was set correctly
            logger.info(f"After update, invoice.company_id = {invoice.company_id}")
            
            # Explicitly ensure company_id is updated if it's in update_data
            if 'company_id' in update_data:
                company_id_value = update_data['company_id']
                # Convert to proper type for comparison
                if isinstance(company_id_value, str):
                    import uuid
                    try:
                        company_id_value = uuid.UUID(company_id_value)
                    except (ValueError, AttributeError):
                        pass
                
                # Compare current value with new value
                current_company_id = invoice.company_id
                if isinstance(current_company_id, str):
                    try:
                        current_company_id = uuid.UUID(current_company_id)
                    except (ValueError, AttributeError):
                        pass
                
                # If different, force update
                if str(current_company_id) != str(company_id_value):
                    logger.info(f"Force updating company_id: {current_company_id} -> {company_id_value}")
                    invoice.company_id = company_id_value
                    from sqlalchemy.orm.attributes import flag_modified
                    flag_modified(invoice, 'company_id')
                elif company_id_value is not None:
                    # Even if same, ensure it's marked as modified if explicitly provided
                    logger.info(f"Company_id explicitly provided, ensuring it's in UPDATE")
                    from sqlalchemy.orm.attributes import flag_modified
                    flag_modified(invoice, 'company_id')
            
            # Handle items if provided
            if items_data is not None:
                # Delete existing items
                self.db_session.query(InvoiceItem).filter(
                    InvoiceItem.invoice_id == invoice_id
                ).delete()

                # Create new items
                for idx, item_data in enumerate(items_data):
                    # Only use line_item_id if provided
                    # Don't auto-create - respect user's choice
                    line_item_id = item_data.get('line_item_id')

                    # Calculate item amount and tax
                    quantity = float(item_data.get('quantity', 1))
                    rate = float(item_data.get('rate', 0))
                    amount = quantity * rate

                    # Calculate item tax if taxable
                    taxable = item_data.get('taxable', True)
                    item_tax_rate = float(item_data.get('tax_rate', 0))
                    tax_amount = (amount * (item_tax_rate / 100)
                                 if taxable and item_tax_rate > 0 else 0)

                    # Filter and map fields for InvoiceItem model
                    valid_fields = {
                        'invoice_id': invoice_id,
                        'order_index': idx,
                        'name': item_data.get(
                            'name', item_data.get('description', '')
                        ),
                        'description': item_data.get('description'),
                        'note': item_data.get('note'),
                        'quantity': quantity,
                        'unit': item_data.get('unit', 'ea'),
                        'rate': rate,
                        'amount': amount,
                        'taxable': taxable,
                        'tax_rate': item_tax_rate,
                        'tax_amount': tax_amount,
                        'line_item_id': line_item_id,  # Use provided ID only
                        'is_custom_override': item_data.get(
                            'is_custom_override', False
                        ),
                        'override_values': item_data.get('override_values'),
                        # Section/Group fields
                        'primary_group': item_data.get('primary_group'),
                        'secondary_group': item_data.get('secondary_group'),
                        'sort_order': item_data.get('sort_order', 0)
                    }

                    # Remove None values except for nullable fields (note, description, etc.)
                    nullable_fields = {'note', 'description', 'line_item_id', 'override_values', 'secondary_group'}
                    filtered_fields = {k: v for k, v in valid_fields.items() if v is not None or k in nullable_fields}

                    item_entity = InvoiceItem(**filtered_fields)
                    self.db_session.add(item_entity)

            # Before flush, ensure company_id is properly set if it was in update_data
            if 'company_id' in update_data:
                company_id_value = update_data['company_id']
                # Ensure it's set and marked as modified
                if company_id_value is not None:
                    # Convert to UUID if string
                    if isinstance(company_id_value, str):
                        import uuid
                        try:
                            company_id_value = uuid.UUID(company_id_value)
                        except (ValueError, AttributeError):
                            pass
                    invoice.company_id = company_id_value
                    from sqlalchemy.orm.attributes import flag_modified
                    flag_modified(invoice, 'company_id')
                    logger.info(f"Before flush, forced company_id = {invoice.company_id}")
                else:
                    invoice.company_id = None
                    from sqlalchemy.orm.attributes import flag_modified
                    flag_modified(invoice, 'company_id')
                    logger.info(f"Before flush, forced company_id = None")
            
            self.db_session.flush()
            
            # Verify company_id before commit
            if 'company_id' in update_data:
                logger.info(f"Before commit, invoice.company_id = {invoice.company_id}")
            
            self.db_session.commit()
            
            # Verify company_id after commit
            if 'company_id' in update_data:
                # Re-query to verify it was saved
                saved_invoice = self.db_session.query(Invoice).filter(
                    Invoice.id == invoice_id
                ).first()
                if saved_invoice:
                    logger.info(f"After commit, saved_invoice.company_id = {saved_invoice.company_id}")

            # Refresh session to reload relationships after commit
            # Especially important when company_id is updated
            self.db_session.expire_all()
            
            # Explicitly expire company relationship if company_id was updated
            if 'company_id' in update_data:
                # Re-query the invoice to ensure we have the latest data
                invoice = self.db_session.query(Invoice).filter(
                    Invoice.id == invoice_id
                ).first()
                if invoice:
                    logger.info(f"Before get_with_items, invoice.company_id = {invoice.company_id}")
                    # Expire the company relationship to force reload
                    self.db_session.expire(invoice, ['company'])

            # Return updated invoice with items
            # This will fetch fresh company info from repository
            result = self.get_with_items(invoice_id)
            if result and 'company_id' in update_data:
                logger.info(f"get_with_items returned company_id = {result.get('company_id')}")
                logger.info(f"get_with_items returned company_name = {result.get('company_name')}")
            return result
            
        except Exception as e:
            logger.error(f"Error updating invoice with items: {e}")
            self.db_session.rollback()
            raise Exception(f"Failed to update invoice with items: {e}")


class InvoiceSupabaseRepository(SupabaseRepository, InvoiceRepositoryMixin):
    """Supabase-based invoice repository"""
    
    def __init__(self, session: DatabaseSession):
        super().__init__(session, "invoices", Invoice)
    
    def get_invoices_by_date_range(self, 
                                   start_date: date, 
                                   end_date: date) -> List[Dict[str, Any]]:
        """Get invoices within a date range using Supabase"""
        try:
            response = self.client.table('invoices').select('*').gte(
                'invoice_date', start_date.isoformat()
            ).lte(
                'invoice_date', end_date.isoformat()
            ).order('updated_at', desc=True).execute()
            
            return response.data if response.data else []
            
        except Exception as e:
            logger.error(f"Error getting invoices by date range from Supabase: {e}")
            raise Exception(f"Failed to get invoices by date range: {e}")
    
    def get_overdue_invoices(self) -> List[Dict[str, Any]]:
        """Get overdue invoices using Supabase"""
        try:
            current_date = datetime.utcnow().date().isoformat()
            
            response = self.client.table('invoices').select('*').lt(
                'due_date', current_date
            ).in_('status', ['pending', 'sent']).order('due_date', desc=False).execute()
            
            return response.data if response.data else []
            
        except Exception as e:
            logger.error(f"Error getting overdue invoices from Supabase: {e}")
            raise Exception(f"Failed to get overdue invoices: {e}")
    
    def get_with_items(self, invoice_id: str) -> Optional[Dict[str, Any]]:
        """Get invoice with its items"""
        try:
            # Get invoice
            invoice_response = self.client.table('invoices').select('*').eq('id', invoice_id).execute()
            
            if not invoice_response.data:
                return None
            
            invoice = invoice_response.data[0]
            
            # Get items
            items_response = self.client.table('invoice_items').select('*').eq(
                'invoice_id', invoice_id
            ).order('order_index').execute()
            
            invoice['items'] = items_response.data if items_response.data else []
            
            return invoice
            
        except Exception as e:
            logger.error(f"Error getting invoice with items from Supabase: {e}")
            raise Exception(f"Failed to get invoice with items: {e}")
    
    def create_with_items(self, invoice_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create invoice with items (Supabase doesn't support transactions, so we handle errors)"""
        try:
            # Calculate totals
            totals = self.calculate_totals(invoice_data)
            # Remove non-model fields from totals before updating invoice_data
            totals.pop('items_subtotal', None)
            totals.pop('adjustments', None)
            totals.pop('op_amount', None)
            invoice_data.update(totals)

            # Remove non-model fields from invoice_data that may have been added by service layer
            invoice_data.pop('items_subtotal', None)
            invoice_data.pop('adjustments', None)
            invoice_data.pop('op_amount', None)

            # Extract items
            items_data = invoice_data.pop('items', [])

            # Create invoice
            invoice = self.create(invoice_data)
            invoice_id = invoice['id']

            # Create items
            for idx, item_data in enumerate(items_data):
                # Only use line_item_id if provided by frontend
                # Don't auto-create - respect user's choice
                item_data['invoice_id'] = invoice_id
                item_data['order_index'] = idx

                try:
                    self.client.table('invoice_items').insert(item_data).execute()
                except Exception as item_error:
                    logger.error(f"Error creating invoice item: {item_error}")
                    # If item creation fails, we should ideally delete the invoice
                    # For now, we'll continue and let the invoice exist without all items
                    continue

            # Return invoice with items
            return self.get_with_items(invoice_id)

        except Exception as e:
            logger.error(f"Error creating invoice with items in Supabase: {e}")
            raise Exception(f"Failed to create invoice with items: {e}")

    def _ensure_line_item_id_supabase(self, item_data: Dict[str, Any], company_id: Optional[str] = None) -> Optional[str]:
        """
        Ensure that an invoice item has a line_item_id by creating one in the library if needed.
        Supabase-specific implementation.
        """
        try:
            # Prepare line item data
            line_item_data = {
                'cat': '',  # Empty for custom items
                'item': item_data.get('name', item_data.get('description', ''))[:50],  # Truncate to 50 chars
                'description': item_data.get('name', item_data.get('description', '')),
                'includes': item_data.get('description', ''),
                'unit': item_data.get('unit', 'EA'),
                'untaxed_unit_price': float(item_data.get('rate', 0)),
                'company_id': company_id,
                'is_active': True,
                'type': 'custom'  # Mark as custom item
            }

            # Create line item in Supabase
            result = self.client.table('line_items').insert(line_item_data).execute()

            if result.data and len(result.data) > 0:
                logger.info(f"Created line item in library with ID: {result.data[0]['id']}")
                return result.data[0]['id']

            return None

        except Exception as e:
            logger.warning(f"Failed to create line item in library: {e}")
            # Don't fail the invoice creation if library save fails
            return None
    
    def create(self, entity_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create invoice with Supabase-specific handling"""
        # Remove fields that might cause issues in Supabase
        clean_data = entity_data.copy()
        
        # Convert Decimal values to float
        for key, value in clean_data.items():
            if isinstance(value, Decimal):
                clean_data[key] = float(value)
        
        # Ensure payments field is properly formatted for JSON storage
        if 'payments' in clean_data:
            payments = clean_data['payments']
            if payments is None:
                clean_data['payments'] = []
            elif isinstance(payments, list):
                # Ensure each payment record is properly formatted
                clean_payments = []
                for payment in payments:
                    if isinstance(payment, dict):
                        clean_payments.append(payment)
                clean_data['payments'] = clean_payments
        
        # Remove None values
        clean_data = {k: v for k, v in clean_data.items() if v is not None}
        
        # Remove timestamp fields (they're auto-managed by Supabase)
        clean_data.pop('created_at', None)
        clean_data.pop('updated_at', None)
        
        return super().create(clean_data)


def get_invoice_repository(session: DatabaseSession) -> InvoiceRepositoryMixin:
    """Factory function to get appropriate invoice repository based on database type"""
    
    actual_session = session
    
    # Handle different wrapper types
    # 1. UnitOfWork objects have a 'session' attribute
    if hasattr(session, 'session') and session.session is not None:
        actual_session = session.session
    
    # 2. SQLAlchemySession wrapper has '_session' attribute
    if hasattr(actual_session, '_session') and actual_session._session is not None:
        actual_session = actual_session._session
    
    # 3. For direct SQLAlchemy sessions, check for common attributes
    if hasattr(actual_session, 'query') or hasattr(actual_session, 'execute'):
        # This is a SQLAlchemy session
        return InvoiceSQLAlchemyRepository(actual_session)
    
    # 4. Check if it's actually a SQLAlchemy session by checking for bind
    if hasattr(actual_session, 'bind'):
        return InvoiceSQLAlchemyRepository(actual_session)
    
    # 5. Otherwise assume it's a Supabase client
    return InvoiceSupabaseRepository(actual_session)