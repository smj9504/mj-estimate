"""
Staff permissions and authorization utilities
"""

from typing import Dict, List, Optional, Any
from enum import Enum
from uuid import UUID
import logging

from .models import StaffRole, PermissionLevel

logger = logging.getLogger(__name__)


class Permission(Enum):
    """System permissions enumeration"""
    # Work Orders
    WORK_ORDER_CREATE = "work_order_create"
    WORK_ORDER_READ = "work_order_read"
    WORK_ORDER_UPDATE = "work_order_update"
    WORK_ORDER_DELETE = "work_order_delete"
    WORK_ORDER_ASSIGN = "work_order_assign"
    WORK_ORDER_STATUS_CHANGE = "work_order_status_change"
    
    # Estimates & Invoices
    ESTIMATE_CREATE = "estimate_create"
    ESTIMATE_READ = "estimate_read"
    ESTIMATE_UPDATE = "estimate_update"
    ESTIMATE_DELETE = "estimate_delete"
    
    INVOICE_CREATE = "invoice_create"
    INVOICE_READ = "invoice_read"
    INVOICE_UPDATE = "invoice_update"
    INVOICE_DELETE = "invoice_delete"
    
    # Payments & Billing
    PAYMENT_CREATE = "payment_create"
    PAYMENT_READ = "payment_read"
    PAYMENT_UPDATE = "payment_update"
    PAYMENT_DELETE = "payment_delete"
    PAYMENT_PROCESS = "payment_process"
    
    BILLING_SCHEDULE_CREATE = "billing_schedule_create"
    BILLING_SCHEDULE_READ = "billing_schedule_read"
    BILLING_SCHEDULE_UPDATE = "billing_schedule_update"
    BILLING_SCHEDULE_DELETE = "billing_schedule_delete"
    
    REFUND_CREATE = "refund_create"
    REFUND_READ = "refund_read"
    REFUND_PROCESS = "refund_process"
    
    # Credits & Discounts
    CREDIT_CREATE = "credit_create"
    CREDIT_READ = "credit_read"
    CREDIT_UPDATE = "credit_update"
    CREDIT_DELETE = "credit_delete"
    
    DISCOUNT_CREATE = "discount_create"
    DISCOUNT_READ = "discount_read"
    DISCOUNT_UPDATE = "discount_update"
    DISCOUNT_DELETE = "discount_delete"
    DISCOUNT_APPLY = "discount_apply"
    
    # Company & Staff
    COMPANY_CREATE = "company_create"
    COMPANY_READ = "company_read"
    COMPANY_UPDATE = "company_update"
    COMPANY_DELETE = "company_delete"
    
    STAFF_CREATE = "staff_create"
    STAFF_READ = "staff_read"
    STAFF_UPDATE = "staff_update"
    STAFF_DELETE = "staff_delete"
    STAFF_PERMISSIONS = "staff_permissions"
    
    # Reporting & System
    REPORTS_READ = "reports_read"
    ANALYTICS_READ = "analytics_read"
    EXPORT_DATA = "export_data"
    
    SYSTEM_SETTINGS = "system_settings"
    AUDIT_LOGS = "audit_logs"
    BACKUP_RESTORE = "backup_restore"
    
    # Financial
    FINANCIAL_DATA_VIEW = "financial_data_view"
    PRICING_MODIFY = "pricing_modify"
    LARGE_AMOUNT_APPROVE = "large_amount_approve"
    
    # Customer Data
    CUSTOMER_PII_ACCESS = "customer_pii_access"
    CUSTOMER_PAYMENT_INFO = "customer_payment_info"
    
    # Special
    SYSTEM_OVERRIDE = "system_override"
    EMERGENCY_ACCESS = "emergency_access"


# Role-based permission mapping
ROLE_PERMISSIONS: Dict[StaffRole, Dict[Permission, bool]] = {
    StaffRole.super_admin: {
        # Grant all permissions to super admin
        perm: True for perm in Permission
    },
    
    StaffRole.admin: {
        # Work Orders
        Permission.WORK_ORDER_CREATE: True,
        Permission.WORK_ORDER_READ: True,
        Permission.WORK_ORDER_UPDATE: True,
        Permission.WORK_ORDER_DELETE: True,
        Permission.WORK_ORDER_ASSIGN: True,
        Permission.WORK_ORDER_STATUS_CHANGE: True,
        
        # Estimates & Invoices
        Permission.ESTIMATE_CREATE: True,
        Permission.ESTIMATE_READ: True,
        Permission.ESTIMATE_UPDATE: True,
        Permission.ESTIMATE_DELETE: True,
        Permission.INVOICE_CREATE: True,
        Permission.INVOICE_READ: True,
        Permission.INVOICE_UPDATE: True,
        Permission.INVOICE_DELETE: True,
        
        # Payments
        Permission.PAYMENT_CREATE: True,
        Permission.PAYMENT_READ: True,
        Permission.PAYMENT_UPDATE: True,
        Permission.PAYMENT_DELETE: True,
        Permission.PAYMENT_PROCESS: True,
        Permission.REFUND_CREATE: True,
        Permission.REFUND_READ: True,
        Permission.REFUND_PROCESS: True,
        
        # Credits & Discounts
        Permission.CREDIT_CREATE: True,
        Permission.CREDIT_READ: True,
        Permission.CREDIT_UPDATE: True,
        Permission.CREDIT_DELETE: True,
        Permission.DISCOUNT_CREATE: True,
        Permission.DISCOUNT_READ: True,
        Permission.DISCOUNT_UPDATE: True,
        Permission.DISCOUNT_DELETE: True,
        Permission.DISCOUNT_APPLY: True,
        
        # Company & Staff
        Permission.COMPANY_READ: True,
        Permission.COMPANY_UPDATE: True,
        Permission.STAFF_READ: True,
        Permission.STAFF_UPDATE: True,
        Permission.STAFF_PERMISSIONS: True,
        
        # Reporting
        Permission.REPORTS_READ: True,
        Permission.ANALYTICS_READ: True,
        Permission.EXPORT_DATA: True,
        
        # Financial
        Permission.FINANCIAL_DATA_VIEW: True,
        Permission.PRICING_MODIFY: True,
        Permission.LARGE_AMOUNT_APPROVE: True,
        Permission.CUSTOMER_PII_ACCESS: True,
        Permission.CUSTOMER_PAYMENT_INFO: True,
        
        # System
        Permission.AUDIT_LOGS: True,
    },
    
    StaffRole.manager: {
        # Work Orders
        Permission.WORK_ORDER_CREATE: True,
        Permission.WORK_ORDER_READ: True,
        Permission.WORK_ORDER_UPDATE: True,
        Permission.WORK_ORDER_ASSIGN: True,
        Permission.WORK_ORDER_STATUS_CHANGE: True,
        
        # Estimates & Invoices
        Permission.ESTIMATE_CREATE: True,
        Permission.ESTIMATE_READ: True,
        Permission.ESTIMATE_UPDATE: True,
        Permission.INVOICE_CREATE: True,
        Permission.INVOICE_READ: True,
        Permission.INVOICE_UPDATE: True,
        
        # Payments
        Permission.PAYMENT_READ: True,
        Permission.PAYMENT_UPDATE: True,
        Permission.PAYMENT_PROCESS: True,
        Permission.REFUND_READ: True,
        Permission.REFUND_PROCESS: True,
        
        # Credits & Discounts
        Permission.CREDIT_READ: True,
        Permission.CREDIT_UPDATE: True,
        Permission.DISCOUNT_READ: True,
        Permission.DISCOUNT_APPLY: True,
        
        # Company & Staff
        Permission.COMPANY_READ: True,
        Permission.STAFF_READ: True,
        
        # Reporting
        Permission.REPORTS_READ: True,
        Permission.ANALYTICS_READ: True,
        Permission.EXPORT_DATA: True,
        
        # Financial
        Permission.FINANCIAL_DATA_VIEW: True,
        Permission.CUSTOMER_PII_ACCESS: True,
    },
    
    StaffRole.supervisor: {
        # Work Orders
        Permission.WORK_ORDER_CREATE: True,
        Permission.WORK_ORDER_READ: True,
        Permission.WORK_ORDER_UPDATE: True,
        Permission.WORK_ORDER_ASSIGN: True,
        Permission.WORK_ORDER_STATUS_CHANGE: True,
        
        # Estimates & Invoices
        Permission.ESTIMATE_CREATE: True,
        Permission.ESTIMATE_READ: True,
        Permission.ESTIMATE_UPDATE: True,
        Permission.INVOICE_READ: True,
        
        # Payments
        Permission.PAYMENT_READ: True,
        
        # Credits & Discounts
        Permission.CREDIT_READ: True,
        Permission.DISCOUNT_READ: True,
        Permission.DISCOUNT_APPLY: True,
        
        # Company & Staff
        Permission.COMPANY_READ: True,
        Permission.STAFF_READ: True,
        
        # Reporting
        Permission.REPORTS_READ: True,
        Permission.CUSTOMER_PII_ACCESS: True,
    },
    
    StaffRole.technician: {
        # Work Orders
        Permission.WORK_ORDER_READ: True,
        Permission.WORK_ORDER_UPDATE: True,
        Permission.WORK_ORDER_STATUS_CHANGE: True,
        
        # Estimates
        Permission.ESTIMATE_CREATE: True,
        Permission.ESTIMATE_READ: True,
        Permission.ESTIMATE_UPDATE: True,
        
        # Basic access
        Permission.COMPANY_READ: True,
    },
    
    StaffRole.staff: {
        # Regular staff - basic read permissions
        # Work Orders
        Permission.WORK_ORDER_READ: True,
        
        # Estimates & Invoices
        Permission.ESTIMATE_READ: True,
        Permission.INVOICE_READ: True,
        
        # Company
        Permission.COMPANY_READ: True,
    },
    
    StaffRole.sales: {
        # Work Orders
        Permission.WORK_ORDER_CREATE: True,
        Permission.WORK_ORDER_READ: True,
        Permission.WORK_ORDER_UPDATE: True,
        
        # Estimates & Invoices
        Permission.ESTIMATE_CREATE: True,
        Permission.ESTIMATE_READ: True,
        Permission.ESTIMATE_UPDATE: True,
        Permission.INVOICE_CREATE: True,
        Permission.INVOICE_READ: True,
        Permission.INVOICE_UPDATE: True,
        
        # Payments
        Permission.PAYMENT_READ: True,
        
        # Credits & Discounts
        Permission.CREDIT_READ: True,
        Permission.DISCOUNT_READ: True,
        Permission.DISCOUNT_APPLY: True,
        
        # Company
        Permission.COMPANY_READ: True,
        
        # Customer Data
        Permission.CUSTOMER_PII_ACCESS: True,
    },
    
    StaffRole.customer_service: {
        # Work Orders
        Permission.WORK_ORDER_READ: True,
        Permission.WORK_ORDER_UPDATE: True,
        
        # Estimates & Invoices
        Permission.ESTIMATE_READ: True,
        Permission.INVOICE_READ: True,
        
        # Payments
        Permission.PAYMENT_READ: True,
        
        # Credits & Discounts
        Permission.CREDIT_READ: True,
        Permission.CREDIT_UPDATE: True,
        Permission.DISCOUNT_READ: True,
        Permission.DISCOUNT_APPLY: True,
        
        # Company
        Permission.COMPANY_READ: True,
        
        # Customer Data
        Permission.CUSTOMER_PII_ACCESS: True,
    },
    
    StaffRole.accountant: {
        # Estimates & Invoices
        Permission.INVOICE_READ: True,
        Permission.INVOICE_UPDATE: True,
        
        # Payments
        Permission.PAYMENT_CREATE: True,
        Permission.PAYMENT_READ: True,
        Permission.PAYMENT_UPDATE: True,
        Permission.PAYMENT_PROCESS: True,
        Permission.REFUND_CREATE: True,
        Permission.REFUND_READ: True,
        Permission.REFUND_PROCESS: True,
        
        # Credits
        Permission.CREDIT_CREATE: True,
        Permission.CREDIT_READ: True,
        Permission.CREDIT_UPDATE: True,
        
        # Billing
        Permission.BILLING_SCHEDULE_CREATE: True,
        Permission.BILLING_SCHEDULE_READ: True,
        Permission.BILLING_SCHEDULE_UPDATE: True,
        
        # Financial
        Permission.FINANCIAL_DATA_VIEW: True,
        Permission.CUSTOMER_PAYMENT_INFO: True,
        
        # Reporting
        Permission.REPORTS_READ: True,
        Permission.EXPORT_DATA: True,
    },
    
    StaffRole.viewer: {
        # Read-only access
        Permission.WORK_ORDER_READ: True,
        Permission.ESTIMATE_READ: True,
        Permission.INVOICE_READ: True,
        Permission.PAYMENT_READ: True,
        Permission.CREDIT_READ: True,
        Permission.DISCOUNT_READ: True,
        Permission.COMPANY_READ: True,
        Permission.REPORTS_READ: True,
    }
}


def get_role_permissions(role: StaffRole) -> Dict[Permission, bool]:
    """
    Get permissions for a specific role
    
    Args:
        role: Staff role
        
    Returns:
        Dictionary of permissions with boolean values
    """
    return ROLE_PERMISSIONS.get(role, {})


def has_permission(role: StaffRole, permission: Permission) -> bool:
    """
    Check if a role has a specific permission
    
    Args:
        role: Staff role
        permission: Permission to check
        
    Returns:
        True if role has permission, False otherwise
    """
    role_permissions = get_role_permissions(role)
    return role_permissions.get(permission, False)


def get_permission_level_actions(level: PermissionLevel) -> List[str]:
    """
    Get allowed actions for a permission level
    
    Args:
        level: Permission level
        
    Returns:
        List of allowed actions
    """
    if level == PermissionLevel.FULL:
        return ["create", "read", "update", "delete"]
    elif level == PermissionLevel.MODIFY:
        return ["create", "read", "update"]
    elif level == PermissionLevel.READ_WRITE:
        return ["read", "update"]
    elif level == PermissionLevel.READ_ONLY:
        return ["read"]
    else:
        return []


def can_perform_action(permission_level: PermissionLevel, action: str) -> bool:
    """
    Check if a permission level allows a specific action
    
    Args:
        permission_level: Permission level
        action: Action to check (create, read, update, delete)
        
    Returns:
        True if action is allowed, False otherwise
    """
    allowed_actions = get_permission_level_actions(permission_level)
    return action.lower() in allowed_actions


def get_staff_permissions_summary(role: StaffRole) -> Dict[str, List[str]]:
    """
    Get a human-readable summary of staff permissions
    
    Args:
        role: Staff role
        
    Returns:
        Dictionary with permission categories and allowed actions
    """
    permissions = get_role_permissions(role)
    
    summary = {
        "work_orders": [],
        "estimates_invoices": [],
        "payments_billing": [],
        "credits_discounts": [],
        "company_staff": [],
        "reporting_system": [],
        "financial": [],
        "customer_data": [],
        "special": []
    }
    
    # Categorize permissions
    for perm, has_perm in permissions.items():
        if not has_perm:
            continue
            
        perm_name = perm.value
        
        if "work_order" in perm_name:
            summary["work_orders"].append(perm_name.replace("work_order_", "").replace("_", " ").title())
        elif "estimate" in perm_name or "invoice" in perm_name:
            summary["estimates_invoices"].append(perm_name.replace("estimate_", "").replace("invoice_", "").replace("_", " ").title())
        elif "payment" in perm_name or "billing" in perm_name or "refund" in perm_name:
            summary["payments_billing"].append(perm_name.replace("payment_", "").replace("billing_", "").replace("refund_", "").replace("_", " ").title())
        elif "credit" in perm_name or "discount" in perm_name:
            summary["credits_discounts"].append(perm_name.replace("credit_", "").replace("discount_", "").replace("_", " ").title())
        elif "company" in perm_name or "staff" in perm_name:
            summary["company_staff"].append(perm_name.replace("company_", "").replace("staff_", "").replace("_", " ").title())
        elif "report" in perm_name or "analytics" in perm_name or "export" in perm_name or "system" in perm_name or "audit" in perm_name:
            summary["reporting_system"].append(perm_name.replace("_", " ").title())
        elif "financial" in perm_name or "pricing" in perm_name or "large_amount" in perm_name:
            summary["financial"].append(perm_name.replace("_", " ").title())
        elif "customer" in perm_name:
            summary["customer_data"].append(perm_name.replace("customer_", "").replace("_", " ").title())
        elif "override" in perm_name or "emergency" in perm_name:
            summary["special"].append(perm_name.replace("_", " ").title())
    
    # Remove empty categories
    summary = {k: v for k, v in summary.items() if v}
    
    return summary


class PermissionChecker:
    """Utility class for checking permissions"""
    
    def __init__(self, staff_role: StaffRole, staff_permissions: Optional[Dict] = None):
        """
        Initialize permission checker
        
        Args:
            staff_role: Staff role
            staff_permissions: Optional custom permissions (overrides role defaults)
        """
        self.role = staff_role
        self.role_permissions = get_role_permissions(staff_role)
        self.custom_permissions = staff_permissions or {}
    
    def has_permission(self, permission: Permission) -> bool:
        """Check if staff has a specific permission"""
        # Check custom permissions first
        if permission.value in self.custom_permissions:
            return self.custom_permissions[permission.value]
        
        # Fall back to role permissions
        return self.role_permissions.get(permission, False)
    
    def can_create(self, entity_type: str) -> bool:
        """Check if staff can create entities of a specific type"""
        create_permissions = {
            "work_order": Permission.WORK_ORDER_CREATE,
            "estimate": Permission.ESTIMATE_CREATE,
            "invoice": Permission.INVOICE_CREATE,
            "payment": Permission.PAYMENT_CREATE,
            "credit": Permission.CREDIT_CREATE,
            "discount": Permission.DISCOUNT_CREATE,
            "company": Permission.COMPANY_CREATE,
            "staff": Permission.STAFF_CREATE,
        }
        
        perm = create_permissions.get(entity_type.lower())
        return self.has_permission(perm) if perm else False
    
    def can_read(self, entity_type: str) -> bool:
        """Check if staff can read entities of a specific type"""
        read_permissions = {
            "work_order": Permission.WORK_ORDER_READ,
            "estimate": Permission.ESTIMATE_READ,
            "invoice": Permission.INVOICE_READ,
            "payment": Permission.PAYMENT_READ,
            "credit": Permission.CREDIT_READ,
            "discount": Permission.DISCOUNT_READ,
            "company": Permission.COMPANY_READ,
            "staff": Permission.STAFF_READ,
        }
        
        perm = read_permissions.get(entity_type.lower())
        return self.has_permission(perm) if perm else False
    
    def can_update(self, entity_type: str) -> bool:
        """Check if staff can update entities of a specific type"""
        update_permissions = {
            "work_order": Permission.WORK_ORDER_UPDATE,
            "estimate": Permission.ESTIMATE_UPDATE,
            "invoice": Permission.INVOICE_UPDATE,
            "payment": Permission.PAYMENT_UPDATE,
            "credit": Permission.CREDIT_UPDATE,
            "discount": Permission.DISCOUNT_UPDATE,
            "company": Permission.COMPANY_UPDATE,
            "staff": Permission.STAFF_UPDATE,
        }
        
        perm = update_permissions.get(entity_type.lower())
        return self.has_permission(perm) if perm else False
    
    def can_delete(self, entity_type: str) -> bool:
        """Check if staff can delete entities of a specific type"""
        delete_permissions = {
            "work_order": Permission.WORK_ORDER_DELETE,
            "estimate": Permission.ESTIMATE_DELETE,
            "invoice": Permission.INVOICE_DELETE,
            "payment": Permission.PAYMENT_DELETE,
            "credit": Permission.CREDIT_DELETE,
            "discount": Permission.DISCOUNT_DELETE,
            "company": Permission.COMPANY_DELETE,
            "staff": Permission.STAFF_DELETE,
        }
        
        perm = delete_permissions.get(entity_type.lower())
        return self.has_permission(perm) if perm else False