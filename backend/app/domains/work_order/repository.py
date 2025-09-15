"""
Work Order domain repository
"""

from typing import Any, Dict, List, Optional
from datetime import datetime
from uuid import UUID
import logging

from app.common.base_repository import SQLAlchemyRepository, SupabaseRepository
from app.core.interfaces import DatabaseSession
from .models import WorkOrder, WorkOrderStatus

logger = logging.getLogger(__name__)


class WorkOrderRepositoryMixin:
    """Mixin with work order-specific methods"""
    
    def get_by_status(self, status: WorkOrderStatus) -> List[Dict[str, Any]]:
        """Get work orders by status"""
        return self.get_all(filters={'status': status.value}, order_by='created_at')
    
    def get_by_customer_id(self, customer_id: str) -> List[Dict[str, Any]]:
        """Get work orders for a specific customer"""
        return self.get_all(filters={'customer_id': customer_id}, order_by='created_at')
    
    def get_by_company(self, company_id: str) -> List[Dict[str, Any]]:
        """Get work orders for a specific company"""
        return self.get_all(filters={'company_id': company_id}, order_by='created_at')
    
    def get_active_orders(self) -> List[Dict[str, Any]]:
        """Get all active work orders (not completed or cancelled)"""
        # For SQLAlchemy, this would need a custom query
        # For Supabase, we can use filters
        raise NotImplementedError("Subclasses must implement get_active_orders")
    
    def update_status(self, order_id: str, status: WorkOrderStatus) -> Optional[Dict[str, Any]]:
        """Update work order status"""
        return self.update(order_id, {'status': status.value, 'updated_at': datetime.utcnow()})
    
    def search_orders(self, search_term: str) -> List[Dict[str, Any]]:
        """Search work orders by various fields"""
        raise NotImplementedError("Subclasses must implement search_orders")
    
    def get_latest_work_order_by_year(self, year: int) -> Optional[Dict[str, Any]]:
        """Get the latest work order for a specific year"""
        raise NotImplementedError("Subclasses must implement get_latest_work_order_by_year")


class WorkOrderSQLAlchemyRepository(SQLAlchemyRepository, WorkOrderRepositoryMixin):
    """SQLAlchemy-based work order repository for SQLite/PostgreSQL"""
    
    def __init__(self, session: DatabaseSession):
        super().__init__(session, WorkOrder)
    
    def get_active_orders(self) -> List[Dict[str, Any]]:
        """Get all active work orders"""
        try:
            entities = self.db_session.query(WorkOrder).filter(
                WorkOrder.status.in_([
                    WorkOrderStatus.PENDING.value,
                    WorkOrderStatus.IN_PROGRESS.value
                ])
            ).order_by(WorkOrder.created_at.desc()).all()
            
            return [self._convert_to_dict(entity) for entity in entities]
        except Exception as e:
            logger.error(f"Error getting active orders: {e}")
            return []
    
    def search_orders(self, search_term: str) -> List[Dict[str, Any]]:
        """Search work orders using SQL LIKE queries (case-insensitive)"""
        try:
            search_pattern = f"%{search_term.lower()}%"
            
            entities = self.db_session.query(WorkOrder).filter(
                (WorkOrder.work_order_number.ilike(search_pattern)) |
                (WorkOrder.client_address.ilike(search_pattern)) |
                (WorkOrder.client_city.ilike(search_pattern)) |
                (WorkOrder.client_state.ilike(search_pattern)) |
                (WorkOrder.client_zipcode.ilike(search_pattern)) |
                (WorkOrder.job_site_address.ilike(search_pattern)) |
                (WorkOrder.job_site_city.ilike(search_pattern)) |
                (WorkOrder.job_site_state.ilike(search_pattern)) |
                (WorkOrder.job_site_zipcode.ilike(search_pattern))
            ).order_by(WorkOrder.created_at.desc()).all()
            
            return [self._convert_to_dict(entity) for entity in entities]
        except Exception as e:
            logger.error(f"Error searching work orders: {e}")
            return []
    
    def get_latest_work_order_by_year(self, year: int) -> Optional[Dict[str, Any]]:
        """Get the latest work order for a specific year"""
        try:
            from sqlalchemy import extract
            
            entity = self.db_session.query(WorkOrder).filter(
                extract('year', WorkOrder.created_at) == year
            ).order_by(WorkOrder.created_at.desc()).first()
            
            return self._convert_to_dict(entity) if entity else None
        except Exception as e:
            logger.error(f"Error getting latest work order by year: {e}")
            return None
    
    def work_order_number_exists(self, work_order_number: str) -> bool:
        """Check if a work order number already exists"""
        try:
            exists = self.db_session.query(WorkOrder).filter(
                WorkOrder.work_order_number == work_order_number
            ).first() is not None
            return exists
        except Exception as e:
            logger.error(f"Error checking work order number existence: {e}")
            return False
    
    def get_work_orders_by_staff(self, staff_id: UUID) -> List[Dict[str, Any]]:
        """Get work orders created by or assigned to a staff member"""
        try:
            from sqlalchemy import or_
            
            entities = self.db_session.query(WorkOrder).filter(
                or_(
                    WorkOrder.created_by_staff_id == staff_id,
                    WorkOrder.assigned_to_staff_id == staff_id
                )
            ).order_by(WorkOrder.created_at.desc()).all()
            
            return [self._convert_to_dict(entity) for entity in entities]
        except Exception as e:
            logger.error(f"Error getting work orders by staff: {e}")
            return []
    
    def get_dashboard_stats(self, company_id: Optional[UUID] = None) -> Dict[str, Any]:
        """Get dashboard statistics for work orders"""
        try:
            from sqlalchemy import func
            
            query = self.db_session.query(WorkOrder)
            
            if company_id:
                query = query.filter(WorkOrder.company_id == company_id)
            
            total_count = query.count()
            
            # Count by status
            status_counts = {}
            for status in WorkOrderStatus:
                count = query.filter(WorkOrder.status == status).count()
                status_counts[status.value] = count
            
            # Count by priority
            priority_counts = {
                'low': query.filter(WorkOrder.priority == 'low').count(),
                'medium': query.filter(WorkOrder.priority == 'medium').count(),
                'high': query.filter(WorkOrder.priority == 'high').count(),
                'urgent': query.filter(WorkOrder.priority == 'urgent').count()
            }
            
            return {
                'total': total_count,
                'by_status': status_counts,
                'by_priority': priority_counts,
                'active': query.filter(WorkOrder.is_active == True).count(),
                'inactive': query.filter(WorkOrder.is_active == False).count()
            }
        except Exception as e:
            logger.error(f"Error getting dashboard stats: {e}")
            return {
                'total': 0,
                'by_status': {},
                'by_priority': {},
                'active': 0,
                'inactive': 0
            }


class WorkOrderSupabaseRepository(SupabaseRepository, WorkOrderRepositoryMixin):
    """Supabase-based work order repository"""
    
    def __init__(self, session: DatabaseSession):
        super().__init__(session, 'work_orders')
    
    def get_active_orders(self) -> List[Dict[str, Any]]:
        """Get all active work orders"""
        try:
            response = self.client.table(self.table_name)\
                .select("*")\
                .in_('status', [WorkOrderStatus.PENDING.value, WorkOrderStatus.IN_PROGRESS.value])\
                .order('created_at', desc=True)\
                .execute()
            
            return response.data if response.data else []
        except Exception as e:
            logger.error(f"Error getting active orders: {e}")
            return []
    
    def search_orders(self, search_term: str) -> List[Dict[str, Any]]:
        """Search work orders in Supabase"""
        try:
            search_lower = search_term.lower()
            
            # Search in work order number and all address fields (case-insensitive)
            response = self.client.table(self.table_name)\
                .select("*")\
                .or_(f"work_order_number.ilike.%{search_lower}%,client_address.ilike.%{search_lower}%,client_city.ilike.%{search_lower}%,client_state.ilike.%{search_lower}%,client_zipcode.ilike.%{search_lower}%,job_site_address.ilike.%{search_lower}%,job_site_city.ilike.%{search_lower}%,job_site_state.ilike.%{search_lower}%,job_site_zipcode.ilike.%{search_lower}%")\
                .order('created_at', desc=True)\
                .execute()
            
            return response.data if response.data else []
        except Exception as e:
            logger.error(f"Error searching work orders: {e}")
            return []
    
    def get_latest_work_order_by_year(self, year: int) -> Optional[Dict[str, Any]]:
        """Get the latest work order for a specific year in Supabase"""
        try:
            # Filter by year in created_at
            year_start = f"{year}-01-01"
            year_end = f"{year}-12-31"
            
            response = self.client.table(self.table_name)\
                .select("*")\
                .gte('created_at', year_start)\
                .lte('created_at', year_end)\
                .order('created_at', desc=True)\
                .limit(1)\
                .execute()
            
            return response.data[0] if response.data else None
        except Exception as e:
            logger.error(f"Error getting latest work order by year: {e}")
            return None
    
    def work_order_number_exists(self, work_order_number: str) -> bool:
        """Check if a work order number already exists in Supabase"""
        try:
            response = self.client.table(self.table_name)\
                .select("id")\
                .eq('work_order_number', work_order_number)\
                .limit(1)\
                .execute()
            
            return bool(response.data)
        except Exception as e:
            logger.error(f"Error checking work order number existence: {e}")
            return False
    
    def get_work_orders_by_staff(self, staff_id: UUID) -> List[Dict[str, Any]]:
        """Get work orders created by or assigned to a staff member in Supabase"""
        try:
            response = self.client.table(self.table_name)\
                .select("*")\
                .or_(f"created_by_staff_id.eq.{staff_id},assigned_to_staff_id.eq.{staff_id}")\
                .order('created_at', desc=True)\
                .execute()
            
            return response.data if response.data else []
        except Exception as e:
            logger.error(f"Error getting work orders by staff: {e}")
            return []
    
    def get_dashboard_stats(self, company_id: Optional[UUID] = None) -> Dict[str, Any]:
        """Get dashboard statistics for work orders in Supabase"""
        try:
            # Get all work orders (filtered by company if provided)
            query = self.client.table(self.table_name).select("*")
            
            if company_id:
                query = query.eq('company_id', company_id)
            
            response = query.execute()
            work_orders = response.data if response.data else []
            
            # Calculate statistics
            total_count = len(work_orders)
            
            # Count by status
            status_counts = {}
            for status in WorkOrderStatus:
                count = sum(1 for wo in work_orders if wo.get('status') == status.value)
                status_counts[status.value] = count
            
            # Count by priority
            priority_counts = {
                'low': sum(1 for wo in work_orders if wo.get('priority') == 'low'),
                'medium': sum(1 for wo in work_orders if wo.get('priority') == 'medium'),
                'high': sum(1 for wo in work_orders if wo.get('priority') == 'high'),
                'urgent': sum(1 for wo in work_orders if wo.get('priority') == 'urgent')
            }
            
            # Count active/inactive
            active_count = sum(1 for wo in work_orders if wo.get('is_active', True))
            inactive_count = total_count - active_count
            
            return {
                'total': total_count,
                'by_status': status_counts,
                'by_priority': priority_counts,
                'active': active_count,
                'inactive': inactive_count
            }
        except Exception as e:
            logger.error(f"Error getting dashboard stats: {e}")
            return {
                'total': 0,
                'by_status': {},
                'by_priority': {},
                'active': 0,
                'inactive': 0
            }


def get_work_order_repository(session: DatabaseSession) -> WorkOrderRepositoryMixin:
    """
    Factory function to get the appropriate work order repository based on the session type.
    
    Args:
        session: Database session
        
    Returns:
        Appropriate repository implementation
    """
    # Check if it's an SQLAlchemy session
    if hasattr(session, 'query') and hasattr(session, 'add'):
        return WorkOrderSQLAlchemyRepository(session)
    # Check if it's a Supabase client
    elif hasattr(session, 'table'):
        return WorkOrderSupabaseRepository(session)
    else:
        # Default to SQLAlchemy for now
        return WorkOrderSQLAlchemyRepository(session)