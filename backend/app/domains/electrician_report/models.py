"""
Electrician Inspection Report model for database
"""

from sqlalchemy import Column, String, Text, Float, Boolean, DateTime, JSON, Integer, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid

from app.core.database_factory import Base


class ElectricianReport(Base):
    """Electrician Inspection Report model"""
    __tablename__ = "electrician_reports"
    __table_args__ = (
        Index('ix_elc_report_number_version', 'report_number', 'version'),
        {'extend_existing': True}
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_number = Column(String, nullable=False, index=True)
    version = Column(Integer, default=1, nullable=False)
    is_latest = Column(Boolean, default=True, nullable=False)
    template_type = Column(String, default="standard")
    status = Column(String, default="draft")  # draft, final, sent

    # Company Information
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=True)
    company_data = Column(JSON)  # Store company info snapshot

    # Client Information
    client_name = Column(String, nullable=True)
    client_address = Column(String)
    client_city = Column(String)
    client_state = Column(String)
    client_zipcode = Column(String)
    client_phone = Column(String)
    client_email = Column(String)

    # Property Information
    property_address = Column(String)
    property_city = Column(String)
    property_state = Column(String)
    property_zipcode = Column(String)

    # Report Details
    service_date = Column(DateTime, nullable=False)
    technician_name = Column(String)
    license_number = Column(String)

    # Electrical-Specific Fields
    panel_type = Column(String)       # Main panel, Sub panel, etc.
    panel_location = Column(String)
    panel_amperage = Column(String)   # 100A, 200A, etc.
    system_voltage = Column(String)   # 120/240V, etc.
    meter_number = Column(String)
    building_type = Column(String)    # Residential, Commercial

    # Report Content (Rich Text)
    cause_of_damage = Column(Text)
    electrical_findings = Column(Text)   # Detailed inspection findings
    work_performed = Column(Text)
    materials_equipment_text = Column(Text)
    safety_concerns = Column(Text)       # Safety issues found
    code_violations = Column(Text)       # NEC code violations
    recommendations = Column(Text)

    # Checklist (JSON array of {section, items: [{label, status, note}]})
    inspection_checklist = Column(JSON)

    # Invoice Items
    invoice_items = Column(JSON)

    # Financial Information
    labor_cost = Column(Float, default=0)
    materials_cost = Column(Float, default=0)
    equipment_cost = Column(Float, default=0)
    subtotal = Column(Float, default=0)
    tax_amount = Column(Float, default=0)
    discount = Column(Float, default=0)
    total_amount = Column(Float, default=0)

    # Payments
    payments = Column(JSON)
    show_payment_dates = Column(Boolean, default=True)
    balance_due = Column(Float, default=0)

    # Photos
    photos = Column(JSON)

    # Additional Options
    warranty_info = Column(Text)
    terms_conditions = Column(Text)
    notes = Column(Text)

    # Metadata
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    created_by = Column(String)
    updated_by = Column(String)

    # Relationships
    company = relationship("Company", back_populates="electrician_reports")

    def to_dict(self, claim_id: str = None):
        """Convert model to dictionary"""
        return {
            "id": str(self.id),
            "report_number": self.report_number,
            "claim_id": claim_id,
            "template_type": self.template_type,
            "status": self.status,
            "company_id": str(self.company_id) if self.company_id else None,
            "company_data": self.company_data,
            "client": {
                "name": self.client_name,
                "address": self.client_address,
                "city": self.client_city,
                "state": self.client_state,
                "zipcode": self.client_zipcode,
                "phone": self.client_phone,
                "email": self.client_email
            },
            "property": {
                "address": self.property_address,
                "city": self.property_city,
                "state": self.property_state,
                "zipcode": self.property_zipcode
            },
            "service_date": self.service_date.isoformat() if self.service_date else None,
            "technician_name": self.technician_name,
            "license_number": self.license_number,
            # Electrical-specific
            "panel_type": self.panel_type,
            "panel_location": self.panel_location,
            "panel_amperage": self.panel_amperage,
            "system_voltage": self.system_voltage,
            "meter_number": self.meter_number,
            "building_type": self.building_type,
            # Content
            "cause_of_damage": self.cause_of_damage,
            "electrical_findings": self.electrical_findings,
            "work_performed": self.work_performed,
            "materials_equipment_text": self.materials_equipment_text,
            "safety_concerns": self.safety_concerns,
            "code_violations": self.code_violations,
            "recommendations": self.recommendations,
            "inspection_checklist": self.inspection_checklist or [],
            "invoice_items": self.invoice_items or [],
            "financial": {
                "labor_cost": self.labor_cost,
                "materials_cost": self.materials_cost,
                "equipment_cost": self.equipment_cost,
                "subtotal": self.subtotal,
                "tax_amount": self.tax_amount,
                "discount": self.discount,
                "total_amount": self.total_amount,
                "balance_due": self.balance_due
            },
            "payments": self.payments or [],
            "show_payment_dates": self.show_payment_dates,
            "photos": self.photos or [],
            "warranty_info": self.warranty_info,
            "terms_conditions": self.terms_conditions,
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "created_by": self.created_by,
            "updated_by": self.updated_by
        }
