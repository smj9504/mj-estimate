"""
Crew Upload API endpoints

Public endpoints (no auth required):
- GET  /api/crew-upload/{token}              - Validate link & get job info
- POST /api/crew-upload/{token}/session      - Create upload session
- GET  /api/crew-upload/{token}/session/{st}  - Get session status (resume)
- POST /api/crew-upload/{token}/files         - Upload a file

Admin endpoints (auth required):
- POST /api/crew-upload/admin/links           - Create upload link
- GET  /api/crew-upload/admin/links/{context}/{context_id} - List links for job
- PUT  /api/crew-upload/admin/links/{id}/deactivate - Deactivate link
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import select

from app.core.database_factory import get_db
from app.domains.auth.dependencies import get_current_staff

from .schemas import (
    FileUploadResponse,
    LinkInfoResponse,
    SessionCreateRequest,
    SessionCreateResponse,
    SessionStatusResponse,
    UploadLinkCreateRequest,
    UploadLinkListResponse,
    UploadLinkResponse,
)
from .service import CrewUploadService

logger = logging.getLogger(__name__)

# =====================================================
# Public Router (no authentication)
# =====================================================
public_router = APIRouter()


@public_router.get("/{token}", response_model=LinkInfoResponse)
def validate_upload_link(
    token: str,
    db=Depends(get_db),
):
    """Validate an upload link and return job info for the crew"""
    service = CrewUploadService(db)
    result = service.validate_link(token)

    if not result:
        return LinkInfoResponse(valid=False)

    return LinkInfoResponse(**result)


@public_router.post("/{token}/session", response_model=SessionCreateResponse)
def create_upload_session(
    token: str,
    request: SessionCreateRequest,
    req: Request = None,
    db=Depends(get_db),
):
    """Create an upload session for tracking progress and resume capability"""
    device_info = request.device_info
    if not device_info and req:
        device_info = req.headers.get("user-agent", "")[:500]

    service = CrewUploadService(db)
    session = service.create_session(
        token=token,
        total_files=request.total_files,
        device_info=device_info,
    )

    if not session:
        raise HTTPException(status_code=404, detail="Invalid or expired upload link")

    return SessionCreateResponse(
        session_token=session.session_token,
        session_id=str(session.id),
    )


@public_router.get("/{token}/session/{session_token}", response_model=SessionStatusResponse)
def get_session_status(
    token: str,
    session_token: str,
    db=Depends(get_db),
):
    """Get upload session status (for resume after interruption)"""
    service = CrewUploadService(db)

    # Validate the link first
    link_info = service.validate_link(token)
    if not link_info:
        raise HTTPException(status_code=404, detail="Invalid or expired upload link")

    session = service.get_session_status(session_token)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return SessionStatusResponse(
        session_token=session.session_token,
        total_files=session.total_files,
        completed_files=session.completed_files,
        failed_files=session.failed_files,
        completed_fingerprints=session.completed_fingerprints or [],
        status=session.status,
    )


@public_router.post("/{token}/files", response_model=FileUploadResponse)
def upload_file(
    token: str,
    file: UploadFile = File(...),
    session_token: str = Form(...),
    fingerprint: str = Form(...),
    latitude: Optional[float] = Form(None),
    longitude: Optional[float] = Form(None),
    captured_at: Optional[str] = Form(None),
    device_model: Optional[str] = Form(None),
    db=Depends(get_db),
):
    """Upload a single photo/video file"""
    # Validate content type
    if not file.content_type:
        raise HTTPException(status_code=400, detail="Content type required")

    allowed_prefixes = ('image/', 'video/')
    if not file.content_type.startswith(allowed_prefixes):
        raise HTTPException(status_code=400, detail="Only image and video files are allowed")

    # Parse captured_at
    from datetime import datetime
    parsed_captured_at = None
    if captured_at:
        try:
            parsed_captured_at = datetime.fromisoformat(captured_at.replace('Z', '+00:00'))
        except (ValueError, TypeError):
            pass

    service = CrewUploadService(db)
    result = service.upload_file(
        token=token,
        session_token=session_token,
        file_data=file.file,
        filename=file.filename or "unknown",
        content_type=file.content_type,
        file_size=file.size or 0,
        fingerprint=fingerprint,
        latitude=latitude,
        longitude=longitude,
        captured_at=parsed_captured_at,
        device_model=device_model,
    )

    if not result:
        raise HTTPException(status_code=404, detail="Invalid or expired upload link")

    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    return FileUploadResponse(**result)


def _resolve_company_id(db, context: str, context_id: str) -> Optional[str]:
    """Look up company_id from the job record when staff has no company."""
    try:
        if context == 'water-mitigation':
            from app.domains.water_mitigation.models import WaterMitigationJob
            result = db.execute(
                select(WaterMitigationJob.company_id)
                .where(WaterMitigationJob.id == context_id)
            )
            row = result.first()
            return str(row[0]) if row and row[0] else None
        elif context == 'work-order':
            from app.domains.work_order.models import WorkOrder
            result = db.execute(
                select(WorkOrder.company_id)
                .where(WorkOrder.id == context_id)
            )
            row = result.first()
            return str(row[0]) if row and row[0] else None
    except Exception:
        pass
    return None


# =====================================================
# Admin Router (authentication required)
# =====================================================
admin_router = APIRouter()


@admin_router.post("/links", response_model=UploadLinkResponse)
def create_upload_link(
    request: UploadLinkCreateRequest,
    current_staff=Depends(get_current_staff),
    db=Depends(get_db),
):
    """Create a new upload link for a job"""
    # Resolve company_id: from staff, or look up from the job
    company_id = getattr(current_staff, 'company_id', None)
    if company_id:
        company_id = str(company_id)
    else:
        company_id = _resolve_company_id(db, request.context, request.context_id)
        if not company_id:
            raise HTTPException(status_code=400, detail="Cannot determine company for this job")

    service = CrewUploadService(db)
    link = service.create_link(
        request=request,
        company_id=company_id,
        created_by_id=str(current_staff.id),
    )
    db.commit()

    return UploadLinkResponse(
        id=str(link.id),
        token=link.token,
        context=link.context,
        context_id=str(link.context_id),
        label=link.label,
        crew_name=link.crew_name,
        is_active=link.is_active,
        expires_at=link.expires_at,
        max_files=link.max_files,
        upload_count=link.upload_count,
        total_size_bytes=link.total_size_bytes,
        last_accessed_at=link.last_accessed_at,
        created_at=link.created_at,
    )


@admin_router.get("/links/{context}/{context_id}", response_model=UploadLinkListResponse)
def list_upload_links(
    context: str,
    context_id: str,
    current_staff=Depends(get_current_staff),
    db=Depends(get_db),
):
    """List all upload links for a specific job"""
    service = CrewUploadService(db)
    links = service.get_links_for_job(context, context_id)

    items = [
        UploadLinkResponse(
            id=str(link.id),
            token=link.token,
            context=link.context,
            context_id=str(link.context_id),
            label=link.label,
            crew_name=link.crew_name,
            is_active=link.is_active,
            expires_at=link.expires_at,
            max_files=link.max_files,
            upload_count=link.upload_count,
            total_size_bytes=link.total_size_bytes,
            last_accessed_at=link.last_accessed_at,
            created_at=link.created_at,
        )
        for link in links
    ]

    return UploadLinkListResponse(items=items, total=len(items))


@admin_router.put("/links/{link_id}/deactivate")
def deactivate_upload_link(
    link_id: str,
    current_staff=Depends(get_current_staff),
    db=Depends(get_db),
):
    """Deactivate an upload link"""
    service = CrewUploadService(db)
    service.deactivate_link(link_id)
    return {"message": "Link deactivated"}
