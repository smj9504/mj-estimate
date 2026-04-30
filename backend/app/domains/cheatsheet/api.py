"""
Xactimate Cheat Sheet - REST API Endpoints

Mounted at /api/cheatsheet prefix.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query

from .schemas import (
    RowCreate,
    RowNoteUpdate,
    RowUpdate,
    RuleCreate,
    RuleUpdate,
    SectionCreate,
    SectionUpdate,
    TableCreate,
    TableUpdate,
)
from .service import CheatsheetService

logger = logging.getLogger(__name__)
router = APIRouter()

_svc = None


def _get_svc() -> CheatsheetService:
    global _svc
    if _svc is None:
        _svc = CheatsheetService()
    return _svc


# ─── Sections ────────────────────────────────────────────────────────────────


@router.get("/sections")
def list_sections(active_only: bool = Query(True)):
    """Get all sections with rules, tables, and rows."""
    return _get_svc().get_all_sections(active_only=active_only)


@router.get("/sections/{section_id}")
def get_section(section_id: UUID):
    result = _get_svc().get_section(section_id)
    if not result:
        raise HTTPException(status_code=404, detail="Section not found")
    return result


@router.post("/sections", status_code=201)
def create_section(body: SectionCreate):
    return _get_svc().create_section(body.model_dump())


@router.put("/sections/{section_id}")
def update_section(section_id: UUID, body: SectionUpdate):
    data = body.model_dump(exclude_none=True)
    result = _get_svc().update_section(section_id, data)
    if not result:
        raise HTTPException(status_code=404, detail="Section not found")
    return result


@router.delete("/sections/{section_id}", status_code=204)
def delete_section(section_id: UUID):
    if not _get_svc().delete_section(section_id):
        raise HTTPException(status_code=404, detail="Section not found")


# ─── Rules ───────────────────────────────────────────────────────────────────


@router.post("/rules", status_code=201)
def create_rule(body: RuleCreate):
    return _get_svc().create_rule(body.model_dump())


@router.put("/rules/{rule_id}")
def update_rule(rule_id: UUID, body: RuleUpdate):
    data = body.model_dump(exclude_none=True)
    result = _get_svc().update_rule(rule_id, data)
    if not result:
        raise HTTPException(status_code=404, detail="Rule not found")
    return result


@router.delete("/rules/{rule_id}", status_code=204)
def delete_rule(rule_id: UUID):
    if not _get_svc().delete_rule(rule_id):
        raise HTTPException(status_code=404, detail="Rule not found")


# ─── Tables ──────────────────────────────────────────────────────────────────


@router.post("/tables", status_code=201)
def create_table(body: TableCreate):
    return _get_svc().create_table(body.model_dump())


@router.put("/tables/{table_id}")
def update_table(table_id: UUID, body: TableUpdate):
    data = body.model_dump(exclude_none=True)
    result = _get_svc().update_table(table_id, data)
    if not result:
        raise HTTPException(status_code=404, detail="Table not found")
    return result


@router.delete("/tables/{table_id}", status_code=204)
def delete_table(table_id: UUID):
    if not _get_svc().delete_table(table_id):
        raise HTTPException(status_code=404, detail="Table not found")


# ─── Rows ────────────────────────────────────────────────────────────────────


@router.post("/rows", status_code=201)
def create_row(body: RowCreate):
    return _get_svc().create_row(body.model_dump())


@router.put("/rows/{row_id}")
def update_row(row_id: UUID, body: RowUpdate):
    data = body.model_dump(exclude_none=True)
    result = _get_svc().update_row(row_id, data)
    if not result:
        raise HTTPException(status_code=404, detail="Row not found")
    return result


@router.patch("/rows/{row_id}/note")
def update_row_note(row_id: UUID, body: RowNoteUpdate):
    """Update only the note field of a row."""
    result = _get_svc().update_row_note(row_id, body.note)
    if not result:
        raise HTTPException(status_code=404, detail="Row not found")
    return result


@router.delete("/rows/{row_id}", status_code=204)
def delete_row(row_id: UUID):
    if not _get_svc().delete_row(row_id):
        raise HTTPException(status_code=404, detail="Row not found")
