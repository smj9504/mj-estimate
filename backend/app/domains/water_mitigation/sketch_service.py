"""
Water Mitigation Sketch Service.

Business logic layer for floor sketches, overlay management,
and background image upload/removal.
"""

import logging
from typing import List, Optional
from uuid import UUID

from fastapi import UploadFile
from sqlalchemy.orm import Session

from app.domains.storage.factory import StorageFactory
from app.domains.water_mitigation.sketch_models import WMFloorSketch
from app.domains.water_mitigation.sketch_repository import SketchRepository
from app.domains.water_mitigation.sketch_schemas import (
    WMFloorSketchCreate,
    WMFloorSketchUpdate,
    WMOverlayData,
)

logger = logging.getLogger(__name__)

# Folder name used when storing background images in the storage provider
_BACKGROUND_IMAGE_FOLDER = "wm_sketch_backgrounds"


class SketchService:
    """Service for WM Sketch operations"""

    def __init__(self, db: Session):
        self.db = db
        self.repository = SketchRepository(db)

    # =========================================================================
    # Floor Sketch CRUD
    # =========================================================================

    def get_floor_sketches(self, job_id: UUID) -> List[WMFloorSketch]:
        """Return all floor sketches for a job ordered by floor_order."""
        return self.repository.get_floor_sketches_by_job(job_id)

    def get_floor_sketch(self, floor_sketch_id: UUID) -> Optional[WMFloorSketch]:
        """Return a single floor sketch with overlay child rows."""
        return self.repository.get_floor_sketch(floor_sketch_id)

    def create_floor_sketch(
        self,
        job_id: UUID,
        data: WMFloorSketchCreate,
    ) -> WMFloorSketch:
        """
        Create a new floor sketch for a job.

        Automatically assigns floor_order to max+1 when floor_order is 0
        (default) so callers do not need to manage ordering explicitly.
        """
        sketch_data = data.dict()

        # Ensure job_id is consistent (overwrite whatever was in the body)
        sketch_data["job_id"] = job_id

        if sketch_data.get("floor_order", 0) == 0:
            sketch_data["floor_order"] = self.repository.get_next_floor_order(job_id)

        return self.repository.create_floor_sketch(sketch_data)

    def update_floor_sketch(
        self,
        floor_sketch_id: UUID,
        data: WMFloorSketchUpdate,
    ) -> WMFloorSketch:
        """Update metadata fields on an existing floor sketch."""
        sketch = self.repository.get_floor_sketch(floor_sketch_id)
        if not sketch:
            raise ValueError(f"Floor sketch {floor_sketch_id} not found")

        return self.repository.update_floor_sketch(
            sketch,
            data.dict(exclude_unset=True),
        )

    def delete_floor_sketch(self, floor_sketch_id: UUID) -> bool:
        """Delete a floor sketch and all child overlay rows."""
        sketch = self.repository.get_floor_sketch(floor_sketch_id)
        if not sketch:
            raise ValueError(f"Floor sketch {floor_sketch_id} not found")

        return self.repository.delete_floor_sketch(sketch)

    # =========================================================================
    # Overlay Data
    # =========================================================================

    def save_overlay_data(
        self,
        floor_sketch_id: UUID,
        overlay_data: WMOverlayData,
    ) -> WMFloorSketch:
        """
        Validate and atomically save all overlay elements.

        Delegates bulk delete + insert to the repository, which also
        updates the JSONB snapshot column.
        """
        # Confirm sketch exists before delegating
        sketch = self.repository.get_floor_sketch(floor_sketch_id)
        if not sketch:
            raise ValueError(f"Floor sketch {floor_sketch_id} not found")

        return self.repository.save_overlay_data(floor_sketch_id, overlay_data)

    # =========================================================================
    # Background Image
    # =========================================================================

    async def upload_background_image(
        self,
        floor_sketch_id: UUID,
        file: UploadFile,
        storage_factory: StorageFactory,
    ) -> WMFloorSketch:
        """
        Upload a background image file and store its URL on the sketch.

        Uses StorageFactory to persist the file through the configured
        storage provider (local filesystem, Google Drive, etc.).
        The old image is removed from storage before the new one is saved.
        """
        import io

        sketch = self.repository.get_floor_sketch(floor_sketch_id)
        if not sketch:
            raise ValueError(f"Floor sketch {floor_sketch_id} not found")

        storage = storage_factory.get_instance()

        # Remove the previous background image if one exists
        if sketch.background_image_url:
            try:
                # Extract filename from the stored URL for the delete call
                # e.g. "/uploads/wm_sketch_backgrounds/id/uuid.jpg" → "uuid.jpg"
                import posixpath
                file_id = posixpath.basename(sketch.background_image_url)
                storage.delete(file_id)
            except Exception as exc:
                # Non-fatal: log and continue with the new upload
                logger.warning(
                    "Could not delete previous background image for floor sketch "
                    "%s: %s",
                    floor_sketch_id,
                    exc,
                )

        # Upload new file via StorageProvider.upload()
        file_content = await file.read()
        result = storage.upload(
            file_data=io.BytesIO(file_content),
            filename=file.filename or "background.jpg",
            context=_BACKGROUND_IMAGE_FOLDER,
            context_id=str(floor_sketch_id),
            content_type=file.content_type or "image/jpeg",
        )

        # Build an accessible URL from the upload result.
        # For local storage, file_url is a relative path (e.g. "wm_sketch_backgrounds/id/file.jpg").
        # Prepend /uploads/ so the frontend dev-server proxy and the backend StaticFiles mount
        # can both resolve it.
        image_url = result.file_url
        if not image_url.startswith(("http://", "https://", "/")):
            image_url = f"/uploads/{image_url}"

        # Persist URL
        return self.repository.update_floor_sketch(
            sketch,
            {"background_image_url": image_url, "source_type": "image"},
        )

    async def remove_background_image(
        self,
        floor_sketch_id: UUID,
        storage_factory: StorageFactory,
    ) -> WMFloorSketch:
        """
        Remove the background image from storage and clear the URL on the sketch.
        """
        sketch = self.repository.get_floor_sketch(floor_sketch_id)
        if not sketch:
            raise ValueError(f"Floor sketch {floor_sketch_id} not found")

        if sketch.background_image_url:
            try:
                import posixpath
                storage = storage_factory.get_instance()
                file_id = posixpath.basename(sketch.background_image_url)
                storage.delete(file_id)
            except Exception as exc:
                logger.warning(
                    "Could not delete background image for floor sketch %s: %s",
                    floor_sketch_id,
                    exc,
                )

        return self.repository.update_floor_sketch(
            sketch,
            {"background_image_url": None, "source_type": "sketch"},
        )
