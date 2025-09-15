"""
Payment service for business logic
"""

from typing import Dict, List, Optional, Any
import logging
from datetime import datetime, timedelta
from uuid import UUID
from decimal import Decimal

from app.common.base_service import BaseService
from .models import Payment, BillingSchedule, PaymentRefund, PaymentStatus
from .schemas import PaymentCreate, BillingScheduleCreate, PaymentRefundCreate, PaymentFilter, BillingScheduleFilter

logger = logging.getLogger(__name__)


class PaymentService(BaseService[Payment, UUID]):
    """
    Service for managing payments with business logic
    """
    
    def get_repository(self):
        """Get the payment repository"""
        # This would be implemented when we create the payment repository
        pass
    
    def _get_repository_instance(self, session):
        """Get repository instance with the given session"""
        # This would be implemented when we create the payment repository
        pass
    
    def generate_payment_number(self) -> str:
        """
        Generate unique payment number
        
        Returns:
            Generated payment number
        """
        try:
            # Get current year and month
            now = datetime.now()
            year_month = now.strftime("%y%m")
            
            # Find the highest existing number for this month
            session = self.database.get_session()
            try:
                # This would use the repository to find the latest payment
                # For now, generate a basic number
                import uuid
                unique_id = str(uuid.uuid4())[:8].upper()
                payment_number = f"PAY-{year_month}-{unique_id}"
                
                # Ensure uniqueness
                counter = 0
                base_number = payment_number
                while self.payment_number_exists(payment_number):
                    counter += 1
                    payment_number = f"{base_number}-{counter}"
                
                return payment_number
                
            finally:
                session.close()
                
        except Exception as e:
            logger.error(f"Error generating payment number: {e}")
            # Fallback to UUID-based number
            import uuid
            return f"PAY-{datetime.now().year}-{str(uuid.uuid4())[:8].upper()}"
    
    def payment_number_exists(self, payment_number: str) -> bool:
        """
        Check if payment number already exists
        
        Args:
            payment_number: Payment number to check
            
        Returns:
            True if exists, False otherwise
        """
        try:
            session = self.database.get_session()
            try:
                # This would use the repository to check existence
                # For now, assume it doesn't exist
                return False
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error checking payment number existence: {e}")
            return False
    
    def create_payment(self, payment_data: PaymentCreate) -> Dict[str, Any]:
        """
        Create a new payment with auto-generated payment number
        
        Args:
            payment_data: Payment creation data
            
        Returns:
            Created payment dictionary
        """
        try:
            # Convert Pydantic model to dict
            data = payment_data.dict()
            
            # Generate payment number if not provided
            if not data.get('payment_number'):
                data['payment_number'] = self.generate_payment_number()
            
            # Set initial status
            data['status'] = PaymentStatus.PENDING
            
            # Calculate net amount if not provided
            if not data.get('net_amount') and data.get('amount'):
                net_amount = data['amount']
                if data.get('processor_fee'):
                    net_amount -= data['processor_fee']
                data['net_amount'] = net_amount
            
            # Create the payment
            return self.create(data)
            
        except Exception as e:
            logger.error(f"Error creating payment: {e}")
            raise
    
    def update_payment_status(self, payment_id: UUID, status: PaymentStatus, 
                             processed_date: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
        """
        Update payment status with timestamp tracking
        
        Args:
            payment_id: Payment ID
            status: New status
            processed_date: Optional processed date
            
        Returns:
            Updated payment or None if not found
        """
        try:
            update_data = {
                'status': status,
                'updated_at': datetime.utcnow()
            }
            
            # Add processed date if status is completed or failed
            if status in [PaymentStatus.COMPLETED, PaymentStatus.FAILED] and not processed_date:
                update_data['processed_date'] = datetime.utcnow()
            elif processed_date:
                update_data['processed_date'] = processed_date
            
            return self.update(payment_id, update_data)
            
        except Exception as e:
            logger.error(f"Error updating payment status: {e}")
            raise
    
    def get_payments_with_filters(self, filters: PaymentFilter) -> Dict[str, Any]:
        """
        Get payments with advanced filtering
        
        Args:
            filters: Filter parameters
            
        Returns:
            Dictionary with payments and metadata
        """
        try:
            # This would use a payment repository with filtering
            # For now, return empty result
            return {
                'payments': [],
                'total': 0,
                'filters_applied': filters.dict(exclude_none=True)
            }
            
        except Exception as e:
            logger.error(f"Error getting payments with filters: {e}")
            raise
    
    def create_billing_schedule(self, schedule_data: BillingScheduleCreate) -> Dict[str, Any]:
        """
        Create a new billing schedule
        
        Args:
            schedule_data: Billing schedule creation data
            
        Returns:
            Created billing schedule dictionary
        """
        try:
            # Convert Pydantic model to dict
            data = schedule_data.dict()
            
            # Set initial statistics
            data['total_payments_made'] = Decimal('0.00')
            data['payments_count'] = "0"
            data['failed_attempts'] = "0"
            
            # This would create the billing schedule using a repository
            # For now, return the data with an ID
            import uuid
            data['id'] = uuid.uuid4()
            data['created_at'] = datetime.utcnow()
            data['updated_at'] = datetime.utcnow()
            
            return data
            
        except Exception as e:
            logger.error(f"Error creating billing schedule: {e}")
            raise
    
    def get_billing_schedules_with_filters(self, filters: BillingScheduleFilter) -> Dict[str, Any]:
        """
        Get billing schedules with advanced filtering
        
        Args:
            filters: Filter parameters
            
        Returns:
            Dictionary with schedules and metadata
        """
        try:
            # This would use a billing schedule repository with filtering
            # For now, return empty result
            return {
                'schedules': [],
                'total': 0,
                'filters_applied': filters.dict(exclude_none=True)
            }
            
        except Exception as e:
            logger.error(f"Error getting billing schedules with filters: {e}")
            raise
    
    def create_payment_refund(self, refund_data: PaymentRefundCreate) -> Dict[str, Any]:
        """
        Create a new payment refund
        
        Args:
            refund_data: Payment refund creation data
            
        Returns:
            Created payment refund dictionary
        """
        try:
            # Convert Pydantic model to dict
            data = refund_data.dict()
            
            # Generate refund number if not provided
            if not data.get('refund_number'):
                data['refund_number'] = self.generate_refund_number()
            
            # Set initial status
            data['status'] = PaymentStatus.PENDING
            
            # This would create the refund using a repository
            # For now, return the data with an ID
            import uuid
            data['id'] = uuid.uuid4()
            data['created_at'] = datetime.utcnow()
            data['updated_at'] = datetime.utcnow()
            
            return data
            
        except Exception as e:
            logger.error(f"Error creating payment refund: {e}")
            raise
    
    def generate_refund_number(self) -> str:
        """
        Generate unique refund number
        
        Returns:
            Generated refund number
        """
        try:
            # Get current year and month
            now = datetime.now()
            year_month = now.strftime("%y%m")
            
            # Generate unique refund number
            import uuid
            unique_id = str(uuid.uuid4())[:8].upper()
            refund_number = f"REF-{year_month}-{unique_id}"
            
            return refund_number
            
        except Exception as e:
            logger.error(f"Error generating refund number: {e}")
            # Fallback to UUID-based number
            import uuid
            return f"REF-{datetime.now().year}-{str(uuid.uuid4())[:8].upper()}"
    
    def get_payment_refunds(self, payment_id: UUID) -> List[Dict[str, Any]]:
        """
        Get all refunds for a specific payment
        
        Args:
            payment_id: Payment UUID
            
        Returns:
            List of refund dictionaries
        """
        try:
            # This would use a refund repository to find refunds
            # For now, return empty list
            return []
            
        except Exception as e:
            logger.error(f"Error getting payment refunds: {e}")
            raise
    
    def get_payment_dashboard_stats(self, company_id: Optional[UUID] = None) -> Dict[str, Any]:
        """
        Get dashboard statistics for payments
        
        Args:
            company_id: Optional company filter
            
        Returns:
            Dictionary with various statistics
        """
        try:
            # This would calculate real statistics from the database
            # For now, return mock data
            return {
                'total_payments': 0,
                'total_amount': '0.00',
                'pending_payments': 0,
                'completed_payments': 0,
                'failed_payments': 0,
                'refunded_payments': 0,
                'this_month_amount': '0.00',
                'this_month_count': 0,
                'average_payment_amount': '0.00',
                'payment_method_breakdown': {
                    'credit_card': 0,
                    'cash': 0,
                    'check': 0,
                    'bank_transfer': 0,
                    'other': 0
                },
                'recent_activity': [],
                'last_updated': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error getting payment dashboard stats: {e}")
            raise
    
    def process_recurring_payments(self, limit: int = 100) -> Dict[str, Any]:
        """
        Process due recurring payments
        
        Args:
            limit: Maximum number of payments to process
            
        Returns:
            Processing results
        """
        try:
            # This would find and process due recurring payments
            # For now, return mock results
            return {
                'processed_count': 0,
                'successful_count': 0,
                'failed_count': 0,
                'skipped_count': 0,
                'total_amount_processed': '0.00',
                'errors': [],
                'processed_at': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error processing recurring payments: {e}")
            raise
    
    def _validate_create_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate payment creation data"""
        # Ensure required fields
        if not data.get('amount') or data['amount'] <= 0:
            raise ValueError("Payment amount must be greater than 0")
        
        if not data.get('payment_method'):
            raise ValueError("Payment method is required")
        
        if not data.get('payment_number'):
            data['payment_number'] = self.generate_payment_number()
        
        return data
    
    def _validate_update_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate payment update data"""
        # Remove fields that shouldn't be updated directly
        protected_fields = ['id', 'created_at', 'payment_number']
        for field in protected_fields:
            data.pop(field, None)
        
        return data