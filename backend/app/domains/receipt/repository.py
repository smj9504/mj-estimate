"""
Receipt domain repository implementations for different database providers.
"""

from typing import Any, Dict, List, Optional
import logging
from datetime import datetime, date
from decimal import Decimal

from app.common.base_repository import SQLAlchemyRepository, SupabaseRepository
from app.core.interfaces import DatabaseSession
from app.domains.receipt.models import Receipt, ReceiptTemplate
from app.core.config import settings

logger = logging.getLogger(__name__)


class ReceiptRepositoryMixin:
    """Mixin with receipt-specific methods"""

    def get_by_receipt_number(self, receipt_number: str) -> Optional[Dict[str, Any]]:
        """Get receipt by receipt number"""
        receipts = self.get_all(filters={'receipt_number': receipt_number}, limit=1)
        return receipts[0] if receipts else None

    def get_receipts_by_invoice(self, invoice_id: str) -> List[Dict[str, Any]]:
        """Get receipts for a specific invoice"""
        return self.get_all(filters={'invoice_id': invoice_id}, order_by='-created_at')

    def get_receipts_by_status(self, status: str) -> List[Dict[str, Any]]:
        """Get receipts by status"""
        return self.get_all(filters={'status': status}, order_by='-receipt_date')

    def get_receipts_by_date_range(self,
                                   start_date: date,
                                   end_date: date) -> List[Dict[str, Any]]:
        """Get receipts within a date range"""
        # This will be implemented differently for each database type
        raise NotImplementedError("Subclasses must implement get_receipts_by_date_range")


class ReceiptSQLAlchemyRepository(SQLAlchemyRepository, ReceiptRepositoryMixin):
    """SQLAlchemy-based receipt repository for SQLite/PostgreSQL"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, Receipt)

    def get_receipts_by_date_range(self,
                                   start_date: date,
                                   end_date: date) -> List[Dict[str, Any]]:
        """Get receipts within a date range using SQLAlchemy"""
        try:
            entities = self.db_session.query(Receipt).filter(
                Receipt.receipt_date >= start_date,
                Receipt.receipt_date <= end_date
            ).order_by(Receipt.receipt_date.desc()).all()

            return [self._convert_to_dict(entity) for entity in entities]

        except Exception as e:
            logger.error(f"Error getting receipts by date range: {e}")
            raise Exception(f"Failed to get receipts by date range: {e}")

    def create_with_invoice_data(self, receipt_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create receipt with invoice data attached"""
        try:
            # Add timestamps if not present
            if 'created_at' not in receipt_data:
                receipt_data['created_at'] = datetime.utcnow()
            if 'updated_at' not in receipt_data:
                receipt_data['updated_at'] = datetime.utcnow()

            # Create receipt
            receipt = Receipt(**receipt_data)
            self.db_session.add(receipt)
            self.db_session.flush()

            logger.info(f"Created receipt with ID: {receipt.id}")

            # Convert to dict with proper type handling
            result = {
                'id': str(receipt.id),
                'receipt_number': receipt.receipt_number,
                'company_id': str(receipt.company_id),
                'invoice_id': str(receipt.invoice_id),
                'template_id': str(receipt.template_id) if receipt.template_id else None,
                'receipt_date': receipt.receipt_date.isoformat() if hasattr(receipt.receipt_date, 'isoformat') else str(receipt.receipt_date),
                'status': receipt.status,
                'payment_amount': float(receipt.payment_amount) if receipt.payment_amount else 0.0,
                'payment_method': receipt.payment_method,
                'payment_reference': receipt.payment_reference,
                'invoice_number': receipt.invoice_number,
                'original_amount': float(receipt.original_amount) if receipt.original_amount else 0.0,
                'paid_amount_to_date': float(receipt.paid_amount_to_date) if receipt.paid_amount_to_date else 0.0,
                'balance_due': float(receipt.balance_due) if receipt.balance_due else 0.0,
                'top_note': receipt.top_note,
                'bottom_note': receipt.bottom_note,
                'version': receipt.version,
                'superseded_by': str(receipt.superseded_by) if receipt.superseded_by else None,
                'created_by': str(receipt.created_by) if receipt.created_by else None,
                'updated_by': str(receipt.updated_by) if receipt.updated_by else None,
                'voided_at': receipt.voided_at.isoformat() if receipt.voided_at else None,
                'voided_by': str(receipt.voided_by) if receipt.voided_by else None,
                'void_reason': receipt.void_reason,
                'created_at': receipt.created_at.isoformat() if receipt.created_at else None,
                'updated_at': receipt.updated_at.isoformat() if receipt.updated_at else None,
            }
            return result

        except Exception as e:
            logger.error(f"Error creating receipt: {e}")
            self.db_session.rollback()
            raise Exception(f"Failed to create receipt: {e}")


class ReceiptSupabaseRepository(SupabaseRepository, ReceiptRepositoryMixin):
    """Supabase-based receipt repository"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, "receipts", Receipt)

    def get_receipts_by_date_range(self,
                                   start_date: date,
                                   end_date: date) -> List[Dict[str, Any]]:
        """Get receipts within a date range using Supabase"""
        try:
            response = self.client.table('receipts').select('*').gte(
                'receipt_date', start_date.isoformat()
            ).lte(
                'receipt_date', end_date.isoformat()
            ).order('receipt_date', desc=True).execute()

            return response.data if response.data else []

        except Exception as e:
            logger.error(f"Error getting receipts by date range from Supabase: {e}")
            raise Exception(f"Failed to get receipts by date range: {e}")

    def create_with_invoice_data(self, receipt_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create receipt with invoice data attached"""
        try:
            # Clean data for Supabase
            clean_data = receipt_data.copy()

            # Convert Decimal values to float
            for key, value in clean_data.items():
                if isinstance(value, Decimal):
                    clean_data[key] = float(value)

            # Remove None values
            clean_data = {k: v for k, v in clean_data.items() if v is not None}

            # Remove timestamp fields (they're auto-managed by Supabase)
            clean_data.pop('created_at', None)
            clean_data.pop('updated_at', None)

            return self.create(clean_data)

        except Exception as e:
            logger.error(f"Error creating receipt in Supabase: {e}")
            raise Exception(f"Failed to create receipt: {e}")


class ReceiptTemplateSQLAlchemyRepository(SQLAlchemyRepository):
    """SQLAlchemy-based receipt template repository"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, ReceiptTemplate)

    def get_default_template(self) -> Optional[Dict[str, Any]]:
        """Get the default receipt template"""
        templates = self.get_all(filters={'is_default': True}, limit=1)
        return templates[0] if templates else None

    def get_active_templates(self) -> List[Dict[str, Any]]:
        """Get all active templates"""
        return self.get_all(filters={'is_active': True}, order_by='name')

    def set_default_template(self, template_id: str) -> bool:
        """Set a template as default and unset all others"""
        try:
            # Unset current default
            self.db_session.query(ReceiptTemplate).filter(
                ReceiptTemplate.is_default == True
            ).update({'is_default': False})

            # Set new default
            template = self.db_session.query(ReceiptTemplate).filter(
                ReceiptTemplate.id == template_id
            ).first()

            if template:
                template.is_default = True
                self.db_session.flush()
                return True
            return False

        except Exception as e:
            logger.error(f"Error setting default template: {e}")
            self.db_session.rollback()
            raise Exception(f"Failed to set default template: {e}")


class ReceiptTemplateSupabaseRepository(SupabaseRepository):
    """Supabase-based receipt template repository"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, "receipt_templates", ReceiptTemplate)

    def get_default_template(self) -> Optional[Dict[str, Any]]:
        """Get the default receipt template"""
        try:
            response = self.client.table('receipt_templates').select('*').eq(
                'is_default', True
            ).limit(1).execute()

            return response.data[0] if response.data else None

        except Exception as e:
            logger.error(f"Error getting default template from Supabase: {e}")
            raise Exception(f"Failed to get default template: {e}")

    def get_active_templates(self) -> List[Dict[str, Any]]:
        """Get all active templates"""
        try:
            response = self.client.table('receipt_templates').select('*').eq(
                'is_active', True
            ).order('name').execute()

            return response.data if response.data else []

        except Exception as e:
            logger.error(f"Error getting active templates from Supabase: {e}")
            raise Exception(f"Failed to get active templates: {e}")

    def set_default_template(self, template_id: str) -> bool:
        """Set a template as default and unset all others"""
        try:
            # Unset current default
            self.client.table('receipt_templates').update(
                {'is_default': False}
            ).eq('is_default', True).execute()

            # Set new default
            response = self.client.table('receipt_templates').update(
                {'is_default': True}
            ).eq('id', template_id).execute()

            return len(response.data) > 0

        except Exception as e:
            logger.error(f"Error setting default template in Supabase: {e}")
            raise Exception(f"Failed to set default template: {e}")


def get_receipt_repository(session: DatabaseSession) -> ReceiptRepositoryMixin:
    """Factory function to get appropriate receipt repository based on database type"""

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
        return ReceiptSQLAlchemyRepository(actual_session)

    # 4. Check if it's actually a SQLAlchemy session by checking for bind
    if hasattr(actual_session, 'bind'):
        return ReceiptSQLAlchemyRepository(actual_session)

    # 5. Otherwise assume it's a Supabase client
    return ReceiptSupabaseRepository(actual_session)


def get_receipt_template_repository(session: DatabaseSession):
    """Factory function to get appropriate receipt template repository based on database type"""

    actual_session = session

    # Handle different wrapper types (same logic as above)
    if hasattr(session, 'session') and session.session is not None:
        actual_session = session.session

    if hasattr(actual_session, '_session') and actual_session._session is not None:
        actual_session = actual_session._session

    if hasattr(actual_session, 'query') or hasattr(actual_session, 'execute'):
        return ReceiptTemplateSQLAlchemyRepository(actual_session)

    if hasattr(actual_session, 'bind'):
        return ReceiptTemplateSQLAlchemyRepository(actual_session)

    return ReceiptTemplateSupabaseRepository(actual_session)