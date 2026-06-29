"""
Electrician Report repository implementations for different database providers.
"""

from typing import Any, Dict, List, Optional
import logging
from datetime import date
import json

from app.common.base_repository import SQLAlchemyRepository, SupabaseRepository
from app.core.interfaces import DatabaseSession
from app.domains.electrician_report.models import ElectricianReport

logger = logging.getLogger(__name__)


class ElectricianReportRepositoryMixin:
    """Mixin with electrician report-specific methods"""

    def get_by_report_number(self, report_number: str) -> Optional[Dict[str, Any]]:
        reports = self.get_all(filters={'report_number': report_number}, limit=1)
        return reports[0] if reports else None

    def get_reports_by_status(self, status: str) -> List[Dict[str, Any]]:
        return self.get_all(filters={'status': status}, order_by='-created_at')

    def get_reports_by_company(self, company_id: str) -> List[Dict[str, Any]]:
        return self.get_all(filters={'company_id': company_id}, order_by='-created_at')

    def get_reports_by_client(self, client_name: str) -> List[Dict[str, Any]]:
        return self.get_all(filters={'client_name': client_name}, order_by='-created_at')

    def get_recent_reports(self, limit: int = 10) -> List[Dict[str, Any]]:
        return self.get_all(order_by='-created_at', limit=limit)


class ElectricianReportSQLAlchemyRepository(SQLAlchemyRepository, ElectricianReportRepositoryMixin):
    """SQLAlchemy-based electrician report repository"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, ElectricianReport)

    def search_reports(self, search_term: str) -> List[Dict[str, Any]]:
        try:
            search_pattern = f"%{search_term.lower()}%"
            entities = self.db_session.query(ElectricianReport).filter(
                (ElectricianReport.report_number.ilike(search_pattern)) |
                (ElectricianReport.client_name.ilike(search_pattern)) |
                (ElectricianReport.client_address.ilike(search_pattern)) |
                (ElectricianReport.electrical_findings.ilike(search_pattern)) |
                (ElectricianReport.work_performed.ilike(search_pattern))
            ).order_by(ElectricianReport.service_date.desc()).all()
            return [self._convert_to_dict(entity) for entity in entities]
        except Exception as e:
            logger.error(f"Error searching electrician reports: {e}")
            raise

    def create(self, entity_data: Dict[str, Any]) -> Dict[str, Any]:
        json_fields = ['invoice_items', 'payments', 'photos', 'company_data', 'inspection_checklist']
        for field in json_fields:
            if field in entity_data and isinstance(entity_data[field], (list, dict)):
                entity_data[field] = json.dumps(entity_data[field])
        return super().create(entity_data)

    def update(self, entity_id: str, update_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        json_fields = ['invoice_items', 'payments', 'photos', 'company_data', 'inspection_checklist']
        for field in json_fields:
            if field in update_data and isinstance(update_data[field], (list, dict)):
                update_data[field] = json.dumps(update_data[field])
        return super().update(entity_id, update_data)


class ElectricianReportSupabaseRepository(SupabaseRepository, ElectricianReportRepositoryMixin):
    """Supabase-based electrician report repository"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, "electrician_reports", ElectricianReport)

    def search_reports(self, search_term: str) -> List[Dict[str, Any]]:
        try:
            all_reports = self.get_all()
            search_lower = search_term.lower()
            filtered = [
                r for r in all_reports
                if (
                    search_lower in (r.get('report_number', '') or '').lower() or
                    search_lower in (r.get('client_name', '') or '').lower() or
                    search_lower in (r.get('client_address', '') or '').lower() or
                    search_lower in (r.get('electrical_findings', '') or '').lower()
                )
            ]
            filtered.sort(key=lambda x: x.get('service_date', ''), reverse=True)
            return filtered
        except Exception as e:
            logger.error(f"Error searching electrician reports: {e}")
            raise

    def create(self, entity_data: Dict[str, Any]) -> Dict[str, Any]:
        clean_data = entity_data.copy()
        json_fields = ['invoice_items', 'payments', 'photos', 'company_data', 'inspection_checklist']
        for field in json_fields:
            if field in clean_data and isinstance(clean_data[field], (list, dict)):
                clean_data[field] = json.dumps(clean_data[field])
        clean_data = {k: v for k, v in clean_data.items() if v is not None}
        clean_data.pop('created_at', None)
        clean_data.pop('updated_at', None)
        return super().create(clean_data)

    def update(self, entity_id: str, update_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        clean_data = update_data.copy()
        json_fields = ['invoice_items', 'payments', 'photos', 'company_data', 'inspection_checklist']
        for field in json_fields:
            if field in clean_data and isinstance(clean_data[field], (list, dict)):
                clean_data[field] = json.dumps(clean_data[field])
        clean_data = {k: v for k, v in clean_data.items() if v is not None}
        clean_data.pop('created_at', None)
        clean_data.pop('updated_at', None)
        clean_data.pop('id', None)
        if not clean_data:
            return self.get_by_id(entity_id)
        return super().update(entity_id, clean_data)

    def get_by_id(self, entity_id: str) -> Optional[Dict[str, Any]]:
        report = super().get_by_id(entity_id)
        if report:
            json_fields = ['invoice_items', 'payments', 'photos', 'company_data', 'inspection_checklist']
            for field in json_fields:
                if report.get(field) and isinstance(report[field], str):
                    try:
                        report[field] = json.loads(report[field])
                    except json.JSONDecodeError:
                        report[field] = [] if field != 'company_data' else {}
        return report

    def get_all(self, **kwargs) -> List[Dict[str, Any]]:
        reports = super().get_all(**kwargs)
        for report in reports:
            json_fields = ['invoice_items', 'payments', 'photos', 'company_data', 'inspection_checklist']
            for field in json_fields:
                if report.get(field) and isinstance(report[field], str):
                    try:
                        report[field] = json.loads(report[field])
                    except json.JSONDecodeError:
                        report[field] = [] if field != 'company_data' else {}
        return reports


def get_electrician_report_repository(session: DatabaseSession) -> ElectricianReportRepositoryMixin:
    """Factory function to get appropriate repository"""
    if hasattr(session, 'query'):
        return ElectricianReportSQLAlchemyRepository(session)
    else:
        return ElectricianReportSupabaseRepository(session)
