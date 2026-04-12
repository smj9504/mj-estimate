"""
Water Mitigation Sketch API.

REST endpoints for floor sketches and overlay management.
Router is registered in main.py with prefix="/api/water-mitigation/sketch".
"""

import io
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database_factory import get_db
from app.domains.auth.dependencies import get_current_user
from app.domains.staff.models import Staff
from app.domains.storage.factory import StorageFactory
from app.domains.water_mitigation.sketch_models import (
    WMContainmentZone,
    WMDemolitionZone,
    WMEquipmentPlacement,
    WMFloorProtection,
    WMFloorSketch,
)
from app.domains.water_mitigation.sketch_schemas import (
    GenerateScopeRequest,
    GenerateScopeResponse,
    WMBackgroundImageResponse,
    WMContainmentZoneSchema,
    WMContentProtectionSchema,
    WMDemolitionZoneSchema,
    WMEquipmentPlacementSchema,
    WMFloorProtectionSchema,
    WMFloorSketchCreate,
    WMFloorSketchDetailResponse,
    WMFloorSketchListResponse,
    WMFloorSketchResponse,
    WMFloorSketchUpdate,
    WMOverlayData,
)
from app.domains.water_mitigation.sketch_service import SketchService
from app.domains.water_mitigation.sketch_pdf_service import SketchPdfService

router = APIRouter(tags=["WM Sketches"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_detail_response(sketch: WMFloorSketch) -> WMFloorSketchDetailResponse:
    """Convert a WMFloorSketch ORM object to WMFloorSketchDetailResponse."""
    return WMFloorSketchDetailResponse(
        id=sketch.id,
        job_id=sketch.job_id,
        floor_label=sketch.floor_label,
        floor_order=sketch.floor_order,
        address_display=sketch.address_display,
        source_type=sketch.source_type,
        sketch_id=sketch.sketch_id,
        background_image_url=sketch.background_image_url,
        canvas_width=sketch.canvas_width,
        canvas_height=sketch.canvas_height,
        scale_pixels_per_foot=sketch.scale_pixels_per_foot,
        notes=sketch.notes,
        demolition_zones=[
            WMDemolitionZoneSchema.from_orm(z)
            for z in (sketch.demolition_zones or [])
        ],
        equipment_placements=[
            WMEquipmentPlacementSchema.from_orm(e)
            for e in (sketch.equipment_placements or [])
        ],
        containment_zones=[
            WMContainmentZoneSchema.from_orm(c)
            for c in (sketch.containment_zones or [])
        ],
        floor_protections=[
            WMFloorProtectionSchema.from_orm(p)
            for p in (sketch.floor_protections or [])
        ],
    )


# ---------------------------------------------------------------------------
# Floor Sketch Endpoints
# ---------------------------------------------------------------------------

@router.get(
    "/jobs/{job_id}/floors",
    response_model=WMFloorSketchListResponse,
    summary="List all floor sketches for a job",
)
def get_floor_sketches(
    job_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """Return all floor sketches for a job ordered by floor_order.

    Builds overlay_data from child tables (authoritative) rather than
    the JSONB snapshot, which may be missing fields added after the
    sketch was last saved (e.g. include_pad, include_insulation).
    """
    service = SketchService(db)
    sketches = service.get_floor_sketches(job_id)

    from decimal import Decimal as Dec

    def _to_json(obj):
        """Recursively convert Decimal → float for JSON safety."""
        if isinstance(obj, dict):
            return {k: _to_json(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [_to_json(i) for i in obj]
        if isinstance(obj, Dec):
            return float(obj)
        return obj

    items = []
    for s in sketches:
        resp = WMFloorSketchResponse.from_orm(s)
        # Override JSONB snapshot with authoritative child-table data
        resp.overlay_data = _to_json({
            "demolition_zones": [
                WMDemolitionZoneSchema.from_orm(z).dict()
                for z in (s.demolition_zones or [])
            ],
            "equipment_placements": [
                WMEquipmentPlacementSchema.from_orm(e).dict()
                for e in (s.equipment_placements or [])
            ],
            "containment_zones": [
                WMContainmentZoneSchema.from_orm(c).dict()
                for c in (s.containment_zones or [])
            ],
            "floor_protections": [
                WMFloorProtectionSchema.from_orm(p).dict()
                for p in (s.floor_protections or [])
            ],
            "content_protections": [
                WMContentProtectionSchema.from_orm(cp).dict()
                for cp in (s.content_protections or [])
            ],
        })
        items.append(resp)

    return WMFloorSketchListResponse(items=items, total=len(items))


@router.post(
    "/jobs/{job_id}/floors",
    response_model=WMFloorSketchDetailResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new floor sketch for a job",
)
def create_floor_sketch(
    job_id: UUID,
    data: WMFloorSketchCreate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """Create a new floor sketch canvas for the given job."""
    service = SketchService(db)
    sketch = service.create_floor_sketch(job_id, data)
    db.commit()
    db.expire_all()
    sketch = service.get_floor_sketch(sketch.id)
    return _build_detail_response(sketch)


@router.get(
    "/floors/{floor_sketch_id}",
    response_model=WMFloorSketchDetailResponse,
    summary="Get a floor sketch with all overlay elements",
)
def get_floor_sketch(
    floor_sketch_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """Return a single floor sketch with all child overlay rows."""
    service = SketchService(db)
    sketch = service.get_floor_sketch(floor_sketch_id)
    if not sketch:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Floor sketch not found",
        )
    return _build_detail_response(sketch)


@router.put(
    "/floors/{floor_sketch_id}",
    response_model=WMFloorSketchDetailResponse,
    summary="Update floor sketch metadata",
)
def update_floor_sketch(
    floor_sketch_id: UUID,
    data: WMFloorSketchUpdate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """Update metadata fields (label, dimensions, notes, etc.) on a floor sketch."""
    service = SketchService(db)
    try:
        sketch = service.update_floor_sketch(floor_sketch_id, data)
        db.commit()
        db.expire_all()
        sketch = service.get_floor_sketch(floor_sketch_id)
        return _build_detail_response(sketch)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )


@router.delete(
    "/floors/{floor_sketch_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a floor sketch and all its overlays",
)
def delete_floor_sketch(
    floor_sketch_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """Delete a floor sketch. All child overlay rows are removed via cascade."""
    service = SketchService(db)
    try:
        service.delete_floor_sketch(floor_sketch_id)
        db.commit()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )


# ---------------------------------------------------------------------------
# Overlay Data Endpoint
# ---------------------------------------------------------------------------

@router.put(
    "/floors/{floor_sketch_id}/overlay",
    response_model=WMFloorSketchDetailResponse,
    summary="Replace all overlay elements on a floor sketch",
)
def save_overlay_data(
    floor_sketch_id: UUID,
    overlay_data: WMOverlayData,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """
    Atomically replace all overlay elements for a floor sketch.

    All existing demolition zones, equipment placements, containment zones,
    and floor protection strips for this sketch are deleted and recreated
    from the provided payload in a single transaction.
    """
    import logging
    logger = logging.getLogger(__name__)
    service = SketchService(db)
    try:
        sketch = service.save_overlay_data(floor_sketch_id, overlay_data)
        db.commit()
        db.expire_all()
        sketch = service.get_floor_sketch(floor_sketch_id)
        return _build_detail_response(sketch)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    except Exception as exc:
        logger.exception("Error saving overlay data for floor sketch %s", floor_sketch_id)
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Error saving overlay data: {str(exc)}",
        )


# ---------------------------------------------------------------------------
# Background Image Endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/floors/{floor_sketch_id}/background-image",
    response_model=WMBackgroundImageResponse,
    summary="Upload a background image for a floor sketch",
)
async def upload_background_image(
    floor_sketch_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """
    Upload a background image (floor plan, photo, etc.) for a floor sketch.

    The file is stored via the configured StorageFactory provider and the
    resulting URL is persisted on the sketch. The source_type is set to
    "image" automatically.
    """
    service = SketchService(db)
    try:
        sketch = await service.upload_background_image(
            floor_sketch_id,
            file,
            StorageFactory,
        )
        db.commit()
        db.refresh(sketch)
        return WMBackgroundImageResponse(
            floor_sketch_id=sketch.id,
            background_image_url=sketch.background_image_url,
            message="Background image uploaded successfully",
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )


@router.delete(
    "/floors/{floor_sketch_id}/background-image",
    response_model=WMBackgroundImageResponse,
    summary="Remove the background image from a floor sketch",
)
async def remove_background_image(
    floor_sketch_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """
    Remove the background image from a floor sketch.

    The file is deleted from the storage provider and the URL field is
    cleared. The source_type is reset to "sketch".
    """
    service = SketchService(db)
    try:
        sketch = await service.remove_background_image(
            floor_sketch_id,
            StorageFactory,
        )
        db.commit()
        db.refresh(sketch)
        return WMBackgroundImageResponse(
            floor_sketch_id=sketch.id,
            background_image_url=None,
            message="Background image removed successfully",
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )


# ---------------------------------------------------------------------------
# Background Image Preview (proxy for cloud storage)
# ---------------------------------------------------------------------------

@router.get(
    "/floors/{floor_sketch_id}/background-image/preview",
    summary="Serve the background image for a floor sketch",
)
async def preview_background_image(
    floor_sketch_id: UUID,
    db: Session = Depends(get_db),
):
    """
    Proxy endpoint that serves the floor sketch background image
    from whatever storage provider was used (local, gdrive, etc.).

    This allows the frontend to load images with a simple URL
    regardless of the underlying storage backend.
    """
    import logging

    logger = logging.getLogger(__name__)

    service = SketchService(db)
    sketch = service.repository.get_floor_sketch(floor_sketch_id)
    if not sketch:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Floor sketch not found",
        )

    provider = getattr(sketch, "storage_provider", None)
    file_id = getattr(sketch, "storage_file_id", None)
    bg_url = sketch.background_image_url or ""

    # Fallback: extract GDrive file_id from stored URL
    # for data uploaded before storage_file_id was added
    if not file_id and "drive.google.com/file/d/" in bg_url:
        import re

        m = re.search(
            r"drive\.google\.com/file/d/([^/]+)", bg_url
        )
        if m:
            file_id = m.group(1)
            provider = provider or "gdrive"
            logger.info(
                "Extracted GDrive file_id %s from URL "
                "for sketch %s",
                file_id,
                floor_sketch_id,
            )

    # Cloud storage: download via provider and stream back
    if provider and provider != "local" and file_id:
        try:
            storage = StorageFactory.get_instance(provider)
            photo_bytes = storage.download(file_id)
            return StreamingResponse(
                io.BytesIO(photo_bytes),
                media_type="image/jpeg",
                headers={
                    "Content-Disposition": "inline",
                    "Cache-Control": (
                        "public, max-age=86400"
                    ),
                },
            )
        except Exception as exc:
            logger.error(
                "Failed to serve background image "
                "for sketch %s: %s",
                floor_sketch_id,
                exc,
            )
            raise HTTPException(
                status_code=500,
                detail=(
                    "Failed to load background image"
                ),
            )

    # Local storage fallback
    if bg_url.startswith("/uploads/"):
        from pathlib import Path

        from app.core.config import settings as app_settings

        rel = bg_url.replace("/uploads/", "", 1)
        base = getattr(
            app_settings, "STORAGE_BASE_DIR", "uploads"
        )
        local_path = Path(base) / rel
        if not local_path.exists():
            local_path = (
                Path(__file__).parent.parent.parent
                / "uploads"
                / rel
            )
        if local_path.exists():
            return StreamingResponse(
                open(local_path, "rb"),
                media_type="image/jpeg",
                headers={
                    "Content-Disposition": "inline",
                    "Cache-Control": (
                        "public, max-age=86400"
                    ),
                },
            )

    raise HTTPException(
        status_code=404,
        detail="Background image not found",
    )


# ---------------------------------------------------------------------------
# Generate Scope of Work from Sketch
# ---------------------------------------------------------------------------

@router.post(
    "/jobs/{job_id}/generate-scope",
    response_model=GenerateScopeResponse,
    summary="Generate Scope of Work from sketch overlay data",
)
def generate_scope_from_sketch(
    job_id: UUID,
    options: GenerateScopeRequest = GenerateScopeRequest(),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """
    Generate WMScopeLocations and WMScopeItems from the sketch data.

    Reads all floor sketches for the job and creates scope items for
    demolition zones, equipment, containment, floor protection, and
    content protection based on the overlay data.

    Set clear_existing=true to remove all existing scope locations before
    generating new ones.
    """
    import logging
    _logger = logging.getLogger(__name__)

    service = SketchService(db)
    try:
        result = service.generate_scope_from_sketch(job_id, options)
        if result.success:
            db.commit()
        return result
    except Exception as exc:
        _logger.exception(
            "Error generating scope from sketch for job %s", job_id
        )
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Error generating scope of work: {str(exc)}",
        )


# ---------------------------------------------------------------------------
# PDF Report Endpoint
# ---------------------------------------------------------------------------

@router.get(
    "/jobs/{job_id}/report",
    summary="Generate a PDF sketch report for a WM job",
    response_class=StreamingResponse,
)
def generate_sketch_report(
    job_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """
    Generate and download a PDF report that includes:
    - Jobsite / homeowner / insurance information
    - SVG floor plan for each floor sketch
    - Per-floor demolition, equipment, containment, and protection summaries

    Returns a PDF file as an attachment.
    """
    import logging
    _logger = logging.getLogger(__name__)

    try:
        pdf_service = SketchPdfService(db)
        pdf_bytes = pdf_service.generate_sketch_report(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except RuntimeError as exc:
        _logger.error("PDF generation failed for job %s: %s", job_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        )
    except Exception as exc:
        _logger.exception("Unexpected error generating PDF for job %s", job_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate PDF report",
        )

    headers = {
        "Content-Disposition": f'attachment; filename="sketch_report_{job_id}.pdf"',
        "Content-Length": str(len(pdf_bytes)),
    }
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers=headers,
    )
