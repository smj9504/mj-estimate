"""
Authentication API endpoints
"""
import logging
from typing import Any, List

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.database_factory import get_db_session as get_db
from app.domains.staff.models import Staff

from .dependencies import get_current_staff, require_admin
from .schemas import (
    ChangePasswordRequest,
    LoginRequest,
    PasswordResetConfirm,
    PasswordResetRequest,
    StaffCreate,
    StaffResponse,
    StaffUpdate,
    Token,
)
from .service import AuthService

logger = logging.getLogger(__name__)

router = APIRouter()
auth_service = AuthService()


@router.post("/register", response_model=StaffResponse)
async def register(
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
            email_service.send_welcome_email(staff.email, staff.username)

        return staff
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post("/login", response_model=Token)
async def login(
    login_request: LoginRequest,
    db: Any = Depends(get_db)
):
    """Login with username/email and password"""
    logger.info(f"Login attempt for username: {login_request.username}")

    try:
        staff = auth_service.authenticate_staff(
            db,
            login_request.username,
            login_request.password
        )

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
    access_token = auth_service.create_access_token(
        data={
            "sub": str(staff.id),
            "username": staff.username,
            "role": staff.role,
            "company_id": None  # Staff model doesn't have company association
        }
    )

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
        "created_at": staff.created_at
    }

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": staff_dict
    }


@router.get("/me", response_model=StaffResponse)
async def get_current_staff_info(
    current_staff: Staff = Depends(get_current_staff)
):
    """Get current staff member information"""
    return current_staff


@router.put("/me", response_model=StaffResponse)
async def update_current_staff(
    staff_update: StaffUpdate,
    current_staff: Staff = Depends(get_current_staff),
    db: Any = Depends(get_db)
):
    """
    Update current staff member information
    (restricted fields: username, staff_number, role)
    """
    # Staff cannot change their own role, username, or staff_number
    # - exclude them from the update
    update_data = staff_update.dict(exclude_unset=True)
    restricted_fields = ['role', 'username', 'staff_number']
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


@router.post("/me/change-password", response_model=dict)
async def change_password(
    password_change: ChangePasswordRequest,
    current_staff: Staff = Depends(get_current_staff),
    db: Any = Depends(get_db)
):
    """Change current staff member's password"""
    success = auth_service.change_password(
        db,
        current_staff.id,
        password_change.current_password,
        password_change.new_password
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect"
        )

    return {"message": "Password changed successfully"}


@router.get("/staff", response_model=List[StaffResponse])
async def get_staff(
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
async def update_staff_member(
    staff_id: str,
    staff_update: StaffUpdate,
    current_staff: Staff = Depends(require_admin),
    db: Any = Depends(get_db)
):
    """Update a staff member (admin only)"""
    updated_staff = auth_service.update_staff(
        db, staff_id, staff_update
    )
    if not updated_staff:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Staff member not found"
        )

    return updated_staff


@router.post("/init-admin", response_model=dict)
async def initialize_admin(
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
async def request_password_reset(
    request: PasswordResetRequest,
    db: Any = Depends(get_db)
):
    """Request a password reset token"""
    from app.core.config import settings
    from app.core.email_service import email_service

    token = auth_service.create_password_reset_token(db, request.email)

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
            request.email, token
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
async def confirm_password_reset(
    request: PasswordResetConfirm,
    db: Any = Depends(get_db)
):
    """Reset password using a valid token"""
    success = auth_service.reset_password_with_token(
        db,
        request.token,
        request.new_password
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token"
        )

    return {
        "message": "Password has been reset successfully",
        "success": True
    }


@router.post("/password-reset/verify", response_model=dict)
async def verify_reset_token(
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
async def get_users_compat(
    current_staff: Staff = Depends(require_admin),
    db: Any = Depends(get_db)
):
    """
    Get all users (backwards compatibility - redirects to staff)
    """
    return await get_staff(current_staff, db)
