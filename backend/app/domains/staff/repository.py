"""
Staff domain repository
"""

from typing import Any, Dict, List, Optional
import logging
from uuid import UUID

from app.common.base_repository import SQLAlchemyRepository, SupabaseRepository
from app.core.interfaces import DatabaseSession
from .models import Staff

logger = logging.getLogger(__name__)


class StaffRepositoryMixin:
    """Mixin with staff-specific methods"""
    
    def get_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        """Get staff by username"""
        raise NotImplementedError("Subclasses must implement get_by_username")
    
    def get_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        """Get staff by email"""
        raise NotImplementedError("Subclasses must implement get_by_email")
    
    def get_by_staff_number(self, staff_number: str) -> Optional[Dict[str, Any]]:
        """Get staff by staff number"""
        raise NotImplementedError("Subclasses must implement get_by_staff_number")
    
    def get_active_staff(self, company_id: Optional[UUID] = None) -> List[Dict[str, Any]]:
        """Get all active staff members, optionally filtered by company"""
        filters = {'is_active': True}
        if company_id:
            filters['company_id'] = str(company_id)
        return self.get_all(filters=filters, order_by='first_name')
    
    def get_by_role(self, role: str, company_id: Optional[UUID] = None) -> List[Dict[str, Any]]:
        """Get staff members by role"""
        filters = {'role': role}
        if company_id:
            filters['company_id'] = str(company_id)
        return self.get_all(filters=filters, order_by='first_name')


class StaffSQLAlchemyRepository(SQLAlchemyRepository, StaffRepositoryMixin):
    """SQLAlchemy implementation of staff repository"""
    
    def __init__(self, session: DatabaseSession):
        super().__init__(session, Staff)
    
    def get_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        """Get staff by username"""
        try:
            query = self.db_session.query(self.model_class).filter(
                self.model_class.username == username
            )
            result = query.first()
            return self._convert_to_dict(result) if result else None
        except Exception as e:
            logger.error(f"Error getting staff by username: {e}")
            return None
    
    def get_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        """Get staff by email"""
        try:
            query = self.db_session.query(self.model_class).filter(
                self.model_class.email == email
            )
            result = query.first()
            return self._convert_to_dict(result) if result else None
        except Exception as e:
            logger.error(f"Error getting staff by email: {e}")
            return None
    
    def get_by_staff_number(self, staff_number: str) -> Optional[Dict[str, Any]]:
        """Get staff by staff number"""
        try:
            query = self.db_session.query(self.model_class).filter(
                self.model_class.staff_number == staff_number
            )
            result = query.first()
            return self._convert_to_dict(result) if result else None
        except Exception as e:
            logger.error(f"Error getting staff by staff number: {e}")
            return None


class StaffSupabaseRepository(SupabaseRepository, StaffRepositoryMixin):
    """Supabase implementation of staff repository"""
    
    def __init__(self, session: DatabaseSession):
        super().__init__(session, 'staff')
    
    def get_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        """Get staff by username using Supabase"""
        try:
            response = self.session.table(self.table_name).select("*").eq('username', username).execute()
            if response.data and len(response.data) > 0:
                return response.data[0]
            return None
        except Exception as e:
            logger.error(f"Error getting staff by username from Supabase: {e}")
            return None
    
    def get_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        """Get staff by email using Supabase"""
        try:
            response = self.session.table(self.table_name).select("*").eq('email', email).execute()
            if response.data and len(response.data) > 0:
                return response.data[0]
            return None
        except Exception as e:
            logger.error(f"Error getting staff by email from Supabase: {e}")
            return None
    
    def get_by_staff_number(self, staff_number: str) -> Optional[Dict[str, Any]]:
        """Get staff by staff number using Supabase"""
        try:
            response = self.session.table(self.table_name).select("*").eq('staff_number', staff_number).execute()
            if response.data and len(response.data) > 0:
                return response.data[0]
            return None
        except Exception as e:
            logger.error(f"Error getting staff by staff number from Supabase: {e}")
            return None


def get_staff_repository(session: DatabaseSession):
    """Factory function to get appropriate staff repository"""
    # Check if session has SQLAlchemy attributes
    if hasattr(session, 'query'):
        return StaffSQLAlchemyRepository(session)
    else:
        return StaffSupabaseRepository(session)