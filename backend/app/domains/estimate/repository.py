"""
Estimate domain repository implementations for different database providers.
"""

from typing import Any, Dict, List, Optional
import logging
from datetime import datetime, date
from decimal import Decimal
import json

from app.common.base_repository import SQLAlchemyRepository, SupabaseRepository
from app.core.interfaces import DatabaseSession
from app.domains.estimate.models import Estimate, EstimateItem
from app.core.config import settings

logger = logging.getLogger(__name__)


class EstimateRepositoryMixin:
    """Mixin with estimate-specific methods"""
    
    def get_by_estimate_number(self, estimate_number: str) -> Optional[Dict[str, Any]]:
        """Get estimate by estimate number"""
        estimates = self.get_all(filters={'estimate_number': estimate_number}, limit=1)
        return estimates[0] if estimates else None
    
    def get_estimates_by_status(self, status: str) -> List[Dict[str, Any]]:
        """Get estimates by status"""
        return self.get_all(filters={'status': status}, order_by='-estimate_date')
    
    def get_estimates_by_company(self, company_id: str) -> List[Dict[str, Any]]:
        """Get estimates for a specific company"""
        return self.get_all(filters={'company_id': company_id}, order_by='-estimate_date')
    
    def get_estimates_by_date_range(self, 
                                   start_date: date, 
                                   end_date: date) -> List[Dict[str, Any]]:
        """Get estimates within a date range"""
        # This will be implemented differently for each database type
        raise NotImplementedError("Subclasses must implement get_estimates_by_date_range")
    
    def get_expired_estimates(self) -> List[Dict[str, Any]]:
        """Get expired estimates"""
        # This will be implemented differently for each database type
        raise NotImplementedError("Subclasses must implement get_expired_estimates")
    
    def calculate_totals(self, estimate_data: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate estimate totals based on items"""
        items = estimate_data.get('items', [])
        
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
        
        discount = Decimal(str(estimate_data.get('discount_amount', 0)))
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
    
    def search_estimates(self, search_term: str) -> List[Dict[str, Any]]:
        """Search estimates by various fields"""
        # This will be implemented differently for each database type
        raise NotImplementedError("Subclasses must implement search_estimates")


class EstimateSQLAlchemyRepository(SQLAlchemyRepository, EstimateRepositoryMixin):
    """SQLAlchemy-based estimate repository for SQLite/PostgreSQL"""
    
    def __init__(self, session: DatabaseSession):
        super().__init__(session, Estimate)
    
    def _normalize_estimate_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize estimate data by adding missing fields with defaults"""
        if data and isinstance(data, dict):
            # Add estimate_type if missing (backward compatibility)
            if 'estimate_type' not in data or data.get('estimate_type') is None:
                # Determine type based on insurance fields
                if data.get('claim_number') or data.get('policy_number'):
                    data['estimate_type'] = 'insurance'
                else:
                    data['estimate_type'] = 'standard'
        return data
    
    def get_by_id(self, entity_id: str) -> Optional[Dict[str, Any]]:
        """Get estimate by ID with data normalization"""
        result = super().get_by_id(entity_id)
        return self._normalize_estimate_data(result)
    
    def get_all(self, filters=None, order_by=None, limit=None, offset=None):
        """Get all estimates with data normalization"""
        results = super().get_all(filters, order_by, limit, offset)
        return [self._normalize_estimate_data(item) for item in results]
    
    def get_estimates_by_date_range(self, 
                                   start_date: date, 
                                   end_date: date) -> List[Dict[str, Any]]:
        """Get estimates within a date range using SQLAlchemy"""
        try:
            entities = self.db_session.query(Estimate).filter(
                Estimate.estimate_date >= start_date,
                Estimate.estimate_date <= end_date
            ).order_by(Estimate.estimate_date.desc()).all()
            
            return [self._convert_to_dict(entity) for entity in entities]
            
        except Exception as e:
            logger.error(f"Error getting estimates by date range: {e}")
            raise Exception(f"Failed to get estimates by date range: {e}")
    
    def get_expired_estimates(self) -> List[Dict[str, Any]]:
        """Get expired estimates using SQLAlchemy"""
        try:
            current_date = datetime.utcnow().date()
            
            entities = self.db_session.query(Estimate).filter(
                Estimate.valid_until < current_date,
                Estimate.status.in_(['draft', 'sent'])
            ).order_by(Estimate.valid_until.asc()).all()
            
            return [self._convert_to_dict(entity) for entity in entities]
            
        except Exception as e:
            logger.error(f"Error getting expired estimates: {e}")
            raise Exception(f"Failed to get expired estimates: {e}")
    
    def search_estimates(self, search_term: str) -> List[Dict[str, Any]]:
        """Search estimates using SQL LIKE queries"""
        try:
            search_pattern = f"%{search_term.lower()}%"
            
            entities = self.db_session.query(Estimate).filter(
                (Estimate.estimate_number.ilike(search_pattern)) |
                (Estimate.client_name.ilike(search_pattern)) |
                (Estimate.client_email.ilike(search_pattern)) |
                (Estimate.claim_number.ilike(search_pattern)) |
                (Estimate.policy_number.ilike(search_pattern))
            ).order_by(Estimate.estimate_date.desc()).all()
            
            return [self._convert_to_dict(entity) for entity in entities]
            
        except Exception as e:
            logger.error(f"Error searching estimates: {e}")
            raise Exception(f"Failed to search estimates: {e}")
    
    def get_with_items(self, estimate_id: str) -> Optional[Dict[str, Any]]:
        """Get estimate with its items"""
        try:
            estimate = self.db_session.query(Estimate).filter(
                Estimate.id == estimate_id
            ).first()
            
            if not estimate:
                return None
            
            estimate_dict = self._convert_to_dict(estimate)
            
            # Get items
            items = self.db_session.query(EstimateItem).filter(
                EstimateItem.estimate_id == estimate_id
            ).order_by(EstimateItem.order_index).all()
            
            estimate_dict['items'] = [self._convert_to_dict(item) for item in items]
            
            # Normalize data (add missing fields)
            return self._normalize_estimate_data(estimate_dict)
            
        except Exception as e:
            logger.error(f"Error getting estimate with items: {e}")
            raise Exception(f"Failed to get estimate with items: {e}")
    
    def create_with_items(self, estimate_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create estimate with items in a transaction"""
        try:
            # Calculate totals
            totals = self.calculate_totals(estimate_data)
            estimate_data.update(totals)
            
            # Extract items and room_data
            items_data = estimate_data.pop('items', [])
            room_data = estimate_data.get('room_data')
            
            # Convert room_data to JSON string if it's a dict
            if isinstance(room_data, dict):
                estimate_data['room_data'] = json.dumps(room_data)
            
            # Create estimate
            estimate = self.create(estimate_data)
            estimate_id = estimate['id']
            
            # Create items
            for idx, item_data in enumerate(items_data):
                item_data['estimate_id'] = estimate_id
                item_data['order_index'] = idx
                
                item_entity = EstimateItem(**item_data)
                self.db_session.add(item_entity)
            
            self.db_session.flush()
            
            # Return estimate with items
            return self.get_with_items(estimate_id)
            
        except Exception as e:
            logger.error(f"Error creating estimate with items: {e}")
            self.db_session.rollback()
            raise Exception(f"Failed to create estimate with items: {e}")
    
    def get_insurance_estimates(self) -> List[Dict[str, Any]]:
        """Get estimates that have insurance-specific data"""
        try:
            entities = self.db_session.query(Estimate).filter(
                (Estimate.claim_number.isnot(None)) |
                (Estimate.policy_number.isnot(None))
            ).order_by(Estimate.estimate_date.desc()).all()
            
            return [self._convert_to_dict(entity) for entity in entities]
            
        except Exception as e:
            logger.error(f"Error getting insurance estimates: {e}")
            raise Exception(f"Failed to get insurance estimates: {e}")


class EstimateSupabaseRepository(SupabaseRepository, EstimateRepositoryMixin):
    """Supabase-based estimate repository"""
    
    def __init__(self, session: DatabaseSession):
        super().__init__(session, "estimates", Estimate)
    
    def get_estimates_by_date_range(self, 
                                   start_date: date, 
                                   end_date: date) -> List[Dict[str, Any]]:
        """Get estimates within a date range using Supabase"""
        try:
            response = self.client.table('estimates').select('*').gte(
                'estimate_date', start_date.isoformat()
            ).lte(
                'estimate_date', end_date.isoformat()
            ).order('estimate_date', desc=True).execute()
            
            return response.data if response.data else []
            
        except Exception as e:
            logger.error(f"Error getting estimates by date range from Supabase: {e}")
            raise Exception(f"Failed to get estimates by date range: {e}")
    
    def get_expired_estimates(self) -> List[Dict[str, Any]]:
        """Get expired estimates using Supabase"""
        try:
            current_date = datetime.utcnow().date().isoformat()
            
            response = self.client.table('estimates').select('*').lt(
                'valid_until', current_date
            ).in_('status', ['draft', 'sent']).order('valid_until', desc=False).execute()
            
            return response.data if response.data else []
            
        except Exception as e:
            logger.error(f"Error getting expired estimates from Supabase: {e}")
            raise Exception(f"Failed to get expired estimates: {e}")
    
    def search_estimates(self, search_term: str) -> List[Dict[str, Any]]:
        """Search estimates using Supabase text search"""
        try:
            # Get all estimates first, then filter in Python
            # This is a limitation of the current Supabase client
            all_estimates = self.get_all()
            
            search_lower = search_term.lower()
            filtered_estimates = [
                estimate for estimate in all_estimates
                if (
                    search_lower in (estimate.get('estimate_number', '') or '').lower() or
                    search_lower in (estimate.get('client_name', '') or '').lower() or
                    search_lower in (estimate.get('client_email', '') or '').lower() or
                    search_lower in (estimate.get('claim_number', '') or '').lower() or
                    search_lower in (estimate.get('policy_number', '') or '').lower()
                )
            ]
            
            # Sort by estimate date
            filtered_estimates.sort(key=lambda x: x.get('estimate_date', ''), reverse=True)
            
            return filtered_estimates
            
        except Exception as e:
            logger.error(f"Error searching estimates in Supabase: {e}")
            raise Exception(f"Failed to search estimates: {e}")
    
    def get_with_items(self, estimate_id: str) -> Optional[Dict[str, Any]]:
        """Get estimate with its items"""
        try:
            # Get estimate
            estimate_response = self.client.table('estimates').select('*').eq('id', estimate_id).execute()
            
            if not estimate_response.data:
                return None
            
            estimate = estimate_response.data[0]
            
            # Parse room_data if it's a JSON string
            if estimate.get('room_data') and isinstance(estimate['room_data'], str):
                try:
                    estimate['room_data'] = json.loads(estimate['room_data'])
                except json.JSONDecodeError:
                    logger.warning(f"Invalid JSON in room_data for estimate {estimate_id}")
            
            # Get items
            items_response = self.client.table('estimate_items').select('*').eq(
                'estimate_id', estimate_id
            ).order('order_index').execute()
            
            estimate['items'] = items_response.data if items_response.data else []
            
            # Normalize data (add missing fields)
            return self._normalize_estimate_data(estimate)
            
        except Exception as e:
            logger.error(f"Error getting estimate with items from Supabase: {e}")
            raise Exception(f"Failed to get estimate with items: {e}")
    
    def create_with_items(self, estimate_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create estimate with items (Supabase doesn't support transactions)"""
        try:
            # Calculate totals
            totals = self.calculate_totals(estimate_data)
            estimate_data.update(totals)
            
            # Extract items and handle room_data
            items_data = estimate_data.pop('items', [])
            room_data = estimate_data.get('room_data')
            
            # Convert room_data to JSON string if it's a dict
            if isinstance(room_data, dict):
                estimate_data['room_data'] = json.dumps(room_data)
            
            # Create estimate
            estimate = self.create(estimate_data)
            estimate_id = estimate['id']
            
            # Create items
            for idx, item_data in enumerate(items_data):
                item_data['estimate_id'] = estimate_id
                item_data['order_index'] = idx
                
                # Convert Decimal values to float
                for key, value in item_data.items():
                    if isinstance(value, Decimal):
                        item_data[key] = float(value)
                
                try:
                    self.client.table('estimate_items').insert(item_data).execute()
                except Exception as item_error:
                    logger.error(f"Error creating estimate item: {item_error}")
                    # Continue with other items
                    continue
            
            # Return estimate with items
            return self.get_with_items(estimate_id)
            
        except Exception as e:
            logger.error(f"Error creating estimate with items in Supabase: {e}")
            raise Exception(f"Failed to create estimate with items: {e}")
    
    def get_insurance_estimates(self) -> List[Dict[str, Any]]:
        """Get estimates that have insurance-specific data"""
        try:
            # Get all estimates and filter for insurance ones
            all_estimates = self.get_all()
            
            insurance_estimates = [
                estimate for estimate in all_estimates
                if estimate.get('claim_number') or estimate.get('policy_number')
            ]
            
            # Sort by estimate date
            insurance_estimates.sort(key=lambda x: x.get('estimate_date', ''), reverse=True)
            
            return insurance_estimates
            
        except Exception as e:
            logger.error(f"Error getting insurance estimates from Supabase: {e}")
            raise Exception(f"Failed to get insurance estimates: {e}")
    
    def _normalize_estimate_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize estimate data by adding missing fields with defaults"""
        if data and isinstance(data, dict):
            # Add estimate_type if missing (backward compatibility)
            if 'estimate_type' not in data:
                # Determine type based on insurance fields
                if data.get('claim_number') or data.get('policy_number'):
                    data['estimate_type'] = 'insurance'
                else:
                    data['estimate_type'] = 'standard'
        return data
    
    def get_by_id(self, entity_id: str) -> Optional[Dict[str, Any]]:
        """Get estimate by ID with data normalization"""
        result = super().get_by_id(entity_id)
        return self._normalize_estimate_data(result)
    
    def get_all(self, filters=None, order_by=None, limit=None, offset=None):
        """Get all estimates with data normalization"""
        results = super().get_all(filters, order_by, limit, offset)
        return [self._normalize_estimate_data(item) for item in results]
    
    def create(self, entity_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create estimate with Supabase-specific handling"""
        # Remove fields that might cause issues in Supabase
        clean_data = entity_data.copy()
        
        # Set default estimate_type if not provided
        if 'estimate_type' not in clean_data:
            clean_data['estimate_type'] = 'standard'
        
        # Convert Decimal values to float
        for key, value in clean_data.items():
            if isinstance(value, Decimal):
                clean_data[key] = float(value)
        
        # Handle room_data JSON
        if 'room_data' in clean_data and isinstance(clean_data['room_data'], dict):
            clean_data['room_data'] = json.dumps(clean_data['room_data'])
        
        # Remove None values
        clean_data = {k: v for k, v in clean_data.items() if v is not None}
        
        # Remove timestamp fields (they're auto-managed by Supabase)
        clean_data.pop('created_at', None)
        clean_data.pop('updated_at', None)
        
        return super().create(clean_data)


def get_estimate_repository(session: DatabaseSession) -> EstimateRepositoryMixin:
    """Factory function to get appropriate estimate repository based on database type"""
    
    # Check if it's a UnitOfWork object
    if hasattr(session, 'session'):
        # It's a UnitOfWork, extract the actual session
        actual_session = session.session
        if hasattr(actual_session, 'query') or hasattr(actual_session, 'db_session'):
            # SQLAlchemy session
            return EstimateSQLAlchemyRepository(actual_session)
        else:
            # Supabase client
            return EstimateSupabaseRepository(actual_session)
    
    # Direct session check
    elif hasattr(session, 'query') or hasattr(session, 'db_session'):
        # SQLAlchemy session
        return EstimateSQLAlchemyRepository(session)
    elif hasattr(session, 'table'):
        # Supabase client
        return EstimateSupabaseRepository(session)
    else:
        # Default to Supabase for backward compatibility
        logger.warning(f"Could not determine session type for {type(session)}, defaulting to Supabase")
        return EstimateSupabaseRepository(session)