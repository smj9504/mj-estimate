"""
Xactimate Cheat Sheet - Pydantic Schemas
"""

from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ─── Section ─────────────────────────────────────────────────────────────────

class SectionBase(BaseModel):
    section_key: str
    title: str
    tag: str
    tag_color: str = "#1a1a1a"
    nav_group: str
    nav_dot_color: str = "#4f8ef7"
    sort_order: int = 0
    is_active: bool = True


class SectionCreate(SectionBase):
    pass


class SectionUpdate(BaseModel):
    title: Optional[str] = None
    tag: Optional[str] = None
    tag_color: Optional[str] = None
    nav_group: Optional[str] = None
    nav_dot_color: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class RuleResponse(BaseModel):
    id: str
    section_id: str
    rule_type: str
    title: str
    items: List[str]
    sort_order: int

    class Config:
        from_attributes = True


class RowResponse(BaseModel):
    id: str
    table_id: str
    row_key: str
    data: Dict[str, Any]
    note: Optional[str] = None
    sort_order: int

    class Config:
        from_attributes = True


class TableResponse(BaseModel):
    id: str
    section_id: str
    columns: List[Dict[str, Any]]
    sort_order: int
    rows: List[RowResponse] = []

    class Config:
        from_attributes = True


class SectionResponse(SectionBase):
    id: str
    rules: List[RuleResponse] = []
    tables: List[TableResponse] = []

    class Config:
        from_attributes = True


class SectionListResponse(BaseModel):
    id: str
    section_key: str
    title: str
    tag: str
    tag_color: str
    nav_group: str
    nav_dot_color: str
    sort_order: int
    is_active: bool

    class Config:
        from_attributes = True


# ─── Rule ────────────────────────────────────────────────────────────────────

class RuleCreate(BaseModel):
    section_id: str
    rule_type: str = "info"
    title: str
    items: List[str] = []
    sort_order: int = 0


class RuleUpdate(BaseModel):
    rule_type: Optional[str] = None
    title: Optional[str] = None
    items: Optional[List[str]] = None
    sort_order: Optional[int] = None


# ─── Table ───────────────────────────────────────────────────────────────────

class TableCreate(BaseModel):
    section_id: str
    columns: List[Dict[str, Any]]
    sort_order: int = 0


class TableUpdate(BaseModel):
    columns: Optional[List[Dict[str, Any]]] = None
    sort_order: Optional[int] = None


# ─── Row ─────────────────────────────────────────────────────────────────────

class RowCreate(BaseModel):
    table_id: str
    row_key: str
    data: Dict[str, Any]
    note: Optional[str] = None
    sort_order: int = 0


class RowUpdate(BaseModel):
    data: Optional[Dict[str, Any]] = None
    note: Optional[str] = None
    sort_order: Optional[int] = None


class RowNoteUpdate(BaseModel):
    note: Optional[str] = None
