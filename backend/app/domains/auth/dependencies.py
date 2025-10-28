"""
Authentication dependencies for FastAPI
"""
from typing import Optional, Dict
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Any
from uuid import UUID
import json
import logging

from app.core.database_factory import get_db_session as get_db
from app.core.cache import get_cache, CacheService
from .service import AuthService
from app.domains.staff.models import Staff, StaffRole
from .schemas import TokenData


security = HTTPBearer()
auth_service = AuthService()
logger = logging.getLogger(__name__)

# Cache TTL: 15 minutes for staff data
STAFF_CACHE_TTL = 900


async def get_current_staff(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Any = Depends(get_db),
    cache: CacheService = Depends(get_cache)
) -> Staff:
    """
    Get the current authenticated staff member with Redis caching.

    Performance optimization:
    - First checks Redis cache (sub-millisecond lookup)
    - Falls back to DB query only if cache miss
    - Caches result for 15 minutes
    - Cache is invalidated on staff updates
    """
    token = credentials.credentials
    logger.debug(f"get_current_staff called with token: {token[:20]}...")

    # Development mode: Allow temporary tokens
    if token and token.startswith('dev-temp-token-'):
        from app.core.config import settings
        if settings.ENVIRONMENT == 'development':
            # Create a mock staff for development
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

            logger.debug(f"Development mode: Using mock staff for token {token[:20]}...")
            return MockStaff()

    # Decode JWT token
    token_data = auth_service.decode_token(token)
    if token_data is None:
        logger.error("Token decode failed - Invalid or expired token")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = token_data.user_id
    cache_key = f"staff:{user_id}"

    # Try to get from cache first
    try:
        cached_staff_data = cache.get(cache_key)
        if cached_staff_data:
            logger.debug(f"Cache HIT for staff: {user_id}")
            # Reconstruct Staff object from cached data
            staff_dict = json.loads(cached_staff_data)

            # Create a Staff-like object with the cached data
            class CachedStaff:
                def __init__(self, data):
                    self.id = data['id']
                    self.username = data['username']
                    self.email = data['email']
                    self.full_name = data.get('full_name')
                    self.role = StaffRole[data['role']]
                    self.is_active = data['is_active']
                    self.can_login = data['can_login']
                    self.company_id = data.get('company_id')

            staff = CachedStaff(staff_dict)

            # Validate cached staff
            if not staff.is_active or not staff.can_login:
                logger.warning(f"Cached staff inactive - invalidating cache: {user_id}")
                cache.delete(cache_key)
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Staff member is inactive or not allowed to login"
                )

            return staff

    except Exception as e:
        logger.warning(f"Cache read error for staff {user_id}: {e}")
        # Continue to DB query on cache error

    # Cache MISS - Query database
    logger.debug(f"Cache MISS for staff: {user_id} - querying database")
    staff = auth_service.get_staff_by_id(db, UUID(user_id))

    if staff is None:
        logger.error(f"Staff not found for user_id: {user_id}")
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

    # Cache the staff data
    try:
        staff_data = {
            'id': str(staff.id),
            'username': staff.username,
            'email': staff.email,
            'full_name': staff.full_name,
            'role': staff.role.value,
            'is_active': staff.is_active,
            'can_login': staff.can_login,
            'company_id': str(staff.company_id) if staff.company_id else None
        }
        cache.set(cache_key, json.dumps(staff_data), ttl=STAFF_CACHE_TTL)
        logger.debug(f"Cached staff data for: {user_id} (TTL: {STAFF_CACHE_TTL}s)")
    except Exception as e:
        logger.warning(f"Failed to cache staff data: {e}")
        # Non-critical error, continue without caching

    logger.debug(f"Authentication successful for staff: {staff.username}")
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


def invalidate_staff_cache(user_id: str, cache: CacheService) -> None:
    """
    Invalidate cached staff data when staff information is updated.

    Call this function after:
    - Staff profile updates
    - Role changes
    - Permission changes
    - Account activation/deactivation

    Args:
        user_id: Staff user ID
        cache: CacheService instance
    """
    cache_key = f"staff:{user_id}"
    try:
        cache.delete(cache_key)
        logger.info(f"Invalidated staff cache for user: {user_id}")
    except Exception as e:
        logger.warning(f"Failed to invalidate staff cache for {user_id}: {e}")


# Backwards compatibility aliases
get_current_user = get_current_staff
get_current_user_optional = get_current_staff_optional