"""
Water Mitigation Sketch API.

REST endpoints for floor sketches and overlay management.
Router is registered in main.py with prefix="/api/water-mitigation/sketch".
"""

from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
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
    WMBackgroundImageResponse,
    WMContainmentZoneSchema,
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
    """Return all floor sketches for a job ordered by floor_order."""
    service = SketchService(db)
    sketches = service.get_floor_sketches(job_id)
    return WMFloorSketchListResponse(
        items=[WMFloorSketchResponse.from_orm(s) for s in sketches],
        total=len(sketches),
    )


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
