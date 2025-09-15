"""
Staff Pydantic schemas
"""

from typing import Optional
from pydantic import BaseModel, EmailStr
from datetime import datetime
from uuid import UUID

from .models import StaffRole, PermissionLevel


class StaffBase(BaseModel):
    """Base staff schema"""
    staff_number: str
    company_id: UUID
    
    first_name: str
    last_name: str
    email: EmailStr
    phone: Optional[str] = None
    mobile_phone: Optional[str] = None
    
    role: StaffRole
    job_title: Optional[str] = None
    department: Optional[str] = None
    hire_date: datetime
    
    username: str
    
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zipcode: Optional[str] = None
    country: Optional[str] = "USA"
    
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    emergency_contact_relationship: Optional[str] = None
    
    hourly_rate: Optional[str] = None
    salary: Optional[str] = None
    supervisor_id: Optional[UUID] = None
    
    skills: Optional[str] = None
    certifications: Optional[str] = None
    notes: Optional[str] = None
    
    timezone: Optional[str] = "UTC"
    language: Optional[str] = "en"
    notification_preferences: Optional[str] = None


class StaffCreate(StaffBase):
    """Schema for creating a staff member"""
    password: str
    must_change_password: Optional[bool] = True


class StaffUpdate(BaseModel):
    """Schema for updating a staff member"""
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    mobile_phone: Optional[str] = None
    
    role: Optional[StaffRole] = None
    job_title: Optional[str] = None
    department: Optional[str] = None
    termination_date: Optional[datetime] = None
    
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zipcode: Optional[str] = None
    country: Optional[str] = None
    
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    emergency_contact_relationship: Optional[str] = None
    
    hourly_rate: Optional[str] = None
    salary: Optional[str] = None
    supervisor_id: Optional[UUID] = None
    
    skills: Optional[str] = None
    certifications: Optional[str] = None
    notes: Optional[str] = None
    
    is_active: Optional[bool] = None
    is_admin: Optional[bool] = None
    can_login: Optional[bool] = None
    email_verified: Optional[bool] = None
    
    timezone: Optional[str] = None
    language: Optional[str] = None
    notification_preferences: Optional[str] = None


class Staff(StaffBase):
    """Staff schema with all fields"""
    id: UUID
    termination_date: Optional[datetime] = None
    must_change_password: Optional[bool] = True
    last_login: Optional[datetime] = None
    login_attempts: Optional[str] = "0"
    locked_until: Optional[datetime] = None
    
    is_active: Optional[bool] = True
    is_admin: Optional[bool] = False
    can_login: Optional[bool] = True
    email_verified: Optional[bool] = False
    
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class StaffPermissionBase(BaseModel):
    """Base staff permission schema"""
    staff_id: UUID
    
    # Permission Categories
    work_orders: Optional[PermissionLevel] = PermissionLevel.READ_ONLY
    work_order_assign: Optional[bool] = False
    work_order_status_change: Optional[bool] = False
    
    estimates: Optional[PermissionLevel] = PermissionLevel.READ_ONLY
    invoices: Optional[PermissionLevel] = PermissionLevel.READ_ONLY
    
    payments: Optional[PermissionLevel] = PermissionLevel.READ_ONLY
    billing_schedules: Optional[PermissionLevel] = PermissionLevel.NONE
    refunds: Optional[PermissionLevel] = PermissionLevel.NONE
    
    customer_credits: Optional[PermissionLevel] = PermissionLevel.READ_ONLY
    discount_rules: Optional[PermissionLevel] = PermissionLevel.READ_ONLY
    apply_discounts: Optional[bool] = False
    
    companies: Optional[PermissionLevel] = PermissionLevel.READ_ONLY
    staff_management: Optional[PermissionLevel] = PermissionLevel.NONE
    
    reports: Optional[PermissionLevel] = PermissionLevel.READ_ONLY
    analytics: Optional[PermissionLevel] = PermissionLevel.READ_ONLY
    export_data: Optional[bool] = False
    
    system_settings: Optional[PermissionLevel] = PermissionLevel.NONE
    user_audit_logs: Optional[PermissionLevel] = PermissionLevel.NONE
    backup_restore: Optional[bool] = False
    
    view_financial_data: Optional[bool] = False
    modify_pricing: Optional[bool] = False
    approve_large_amounts: Optional[bool] = False
    large_amount_threshold: Optional[str] = "1000.00"
    
    customer_pii_access: Optional[bool] = False
    customer_payment_info: Optional[bool] = False
    
    override_system_restrictions: Optional[bool] = False
    emergency_access: Optional[bool] = False


class StaffPermissionCreate(StaffPermissionBase):
    """Schema for creating staff permissions"""
    pass


class StaffPermissionUpdate(BaseModel):
    """Schema for updating staff permissions"""
    work_orders: Optional[PermissionLevel] = None
    work_order_assign: Optional[bool] = None
    work_order_status_change: Optional[bool] = None
    
    estimates: Optional[PermissionLevel] = None
    invoices: Optional[PermissionLevel] = None
    
    payments: Optional[PermissionLevel] = None
    billing_schedules: Optional[PermissionLevel] = None
    refunds: Optional[PermissionLevel] = None
    
    customer_credits: Optional[PermissionLevel] = None
    discount_rules: Optional[PermissionLevel] = None
    apply_discounts: Optional[bool] = None
    
    companies: Optional[PermissionLevel] = None
    staff_management: Optional[PermissionLevel] = None
    
    reports: Optional[PermissionLevel] = None
    analytics: Optional[PermissionLevel] = None
    export_data: Optional[bool] = None
    
    system_settings: Optional[PermissionLevel] = None
    user_audit_logs: Optional[PermissionLevel] = None
    backup_restore: Optional[bool] = None
    
    view_financial_data: Optional[bool] = None
    modify_pricing: Optional[bool] = None
    approve_large_amounts: Optional[bool] = None
    large_amount_threshold: Optional[str] = None
    
    customer_pii_access: Optional[bool] = None
    customer_payment_info: Optional[bool] = None
    
    override_system_restrictions: Optional[bool] = None
    emergency_access: Optional[bool] = None


class StaffPermission(StaffPermissionBase):
    """Staff permission schema with all fields"""
    id: UUID
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class StaffSessionBase(BaseModel):
    """Base staff session schema"""
    session_token: str
    staff_id: UUID
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    device_info: Optional[str] = None
    expires_at: datetime
    is_mobile: Optional[bool] = False


class StaffSessionCreate(StaffSessionBase):
    """Schema for creating a staff session"""
    pass


class StaffSession(StaffSessionBase):
    """Staff session schema with all fields"""
    id: UUID
    last_activity: datetime
    is_active: Optional[bool] = True
    created_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class AuditLogBase(BaseModel):
    """Base audit log schema"""
    action: str
    entity_type: str
    entity_id: Optional[UUID] = None
    staff_id: Optional[UUID] = None
    staff_name: Optional[str] = None
    session_id: Optional[UUID] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    old_values: Optional[str] = None
    new_values: Optional[str] = None
    changes_summary: Optional[str] = None
    description: Optional[str] = None
    success: Optional[bool] = True
    error_message: Optional[str] = None


class AuditLogCreate(AuditLogBase):
    """Schema for creating an audit log"""
    pass


class AuditLog(AuditLogBase):
    """Audit log schema with all fields"""
    id: UUID
    timestamp: datetime
    
    class Config:
        from_attributes = True


# Authentication schemas
class LoginRequest(BaseModel):
    """Login request schema"""
    username: str
    password: str


class LoginResponse(BaseModel):
    """Login response schema"""
    access_token: str
    token_type: str
    expires_in: int
    staff: Staff


class ChangePasswordRequest(BaseModel):
    """Change password request schema"""
    current_password: str
    new_password: str
    confirm_password: str


# Response schemas
class StaffResponse(BaseModel):
    """Response schema for staff endpoints"""
    data: Optional[Staff] = None
    error: Optional[str] = None
    message: Optional[str] = None


class StaffListResponse(BaseModel):
    """Response schema for multiple staff"""
    data: list[Staff]
    total: int


class StaffPermissionResponse(BaseModel):
    """Response schema for staff permission endpoints"""
    data: Optional[StaffPermission] = None
    error: Optional[str] = None
    message: Optional[str] = None


class AuditLogResponse(BaseModel):
    """Response schema for audit log endpoints"""
    data: list[AuditLog]
    total: int


# Filter schemas
class StaffFilter(BaseModel):
    """Filter parameters for staff"""
    search: Optional[str] = None
    role: Optional[StaffRole] = None
    department: Optional[str] = None
    is_active: Optional[bool] = None
    can_login: Optional[bool] = None
    company_id: Optional[UUID] = None


class AuditLogFilter(BaseModel):
    """Filter parameters for audit logs"""
    staff_id: Optional[UUID] = None
    action: Optional[str] = None
    entity_type: Optional[str] = None
    entity_id: Optional[UUID] = None
    success: Optional[bool] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None