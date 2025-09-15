"""
Staff user database models
"""

from sqlalchemy import Column, String, Text, DateTime, Boolean, ForeignKey, Enum
from sqlalchemy.orm import relationship
from datetime import datetime
import enum

from app.core.database_factory import Base
from app.core.database_types import UUIDType, generate_uuid


class StaffRole(str, enum.Enum):
    """Staff role enumeration"""
    super_admin = "super_admin"
    admin = "admin"
    manager = "manager"
    supervisor = "supervisor"
    technician = "technician"
    staff = "staff"  # Regular staff role
    sales = "sales"
    customer_service = "customer_service"
    accountant = "accountant"
    viewer = "viewer"


class PermissionLevel(str, enum.Enum):
    """Permission level enumeration"""
    FULL = "full"          # Create, read, update, delete
    MODIFY = "modify"      # Create, read, update
    READ_WRITE = "read_write"  # Read, update existing
    READ_ONLY = "read_only"    # Read only
    NONE = "none"         # No access


class Staff(Base):
    """Staff user model"""
    __tablename__ = "staff"
    __table_args__ = {'extend_existing': True}
    
    id = Column(UUIDType(), primary_key=True, default=generate_uuid, index=True)
    
    # Staff Information
    staff_number = Column(String(50), unique=True, nullable=False, index=True)
    
    # Relationships removed - Staff doesn't need company association
    
    # Personal Information
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    email = Column(String(200), unique=True, nullable=False, index=True)
    phone = Column(String(50))
    mobile_phone = Column(String(50))
    
    # Employment Information
    role = Column(Enum(StaffRole), nullable=False)
    job_title = Column(String(100))
    department = Column(String(100))
    hire_date = Column(DateTime, nullable=False)
    termination_date = Column(DateTime)
    
    # Authentication
    username = Column(String(100), unique=True, nullable=False, index=True)
    password_hash = Column(String(255))  # Hashed password
    must_change_password = Column(Boolean, default=True)
    last_login = Column(DateTime)
    login_attempts = Column(String(20), default="0")
    locked_until = Column(DateTime)
    
    # Contact Information
    address = Column(String(500))
    city = Column(String(100))
    state = Column(String(50))
    zipcode = Column(String(20))
    country = Column(String(100), default="USA")
    
    # Emergency Contact
    emergency_contact_name = Column(String(200))
    emergency_contact_phone = Column(String(50))
    emergency_contact_relationship = Column(String(100))
    
    # Work Information
    hourly_rate = Column(String(20))
    salary = Column(String(20))
    supervisor_id = Column(UUIDType(), ForeignKey("staff.id"))
    
    # Skills and Certifications
    skills = Column(Text)  # JSON list of skills
    certifications = Column(Text)  # JSON list of certifications
    notes = Column(Text)
    
    # Status Flags
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=False)
    can_login = Column(Boolean, default=True)
    email_verified = Column(Boolean, default=False)
    
    # Preferences
    timezone = Column(String(100), default="UTC")
    language = Column(String(10), default="en")
    notification_preferences = Column(Text)  # JSON
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    # supervisor = relationship("Staff", remote_side=[id])
    
    def __str__(self):
        return f"{self.first_name} {self.last_name} ({self.role.value})"
    
    def __repr__(self):
        return f"<Staff(id={self.id}, name={self.first_name} {self.last_name}, role={self.role})>"
    
    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}"


class StaffPermission(Base):
    """Staff permission model for role-based access control"""
    __tablename__ = "staff_permissions"
    __table_args__ = {'extend_existing': True}
    
    id = Column(UUIDType(), primary_key=True, default=generate_uuid, index=True)
    
    # Relationships
    staff_id = Column(UUIDType(), ForeignKey("staff.id"), nullable=False)
    
    # Permission Categories
    # Work Orders
    work_orders = Column(Enum(PermissionLevel), default=PermissionLevel.READ_ONLY)
    work_order_assign = Column(Boolean, default=False)
    work_order_status_change = Column(Boolean, default=False)
    
    # Estimates & Invoices
    estimates = Column(Enum(PermissionLevel), default=PermissionLevel.READ_ONLY)
    invoices = Column(Enum(PermissionLevel), default=PermissionLevel.READ_ONLY)
    
    # Payments & Billing
    payments = Column(Enum(PermissionLevel), default=PermissionLevel.READ_ONLY)
    billing_schedules = Column(Enum(PermissionLevel), default=PermissionLevel.NONE)
    refunds = Column(Enum(PermissionLevel), default=PermissionLevel.NONE)
    
    # Credits & Discounts
    customer_credits = Column(Enum(PermissionLevel), default=PermissionLevel.READ_ONLY)
    discount_rules = Column(Enum(PermissionLevel), default=PermissionLevel.READ_ONLY)
    apply_discounts = Column(Boolean, default=False)
    
    # Company & Staff Management
    companies = Column(Enum(PermissionLevel), default=PermissionLevel.READ_ONLY)
    staff_management = Column(Enum(PermissionLevel), default=PermissionLevel.NONE)
    
    # Reporting & Analytics
    reports = Column(Enum(PermissionLevel), default=PermissionLevel.READ_ONLY)
    analytics = Column(Enum(PermissionLevel), default=PermissionLevel.READ_ONLY)
    export_data = Column(Boolean, default=False)
    
    # System Administration
    system_settings = Column(Enum(PermissionLevel), default=PermissionLevel.NONE)
    user_audit_logs = Column(Enum(PermissionLevel), default=PermissionLevel.NONE)
    backup_restore = Column(Boolean, default=False)
    
    # Financial Information
    view_financial_data = Column(Boolean, default=False)
    modify_pricing = Column(Boolean, default=False)
    approve_large_amounts = Column(Boolean, default=False)
    large_amount_threshold = Column(String(50), default="1000.00")
    
    # Customer Data
    customer_pii_access = Column(Boolean, default=False)
    customer_payment_info = Column(Boolean, default=False)
    
    # Special Permissions
    override_system_restrictions = Column(Boolean, default=False)
    emergency_access = Column(Boolean, default=False)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __str__(self):
        return f"Permissions for Staff ID: {self.staff_id}"
    
    def __repr__(self):
        return f"<StaffPermission(id={self.id}, staff_id={self.staff_id})>"


class StaffSession(Base):
    """Staff session model for tracking active sessions"""
    __tablename__ = "staff_sessions"
    __table_args__ = {'extend_existing': True}
    
    id = Column(UUIDType(), primary_key=True, default=generate_uuid, index=True)
    
    # Session Information
    session_token = Column(String(255), unique=True, nullable=False, index=True)
    
    # Relationships
    staff_id = Column(UUIDType(), ForeignKey("staff.id"), nullable=False)
    
    # Session Details
    ip_address = Column(String(45))  # IPv6 support
    user_agent = Column(Text)
    device_info = Column(Text)
    
    # Session Timing
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    last_activity = Column(DateTime, default=datetime.utcnow)
    
    # Status Flags
    is_active = Column(Boolean, default=True)
    is_mobile = Column(Boolean, default=False)
    
    def __str__(self):
        return f"Session for Staff ID: {self.staff_id}"
    
    def __repr__(self):
        return f"<StaffSession(id={self.id}, staff_id={self.staff_id}, expires_at={self.expires_at})>"


class AuditLog(Base):
    """Audit log model for tracking user actions"""
    __tablename__ = "audit_logs"
    __table_args__ = {'extend_existing': True}
    
    id = Column(UUIDType(), primary_key=True, default=generate_uuid, index=True)
    
    # Action Information
    action = Column(String(100), nullable=False)
    entity_type = Column(String(100), nullable=False)
    entity_id = Column(UUIDType())
    
    # Staff Information
    staff_id = Column(UUIDType(), ForeignKey("staff.id"))
    staff_name = Column(String(200))
    
    # Session Information
    session_id = Column(UUIDType(), ForeignKey("staff_sessions.id"))
    ip_address = Column(String(45))
    user_agent = Column(Text)
    
    # Change Details
    old_values = Column(Text)  # JSON of old values
    new_values = Column(Text)  # JSON of new values
    changes_summary = Column(Text)
    
    # Additional Information
    description = Column(Text)
    success = Column(Boolean, default=True)
    error_message = Column(Text)
    
    # Timing
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    
    def __str__(self):
        return f"Audit Log: {self.action} on {self.entity_type}"
    
    def __repr__(self):
        return f"<AuditLog(id={self.id}, action={self.action}, entity_type={self.entity_type})>"