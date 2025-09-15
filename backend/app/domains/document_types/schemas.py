"""
Document Types and Trades Pydantic schemas
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime
from decimal import Decimal
from uuid import UUID
from enum import Enum


class PricingRuleType(str, Enum):
    flat = "flat"
    tiered = "tiered"
    location_based = "location_based"
    addon = "addon"


class MeasurementReportProvider(str, Enum):
    eagleview = "eagleview"
    roofr = "roofr"
    hover = "hover"
    custom = "custom"


# Document Type schemas
class DocumentTypeBase(BaseModel):
    name: str
    code: str
    description: Optional[str] = None
    category: Optional[str] = None
    base_price: Decimal = Decimal("0.00")
    pricing_rules: Optional[Dict[str, Any]] = Field(default_factory=dict)
    requires_measurement_report: bool = False
    measurement_report_providers: Optional[List[str]] = Field(default_factory=list)
    template_name: Optional[str] = None
    required_fields: Optional[List[str]] = Field(default_factory=list)
    optional_fields: Optional[List[str]] = Field(default_factory=list)
    requires_approval: bool = False
    approval_levels: int = 1
    estimated_hours: Optional[Decimal] = None
    is_active: bool = True
    is_available_online: bool = True
    icon: Optional[str] = None
    color: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class DocumentTypeCreate(DocumentTypeBase):
    pass


class DocumentTypeUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    base_price: Optional[Decimal] = None
    pricing_rules: Optional[Dict[str, Any]] = None
    requires_measurement_report: Optional[bool] = None
    measurement_report_providers: Optional[List[str]] = None
    template_name: Optional[str] = None
    required_fields: Optional[List[str]] = None
    optional_fields: Optional[List[str]] = None
    requires_approval: Optional[bool] = None
    approval_levels: Optional[int] = None
    estimated_hours: Optional[Decimal] = None
    is_active: Optional[bool] = None
    is_available_online: Optional[bool] = None
    icon: Optional[str] = None
    color: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class DocumentTypeResponse(DocumentTypeBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None
    updated_by: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)


# Trade schemas
class TradeBase(BaseModel):
    name: str
    code: str
    description: Optional[str] = None
    category: Optional[str] = None
    requires_license: bool = False
    license_type: Optional[str] = None
    requires_insurance: bool = True
    insurance_minimum: Optional[Decimal] = None
    default_markup: Decimal = Decimal("0")
    default_hourly_rate: Optional[Decimal] = None
    required_skills: Optional[List[str]] = Field(default_factory=list)
    required_tools: Optional[List[str]] = Field(default_factory=list)
    is_active: bool = True
    icon: Optional[str] = None
    color: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class TradeCreate(TradeBase):
    pass


class TradeUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    requires_license: Optional[bool] = None
    license_type: Optional[str] = None
    requires_insurance: Optional[bool] = None
    insurance_minimum: Optional[Decimal] = None
    default_markup: Optional[Decimal] = None
    default_hourly_rate: Optional[Decimal] = None
    required_skills: Optional[List[str]] = None
    required_tools: Optional[List[str]] = None
    is_active: Optional[bool] = None
    icon: Optional[str] = None
    color: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class TradeResponse(TradeBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None
    updated_by: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)


# Measurement Report Type schemas
class MeasurementReportTypeBase(BaseModel):
    name: str
    provider: MeasurementReportProvider
    description: Optional[str] = None
    base_cost: Decimal = Decimal("0.00")
    markup_percent: Decimal = Decimal("0")
    fixed_markup: Decimal = Decimal("0")
    standard_turnaround_hours: int = 48
    rush_turnaround_hours: int = 24
    rush_fee: Decimal = Decimal("0")
    required_info: Optional[List[str]] = Field(default_factory=list)
    api_endpoint: Optional[str] = None
    is_active: bool = True
    is_automated: bool = False

    model_config = ConfigDict(from_attributes=True)


class MeasurementReportTypeCreate(MeasurementReportTypeBase):
    pass


class MeasurementReportTypeUpdate(BaseModel):
    name: Optional[str] = None
    provider: Optional[MeasurementReportProvider] = None
    description: Optional[str] = None
    base_cost: Optional[Decimal] = None
    markup_percent: Optional[Decimal] = None
    fixed_markup: Optional[Decimal] = None
    standard_turnaround_hours: Optional[int] = None
    rush_turnaround_hours: Optional[int] = None
    rush_fee: Optional[Decimal] = None
    required_info: Optional[List[str]] = None
    api_endpoint: Optional[str] = None
    is_active: Optional[bool] = None
    is_automated: Optional[bool] = None

    model_config = ConfigDict(from_attributes=True)


class MeasurementReportTypeResponse(MeasurementReportTypeBase):
    id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Price calculation schemas
class PriceCalculationParams(BaseModel):
    locations: Optional[int] = 1
    selected_addons: Optional[List[str]] = Field(default_factory=list)
    quantity: Optional[int] = 1
    rush: Optional[bool] = False

    model_config = ConfigDict(from_attributes=True)


class PriceCalculationResponse(BaseModel):
    base_price: Decimal
    adjustments: List[Dict[str, Any]]
    final_price: Decimal
    parameters: Dict[str, Any]

    model_config = ConfigDict(from_attributes=True)