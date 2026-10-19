"""
Authentication schemas
"""
from datetime import datetime
from typing import Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, field_validator

from app.domains.staff.models import StaffRole

from .screen_access import validate_screen_keys


class StaffBase(BaseModel):
    username: str
    email: EmailStr
    first_name: str
    last_name: str
    role: StaffRole = StaffRole.technician
    staff_number: str


class StaffCreate(StaffBase):
    password: str
    hire_date: Optional[datetime] = None


class StaffUpdate(BaseModel):
    email: Optional[EmailStr] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    username: Optional[str] = None  # Only admin can update
    staff_number: Optional[str] = None  # Only admin can update
    role: Optional[StaffRole] = None  # Only admin can update
    is_active: Optional[bool] = None  # Only admin can update
    can_login: Optional[bool] = None  # Only admin can update
    phone: Optional[str] = None
    mobile_phone: Optional[str] = None
    # Only admin can update. None resets the person to their role's screens.
    screen_access: Optional[List[str]] = None

    @field_validator("screen_access")
    @classmethod
    def _known_screens(cls, value):
        if value is None:
            return value
        return validate_screen_keys(value)


class StaffInDB(StaffBase):
    id: UUID
    is_active: bool
    can_login: bool
    email_verified: bool
    created_at: datetime
    updated_at: datetime
    last_login: Optional[datetime] = None

    class Config:
        from_attributes = True


class StaffResponse(BaseModel):
    id: UUID
    username: str
    email: EmailStr
    first_name: str
    last_name: str
    full_name: Optional[str] = None
    role: StaffRole
    staff_number: str
    is_active: bool
    is_verified: Optional[bool] = None
    can_login: bool
    email_verified: bool
    phone: Optional[str] = None
    mobile_phone: Optional[str] = None
    created_at: datetime
    # The person's own screen list; None means they follow their role.
    screen_access: Optional[List[str]] = None
    # Screens they may open after applying role defaults (login and /me only).
    screens: Optional[List[str]] = None

    class Config:
        from_attributes = True


class RoleScreensUpdate(BaseModel):
    screens: List[str]

    @field_validator("screens")
    @classmethod
    def _known_screens(cls, value):
        return validate_screen_keys(value)


class ScreenAccessSettings(BaseModel):
    screens: List[str]
    role_defaults: Dict[str, List[str]]


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: StaffResponse  # Keep 'user' for backwards compatibility


class TokenData(BaseModel):
    user_id: Optional[str] = None
    username: Optional[str] = None
    role: Optional[str] = None
    company_id: Optional[str] = None


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str


class PasswordResetToken(BaseModel):
    email: EmailStr
    token: str
    expires_at: datetime

    class Config:
        from_attributes = True


# Backwards compatibility aliases
UserCreate = StaffCreate
UserUpdate = StaffUpdate
UserResponse = StaffResponse
UserInDB = StaffInDB
