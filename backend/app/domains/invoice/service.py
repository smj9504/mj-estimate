"""
Invoice domain service with comprehensive business logic and validation.
"""

import logging
from copy import deepcopy
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from app.common.base_service import TransactionalService
from app.core.database_factory import get_database
from app.core.interfaces import DatabaseProvider
from app.domains.invoice.repository import get_invoice_repository

logger = logging.getLogger(__name__)


class InvoiceService(TransactionalService[Dict[str, Any], str]):
    """
    Service for invoice-related business operations.
    Provides comprehensive CRUD operations with validation and business logic.
    """
    
    def __init__(self, database: DatabaseProvider = None):
        super().__init__(database)
    
    def get_repository(self):
        """Get the invoice repository"""
        from app.domains.invoice.repository import get_invoice_repository
        session = self.database.get_session()
        return get_invoice_repository(session)

    def get_readonly_repository(self):
        """Get the invoice repository with read-only session"""
        from app.domains.invoice.repository import get_invoice_repository
        session = self.database.get_readonly_session()
        return get_invoice_repository(session)
    
    def _get_repository_instance(self, session):
        """Get invoice repository instance with the given session"""
        return get_invoice_repository(session)
    
    def get_all(self,
                status: Optional[str] = None,
                limit: Optional[int] = None,
                offset: Optional[int] = None,
                filters: Optional[Dict[str, Any]] = None,
                order_by: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get all invoices with optional filtering, ordering, and pagination.

        Args:
            status: Optional status filter
            limit: Maximum number of results to return
            offset: Number of results to skip
            filters: Additional dictionary of field-value pairs to filter by
            order_by: Field to order by (prefix with '-' for descending)

        Returns:
            List of invoice dictionaries
        """
        try:
            # Build filters dictionary
            all_filters = filters.copy() if filters else {}
            if status:
                all_filters['status'] = status

            # Default order by updated_at descending if not specified
            if not order_by:
                order_by = '-updated_at'

            # Use read-only repository for SELECT operations
            repository = self.get_readonly_repository()

            with repository.session:
                return repository.get_all(
                    filters=all_filters,
                    order_by=order_by,
                    limit=limit,
                    offset=offset
                )
        except Exception as e:
            logger.error(f"Error getting invoices: {e}")
            raise
    
    def get_by_invoice_number(self, invoice_number: str) -> Optional[Dict[str, Any]]:
        """
        Get invoice by invoice number.

        Args:
            invoice_number: Invoice number

        Returns:
            Invoice dictionary or None if not found
        """
        try:
            with self.database.get_readonly_session() as session:
                repository = self._get_repository_instance(session)
                return repository.get_by_invoice_number(invoice_number)
        except Exception as e:
            logger.error(f"Error getting invoice by number: {e}")
            raise

    def get_invoices_by_status(self, status: str) -> List[Dict[str, Any]]:
        """
        Get invoices by status.

        Args:
            status: Invoice status

        Returns:
            List of invoice dictionaries
        """
        try:
            with self.database.get_readonly_session() as session:
                repository = self._get_repository_instance(session)
                return repository.get_invoices_by_status(status)
        except Exception as e:
            logger.error(f"Error getting invoices by status: {e}")
            raise

    def get_invoices_by_company(self, company_id: str) -> List[Dict[str, Any]]:
        """
        Get invoices for a specific company.

        Args:
            company_id: Company ID

        Returns:
            List of invoice dictionaries
        """
        try:
            with self.database.get_readonly_session() as session:
                repository = self._get_repository_instance(session)
                return repository.get_invoices_by_company(company_id)
        except Exception as e:
            logger.error(f"Error getting invoices by company: {e}")
            raise
    
    def get_invoices_by_date_range(self, 
                                   start_date: date, 
                                   end_date: date) -> List[Dict[str, Any]]:
        """
        Get invoices within a date range.
        
        Args:
            start_date: Start date
            end_date: End date
            
        Returns:
            List of invoice dictionaries
        """
        try:
            with self.database.get_session() as session:
                repository = self._get_repository_instance(session)
                return repository.get_invoices_by_date_range(start_date, end_date)
        except Exception as e:
            logger.error(f"Error getting invoices by date range: {e}")
            raise
    
    def get_overdue_invoices(self) -> List[Dict[str, Any]]:
        """
        Get overdue invoices.
        
        Returns:
            List of overdue invoice dictionaries
        """
        try:
            with self.database.get_session() as session:
                repository = self._get_repository_instance(session)
                return repository.get_overdue_invoices()
        except Exception as e:
            logger.error(f"Error getting overdue invoices: {e}")
            raise
    
    def get_with_items(self, invoice_id: str) -> Optional[Dict[str, Any]]:
        """
        Get invoice with its items.
        
        Args:
            invoice_id: Invoice ID
            
        Returns:
            Invoice dictionary with items or None if not found
        """
        try:
            with self.database.get_session() as session:
                repository = self._get_repository_instance(session)
                return repository.get_with_items(invoice_id)
        except Exception as e:
            logger.error(f"Error getting invoice with items: {e}")
            raise
    
    def create_with_items(self, invoice_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Create invoice with items in a single transaction.
        
        Args:
            invoice_data: Invoice data including items
            
        Returns:
            Created invoice dictionary with items
        """
        def _create_operation(session_or_uow, data):
            repository = self._get_repository_instance(session_or_uow)
            return repository.create_with_items(data)
        
        # Validate data
        validated_data = self._validate_create_data(invoice_data)
        
        # Generate invoice number if not provided
        if not validated_data.get('invoice_number'):
            validated_data['invoice_number'] = self._generate_invoice_number()
        
        return self.execute_in_transaction(_create_operation, validated_data)
    
    def update_with_items(self, invoice_id: str, invoice_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Update invoice with items.
        
        Args:
            invoice_id: Invoice ID
            invoice_data: Updated invoice data including items
            
        Returns:
            Updated invoice dictionary with items
        """
        def _update_operation(session, invoice_id, data):
            repository = self._get_repository_instance(session)
            
            # Use the repository's update_with_items method
            return repository.update_with_items(invoice_id, data)
        
        validated_data = self._validate_update_data(invoice_data)
        
        return self.execute_in_transaction(_update_operation, invoice_id, validated_data)
    
    def duplicate(self, invoice_id: str) -> Optional[Dict[str, Any]]:
        """
        Duplicate an existing invoice, including its items.

        Args:
            invoice_id: ID of the invoice to duplicate

        Returns:
            Newly created invoice dictionary with items, or None if the
            source invoice does not exist
        """
        try:
            original = self.get_with_items(invoice_id)
            if not original:
                return None

            invoice_data = deepcopy(original)

            # Remove identity/system fields so a new record is created
            for field in ['id', 'created_at', 'updated_at', 'invoice_number']:
                invoice_data.pop(field, None)

            # Remove derived fields injected by get_with_items() that are not
            # columns on the Invoice model (they come from a company join)
            for field in [
                'company_name', 'company_address', 'company_city',
                'company_state', 'company_zip', 'company_phone',
                'company_email', 'company_logo',
            ]:
                invoice_data.pop(field, None)

            # Reset document-specific state for the copy
            # (create_with_items() recalculates totals and balance_due)
            invoice_data['invoice_number'] = self._generate_invoice_number()
            invoice_data['status'] = 'draft'
            invoice_data['payments'] = []
            invoice_data['has_receipt'] = False
            invoice_data['receipt_number'] = None
            invoice_data['receipt_generated_at'] = None

            # Strip item identity fields; create_with_items() maps items via
            # an explicit field whitelist, so extra keys are harmless, but
            # dropping them avoids any accidental reuse of the old item IDs
            for item in invoice_data.get('items', []):
                for field in ['id', 'invoice_id', 'created_at', 'updated_at']:
                    item.pop(field, None)

            return self.create_with_items(invoice_data)
        except Exception as e:
            logger.error(f"Error duplicating invoice {invoice_id}: {e}")
            raise

    def mark_as_paid(self, invoice_id: str, payment_date: datetime = None) -> Optional[Dict[str, Any]]:
        """
        Mark invoice as paid.
        
        Args:
            invoice_id: Invoice ID
            payment_date: Payment date (defaults to now)
            
        Returns:
            Updated invoice dictionary
        """
        payment_date = payment_date or datetime.utcnow()
        
        return self.update(invoice_id, {
            'status': 'paid',
            'payment_date': payment_date
        })
    
    def mark_as_overdue(self, invoice_id: str) -> Optional[Dict[str, Any]]:
        """
        Mark invoice as overdue.
        
        Args:
            invoice_id: Invoice ID
            
        Returns:
            Updated invoice dictionary
        """
        return self.update(invoice_id, {'status': 'overdue'})
    
    def calculate_totals(self, items: List[Dict[str, Any]], tax_method: str = "percentage", tax_rate: float = 0, tax_amount: float = 0, discount_amount: float = 0, op_percent: float = 0, adjustments: Optional[List[Dict[str, Any]]] = None, sections: Optional[List[Dict[str, Any]]] = None, is_lump_sum_document: bool = False, lump_sum_document_amount: Optional[float] = None) -> Dict[str, Any]:
        """
        Calculate invoice totals based on items, adjustments, and tax configuration.

        Args:
            items: List of invoice items
            tax_method: 'percentage' or 'specific'
            tax_rate: Tax rate percentage (for percentage method)
            tax_amount: Specific tax amount (for specific method)
            discount_amount: Discount amount to subtract (DEPRECATED: Use adjustments instead)
            op_percent: O&P percentage to add (DEPRECATED: Use adjustments instead)
            adjustments: List of adjustments to apply (new flexible system)
            sections: Optional section metadata list. Sections with isLumpSum=True
                contribute their lumpSumAmount to the subtotal instead of the sum
                of their items' quantity*rate. Items belonging to a lump-sum
                section (matched via primary_group == section title) are excluded
                from item summation but are NOT removed from the items list itself.
            is_lump_sum_document: When True, the whole document is a lump sum -
                item quantity*rate is not used at all; subtotal/total_amount are
                taken directly from lump_sum_document_amount.
            lump_sum_document_amount: The lump sum amount for the whole document,
                used only when is_lump_sum_document is True.

        Returns:
            Dictionary with calculated totals including adjustments
        """
        if is_lump_sum_document:
            amount = Decimal(str(lump_sum_document_amount or 0))
            return {
                'items_subtotal': float(amount),
                'adjustments': [],
                'op_amount': 0.0,
                'subtotal': float(amount),
                'tax_amount': 0.0,
                'discount_amount': 0.0,
                'total_amount': float(amount)
            }

        try:
            # Sections flagged as lump-sum: their items are excluded from the
            # quantity*rate summation below, and their lumpSumAmount is added
            # to the subtotal once instead. When `sections` is None/empty this
            # dict is empty and behavior is identical to before this feature.
            lump_sum_sections = {
                s.get('title'): s for s in (sections or []) if s.get('isLumpSum')
            }

            items_subtotal = Decimal('0')

            # Calculate items subtotal and track taxable items
            taxable_amount = Decimal('0')
            for item in items:
                if item.get('primary_group') in lump_sum_sections:
                    continue

                quantity = Decimal(str(item.get('quantity', 1)))
                rate = Decimal(str(item.get('rate', 0)))
                taxable = item.get('taxable', True)

                item_amount = quantity * rate
                items_subtotal += item_amount

                # Track taxable amount for percentage tax calculation
                if taxable:
                    taxable_amount += item_amount

            for section in lump_sum_sections.values():
                lump_amount = Decimal(str(section.get('lumpSumAmount', 0) or 0))
                items_subtotal += lump_amount
                if section.get('taxable', True):
                    taxable_amount += lump_amount

            # Apply adjustments in order (new flexible system)
            current_subtotal = items_subtotal
            calculated_adjustments = []
            
            if adjustments:
                # Sort adjustments by order
                sorted_adjustments = sorted(adjustments, key=lambda x: x.get('order', 999))
                
                for adj in sorted_adjustments:
                    percentage = Decimal(str(adj.get('percentage', 0)))
                    fixed_amount = adj.get('fixed_amount')
                    adj_type = adj.get('type', 'add')

                    # Calculate: use fixed_amount when percentage is 0
                    if percentage != 0:
                        adj_amount = current_subtotal * (abs(percentage) / 100)
                    else:
                        adj_amount = abs(Decimal(str(fixed_amount))) if fixed_amount else Decimal('0')

                    # Apply adjustment based on type
                    if adj_type == 'subtract' or percentage < 0:
                        current_subtotal -= adj_amount
                    else:
                        current_subtotal += adj_amount

                    # Preserve all original fields + add calculated amount
                    calculated_adjustments.append({
                        **adj,
                        'amount': float(adj_amount)
                    })
            
            # Backward compatibility: apply op_percent and discount if provided and no adjustments
            op_amount = Decimal('0')
            discount = Decimal('0')
            
            if not adjustments or len(adjustments) == 0:
                # Use legacy op_percent and discount
                if op_percent:
                    op_amount = items_subtotal * (Decimal(str(op_percent)) / 100)
                    current_subtotal = items_subtotal + op_amount
                
                if discount_amount:
                    discount = Decimal(str(discount_amount))
                    current_subtotal -= discount

            # Calculate tax amount on adjusted subtotal
            tax_total = Decimal('0')
            if tax_method == 'percentage' and tax_rate > 0:
                # For percentage tax: apply to adjusted subtotal
                # But only on taxable items proportion
                if taxable_amount > 0 and items_subtotal > 0:
                    # Calculate taxable ratio
                    taxable_ratio = taxable_amount / items_subtotal
                    
                    # Apply same adjustments proportionally to taxable amount
                    taxable_current = taxable_amount
                    
                    if adjustments:
                        for adj in sorted_adjustments:
                            percentage = Decimal(str(adj.get('percentage', 0)))
                            fixed_amount = adj.get('fixed_amount')
                            adj_type = adj.get('type', 'add')

                            if percentage != 0:
                                taxable_adj_amount = taxable_current * (abs(percentage) / 100)
                            else:
                                taxable_adj_amount = abs(Decimal(str(fixed_amount))) * taxable_ratio if fixed_amount else Decimal('0')

                            if adj_type == 'subtract' or percentage < 0:
                                taxable_current -= taxable_adj_amount
                            else:
                                taxable_current += taxable_adj_amount
                    else:
                        # Legacy: apply op_percent and discount proportionally
                        if op_percent:
                            taxable_op_amount = taxable_amount * (Decimal(str(op_percent)) / 100)
                            taxable_current = taxable_amount + taxable_op_amount
                        
                        if discount_amount:
                            taxable_discount = discount * taxable_ratio
                            taxable_current -= taxable_discount
                    
                    # Calculate tax on taxable adjusted amount
                    if taxable_current > 0:
                        tax_total = taxable_current * (Decimal(str(tax_rate)) / 100)
            elif tax_method == 'specific' and tax_amount > 0:
                # Use specific tax amount
                tax_total = Decimal(str(tax_amount))

            # Calculate final total
            total_amount = current_subtotal + tax_total

            return {
                'items_subtotal': float(items_subtotal),
                'adjustments': calculated_adjustments,
                'op_amount': float(op_amount),  # For backward compatibility
                'subtotal': float(current_subtotal),
                'tax_amount': float(tax_total),
                'discount_amount': float(discount),  # For backward compatibility
                'total_amount': float(total_amount)
            }
            
        except Exception as e:
            logger.error(f"Error calculating invoice totals: {e}")
            raise
    
    def get_invoice_summary(self) -> Dict[str, Any]:
        """
        Get comprehensive invoice summary statistics.
        
        Returns:
            Dictionary with invoice statistics
        """
        try:
            all_invoices = self.get_all()
            
            # Group by status
            status_counts = {}
            status_amounts = {}
            
            for invoice in all_invoices:
                status = invoice.get('status', 'unknown')
                amount = float(invoice.get('total_amount', 0))
                
                status_counts[status] = status_counts.get(status, 0) + 1
                status_amounts[status] = status_amounts.get(status, 0) + amount
            
            # Calculate overdue
            overdue_invoices = self.get_overdue_invoices()
            overdue_amount = sum(float(inv.get('total_amount', 0)) for inv in overdue_invoices)
            
            # Calculate totals
            total_amount = sum(float(inv.get('total_amount', 0)) for inv in all_invoices)
            paid_amount = status_amounts.get('paid', 0)
            outstanding_amount = total_amount - paid_amount
            
            return {
                'total_invoices': len(all_invoices),
                'total_amount': total_amount,
                'paid_amount': paid_amount,
                'outstanding_amount': outstanding_amount,
                'overdue_count': len(overdue_invoices),
                'overdue_amount': overdue_amount,
                'status_counts': status_counts,
                'status_amounts': status_amounts,
                'average_invoice_amount': total_amount / len(all_invoices) if all_invoices else 0
            }
            
        except Exception as e:
            logger.error(f"Error getting invoice summary: {e}")
            raise
    
    def _generate_invoice_number(self) -> str:
        """Generate unique invoice number using efficient SQL query"""
        try:
            from sqlalchemy import func, text
            from app.domains.invoice.models import Invoice

            # Get current year and month
            now = datetime.utcnow()
            prefix = f"INV-{now.year}{now.month:02d}"

            # Use direct SQL to count invoices with this prefix (LIKE query)
            with self.database.get_session() as session:
                count = session.query(func.count(Invoice.id)).filter(
                    Invoice.invoice_number.like(f"{prefix}%")
                ).scalar() or 0

                sequence = count + 1
                return f"{prefix}-{sequence:04d}"

        except Exception as e:
            logger.error(f"Error generating invoice number: {e}")
            # Fallback to timestamp-based number
            timestamp = int(datetime.utcnow().timestamp())
            return f"INV-{timestamp}"
    
    def _validate_create_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate data for invoice creation"""
        validated_data = data.copy()
        
        # Remove None values
        validated_data = {k: v for k, v in validated_data.items() if v is not None}
        
        # Validate items
        items = validated_data.get('items', [])
        if not items:
            raise ValueError("At least one invoice item is required")
        
        for item in items:
            if not item.get('description'):
                raise ValueError("Item description is required")
            # Allow negative rates for discounts/credits
            if float(item.get('quantity', 0)) <= 0:
                raise ValueError("Item quantity must be positive")
        
        # Validate tax configuration
        tax_method = validated_data.get('tax_method', 'percentage')
        if tax_method not in ['percentage', 'specific']:
            raise ValueError("tax_method must be 'percentage' or 'specific'")
        
        tax_rate = float(validated_data.get('tax_rate', 0))
        if tax_rate < 0 or tax_rate > 100:
            raise ValueError("tax_rate must be between 0 and 100")
        
        # Validate payment records
        payments = validated_data.get('payments', [])
        if payments:
            self._validate_payment_records(payments)
        
        # Calculate totals with tax configuration and adjustments
        adjustments_data = validated_data.get('adjustments')
        sections_data = validated_data.get('sections_data')
        totals = self.calculate_totals(
            items,
            tax_method=tax_method,
            tax_rate=tax_rate,
            tax_amount=float(validated_data.get('tax_amount', 0)),
            discount_amount=float(validated_data.get('discount_amount', 0)),
            op_percent=float(validated_data.get('op_percent', 0)),
            adjustments=adjustments_data if adjustments_data else None,
            sections=sections_data if sections_data else None,
            is_lump_sum_document=bool(validated_data.get('is_lump_sum_document')),
            lump_sum_document_amount=validated_data.get('lump_sum_document_amount')
        )
        validated_data.update(totals)

        # Calculate balance due
        paid_amount = sum(float(payment.get('amount', 0)) for payment in payments)
        validated_data['balance_due'] = totals['total_amount'] - paid_amount

        return validated_data

    def _validate_update_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate data for invoice update"""
        logger.info(f"Received invoice update data: {data}")
        validated_data = data.copy()
        
        # Remove None values
        validated_data = {k: v for k, v in validated_data.items() if v is not None}
        
        # Remove system fields and ID
        for field in ['created_at', 'updated_at', 'id']:
            validated_data.pop(field, None)

        # Map frontend field names to backend field names
        if 'discount' in validated_data and 'discount_amount' not in validated_data:
            validated_data['discount_amount'] = validated_data['discount']

        if not validated_data:
            raise ValueError("No valid data provided for update")
        
        # Validate tax configuration if provided
        tax_method = validated_data.get('tax_method')
        if tax_method is not None and tax_method not in ['percentage', 'specific']:
            raise ValueError("tax_method must be 'percentage' or 'specific'")
        
        tax_rate = validated_data.get('tax_rate')
        if tax_rate is not None:
            tax_rate = float(tax_rate)
            if tax_rate < 0 or tax_rate > 100:
                raise ValueError("tax_rate must be between 0 and 100")
        
        # Validate payment records if provided
        payments = validated_data.get('payments')
        if payments is not None:
            self._validate_payment_records(payments)
        
        # Validate items if provided
        items = validated_data.get('items')
        logger.info(f"Processing items: {items}")
        if items is not None:
            if not items:
                raise ValueError("At least one invoice item is required")
            
            for item in items:
                if not item.get('name') and not item.get('description'):
                    raise ValueError("Item name or description is required")
                # Allow negative rates for discounts/credits
                if float(item.get('quantity', 0)) <= 0:
                    raise ValueError("Item quantity must be positive")
        
        # Prepare adjustments if provided
        adjustments_data = validated_data.get('adjustments')
        if adjustments_data is None:
            adjustments_data = []
        
        # Calculate totals if items are provided (items are required for calculation)
        if items is not None:
            sections_data = validated_data.get('sections_data')
            # Calculate totals with tax configuration and adjustments
            totals = self.calculate_totals(
                items,
                tax_method=validated_data.get('tax_method', 'percentage'),
                tax_rate=float(validated_data.get('tax_rate', 0)),
                tax_amount=float(validated_data.get('tax_amount', 0)),
                discount_amount=float(validated_data.get('discount_amount', 0)),
                op_percent=float(validated_data.get('op_percent', 0)),
                adjustments=adjustments_data if adjustments_data else None,
                sections=sections_data if sections_data else None,
                is_lump_sum_document=bool(validated_data.get('is_lump_sum_document')),
                lump_sum_document_amount=validated_data.get('lump_sum_document_amount')
            )
            validated_data.update(totals)
            
            # Calculate balance due if payments are also provided
            if payments is not None:
                paid_amount = sum(float(payment.get('amount', 0)) for payment in payments)
                validated_data['balance_due'] = totals['total_amount'] - paid_amount
        elif adjustments_data:
            # If only adjustments are provided without items, preserve them
            # (items might not be updated, so we keep adjustments for the next update)
            validated_data['adjustments'] = adjustments_data
        
        return validated_data
    
    def _validate_payment_records(self, payments: List[Dict[str, Any]]) -> None:
        """Validate payment records"""
        for payment in payments:
            # Validate amount
            amount = payment.get('amount')
            if amount is None or float(amount) <= 0:
                raise ValueError("Payment amount must be positive")

            # Validate date format (date is optional)
            date_str = payment.get('date')
            if date_str:  # Only validate if date is provided
                # Validate and normalize date format (accept ISO datetime and convert to YYYY-MM-DD)
                try:
                    # Try ISO datetime format first (2025-09-10T07:38:26.292Z)
                    if 'T' in date_str:
                        from datetime import datetime as dt
                        parsed_dt = dt.fromisoformat(date_str.replace('Z', '+00:00'))
                        # Convert to YYYY-MM-DD format for database storage
                        payment['date'] = parsed_dt.strftime('%Y-%m-%d')
                    # Try YYYY-MM-DD format (already correct)
                    elif '-' in date_str and len(date_str.split('-')[0]) == 4:
                        datetime.strptime(date_str, '%Y-%m-%d')
                    # Try MM/DD/YYYY format and convert to YYYY-MM-DD
                    elif '/' in date_str:
                        dt = datetime.strptime(date_str, '%m/%d/%Y')
                        payment['date'] = dt.strftime('%Y-%m-%d')
                    else:
                        raise ValueError("Unrecognized date format")
                except ValueError:
                    raise ValueError(f"Invalid payment date format: {date_str}. Use YYYY-MM-DD, MM/DD/YYYY, or ISO datetime format")
            else:
                # Set to None if not provided
                payment['date'] = None

            # Validate payment method (optional, but if provided should be max 2 chars)
            method = payment.get('method')
            if method and str(method).strip() and len(str(method)) > 2:
                raise ValueError("Payment method code should be maximum 2 characters")

            # Convert empty strings to None for cleaner data
            if not payment.get('method') or not str(payment.get('method')).strip():
                payment['method'] = None
            if not payment.get('reference') or not str(payment.get('reference')).strip():
                payment['reference'] = None
    
    def add_payment(self, invoice_id: str, payment_record: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Add a payment record to an invoice and update balance.
        
        Args:
            invoice_id: Invoice ID
            payment_record: Payment record data
            
        Returns:
            Updated invoice dictionary
        """
        try:
            # Validate payment record
            self._validate_payment_records([payment_record])
            
            # Get current invoice
            invoice = self.get_by_id(invoice_id)
            if not invoice:
                raise ValueError(f"Invoice {invoice_id} not found")
            
            # Get current payments
            current_payments = invoice.get('payments', [])
            
            # Add new payment
            current_payments.append(payment_record)
            
            # Calculate new balance due
            paid_amount = sum(float(payment.get('amount', 0)) for payment in current_payments)
            balance_due = float(invoice.get('total_amount', 0)) - paid_amount
            
            # Update invoice
            return self.update(invoice_id, {
                'payments': current_payments,
                'balance_due': balance_due
            })
            
        except Exception as e:
            logger.error(f"Error adding payment to invoice: {e}")
            raise
    
    def remove_payment(self, invoice_id: str, payment_index: int) -> Optional[Dict[str, Any]]:
        """
        Remove a payment record from an invoice and update balance.
        
        Args:
            invoice_id: Invoice ID
            payment_index: Index of payment to remove
            
        Returns:
            Updated invoice dictionary
        """
        try:
            # Get current invoice
            invoice = self.get_by_id(invoice_id)
            if not invoice:
                raise ValueError(f"Invoice {invoice_id} not found")
            
            # Get current payments
            current_payments = invoice.get('payments', [])
            
            # Validate index
            if payment_index < 0 or payment_index >= len(current_payments):
                raise ValueError(f"Invalid payment index: {payment_index}")
            
            # Remove payment
            current_payments.pop(payment_index)
            
            # Calculate new balance due
            paid_amount = sum(float(payment.get('amount', 0)) for payment in current_payments)
            balance_due = float(invoice.get('total_amount', 0)) - paid_amount
            
            # Update invoice
            return self.update(invoice_id, {
                'payments': current_payments,
                'balance_due': balance_due
            })
            
        except Exception as e:
            logger.error(f"Error removing payment from invoice: {e}")
            raise

    def generate_invoice_number(self, company_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Generate next invoice number with metadata.
        Format: INV-[CompanyCode]-[Year]-[Count+1]

        Args:
            company_id: Optional company ID for company-specific numbering

        Returns:
            Dictionary with invoice_number, sequence, company_code, and year
        """
        try:
            now = datetime.utcnow()
            year = str(now.year)

            # Build prefix and get company info
            company_code = None
            if company_id:
                # Get company code from the company
                try:
                    # Import here to avoid circular dependencies
                    from app.core.database_factory import get_database
                    from app.domains.company.repository import get_company_repository

                    # Get a fresh database session
                    database = get_database()
                    with database.get_session() as session:
                        company_repo = get_company_repository(session)
                        company = company_repo.get_by_id(str(company_id))
                        if company:
                            company_code = company.get('company_code')
                            logger.info(f"Found company code: {company_code} for company_id: {company_id}")
                        else:
                            logger.warning(f"Company not found for ID: {company_id}")
                except Exception as e:
                    logger.error(f"Error fetching company for invoice number generation: {e}")

            if company_code:
                # Company-specific numbering: INV-[CompanyCode]-[Year]-[Count+1]
                prefix = f"INV-{company_code}-{year}-"

                # Count existing invoices for this company in current year
                with self.database.get_session() as session:
                    repository = self._get_repository_instance(session)

                    # Use document number service to get count
                    from app.common.services.document_number_service import (
                        DocumentNumberService,
                    )
                    doc_service = DocumentNumberService(session)
                    count = doc_service.get_document_count_for_company('invoice', company_code)

                    sequence = count + 1
                    invoice_number = f"INV-{company_code}-{year}-{sequence}"

                    # Verify uniqueness
                    existing = repository.get_by_invoice_number(invoice_number)
                    while existing:
                        sequence += 1
                        invoice_number = f"INV-{company_code}-{year}-{sequence}"
                        existing = repository.get_by_invoice_number(invoice_number)

                    return {
                        'invoice_number': invoice_number,
                        'sequence': sequence,
                        'company_code': company_code,
                        'year': year
                    }
            else:
                # Fallback to timestamp-based numbering
                timestamp = int(now.timestamp())
                return {
                    'invoice_number': f"INV-{year}-{timestamp % 10000}",
                    'sequence': timestamp % 10000,
                    'company_code': None,
                    'year': year
                }

        except Exception as e:
            logger.error(f"Error generating invoice number: {e}")
            # Fallback to timestamp-based number
            timestamp = int(datetime.utcnow().timestamp())
            year = str(datetime.utcnow().year)
            return {
                'invoice_number': f"INV-{year}-{timestamp % 10000}",
                'sequence': timestamp % 10000,
                'company_code': None,
                'year': year
            }