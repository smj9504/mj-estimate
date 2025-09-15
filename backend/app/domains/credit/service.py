"""
Credit service for business logic
"""

from typing import Dict, List, Optional, Any
import logging
from datetime import datetime, timedelta
from uuid import UUID
from decimal import Decimal

from app.common.base_service import BaseService
from .models import CustomerCredit, DiscountRule, CreditStatus
from .schemas import CustomerCreditCreate, DiscountRuleCreate, CustomerCreditFilter, DiscountRuleFilter

logger = logging.getLogger(__name__)


class CreditService(BaseService[CustomerCredit, UUID]):
    """
    Service for managing credits and discounts with business logic
    """
    
    def get_repository(self):
        """Get the credit repository"""
        # This would be implemented when we create the credit repository
        pass
    
    def _get_repository_instance(self, session):
        """Get repository instance with the given session"""
        # This would be implemented when we create the credit repository
        pass
    
    def generate_credit_number(self) -> str:
        """
        Generate unique credit number
        
        Returns:
            Generated credit number
        """
        try:
            # Get current year and month
            now = datetime.now()
            year_month = now.strftime("%y%m")
            
            # Generate unique credit number
            import uuid
            unique_id = str(uuid.uuid4())[:8].upper()
            credit_number = f"CR-{year_month}-{unique_id}"
            
            # Ensure uniqueness
            counter = 0
            base_number = credit_number
            while self.credit_number_exists(credit_number):
                counter += 1
                credit_number = f"{base_number}-{counter}"
            
            return credit_number
            
        except Exception as e:
            logger.error(f"Error generating credit number: {e}")
            # Fallback to UUID-based number
            import uuid
            return f"CR-{datetime.now().year}-{str(uuid.uuid4())[:8].upper()}"
    
    def credit_number_exists(self, credit_number: str) -> bool:
        """
        Check if credit number already exists
        
        Args:
            credit_number: Credit number to check
            
        Returns:
            True if exists, False otherwise
        """
        try:
            # This would check the database
            # For now, assume it doesn't exist
            return False
        except Exception as e:
            logger.error(f"Error checking credit number existence: {e}")
            return False
    
    def create_customer_credit(self, credit_data: CustomerCreditCreate) -> Dict[str, Any]:
        """
        Create a new customer credit
        
        Args:
            credit_data: Credit creation data
            
        Returns:
            Created credit dictionary
        """
        try:
            # Convert Pydantic model to dict
            data = credit_data.dict()
            
            # Generate credit number if not provided
            if not data.get('credit_number'):
                data['credit_number'] = self.generate_credit_number()
            
            # Set initial amounts
            data['original_amount'] = data['amount']
            data['remaining_amount'] = data['amount']
            data['used_amount'] = Decimal('0.00')
            data['status'] = CreditStatus.ACTIVE
            
            # Create the credit
            return self.create(data)
            
        except Exception as e:
            logger.error(f"Error creating customer credit: {e}")
            raise
    
    def use_customer_credit(self, credit_id: UUID, amount_to_use: Decimal, 
                           work_order_id: Optional[UUID] = None) -> Optional[Dict[str, Any]]:
        """
        Use customer credit for payment
        
        Args:
            credit_id: Credit UUID
            amount_to_use: Amount to use from credit
            work_order_id: Optional work order ID
            
        Returns:
            Updated credit or None if not found/insufficient
        """
        try:
            credit = self.get_by_id(credit_id)
            if not credit:
                return None
            
            remaining_amount = Decimal(str(credit.get('remaining_amount', 0)))
            if amount_to_use > remaining_amount:
                raise ValueError("Insufficient credit balance")
            
            # Update amounts
            new_remaining = remaining_amount - amount_to_use
            new_used = Decimal(str(credit.get('used_amount', 0))) + amount_to_use
            
            update_data = {
                'remaining_amount': new_remaining,
                'used_amount': new_used,
                'updated_at': datetime.utcnow()
            }
            
            # Mark as used if fully consumed
            if new_remaining <= 0:
                update_data['status'] = CreditStatus.USED
                update_data['used_date'] = datetime.utcnow()
            
            # Create credit transaction record
            self.create_credit_transaction(credit_id, amount_to_use, work_order_id)
            
            return self.update(credit_id, update_data)
            
        except Exception as e:
            logger.error(f"Error using customer credit: {e}")
            raise
    
    def create_credit_transaction(self, credit_id: UUID, amount: Decimal, 
                                work_order_id: Optional[UUID] = None) -> Dict[str, Any]:
        """
        Create credit transaction record
        
        Args:
            credit_id: Credit UUID
            amount: Transaction amount
            work_order_id: Optional work order ID
            
        Returns:
            Created transaction dictionary
        """
        try:
            # This would create a credit transaction record
            # For now, return mock data
            import uuid
            
            transaction_data = {
                'id': str(uuid.uuid4()),
                'transaction_number': f"CT-{datetime.now().strftime('%y%m%d')}-{str(uuid.uuid4())[:8].upper()}",
                'customer_credit_id': credit_id,
                'work_order_id': work_order_id,
                'transaction_type': 'use',
                'amount': amount,
                'transaction_date': datetime.utcnow(),
                'created_at': datetime.utcnow(),
                'updated_at': datetime.utcnow()
            }
            
            return transaction_data
            
        except Exception as e:
            logger.error(f"Error creating credit transaction: {e}")
            raise
    
    def get_customer_credits_with_filters(self, filters: CustomerCreditFilter) -> Dict[str, Any]:
        """
        Get customer credits with advanced filtering
        
        Args:
            filters: Filter parameters
            
        Returns:
            Dictionary with credits and metadata
        """
        try:
            # This would use a credit repository with filtering
            # For now, return empty result
            return {
                'credits': [],
                'total': 0,
                'filters_applied': filters.dict(exclude_none=True)
            }
            
        except Exception as e:
            logger.error(f"Error getting customer credits with filters: {e}")
            raise
    
    def create_discount_rule(self, rule_data: DiscountRuleCreate) -> Dict[str, Any]:
        """
        Create a new discount rule
        
        Args:
            rule_data: Discount rule creation data
            
        Returns:
            Created discount rule dictionary
        """
        try:
            # Convert Pydantic model to dict
            data = rule_data.dict()
            
            # Set initial statistics
            data['total_uses'] = "0"
            data['total_discount_given'] = Decimal('0.00')
            data['is_active'] = True
            
            # This would create the discount rule using a repository
            # For now, return the data with an ID
            import uuid
            data['id'] = str(uuid.uuid4())
            data['created_at'] = datetime.utcnow()
            data['updated_at'] = datetime.utcnow()
            
            return data
            
        except Exception as e:
            logger.error(f"Error creating discount rule: {e}")
            raise
    
    def get_discount_rules_with_filters(self, filters: DiscountRuleFilter) -> Dict[str, Any]:
        """
        Get discount rules with advanced filtering
        
        Args:
            filters: Filter parameters
            
        Returns:
            Dictionary with rules and metadata
        """
        try:
            # This would use a discount rule repository with filtering
            # For now, return empty result
            return {
                'rules': [],
                'total': 0,
                'filters_applied': filters.dict(exclude_none=True)
            }
            
        except Exception as e:
            logger.error(f"Error getting discount rules with filters: {e}")
            raise
    
    def apply_discount(self, work_order_id: UUID, discount_rule_id: Optional[UUID] = None,
                      customer_credit_id: Optional[UUID] = None, discount_code: Optional[str] = None,
                      staff_id: UUID = None) -> Dict[str, Any]:
        """
        Apply discount to work order
        
        Args:
            work_order_id: Work order UUID
            discount_rule_id: Optional discount rule ID
            customer_credit_id: Optional customer credit ID
            discount_code: Optional discount code
            staff_id: Staff applying the discount
            
        Returns:
            Applied discount dictionary
        """
        try:
            # This would validate and apply the discount
            # For now, return mock data
            import uuid
            
            applied_discount = {
                'id': str(uuid.uuid4()),
                'work_order_id': work_order_id,
                'discount_rule_id': discount_rule_id,
                'customer_credit_id': customer_credit_id,
                'discount_code_used': discount_code,
                'discount_amount': Decimal('50.00'),  # Mock discount
                'original_amount': Decimal('500.00'),
                'final_amount': Decimal('450.00'),
                'applied_by_staff_id': staff_id,
                'applied_date': datetime.utcnow(),
                'is_approved': True,
                'is_reversed': False,
                'created_at': datetime.utcnow(),
                'updated_at': datetime.utcnow()
            }
            
            return applied_discount
            
        except Exception as e:
            logger.error(f"Error applying discount: {e}")
            raise
    
    def validate_discount_code(self, discount_code: str, work_order_amount: Decimal) -> Optional[Dict[str, Any]]:
        """
        Validate discount code and calculate discount
        
        Args:
            discount_code: Discount code to validate
            work_order_amount: Work order total amount
            
        Returns:
            Discount rule and calculated amount or None if invalid
        """
        try:
            # This would find and validate the discount code
            # For now, return mock validation for "SAVE10"
            if discount_code == "SAVE10":
                return {
                    'rule_id': str(UUID('12345678-1234-5678-9012-123456789012')),
                    'discount_type': 'percentage',
                    'discount_value': Decimal('10.00'),
                    'calculated_discount': work_order_amount * Decimal('0.10'),
                    'is_valid': True,
                    'message': '10% discount applied'
                }
            
            return {
                'is_valid': False,
                'message': 'Invalid discount code'
            }
            
        except Exception as e:
            logger.error(f"Error validating discount code: {e}")
            return {
                'is_valid': False,
                'message': 'Error validating discount code'
            }
    
    def get_credit_dashboard_stats(self, company_id: Optional[UUID] = None) -> Dict[str, Any]:
        """
        Get dashboard statistics for credits and discounts
        
        Args:
            company_id: Optional company filter
            
        Returns:
            Dictionary with various statistics
        """
        try:
            # This would calculate real statistics from the database
            # For now, return mock data
            return {
                'total_credits_issued': 0,
                'total_credit_amount': '0.00',
                'credits_used': 0,
                'credits_expired': 0,
                'active_discount_rules': 0,
                'total_discounts_applied': 0,
                'total_discount_amount': '0.00',
                'this_month_credits': 0,
                'this_month_discounts': 0,
                'popular_discount_codes': [],
                'credit_expiring_soon': 0,
                'last_updated': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error getting credit dashboard stats: {e}")
            raise
    
    def _validate_create_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate credit creation data"""
        # Ensure required fields
        if not data.get('amount') or data['amount'] <= 0:
            raise ValueError("Credit amount must be greater than 0")
        
        if not data.get('customer_name'):
            raise ValueError("Customer name is required")
        
        if not data.get('credit_number'):
            data['credit_number'] = self.generate_credit_number()
        
        return data
    
    def _validate_update_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate credit update data"""
        # Remove fields that shouldn't be updated directly
        protected_fields = ['id', 'created_at', 'credit_number', 'original_amount']
        for field in protected_fields:
            data.pop(field, None)
        
        return data