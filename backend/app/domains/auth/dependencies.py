"""
Authentication dependencies for FastAPI
"""
from typing import Optional, Dict
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Any
from uuid import UUID

from app.core.database_factory import get_db_session as get_db
from .service import AuthService
from app.domains.staff.models import Staff, StaffRole
from .schemas import TokenData


security = HTTPBearer()
auth_service = AuthService()


async def get_current_staff(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Any = Depends(get_db)
) -> Staff:
    """Get the current authenticated staff member"""
    import logging
    logger = logging.getLogger(__name__)

    token = credentials.credentials
    logger.info(f"get_current_staff called with token: {token[:20]}...")

    # Development mode: Allow temporary tokens
    if token and token.startswith('dev-temp-token-'):
        from app.core.config import settings
        if settings.ENVIRONMENT == 'development':
            # Create a mock staff for development
            from app.domains.staff.models import StaffRole
            class MockStaff:
                def __init__(self):
                    self.id = "dev-staff-id"
                    self.username = "dev-user"
                    self.email = "dev@example.com"
                    self.full_name = "Development User"
                    self.role = StaffRole.admin
                    self.is_active = True
                    self.can_login = True
                    self.company_id = None

            logger.info(f"Development mode: Using mock staff for token {token[:20]}...")
            return MockStaff()

    token_data = auth_service.decode_token(token)
    logger.info(f"Token decoded: {token_data}")

    if token_data is None:
        logger.error("Token decode failed - Invalid or expired token")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    staff = auth_service.get_staff_by_id(db, UUID(token_data.user_id))
    logger.info(f"Staff found: {staff is not None}")

    if staff is None:
        logger.error(f"Staff not found for user_id: {token_data.user_id}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Staff member not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not staff.is_active or not staff.can_login:
        logger.error(f"Staff inactive or cannot login - is_active: {staff.is_active}, can_login: {staff.can_login}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Staff member is inactive or not allowed to login"
        )

    logger.info(f"Authentication successful for staff: {staff.username}")
    return staff


async def get_current_staff_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Any = Depends(get_db)
) -> Optional[Staff]:
    """Get the current staff member if authenticated, otherwise None"""
    if not credentials:
        return None
    
    try:
        return await get_current_staff(credentials, db)
    except HTTPException:
        return None


async def require_admin(
    current_staff: Staff = Depends(get_current_staff)
) -> Staff:
    """Require the current staff member to be an admin"""
    if current_staff.role not in [StaffRole.admin, StaffRole.super_admin]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return current_staff


async def require_manager_or_admin(
    current_staff: Staff = Depends(get_current_staff)
) -> Staff:
    """Require the current staff member to be a manager or admin"""
    if current_staff.role not in [StaffRole.admin, StaffRole.super_admin, StaffRole.manager, StaffRole.supervisor]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Manager or admin access required"
        )
    return current_staff


async def get_current_user_from_token(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> Dict[str, Any]:
    """Get current user information from JWT token without DB query"""
    token = credentials.credentials
    token_data = auth_service.decode_token(token)
    
    if token_data is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return {
        "user_id": token_data.user_id,
        "username": token_data.username,
        "role": token_data.role,
        "company_id": token_data.company_id
    }


# Backwards compatibility aliases
get_current_user = get_current_staff
get_current_user_optional = get_current_staff_optional