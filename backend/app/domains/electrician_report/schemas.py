"""
Pydantic schemas for Electrician Inspection Report
"""

from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field
from uuid import UUID


class ClientInfo(BaseModel):
    """Client information schema"""
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zipcode: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None


class PropertyInfo(BaseModel):
    """Property information schema"""
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zipcode: Optional[str] = None


class InvoiceItem(BaseModel):
    """Invoice item schema"""
    name: str
    description: Optional[str] = None
    quantity: float = 0
    unit: Optional[str] = None
    unit_cost: float = 0
    total_cost: float = 0


class PaymentRecord(BaseModel):
    """Payment record schema"""
    amount: float
    date: Optional[str] = None
    method: Optional[str] = None
    reference: Optional[str] = None
    notes: Optional[str] = None


class PhotoRecord(BaseModel):
    """Photo record schema"""
    id: str
    url: str
    category: str = Field(..., description="before, during, after, damage, panel, wiring, other")
    caption: Optional[str] = None
    timestamp: Optional[datetime] = None


class ChecklistItem(BaseModel):
    """Single checklist item — risk codes per EICR standards"""
    label: str
    # OK | C1 (danger) | C2 (potentially dangerous)
    # C3 (improvement) | FI (further investigation) | N/A
    status: str = "OK"
    note: Optional[str] = None


class ChecklistSection(BaseModel):
    """Checklist section with multiple items"""
    title: str
    items: List[ChecklistItem] = []


class CircuitTestResult(BaseModel):
    """Circuit-level test result (EICR Schedule)"""
    circuit_id: str = ""
    circuit_description: str = ""
    protective_device: str = ""
    conductor_size: str = ""
    insulation_resistance: Optional[str] = None
    continuity: Optional[str] = None
    rcd_trip_time: Optional[str] = None
    gfci_test: Optional[str] = None
    status: str = "FI"
    notes: Optional[str] = None


class FinancialSummary(BaseModel):
    """Financial summary schema"""
    labor_cost: float = 0
    materials_cost: float = 0
    equipment_cost: float = 0
    subtotal: float = 0
    tax_amount: float = 0
    discount: float = 0
    total_amount: float = 0
    balance_due: float = 0


class ElectricianReportBase(BaseModel):
    """Base schema for Electrician Report"""
    report_number: Optional[str] = None
    template_type: str = "standard"
    status: str = "draft"

    # Client and Property
    client: ClientInfo
    property: PropertyInfo

    # Service Details
    service_date: datetime
    technician_name: Optional[str] = None
    license_number: Optional[str] = None

    # Electrical-Specific
    panel_type: Optional[str] = None
    panel_location: Optional[str] = None
    panel_amperage: Optional[str] = None
    system_voltage: Optional[str] = None
    meter_number: Optional[str] = None
    building_type: Optional[str] = None

    # Report Content
    cause_of_damage: Optional[str] = None
    electrical_findings: Optional[str] = None
    work_performed: Optional[str] = None
    materials_equipment_text: Optional[str] = None
    safety_concerns: Optional[str] = None
    code_violations: Optional[str] = None
    recommendations: Optional[str] = None

    # Earthing
    earthing_type: Optional[str] = None

    # Report scope (EICR Section B)
    purpose_of_report: Optional[str] = None
    extent_and_limitations: Optional[str] = None

    # Overall Assessment (EICR Section E)
    overall_assessment: Optional[str] = None
    next_inspection_date: Optional[str] = None

    # Additional Information
    warranty_info: Optional[str] = None
    terms_conditions: Optional[str] = None
    notes: Optional[str] = None


class ElectricianReportCreate(ElectricianReportBase):
    """Schema for creating an Electrician Report"""
    company_id: Optional[UUID] = None
    claim_id: Optional[str] = None
    inspection_checklist: List[ChecklistSection] = []
    circuit_test_results: List[CircuitTestResult] = []
    invoice_items: List[InvoiceItem] = []
    payments: List[PaymentRecord] = []
    show_payment_dates: bool = True
    photos: List[PhotoRecord] = []
    financial: Optional[FinancialSummary] = None


class ElectricianReportUpdate(BaseModel):
    """Schema for updating an Electrician Report"""
    report_number: Optional[str] = None
    template_type: Optional[str] = None
    status: Optional[str] = None
    claim_id: Optional[str] = None

    client: Optional[ClientInfo] = None
    property: Optional[PropertyInfo] = None

    service_date: Optional[datetime] = None
    technician_name: Optional[str] = None
    license_number: Optional[str] = None

    panel_type: Optional[str] = None
    panel_location: Optional[str] = None
    panel_amperage: Optional[str] = None
    system_voltage: Optional[str] = None
    meter_number: Optional[str] = None
    building_type: Optional[str] = None

    cause_of_damage: Optional[str] = None
    electrical_findings: Optional[str] = None
    work_performed: Optional[str] = None
    materials_equipment_text: Optional[str] = None
    safety_concerns: Optional[str] = None
    code_violations: Optional[str] = None
    recommendations: Optional[str] = None

    earthing_type: Optional[str] = None
    purpose_of_report: Optional[str] = None
    extent_and_limitations: Optional[str] = None
    overall_assessment: Optional[str] = None
    next_inspection_date: Optional[str] = None

    inspection_checklist: Optional[List[ChecklistSection]] = None
    circuit_test_results: Optional[List[CircuitTestResult]] = None
    invoice_items: Optional[List[InvoiceItem]] = None
    payments: Optional[List[PaymentRecord]] = None
    show_payment_dates: Optional[bool] = None
    photos: Optional[List[PhotoRecord]] = None
    financial: Optional[FinancialSummary] = None

    warranty_info: Optional[str] = None
    terms_conditions: Optional[str] = None
    notes: Optional[str] = None


class ElectricianReportResponse(ElectricianReportBase):
    """Schema for Electrician Report response"""
    id: UUID
    company_id: Optional[UUID] = None
    company_data: Optional[Dict[str, Any]] = None
    claim_id: Optional[str] = None

    inspection_checklist: List[ChecklistSection] = []
    circuit_test_results: List[CircuitTestResult] = []
    invoice_items: List[InvoiceItem] = []
    payments: List[PaymentRecord] = []
    show_payment_dates: bool = True
    photos: List[PhotoRecord] = []
    financial: FinancialSummary

    created_at: datetime
    updated_at: Optional[datetime] = None
    created_by: Optional[str] = None
    updated_by: Optional[str] = None

    class Config:
        from_attributes = True


class ElectricianReportListResponse(BaseModel):
    """Schema for list of Electrician Reports"""
    reports: List[ElectricianReportResponse]
    total: int
    page: int
    limit: int


class ElectricianReportNumberResponse(BaseModel):
    """Schema for report number generation response"""
    report_number: str


class ElectricianReportPreviewData(ElectricianReportCreate):
    """Schema for PDF preview - does not require id or created_at"""
    company_data: Optional[Dict[str, Any]] = None


class ElectricianReportPDFRequest(BaseModel):
    """Schema for PDF generation request"""
    report_data: ElectricianReportPreviewData
    include_photos: bool = True
    include_financial: bool = True
    page_size: str = "letter"
    orientation: str = "portrait"
