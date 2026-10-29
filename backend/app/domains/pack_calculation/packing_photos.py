"""
Claim packing photos

The claim photos picked for its packing estimate, filed by room. Each entry
points at a photo where it already lives - a photo of one of the claim's
water mitigation jobs ('wm') or a claim photo ('claim') - so nothing is
copied, and a photo trashed or unlinked there drops out here too.

The packing estimate builder loads the rooms and fetches each photo as a
JPEG sized for the AI item analysis.
"""

import asyncio
import logging
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from .models import PackingPhoto

logger = logging.getLogger(__name__)

# Long side of the JPEG handed to the builder: sharp enough to zoom in the
# photo preview, while the analysis shrinks it to 1024px anyway
ANALYSIS_PHOTO_DIM = 1600


def _not_found(label: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"{label} not found")


def require_claim_row(db: Session, claim_id: str) -> None:
    """404 for an id that isn't a claim (scope is checked by the caller)"""
    from app.domains.client.models import Claim

    try:
        uuid.UUID(str(claim_id))
    except ValueError:
        raise _not_found("Claim")
    if not db.query(Claim.id).filter(Claim.id == str(claim_id)).first():
        raise _not_found("Claim")


def clean_room_name(name: Optional[str]) -> str:
    return " ".join((name or "").split())[:100]


# ── Where the photos live ─────────────────────

def _wm_photos(db: Session, claim_id: str, photo_ids: List[str]) -> Dict[str, object]:
    """The claim's WM job photos among photo_ids that aren't in the trash"""
    from app.domains.water_mitigation.models import WaterMitigationJob, WMPhoto

    ids = [i for i in photo_ids if _is_uuid(i)]
    if not ids:
        return {}
    rows = db.query(WMPhoto).join(
        WaterMitigationJob, WMPhoto.job_id == WaterMitigationJob.id
    ).filter(
        WMPhoto.id.in_(ids),
        WaterMitigationJob.claim_id == str(claim_id),
        WMPhoto.is_trashed.isnot(True),
    ).all()
    return {str(p.id): p for p in rows}


def _claim_files(db: Session, claim_id: str, photo_ids: List[str]) -> Dict[str, object]:
    """The claim's active image files among photo_ids"""
    from app.domains.file.models import File

    if not photo_ids:
        return {}
    rows = db.query(File).filter(
        File.id.in_(photo_ids),
        File.context == "claim",
        File.context_id == str(claim_id),
        File.is_active.isnot(False),
    ).all()
    return {str(f.id): f for f in rows if (f.content_type or "").startswith("image/")}


def _sources(db: Session, claim_id: str, refs: List[Tuple[str, str]]) -> Dict[Tuple[str, str], object]:
    """(source, photo_id) -> the photo record, for the refs that still exist on the claim"""
    found: Dict[Tuple[str, str], object] = {}
    wm_ids = [pid for src, pid in refs if src == "wm"]
    file_ids = [pid for src, pid in refs if src == "claim"]
    for pid, photo in _wm_photos(db, claim_id, wm_ids).items():
        found[("wm", pid)] = photo
    for pid, record in _claim_files(db, claim_id, file_ids).items():
        found[("claim", pid)] = record
    return found


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except ValueError:
        return False


# ── Listing ───────────────────────────────────

def _photo_out(entry: PackingPhoto, record) -> dict:
    if entry.source == "wm":
        base = f"/api/water-mitigation/photos/{entry.photo_id}/preview"
        return {
            "id": str(entry.id),
            "source": entry.source,
            "photo_id": entry.photo_id,
            "room_name": entry.room_name,
            "file_name": record.file_name,
            "thumbnail_url": f"{base}?size=thumbnail",
            "preview_url": f"{base}?size=original",
            "location_level": record.location_level,
            "location_room": record.location_room,
        }
    return {
        "id": str(entry.id),
        "source": entry.source,
        "photo_id": entry.photo_id,
        "room_name": entry.room_name,
        "file_name": record.original_name,
        "thumbnail_url": f"/api/files/preview/{entry.photo_id}",
        "preview_url": f"/api/files/download/{entry.photo_id}?inline=true",
        "location_level": None,
        "location_room": None,
    }


def list_photos(db: Session, claim_id: str) -> List[dict]:
    """The claim's packing photos, room by room in the order the rooms were
    started, each room's photos in the order they were added"""
    entries = db.query(PackingPhoto).filter(
        PackingPhoto.claim_id == str(claim_id)
    ).order_by(PackingPhoto.sort_order, PackingPhoto.created_at).all()
    found = _sources(db, claim_id, [(e.source, e.photo_id) for e in entries])

    rooms: Dict[str, List[dict]] = {}
    for entry in entries:
        record = found.get((entry.source, entry.photo_id))
        if record is None:
            continue  # trashed, deleted or no longer on this claim
        rooms.setdefault(entry.room_name, []).append(_photo_out(entry, record))
    return [photo for photos in rooms.values() for photo in photos]


# ── Changes ───────────────────────────────────

def _existing_room_names(db: Session, claim_id: str) -> Dict[str, str]:
    """lower-cased room name -> the spelling already in use on the claim"""
    names = db.query(PackingPhoto.room_name).filter(
        PackingPhoto.claim_id == str(claim_id)
    ).distinct().all()
    return {n.lower(): n for (n,) in names}


def _next_sort_order(db: Session, claim_id: str) -> int:
    top = db.query(func.max(PackingPhoto.sort_order)).filter(
        PackingPhoto.claim_id == str(claim_id)
    ).scalar()
    return (top or 0) + 1


def add_photos(db: Session, claim_id: str, room_name: Optional[str], photos, staff_id) -> None:
    """File photos under rooms: each photo's own room_name, else room_name.
    A photo already in the packing set moves to its new room."""
    known = _existing_room_names(db, claim_id)
    wanted: List[Tuple[str, str, str]] = []
    for ref in photos:
        room = clean_room_name(ref.room_name) or clean_room_name(room_name)
        if not room:
            raise HTTPException(status_code=400, detail="Choose a room for every photo")
        # "kitchen" joins an existing "Kitchen" room
        room = known.setdefault(room.lower(), room)
        # The plain string: a str Enum member doesn't hash like its value
        source = getattr(ref.source, "value", ref.source)
        wanted.append((source, str(ref.photo_id), room))

    found = _sources(db, claim_id, [(src, pid) for src, pid, _ in wanted])
    missing = sum(1 for src, pid, _ in wanted if (src, pid) not in found)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"{missing} photo{'s are' if missing > 1 else ' is'} not on this claim",
        )

    current = {
        (e.source, e.photo_id): e
        for e in db.query(PackingPhoto).filter(PackingPhoto.claim_id == str(claim_id)).all()
    }
    order = _next_sort_order(db, claim_id)
    for src, pid, room in wanted:
        entry = current.get((src, pid))
        if entry is None:
            entry = PackingPhoto(
                claim_id=str(claim_id), source=src, photo_id=pid,
                created_by_id=staff_id,
            )
            db.add(entry)
            current[(src, pid)] = entry
        elif entry.room_name == room:
            continue
        entry.room_name = room
        entry.sort_order = order
        order += 1
    db.commit()


def move_photos(db: Session, claim_id: str, ids: List[str], room_name: str) -> None:
    """Move photos to a room. Moving every photo of a room to a new name
    renames the room in place; photos joining a room go to its end."""
    room = clean_room_name(room_name)
    if not room:
        raise HTTPException(status_code=400, detail="Room name is required")
    known = _existing_room_names(db, claim_id)
    joining = room.lower() in known
    room = known.get(room.lower(), room)

    entries = db.query(PackingPhoto).filter(
        PackingPhoto.claim_id == str(claim_id),
        PackingPhoto.id.in_([i for i in ids if _is_uuid(i)]),
    ).all()
    order = _next_sort_order(db, claim_id)
    for entry in entries:
        if entry.room_name == room:
            continue
        entry.room_name = room
        if joining:
            entry.sort_order = order
            order += 1
    db.commit()


def remove_photos(db: Session, claim_id: str, ids: List[str]) -> None:
    """Take photos out of the packing set; the photos themselves stay put"""
    db.query(PackingPhoto).filter(
        PackingPhoto.claim_id == str(claim_id),
        PackingPhoto.id.in_([i for i in ids if _is_uuid(i)]),
    ).delete(synchronize_session=False)
    db.commit()


# ── Image for the analysis ────────────────────

async def _fetch_url(url: str) -> Optional[bytes]:
    import httpx

    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(url)
        if resp.status_code == 200 and resp.content:
            return resp.content
    except Exception as e:
        logger.warning(f"Packing photo fetch failed for {url[:80]}: {e}")
    return None


async def _wm_photo_bytes(photo) -> Optional[bytes]:
    # CompanyCam photos: the CDN's web size first, then the original; the
    # stored copy and the small thumbnail are the fallback
    if photo.source == "companycam":
        for url in (photo.storage_web_url, photo.file_path):
            if url and url.startswith("http"):
                data = await _fetch_url(url)
                if data:
                    return data
    from app.domains.water_mitigation.api import _load_photo_image_data

    return await _load_photo_image_data({
        "file_path": photo.file_path,
        "storage_file_id": photo.storage_file_id,
        "storage_provider": photo.storage_provider,
        "storage_thumbnail_url": photo.storage_thumbnail_url,
        "source": photo.source,
    })


def _claim_file_bytes(record) -> Optional[bytes]:
    from app.domains.storage.factory import StorageFactory

    url = record.url or ""
    provider = record.storage_provider
    # Same rule as the file download endpoint: the provider column decides,
    # the url prefix only for rows written before it existed
    is_cloud = bool(provider) and provider != "local"
    if not provider:
        is_cloud = url.startswith(("gs://", "b2://", "https://", "http://"))
    if is_cloud:
        return StorageFactory.get_instance(provider).download(url)
    path = Path(url)
    return path.read_bytes() if path.exists() else None


async def load_image(db: Session, claim_id: str, entry_id: str) -> str:
    """One packing photo as base64 JPEG for the builder"""
    from .vision import convert_photo_to_jpeg

    if not _is_uuid(entry_id):
        raise _not_found("Photo")
    entry = db.query(PackingPhoto).filter(
        PackingPhoto.id == str(entry_id),
        PackingPhoto.claim_id == str(claim_id),
    ).first()
    if entry is None:
        raise _not_found("Photo")
    record = _sources(db, claim_id, [(entry.source, entry.photo_id)]).get((entry.source, entry.photo_id))
    if record is None:
        raise _not_found("Photo")

    try:
        if entry.source == "wm":
            data = await _wm_photo_bytes(record)
        else:
            data = await asyncio.to_thread(_claim_file_bytes, record)
    except Exception as e:
        logger.warning(f"Packing photo {entry_id} could not be loaded: {e}")
        data = None
    if not data:
        raise HTTPException(status_code=404, detail="Photo file is not available")

    # Pillow decode/re-encode is CPU-bound; keep it off the event loop
    return await asyncio.to_thread(convert_photo_to_jpeg, data, ANALYSIS_PHOTO_DIM)
