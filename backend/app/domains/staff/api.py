"""
Staff API endpoints
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional
from uuid import UUID
from datetime import datetime

from .schemas import (
    Staff, StaffCreate, StaffUpdate, StaffResponse, StaffListResponse,
    StaffPermission, StaffPermissionCreate, StaffPermissionUpdate, StaffPermissionResponse,
    AuditLog, AuditLogResponse, StaffFilter, AuditLogFilter,
    LoginRequest, LoginResponse, ChangePasswordRequest
)
from .service import StaffService
from .models import StaffRole
from app.core.database_factory import get_database

router = APIRouter()


def get_staff_service():
    """Dependency to get staff service"""
    return StaffService(get_database())


@router.post("/login", response_model=LoginResponse)
async def login(
    login_data: LoginRequest,
    service: StaffService = Depends(get_staff_service)
):
    """Staff login endpoint"""
    try:
        result = service.authenticate_staff(login_data.username, login_data.password)
        if not result:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Login failed: {str(e)}")


@router.post("/change-password")
async def change_password(
    password_data: ChangePasswordRequest,
    current_staff_id: UUID = Query(..., description="Current staff ID"),
    service: StaffService = Depends(get_staff_service)
):
    """Change staff password"""
    try:
        if password_data.new_password != password_data.confirm_password:
            raise HTTPException(status_code=400, detail="New passwords do not match")
        
        success = service.change_password(
            current_staff_id, 
            password_data.current_password, 
            password_data.new_password
        )
        
        if not success:
            raise HTTPException(status_code=400, detail="Failed to change password")
        
        return {"message": "Password changed successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Password change failed: {str(e)}")


@router.get("/", response_model=StaffListResponse)
async def get_staff_members(
    search: Optional[str] = Query(None, description="Search term"),
    role: Optional[StaffRole] = Query(None, description="Filter by role"),
    department: Optional[str] = Query(None, description="Filter by department"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    company_id: Optional[UUID] = Query(None, description="Filter by company ID"),
    service: StaffService = Depends(get_staff_service)
):
    """Get all staff members with optional filters"""
    try:
        filters = StaffFilter(
            search=search,
            role=role,
            department=department,
            is_active=is_active,
            company_id=company_id
        )
        
        result = service.get_staff_with_filters(filters)
        staff_members = result.get('staff', [])
        
        return StaffListResponse(data=staff_members, total=len(staff_members))
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving staff: {str(e)}")


@router.get("/{staff_id}", response_model=StaffResponse)
async def get_staff_member(
    staff_id: UUID,
    service: StaffService = Depends(get_staff_service)
):
    """Get single staff member by ID"""
    try:
        staff = service.get_by_id(staff_id)
        if not staff:
            raise HTTPException(status_code=404, detail="Staff member not found")
        return StaffResponse(data=staff)
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving staff member: {str(e)}")


@router.post("/", response_model=StaffResponse)
async def create_staff_member(
    staff: StaffCreate,
    service: StaffService = Depends(get_staff_service)
):
    """Create new staff member"""
    try:
        new_staff = service.create_staff_member(staff)
        return StaffResponse(
            data=new_staff,
            message="Staff member created successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error creating staff member: {str(e)}")


@router.put("/{staff_id}", response_model=StaffResponse)
async def update_staff_member(
    staff_id: UUID,
    staff: StaffUpdate,
    service: StaffService = Depends(get_staff_service)
):
    """Update staff member"""
    try:
        update_data = staff.dict(exclude_none=True)
        updated_staff = service.update(staff_id, update_data)
        
        if not updated_staff:
            raise HTTPException(status_code=404, detail="Staff member not found")
            
        return StaffResponse(
            data=updated_staff,
            message="Staff member updated successfully"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Update failed: {str(e)}")


@router.delete("/{staff_id}")
async def delete_staff_member(
    staff_id: UUID,
    service: StaffService = Depends(get_staff_service)
):
    """Delete staff member (soft delete)"""
    try:
        success = service.deactivate_staff_member(staff_id)
        if not success:
            raise HTTPException(status_code=404, detail="Staff member not found")
        return {"message": "Staff member deactivated successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error deactivating staff member: {str(e)}")


@router.get("/{staff_id}/permissions", response_model=StaffPermissionResponse)
async def get_staff_permissions(
    staff_id: UUID,
    service: StaffService = Depends(get_staff_service)
):
    """Get staff member permissions"""
    try:
        permissions = service.get_staff_permissions(staff_id)
        return StaffPermissionResponse(data=permissions)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving permissions: {str(e)}")


@router.put("/{staff_id}/permissions", response_model=StaffPermissionResponse)
async def update_staff_permissions(
    staff_id: UUID,
    permissions: StaffPermissionUpdate,
    service: StaffService = Depends(get_staff_service)
):
    """Update staff member permissions"""
    try:
        updated_permissions = service.update_staff_permissions(staff_id, permissions)
        return StaffPermissionResponse(
            data=updated_permissions,
            message="Permissions updated successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error updating permissions: {str(e)}")


@router.get("/audit-logs/", response_model=AuditLogResponse)
async def get_audit_logs(
    staff_id: Optional[UUID] = Query(None, description="Filter by staff ID"),
    action: Optional[str] = Query(None, description="Filter by action"),
    entity_type: Optional[str] = Query(None, description="Filter by entity type"),
    entity_id: Optional[UUID] = Query(None, description="Filter by entity ID"),
    success: Optional[bool] = Query(None, description="Filter by success status"),
    date_from: Optional[datetime] = Query(None, description="Filter from date"),
    date_to: Optional[datetime] = Query(None, description="Filter to date"),
    limit: int = Query(100, description="Limit results"),
    service: StaffService = Depends(get_staff_service)
):
    """Get audit logs with filters"""
    try:
        filters = AuditLogFilter(
            staff_id=staff_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            success=success,
            date_from=date_from,
            date_to=date_to
        )
        
        result = service.get_audit_logs(filters, limit)
        return AuditLogResponse(data=result, total=len(result))
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving audit logs: {str(e)}")


# Utility endpoints
@router.get("/roles/list")
async def get_staff_roles():
    """Get list of available staff roles"""
    return {
        "roles": [
            {"value": role.value, "label": role.value.replace("_", " ").title()}
            for role in StaffRole
        ]
    }


@router.get("/dashboard/stats")
async def get_staff_dashboard_stats(
    company_id: Optional[UUID] = Query(None, description="Filter by company ID"),
    service: StaffService = Depends(get_staff_service)
):
    """Get staff dashboard statistics"""
    try:
        stats = service.get_staff_dashboard_stats(company_id)
        return stats
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving staff stats: {str(e)}")


@router.post("/generate-number")
async def generate_staff_number(
    company_id: UUID = Query(..., description="Company ID"),
    service: StaffService = Depends(get_staff_service)
):
    """Generate a new staff number"""
    try:
        staff_number = service.generate_staff_number(company_id)
        return {"staff_number": staff_number}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating staff number: {str(e)}")