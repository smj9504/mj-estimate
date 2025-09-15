"""
Service layer for Plumber Report operations
"""

from typing import List, Optional, Dict, Any
from uuid import UUID
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import desc
import json

from app.domains.plumber_report.models import PlumberReport
from app.domains.company.models import Company
from app.domains.plumber_report.schemas import (
    PlumberReportCreate,
    PlumberReportUpdate,
    PlumberReportResponse,
    FinancialSummary
)


class PlumberReportService:
    """Service for managing Plumber Reports"""
    
    @staticmethod
    def generate_report_number() -> str:
        """Generate a unique report number"""
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        return f"PLR-{timestamp}"
    
    @staticmethod
    def calculate_financial_summary(report_data: Dict[str, Any]) -> FinancialSummary:
        """Calculate financial totals from report data"""
        invoice_items = report_data.get("invoice_items", [])
        
        materials_cost = sum(
            item.get("total_cost", 0) 
            for item in invoice_items
        )
        
        # Equipment cost is not used for invoice items, set to 0
        equipment_cost = 0
        
        labor_cost = report_data.get("financial", {}).get("labor_cost", 0)
        
        subtotal = labor_cost + materials_cost + equipment_cost
        tax_amount = report_data.get("financial", {}).get("tax_amount", 0)
        discount = report_data.get("financial", {}).get("discount", 0)
        
        total_amount = subtotal + tax_amount - discount
        
        # Calculate balance due
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
        report_data: PlumberReportCreate,
        created_by: str = None
    ) -> PlumberReport:
        """Create a new plumber report"""
        
        # Generate report number if not provided
        if not report_data.report_number:
            report_data.report_number = PlumberReportService.generate_report_number()
        
        # Get company data if company_id provided
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
                    "zip": company.zip,
                    "phone": company.phone,
                    "email": company.email,
                    "logo": company.logo,
                    "license": company.license_number
                }
        
        # Calculate financial summary
        report_dict = report_data.dict()
        financial = PlumberReportService.calculate_financial_summary(report_dict)
        
        # Create report
        db_report = PlumberReport(
            report_number=report_data.report_number,
            template_type=report_data.template_type,
            status=report_data.status,
            company_id=report_data.company_id,
            company_data=company_data,
            
            # Client info
            client_name=report_data.client.name,
            client_address=report_data.client.address,
            client_city=report_data.client.city,
            client_state=report_data.client.state,
            client_zipcode=report_data.client.zipcode,
            client_phone=report_data.client.phone,
            client_email=report_data.client.email,
            
            # Property info
            property_address=report_data.property.address,
            property_city=report_data.property.city,
            property_state=report_data.property.state,
            property_zipcode=report_data.property.zipcode,
            
            # Service details
            service_date=report_data.service_date,
            technician_name=report_data.technician_name,
            license_number=report_data.license_number,
            
            # Report content
            cause_of_damage=report_data.cause_of_damage,
            work_performed=report_data.work_performed,
            recommendations=report_data.recommendations,
            
            # Materials and equipment text
            materials_equipment_text=report_data.materials_equipment_text,
            
            # Invoice items
            invoice_items=[item.dict() for item in report_data.invoice_items],
            
            # Financial
            labor_cost=financial.labor_cost,
            materials_cost=financial.materials_cost,
            equipment_cost=financial.equipment_cost,
            subtotal=financial.subtotal,
            tax_amount=financial.tax_amount,
            discount=financial.discount,
            total_amount=financial.total_amount,
            balance_due=financial.balance_due,
            
            # Payments
            payments=[payment.dict() for payment in report_data.payments],
            show_payment_dates=report_data.show_payment_dates,
            
            # Photos
            photos=[photo.dict() for photo in report_data.photos],
            
            # Additional info
            warranty_info=report_data.warranty_info,
            terms_conditions=report_data.terms_conditions,
            notes=report_data.notes,
            
            created_by=created_by
        )
        
        db.add(db_report)
        db.commit()
        db.refresh(db_report)
        
        return db_report
    
    @staticmethod
    def get_report(db: Session, report_id: UUID) -> Optional[PlumberReport]:
        """Get a single plumber report by ID"""
        return db.query(PlumberReport).filter(PlumberReport.id == report_id).first()
    
    @staticmethod
    def get_reports(
        db: Session,
        skip: int = 0,
        limit: int = 100,
        status: Optional[str] = None,
        search: Optional[str] = None
    ) -> List[PlumberReport]:
        """Get list of plumber reports with filters"""
        query = db.query(PlumberReport)
        
        if status:
            query = query.filter(PlumberReport.status == status)
        
        if search:
            search_pattern = f"%{search}%"
            query = query.filter(
                (PlumberReport.report_number.ilike(search_pattern)) |
                (PlumberReport.client_name.ilike(search_pattern)) |
                (PlumberReport.property_address.ilike(search_pattern))
            )
        
        return query.order_by(desc(PlumberReport.created_at)).offset(skip).limit(limit).all()
    
    @staticmethod
    def update_report(
        db: Session,
        report_id: UUID,
        report_update: PlumberReportUpdate,
        updated_by: str = None
    ) -> Optional[PlumberReport]:
        """Update an existing plumber report"""
        db_report = db.query(PlumberReport).filter(PlumberReport.id == report_id).first()
        
        if not db_report:
            return None
        
        update_data = report_update.dict(exclude_unset=True)
        
        # Handle nested objects
        if "client" in update_data:
            client_data = update_data.pop("client")
            for key, value in client_data.items():
                if key == "zipcode":
                    setattr(db_report, f"client_zipcode", value)
                else:
                    setattr(db_report, f"client_{key}", value)
        
        if "property" in update_data:
            property_data = update_data.pop("property")
            for key, value in property_data.items():
                if key == "zipcode":
                    setattr(db_report, f"property_zipcode", value)
                else:
                    setattr(db_report, f"property_{key}", value)
        
        if "financial" in update_data:
            financial_data = update_data.pop("financial")
            for key, value in financial_data.items():
                setattr(db_report, key, value)
        
        # Handle arrays
        if "invoice_items" in update_data:
            db_report.invoice_items = [
                item.dict() if hasattr(item, 'dict') else item 
                for item in update_data.pop("invoice_items")
            ]
        
        if "materials_equipment_text" in update_data:
            db_report.materials_equipment_text = update_data.pop("materials_equipment_text")
        
        if "payments" in update_data:
            db_report.payments = [
                payment.dict() if hasattr(payment, 'dict') else payment 
                for payment in update_data.pop("payments")
            ]
        
        if "photos" in update_data:
            db_report.photos = [
                photo.dict() if hasattr(photo, 'dict') else photo 
                for photo in update_data.pop("photos")
            ]
        
        # Update remaining fields
        for field, value in update_data.items():
            setattr(db_report, field, value)
        
        # Recalculate financial summary
        report_dict = db_report.to_dict()
        financial = PlumberReportService.calculate_financial_summary(report_dict)
        
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
        """Delete a plumber report"""
        db_report = db.query(PlumberReport).filter(PlumberReport.id == report_id).first()
        
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
        """Get count of plumber reports"""
        query = db.query(PlumberReport)
        
        if status:
            query = query.filter(PlumberReport.status == status)
        
        if search:
            search_pattern = f"%{search}%"
            query = query.filter(
                (PlumberReport.report_number.ilike(search_pattern)) |
                (PlumberReport.client_name.ilike(search_pattern)) |
                (PlumberReport.property_address.ilike(search_pattern))
            )
        
        return query.count()