"""
Work Order utility functions
"""

from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from uuid import UUID
import re
import logging

from .models import WorkOrderStatus, DocumentType

logger = logging.getLogger(__name__)


def validate_work_order_number(work_order_number: str) -> bool:
    """
    Validate work order number format: WO-[COMPANY_CODE]-YY-NNNN
    
    Args:
        work_order_number: Work order number to validate
        
    Returns:
        True if valid format, False otherwise
    """
    # Format: WO-COMPANY_CODE-YY-NNNN (e.g., WO-ABC-25-0001)
    pattern = r'^WO-[A-Z0-9]{2,10}-\d{2}-\d{4}(-\d+)?$'
    return bool(re.match(pattern, work_order_number))


def calculate_duration(start_date: Optional[datetime], end_date: Optional[datetime]) -> Optional[int]:
    """
    Calculate duration in days between two dates
    
    Args:
        start_date: Start date
        end_date: End date
        
    Returns:
        Duration in days or None if dates are invalid
    """
    if not start_date or not end_date:
        return None
    
    try:
        duration = (end_date - start_date).days
        return max(0, duration)
    except Exception:
        return None


def is_overdue(work_order: Dict[str, Any]) -> bool:
    """
    Check if a work order is overdue
    
    Args:
        work_order: Work order dictionary
        
    Returns:
        True if overdue, False otherwise
    """
    status = work_order.get('status')
    scheduled_end_date = work_order.get('scheduled_end_date')
    
    if not scheduled_end_date or status in [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED]:
        return False
    
    try:
        if isinstance(scheduled_end_date, str):
            scheduled_end_date = datetime.fromisoformat(scheduled_end_date.replace('Z', '+00:00'))
        
        return datetime.now() > scheduled_end_date
    except Exception:
        return False


def calculate_progress_percentage(work_order: Dict[str, Any]) -> float:
    """
    Calculate work order progress percentage based on status
    
    Args:
        work_order: Work order dictionary
        
    Returns:
        Progress percentage (0.0 to 100.0)
    """
    status = work_order.get('status')
    
    status_progress = {
        WorkOrderStatus.DRAFT: 0.0,
        WorkOrderStatus.PENDING: 10.0,
        WorkOrderStatus.IN_PROGRESS: 50.0,
        WorkOrderStatus.COMPLETED: 100.0,
        WorkOrderStatus.CANCELLED: 0.0,
        WorkOrderStatus.ON_HOLD: 25.0
    }
    
    return status_progress.get(status, 0.0)


def get_status_color(status: WorkOrderStatus) -> str:
    """
    Get color code for work order status
    
    Args:
        status: Work order status
        
    Returns:
        Hex color code
    """
    status_colors = {
        WorkOrderStatus.DRAFT: "#6c757d",      # Gray
        WorkOrderStatus.PENDING: "#ffc107",    # Yellow
        WorkOrderStatus.IN_PROGRESS: "#007bff", # Blue
        WorkOrderStatus.COMPLETED: "#28a745",  # Green
        WorkOrderStatus.CANCELLED: "#dc3545",  # Red
        WorkOrderStatus.ON_HOLD: "#fd7e14"     # Orange
    }
    
    return status_colors.get(status, "#6c757d")


def get_priority_color(priority: str) -> str:
    """
    Get color code for work order priority
    
    Args:
        priority: Priority level
        
    Returns:
        Hex color code
    """
    priority_colors = {
        "low": "#28a745",      # Green
        "medium": "#ffc107",   # Yellow
        "high": "#fd7e14",     # Orange
        "urgent": "#dc3545"    # Red
    }
    
    return priority_colors.get(priority.lower(), "#6c757d")


def format_work_order_summary(work_order: Dict[str, Any]) -> str:
    """
    Format work order for summary display
    
    Args:
        work_order: Work order dictionary
        
    Returns:
        Formatted summary string
    """
    try:
        number = work_order.get('work_order_number', 'N/A')
        client = work_order.get('client_name', 'Unknown Client')
        status = work_order.get('status', 'Unknown')
        
        return f"WO #{number} - {client} ({status.replace('_', ' ').title()})"
    except Exception:
        return "Work Order Summary Unavailable"


def sanitize_work_order_data(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Sanitize and validate work order data
    
    Args:
        data: Raw work order data
        
    Returns:
        Sanitized data dictionary
    """
    sanitized = {}
    
    # String fields with length limits
    string_fields = {
        'work_order_number': 50,
        'client_name': 200,
        'client_address': 500,
        'client_city': 100,
        'client_state': 50,
        'client_zipcode': 20,
        'client_phone': 50,
        'client_email': 200,
        'job_site_address': 500,
        'job_site_city': 100,
        'job_site_state': 50,
        'job_site_zipcode': 20,
        'priority': 20,
        'estimated_hours': 20,
        'estimated_cost': 50,
        'actual_hours': 20,
        'actual_cost': 50
    }
    
    # Text fields (unlimited length)
    text_fields = [
        'work_description', 'scope_of_work', 'special_instructions',
        'materials_required', 'tools_required', 'permits_required',
        'safety_notes', 'internal_notes', 'completion_notes'
    ]
    
    # Process string fields
    for field, max_length in string_fields.items():
        if field in data and data[field] is not None:
            value = str(data[field]).strip()
            if len(value) <= max_length:
                sanitized[field] = value
            else:
                sanitized[field] = value[:max_length]
                logger.warning(f"Truncated {field} to {max_length} characters")
    
    # Process text fields
    for field in text_fields:
        if field in data and data[field] is not None:
            sanitized[field] = str(data[field]).strip()
    
    # Process enum fields
    if 'status' in data and data['status'] is not None:
        try:
            sanitized['status'] = WorkOrderStatus(data['status'])
        except ValueError:
            logger.warning(f"Invalid status value: {data['status']}")
    
    if 'document_type' in data and data['document_type'] is not None:
        try:
            sanitized['document_type'] = DocumentType(data['document_type'])
        except ValueError:
            logger.warning(f"Invalid document type value: {data['document_type']}")
    
    # Process UUID fields
    uuid_fields = ['id', 'company_id', 'created_by_staff_id', 'assigned_to_staff_id']
    for field in uuid_fields:
        if field in data and data[field] is not None:
            try:
                sanitized[field] = UUID(str(data[field]))
            except ValueError:
                logger.warning(f"Invalid UUID for {field}: {data[field]}")
    
    # Process boolean fields
    boolean_fields = ['is_active', 'is_billable', 'requires_permit']
    for field in boolean_fields:
        if field in data and data[field] is not None:
            sanitized[field] = bool(data[field])
    
    # Process datetime fields
    datetime_fields = [
        'scheduled_start_date', 'scheduled_end_date',
        'actual_start_date', 'actual_end_date'
    ]
    for field in datetime_fields:
        if field in data and data[field] is not None:
            try:
                if isinstance(data[field], str):
                    sanitized[field] = datetime.fromisoformat(data[field].replace('Z', '+00:00'))
                elif isinstance(data[field], datetime):
                    sanitized[field] = data[field]
            except ValueError:
                logger.warning(f"Invalid datetime for {field}: {data[field]}")
    
    return sanitized


def generate_work_order_report_data(work_orders: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Generate report data for work orders
    
    Args:
        work_orders: List of work order dictionaries
        
    Returns:
        Report data dictionary
    """
    if not work_orders:
        return {
            'total_count': 0,
            'status_breakdown': {},
            'priority_breakdown': {},
            'overdue_count': 0,
            'completion_rate': 0.0
        }
    
    # Status breakdown
    status_breakdown = {}
    for status in WorkOrderStatus:
        status_breakdown[status.value] = 0
    
    # Priority breakdown
    priority_breakdown = {'low': 0, 'medium': 0, 'high': 0, 'urgent': 0}
    
    overdue_count = 0
    completed_count = 0
    
    for wo in work_orders:
        # Status count
        status = wo.get('status')
        if status in status_breakdown:
            status_breakdown[status] += 1
        
        # Priority count
        priority = wo.get('priority', 'medium').lower()
        if priority in priority_breakdown:
            priority_breakdown[priority] += 1
        
        # Overdue count
        if is_overdue(wo):
            overdue_count += 1
        
        # Completed count
        if status == WorkOrderStatus.COMPLETED:
            completed_count += 1
    
    # Completion rate
    completion_rate = (completed_count / len(work_orders)) * 100 if work_orders else 0
    
    return {
        'total_count': len(work_orders),
        'status_breakdown': status_breakdown,
        'priority_breakdown': priority_breakdown,
        'overdue_count': overdue_count,
        'completion_rate': round(completion_rate, 2),
        'generated_at': datetime.now().isoformat()
    }