"""
Staff service for business logic
"""

from typing import Dict, List, Optional, Any
import logging
from datetime import datetime, timedelta
from uuid import UUID
import hashlib
import secrets

from app.common.base_service import BaseService
from .models import Staff, StaffPermission, StaffRole
from .schemas import StaffCreate, StaffFilter, StaffPermissionUpdate, AuditLogFilter
from .repository import get_staff_repository

logger = logging.getLogger(__name__)


class StaffService(BaseService[Staff, UUID]):
    """
    Service for managing staff with business logic
    """
    
    def get_repository(self):
        """Get the staff repository"""
        session = self.database.get_session()
        return get_staff_repository(session)
    
    def _get_repository_instance(self, session):
        """Get repository instance with the given session"""
        return get_staff_repository(session)
    
    def generate_staff_number(self, company_id: UUID) -> str:
        """
        Generate unique staff number
        
        Args:
            company_id: Company UUID
            
        Returns:
            Generated staff number
        """
        try:
            # Get current year
            current_year = datetime.now().year
            year_suffix = str(current_year)[2:]  # Last 2 digits
            
            # Generate unique staff number
            import uuid
            unique_id = str(uuid.uuid4())[:8].upper()
            staff_number = f"ST-{year_suffix}-{unique_id}"
            
            # Ensure uniqueness
            counter = 0
            base_number = staff_number
            while self.staff_number_exists(staff_number):
                counter += 1
                staff_number = f"{base_number}-{counter}"
            
            return staff_number
            
        except Exception as e:
            logger.error(f"Error generating staff number: {e}")
            # Fallback to UUID-based number
            import uuid
            return f"ST-{datetime.now().year}-{str(uuid.uuid4())[:8].upper()}"
    
    def staff_number_exists(self, staff_number: str) -> bool:
        """
        Check if staff number already exists
        
        Args:
            staff_number: Staff number to check
            
        Returns:
            True if exists, False otherwise
        """
        try:
            # This would check the database
            # For now, assume it doesn't exist
            return False
        except Exception as e:
            logger.error(f"Error checking staff number existence: {e}")
            return False
    
    def hash_password(self, password: str) -> str:
        """
        Hash password using secure method
        
        Args:
            password: Plain text password
            
        Returns:
            Hashed password
        """
        # Use a proper password hashing library like bcrypt in production
        salt = secrets.token_hex(16)
        password_hash = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000)
        return f"{salt}${password_hash.hex()}"
    
    def verify_password(self, password: str, password_hash: str) -> bool:
        """
        Verify password against hash
        
        Args:
            password: Plain text password
            password_hash: Stored password hash
            
        Returns:
            True if password matches, False otherwise
        """
        try:
            salt, hash_hex = password_hash.split('$')
            password_check = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000)
            return password_check.hex() == hash_hex
        except Exception:
            return False
    
    def create_staff_member(self, staff_data: StaffCreate) -> Dict[str, Any]:
        """
        Create a new staff member with hashed password
        
        Args:
            staff_data: Staff creation data
            
        Returns:
            Created staff dictionary
        """
        try:
            # Convert Pydantic model to dict
            data = staff_data.dict()
            
            # Generate staff number if not provided
            if not data.get('staff_number'):
                data['staff_number'] = self.generate_staff_number(data['company_id'])
            
            # Hash password
            password = data.pop('password')
            data['password_hash'] = self.hash_password(password)
            
            # Create the staff member
            staff = self.create(data)
            
            # Create default permissions based on role
            self.create_default_permissions(staff['id'], data['role'])
            
            return staff
            
        except Exception as e:
            logger.error(f"Error creating staff member: {e}")
            raise
    
    def create_default_permissions(self, staff_id: UUID, role: StaffRole) -> Dict[str, Any]:
        """
        Create default permissions for a staff member based on role
        
        Args:
            staff_id: Staff UUID
            role: Staff role
            
        Returns:
            Created permissions dictionary
        """
        try:
            # This would create permissions based on role
            # For now, return mock data
            from .permissions import get_role_permissions
            role_permissions = get_role_permissions(role)
            
            # Convert permission enum to permission data
            permission_data = {
                'staff_id': staff_id,
                'created_at': datetime.utcnow(),
                'updated_at': datetime.utcnow()
            }
            
            # This would be implemented with proper repository
            return permission_data
            
        except Exception as e:
            logger.error(f"Error creating default permissions: {e}")
            raise
    
    def authenticate_staff(self, username: str, password: str) -> Optional[Dict[str, Any]]:
        """
        Authenticate staff member
        
        Args:
            username: Username
            password: Password
            
        Returns:
            Authentication result with token or None
        """
        try:
            # This would find staff by username and verify password
            # For now, return mock data for admin/admin
            if username == "admin" and password == "admin":
                import uuid
                
                staff_data = {
                    'id': str(uuid.uuid4()),
                    'staff_number': 'ST-25-ADMIN001',
                    'username': 'admin',
                    'first_name': 'Admin',
                    'last_name': 'User',
                    'email': 'admin@example.com',
                    'role': 'super_admin',
                    'is_admin': True,
                    'is_active': True,
                    'can_login': True
                }
                
                # Generate access token
                access_token = secrets.token_urlsafe(32)
                
                return {
                    'access_token': access_token,
                    'token_type': 'bearer',
                    'expires_in': 3600,
                    'staff': staff_data
                }
            
            return None
            
        except Exception as e:
            logger.error(f"Error authenticating staff: {e}")
            return None
    
    def change_password(self, staff_id: UUID, current_password: str, new_password: str) -> bool:
        """
        Change staff member password
        
        Args:
            staff_id: Staff UUID
            current_password: Current password
            new_password: New password
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # This would verify current password and update with new one
            # For now, return True
            return True
            
        except Exception as e:
            logger.error(f"Error changing password: {e}")
            return False
    
    def get_staff_with_filters(self, filters: StaffFilter) -> Dict[str, Any]:
        """
        Get staff with advanced filtering
        
        Args:
            filters: Filter parameters
            
        Returns:
            Dictionary with staff and metadata
        """
        try:
            # This would use a staff repository with filtering
            # For now, return empty result
            return {
                'staff': [],
                'total': 0,
                'filters_applied': filters.dict(exclude_none=True)
            }
            
        except Exception as e:
            logger.error(f"Error getting staff with filters: {e}")
            raise
    
    def deactivate_staff_member(self, staff_id: UUID) -> bool:
        """
        Deactivate (soft delete) staff member
        
        Args:
            staff_id: Staff UUID
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # This would set is_active to False
            update_data = {
                'is_active': False,
                'can_login': False,
                'updated_at': datetime.utcnow()
            }
            
            result = self.update(staff_id, update_data)
            return result is not None
            
        except Exception as e:
            logger.error(f"Error deactivating staff member: {e}")
            return False
    
    def get_staff_permissions(self, staff_id: UUID) -> Optional[Dict[str, Any]]:
        """
        Get staff member permissions
        
        Args:
            staff_id: Staff UUID
            
        Returns:
            Permissions dictionary or None
        """
        try:
            # This would get permissions from repository
            # For now, return mock data
            import uuid
            return {
                'id': str(uuid.uuid4()),
                'staff_id': staff_id,
                'work_orders': 'full',
                'estimates': 'full',
                'invoices': 'full',
                'payments': 'read_only',
                'created_at': datetime.utcnow().isoformat(),
                'updated_at': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error getting staff permissions: {e}")
            return None
    
    def update_staff_permissions(self, staff_id: UUID, permissions: StaffPermissionUpdate) -> Dict[str, Any]:
        """
        Update staff member permissions
        
        Args:
            staff_id: Staff UUID
            permissions: Permission updates
            
        Returns:
            Updated permissions dictionary
        """
        try:
            # This would update permissions in database
            # For now, return the updated data
            update_data = permissions.dict(exclude_none=True)
            update_data['staff_id'] = staff_id
            update_data['updated_at'] = datetime.utcnow()
            
            return update_data
            
        except Exception as e:
            logger.error(f"Error updating staff permissions: {e}")
            raise
    
    def get_audit_logs(self, filters: AuditLogFilter, limit: int = 100) -> List[Dict[str, Any]]:
        """
        Get audit logs with filters
        
        Args:
            filters: Filter parameters
            limit: Maximum results
            
        Returns:
            List of audit log dictionaries
        """
        try:
            # This would get audit logs from repository
            # For now, return empty list
            return []
            
        except Exception as e:
            logger.error(f"Error getting audit logs: {e}")
            raise
    
    def get_staff_dashboard_stats(self, company_id: Optional[UUID] = None) -> Dict[str, Any]:
        """
        Get dashboard statistics for staff
        
        Args:
            company_id: Optional company filter
            
        Returns:
            Dictionary with various statistics
        """
        try:
            # This would calculate real statistics from the database
            # For now, return mock data
            return {
                'total_staff': 0,
                'active_staff': 0,
                'inactive_staff': 0,
                'roles_breakdown': {
                    'admin': 0,
                    'manager': 0,
                    'supervisor': 0,
                    'technician': 0,
                    'sales': 0,
                    'customer_service': 0,
                    'accountant': 0,
                    'viewer': 0
                },
                'recent_logins': 0,
                'locked_accounts': 0,
                'permission_changes_this_month': 0,
                'last_updated': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error getting staff dashboard stats: {e}")
            raise
    
    def _validate_create_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate staff creation data"""
        # Ensure required fields
        if not data.get('username'):
            raise ValueError("Username is required")
        
        if not data.get('email'):
            raise ValueError("Email is required")
        
        if not data.get('staff_number'):
            data['staff_number'] = self.generate_staff_number(data['company_id'])
        
        return data
    
    def _validate_update_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate staff update data"""
        # Remove fields that shouldn't be updated directly
        protected_fields = ['id', 'created_at', 'staff_number', 'password_hash']
        for field in protected_fields:
            data.pop(field, None)
        
        return data