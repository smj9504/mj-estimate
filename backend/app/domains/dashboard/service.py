"""
Dashboard service for generating dashboard data
"""

from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta, date
import logging
from app.core.database_factory import get_database
from app.domains.dashboard.schemas import (
    Priority, TimePeriod, WorkOrderSummary, DocumentCompletionStats,
    RevisionRequiredDocument, UserDashboardData, ManagerDashboardData,
    AdminDashboardData, TeamMemberStats, DashboardFilterParams
)
from app.domains.work_order.service import WorkOrderService
from app.domains.invoice.service import InvoiceService
from app.domains.estimate.service import EstimateService
from app.domains.staff.service import StaffService

logger = logging.getLogger(__name__)


class DashboardService:
    """Service for dashboard operations"""
    
    def __init__(self):
        self.database = get_database()
        self.work_order_service = WorkOrderService(self.database)
        self.invoice_service = InvoiceService(self.database)
        self.estimate_service = EstimateService(self.database)
        self.staff_service = StaffService(self.database)
    
    def calculate_priority(self, created_at: datetime) -> Priority:
        """
        Calculate priority based on age of work order in hours
        - Low: < 3 hours old
        - Medium: 3-12 hours old  
        - High: 12-24 hours old
        - Urgent: > 24 hours old
        """
        now = datetime.utcnow()
        age = now - created_at
        hours_old = age.total_seconds() / 3600  # Convert to hours
        
        if hours_old >= 24:
            return Priority.URGENT
        elif hours_old >= 12:
            return Priority.HIGH
        elif hours_old >= 3:
            return Priority.MEDIUM
        else:
            return Priority.LOW
    
    def get_time_period_dates(self, period: TimePeriod) -> tuple[date, date]:
        """
        Get start and end dates for a time period
        Week: Monday-Sunday
        Quarter: Calendar quarters
        """
        today = date.today()
        
        if period == TimePeriod.WEEK:
            # Get Monday of current week
            days_since_monday = today.weekday()
            start_date = today - timedelta(days=days_since_monday)
            end_date = start_date + timedelta(days=6)
            
        elif period == TimePeriod.MONTH:
            start_date = date(today.year, today.month, 1)
            # Get last day of month
            if today.month == 12:
                end_date = date(today.year, 12, 31)
            else:
                end_date = date(today.year, today.month + 1, 1) - timedelta(days=1)
                
        elif period == TimePeriod.QUARTER:
            # Calendar quarters: Q1 (Jan-Mar), Q2 (Apr-Jun), Q3 (Jul-Sep), Q4 (Oct-Dec)
            quarter = (today.month - 1) // 3
            start_month = quarter * 3 + 1
            end_month = start_month + 2
            start_date = date(today.year, start_month, 1)
            if end_month == 12:
                end_date = date(today.year, 12, 31)
            else:
                end_date = date(today.year, end_month + 1, 1) - timedelta(days=1)
                
        elif period == TimePeriod.YEAR:
            start_date = date(today.year, 1, 1)
            end_date = date(today.year, 12, 31)
        
        return start_date, end_date
    
    def get_work_order_assignments(self, staff_id: str) -> List[Dict[str, Any]]:
        """Get work orders assigned to a specific staff member"""
        try:
            # Get work orders where staff is assigned
            with self.database.get_session() as session:
                # Query work_order_staff_assignments table
                query = """
                    SELECT DISTINCT wo.* 
                    FROM work_orders wo
                    JOIN work_order_staff_assignments wosa ON wo.id = wosa.work_order_id
                    WHERE wosa.staff_id = :staff_id 
                    AND wosa.is_active = true
                    AND wo.is_active = true
                    ORDER BY wo.created_at ASC
                """
                # For SQLite/development, we'll use the simpler approach
                # In production with proper junction table, use the above query
                
                # Fallback to using assigned_to_staff_id for now
                work_orders = self.work_order_service.get_all()
                assigned_orders = [
                    wo for wo in work_orders 
                    if wo.get('assigned_to_staff_id') == staff_id
                ]
                return assigned_orders
                
        except Exception as e:
            logger.error(f"Error getting work order assignments: {e}")
            return []
    
    def get_document_completions(self, staff_id: Optional[str], period: TimePeriod) -> List[DocumentCompletionStats]:
        """Get document completion statistics for a time period"""
        start_date, end_date = self.get_time_period_dates(period)
        stats_by_type = {}
        
        try:
            # Get invoices
            invoices = self.invoice_service.get_all()
            for invoice in invoices:
                # Check if in date range
                invoice_date = invoice.get('created_at', '')
                if isinstance(invoice_date, str):
                    invoice_date = datetime.fromisoformat(invoice_date.replace('Z', '+00:00'))
                
                if start_date <= invoice_date.date() <= end_date:
                    status = invoice.get('status', '')
                    if status in ['completed', 'paid']:
                        if 'invoice' not in stats_by_type:
                            stats_by_type['invoice'] = {
                                'document_type': 'invoice',
                                'completed_count': 0,
                                'paid_count': 0,
                                'total_amount': 0.0,
                                'average_completion_time_hours': None
                            }
                        
                        stats_by_type['invoice']['completed_count'] += 1
                        if status == 'paid':
                            stats_by_type['invoice']['paid_count'] += 1
                        stats_by_type['invoice']['total_amount'] += float(invoice.get('total_amount', 0))
            
            # Get estimates
            estimates = self.estimate_service.get_all()
            for estimate in estimates:
                # Check if in date range
                estimate_date = estimate.get('created_at', '')
                if isinstance(estimate_date, str):
                    estimate_date = datetime.fromisoformat(estimate_date.replace('Z', '+00:00'))
                
                if start_date <= estimate_date.date() <= end_date:
                    status = estimate.get('status', '')
                    if status in ['completed', 'approved']:
                        if 'estimate' not in stats_by_type:
                            stats_by_type['estimate'] = {
                                'document_type': 'estimate',
                                'completed_count': 0,
                                'paid_count': 0,
                                'total_amount': 0.0,
                                'average_completion_time_hours': None
                            }
                        
                        stats_by_type['estimate']['completed_count'] += 1
                        stats_by_type['estimate']['total_amount'] += float(estimate.get('total_amount', 0))
            
            return [DocumentCompletionStats(**stats) for stats in stats_by_type.values()]
            
        except Exception as e:
            logger.error(f"Error getting document completions: {e}")
            return []
    
    def get_documents_requiring_revision(self, staff_id: Optional[str]) -> List[RevisionRequiredDocument]:
        """Get documents that require revision"""
        revision_docs = []
        
        try:
            # Check work orders with revision_requested flag
            work_orders = self.work_order_service.get_all()
            for wo in work_orders:
                if wo.get('revision_requested'):
                    # Check if assigned to this staff member (if staff_id provided)
                    if staff_id and wo.get('assigned_to_staff_id') != staff_id:
                        continue
                    
                    revision_date = wo.get('last_revision_date') or wo.get('updated_at')
                    if isinstance(revision_date, str):
                        revision_date = datetime.fromisoformat(revision_date.replace('Z', '+00:00'))
                    
                    days_pending = (datetime.utcnow() - revision_date).days
                    
                    revision_docs.append(RevisionRequiredDocument(
                        id=wo['id'],
                        document_type=wo.get('document_type', 'work_order'),
                        document_number=wo.get('work_order_number', ''),
                        client_name=wo.get('client_name', ''),
                        revision_requested_date=revision_date,
                        revision_notes=wo.get('internal_notes'),
                        assigned_to=wo.get('assigned_to_staff_id'),
                        days_pending=days_pending
                    ))
            
            return revision_docs
            
        except Exception as e:
            logger.error(f"Error getting documents requiring revision: {e}")
            return []
    
    def get_user_dashboard(self, staff_id: str, filters: DashboardFilterParams) -> UserDashboardData:
        """Get dashboard data for a regular user"""
        # Get assigned work orders
        work_orders = self.get_work_order_assignments(staff_id)
        
        # Categorize by priority
        urgent_orders = []
        high_orders = []
        medium_orders = []
        low_orders = []
        overdue_orders = []
        
        now = datetime.utcnow()
        today = date.today()
        week_start = today - timedelta(days=today.weekday())  # Monday
        
        completed_today = 0
        completed_this_week = 0
        
        for wo in work_orders:
            # Calculate priority based on creation time
            created_at = wo.get('created_at')
            if isinstance(created_at, str):
                created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
            
            priority = self.calculate_priority(created_at)
            days_old = (now - created_at).days
            
            # Check if overdue
            scheduled_end = wo.get('scheduled_end_date')
            is_overdue = False
            if scheduled_end:
                if isinstance(scheduled_end, str):
                    scheduled_end = datetime.fromisoformat(scheduled_end.replace('Z', '+00:00'))
                is_overdue = scheduled_end < now
            
            # Get assigned staff info (for multi-staff support)
            assigned_staff = []
            if wo.get('assigned_to_staff_id'):
                staff = self.staff_service.get_by_id(wo['assigned_to_staff_id'])
                if staff:
                    assigned_staff.append({
                        'id': staff['id'],
                        'name': staff.get('name', ''),
                        'role': staff.get('role', '')
                    })
            
            wo_summary = WorkOrderSummary(
                id=wo['id'],
                work_order_number=wo.get('work_order_number', ''),
                client_name=wo.get('client_name', ''),
                document_type=wo.get('document_type', ''),
                status=wo.get('status', ''),
                priority=priority,
                created_at=created_at,
                scheduled_start_date=wo.get('scheduled_start_date'),
                scheduled_end_date=wo.get('scheduled_end_date'),
                assigned_staff=assigned_staff,
                days_old=days_old,
                is_overdue=is_overdue,
                revision_requested=wo.get('revision_requested', False),
                revision_count=wo.get('revision_count', 0)
            )
            
            # Count completions
            if wo.get('status') == 'completed':
                completed_date = wo.get('actual_end_date') or wo.get('updated_at')
                if isinstance(completed_date, str):
                    completed_date = datetime.fromisoformat(completed_date.replace('Z', '+00:00'))
                
                if completed_date.date() == today:
                    completed_today += 1
                if completed_date.date() >= week_start:
                    completed_this_week += 1
            
            # Categorize by priority
            if is_overdue:
                overdue_orders.append(wo_summary)
            elif priority == Priority.URGENT:
                urgent_orders.append(wo_summary)
            elif priority == Priority.HIGH:
                high_orders.append(wo_summary)
            elif priority == Priority.MEDIUM:
                medium_orders.append(wo_summary)
            else:
                low_orders.append(wo_summary)
        
        # Get document completions for the period
        document_completions = self.get_document_completions(staff_id, filters.time_period)
        
        # Get documents requiring revision
        documents_requiring_revision = self.get_documents_requiring_revision(staff_id)
        
        return UserDashboardData(
            urgent_work_orders=urgent_orders,
            high_priority_work_orders=high_orders,
            medium_priority_work_orders=medium_orders,
            low_priority_work_orders=low_orders,
            overdue_work_orders=overdue_orders,
            total_assigned=len(work_orders),
            completed_today=completed_today,
            completed_this_week=completed_this_week,
            pending_revisions=len(documents_requiring_revision),
            document_completions=document_completions,
            documents_requiring_revision=documents_requiring_revision,
            time_period=filters.time_period
        )
    
    def get_manager_dashboard(self, staff_id: str, filters: DashboardFilterParams) -> ManagerDashboardData:
        """Get dashboard data for a manager (includes team data)"""
        # Get user dashboard data first
        user_data = self.get_user_dashboard(staff_id, filters)
        
        # Get team members
        all_staff = self.staff_service.get_all()
        team_members = []
        team_stats = {
            'total_assigned': 0,
            'completed_today': 0,
            'completed_this_week': 0,
            'pending_revisions': 0
        }
        work_distribution = {}
        
        for staff in all_staff:
            # Get stats for each team member
            member_work_orders = self.get_work_order_assignments(staff['id'])
            member_revisions = self.get_documents_requiring_revision(staff['id'])
            
            # Count completions
            today = date.today()
            week_start = today - timedelta(days=today.weekday())
            member_completed_today = 0
            member_completed_week = 0
            
            for wo in member_work_orders:
                if wo.get('status') == 'completed':
                    completed_date = wo.get('actual_end_date') or wo.get('updated_at')
                    if isinstance(completed_date, str):
                        completed_date = datetime.fromisoformat(completed_date.replace('Z', '+00:00'))
                    
                    if completed_date.date() == today:
                        member_completed_today += 1
                    if completed_date.date() >= week_start:
                        member_completed_week += 1
            
            team_members.append(TeamMemberStats(
                staff_id=str(staff['id']),  # Convert UUID to string
                staff_name=staff.get('name', '') or f"{staff.get('first_name', '')} {staff.get('last_name', '')}".strip(),
                email=staff.get('email', ''),
                role=staff.get('role', ''),
                assigned_work_orders=len(member_work_orders),
                completed_today=member_completed_today,
                completed_this_week=member_completed_week,
                pending_revisions=len(member_revisions),
                average_completion_time_hours=None  # TODO: Calculate this
            ))
            
            # Update team totals
            team_stats['total_assigned'] += len(member_work_orders)
            team_stats['completed_today'] += member_completed_today
            team_stats['completed_this_week'] += member_completed_week
            team_stats['pending_revisions'] += len(member_revisions)
            
            # Work distribution
            work_distribution[str(staff['id'])] = len(member_work_orders)
        
        return ManagerDashboardData(
            **user_data.dict(),
            team_members=team_members,
            team_total_assigned=team_stats['total_assigned'],
            team_completed_today=team_stats['completed_today'],
            team_completed_this_week=team_stats['completed_this_week'],
            team_pending_revisions=team_stats['pending_revisions'],
            work_distribution=work_distribution
        )
    
    def get_admin_dashboard(self, staff_id: str, filters: DashboardFilterParams) -> AdminDashboardData:
        """Get dashboard data for admin (includes all system data)"""
        # Get manager dashboard data first
        manager_data = self.get_manager_dashboard(staff_id, filters)
        
        # Get ALL work orders in the system
        all_work_orders = self.work_order_service.get_all()
        all_wo_summaries = []
        
        system_completed_today = 0
        system_completed_week = 0
        system_pending_revisions = 0
        
        today = date.today()
        week_start = today - timedelta(days=today.weekday())
        now = datetime.utcnow()
        
        for wo in all_work_orders:
            created_at = wo.get('created_at')
            if isinstance(created_at, str):
                created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
            
            priority = self.calculate_priority(created_at)
            days_old = (now - created_at).days
            
            # Check if overdue
            scheduled_end = wo.get('scheduled_end_date')
            is_overdue = False
            if scheduled_end:
                if isinstance(scheduled_end, str):
                    scheduled_end = datetime.fromisoformat(scheduled_end.replace('Z', '+00:00'))
                is_overdue = scheduled_end < now
            
            # Get assigned staff
            assigned_staff = []
            if wo.get('assigned_to_staff_id'):
                staff = self.staff_service.get_by_id(wo['assigned_to_staff_id'])
                if staff:
                    assigned_staff.append({
                        'id': staff['id'],
                        'name': staff.get('name', ''),
                        'role': staff.get('role', '')
                    })
            
            all_wo_summaries.append(WorkOrderSummary(
                id=wo['id'],
                work_order_number=wo.get('work_order_number', ''),
                client_name=wo.get('client_name', ''),
                document_type=wo.get('document_type', ''),
                status=wo.get('status', ''),
                priority=priority,
                created_at=created_at,
                scheduled_start_date=wo.get('scheduled_start_date'),
                scheduled_end_date=wo.get('scheduled_end_date'),
                assigned_staff=assigned_staff,
                days_old=days_old,
                is_overdue=is_overdue,
                revision_requested=wo.get('revision_requested', False),
                revision_count=wo.get('revision_count', 0)
            ))
            
            # Count system-wide stats
            if wo.get('status') == 'completed':
                completed_date = wo.get('actual_end_date') or wo.get('updated_at')
                if isinstance(completed_date, str):
                    completed_date = datetime.fromisoformat(completed_date.replace('Z', '+00:00'))
                
                if completed_date.date() == today:
                    system_completed_today += 1
                if completed_date.date() >= week_start:
                    system_completed_week += 1
            
            if wo.get('revision_requested'):
                system_pending_revisions += 1
        
        # Get company count
        from app.domains.company.service import CompanyService
        company_service = CompanyService(self.database)
        companies = company_service.get_all()
        
        # Calculate total revenue for the period
        start_date, end_date = self.get_time_period_dates(filters.time_period)
        total_revenue = 0.0
        
        # Sum invoice amounts in the period
        invoices = self.invoice_service.get_all()
        for invoice in invoices:
            invoice_date = invoice.get('invoice_date') or invoice.get('created_at')
            if isinstance(invoice_date, str):
                invoice_date = datetime.fromisoformat(invoice_date.replace('Z', '+00:00'))
            
            if start_date <= invoice_date.date() <= end_date:
                if invoice.get('status') == 'paid':
                    total_revenue += float(invoice.get('total_amount', 0))
        
        return AdminDashboardData(
            **manager_data.dict(),
            all_work_orders=all_wo_summaries,
            system_total_work_orders=len(all_work_orders),
            system_completed_today=system_completed_today,
            system_completed_this_week=system_completed_week,
            system_pending_revisions=system_pending_revisions,
            companies_count=len(companies),
            total_revenue_this_period=total_revenue
        )