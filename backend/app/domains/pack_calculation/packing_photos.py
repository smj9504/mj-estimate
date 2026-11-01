"""
Claim packing photos

The claim photos picked for its packing estimate, filed under a category -
the stage of the job they are for (water mitigation, work completion) - and
a room within it. A packing estimate is made for one category's rooms. Each entry
points at a photo where it already lives - a photo of one of the claim's
water mitigation jobs ('wm') or a claim photo ('claim') - so nothing is
copied, and a photo trashed or unlinked there drops out here too.

The packing estimate builder loads the rooms and fetches each photo as a
JPEG sized for the AI item analysis.

A Photo AI estimate also keeps its rooms' own photos: the builder saves each
as a file (context ROOM_PHOTO_CONTEXT) when it calculates, the estimate's rooms
hold the file ids, and recalculating fetches them back the same way. Its report
shows those; an estimate from before rooms kept theirs shows each room with the
photos of the claim's room of that name.
"""

import asyncio
import io
import logging
import re
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from .models import PackingPhoto, PackRoom
from .packing_schemas import PackingPhotoCategory

logger = logging.getLogger(__name__)

# Long side of the JPEG handed to the builder: sharp enough to zoom in the
# photo preview, while the analysis shrinks it to 1024px anyway
ANALYSIS_PHOTO_DIM = 1600

# files.context of a room photo saved from the builder with its estimate
ROOM_PHOTO_CONTEXT = "packing-estimate"


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


# Categories in the order the claim page lists them
CATEGORIES = [c.value for c in PackingPhotoCategory]
DEFAULT_CATEGORY = PackingPhotoCategory.WATER_MITIGATION.value


def _value(member) -> Optional[str]:
    """The plain string: a str Enum member doesn't hash like its value"""
    return getattr(member, "value", member)


def _category(entry: PackingPhoto) -> str:
    return entry.category or DEFAULT_CATEGORY


def _category_rank(category: str) -> int:
    return CATEGORIES.index(category) if category in CATEGORIES else len(CATEGORIES)


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
            "category": _category(entry),
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
        "category": _category(entry),
        "room_name": entry.room_name,
        "file_name": record.original_name,
        "thumbnail_url": f"/api/files/preview/{entry.photo_id}",
        "preview_url": f"/api/files/download/{entry.photo_id}?inline=true",
        "location_level": None,
        "location_room": None,
    }


def _by_category(rooms: Dict[Tuple[str, str], list]) -> List[Tuple[Tuple[str, str], list]]:
    """(category, room) groups category by category, each category's rooms
    in the order they were started"""
    return sorted(rooms.items(), key=lambda item: _category_rank(item[0][0]))


def list_photos(db: Session, claim_id: str) -> List[dict]:
    """The claim's packing photos, category by category and within each room
    by room in the order the rooms were started, each room's photos in the
    order they were added"""
    entries = db.query(PackingPhoto).filter(
        PackingPhoto.claim_id == str(claim_id)
    ).order_by(PackingPhoto.sort_order, PackingPhoto.created_at).all()
    found = _sources(db, claim_id, [(e.source, e.photo_id) for e in entries])

    rooms: Dict[Tuple[str, str], List[dict]] = {}
    for entry in entries:
        record = found.get((entry.source, entry.photo_id))
        if record is None:
            continue  # trashed, deleted or no longer on this claim
        rooms.setdefault((_category(entry), entry.room_name), []).append(_photo_out(entry, record))
    return [photo for _, photos in _by_category(rooms) for photo in photos]


def _live_photo_keys(db: Session, entries: List[PackingPhoto]) -> set:
    """(claim_id, source, photo_id) of the entries whose photo is still on
    its claim - _sources for many claims at once"""
    from app.domains.file.models import File
    from app.domains.water_mitigation.models import WaterMitigationJob, WMPhoto

    claim_ids = list({str(e.claim_id) for e in entries})
    wm_ids = [e.photo_id for e in entries if e.source == "wm" and _is_uuid(e.photo_id)]
    file_ids = [e.photo_id for e in entries if e.source == "claim"]
    live = set()
    if wm_ids:
        rows = db.query(WMPhoto.id, WaterMitigationJob.claim_id).join(
            WaterMitigationJob, WMPhoto.job_id == WaterMitigationJob.id
        ).filter(
            WMPhoto.id.in_(wm_ids),
            WaterMitigationJob.claim_id.in_(claim_ids),
            WMPhoto.is_trashed.isnot(True),
        ).all()
        live.update((str(claim_id), "wm", str(pid)) for pid, claim_id in rows)
    if file_ids:
        rows = db.query(File.id, File.context_id, File.content_type).filter(
            File.id.in_(file_ids),
            File.context == "claim",
            File.context_id.in_(claim_ids),
            File.is_active.isnot(False),
        ).all()
        live.update(
            (str(context_id), "claim", str(fid))
            for fid, context_id, content_type in rows
            if (content_type or "").startswith("image/")
        )
    return live


def claims_with_photos(db: Session, condition, search: Optional[str] = None, limit: int = 50) -> List[dict]:
    """Claims with packing photos, the most recently picked first, for the
    builder to load from: each with its client, the company its pack-out goes
    under and its rooms (category by category). condition limits them to the
    claims the staff member may see (None: all)."""
    from app.domains.auth.company_scope import scoped
    from app.domains.client.claim_companies import companies_by_claim
    from app.domains.client.models import Claim, Client

    last_picked = func.max(func.coalesce(PackingPhoto.updated_at, PackingPhoto.created_at))
    query = db.query(PackingPhoto.claim_id).join(
        Claim, Claim.id == PackingPhoto.claim_id
    ).join(
        Client, Client.id == Claim.client_id
    )
    query = scoped(query, condition)
    text = " ".join((search or "").split())
    if text:
        like = f"%{text}%"
        query = query.filter(
            Client.display_name.ilike(like)
            | Claim.claim_number.ilike(like)
            | Client.address.ilike(like)
        )
    claim_ids = [
        str(claim_id) for (claim_id,) in
        query.group_by(PackingPhoto.claim_id).order_by(last_picked.desc()).limit(limit).all()
    ]
    if not claim_ids:
        return []

    entries = db.query(PackingPhoto).filter(
        PackingPhoto.claim_id.in_(claim_ids)
    ).order_by(PackingPhoto.sort_order, PackingPhoto.created_at).all()
    live = _live_photo_keys(db, entries)
    rooms_by_claim: Dict[str, Dict[Tuple[str, str], int]] = {}
    for entry in entries:
        claim_id = str(entry.claim_id)
        if (claim_id, entry.source, entry.photo_id) not in live:
            continue
        rooms = rooms_by_claim.setdefault(claim_id, {})
        key = (_category(entry), entry.room_name)
        rooms[key] = rooms.get(key, 0) + 1

    claims = {
        str(c.id): (c, cl) for c, cl in db.query(Claim, Client).join(
            Client, Client.id == Claim.client_id
        ).filter(Claim.id.in_(claim_ids)).all()
    }
    companies = companies_by_claim(db, claim_ids)

    out = []
    for claim_id in claim_ids:
        rooms = rooms_by_claim.get(claim_id)
        if not rooms or claim_id not in claims:
            continue  # every photo it had was trashed or unlinked
        claim, client = claims[claim_id]
        out.append({
            "claim_id": claim_id,
            "claim_number": claim.claim_number,
            "insurance_company": claim.insurance_company,
            "client_id": str(client.id),
            "client_name": client.display_name,
            "project_address": ", ".join(
                part for part in (client.address, client.city, client.state, client.zipcode) if part
            ),
            "company_id": _packing_company_id(claim, companies.get(claim_id, [])),
            "photo_count": sum(rooms.values()),
            "rooms": [
                {"category": category, "room_name": name, "photo_count": n}
                for (category, name), n in _by_category(rooms)
            ],
        })
    return out


def _packing_company_id(claim, companies: List[dict]) -> Optional[str]:
    """The company a claim's pack-out goes under: its moving company, else
    its only company (as the claim page's Packing estimate section picks it)"""
    moving = next((c["id"] for c in companies if c.get("role") == "moving"), None)
    if moving:
        return moving
    if len(companies) == 1:
        return companies[0]["id"]
    if not companies and claim.company_id:
        return str(claim.company_id)
    return None


# ── Changes ───────────────────────────────────

def _existing_room_names(db: Session, claim_id: str) -> Dict[Tuple[str, str], str]:
    """(category, lower-cased room name) -> the spelling already in use in
    that category on the claim"""
    names = db.query(PackingPhoto.category, PackingPhoto.room_name).filter(
        PackingPhoto.claim_id == str(claim_id)
    ).distinct().all()
    return {(category or DEFAULT_CATEGORY, n.lower()): n for category, n in names}


def _next_sort_order(db: Session, claim_id: str) -> int:
    top = db.query(func.max(PackingPhoto.sort_order)).filter(
        PackingPhoto.claim_id == str(claim_id)
    ).scalar()
    return (top or 0) + 1


def _check_category(category) -> str:
    category = _value(category)
    if category not in CATEGORIES:
        raise HTTPException(status_code=400, detail="Choose a category for the photos")
    return category


def add_photos(
    db: Session, claim_id: str, category, room_name: Optional[str], photos, staff_id,
) -> None:
    """File photos under a category and rooms in it: each photo's own
    room_name, else room_name. A photo already in the packing set moves to
    its new category and room."""
    category = _check_category(category)
    known = _existing_room_names(db, claim_id)
    wanted: List[Tuple[str, str, str]] = []
    for ref in photos:
        room = clean_room_name(ref.room_name) or clean_room_name(room_name)
        if not room:
            raise HTTPException(status_code=400, detail="Choose a room for every photo")
        # "kitchen" joins an existing "Kitchen" room of the same category
        room = known.setdefault((category, room.lower()), room)
        wanted.append((_value(ref.source), str(ref.photo_id), room))

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
        elif entry.room_name == room and _category(entry) == category:
            continue
        entry.category = category
        entry.room_name = room
        entry.sort_order = order
        order += 1
    db.commit()


def move_photos(
    db: Session, claim_id: str, ids: List[str], room_name: str, category=None,
) -> None:
    """Move photos to a room: of category, else of the category each is in.
    Moving every photo of a room to a new name (or category) moves the room
    as it is, in its place. Photos joining a room go to its end, and some of
    a room's photos moved to a new room start it after the others."""
    room = clean_room_name(room_name)
    if not room:
        raise HTTPException(status_code=400, detail="Room name is required")
    category = _check_category(category) if category is not None else None
    known = _existing_room_names(db, claim_id)

    entries = db.query(PackingPhoto).filter(
        PackingPhoto.claim_id == str(claim_id),
        PackingPhoto.id.in_([i for i in ids if _is_uuid(i)]),
    ).order_by(PackingPhoto.sort_order, PackingPhoto.created_at).all()
    # (category, room) -> its photo count, to tell a whole room from part of one
    room_sizes: Dict[Tuple[str, str], int] = {}
    for cat, name, n in db.query(
        PackingPhoto.category, PackingPhoto.room_name, func.count(PackingPhoto.id)
    ).filter(PackingPhoto.claim_id == str(claim_id)).group_by(
        PackingPhoto.category, PackingPhoto.room_name
    ).all():
        key = (cat or DEFAULT_CATEGORY, name)
        room_sizes[key] = room_sizes.get(key, 0) + n
    moving: Dict[Tuple[str, str], int] = {}
    for entry in entries:
        key = (_category(entry), entry.room_name)
        moving[key] = moving.get(key, 0) + 1

    order = _next_sort_order(db, claim_id)
    for entry in entries:
        target = category or _category(entry)
        joining = (target, room.lower()) in known
        name = known.get((target, room.lower()), room)
        source = (_category(entry), entry.room_name)
        if entry.room_name == name and _category(entry) == target:
            continue
        whole_room = moving[source] == room_sizes.get(source)
        entry.category = target
        entry.room_name = name
        if joining or not whole_room:
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


def _stored_file_bytes(record) -> Optional[bytes]:
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
    if path.exists():
        return path.read_bytes()
    # A local upload's url is relative to the storage folder
    return StorageFactory.get_instance("local").download(url)


async def _photo_bytes(entry: PackingPhoto, record) -> Optional[bytes]:
    """The photo file an entry points at, as stored; None when it can't be had"""
    try:
        if entry.source == "wm":
            return await _wm_photo_bytes(record)
        return await asyncio.to_thread(_stored_file_bytes, record)
    except Exception as e:
        logger.warning(f"Packing photo {entry.id} could not be loaded: {e}")
        return None


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

    data = await _photo_bytes(entry, record)
    if not data:
        raise HTTPException(status_code=404, detail="Photo file is not available")

    # Pillow decode/re-encode is CPU-bound; keep it off the event loop
    return await asyncio.to_thread(convert_photo_to_jpeg, data, ANALYSIS_PHOTO_DIM)


# ── An estimate's room photos ─────────────────

# The name the estimate builder gives an estimate made from one category's rooms
CATEGORY_LABELS = {
    PackingPhotoCategory.WATER_MITIGATION.value: "Water mitigation",
    PackingPhotoCategory.WORK_COMPLETION.value: "Work completion",
}

# "Kitchen (2)": the builder's name for a second room loaded as "Kitchen"
_REPEAT_SUFFIX = re.compile(r"^(.*\S)\s+\((\d+)\)$")

# Long side of a photo in the report: sharp when zoomed in, small in the PDF
REPORT_PHOTO_DIM = 1200
REPORT_PHOTO_QUALITY = 72
REPORT_PARALLEL_FETCHES = 4


def category_named(name: Optional[str]) -> Optional[str]:
    """The category an estimate is for when it is named for one (as the
    builder names an estimate made from one category's rooms)"""
    text = (name or "").strip().lower()
    return next((c for c, label in CATEGORY_LABELS.items() if label.lower() == text), None)


def estimate_room_photos(
    db: Session, claim_id: str, room_names: List[str], category: Optional[str] = None,
) -> List[List[PackingPhoto]]:
    """The claim's packing photos of each of an estimate's rooms, in the
    order they are on the claim: the room of the same name (any case), in
    `category` when the estimate is for one. The builder loads a second
    "Kitchen" as "Kitchen (2)", so that one gets the next Kitchen, in the
    category after. A room the claim has no photos of gets none."""
    entries = db.query(PackingPhoto).filter(
        PackingPhoto.claim_id == str(claim_id)
    ).order_by(PackingPhoto.sort_order, PackingPhoto.created_at).all()
    live = _sources(db, claim_id, [(e.source, e.photo_id) for e in entries])

    rooms: Dict[Tuple[str, str], List[PackingPhoto]] = {}
    for entry in entries:
        if (entry.source, entry.photo_id) not in live:
            continue  # trashed, deleted or no longer on this claim
        rooms.setdefault((_category(entry), entry.room_name), []).append(entry)
    claim_rooms = [
        key for key, _ in _by_category(rooms) if category is None or key[0] == category
    ]

    taken = set()

    def match(name: str) -> Optional[Tuple[str, str]]:
        return next(
            (key for key in claim_rooms if key not in taken and key[1].lower() == name.lower()),
            None,
        )

    out = []
    for room_name in room_names:
        name = " ".join((room_name or "").split())
        key = match(name)
        repeat = _REPEAT_SUFFIX.match(name)
        if key is None and repeat:
            key = match(repeat.group(1))
        if key is not None:
            taken.add(key)
        out.append(rooms[key] if key is not None else [])
    return out


def _report_jpeg(data: bytes) -> Optional[bytes]:
    """A photo as a JPEG sized for the report; None for a file that isn't a
    photo Pillow can read"""
    from PIL import Image, ImageOps

    try:
        with io.BytesIO(data) as source:
            img = Image.open(source)
            img.load()
        img = ImageOps.exif_transpose(img)
        if img.mode != "RGB":
            img = img.convert("RGB")
        img.thumbnail((REPORT_PHOTO_DIM, REPORT_PHOTO_DIM), Image.LANCZOS)
        with io.BytesIO() as out:
            img.save(out, format="JPEG", quality=REPORT_PHOTO_QUALITY, optimize=True)
            return out.getvalue()
    except Exception as e:
        logger.warning(f"Packing photo could not be read for the report: {e}")
        return None


async def report_images(db: Session, claim_id: str, entries: List[PackingPhoto]) -> List[Optional[bytes]]:
    """Each entry's photo as a JPEG sized for the report, a few at a time so
    a big claim doesn't hold all its originals at once; None for a photo that
    can't be loaded"""
    found = _sources(db, claim_id, [(e.source, e.photo_id) for e in entries])
    gate = asyncio.Semaphore(REPORT_PARALLEL_FETCHES)

    async def one(entry: PackingPhoto) -> Optional[bytes]:
        record = found.get((entry.source, entry.photo_id))
        if record is None:
            return None
        async with gate:
            data = await _photo_bytes(entry, record)
            if not data:
                return None
            # Pillow decode/re-encode is CPU-bound; keep it off the event loop
            return await asyncio.to_thread(_report_jpeg, data)

    return await asyncio.gather(*(one(e) for e in entries))


# ── Photos saved with an estimate ─────────────

def saved_room_photos(db: Session, file_ids: List[str]) -> List[str]:
    """Of the ids a calculation sent, the photos really saved from the builder:
    an estimate's photos can be read by whoever can read the estimate, so it
    can't be made to point at just any file"""
    from app.domains.file.models import File

    if not file_ids:
        return []
    known = {
        str(file_id) for (file_id,) in db.query(File.id).filter(
            File.id.in_(file_ids),
            File.context == ROOM_PHOTO_CONTEXT,
            File.is_active.isnot(False),
        ).all()
    }
    return [file_id for file_id in file_ids if file_id in known]


async def report_saved_images(db: Session, file_ids: List[str]) -> List[Optional[bytes]]:
    """Photos saved with an estimate as JPEGs sized for the report, a few at a
    time; None for one that can't be loaded"""
    from app.domains.file.models import File

    if not file_ids:
        return []
    records = {
        str(r.id): r for r in db.query(File).filter(
            File.id.in_(file_ids), File.context == ROOM_PHOTO_CONTEXT,
        ).all()
    }
    gate = asyncio.Semaphore(REPORT_PARALLEL_FETCHES)

    async def one(file_id: str) -> Optional[bytes]:
        record = records.get(file_id)
        if record is None:
            return None
        async with gate:
            try:
                data = await asyncio.to_thread(_stored_file_bytes, record)
            except Exception as e:
                logger.warning(f"Estimate photo {file_id} could not be loaded: {e}")
                return None
            return await asyncio.to_thread(_report_jpeg, data) if data else None

    return await asyncio.gather(*(one(file_id) for file_id in file_ids))


def estimate_photo_ids(db: Session, calc_id: str) -> List[str]:
    rows = db.query(PackRoom.photos).filter(PackRoom.calculation_id == str(calc_id)).all()
    return [file_id for (photos,) in rows for file_id in photos or []]


async def load_room_photo(db: Session, calc_id: str, file_id: str) -> str:
    """One photo saved with an estimate as base64 JPEG for the builder"""
    from app.domains.file.models import File

    from .vision import convert_photo_to_jpeg

    if file_id not in estimate_photo_ids(db, calc_id):
        raise _not_found("Photo")
    record = db.query(File).filter(
        File.id == file_id,
        File.context == ROOM_PHOTO_CONTEXT,
        File.is_active.isnot(False),
    ).first()
    if record is None:
        raise _not_found("Photo")

    try:
        data = await asyncio.to_thread(_stored_file_bytes, record)
    except Exception as e:
        logger.warning(f"Estimate photo {file_id} could not be loaded: {e}")
        data = None
    if not data:
        raise HTTPException(status_code=404, detail="Photo file is not available")
    return await asyncio.to_thread(convert_photo_to_jpeg, data, ANALYSIS_PHOTO_DIM)


def delete_unused_room_photos(db: Session, file_ids: List[str]) -> None:
    """After an estimate is deleted, remove its photos that no other estimate
    uses: recalculating saves a new estimate on the same photos."""
    from app.domains.client.client_delete import StoredFile, _not_used_elsewhere, delete_stored_files
    from app.domains.file.models import File

    if not file_ids:
        return
    in_use = set()
    for (photos,) in db.query(PackRoom.photos).filter(PackRoom.photos.isnot(None)).all():
        in_use.update(photos or [])
    records = db.query(File).filter(
        File.id.in_([file_id for file_id in set(file_ids) if file_id not in in_use]),
        File.context == ROOM_PHOTO_CONTEXT,
    ).all()
    stored = [StoredFile(r.storage_provider, r.url) for r in records if r.storage_provider and r.url]
    for record in records:
        db.delete(record)
    db.commit()
    delete_stored_files(_not_used_elsewhere(db, stored))
