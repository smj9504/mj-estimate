"""
Service layer for Electrician Inspection Report operations
"""

from typing import List, Optional, Dict, Any
from uuid import UUID
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.domains.electrician_report.models import ElectricianReport
from app.domains.company.models import Company
from app.domains.electrician_report.schemas import (
    ElectricianReportCreate,
    ElectricianReportUpdate,
    ElectricianReportResponse,
    FinancialSummary
)


class ElectricianReportService:
    """Service for managing Electrician Inspection Reports"""

    @staticmethod
    def generate_report_number() -> str:
        """Generate a unique report number"""
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        return f"ELC-{timestamp}"

    @staticmethod
    def generate_report_number_with_company(db: Session, company_id: Optional[str] = None) -> str:
        """
        Generate next ELC report number with company-specific formatting.
        Format: ELC-[CompanyCode]-[Year]-[Sequence]
        """
        try:
            now = datetime.now()
            year = str(now.year)

            company_code = None
            if company_id:
                try:
                    company = db.query(Company).filter(Company.id == company_id).first()
                    if company:
                        company_code = company.company_code
                except Exception:
                    pass

            if company_code:
                prefix = f"ELC-{company_code}-{year}"
                count = db.query(ElectricianReport).filter(
                    ElectricianReport.report_number.like(f"{prefix}%")
                ).count()

                sequence = count + 1
                report_number = f"ELC-{company_code}-{year}-{sequence}"

                existing = db.query(ElectricianReport).filter(
                    ElectricianReport.report_number == report_number
                ).first()

                while existing:
                    sequence += 1
                    report_number = f"ELC-{company_code}-{year}-{sequence}"
                    existing = db.query(ElectricianReport).filter(
                        ElectricianReport.report_number == report_number
                    ).first()

                return report_number
            else:
                timestamp = now.strftime("%Y%m%d%H%M%S")
                return f"ELC-{year}-{timestamp[-6:]}"

        except Exception:
            timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
            return f"ELC-{timestamp}"

    @staticmethod
    def calculate_financial_summary(report_data: Dict[str, Any]) -> FinancialSummary:
        """Calculate financial totals from report data"""
        invoice_items = report_data.get("invoice_items", [])

        materials_cost = sum(
            item.get("total_cost", 0)
            for item in invoice_items
        )

        equipment_cost = 0
        labor_cost = report_data.get("financial", {}).get("labor_cost", 0)

        subtotal = labor_cost + materials_cost + equipment_cost
        tax_amount = report_data.get("financial", {}).get("tax_amount", 0)
        discount = report_data.get("financial", {}).get("discount", 0)

        total_amount = subtotal + tax_amount - discount

        payments = report_data.get("payments", [])
        total_paid = sum(payment.get("amount", 0) for payment in payments)
        balance_due = total_amount - total_paid

        return FinancialSummary(
            labor_cost=labor_cost,
            materials_cost=materials_cost,
            equipment_cost=equipment_cost,
            subtotal=subtotal,
            tax_amount=tax_amount,
            discount=discount,
            total_amount=total_amount,
            balance_due=balance_due
        )

    @staticmethod
    def create_report(
        db: Session,
        report_data: ElectricianReportCreate,
        created_by: str = None
    ) -> ElectricianReport:
        """Create a new electrician report"""

        if not report_data.report_number:
            report_data.report_number = ElectricianReportService.generate_report_number()

        company_data = None
        if report_data.company_id:
            company = db.query(Company).filter(Company.id == report_data.company_id).first()
            if company:
                company_data = {
                    "id": str(company.id),
                    "name": company.name,
                    "address": company.address,
                    "city": company.city,
                    "state": company.state,
                    "zip": company.zipcode,
                    "phone": company.phone,
                    "email": company.email,
                    "logo": company.logo,
                    "license": company.license_number
                }

        report_dict = report_data.dict()
        financial = ElectricianReportService.calculate_financial_summary(report_dict)

        db_report = ElectricianReport(
            report_number=report_data.report_number,
            template_type=report_data.template_type,
            status=report_data.status,
            company_id=report_data.company_id,
            company_data=company_data,

            client_name=report_data.client.name,
            client_address=report_data.client.address,
            client_city=report_data.client.city,
            client_state=report_data.client.state,
            client_zipcode=report_data.client.zipcode,
            client_phone=report_data.client.phone,
            client_email=report_data.client.email,

            property_address=report_data.property.address,
            property_city=report_data.property.city,
            property_state=report_data.property.state,
            property_zipcode=report_data.property.zipcode,

            service_date=report_data.service_date,
            technician_name=report_data.technician_name,
            license_number=report_data.license_number,

            # Electrical-specific
            panel_type=report_data.panel_type,
            panel_location=report_data.panel_location,
            panel_amperage=report_data.panel_amperage,
            system_voltage=report_data.system_voltage,
            meter_number=report_data.meter_number,
            building_type=report_data.building_type,

            cause_of_damage=report_data.cause_of_damage,
            electrical_findings=report_data.electrical_findings,
            work_performed=report_data.work_performed,
            materials_equipment_text=report_data.materials_equipment_text,
            safety_concerns=report_data.safety_concerns,
            code_violations=report_data.code_violations,
            recommendations=report_data.recommendations,

            inspection_checklist=[
                s.dict() for s in report_data.inspection_checklist
            ] if report_data.inspection_checklist else [],
            invoice_items=[item.dict() for item in report_data.invoice_items],

            labor_cost=financial.labor_cost,
            materials_cost=financial.materials_cost,
            equipment_cost=financial.equipment_cost,
            subtotal=financial.subtotal,
            tax_amount=financial.tax_amount,
            discount=financial.discount,
            total_amount=financial.total_amount,
            balance_due=financial.balance_due,

            payments=[payment.dict() for payment in report_data.payments],
            show_payment_dates=report_data.show_payment_dates,
            photos=[photo.dict() for photo in report_data.photos],

            warranty_info=report_data.warranty_info,
            terms_conditions=report_data.terms_conditions,
            notes=report_data.notes,
            created_by=created_by
        )

        db.add(db_report)
        db.flush()

        claim_id = getattr(report_data, 'claim_id', None)
        if claim_id:
            ElectricianReportService._link_to_claim(db, db_report.id, claim_id)

        db.commit()
        db.refresh(db_report)
        return db_report

    @staticmethod
    def _link_to_claim(db: Session, report_id, claim_id: str):
        """Set Claim.electrician_report_id to link the report."""
        try:
            from app.domains.client.models import Claim
            claim = db.query(Claim).filter(Claim.id == claim_id).first()
            if claim:
                claim.electrician_report_id = report_id
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Failed to link electrician report to claim: {e}")

    @staticmethod
    def get_claim_id_for_report(db: Session, report_id) -> Optional[str]:
        """Find the Claim linked to this report."""
        try:
            from app.domains.client.models import Claim
            claim = db.query(Claim).filter(
                Claim.electrician_report_id == str(report_id)
            ).first()
            return str(claim.id) if claim else None
        except Exception:
            return None

    @staticmethod
    def get_report(db: Session, report_id: UUID) -> Optional[ElectricianReport]:
        """Get a single electrician report by ID"""
        return db.query(ElectricianReport).filter(ElectricianReport.id == report_id).first()

    @staticmethod
    def get_reports(
        db: Session,
        skip: int = 0,
        limit: int = 100,
        status: Optional[str] = None,
        search: Optional[str] = None
    ) -> List[ElectricianReport]:
        """Get list of electrician reports with filters"""
        query = db.query(ElectricianReport)

        if status:
            query = query.filter(ElectricianReport.status == status)

        if search:
            search_pattern = f"%{search}%"
            query = query.filter(
                (ElectricianReport.report_number.ilike(search_pattern)) |
                (ElectricianReport.client_name.ilike(search_pattern)) |
                (ElectricianReport.property_address.ilike(search_pattern))
            )

        return query.order_by(desc(ElectricianReport.created_at)).offset(skip).limit(limit).all()

    @staticmethod
    def update_report(
        db: Session,
        report_id: UUID,
        report_update: ElectricianReportUpdate,
        updated_by: str = None
    ) -> Optional[ElectricianReport]:
        """Update an existing electrician report"""
        db_report = db.query(ElectricianReport).filter(ElectricianReport.id == report_id).first()

        if not db_report:
            return None

        update_data = report_update.dict(exclude_unset=True)

        claim_id = update_data.pop("claim_id", None)
        if claim_id:
            ElectricianReportService._link_to_claim(db, report_id, claim_id)

        if "client" in update_data:
            client_data = update_data.pop("client")
            for key, value in client_data.items():
                setattr(db_report, f"client_{key}" if key != "zipcode" else "client_zipcode", value)

        if "property" in update_data:
            property_data = update_data.pop("property")
            for key, value in property_data.items():
                setattr(db_report, f"property_{key}" if key != "zipcode" else "property_zipcode", value)

        if "financial" in update_data:
            financial_data = update_data.pop("financial")
            for key, value in financial_data.items():
                setattr(db_report, key, value)

        for arr_field in ["invoice_items", "payments", "photos", "inspection_checklist"]:
            if arr_field in update_data:
                items = update_data.pop(arr_field)
                setattr(db_report, arr_field, [
                    item.dict() if hasattr(item, 'dict') else item
                    for item in items
                ])

        if "materials_equipment_text" in update_data:
            db_report.materials_equipment_text = update_data.pop("materials_equipment_text")

        for field, value in update_data.items():
            setattr(db_report, field, value)

        report_dict = db_report.to_dict()
        financial = ElectricianReportService.calculate_financial_summary(report_dict)

        db_report.labor_cost = financial.labor_cost
        db_report.materials_cost = financial.materials_cost
        db_report.equipment_cost = financial.equipment_cost
        db_report.subtotal = financial.subtotal
        db_report.total_amount = financial.total_amount
        db_report.balance_due = financial.balance_due

        db_report.updated_by = updated_by
        db_report.updated_at = datetime.utcnow()

        db.commit()
        db.refresh(db_report)
        return db_report

    @staticmethod
    def delete_report(db: Session, report_id: UUID) -> bool:
        """Delete an electrician report"""
        db_report = db.query(ElectricianReport).filter(ElectricianReport.id == report_id).first()
        if not db_report:
            return False
        db.delete(db_report)
        db.commit()
        return True

    @staticmethod
    def get_report_count(
        db: Session,
        status: Optional[str] = None,
        search: Optional[str] = None
    ) -> int:
        """Get count of electrician reports"""
        query = db.query(ElectricianReport)
        if status:
            query = query.filter(ElectricianReport.status == status)
        if search:
            search_pattern = f"%{search}%"
            query = query.filter(
                (ElectricianReport.report_number.ilike(search_pattern)) |
                (ElectricianReport.client_name.ilike(search_pattern)) |
                (ElectricianReport.property_address.ilike(search_pattern))
            )
        return query.count()
