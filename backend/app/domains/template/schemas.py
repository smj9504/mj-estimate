from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from datetime import datetime
from enum import Enum


class TemplateType(str, Enum):
    WARRANTY = "warranty"
    TERMS = "terms"
    NOTES = "notes"


class TemplateCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    type: TemplateType
    content: str = Field(..., min_length=1)
    description: Optional[str] = None


class TemplateUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    content: Optional[str] = Field(None, min_length=1)
    description: Optional[str] = None
    is_active: Optional[bool] = None


class TemplateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: str
    name: str
    type: TemplateType
    content: str
    description: Optional[str] = None
    is_active: bool
    usage_count: int
    created_at: datetime
    updated_at: datetime


class TemplateListResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    type: TemplateType
    description: Optional[str] = None
    usage_count: int
    updated_at: datetime


class TemplateUsageCreate(BaseModel):
    template_id: str
    report_id: Optional[str] = None


class TemplateSearchFilters(BaseModel):
    type: Optional[TemplateType] = None
    search: Optional[str] = None
    is_active: Optional[bool] = True
    sort_by: Optional[str] = "name"  # name, created_at, usage_count
    sort_order: Optional[str] = "asc"  # asc, desc


class TemplateContentResponse(BaseModel):
    content: str
    template_id: str
    template_name: str