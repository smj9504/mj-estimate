"""
Estimate domain service with comprehensive business logic and validation.
"""

from typing import Any, Dict, List, Optional
import logging
from datetime import datetime, date
from decimal import Decimal
import json
from sqlalchemy import text, select, func

from app.common.base_service import TransactionalService
from app.domains.estimate.repository import get_estimate_repository
from app.core.interfaces import DatabaseProvider
from app.core.database_factory import get_database

logger = logging.getLogger(__name__)


class EstimateService(TransactionalService[Dict[str, Any], str]):
    """
    Service for estimate-related business operations.
    Provides comprehensive CRUD operations with validation and business logic.
    """
    
    def __init__(self, database: DatabaseProvider = None):
        super().__init__(database)
    
    def get_repository(self):
        """Get the estimate repository"""
        pass
    
    def _get_repository_instance(self, session):
        """Get estimate repository instance with the given session"""
        return get_estimate_repository(session)
    
    def get_by_estimate_number(self, estimate_number: str) -> Optional[Dict[str, Any]]:
        """
        Get estimate by estimate number.
        
        Args:
            estimate_number: Estimate number
            
        Returns:
            Estimate dictionary or None if not found
        """
        try:
            with self.database.get_session() as session:
                repository = self._get_repository_instance(session)
                return repository.get_by_estimate_number(estimate_number)
        except Exception as e:
            logger.error(f"Error getting estimate by number: {e}")
            raise
    
    def get_estimates_by_status(self, status: str) -> List[Dict[str, Any]]:
        """
        Get estimates by status.
        
        Args:
            status: Estimate status
            
        Returns:
            List of estimate dictionaries
        """
        try:
            with self.database.get_session() as session:
                repository = self._get_repository_instance(session)
                return repository.get_estimates_by_status(status)
        except Exception as e:
            logger.error(f"Error getting estimates by status: {e}")
            raise
    
    def get_estimates_by_company(self, company_id: str) -> List[Dict[str, Any]]:
        """
        Get estimates for a specific company.
        
        Args:
            company_id: Company ID
            
        Returns:
            List of estimate dictionaries
        """
        try:
            with self.database.get_session() as session:
                repository = self._get_repository_instance(session)
                return repository.get_estimates_by_company(company_id)
        except Exception as e:
            logger.error(f"Error getting estimates by company: {e}")
            raise
    
    def get_estimates_by_date_range(self, 
                                   start_date: date, 
                                   end_date: date) -> List[Dict[str, Any]]:
        """
        Get estimates within a date range.
        
        Args:
            start_date: Start date
            end_date: End date
            
        Returns:
            List of estimate dictionaries
        """
        try:
            with self.database.get_session() as session:
                repository = self._get_repository_instance(session)
                return repository.get_estimates_by_date_range(start_date, end_date)
        except Exception as e:
            logger.error(f"Error getting estimates by date range: {e}")
            raise
    
    def get_expired_estimates(self) -> List[Dict[str, Any]]:
        """
        Get expired estimates.
        
        Returns:
            List of expired estimate dictionaries
        """
        try:
            with self.database.get_session() as session:
                repository = self._get_repository_instance(session)
                return repository.get_expired_estimates()
        except Exception as e:
            logger.error(f"Error getting expired estimates: {e}")
            raise
    
    def search_estimates(self, search_term: str) -> List[Dict[str, Any]]:
        """
        Search estimates by various fields.
        
        Args:
            search_term: Text to search for
            
        Returns:
            List of matching estimate dictionaries
        """
        try:
            with self.database.get_session() as session:
                repository = self._get_repository_instance(session)
                return repository.search_estimates(search_term)
        except Exception as e:
            logger.error(f"Error searching estimates: {e}")
            raise
    
    def get_with_items(self, estimate_id: str) -> Optional[Dict[str, Any]]:
        """
        Get estimate with its items.
        
        Args:
            estimate_id: Estimate ID
            
        Returns:
            Estimate dictionary with items or None if not found
        """
        try:
            with self.database.get_session() as session:
                repository = self._get_repository_instance(session)
                return repository.get_with_items(estimate_id)
        except Exception as e:
            logger.error(f"Error getting estimate with items: {e}")
            raise
    
    def get_insurance_estimates(self) -> List[Dict[str, Any]]:
        """
        Get estimates that have insurance-specific data.
        
        Returns:
            List of insurance estimate dictionaries
        """
        try:
            with self.database.get_session() as session:
                repository = self._get_repository_instance(session)
                return repository.get_insurance_estimates()
        except Exception as e:
            logger.error(f"Error getting insurance estimates: {e}")
            raise
    
    def create_with_items(self, estimate_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Create estimate with items in a single transaction.
        
        Args:
            estimate_data: Estimate data including items and room data
            
        Returns:
            Created estimate dictionary with items
        """
        def _create_operation(session_or_uow, data):
            repository = self._get_repository_instance(session_or_uow)
            return repository.create_with_items(data)
        
        # Validate data
        validated_data = self._validate_create_data(estimate_data)
        
        # Generate estimate number if not provided
        if not validated_data.get('estimate_number'):
            validated_data['estimate_number'] = self._generate_estimate_number()
        
        return self.execute_in_transaction(_create_operation, validated_data)
    
    def update_with_items(self, estimate_id: str, estimate_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Update estimate with items.

        Args:
            estimate_id: Estimate ID
            estimate_data: Updated estimate data including items

        Returns:
            Updated estimate dictionary with items
        """
        logger.info(f"=== SERVICE update_with_items START ===")
        logger.info(f"Estimate ID: {estimate_id}")
        logger.info(f"Input data keys: {list(estimate_data.keys())}")
        logger.info(f"Input loss_date: {estimate_data.get('loss_date')}")
        logger.info(f"Input client_name: {estimate_data.get('client_name')}")

        def _update_operation(session, estimate_id, data):
            logger.info(f"=== _update_operation START ===")
            logger.info(f"Data keys in _update_operation: {list(data.keys())}")
            logger.info(f"loss_date in _update_operation: {data.get('loss_date')}")
            logger.info(f"client_name in _update_operation: {data.get('client_name')}")

            repository = self._get_repository_instance(session)

            # Extract items and room_data
            items_data = data.pop('items', [])
            room_data = data.get('room_data')

            # Convert room_data to JSON string if it's a dict
            if isinstance(room_data, dict):
                data['room_data'] = json.dumps(room_data)

            logger.info(f"Final data before repository.update: {list(data.keys())}")
            logger.info(f"Final loss_date before repository.update: {data.get('loss_date')}")
            logger.info(f"Final client_name before repository.update: {data.get('client_name')}")

            # Update estimate
            updated_estimate = repository.update(estimate_id, data)
            if not updated_estimate:
                return None
            
            # Update items (simplified approach)
            # In a production system, you might want to handle item updates more granularly
            if hasattr(repository, 'delete_items_by_estimate_id'):
                repository.delete_items_by_estimate_id(estimate_id)
            
            # Create new items
            for idx, item_data in enumerate(items_data):
                item_data['estimate_id'] = estimate_id
                item_data['order_index'] = idx
                # Create item logic would go here
            
            return repository.get_with_items(estimate_id)
        
        validated_data = self._validate_update_data(estimate_data)
        
        return self.execute_in_transaction(_update_operation, estimate_id, validated_data)
    
    def accept_estimate(self, estimate_id: str) -> Optional[Dict[str, Any]]:
        """
        Mark estimate as accepted.
        
        Args:
            estimate_id: Estimate ID
            
        Returns:
            Updated estimate dictionary
        """
        return self.update(estimate_id, {'status': 'accepted'})
    
    def reject_estimate(self, estimate_id: str, reason: str = None) -> Optional[Dict[str, Any]]:
        """
        Mark estimate as rejected.
        
        Args:
            estimate_id: Estimate ID
            reason: Optional rejection reason
            
        Returns:
            Updated estimate dictionary
        """
        update_data = {'status': 'rejected'}
        if reason:
            update_data['rejection_reason'] = reason
        
        return self.update(estimate_id, update_data)
    
    def convert_to_invoice(self, estimate_id: str) -> Dict[str, Any]:
        """
        Convert estimate to invoice.
        
        Args:
            estimate_id: Estimate ID
            
        Returns:
            Created invoice dictionary
        """
        try:
            estimate = self.get_with_items(estimate_id)
            if not estimate:
                raise ValueError(f"Estimate {estimate_id} not found")
            
            # Import here to avoid circular imports
            from app.domains.invoice.service import InvoiceService
            
            invoice_service = InvoiceService(self.database)
            
            # Convert estimate data to invoice data
            invoice_data = {
                'company_id': estimate.get('company_id'),
                'client_name': estimate.get('client_name'),
                'client_address': estimate.get('client_address'),
                'client_city': estimate.get('client_city'),
                'client_state': estimate.get('client_state'),
                'client_zipcode': estimate.get('client_zipcode'),
                'client_phone': estimate.get('client_phone'),
                'client_email': estimate.get('client_email'),
                'subtotal': estimate.get('subtotal'),
                'tax_rate': estimate.get('tax_rate'),
                'tax_amount': estimate.get('tax_amount'),
                'discount_amount': estimate.get('discount_amount'),
                'total_amount': estimate.get('total_amount'),
                'notes': estimate.get('notes'),
                'terms': estimate.get('terms'),
                'items': estimate.get('items', [])
            }
            
            # Create invoice
            invoice = invoice_service.create_with_items(invoice_data)
            
            # Update estimate status
            self.update(estimate_id, {'status': 'converted'})
            
            return invoice
            
        except Exception as e:
            logger.error(f"Error converting estimate to invoice: {e}")
            raise
    
    def calculate_totals(self, items: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Calculate estimate totals based on items.
        
        Args:
            items: List of estimate items
            
        Returns:
            Dictionary with calculated totals
        """
        try:
            subtotal = Decimal('0')
            total_tax = Decimal('0')
            total_depreciation = Decimal('0')
            
            for item in items:
                quantity = Decimal(str(item.get('quantity', 1)))
                rate = Decimal(str(item.get('rate', 0)))
                tax_rate = Decimal(str(item.get('tax_rate', 0)))
                depreciation_rate = Decimal(str(item.get('depreciation_rate', 0)))
                
                item_amount = quantity * rate
                item_tax = item_amount * (tax_rate / 100)
                item_depreciation = item_amount * (depreciation_rate / 100)
                
                subtotal += item_amount
                total_tax += item_tax
                total_depreciation += item_depreciation
            
            discount = Decimal(str(items[0].get('discount_amount', 0) if items else 0))
            rcv_amount = subtotal + total_tax - discount  # Replacement Cost Value
            acv_amount = rcv_amount - total_depreciation  # Actual Cash Value
            
            return {
                'subtotal': float(subtotal),
                'tax_amount': float(total_tax),
                'depreciation_amount': float(total_depreciation),
                'rcv_amount': float(rcv_amount),
                'acv_amount': float(acv_amount),
                'total_amount': float(rcv_amount)  # Use RCV as total
            }
            
        except Exception as e:
            logger.error(f"Error calculating estimate totals: {e}")
            raise
    
    def get_estimate_summary(self) -> Dict[str, Any]:
        """
        Get comprehensive estimate summary statistics.
        
        Returns:
            Dictionary with estimate statistics
        """
        try:
            all_estimates = self.get_all()
            
            # Group by status
            status_counts = {}
            status_amounts = {}
            
            for estimate in all_estimates:
                status = estimate.get('status', 'unknown')
                amount = float(estimate.get('total_amount', 0))
                
                status_counts[status] = status_counts.get(status, 0) + 1
                status_amounts[status] = status_amounts.get(status, 0) + amount
            
            # Calculate expired
            expired_estimates = self.get_expired_estimates()
            expired_amount = sum(float(est.get('total_amount', 0)) for est in expired_estimates)
            
            # Insurance estimates
            insurance_estimates = self.get_insurance_estimates()
            insurance_amount = sum(float(est.get('total_amount', 0)) for est in insurance_estimates)
            
            # Calculate totals
            total_amount = sum(float(est.get('total_amount', 0)) for est in all_estimates)
            accepted_amount = status_amounts.get('accepted', 0)
            
            return {
                'total_estimates': len(all_estimates),
                'total_amount': total_amount,
                'accepted_amount': accepted_amount,
                'expired_count': len(expired_estimates),
                'expired_amount': expired_amount,
                'insurance_count': len(insurance_estimates),
                'insurance_amount': insurance_amount,
                'status_counts': status_counts,
                'status_amounts': status_amounts,
                'average_estimate_amount': total_amount / len(all_estimates) if all_estimates else 0,
                'acceptance_rate': (status_counts.get('accepted', 0) / len(all_estimates) * 100) if all_estimates else 0
            }
            
        except Exception as e:
            logger.error(f"Error getting estimate summary: {e}")
            raise
    
    def generate_estimate_number(self, company_id: Optional[str] = None, estimate_type: Optional[str] = None) -> Dict[str, Any]:
        """
        Generate next estimate number with metadata.

        Args:
            company_id: Optional company ID for company-specific numbering
            estimate_type: Optional estimate type (insurance, standard, etc.)

        Returns:
            Dictionary with estimate_number, sequence, company_prefix, and year
        """
        try:
            now = datetime.utcnow()
            year = str(now.year)

            # Build prefix based on company and type
            prefix_parts = ["EST"]
            company_prefix = None

            if company_id:
                # Get company code and name
                with self.database.get_session() as session:
                    from app.domains.company.models import Company

                    company = session.query(Company).filter(Company.id == company_id).first()
                    if company:
                        # Use company_code if available, otherwise first 3 chars of name
                        if company.company_code:
                            company_prefix = company.company_code.upper()
                        else:
                            company_prefix = company.name[:3].upper() if company.name else "UNK"
                        prefix_parts.append(company_prefix)

            if estimate_type and estimate_type != "standard":
                # Add type suffix (e.g., INS for insurance)
                type_suffix = estimate_type[:3].upper()
                prefix_parts.append(type_suffix)

            prefix_parts.append(year)
            prefix = "-".join(prefix_parts)

            # Count existing estimates for this company in current year
            sequence = 1
            if company_id:
                with self.database.get_session() as session:
                    # Count estimates for this specific company in the current year
                    from app.domains.estimate.models import Estimate
                    from sqlalchemy import extract

                    count = session.query(func.count(Estimate.id)).filter(
                        Estimate.company_id == company_id,
                        extract('year', Estimate.estimate_date) == int(year)
                    ).scalar()

                    if count:
                        sequence = count + 1
            else:
                # If no company, count all estimates with this prefix
                existing_estimates = self.get_all(
                    filters={'estimate_number__startswith': prefix}
                )
                sequence = len(existing_estimates) + 1

            # Generate final estimate number
            estimate_number = f"{prefix}-{sequence:04d}"

            logger.info(f"Generated estimate number: {estimate_number} (company_id: {company_id}, sequence: {sequence})")

            return {
                'estimate_number': estimate_number,
                'sequence': sequence,
                'company_prefix': company_prefix,
                'year': year
            }
            
        except Exception as e:
            logger.error(f"Error generating estimate number: {e}")
            # Fallback to simple timestamp-based number
            timestamp = int(now.timestamp())
            fallback_number = f"EST-{year}-{timestamp % 10000:04d}"
            
            return {
                'estimate_number': fallback_number,
                'sequence': timestamp % 10000,
                'company_prefix': None,
                'year': year
            }
    
    def _generate_estimate_number(self) -> str:
        """Generate unique estimate number"""
        try:
            # Get current year and month
            now = datetime.utcnow()
            prefix = f"EST-{now.year}{now.month:02d}"
            
            # Get existing estimates for this month
            existing_estimates = self.get_all(
                filters={'estimate_number__startswith': prefix}
            )
            
            # Find the next sequence number
            sequence = len(existing_estimates) + 1
            
            return f"{prefix}-{sequence:04d}"
            
        except Exception as e:
            logger.error(f"Error generating estimate number: {e}")
            # Fallback to timestamp-based number
            timestamp = int(datetime.utcnow().timestamp())
            return f"EST-{timestamp}"
    
    def _validate_create_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate data for estimate creation"""
        validated_data = data.copy()
        
        # Remove None values
        validated_data = {k: v for k, v in validated_data.items() if v is not None}
        
        # Validate items
        items = validated_data.get('items', [])
        if not items:
            raise ValueError("At least one estimate item is required")
        
        for item in items:
            if not item.get('description'):
                raise ValueError("Item description is required")
            if float(item.get('rate', 0)) < 0:
                raise ValueError("Item rate cannot be negative")
            if float(item.get('quantity', 0)) <= 0:
                raise ValueError("Item quantity must be positive")
        
        # Validate room data if provided
        room_data = validated_data.get('room_data')
        if room_data and not isinstance(room_data, (dict, str)):
            raise ValueError("Room data must be a dictionary or JSON string")
        
        # Calculate totals
        totals = self.calculate_totals(items)
        validated_data.update(totals)
        
        return validated_data
    
    def _validate_update_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate data for estimate update"""
        logger.info(f"=== SERVICE _validate_update_data INPUT ===")
        logger.info(f"Original data keys: {list(data.keys())}")
        logger.info(f"loss_date in original data: {data.get('loss_date')}")
        logger.info(f"client_name in original data: {data.get('client_name')}")

        validated_data = data.copy()

        # Remove None values
        logger.info(f"Before removing None values - loss_date: {validated_data.get('loss_date')}")
        validated_data = {k: v for k, v in validated_data.items() if v is not None}
        logger.info(f"After removing None values - loss_date: {validated_data.get('loss_date')}")
        logger.info(f"After removing None values - client_name: {validated_data.get('client_name')}")
        
        # Remove system fields and ID
        for field in ['created_at', 'updated_at', 'id']:
            validated_data.pop(field, None)
        
        if not validated_data:
            raise ValueError("No valid data provided for update")
        
        # Validate items if provided
        items = validated_data.get('items')
        if items is not None:
            if not items:
                raise ValueError("At least one estimate item is required")
            
            for item in items:
                if not item.get('description'):
                    raise ValueError("Item description is required")
                if float(item.get('rate', 0)) < 0:
                    raise ValueError("Item rate cannot be negative")
                if float(item.get('quantity', 0)) <= 0:
                    raise ValueError("Item quantity must be positive")
            
            # Calculate totals
            totals = self.calculate_totals(items)
            validated_data.update(totals)
        
        # Validate room data if provided
        room_data = validated_data.get('room_data')
        if room_data and not isinstance(room_data, (dict, str)):
            raise ValueError("Room data must be a dictionary or JSON string")
        
        return validated_data