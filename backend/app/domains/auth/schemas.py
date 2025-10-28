"""
Authentication schemas
"""
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime
from uuid import UUID
from enum import Enum
from app.domains.staff.models import StaffRole


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
    role: Optional[StaffRole] = None
    is_active: Optional[bool] = None
    can_login: Optional[bool] = None
    phone: Optional[str] = None
    mobile_phone: Optional[str] = None


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
    created_at: datetime
    
    class Config:
        from_attributes = True


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