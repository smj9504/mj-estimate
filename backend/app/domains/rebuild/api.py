"""
Rebuild domain API endpoints.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from app.domains.rebuild.schemas import (
    RebuildCompletionDocCreate,
    RebuildCompletionDocResponse,
    RebuildCompletionDocUpdate,
    RebuildContractorCreate,
    RebuildContractorResponse,
    RebuildContractorUpdate,
    RebuildDashboardStats,
    RebuildProjectCreate,
    RebuildProjectResponse,
    RebuildProjectUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_service():
    from app.domains.rebuild.service import RebuildService
    return RebuildService()


# ============================================================
# Contractors
# ============================================================

@router.get("/rebuild/contractors", response_model=List[RebuildContractorResponse])
async def list_contractors():
    return _get_service().get_contractors()


@router.get("/rebuild/contractors/{contractor_id}", response_model=RebuildContractorResponse)
async def get_contractor(contractor_id: str):
    result = _get_service().get_contractor(contractor_id)
    if not result:
        raise HTTPException(status_code=404, detail="Contractor not found")
    return result


@router.post("/rebuild/contractors", response_model=RebuildContractorResponse)
async def create_contractor(data: RebuildContractorCreate):
    try:
        return _get_service().create_contractor(data.dict())
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/rebuild/contractors/{contractor_id}", response_model=RebuildContractorResponse)
async def update_contractor(contractor_id: str, data: RebuildContractorUpdate):
    result = _get_service().update_contractor(contractor_id, data.dict(exclude_unset=True))
    if not result:
        raise HTTPException(status_code=404, detail="Contractor not found")
    return result


@router.delete("/rebuild/contractors/{contractor_id}")
async def delete_contractor(contractor_id: str):
    if not _get_service().delete_contractor(contractor_id):
        raise HTTPException(status_code=404, detail="Contractor not found")
    return {"success": True}


# ============================================================
# Projects
# ============================================================

@router.get("/rebuild/projects", response_model=List[RebuildProjectResponse])
async def list_projects(
    status: Optional[str] = Query(None),
    contractor_id: Optional[str] = Query(None),
    claim_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    items, total = _get_service().get_projects({
        "status": status, "contractor_id": contractor_id,
        "claim_id": claim_id, "page": page, "page_size": page_size,
    })
    return items


@router.get("/rebuild/projects/stats", response_model=RebuildDashboardStats)
async def get_project_stats():
    return _get_service().get_dashboard_stats()


@router.get("/rebuild/projects/by-claim/{claim_id}", response_model=List[RebuildProjectResponse])
async def get_projects_by_claim(claim_id: str):
    return _get_service().get_projects_by_claim(claim_id)


@router.get("/rebuild/projects/{project_id}", response_model=RebuildProjectResponse)
async def get_project(project_id: str):
    result = _get_service().get_project(project_id)
    if not result:
        raise HTTPException(status_code=404, detail="Project not found")
    return result


@router.post("/rebuild/projects", response_model=RebuildProjectResponse)
async def create_project(data: RebuildProjectCreate):
    try:
        return _get_service().create_project(data.dict())
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/rebuild/projects/{project_id}", response_model=RebuildProjectResponse)
async def update_project(project_id: str, data: RebuildProjectUpdate):
    result = _get_service().update_project(project_id, data.dict(exclude_unset=True))
    if not result:
        raise HTTPException(status_code=404, detail="Project not found")
    return result


@router.delete("/rebuild/projects/{project_id}")
async def delete_project(project_id: str):
    if not _get_service().delete_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return {"success": True}


# ============================================================
# Completion Docs
# ============================================================

@router.get("/rebuild/projects/{project_id}/docs", response_model=List[RebuildCompletionDocResponse])
async def list_completion_docs(project_id: str):
    return _get_service().get_completion_docs(project_id)


@router.post("/rebuild/projects/{project_id}/docs", response_model=RebuildCompletionDocResponse)
async def create_completion_doc(project_id: str, data: RebuildCompletionDocCreate):
    doc_data = data.dict()
    doc_data['project_id'] = project_id
    try:
        return _get_service().create_completion_doc(doc_data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/rebuild/projects/{project_id}/docs/{doc_id}", response_model=RebuildCompletionDocResponse)
async def update_completion_doc(project_id: str, doc_id: str, data: RebuildCompletionDocUpdate):
    result = _get_service().update_completion_doc(doc_id, data.dict(exclude_unset=True))
    if not result:
        raise HTTPException(status_code=404, detail="Document not found")
    return result


@router.delete("/rebuild/projects/{project_id}/docs/{doc_id}")
async def delete_completion_doc(project_id: str, doc_id: str):
    if not _get_service().delete_completion_doc(doc_id):
        raise HTTPException(status_code=404, detail="Document not found")
    return {"success": True}
