"""
Authentication dependencies for FastAPI
"""
import json
import logging
from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.cache import CacheService, get_cache
from app.core.database_factory import get_db_session as get_db
from app.domains.staff.models import Staff, StaffRole

from .service import AuthService

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
    logger.debug(
        "get_current_staff called with token: %s...",
        token[:20] if token else ""
    )

    # Development mode: Allow temporary tokens with multi-condition security check
    # This feature is ONLY available when ALL conditions are met:
    # 1. ENVIRONMENT is explicitly "development"
    # 2. DEBUG is True
    # 3. IS_PRODUCTION is False (explicit production safety flag)
    if token and token.startswith('dev-temp-token-'):
        from app.core.config import settings

        # Multi-condition security check - ALL conditions must be True
        is_dev_environment = settings.ENVIRONMENT == 'development'
        is_debug_enabled = settings.DEBUG is True
        is_not_production = settings.IS_PRODUCTION is False

        if is_dev_environment and is_debug_enabled and is_not_production:
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

            logger.debug(
                "Development mode: Using mock staff for token %s...",
                token[:20] if token else ""
            )
            return MockStaff()
        else:
            # Log security warning if dev token is attempted in non-dev environment
            logger.warning(
                "Dev token authentication attempt blocked - "
                "ENVIRONMENT=%s, DEBUG=%s, IS_PRODUCTION=%s",
                settings.ENVIRONMENT,
                settings.DEBUG,
                settings.IS_PRODUCTION
            )

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
    token_company_id = token_data.company_id

    # Try to get from cache first
    try:
        cached_staff_data = await cache.get(cache_key)
        if cached_staff_data:
            logger.debug("Cache HIT for staff: %s", user_id)
            # Reconstruct Staff object from cached data
            staff_dict = json.loads(cached_staff_data)

            # Create a Staff-like object with the cached data
            class CachedStaff:
                def __init__(self, data):
                    self.id = data['id']
                    self.staff_number = data.get('staff_number', '')
                    self.first_name = data.get('first_name', '')
                    self.last_name = data.get('last_name', '')
                    self.username = data['username']
                    self.email = data['email']
                    self.full_name = data.get('full_name')
                    self.role = StaffRole[data['role']]
                    self.is_active = data['is_active']
                    self.can_login = data['can_login']
                    self.email_verified = data.get('email_verified', False)
                    self.created_at = data.get('created_at')
                    self.company_id = data.get('company_id')

            staff = CachedStaff(staff_dict)

            # Validate cached staff
            if not staff.is_active or not staff.can_login:
                logger.warning(
                    "Cached staff inactive - invalidating cache: %s",
                    user_id
                )
                await cache.delete(cache_key)
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Staff member is inactive or not allowed to login"
                )

            if getattr(staff, 'company_id', None) is None and token_company_id:
                staff.company_id = token_company_id

            return staff

    except Exception as e:
        logger.warning("Cache read error for staff %s: %s", user_id, e)
        # Continue to DB query on cache error

    # Cache MISS - Query database
    logger.debug("Cache MISS for staff: %s - querying database", user_id)
    staff = auth_service.get_staff_by_id(db, UUID(user_id))

    if staff is None:
        logger.error("Staff not found for user_id: %s", user_id)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Staff member not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not staff.is_active or not staff.can_login:
        logger.error(
            "Staff inactive or cannot login - is_active: %s, can_login: %s",
            staff.is_active,
            staff.can_login
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Staff member is inactive or not allowed to login"
        )

    # Attach company information from token (if provided)
    if token_company_id and getattr(staff, 'company_id', None) is None:
        staff.company_id = token_company_id

    # Cache the staff data
    try:
        staff_data = {
            'id': str(staff.id),
            'staff_number': staff.staff_number,
            'first_name': staff.first_name,
            'last_name': staff.last_name,
            'username': staff.username,
            'email': staff.email,
            'full_name': staff.full_name,
            'role': staff.role.value,
            'is_active': staff.is_active,
            'can_login': staff.can_login,
            'email_verified': staff.email_verified,
            'created_at': (
                staff.created_at.isoformat() if staff.created_at else None
            ),
            'company_id': (
                str(staff.company_id)
                if getattr(staff, 'company_id', None)
                else token_company_id
            )
        }
        await cache.set(cache_key, json.dumps(staff_data), ttl=STAFF_CACHE_TTL)
        logger.debug(
            "Cached staff data for: %s (TTL: %ss)",
            user_id,
            STAFF_CACHE_TTL
        )
    except Exception as e:
        logger.warning("Failed to cache staff data: %s", e)
        # Non-critical error, continue without caching

    logger.debug("Authentication successful for staff: %s", staff.username)
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
    if current_staff.role not in [
        StaffRole.admin,
        StaffRole.super_admin,
        StaffRole.manager,
        StaffRole.supervisor
    ]:
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
