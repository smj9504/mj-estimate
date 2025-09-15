"""
Dashboard API endpoints
"""

from fastapi import APIRouter, HTTPException, Query, Depends
from typing import Optional
from datetime import datetime
import traceback
from app.domains.dashboard.schemas import (
    UserDashboardData, ManagerDashboardData, AdminDashboardData,
    DashboardFilterParams, TimePeriod
)
from app.domains.dashboard.service import DashboardService
from app.domains.auth.dependencies import get_current_staff
from app.domains.staff.models import Staff, StaffRole

router = APIRouter()


@router.get("/test")
async def test_dashboard():
    """Test endpoint to verify dashboard API is working"""
    return {"message": "Dashboard API is working", "timestamp": datetime.utcnow()}


@router.get("/debug-simple")
async def debug_simple():
    """Simple debug endpoint"""
    return {"status": "working", "timestamp": datetime.utcnow()}


@router.get("/debug-admin-basic")
async def debug_admin_basic():
    """Test admin dashboard without authentication - basic version"""
    try:
        from app.domains.dashboard.service import DashboardService
        from app.domains.dashboard.schemas import DashboardFilterParams, TimePeriod
        
        service = DashboardService()
        
        filters = DashboardFilterParams(
            time_period=TimePeriod.WEEK,
            include_completed=True,
            include_draft=False
        )
        
        # Use a dummy staff ID for debugging
        dummy_staff_id = "00000000-0000-0000-0000-000000000000"
        dashboard_data = service.get_admin_dashboard(dummy_staff_id, filters)
        
        return {
            "status": "success",
            "data": {
                "urgent_work_orders_count": len(dashboard_data.urgent_work_orders),
                "total_work_orders": dashboard_data.system_total_work_orders,
                "companies_count": dashboard_data.companies_count,
                "total_revenue": dashboard_data.total_revenue_this_period,
                "team_members_count": len(dashboard_data.team_members)
            },
            "timestamp": datetime.utcnow()
        }
    except Exception as e:
        return {
            "error": str(e),
            "traceback": traceback.format_exc(),
            "timestamp": datetime.utcnow()
        }


@router.get("/user", response_model=UserDashboardData)
async def get_user_dashboard(
    time_period: TimePeriod = Query(TimePeriod.WEEK),
    include_completed: bool = Query(True),
    include_draft: bool = Query(False),
    current_staff: Staff = Depends(get_current_staff)
):
    """Get dashboard data for the current user"""
    service = DashboardService()
    
    filters = DashboardFilterParams(
        time_period=time_period,
        include_completed=include_completed,
        include_draft=include_draft
    )
    
    try:
        dashboard_data = service.get_user_dashboard(str(current_staff.id), filters)
        return dashboard_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/manager", response_model=ManagerDashboardData)
async def get_manager_dashboard(
    time_period: TimePeriod = Query(TimePeriod.WEEK),
    include_completed: bool = Query(True),
    include_draft: bool = Query(False),
    current_staff: Staff = Depends(get_current_staff)
):
    """Get dashboard data for a manager (includes team data)"""
    # Check if user has manager role
    if current_staff.role not in [StaffRole.manager, StaffRole.admin, StaffRole.super_admin, StaffRole.supervisor]:
        raise HTTPException(status_code=403, detail="Access denied. Manager role required.")
    
    service = DashboardService()
    
    filters = DashboardFilterParams(
        time_period=time_period,
        include_completed=include_completed,
        include_draft=include_draft
    )
    
    try:
        dashboard_data = service.get_manager_dashboard(str(current_staff.id), filters)
        return dashboard_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/admin", response_model=AdminDashboardData)
async def get_admin_dashboard(
    time_period: TimePeriod = Query(TimePeriod.WEEK),
    include_completed: bool = Query(True),
    include_draft: bool = Query(False),
    current_staff: Staff = Depends(get_current_staff)
):
    """Get dashboard data for admin (includes all system data)"""
    # Check if user has admin role
    if current_staff.role not in [StaffRole.admin, StaffRole.super_admin]:
        raise HTTPException(status_code=403, detail="Access denied. Admin role required.")
    
    service = DashboardService()
    
    filters = DashboardFilterParams(
        time_period=time_period,
        include_completed=include_completed,
        include_draft=include_draft
    )
    
    try:
        dashboard_data = service.get_admin_dashboard(str(current_staff.id), filters)
        return dashboard_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/my-work-orders")
async def get_my_work_orders(
    status: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    include_overdue: bool = Query(True),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_staff: Staff = Depends(get_current_staff)
):
    """Get work orders assigned to the current user with filtering and pagination"""
    service = DashboardService()
    
    try:
        # Get all work orders for the user
        work_orders = service.get_work_order_assignments(str(current_staff.id))
        
        # Apply filters
        filtered_orders = []
        for wo in work_orders:
            # Status filter
            if status and wo.get('status') != status:
                continue
            
            # Priority filter (calculate priority first)
            if priority:
                from datetime import datetime
                created_at = wo.get('created_at')
                if isinstance(created_at, str):
                    created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                calc_priority = service.calculate_priority(created_at)
                if calc_priority.value != priority:
                    continue
            
            # Overdue filter
            if not include_overdue:
                from datetime import datetime
                scheduled_end = wo.get('scheduled_end_date')
                if scheduled_end:
                    if isinstance(scheduled_end, str):
                        scheduled_end = datetime.fromisoformat(scheduled_end.replace('Z', '+00:00'))
                    if scheduled_end < datetime.utcnow():
                        continue
            
            filtered_orders.append(wo)
        
        # Pagination
        total = len(filtered_orders)
        start = (page - 1) * page_size
        end = start + page_size
        paginated_orders = filtered_orders[start:end]
        
        # Calculate total pages
        total_pages = (total + page_size - 1) // page_size if page_size > 0 else 0
        
        return {
            "items": paginated_orders,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/document-completions")
async def get_document_completions(
    time_period: TimePeriod = Query(TimePeriod.WEEK),
    current_staff: Staff = Depends(get_current_staff)
):
    """Get document completion statistics for the specified time period"""
    service = DashboardService()
    
    try:
        completions = service.get_document_completions(str(current_staff.id), time_period)
        return completions
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/revision-required")
async def get_revision_required_documents(
    current_staff: Staff = Depends(get_current_staff)
):
    """Get documents requiring revision for the current user"""
    service = DashboardService()
    
    try:
        revision_docs = service.get_documents_requiring_revision(str(current_staff.id))
        return revision_docs
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/work-order/{work_order_id}/revision")
async def update_revision_status(
    work_order_id: str,
    revision_requested: bool,
    revision_notes: Optional[str] = None,
    current_staff: Staff = Depends(get_current_staff)
):
    """Update the revision status of a work order"""
    from app.domains.work_order.service import WorkOrderService
    from app.core.database_factory import get_database
    from datetime import datetime
    
    database = get_database()
    wo_service = WorkOrderService(database)
    
    try:
        # Get the work order first
        work_order = wo_service.get_by_id(work_order_id)
        if not work_order:
            raise HTTPException(status_code=404, detail="Work order not found")
        
        # Check if user has permission (assigned to or admin)
        if current_staff.role not in [StaffRole.admin, StaffRole.super_admin] and work_order.get('assigned_to_staff_id') != str(current_staff.id):
            raise HTTPException(status_code=403, detail="Access denied")
        
        # Update revision fields
        update_data = {
            'revision_requested': revision_requested,
            'revision_count': work_order.get('revision_count', 0) + (1 if revision_requested else 0),
            'last_revision_date': datetime.utcnow() if revision_requested else work_order.get('last_revision_date')
        }
        
        if revision_notes:
            update_data['internal_notes'] = revision_notes
        
        updated_wo = wo_service.update(work_order_id, update_data)
        
        return {
            "message": "Revision status updated successfully",
            "work_order": updated_wo
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))