"""
MagicPlan Sync Service

Handles syncing photos and floor plans from MagicPlan to Water Mitigation jobs:
- Project search and address matching
- Photo download and storage
- Floor plan image import for sketches
"""

import io
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.core.config import settings
from app.domains.integrations.companycam.utils import (
    calculate_address_similarity,
    normalize_address,
    normalize_street_address,
)
from app.domains.storage.factory import StorageFactory
from app.domains.water_mitigation.models import WaterMitigationJob, WMPhoto

from .client import MagicPlanClient
from .schemas import (
    MagicPlanFloorPlanImportResult,
    MagicPlanFloorPlanInfo,
    MagicPlanProjectMatch,
    MagicPlanProjectSearchResponse,
    MagicPlanSyncResult,
)

logger = logging.getLogger(__name__)


class MagicPlanSyncService:
    """Service for syncing MagicPlan data with Water Mitigation jobs."""

    def __init__(self, db: Session):
        self.db = db

    # ── Project Search & Matching ────────────────────────────

    async def search_projects_for_job(
        self, job_id: str, job_address: Optional[str] = None
    ) -> MagicPlanProjectSearchResponse:
        """
        Search MagicPlan projects and match against a WM job address.

        MagicPlan project names often contain partial addresses like:
        'Woodland Run Ct', 'Quartz Ln', '6348 Fenestra ct Burke Va 22015'
        """
        # Get job details
        job = self.db.query(WaterMitigationJob).filter(
            WaterMitigationJob.id == job_id
        ).first()
        if not job:
            return MagicPlanProjectSearchResponse()

        search_address = job_address or job.property_address or ""

        async with MagicPlanClient() as client:
            # Fetch all projects from MagicPlan
            all_projects = await client.list_all_projects()

        candidates = []
        auto_match = None

        for project in all_projects:
            project_name = (
                project.get("title")
                or project.get("name")
                or ""
            )
            project_address = project.get("address") or ""
            project_id = str(project.get("id", ""))

            if not project_name and not project_address:
                continue

            # Calculate match score against job address
            score, match_type = self._calculate_project_match_score(
                project_name=project_name,
                project_address=project_address,
                job_address=search_address,
                job_city=job.property_city,
                job_state=job.property_state,
            )

            if score > 0.3:  # Only include reasonable candidates
                match = MagicPlanProjectMatch(
                    project_id=project_id,
                    project_name=project_name,
                    address=project_address or project_name,
                    match_score=round(score, 2),
                    match_type=match_type,
                    photo_count=project.get("photo_count"),
                    plan_count=project.get("plan_count"),
                    created_at=project.get("created_at"),
                )
                candidates.append(match)

                # Auto-match if score is high enough
                if score >= 0.7 and (
                    auto_match is None or score > auto_match.match_score
                ):
                    auto_match = match

        # Sort by score descending
        candidates.sort(key=lambda c: c.match_score, reverse=True)

        return MagicPlanProjectSearchResponse(
            auto_match=auto_match,
            candidates=candidates[:20],  # Top 20 candidates
            total_projects=len(all_projects),
        )

    def _calculate_project_match_score(
        self,
        project_name: str,
        project_address: str,
        job_address: str,
        job_city: Optional[str] = None,
        job_state: Optional[str] = None,
    ) -> Tuple[float, str]:
        """
        Calculate match score between MagicPlan project and WM job.

        MagicPlan project names can be:
        - Full address: '6348 Fenestra ct Burke Va 22015'
        - Street name only: 'Woodland Run Ct'
        - Partial: 'Quartz Ln'
        - Nickname: 'Dog hill'
        """
        if not job_address:
            return 0.0, "no_address"

        best_score = 0.0
        best_type = "no_match"

        # Normalize job address
        norm_job = normalize_address(job_address)
        norm_job_street = normalize_street_address(job_address)

        # Build full job address for comparison
        job_full_parts = [job_address]
        if job_city:
            job_full_parts.append(job_city)
        if job_state:
            job_full_parts.append(job_state)
        norm_job_full = normalize_address(", ".join(job_full_parts))

        # Check project_address (structured address if available)
        if project_address:
            norm_proj_addr = normalize_address(project_address)
            score = calculate_address_similarity(norm_proj_addr, norm_job_full)
            if score > best_score:
                best_score = score
                best_type = "address_match"

        # Check project_name (often contains partial address)
        if project_name:
            norm_name = normalize_address(project_name)

            # Strategy 1: Full comparison
            score1 = calculate_address_similarity(norm_name, norm_job_full)
            if score1 > best_score:
                best_score = score1
                best_type = "name_full_match"

            # Strategy 2: Name against street only
            score2 = calculate_address_similarity(norm_name, norm_job_street)
            if score2 > best_score:
                best_score = score2
                best_type = "name_street_match"

            # Strategy 3: Check if project name is contained in job address
            # (for partial names like 'Woodland Run Ct')
            norm_name_lower = norm_name.lower().strip()
            norm_job_lower = norm_job_full.lower().strip()

            if len(norm_name_lower) >= 5:  # Minimum length to avoid false matches
                if norm_name_lower in norm_job_lower:
                    containment_score = min(
                        0.95, 0.7 + (len(norm_name_lower) / len(norm_job_lower)) * 0.3
                    )
                    if containment_score > best_score:
                        best_score = containment_score
                        best_type = "name_contained"

                # Check reverse: job address contains project name words
                name_words = set(norm_name_lower.split())
                job_words = set(norm_job_lower.split())
                if name_words and name_words.issubset(job_words):
                    word_score = min(
                        0.90, 0.6 + (len(name_words) / max(len(job_words), 1)) * 0.3
                    )
                    if word_score > best_score:
                        best_score = word_score
                        best_type = "name_words_match"

        return best_score, best_type

    # ── Photo Sync ───────────────────────────────────────────

    async def sync_photos(
        self,
        job_id: str,
        magicplan_project_id: str,
        magicplan_project_name: str = "",
    ) -> MagicPlanSyncResult:
        """
        Sync photos from a MagicPlan project to a WM job.
        Downloads photos and stores them via StorageFactory.
        """
        result = MagicPlanSyncResult(
            success=False,
            magicplan_project_id=magicplan_project_id,
            magicplan_project_name=magicplan_project_name,
        )

        try:
            async with MagicPlanClient() as client:
                # MagicPlan API structure:
                # - /projects/{id}/files → photos/files (jpeg, pdf, etc.)
                # - /projects/{id}/plan → plan data with floors[].image (SVG)
                files = await client.get_project_files(magicplan_project_id)

                # Get plan data for floor metadata
                floor_map: Dict[int, Dict[str, Any]] = {}
                try:
                    plan_data = await client.get_project_plan(
                        magicplan_project_id
                    )
                    plan_floors = (
                        plan_data.get("plan_data", {}).get("floors", [])
                    )
                    for i, floor in enumerate(plan_floors):
                        floor_map[i] = {
                            "floor_name": floor.get("name", f"Floor {i+1}"),
                            "floor_uid": floor.get("uid", ""),
                        }
                except Exception as e:
                    logger.warning(f"Failed to get plan data: {e}")

                # Filter to image files only
                images = [
                    f for f in files
                    if (f.get("filetype") or "").startswith("image/")
                ]

                if not images:
                    result.success = True
                    return result

                # Get existing magicplan photos to avoid duplicates
                existing_external_ids = set()
                existing_photos = (
                    self.db.query(WMPhoto.external_id)
                    .filter(
                        WMPhoto.job_id == job_id,
                        WMPhoto.source == "magicplan",
                        WMPhoto.external_id.isnot(None),
                    )
                    .all()
                )
                for (ext_id,) in existing_photos:
                    if ext_id:
                        existing_external_ids.add(ext_id)

                storage = StorageFactory.create()

                for img in images:
                    img_id = str(img.get("id", ""))
                    external_id = f"magicplan_{img_id}" if img_id else None

                    # Skip duplicates
                    if external_id and external_id in existing_external_ids:
                        result.photos_skipped += 1
                        continue

                    # Get image URL from file.url
                    file_info = img.get("file", {})
                    img_url = file_info.get("url") if isinstance(
                        file_info, dict
                    ) else None
                    if not img_url:
                        result.photos_skipped += 1
                        continue

                    try:
                        # Download photo
                        photo_bytes = await client.download_file(img_url)
                        if not photo_bytes:
                            result.photos_skipped += 1
                            continue

                        # Determine file name and type
                        file_name = (
                            img.get("filename")
                            or f"magicplan_{img_id}.jpg"
                        )
                        mime_type = img.get("filetype", "image/jpeg")

                        # Upload to storage
                        upload_result = storage.upload(
                            file_data=io.BytesIO(photo_bytes),
                            filename=file_name,
                            context="water-mitigation",
                            context_id=job_id,
                            category="magicplan",
                            content_type=mime_type,
                        )

                        # Build magicplan metadata
                        magicplan_metadata = self._extract_photo_metadata(img)
                        # Add floor info if available
                        if floor_map:
                            magicplan_metadata["available_floors"] = [
                                v["floor_name"] for v in floor_map.values()
                            ]

                        # Create WMPhoto record
                        photo = WMPhoto(
                            id=str(uuid.uuid4()),
                            job_id=job_id,
                            source="magicplan",
                            external_id=external_id,
                            file_name=file_name,
                            file_path=upload_result.file_path,
                            file_size=len(photo_bytes),
                            mime_type=mime_type,
                            file_type="photo",
                            storage_provider=settings.STORAGE_PROVIDER,
                            storage_file_id=upload_result.file_id,
                            storage_folder_path=upload_result.folder_path,
                            title=img.get("filename"),
                            captured_date=self._parse_date(
                                img.get("created_at")
                            ),
                            category="",
                            upload_status="completed",
                            magicplan_metadata=magicplan_metadata or None,
                        )
                        self.db.add(photo)
                        result.photos_synced += 1

                    except Exception as e:
                        error_msg = f"Failed to sync image {img_id}: {e}"
                        logger.error(error_msg)
                        result.errors.append(error_msg)

                self.db.commit()
                result.success = True

        except Exception as e:
            error_msg = f"MagicPlan sync failed: {e}"
            logger.error(error_msg, exc_info=True)
            result.errors.append(error_msg)
            self.db.rollback()

        return result

    def _extract_photo_metadata(self, img: Dict[str, Any]) -> Dict[str, Any]:
        """Extract MagicPlan-specific metadata from an image record."""
        metadata = {}

        # Floor info
        floor_name = img.get("floor_name") or img.get("floor_label")
        floor_id = img.get("floor_id")
        if floor_name:
            metadata["floor_name"] = floor_name
        if floor_id:
            metadata["floor_id"] = str(floor_id)

        # Room info
        room_name = img.get("room_name")
        room_id = img.get("room_id")
        if room_name:
            metadata["room_name"] = room_name
        if room_id:
            metadata["room_id"] = str(room_id)

        # Plan info (enriched from plan-level queries)
        plan_title = img.get("_plan_title")
        if plan_title:
            metadata["plan_title"] = plan_title

        # Try to extract floor info from plan floors
        floors = img.get("_plan_floors", [])
        if floors and not floor_name:
            # If image has floor_id, find matching floor
            for floor in floors:
                if str(floor.get("id")) == str(floor_id):
                    metadata["floor_name"] = (
                        floor.get("name") or floor.get("label") or ""
                    )
                    metadata["floor_order"] = floor.get("order", 0)
                    break

        # Notes
        notes = img.get("notes")
        if notes:
            metadata["notes"] = notes

        return metadata if metadata else {}

    def _parse_date(self, date_str: Optional[str]) -> Optional[datetime]:
        """Parse date string from MagicPlan API."""
        if not date_str:
            return None
        try:
            # Try ISO format
            return datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            try:
                # Try unix timestamp
                return datetime.fromtimestamp(int(date_str))
            except (ValueError, TypeError):
                return None

    # ── Floor Plan Import ────────────────────────────────────

    async def get_available_floor_plans(
        self, magicplan_project_id: str
    ) -> List[MagicPlanFloorPlanInfo]:
        """Get available floor plan images from a MagicPlan project."""
        async with MagicPlanClient() as client:
            plan_data = await client.get_project_plan(magicplan_project_id)
            plan_id = str(plan_data.get("id", ""))
            plan_title = plan_data.get("name", "")
            floors_raw = plan_data.get("plan_data", {}).get("floors", [])

            floor_info = []
            file_urls: Dict[str, str] = {}
            for i, floor in enumerate(floors_raw):
                svg_url = floor.get("image", "")
                if svg_url:
                    file_urls[str(i)] = svg_url
                floor_info.append({
                    "index": i,
                    "id": floor.get("uid", ""),
                    "name": floor.get("name", f"Floor {i + 1}"),
                    "room_count": len(floor.get("objects", [])),
                    "has_image": bool(svg_url),
                    "image_url": svg_url or None,
                })

            return [
                MagicPlanFloorPlanInfo(
                    plan_id=plan_id,
                    plan_title=plan_title,
                    floors=floor_info,
                    file_urls=file_urls,
                )
            ]

    async def import_floor_plan(
        self,
        job_id: str,
        magicplan_project_id: str,
        plan_id: str,
        floor_index: int = 0,
        target_wm_floor_id: Optional[str] = None,
    ) -> MagicPlanFloorPlanImportResult:
        """
        Import a floor plan image from MagicPlan into WM sketch as background.
        Uses the SVG image URL from plan_data.floors[].image.
        """
        from app.domains.water_mitigation.sketch_models import WMFloorSketch

        try:
            async with MagicPlanClient() as client:
                plan_data = await client.get_project_plan(
                    magicplan_project_id
                )
                floors = plan_data.get("plan_data", {}).get("floors", [])

                if floor_index >= len(floors):
                    return MagicPlanFloorPlanImportResult(
                        success=False,
                        error_message=(
                            f"Floor index {floor_index} not found "
                            f"(project has {len(floors)} floors)"
                        ),
                    )

                floor = floors[floor_index]
                image_url = floor.get("image", "")
                floor_label = floor.get("name", f"Floor {floor_index + 1}")

                if not image_url:
                    return MagicPlanFloorPlanImportResult(
                        success=False,
                        error_message=f"No floor plan image for: {floor_label}",
                    )

                # Download the SVG/image
                image_bytes = await client.download_file(image_url)

                # Upload to storage
                storage = StorageFactory.create()
                ext = "svg" if ".svg" in image_url else "png"
                file_name = (
                    f"magicplan_floorplan_{plan_id}_f{floor_index}.{ext}"
                )
                folder_path = f"water-mitigation/{job_id}/sketches"
                content_type = (
                    "image/svg+xml" if ext == "svg" else "image/png"
                )

                upload_result = storage.upload(
                    file_data=io.BytesIO(image_bytes),
                    filename=file_name,
                    context="water-mitigation",
                    context_id=job_id,
                    category="sketches",
                    content_type=content_type,
                )

                # Update existing WM floor sketch
                if target_wm_floor_id:
                    floor_sketch = (
                        self.db.query(WMFloorSketch)
                        .filter(WMFloorSketch.id == target_wm_floor_id)
                        .first()
                    )
                    if floor_sketch:
                        floor_sketch.background_image_url = (
                            upload_result.file_path
                        )
                        floor_sketch.storage_file_id = upload_result.file_id
                        floor_sketch.storage_provider = (
                            settings.STORAGE_PROVIDER
                        )
                        floor_sketch.source_type = "image"
                        self.db.commit()

                return MagicPlanFloorPlanImportResult(
                    success=True,
                    wm_floor_id=target_wm_floor_id,
                    floor_label=floor_label,
                    image_url=upload_result.file_path,
                )

        except Exception as e:
            logger.error(
                f"Failed to import floor plan: {e}", exc_info=True
            )
            return MagicPlanFloorPlanImportResult(
                success=False, error_message=str(e)
            )
