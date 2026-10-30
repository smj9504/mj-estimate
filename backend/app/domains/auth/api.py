"""
Authentication API endpoints
"""
import asyncio
import logging
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.core.cache import CacheService, get_cache
from app.core.database_factory import get_db_session as get_db
from app.core.rate_limiter import limiter, RATE_LIMITS
from app.domains.staff.models import Staff, StaffRole

from . import password_change, screen_access
from .dependencies import get_current_staff, invalidate_staff_cache, require_admin
from .schemas import (
    AdminPasswordReset,
    AdminPasswordResetResult,
    ChangePasswordRequest,
    LoginRequest,
    PasswordChangeCodeSent,
    PasswordChanged,
    PasswordResetConfirm,
    PasswordResetRequest,
    RoleScreensUpdate,
    ScreenAccessSettings,
    StaffCreate,
    StaffResponse,
    StaffUpdate,
    TemporaryPasswordChange,
    Token,
)
from .service import AuthService

logger = logging.getLogger(__name__)

router = APIRouter()
auth_service = AuthService()


def _access_token_for(staff: Staff) -> str:
    return auth_service.create_access_token(
        data={
            "sub": str(staff.id),
            "username": staff.username,
            "role": staff.role,
            "company_id": str(staff.company_id) if staff.company_id else None,
        }
    )


def _replace_password(db: Any, staff_id: Any, new_password: str) -> Optional[str]:
    """
    Set the person's own new password. That signs out all their sessions, so
    return a fresh token for the one that made the change.
    """
    staff = auth_service.set_password(db, staff_id, new_password)
    return _access_token_for(staff) if staff else None


@router.post("/register", response_model=StaffResponse)
def register(
    staff_create: StaffCreate,
    current_staff: Staff = Depends(require_admin),
    db: Any = Depends(get_db)
):
    """Register a new staff member (Admin only)"""
    from app.core.config import settings
    from app.core.email_service import email_service

    # Check if staff exists
    if auth_service.get_staff_by_username(db, staff_create.username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )

    if auth_service.get_staff_by_email(db, staff_create.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    try:
        staff = auth_service.create_staff(db, staff_create)

        # Send welcome email if enabled
        if settings.EMAIL_ENABLED:
            email_service.send_welcome_email(
                staff.email, staff.username, first_name=staff.first_name
            )

        return staff
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post("/login", response_model=Token)
@limiter.limit(RATE_LIMITS["auth"])
def login(
    request: Request,
    response: Response,
    login_request: LoginRequest,
    db: Any = Depends(get_db)
):
    """Login with username/email and password"""
    logger.info(f"Login attempt for username: {login_request.username}")
    logger.debug(f"Getting database session for login")

    try:
        logger.debug(f"Calling authenticate_staff for: {login_request.username}")
        staff = auth_service.authenticate_staff(
            db,
            login_request.username,
            login_request.password
        )
        logger.debug(f"authenticate_staff completed, staff: {staff is not None}")

        if not staff:
            logger.warning(
                f"Failed login attempt for username: "
                f"{login_request.username}"
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
    except Exception as e:
        logger.error(
            f"Login error for username {login_request.username}: {str(e)}"
        )
        raise

    # Create access token
    logger.info(
        f"Successful login for username: {login_request.username}, "
        f"staff_id: {staff.id}"
    )
    access_token = _access_token_for(staff)

    # Create StaffResponse with additional fields for backwards compatibility
    staff_dict = {
        "id": str(staff.id),
        "username": staff.username,
        "email": staff.email,
        "first_name": staff.first_name,
        "last_name": staff.last_name,
        "full_name": f"{staff.first_name} {staff.last_name}",
        "role": staff.role,
        "staff_number": staff.staff_number,
        "is_active": (
            staff.is_active if staff.is_active is not None else True
        ),
        "is_verified": (
            staff.email_verified
            if staff.email_verified is not None
            else False
        ),
        "can_login": (
            staff.can_login if staff.can_login is not None else True
        ),
        "email_verified": (
            staff.email_verified
            if staff.email_verified is not None
            else False
        ),
        "created_at": staff.created_at,
        "company_id": str(staff.company_id) if staff.company_id else None,
        "screen_access": staff.screen_access,
        "screens": screen_access.effective_screens(db, staff),
        "company_ids": staff.company_ids,
        "all_companies": bool(staff.all_companies),
        "home_screen": staff.home_screen,
        "must_change_password": bool(staff.must_change_password),
    }

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": staff_dict
    }


@router.get("/me", response_model=StaffResponse)
def get_current_staff_info(
    current_staff: Staff = Depends(get_current_staff),
    db: Any = Depends(get_db)
):
    """
    Get current staff member information.

    Read from the database rather than the auth cache so a screen access
    change shows up the next time the app loads.
    """
    staff = auth_service.get_staff_by_id(db, current_staff.id)
    if staff is None:
        # Development mock staff has no row
        return current_staff
    response = StaffResponse.model_validate(staff)
    response.screens = screen_access.effective_screens(db, staff)
    return response


@router.put("/me", response_model=StaffResponse)
def update_current_staff(
    staff_update: StaffUpdate,
    current_staff: Staff = Depends(get_current_staff),
    db: Any = Depends(get_db)
):
    """
    Update current staff member information
    (restricted fields: username, staff_number, role, screen_access, email)
    """
    # Staff cannot change their own role, username, or staff_number
    # - exclude them from the update. Email is admin-only too: password
    # change codes go to it, so changing it here would let a signed-in
    # session send the code to any mailbox.
    update_data = staff_update.dict(exclude_unset=True)
    restricted_fields = ['role', 'username', 'staff_number', 'screen_access', 'email', 'company_ids',
                         'all_companies']
    for field in restricted_fields:
        if field in update_data:
            del update_data[field]
    staff_update = StaffUpdate(**update_data)

    updated_staff = auth_service.update_staff(
        db, current_staff.id, staff_update
    )
    if not updated_staff:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Staff member not found"
        )

    return updated_staff


@router.post("/me/change-password/code", response_model=PasswordChangeCodeSent)
@limiter.limit(RATE_LIMITS["password_reset"])
async def send_password_change_code(
    request: Request,
    response: Response,
    current_staff: Staff = Depends(get_current_staff),
    db: Any = Depends(get_db),
    cache: CacheService = Depends(get_cache)
):
    """
    Email a code to the current staff member's own address. They enter it
    with their new password at POST /me/change-password.
    """
    from app.core.config import settings
    from app.core.email_service import email_service

    # The auth cache can lag behind an admin's email change, so read the row
    staff = await asyncio.to_thread(auth_service.get_staff_by_id, db, current_staff.id)
    if staff is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Staff member not found"
        )

    dev_mode = settings.DEBUG and not settings.EMAIL_ENABLED
    if not settings.EMAIL_ENABLED and not dev_mode:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email isn't set up on the server, so the code can't be sent. Ask an admin to reset your password."
        )

    code = await password_change.issue_code(cache, staff.id)
    if code is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Couldn't create a code. Try again in a moment."
        )

    minutes = password_change.CODE_TTL_SECONDS // 60
    result = {
        "sent_to": password_change.mask_email(staff.email),
        "expires_in_minutes": minutes,
    }

    if dev_mode:
        result["code"] = code
        return result

    sent = await asyncio.to_thread(
        email_service.send_password_change_code, staff.email, code, minutes
    )
    if not sent:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Couldn't send the email. Try again in a moment."
        )
    return result


@router.post("/me/change-password", response_model=PasswordChanged)
@limiter.limit(RATE_LIMITS["auth"])
async def change_password(
    request: Request,
    response: Response,
    password_change_request: ChangePasswordRequest,
    current_staff: Staff = Depends(get_current_staff),
    db: Any = Depends(get_db),
    cache: CacheService = Depends(get_cache)
):
    """
    Change the current staff member's password with the code they were
    emailed. Their other sessions are signed out.
    """
    if not await password_change.check_code(cache, current_staff.id, password_change_request.code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That code is wrong or has expired. Send a new code and try again."
        )

    token = await asyncio.to_thread(
        _replace_password, db, current_staff.id, password_change_request.new_password
    )
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Staff member not found"
        )

    # The cached staff record carries the old password_changed_at
    await cache.delete(f"staff:{current_staff.id}")
    return {"message": "Password changed successfully", "access_token": token}


@router.post("/me/change-temporary-password", response_model=PasswordChanged)
@limiter.limit(RATE_LIMITS["auth"])
async def change_temporary_password(
    request: Request,
    response: Response,
    body: TemporaryPasswordChange,
    current_staff: Staff = Depends(get_current_staff),
    db: Any = Depends(get_db),
    cache: CacheService = Depends(get_cache)
):
    """
    Replace the password an admin reset, right after signing in with it.

    Only while must_change_password is set; any other change goes through
    the emailed code above.
    """
    staff = await asyncio.to_thread(auth_service.get_staff_by_id, db, current_staff.id)
    if staff is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Staff member not found"
        )
    if not staff.must_change_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Your password isn't a temporary one. Change it from your profile."
        )
    password_ok = await asyncio.to_thread(
        auth_service.verify_password, body.current_password, staff.password_hash
    )
    if not password_ok:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The temporary password is incorrect"
        )
    if body.new_password == body.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Choose a password different from the temporary one"
        )

    token = await asyncio.to_thread(_replace_password, db, current_staff.id, body.new_password)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Staff member not found"
        )

    await cache.delete(f"staff:{current_staff.id}")
    return {"message": "Password changed successfully", "access_token": token}


@router.get("/staff", response_model=List[StaffResponse])
def get_staff(
    current_staff: Staff = Depends(require_admin),
    db: Any = Depends(get_db)
):
    """Get all staff members (admin only)"""
    # Handle both raw Session and DatabaseSession wrapper
    if hasattr(db, '_session'):
        session = db._session
    elif hasattr(db, 'query'):
        session = db
    else:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Invalid database session"
        )

    staff_members = session.query(Staff).all()
    return staff_members


@router.put("/staff/{staff_id}", response_model=StaffResponse)
def update_staff_member(
    staff_id: str,
    staff_update: StaffUpdate,
    current_staff: Staff = Depends(require_admin),
    db: Any = Depends(get_db),
    cache: CacheService = Depends(get_cache)
):
    """Update a staff member (admin only)"""
    if staff_update.company_ids:
        from app.domains.company.models import Company

        session = db._session if hasattr(db, '_session') else db
        wanted = {str(c) for c in staff_update.company_ids}
        found = {str(r[0]) for r in session.query(Company.id).filter(Company.id.in_(wanted)).all()}
        if wanted - found:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="One of the chosen companies no longer exists"
            )

    updated_staff = auth_service.update_staff(
        db, staff_id, staff_update
    )
    if not updated_staff:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Staff member not found"
        )

    # Role and active/login changes must not wait for the cache to expire
    invalidate_staff_cache(str(updated_staff.id), cache)
    return updated_staff


@router.post("/staff/{staff_id}/reset-password", response_model=AdminPasswordResetResult)
def reset_staff_password(
    staff_id: str,
    body: AdminPasswordReset,
    current_staff: Staff = Depends(require_admin),
    db: Any = Depends(get_db),
    cache: CacheService = Depends(get_cache)
):
    """
    Give a staff member a new password (admin only).

    With no password in the body the server makes up a temporary one. The
    admin sees it once in the response and passes it on. The person's
    sessions are signed out, and after signing in with it they are asked to
    choose their own.
    """
    if staff_id.lower() == str(current_staff.id).lower():
        # Their own goes through the emailed code like everyone else's
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Change your own password from your profile"
        )

    password = body.new_password or auth_service.generate_temporary_password()
    staff = auth_service.set_password(db, staff_id, password, must_change=True)
    if not staff:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Staff member not found"
        )

    # The cached staff record carries the old password_changed_at
    invalidate_staff_cache(str(staff.id), cache)

    logger.info(
        f"Admin {current_staff.username} reset the password for "
        f"{staff.username} ({staff.id})"
    )
    return {"password": password}


@router.get("/screen-access", response_model=ScreenAccessSettings)
def get_screen_access_settings(
    current_staff: Staff = Depends(require_admin),
    db: Any = Depends(get_db)
):
    """Screen keys and each role's default screens (admin only)"""
    return {
        "screens": list(screen_access.SCREEN_KEYS),
        "role_defaults": screen_access.role_defaults(db),
    }


@router.put("/screen-access/roles/{role}", response_model=ScreenAccessSettings)
def update_role_screen_access(
    role: StaffRole,
    body: RoleScreensUpdate,
    current_staff: Staff = Depends(require_admin),
    db: Any = Depends(get_db)
):
    """Set the default screens for a role (admin only)"""
    if role in screen_access.ALL_SCREENS_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Admins always see every screen"
        )
    screen_access.set_role_defaults(db, role, body.screens)
    return get_screen_access_settings(current_staff, db)


@router.post("/init-admin", response_model=dict)
@limiter.limit(RATE_LIMITS["init"])
def initialize_admin(
    request: Request,
    response: Response,
    db: Any = Depends(get_db)
):
    """
    Initialize the admin staff member
    (only works if no admin exists)
    """
    admin = auth_service.create_initial_admin(db)
    if admin:
        return {
            "message": "Admin staff member created successfully"
        }
    else:
        return {"message": "Admin staff member already exists"}


@router.post("/password-reset/request", response_model=dict)
@limiter.limit(RATE_LIMITS["password_reset"])
def request_password_reset(
    request: Request,
    response: Response,
    reset_request: PasswordResetRequest,
    db: Any = Depends(get_db)
):
    """Request a password reset token"""
    from app.core.config import settings
    from app.core.email_service import email_service

    token = auth_service.create_password_reset_token(db, reset_request.email)

    if not token:
        # Return success message even if email not found
        # (security best practice)
        return {
            "message": (
                "If the email exists, a password reset link "
                "has been sent"
            ),
            "success": True
        }

    # Send email with reset link
    if settings.EMAIL_ENABLED:
        email_sent = email_service.send_password_reset_email(
            reset_request.email, token
        )
        if not email_sent:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to send password reset email"
            )

    response = {
        "message": (
            "If the email exists, a password reset link has been sent"
        ),
        "success": True
    }

    # In development mode, include the token
    if settings.DEBUG and not settings.EMAIL_ENABLED:
        response["token"] = token
        response["message"] = (
            "Password reset token created (development mode)"
        )

    return response


@router.post("/password-reset/confirm", response_model=dict)
@limiter.limit(RATE_LIMITS["password_reset"])
def confirm_password_reset(
    request: Request,
    response: Response,
    confirm_request: PasswordResetConfirm,
    db: Any = Depends(get_db),
    cache: CacheService = Depends(get_cache)
):
    """Reset password using a valid token; earlier sessions are signed out"""
    staff = auth_service.reset_password_with_token(
        db,
        confirm_request.token,
        confirm_request.new_password
    )

    if not staff:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token"
        )

    # The cached staff record carries the old password_changed_at
    invalidate_staff_cache(str(staff.id), cache)

    return {
        "message": "Password has been reset successfully",
        "success": True
    }


@router.post("/password-reset/verify", response_model=dict)
def verify_reset_token(
    token: str,
    db: Any = Depends(get_db)
):
    """Verify if a password reset token is valid"""
    email = auth_service.verify_password_reset_token(db, token)

    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token"
        )

    return {
        "message": "Token is valid",
        "success": True,
        "email": email
    }


# Backwards compatibility endpoints
@router.get("/users", response_model=List[StaffResponse])
def get_users_compat(
    current_staff: Staff = Depends(require_admin),
    db: Any = Depends(get_db)
):
    """
    Get all users (backwards compatibility - redirects to staff)
    """
    return get_staff(current_staff, db)
