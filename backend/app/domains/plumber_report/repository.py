"""
Plumber Report repository implementations for different database providers.
"""

from typing import Any, Dict, List, Optional
import logging
from datetime import datetime, date
import json

from app.common.base_repository import SQLAlchemyRepository, SupabaseRepository
from app.core.interfaces import DatabaseSession
from app.domains.plumber_report.models import PlumberReport
from app.core.config import settings

logger = logging.getLogger(__name__)


class PlumberReportRepositoryMixin:
    """Mixin with plumber report-specific methods"""
    
    def get_by_report_number(self, report_number: str) -> Optional[Dict[str, Any]]:
        """Get plumber report by report number"""
        reports = self.get_all(filters={'report_number': report_number}, limit=1)
        return reports[0] if reports else None
    
    def get_reports_by_status(self, status: str) -> List[Dict[str, Any]]:
        """Get plumber reports by status"""
        return self.get_all(filters={'status': status}, order_by='-created_at')
    
    def get_reports_by_company(self, company_id: str) -> List[Dict[str, Any]]:
        """Get plumber reports for a specific company"""
        return self.get_all(filters={'company_id': company_id}, order_by='-created_at')
    
    def get_reports_by_date_range(self, 
                                  start_date: date, 
                                  end_date: date) -> List[Dict[str, Any]]:
        """Get plumber reports within a date range"""
        # This will be implemented differently for each database type
        raise NotImplementedError("Subclasses must implement get_reports_by_date_range")
    
    def search_reports(self, search_term: str) -> List[Dict[str, Any]]:
        """Search plumber reports by various fields"""
        # This will be implemented differently for each database type
        raise NotImplementedError("Subclasses must implement search_reports")
    
    def get_reports_by_client(self, client_name: str) -> List[Dict[str, Any]]:
        """Get plumber reports for a specific client"""
        return self.get_all(filters={'client_name': client_name}, order_by='-created_at')
    
    def get_recent_reports(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get recent plumber reports"""
        return self.get_all(order_by='-created_at', limit=limit)


class PlumberReportSQLAlchemyRepository(SQLAlchemyRepository, PlumberReportRepositoryMixin):
    """SQLAlchemy-based plumber report repository for SQLite/PostgreSQL"""
    
    def __init__(self, session: DatabaseSession):
        super().__init__(session, PlumberReport)
    
    def get_reports_by_date_range(self, 
                                  start_date: date, 
                                  end_date: date) -> List[Dict[str, Any]]:
        """Get plumber reports within a date range using SQLAlchemy"""
        try:
            entities = self.db_session.query(PlumberReport).filter(
                PlumberReport.service_date >= start_date,
                PlumberReport.service_date <= end_date
            ).order_by(PlumberReport.service_date.desc()).all()
            
            return [self._convert_to_dict(entity) for entity in entities]
            
        except Exception as e:
            logger.error(f"Error getting plumber reports by date range: {e}")
            raise Exception(f"Failed to get plumber reports by date range: {e}")
    
    def search_reports(self, search_term: str) -> List[Dict[str, Any]]:
        """Search plumber reports using SQL LIKE queries"""
        try:
            search_pattern = f"%{search_term.lower()}%"
            
            entities = self.db_session.query(PlumberReport).filter(
                (PlumberReport.report_number.ilike(search_pattern)) |
                (PlumberReport.client_name.ilike(search_pattern)) |
                (PlumberReport.client_email.ilike(search_pattern)) |
                (PlumberReport.client_address.ilike(search_pattern)) |
                (PlumberReport.cause_of_damage.ilike(search_pattern)) |
                (PlumberReport.work_performed.ilike(search_pattern)) |
                (PlumberReport.recommendations.ilike(search_pattern))
            ).order_by(PlumberReport.service_date.desc()).all()
            
            return [self._convert_to_dict(entity) for entity in entities]
            
        except Exception as e:
            logger.error(f"Error searching plumber reports: {e}")
            raise Exception(f"Failed to search plumber reports: {e}")
    
    def get_reports_with_photos(self) -> List[Dict[str, Any]]:
        """Get plumber reports that have photos"""
        try:
            entities = self.db_session.query(PlumberReport).filter(
                PlumberReport.photos.isnot(None)
            ).order_by(PlumberReport.service_date.desc()).all()
            
            reports = []
            for entity in entities:
                report_dict = self._convert_to_dict(entity)
                
                # Parse photos JSON if it's a string
                if report_dict.get('photos') and isinstance(report_dict['photos'], str):
                    try:
                        report_dict['photos'] = json.loads(report_dict['photos'])
                    except json.JSONDecodeError:
                        logger.warning(f"Invalid JSON in photos for report {entity.id}")
                        report_dict['photos'] = []
                
                # Only include reports with actual photos
                if report_dict.get('photos'):
                    reports.append(report_dict)
            
            return reports
            
        except Exception as e:
            logger.error(f"Error getting plumber reports with photos: {e}")
            raise Exception(f"Failed to get plumber reports with photos: {e}")
    
    def create(self, entity_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create plumber report with JSON field handling"""
        # Handle JSON fields
        json_fields = ['invoice_items', 'payments', 'photos', 'company_data']
        for field in json_fields:
            if field in entity_data and isinstance(entity_data[field], (list, dict)):
                entity_data[field] = json.dumps(entity_data[field])
        
        return super().create(entity_data)
    
    def update(self, entity_id: str, update_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update plumber report with JSON field handling"""
        # Handle JSON fields
        json_fields = ['invoice_items', 'payments', 'photos', 'company_data']
        for field in json_fields:
            if field in update_data and isinstance(update_data[field], (list, dict)):
                update_data[field] = json.dumps(update_data[field])
        
        return super().update(entity_id, update_data)


class PlumberReportSupabaseRepository(SupabaseRepository, PlumberReportRepositoryMixin):
    """Supabase-based plumber report repository"""
    
    def __init__(self, session: DatabaseSession):
        super().__init__(session, "plumber_reports", PlumberReport)
    
    def get_reports_by_date_range(self, 
                                  start_date: date, 
                                  end_date: date) -> List[Dict[str, Any]]:
        """Get plumber reports within a date range using Supabase"""
        try:
            response = self.client.table('plumber_reports').select('*').gte(
                'service_date', start_date.isoformat()
            ).lte(
                'service_date', end_date.isoformat()
            ).order('service_date', desc=True).execute()
            
            return response.data if response.data else []
            
        except Exception as e:
            logger.error(f"Error getting plumber reports by date range from Supabase: {e}")
            raise Exception(f"Failed to get plumber reports by date range: {e}")
    
    def search_reports(self, search_term: str) -> List[Dict[str, Any]]:
        """Search plumber reports using Supabase"""
        try:
            # Get all reports first, then filter in Python
            # This is a limitation of the current Supabase client
            all_reports = self.get_all()
            
            search_lower = search_term.lower()
            filtered_reports = [
                report for report in all_reports
                if (
                    search_lower in (report.get('report_number', '') or '').lower() or
                    search_lower in (report.get('client_name', '') or '').lower() or
                    search_lower in (report.get('client_email', '') or '').lower() or
                    search_lower in (report.get('client_address', '') or '').lower() or
                    search_lower in (report.get('cause_of_damage', '') or '').lower() or
                    search_lower in (report.get('work_performed', '') or '').lower() or
                    search_lower in (report.get('recommendations', '') or '').lower()
                )
            ]
            
            # Sort by service date
            filtered_reports.sort(key=lambda x: x.get('service_date', ''), reverse=True)
            
            return filtered_reports
            
        except Exception as e:
            logger.error(f"Error searching plumber reports in Supabase: {e}")
            raise Exception(f"Failed to search plumber reports: {e}")
    
    def get_reports_with_photos(self) -> List[Dict[str, Any]]:
        """Get plumber reports that have photos using Supabase"""
        try:
            # Get all reports and filter for those with photos
            all_reports = self.get_all()
            
            reports_with_photos = []
            for report in all_reports:
                # Parse photos JSON if it's a string
                if report.get('photos'):
                    if isinstance(report['photos'], str):
                        try:
                            photos = json.loads(report['photos'])
                            report['photos'] = photos
                        except json.JSONDecodeError:
                            logger.warning(f"Invalid JSON in photos for report {report.get('id')}")
                            continue
                    
                    # Only include reports with actual photos
                    if report['photos']:
                        reports_with_photos.append(report)
            
            # Sort by service date
            reports_with_photos.sort(key=lambda x: x.get('service_date', ''), reverse=True)
            
            return reports_with_photos
            
        except Exception as e:
            logger.error(f"Error getting plumber reports with photos from Supabase: {e}")
            raise Exception(f"Failed to get plumber reports with photos: {e}")
    
    def create(self, entity_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create plumber report with Supabase-specific handling"""
        # Remove fields that might cause issues in Supabase
        clean_data = entity_data.copy()
        
        # Handle JSON fields
        json_fields = ['invoice_items', 'payments', 'photos', 'company_data']
        for field in json_fields:
            if field in clean_data and isinstance(clean_data[field], (list, dict)):
                clean_data[field] = json.dumps(clean_data[field])
        
        # Remove None values
        clean_data = {k: v for k, v in clean_data.items() if v is not None}
        
        # Remove timestamp fields (they're auto-managed by Supabase)
        clean_data.pop('created_at', None)
        clean_data.pop('updated_at', None)
        
        return super().create(clean_data)
    
    def update(self, entity_id: str, update_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update plumber report with Supabase-specific handling"""
        # Remove fields that might cause issues in Supabase
        clean_data = update_data.copy()
        
        # Handle JSON fields
        json_fields = ['invoice_items', 'payments', 'photos', 'company_data']
        for field in json_fields:
            if field in clean_data and isinstance(clean_data[field], (list, dict)):
                clean_data[field] = json.dumps(clean_data[field])
        
        # Remove None values
        clean_data = {k: v for k, v in clean_data.items() if v is not None}
        
        # Remove timestamp fields and ID
        clean_data.pop('created_at', None)
        clean_data.pop('updated_at', None)
        clean_data.pop('id', None)
        
        if not clean_data:
            logger.warning(f"No valid data to update for plumber report {entity_id}")
            return self.get_by_id(entity_id)
        
        return super().update(entity_id, clean_data)
    
    def get_by_id(self, entity_id: str) -> Optional[Dict[str, Any]]:
        """Get plumber report by ID with JSON field parsing"""
        report = super().get_by_id(entity_id)
        
        if report:
            # Parse JSON fields if they're strings
            json_fields = ['invoice_items', 'payments', 'photos', 'company_data']
            for field in json_fields:
                if report.get(field) and isinstance(report[field], str):
                    try:
                        report[field] = json.loads(report[field])
                    except json.JSONDecodeError:
                        logger.warning(f"Invalid JSON in {field} for report {entity_id}")
                        if field in ['invoice_items', 'payments', 'photos']:
                            report[field] = []
                        else:
                            report[field] = {}
        
        return report
    
    def get_all(self, **kwargs) -> List[Dict[str, Any]]:
        """Get all plumber reports with JSON field parsing"""
        reports = super().get_all(**kwargs)
        
        # Parse JSON fields for all reports
        for report in reports:
            json_fields = ['invoice_items', 'payments', 'photos', 'company_data']
            for field in json_fields:
                if report.get(field) and isinstance(report[field], str):
                    try:
                        report[field] = json.loads(report[field])
                    except json.JSONDecodeError:
                        logger.warning(f"Invalid JSON in {field} for report {report.get('id')}")
                        if field in ['invoice_items', 'payments', 'photos']:
                            report[field] = []
                        else:
                            report[field] = {}
        
        return reports


def get_plumber_report_repository(session: DatabaseSession) -> PlumberReportRepositoryMixin:
    """Factory function to get appropriate plumber report repository based on database type"""
    
    # Determine which repository to use based on session type or configuration
    if hasattr(session, 'query'):
        # SQLAlchemy session
        return PlumberReportSQLAlchemyRepository(session)
    else:
        # Assume Supabase client
        return PlumberReportSupabaseRepository(session)