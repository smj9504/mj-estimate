"""
Receipt domain service with comprehensive business logic and validation.
"""

from typing import Any, Dict, List, Optional
import logging
from datetime import datetime, date
from decimal import Decimal

from app.common.base_service import TransactionalService
from app.domains.receipt.repository import get_receipt_repository, get_receipt_template_repository
from app.core.interfaces import DatabaseProvider
from app.core.database_factory import get_database

logger = logging.getLogger(__name__)


class ReceiptService(TransactionalService[Dict[str, Any], str]):
    """
    Service for receipt-related business operations.
    Provides comprehensive CRUD operations with validation and business logic.
    """

    def __init__(self, database: DatabaseProvider = None):
        super().__init__(database)

    def get_repository(self):
        """Get the receipt repository"""
        from app.domains.receipt.repository import get_receipt_repository
        session = self.database.get_session()
        return get_receipt_repository(session)

    def get_readonly_repository(self):
        """Get the receipt repository with read-only session"""
        from app.domains.receipt.repository import get_receipt_repository
        session = self.database.get_readonly_session()
        return get_receipt_repository(session)

    def _get_repository_instance(self, session):
        """Get receipt repository instance with the given session"""
        return get_receipt_repository(session)

    def get_by_receipt_number(self, receipt_number: str) -> Optional[Dict[str, Any]]:
        """
        Get receipt by receipt number.

        Args:
            receipt_number: Receipt number

        Returns:
            Receipt dictionary or None if not found
        """
        try:
            with self.database.get_readonly_session() as session:
                repository = self._get_repository_instance(session)
                return repository.get_by_receipt_number(receipt_number)
        except Exception as e:
            logger.error(f"Error getting receipt by number: {e}")
            raise

    def get_receipts_by_invoice(self, invoice_id: str) -> List[Dict[str, Any]]:
        """
        Get receipts for a specific invoice.

        Args:
            invoice_id: Invoice ID

        Returns:
            List of receipt dictionaries
        """
        try:
            with self.database.get_readonly_session() as session:
                repository = self._get_repository_instance(session)
                return repository.get_receipts_by_invoice(invoice_id)
        except Exception as e:
            logger.error(f"Error getting receipts by invoice: {e}")
            raise

    def get_receipts_by_status(self, status: str) -> List[Dict[str, Any]]:
        """
        Get receipts by status.

        Args:
            status: Receipt status

        Returns:
            List of receipt dictionaries
        """
        try:
            with self.database.get_readonly_session() as session:
                repository = self._get_repository_instance(session)
                return repository.get_receipts_by_status(status)
        except Exception as e:
            logger.error(f"Error getting receipts by status: {e}")
            raise

    def get_receipts_by_date_range(self,
                                   start_date: date,
                                   end_date: date) -> List[Dict[str, Any]]:
        """
        Get receipts within a date range.

        Args:
            start_date: Start date
            end_date: End date

        Returns:
            List of receipt dictionaries
        """
        try:
            with self.database.get_session() as session:
                repository = self._get_repository_instance(session)
                return repository.get_receipts_by_date_range(start_date, end_date)
        except Exception as e:
            logger.error(f"Error getting receipts by date range: {e}")
            raise

    def generate_receipt(
        self,
        invoice_id: str,
        template_id: Optional[str] = None,
        receipt_date: Optional[str] = None,
        payment_amount: Optional[float] = None,
        payment_method: Optional[str] = None,
        payment_reference: Optional[str] = None,
        receipt_number: Optional[str] = None,
        top_note: Optional[str] = None,
        bottom_note: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Generate a receipt from an invoice.

        Args:
            invoice_id: Invoice ID to generate receipt from
            template_id: Optional template ID to use (uses default if not specified)
            receipt_date: Optional receipt date (defaults to current date)
            payment_amount: Payment amount (defaults to invoice total)
            payment_method: Payment method
            payment_reference: Payment reference number
            top_note: Top note for receipt
            bottom_note: Bottom note for receipt

        Returns:
            Created receipt dictionary
        """
        def _generate_operation(session_or_uow, invoice_id, template_id, receipt_date, payment_amount, payment_method, payment_reference, receipt_number, top_note, bottom_note):
            receipt_repo = self._get_repository_instance(session_or_uow)

            # Get invoice
            from app.domains.invoice.repository import get_invoice_repository
            invoice_repo = get_invoice_repository(session_or_uow)
            invoice = invoice_repo.get_with_items(invoice_id)

            if not invoice:
                raise ValueError(f"Invoice {invoice_id} not found")

            # Allow multiple receipts per invoice (one per payment)
            # No need to check balance_due or existing receipts
            # Each payment can have its own receipt regardless of total balance
            existing_receipts = receipt_repo.get_receipts_by_invoice(invoice_id)
            if existing_receipts:
                active_receipts = [r for r in existing_receipts if r.get('status') != 'voided']
                logger.info(
                    f"Invoice {invoice_id} already has {len(active_receipts)} active receipt(s). "
                    f"Creating additional receipt for payment amount ${payment_amount:.2f}."
                )

            # Get template
            template = None
            if template_id:
                template_repo = get_receipt_template_repository(session_or_uow)
                template = template_repo.get_by_id(template_id)
                if not template:
                    raise ValueError(f"Template {template_id} not found")
            else:
                # Get default template
                template_repo = get_receipt_template_repository(session_or_uow)
                template = template_repo.get_default_template()
                if not template:
                    logger.warning("No default receipt template found, using basic template")

            # Use provided receipt_number or generate a new one
            if not receipt_number:
                receipt_number = self._generate_receipt_number(invoice)

            logger.info(f"=== Receipt Number ===")
            logger.info(f"Using receipt_number: {receipt_number}")
            logger.info(f"Invoice ID: {invoice_id}")

            # Parse receipt_date if provided as string
            parsed_receipt_date = None
            if receipt_date:
                if isinstance(receipt_date, str):
                    from datetime import datetime as dt
                    try:
                        parsed_receipt_date = dt.strptime(receipt_date, '%Y-%m-%d').date()
                    except ValueError:
                        parsed_receipt_date = datetime.utcnow().date()
                else:
                    parsed_receipt_date = receipt_date
            else:
                parsed_receipt_date = datetime.utcnow().date()

            # Prepare receipt data - only fields that exist in Receipt model
            receipt_data = {
                # Core identification
                'receipt_number': receipt_number,
                'company_id': invoice.get('company_id'),
                'invoice_id': invoice_id,
                'template_id': template['id'] if template else None,

                # Receipt metadata
                'receipt_date': parsed_receipt_date,
                'status': 'issued',

                # Payment information
                'payment_amount': payment_amount if payment_amount is not None else invoice.get('total_amount'),
                'payment_method': payment_method or self._get_payment_method(invoice),
                'payment_reference': payment_reference,

                # Financial snapshot from invoice
                'invoice_number': invoice.get('invoice_number'),
                'original_amount': invoice.get('total_amount'),
                'paid_amount_to_date': payment_amount if payment_amount is not None else invoice.get('total_amount'),
                'balance_due': 0.0,  # Receipt is only generated when fully paid

                # Customizable notes
                'top_note': top_note,
                'bottom_note': bottom_note,

                # Versioning
                'version': 1
            }

            # Create receipt
            return receipt_repo.create_with_invoice_data(receipt_data)

        return self.execute_in_transaction(_generate_operation, invoice_id, template_id, receipt_date, payment_amount, payment_method, payment_reference, receipt_number, top_note, bottom_note)

    def void_receipt(self, receipt_id: str, reason: str) -> Optional[Dict[str, Any]]:
        """
        Void a receipt.

        Args:
            receipt_id: Receipt ID
            reason: Reason for voiding

        Returns:
            Updated receipt dictionary
        """
        return self.update(receipt_id, {
            'status': 'voided',
            'void_reason': reason,
            'voided_at': datetime.utcnow()
        })

    def get_receipt_summary(self) -> Dict[str, Any]:
        """
        Get comprehensive receipt summary statistics.

        Returns:
            Dictionary with receipt statistics
        """
        try:
            all_receipts = self.get_all()

            # Group by status
            status_counts = {}
            status_amounts = {}

            for receipt in all_receipts:
                status = receipt.get('status', 'unknown')
                amount = float(receipt.get('amount', 0))

                status_counts[status] = status_counts.get(status, 0) + 1
                status_amounts[status] = status_amounts.get(status, 0) + amount

            # Calculate totals
            total_amount = sum(float(receipt.get('amount', 0)) for receipt in all_receipts)

            return {
                'total_receipts': len(all_receipts),
                'total_amount': total_amount,
                'status_counts': status_counts,
                'status_amounts': status_amounts,
                'average_receipt_amount': total_amount / len(all_receipts) if all_receipts else 0
            }

        except Exception as e:
            logger.error(f"Error getting receipt summary: {e}")
            raise

    def _generate_receipt_number(self, invoice: Dict[str, Any]) -> str:
        """Generate unique receipt number based on current date"""
        try:
            # Format: RCP-[Year][Month]-[Sequence]
            now = datetime.utcnow()
            prefix = f"RCP-{now.year}{now.month:02d}"

            # Get existing receipts for this month and find max sequence
            existing_receipts = self.get_all(
                filters={'receipt_number__startswith': prefix}
            )

            # Extract sequence numbers and find the maximum
            max_sequence = 0
            for receipt in existing_receipts:
                receipt_num = receipt.get('receipt_number', '')
                try:
                    # Extract sequence from format: RCP-YYYYMM-NNNN
                    parts = receipt_num.split('-')
                    if len(parts) == 3:
                        sequence = int(parts[2])
                        max_sequence = max(max_sequence, sequence)
                except (ValueError, IndexError):
                    continue

            # Use next sequence number
            next_sequence = max_sequence + 1

            return f"{prefix}-{next_sequence:04d}"

        except Exception as e:
            logger.error(f"Error generating receipt number: {e}")
            # Fallback to timestamp-based number for uniqueness
            timestamp = int(datetime.utcnow().timestamp())
            return f"RCP-{timestamp}"

    def _get_payment_method(self, invoice: Dict[str, Any]) -> str:
        """Extract payment method from invoice payments"""
        payments = invoice.get('payments', [])
        if payments:
            # Use the last payment's method
            last_payment = payments[-1]
            method = last_payment.get('method', 'unknown')
            # Map payment method codes to readable names
            method_map = {
                'CC': 'Credit Card',
                'CH': 'Check',
                'CA': 'Cash',
                'BT': 'Bank Transfer',
                'OT': 'Other'
            }
            return method_map.get(method, method)
        return 'unknown'

    def _get_payment_date(self, invoice: Dict[str, Any]) -> Optional[date]:
        """Extract payment date from invoice payments"""
        payments = invoice.get('payments', [])
        if payments:
            # Use the last payment's date
            last_payment = payments[-1]
            date_str = last_payment.get('date')
            if date_str:
                try:
                    if isinstance(date_str, str):
                        return datetime.strptime(date_str, '%Y-%m-%d').date()
                    elif isinstance(date_str, datetime):
                        return date_str.date()
                    elif isinstance(date_str, date):
                        return date_str
                except Exception as e:
                    logger.warning(f"Failed to parse payment date: {e}")
        return datetime.utcnow().date()

    def _create_items_summary(self, items: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Create a summary of invoice items for the receipt"""
        summary = {
            'total_items': len(items),
            'items': []
        }

        for item in items[:10]:  # Limit to first 10 items for summary
            summary['items'].append({
                'name': item.get('name', item.get('description', '')),
                'quantity': item.get('quantity', 0),
                'amount': item.get('amount', 0)
            })

        if len(items) > 10:
            summary['has_more'] = True
            summary['additional_count'] = len(items) - 10

        return summary

    def _build_notes(self, top_note: Optional[str], bottom_note: Optional[str], invoice_number: str) -> str:
        """Build notes string from top and bottom notes"""
        notes_parts = []

        if top_note:
            notes_parts.append(top_note)

        # Default middle note
        notes_parts.append(f"Receipt for Invoice #{invoice_number}")

        if bottom_note:
            notes_parts.append(bottom_note)

        return "\n\n".join(notes_parts)

    def _validate_create_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate data for receipt creation"""
        if not data.get('invoice_id'):
            raise ValueError("Invoice ID is required")

        validated_data = data.copy()

        # Remove None values
        validated_data = {k: v for k, v in validated_data.items() if v is not None}

        return validated_data

    def _validate_update_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate data for receipt update"""
        validated_data = data.copy()

        # Remove None values
        validated_data = {k: v for k, v in validated_data.items() if v is not None}

        # Remove system fields
        for field in ['created_at', 'updated_at', 'id']:
            validated_data.pop(field, None)

        if not validated_data:
            raise ValueError("No valid data provided for update")

        return validated_data


class ReceiptTemplateService(TransactionalService[Dict[str, Any], str]):
    """
    Service for receipt template operations.
    """

    def __init__(self, database: DatabaseProvider = None):
        super().__init__(database)

    def get_repository(self):
        """Get the receipt template repository"""
        from app.domains.receipt.repository import get_receipt_template_repository
        session = self.database.get_session()
        return get_receipt_template_repository(session)

    def get_readonly_repository(self):
        """Get the receipt template repository with read-only session"""
        from app.domains.receipt.repository import get_receipt_template_repository
        session = self.database.get_readonly_session()
        return get_receipt_template_repository(session)

    def _get_repository_instance(self, session):
        """Get receipt template repository instance with the given session"""
        return get_receipt_template_repository(session)

    def get_default_template(self) -> Optional[Dict[str, Any]]:
        """
        Get the default receipt template.

        Returns:
            Template dictionary or None if no default
        """
        try:
            with self.database.get_readonly_session() as session:
                repository = self._get_repository_instance(session)
                return repository.get_default_template()
        except Exception as e:
            logger.error(f"Error getting default template: {e}")
            raise

    def get_active_templates(self) -> List[Dict[str, Any]]:
        """
        Get all active templates.

        Returns:
            List of template dictionaries
        """
        try:
            with self.database.get_readonly_session() as session:
                repository = self._get_repository_instance(session)
                return repository.get_active_templates()
        except Exception as e:
            logger.error(f"Error getting active templates: {e}")
            raise

    def set_default_template(self, template_id: str) -> bool:
        """
        Set a template as the default.

        Args:
            template_id: Template ID to set as default

        Returns:
            True if successful, False otherwise
        """
        try:
            with self.database.get_session() as session:
                repository = self._get_repository_instance(session)
                success = repository.set_default_template(template_id)
                if success:
                    session.commit()
                    logger.info(f"Set template {template_id} as default")
                return success
        except Exception as e:
            logger.error(f"Error setting default template: {e}")
            raise

    def activate_template(self, template_id: str) -> Optional[Dict[str, Any]]:
        """
        Activate a template.

        Args:
            template_id: Template ID

        Returns:
            Updated template dictionary
        """
        return self.update(template_id, {'is_active': True})

    def deactivate_template(self, template_id: str) -> Optional[Dict[str, Any]]:
        """
        Deactivate a template.

        Args:
            template_id: Template ID

        Returns:
            Updated template dictionary
        """
        return self.update(template_id, {'is_active': False})

    def _validate_create_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate data for template creation"""
        if not data.get('name'):
            raise ValueError("Template name is required")

        if not data.get('html_template'):
            raise ValueError("HTML template content is required")

        validated_data = data.copy()

        # Set defaults
        if 'is_active' not in validated_data:
            validated_data['is_active'] = True
        if 'is_default' not in validated_data:
            validated_data['is_default'] = False

        # Remove None values
        validated_data = {k: v for k, v in validated_data.items() if v is not None}

        return validated_data

    def _validate_update_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate data for template update"""
        validated_data = data.copy()

        # Remove None values
        validated_data = {k: v for k, v in validated_data.items() if v is not None}

        # Remove system fields
        for field in ['created_at', 'updated_at', 'id']:
            validated_data.pop(field, None)

        if not validated_data:
            raise ValueError("No valid data provided for update")

        return validated_data