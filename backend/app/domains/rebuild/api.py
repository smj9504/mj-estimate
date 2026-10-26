"""
Rebuild domain API endpoints.
"""

import json
import logging
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form

from app.core.database_factory import get_db_session as get_db
from app.domains.auth.company_scope import (
    claim_condition,
    require_claim,
    require_document,
    sees_everything,
)
from app.domains.auth.dependencies import get_current_staff
from app.domains.rebuild.models import RebuildCompletionDoc, RebuildProject
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


def _require_project(db, staff, project_id) -> None:
    """404 unless the project is on a claim the staff member may see"""
    require_document(db, staff, RebuildProject, project_id, "Project", company_attr=None)


def _require_doc(db, staff, doc_id) -> None:
    """404 unless the completion doc's own project (not the one in the URL)
    is on a claim the staff member may see"""
    if sees_everything(staff):
        return
    try:
        doc_id = str(uuid.UUID(str(doc_id)))
    except ValueError:
        raise HTTPException(status_code=404, detail="Document not found")
    row = db.query(RebuildCompletionDoc.project_id).filter(RebuildCompletionDoc.id == doc_id).first()
    require_document(db, staff, RebuildProject, row[0] if row else None, "Document", company_attr=None)


# ============================================================
# Contractors (a directory, not tied to a claim)
# ============================================================

@router.get("/rebuild/contractors", response_model=List[RebuildContractorResponse])
def list_contractors(current_staff=Depends(get_current_staff)):
    return _get_service().get_contractors()


@router.get("/rebuild/contractors/{contractor_id}", response_model=RebuildContractorResponse)
def get_contractor(contractor_id: str, current_staff=Depends(get_current_staff)):
    result = _get_service().get_contractor(contractor_id)
    if not result:
        raise HTTPException(status_code=404, detail="Contractor not found")
    return result


@router.post("/rebuild/contractors", response_model=RebuildContractorResponse)
def create_contractor(data: RebuildContractorCreate, current_staff=Depends(get_current_staff)):
    try:
        return _get_service().create_contractor(data.dict())
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/rebuild/contractors/{contractor_id}", response_model=RebuildContractorResponse)
def update_contractor(
    contractor_id: str,
    data: RebuildContractorUpdate,
    current_staff=Depends(get_current_staff),
):
    result = _get_service().update_contractor(contractor_id, data.dict(exclude_unset=True))
    if not result:
        raise HTTPException(status_code=404, detail="Contractor not found")
    return result


@router.delete("/rebuild/contractors/{contractor_id}")
def delete_contractor(contractor_id: str, current_staff=Depends(get_current_staff)):
    if not _get_service().delete_contractor(contractor_id):
        raise HTTPException(status_code=404, detail="Contractor not found")
    return {"success": True}


# ============================================================
# Projects
# ============================================================

@router.get("/rebuild/projects", response_model=List[RebuildProjectResponse])
def list_projects(
    status: Optional[str] = Query(None),
    contractor_id: Optional[str] = Query(None),
    claim_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db=Depends(get_db),
    current_staff=Depends(get_current_staff),
):
    items, total = _get_service().get_projects({
        "status": status, "contractor_id": contractor_id,
        "claim_id": claim_id, "page": page, "page_size": page_size,
    }, scope=claim_condition(db, current_staff, RebuildProject.claim_id))
    return items


@router.get("/rebuild/projects/stats", response_model=RebuildDashboardStats)
def get_project_stats(db=Depends(get_db), current_staff=Depends(get_current_staff)):
    return _get_service().get_dashboard_stats(
        claim_condition(db, current_staff, RebuildProject.claim_id)
    )


@router.get("/rebuild/projects/by-claim/{claim_id}", response_model=List[RebuildProjectResponse])
def get_projects_by_claim(claim_id: str, db=Depends(get_db), current_staff=Depends(get_current_staff)):
    require_claim(db, current_staff, claim_id)
    return _get_service().get_projects_by_claim(claim_id)


@router.get("/rebuild/projects/{project_id}", response_model=RebuildProjectResponse)
def get_project(project_id: str, db=Depends(get_db), current_staff=Depends(get_current_staff)):
    _require_project(db, current_staff, project_id)
    result = _get_service().get_project(project_id)
    if not result:
        raise HTTPException(status_code=404, detail="Project not found")
    return result


@router.post("/rebuild/projects", response_model=RebuildProjectResponse)
def create_project(
    data: RebuildProjectCreate,
    db=Depends(get_db),
    current_staff=Depends(get_current_staff),
):
    require_claim(db, current_staff, data.claim_id)
    try:
        return _get_service().create_project(data.dict())
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/rebuild/projects/{project_id}", response_model=RebuildProjectResponse)
def update_project(
    project_id: str,
    data: RebuildProjectUpdate,
    db=Depends(get_db),
    current_staff=Depends(get_current_staff),
):
    _require_project(db, current_staff, project_id)
    result = _get_service().update_project(project_id, data.dict(exclude_unset=True))
    if not result:
        raise HTTPException(status_code=404, detail="Project not found")
    return result


@router.delete("/rebuild/projects/{project_id}")
def delete_project(project_id: str, db=Depends(get_db), current_staff=Depends(get_current_staff)):
    _require_project(db, current_staff, project_id)
    if not _get_service().delete_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return {"success": True}


# ============================================================
# Completion Docs
# ============================================================

@router.get("/rebuild/projects/{project_id}/docs", response_model=List[RebuildCompletionDocResponse])
def list_completion_docs(project_id: str, db=Depends(get_db), current_staff=Depends(get_current_staff)):
    _require_project(db, current_staff, project_id)
    return _get_service().get_completion_docs(project_id)


@router.post("/rebuild/projects/{project_id}/docs", response_model=RebuildCompletionDocResponse)
def create_completion_doc(
    project_id: str,
    data: RebuildCompletionDocCreate,
    db=Depends(get_db),
    current_staff=Depends(get_current_staff),
):
    _require_project(db, current_staff, project_id)
    doc_data = data.dict()
    doc_data['project_id'] = project_id
    try:
        return _get_service().create_completion_doc(doc_data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/rebuild/projects/{project_id}/docs/{doc_id}", response_model=RebuildCompletionDocResponse)
def update_completion_doc(
    project_id: str,
    doc_id: str,
    data: RebuildCompletionDocUpdate,
    db=Depends(get_db),
    current_staff=Depends(get_current_staff),
):
    _require_doc(db, current_staff, doc_id)
    result = _get_service().update_completion_doc(doc_id, data.dict(exclude_unset=True))
    if not result:
        raise HTTPException(status_code=404, detail="Document not found")
    return result


@router.delete("/rebuild/projects/{project_id}/docs/{doc_id}")
def delete_completion_doc(
    project_id: str,
    doc_id: str,
    db=Depends(get_db),
    current_staff=Depends(get_current_staff),
):
    _require_doc(db, current_staff, doc_id)
    if not _get_service().delete_completion_doc(doc_id):
        raise HTTPException(status_code=404, detail="Document not found")
    return {"success": True}


# ============================================================
# Document Generation
# ============================================================

@router.get("/rebuild/projects/{project_id}/available-templates")
def get_available_templates(project_id: str, db=Depends(get_db), current_staff=Depends(get_current_staff)):
    """Get contract templates for the project's contractor."""
    _require_project(db, current_staff, project_id)
    return _get_service().get_available_templates(project_id)


@router.get("/rebuild/projects/{project_id}/prefill-data")
def get_prefill_data(project_id: str, db=Depends(get_db), current_staff=Depends(get_current_staff)):
    """Get prefill data for document generation."""
    _require_project(db, current_staff, project_id)
    return _get_service().get_prefill_data(project_id)


@router.post("/rebuild/projects/{project_id}/generate-doc", response_model=RebuildCompletionDocResponse)
def generate_document(
    project_id: str,
    data: Dict[str, Any],
    db=Depends(get_db),
    current_staff=Depends(get_current_staff),
):
    """Generate a filled PDF from a contract template."""
    _require_project(db, current_staff, project_id)
    try:
        return _get_service().generate_document(project_id, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Document generation error for rebuild project {project_id}")
        raise HTTPException(status_code=500, detail=f"Failed to generate document: {e}")


@router.post("/rebuild/projects/{project_id}/photos-to-pdf", response_model=RebuildCompletionDocResponse)
async def photos_to_pdf(
    project_id: str,
    photos: List[UploadFile] = File(...),
    rotations: str = Form(default="{}"),
    doc_type: str = Form(default="completion_photo"),
    title: str = Form(default="Completion Photos"),
    db=Depends(get_db),
    current_staff=Depends(get_current_staff),
):
    """Convert uploaded photos to a multi-page PDF."""
    _require_project(db, current_staff, project_id)
    try:
        rotation_map = json.loads(rotations)
        rotation_map = {int(k): int(v) for k, v in rotation_map.items()}
    except (json.JSONDecodeError, ValueError):
        rotation_map = {}

    photo_list = []
    for photo in photos:
        content = await photo.read()
        photo_list.append((photo.filename or "photo.jpg", content))

    try:
        return _get_service().photos_to_pdf(project_id, photo_list, rotation_map, doc_type, title)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Photos to PDF error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create PDF from photos")


# ============================================================
# Document PDF Serve (cloud storage support)
# ============================================================

@router.get("/rebuild/projects/{project_id}/docs/{doc_id}/pdf")
def serve_completion_doc_pdf(project_id: str, doc_id: str):
    """Serve completion doc PDF from cloud or local storage.

    No staff check: the frontend opens this URL directly (no auth header).
    """
    from pathlib import Path
    from starlette.responses import Response

    service = _get_service()
    docs = service.get_completion_docs(project_id)
    doc = next((d for d in docs if str(d.get('id')) == doc_id), None)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    file_url = doc.get('file_url', '')
    if not file_url:
        raise HTTPException(status_code=404, detail="No PDF file")

    # Try cloud storage
    if not file_url.startswith('/uploads/'):
        try:
            from app.domains.storage.factory import StorageFactory
            storage = StorageFactory.get_instance()
            pdf_bytes = storage.download(file_url)
            return Response(
                content=pdf_bytes,
                media_type="application/pdf",
                headers={"Content-Disposition": f'inline; filename="{doc.get("file_name", "document.pdf")}"'}
            )
        except Exception:
            pass

    # Fallback to local
    backend_dir = Path(__file__).resolve().parents[3]
    local_path = backend_dir / file_url.lstrip('/')
    if local_path.exists():
        from starlette.responses import FileResponse
        return FileResponse(path=str(local_path), media_type="application/pdf")

    raise HTTPException(status_code=404, detail="PDF file not found")
