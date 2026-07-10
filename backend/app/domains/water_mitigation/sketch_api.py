"""
Water Mitigation Sketch API.

REST endpoints for floor sketches and overlay management.
Router is registered in main.py with prefix="/api/water-mitigation/sketch".
"""

import io
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
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
    """Convert a WMFloorSketch ORM object to WMFloorSketchDetailResponse.

    Merges authoritative child-table data (demolition, equipment, etc.)
    with JSONB-only data (text_annotations, shapes, walls, rooms).
    """
    # JSONB snapshot has text_annotations, shapes, walls, rooms
    # that are NOT stored in separate DB tables
    jsonb = sketch.overlay_data if isinstance(
        sketch.overlay_data, dict
    ) else {}

    resp = WMFloorSketchDetailResponse(
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
    # Attach JSONB-only overlay fields to the response
    # These are returned in overlay_data for the frontend
    resp.overlay_data = _merge_overlay_response(
        resp, jsonb
    )
    return resp


def _merge_overlay_response(
    resp: "WMFloorSketchDetailResponse",
    jsonb: dict,
) -> dict:
    """Build a complete overlay_data dict merging DB records with JSONB."""
    from decimal import Decimal as Dec

    def _to_json(obj):
        if isinstance(obj, dict):
            return {k: _to_json(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [_to_json(i) for i in obj]
        if isinstance(obj, Dec):
            return float(obj)
        if isinstance(obj, UUID):
            return str(obj)
        return obj

    # Use JSONB as the single source of truth for overlay_data.
    # Pass through the entire JSONB snapshot so that any new fields
    # (bg_offset_x/y, content_manipulations, etc.) are automatically
    # included without needing explicit enumeration here.
    return _to_json(jsonb)


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
        jsonb = s.overlay_data if isinstance(
            s.overlay_data, dict
        ) else {}
        # Use JSONB as single source of truth — pass through entirely
        resp.overlay_data = _to_json(jsonb)
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
    logger.info(
        "save_overlay_data floor=%s: shapes=%d, demo_zones=%d, equip=%d",
        floor_sketch_id,
        len(overlay_data.shapes or []),
        len(overlay_data.demolition_zones),
        len(overlay_data.equipment_placements),
    )
    if overlay_data.shapes:
        for s in overlay_data.shapes[:3]:
            logger.info("  shape: id=%s preset=%s x=%.0f y=%.0f", s.id, s.preset_id, s.x, s.y)
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

            # Detect content type from stored file extension
            content_type = "image/jpeg"
            if file_id.endswith(".webp"):
                content_type = "image/webp"
            elif file_id.endswith(".png"):
                content_type = "image/png"
            elif file_id.endswith(".svg"):
                content_type = "image/svg+xml"

            # Convert WebP/SVG to PNG for browser/canvas compatibility
            if content_type in ("image/webp", "image/svg+xml"):
                try:
                    if content_type == "image/svg+xml":
                        import cairosvg
                        png_bytes = cairosvg.svg2png(
                            bytestring=photo_bytes,
                            output_width=2400,
                        )
                        photo_bytes = png_bytes
                    else:
                        from PIL import Image as PILImage
                        pil_img = PILImage.open(io.BytesIO(photo_bytes))
                        png_buf = io.BytesIO()
                        pil_img.save(png_buf, format="PNG")
                        photo_bytes = png_buf.getvalue()
                    content_type = "image/png"
                    logger.info(
                        "Converted %s → PNG for proxy serve (%d bytes)",
                        file_id.rsplit(".", 1)[-1],
                        len(photo_bytes),
                    )
                except Exception as conv_exc:
                    logger.warning(
                        "Image conversion failed, serving original: %s",
                        conv_exc,
                    )

            logger.info(
                "Serving background image for sketch %s: "
                "provider=%s, file_id=%s, size=%d bytes",
                floor_sketch_id,
                provider,
                file_id,
                len(photo_bytes),
            )

            return StreamingResponse(
                io.BytesIO(photo_bytes),
                media_type=content_type,
                headers={
                    "Content-Disposition": "inline",
                    "Cache-Control": "no-store, must-revalidate",
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
                    "Cache-Control": "no-store, must-revalidate",
                },
            )

    raise HTTPException(
        status_code=404,
        detail="Background image not found",
    )


# ---------------------------------------------------------------------------
# AI Floor Plan Analysis (Image → Drawing conversion)
# ---------------------------------------------------------------------------

@router.post(
    "/floors/{floor_sketch_id}/analyze-image",
    summary="Analyze floor plan image with AI to extract walls and rooms",
)
async def analyze_floor_plan_image(
    floor_sketch_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """
    Use AI (GPT-4o Vision) to analyze the background image of a floor sketch
    and extract wall segments and room boundaries.

    Returns walls and rooms that can be merged into the sketch overlay data.
    The frontend is responsible for merging and saving the result.
    """
    import logging
    _logger = logging.getLogger(__name__)

    service = SketchService(db)
    sketch = service.repository.get_floor_sketch(floor_sketch_id)
    if not sketch:
        raise HTTPException(
            status_code=404, detail="Floor sketch not found"
        )

    if not sketch.background_image_url:
        raise HTTPException(
            status_code=400,
            detail="No background image to analyze. Upload an image first.",
        )

    # Load the image bytes from storage
    image_bytes = await _load_image_bytes(sketch, db)

    from app.domains.water_mitigation.sketch_ai_service import (
        analyze_floor_plan,
    )

    try:
        result = await analyze_floor_plan(
            image_bytes=image_bytes,
            canvas_width=sketch.canvas_width or 1200,
            canvas_height=sketch.canvas_height or 900,
            scale_pixels_per_foot=sketch.scale_pixels_per_foot or 20.0,
            floor_sketch_id=str(floor_sketch_id),
        )
        return {
            "success": True,
            "walls": result["walls"],
            "rooms": result["rooms"],
            "message": (
                f"Detected {len(result['walls'])} walls "
                f"and {len(result['rooms'])} rooms"
            ),
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        _logger.exception(
            "AI floor plan analysis failed for sketch %s",
            floor_sketch_id,
        )
        raise HTTPException(
            status_code=500,
            detail=f"AI analysis failed: {str(exc)}",
        )


async def _load_image_bytes(sketch: WMFloorSketch, db: Session) -> bytes:
    """Load background image bytes from the storage provider."""
    provider = getattr(sketch, "storage_provider", "local") or "local"
    file_id = getattr(sketch, "storage_file_id", None)
    bg_url = sketch.background_image_url or ""

    if provider != "local" and file_id:
        storage = StorageFactory().get_instance()
        data = storage.download(file_id)
        if hasattr(data, "read"):
            return data.read()
        return data

    # Local storage
    if bg_url.startswith("/uploads/"):
        from pathlib import Path
        from app.core.config import settings as app_settings

        rel = bg_url.replace("/uploads/", "", 1)
        base = getattr(app_settings, "STORAGE_BASE_DIR", "uploads")
        local_path = Path(base) / rel
        if not local_path.exists():
            local_path = (
                Path(__file__).parent.parent.parent / "uploads" / rel
            )
        if local_path.exists():
            return local_path.read_bytes()

    raise ValueError("Could not load background image from storage")


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
    template_variant: str = Query("a", description="Template variant: a (default), b (formal), c (modern)"),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """
    Generate and download a PDF report that includes:
    - Jobsite / homeowner / insurance information
    - SVG floor plan for each floor sketch
    - Per-floor demolition, equipment, containment, and protection summaries

    Returns a PDF file as an attachment.
    Also saves/updates the PDF as a WMDocument (document_type='sketch_report')
    so it appears in the Documents list.
    """
    import logging
    import os
    from pathlib import Path
    from app.domains.water_mitigation.models import WaterMitigationJob, WMDocument
    from app.domains.water_mitigation.document_repository import WMDocumentRepository

    _logger = logging.getLogger(__name__)

    try:
        pdf_service = SketchPdfService(db)
        pdf_bytes = pdf_service.generate_sketch_report(job_id, template_variant=template_variant)
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

    # --- Save PDF to disk and upsert WMDocument record ---
    try:
        # Get job info for filename
        job = db.query(WaterMitigationJob).filter(
            WaterMitigationJob.id == job_id
        ).first()
        address = (job.property_address or "").strip() if job else ""
        base_name = f"{address} - Sketch Report" if address else f"Sketch Report"
        filename = f"{base_name}.pdf"

        # Upload to cloud storage
        from app.common.utils.storage_helpers import upload_bytes_to_storage
        storage_info = upload_bytes_to_storage(
            file_bytes=pdf_bytes,
            filename=filename,
            context="water-mitigation",
            context_id=str(job_id),
            category="documents",
        )

        # Upsert: find existing sketch_report document for this job
        doc_repo = WMDocumentRepository(db)
        existing_docs = doc_repo.get_by_type(str(job_id), "sketch_report", is_active=True)
        existing_doc = existing_docs[0] if existing_docs else None

        if existing_doc:
            doc_repo.update(str(existing_doc.id), {
                "filename": filename,
                "file_path": storage_info["file_path"],
                "file_size": storage_info["file_size"],
                "storage_provider": storage_info["storage_provider"],
                "storage_file_id": storage_info["storage_file_id"],
                "title": base_name,
                "generated_by_id": str(current_user.id) if current_user else None,
            })
            _logger.info("Updated sketch_report document %s for job %s", existing_doc.id, job_id)
        else:
            # Create new document record
            doc_repo.create({
                "job_id": str(job_id),
                "document_type": "sketch_report",
                "filename": filename,
                "file_path": storage_info["file_path"],
                "file_size": storage_info["file_size"],
                "mime_type": "application/pdf",
                "title": base_name,
                "storage_provider": storage_info["storage_provider"],
                "storage_file_id": storage_info["storage_file_id"],
                "is_active": True,
                "generated_by_id": str(current_user.id) if current_user else None,
            })
            _logger.info("Created sketch_report document for job %s", job_id)

        db.commit()
    except Exception as doc_exc:
        _logger.warning("Failed to save sketch PDF as document: %s", doc_exc)
        # Don't fail the download — document save is best-effort

    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Content-Length": str(len(pdf_bytes)),
    }
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers=headers,
    )
