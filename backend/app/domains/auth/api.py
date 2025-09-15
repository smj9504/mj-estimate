"""
Authentication API endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, status
from typing import Any
from typing import List

from app.core.database_factory import get_db_session as get_db
from .schemas import LoginRequest, StaffCreate, StaffResponse, Token, StaffUpdate, ChangePasswordRequest
from .service import AuthService
from .dependencies import get_current_staff, require_admin
from app.domains.staff.models import Staff


router = APIRouter()
auth_service = AuthService()


@router.post("/register", response_model=StaffResponse)
async def register(
    staff_create: StaffCreate,
    db: Any = Depends(get_db)
):
    """Register a new staff member"""
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
    staff = auth_service.authenticate_staff(
        db, 
        login_request.username, 
        login_request.password
    )
    
    if not staff:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Create access token
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
        "is_active": staff.is_active if staff.is_active is not None else True,
        "is_verified": staff.email_verified if staff.email_verified is not None else False,
        "can_login": staff.can_login if staff.can_login is not None else True,
        "email_verified": staff.email_verified if staff.email_verified is not None else False,
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
    """Update current staff member information"""
    # Staff cannot change their own role
    staff_update.role = None
    
    updated_staff = auth_service.update_staff(db, current_staff.id, staff_update)
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
    updated_staff = auth_service.update_staff(db, staff_id, staff_update)
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
    """Initialize the admin staff member (only works if no admin exists)"""
    admin = auth_service.create_initial_admin(db)
    if admin:
        return {"message": "Admin staff member created successfully"}
    else:
        return {"message": "Admin staff member already exists"}


# Backwards compatibility endpoints
@router.get("/users", response_model=List[StaffResponse])
async def get_users_compat(
    current_staff: Staff = Depends(require_admin),
    db: Any = Depends(get_db)
):
    """Get all users (backwards compatibility - redirects to staff)"""
    return await get_staff(current_staff, db)