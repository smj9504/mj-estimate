"""
Dashboard domain schemas
"""

from pydantic import BaseModel
from typing import List, Dict, Optional, Any
from datetime import datetime, date
from enum import Enum


class TimePeriod(str, Enum):
    """Time period enumeration"""
    WEEK = "week"
    MONTH = "month"
    QUARTER = "quarter"
    YEAR = "year"


class Priority(str, Enum):
    """Priority levels based on age of work order"""
    URGENT = "urgent"  # > 24 hours old
    HIGH = "high"      # 12-24 hours old
    MEDIUM = "medium"  # 3-12 hours old
    LOW = "low"        # < 3 hours old


class WorkOrderSummary(BaseModel):
    """Summary of work order for dashboard"""
    id: str
    work_order_number: str
    client_name: str
    document_type: str
    status: str
    priority: Priority
    created_at: datetime
    scheduled_start_date: Optional[datetime]
    scheduled_end_date: Optional[datetime]
    assigned_staff: List[Dict[str, Any]]  # List of assigned staff members
    days_old: int
    is_overdue: bool
    revision_requested: bool
    revision_count: int


class DocumentCompletionStats(BaseModel):
    """Document completion statistics"""
    document_type: str
    completed_count: int
    paid_count: int
    total_amount: float
    average_completion_time_hours: Optional[float]


class RevisionRequiredDocument(BaseModel):
    """Document requiring revision"""
    id: str
    document_type: str
    document_number: str
    client_name: str
    revision_requested_date: datetime
    revision_notes: Optional[str]
    assigned_to: Optional[str]
    days_pending: int


class UserDashboardData(BaseModel):
    """Dashboard data for regular users"""
    # Work orders by priority
    urgent_work_orders: List[WorkOrderSummary]
    high_priority_work_orders: List[WorkOrderSummary]
    medium_priority_work_orders: List[WorkOrderSummary]
    low_priority_work_orders: List[WorkOrderSummary]
    overdue_work_orders: List[WorkOrderSummary]
    
    # Statistics
    total_assigned: int
    completed_today: int
    completed_this_week: int
    pending_revisions: int
    
    # Document completions by type for selected period
    document_completions: List[DocumentCompletionStats]
    
    # Documents requiring revision
    documents_requiring_revision: List[RevisionRequiredDocument]
    
    # Time period for stats
    time_period: TimePeriod


class TeamMemberStats(BaseModel):
    """Team member statistics for managers"""
    staff_id: str
    staff_name: str
    email: str
    role: str
    assigned_work_orders: int
    completed_today: int
    completed_this_week: int
    pending_revisions: int
    average_completion_time_hours: Optional[float]


class ManagerDashboardData(UserDashboardData):
    """Dashboard data for managers (includes team overview)"""
    # Team statistics
    team_members: List[TeamMemberStats]
    team_total_assigned: int
    team_completed_today: int
    team_completed_this_week: int
    team_pending_revisions: int
    
    # Work distribution
    work_distribution: Dict[str, int]  # staff_id -> count of assigned work orders


class AdminDashboardData(ManagerDashboardData):
    """Dashboard data for admins (includes all work orders)"""
    # All work orders across the system
    all_work_orders: List[WorkOrderSummary]
    system_total_work_orders: int
    system_completed_today: int
    system_completed_this_week: int
    system_pending_revisions: int
    
    # System-wide statistics
    companies_count: int
    total_revenue_this_period: float
    

class DashboardFilterParams(BaseModel):
    """Filter parameters for dashboard data"""
    time_period: TimePeriod = TimePeriod.WEEK
    include_completed: bool = True
    include_draft: bool = False
    document_types: Optional[List[str]] = None