"""
Field visits: someone on site creates a client from where they're standing, gets
it signed, and photographs the property room by room.

Only the address is needed to start. The phone holds photos until they're sent,
so sending one is repeatable (the shot's id is the phone's) and rooms are saved
before the shots in them. A photo lives in the files table: under the visit until
the office puts the visit on a claim, then under that claim.
"""

from datetime import datetime, timedelta, timezone
from io import BytesIO
import logging
from typing import Any, Dict, List, Optional, Tuple
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File as FileField, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func

from app.common.services.media_types import as_jpeg_name, browser_video_type, is_heic, is_video, media_type_of
from app.core.database_factory import get_db_session as get_db
from app.domains.auth.company_scope import (
    claim_condition,
    client_condition,
    company_ids,
    document_condition,
    home_company_ids,
    require_claim,
    require_client,
    scoped,
)
from app.domains.auth.dependencies import get_current_staff
from app.domains.client.address_utils import normalize_address
from app.domains.client.models import Claim, Client
from app.domains.company.models import Company
from app.domains.contract.models import ContractInstance
from app.domains.contract.onsite_signing_api import find_client_at_address
from app.domains.file.models import File
from app.domains.file.video_service import MAX_VIDEO_UPLOAD_BYTES, OWNER_FILE, queue_processing
from app.domains.storage import StorageFactory

from .geocode import reverse_geocode
from .models import FieldRoom, FieldShot, FieldVisit
from .room_reader import read_room_of_shot, should_read
from .rooms import FLOOR_LABELS, refile_room, room_label

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(get_current_staff)])

VISIT_CONTEXT = 'field-visit'
CLAIM_CONTEXT = 'claim'
MAX_PHOTO_BYTES = 30 * 1024 * 1024
SHOT_KINDS = ('wall', 'demo', 'video')
# Coming back within this long carries on with the same visit; later is a new one
SAME_VISIT_WITHIN = timedelta(days=3)


# ── Requests ─────────────────────────────────────────────────────────────────


class Address(BaseModel):
    street: str
    city: Optional[str] = None
    state: Optional[str] = None
    zipcode: Optional[str] = None


class VisitStart(BaseModel):
    client_id: Optional[str] = None
    address: Optional[Address] = None
    company_id: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    gps_accuracy: Optional[float] = None
    altitude: Optional[float] = None
    altitude_accuracy: Optional[float] = None


class RoomSave(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    name_source: str = 'default'
    floor: str = '1'
    floor_source: str = 'default'
    room_type: Optional[str] = Field(default=None, max_length=30)
    position: int = 0


class ShotUpdate(BaseModel):
    room_id: Optional[str] = None
    kind: Optional[str] = None
    wall: Optional[int] = None


class ClaimLink(BaseModel):
    claim_id: Optional[str] = None


# ── Helpers ──────────────────────────────────────────────────────────────────


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _is_uuid(value: Any) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except (TypeError, ValueError):
        return False


def _require_visit(db: Any, staff: Any, visit_id: str) -> FieldVisit:
    """404 unless the visit exists and its client is one this person may see"""
    visit = db.query(FieldVisit).filter(FieldVisit.id == visit_id).first() if _is_uuid(visit_id) else None
    if visit is None:
        raise HTTPException(status_code=404, detail="Visit not found")
    require_client(db, staff, visit.client_id, "Visit")
    return visit


def _require_key(value: str, label: str) -> None:
    if not _is_uuid(value):
        raise HTTPException(status_code=400, detail=f"Bad {label} id")


def _file_home(visit: FieldVisit) -> Tuple[str, str]:
    """Where the visit's photos are filed"""
    if visit.claim_id:
        return CLAIM_CONTEXT, str(visit.claim_id)
    return VISIT_CONTEXT, str(visit.id)


def _parse_time(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None


def _full_address(client: Client) -> str:
    place = ' '.join(part for part in (client.state or '', client.zipcode or '') if part)
    return ', '.join(part for part in (client.address or '', client.city or '', place) if part)


def _room_out(room: FieldRoom) -> Dict[str, Any]:
    return {
        'id': room.id,
        'name': room.name,
        'name_source': room.name_source,
        'floor': room.floor,
        'floor_source': room.floor_source,
        'room_type': room.room_type,
        'position': room.position,
    }


def _shot_out(shot: FieldShot, file: Optional[File]) -> Dict[str, Any]:
    video = bool(file and is_video(file.content_type))
    return {
        'id': shot.id,
        'room_id': shot.room_id,
        'file_id': shot.file_id,
        'kind': shot.kind,
        'wall': shot.wall,
        'captured_at': shot.captured_at.isoformat() if shot.captured_at else None,
        'moved': bool(shot.moved),
        'ai_room_type': shot.ai_room_type,
        'is_video': video,
        'thumbnail_url': f"/api/files/preview/{shot.file_id}",
        'url': f"/api/files/video/{shot.file_id}" if video else f"/api/files/download/{shot.file_id}?inline=true",
    }


def _client_out(client: Client) -> Dict[str, Any]:
    return {
        'id': str(client.id),
        'display_name': client.display_name,
        'owners': client.owners or [],
        'address': client.address,
        'city': client.city,
        'state': client.state,
        'zipcode': client.zipcode,
        'phone': client.phone,
        'email': client.email,
        'full_address': _full_address(client),
    }


def _visit_detail(db: Any, staff: Any, visit: FieldVisit) -> Dict[str, Any]:
    client = db.query(Client).filter(Client.id == visit.client_id).first()
    rooms = db.query(FieldRoom).filter(FieldRoom.visit_id == visit.id).order_by(
        FieldRoom.position, FieldRoom.created_at,
    ).all()
    # A file deleted from a gallery takes its shot off the visit too
    rows = db.query(FieldShot, File).join(File, File.id == FieldShot.file_id).filter(
        FieldShot.visit_id == visit.id,
        File.is_active.is_(True),
    ).order_by(FieldShot.captured_at, FieldShot.created_at).all()
    contracts = scoped(
        db.query(ContractInstance).filter(
            ContractInstance.client_id == visit.client_id,
            ContractInstance.status != 'voided',
        ),
        document_condition(db, staff, ContractInstance.claim_id, ContractInstance.company_id),
    ).order_by(ContractInstance.created_at).all()
    # A client can have claims with another company on them, which stay out of sight
    claims = scoped(
        db.query(Claim).filter(Claim.client_id == visit.client_id),
        claim_condition(db, staff, Claim.id),
    ).order_by(Claim.created_at.desc()).all()
    return {
        'id': str(visit.id),
        'claim_id': str(visit.claim_id) if visit.claim_id else None,
        'ground_altitude': visit.ground_altitude,
        'started_at': visit.created_at.isoformat() if visit.created_at else None,
        'client': _client_out(client),
        'rooms': [_room_out(room) for room in rooms],
        'shots': [_shot_out(shot, file) for shot, file in rows],
        'contracts': [
            {
                'id': str(contract.id),
                'title': contract.title,
                'contract_number': contract.contract_number,
                'status': contract.status,
                'pdf_url': f"/api/contracts/contracts/{contract.id}/pdf",
            }
            for contract in contracts
        ],
        'claims': [
            {
                'id': str(claim.id),
                'claim_number': claim.claim_number,
                'claim_type': claim.claim_type,
                'company_id': str(claim.company_id) if claim.company_id else None,
            }
            for claim in claims
        ],
    }


def _company_for_new_client(db: Any, staff: Any, wanted: Optional[str]) -> Optional[str]:
    """A client shows to the people of the company managing it until it has a claim"""
    own = company_ids(db, staff)
    if own is None:
        return wanted
    if not own:
        raise HTTPException(status_code=400, detail="You don't belong to a company yet. Ask an admin to add you to one.")
    if wanted and wanted in own:
        return wanted
    home = home_company_ids(db, staff)
    return (home or own)[0]


def _client_for_visit(db: Any, staff: Any, data: VisitStart) -> Tuple[Client, bool]:
    """The client named, the one at this address, or a new one with only the address.
    Its name is the address until there's an owner, which an empty `owners` marks."""
    if data.client_id:
        require_client(db, staff, data.client_id)
        return db.query(Client).filter(Client.id == data.client_id).first(), False

    street = (data.address.street if data.address else '').strip()
    if not street:
        raise HTTPException(status_code=400, detail="Enter the address")
    zipcode = (data.address.zipcode or '').strip() or None
    existing = find_client_at_address(db, staff, street, zipcode)
    if existing:
        return existing, False

    client = Client(
        display_name=street,
        owners=[],
        address=street,
        normalized_address=normalize_address(street),
        city=(data.address.city or '').strip() or None,
        state=(data.address.state or '').strip() or None,
        zipcode=zipcode,
        company_id=_company_for_new_client(db, staff, data.company_id),
        is_active=True,
    )
    db.add(client)
    db.flush()
    return client, True


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get("/reverse-geocode")
def address_here(
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
):
    """The address at the phone's position. 503 means ask for it instead."""
    found = reverse_geocode(lat, lng)
    if not found:
        raise HTTPException(status_code=503, detail="No address found here")
    return found


@router.get("/companies")
def companies_for_new_client(staff: Any = Depends(get_current_staff), db: Any = Depends(get_db)):
    """Who a new client can be under, and who it goes under unless someone says otherwise"""
    own = company_ids(db, staff)
    query = db.query(Company).filter(Company.is_active.is_(True))
    query = query.filter(Company.company_type == 'contractor') if own is None else query.filter(Company.id.in_(own))
    home = home_company_ids(db, staff)
    rows = query.order_by(Company.name).all()
    return {
        'companies': [{'id': str(company.id), 'name': company.name} for company in rows],
        'default_id': (home or [None])[0] or (str(rows[0].id) if rows else None),
    }


@router.get("/")
def list_visits(
    client_id: Optional[str] = None,
    limit: int = Query(default=30, le=100),
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    """The latest visits this person may see, their own first"""
    query = scoped(
        db.query(FieldVisit, Client).join(Client, Client.id == FieldVisit.client_id),
        client_condition(db, staff, FieldVisit.client_id),
    )
    if client_id:
        if not _is_uuid(client_id):
            raise HTTPException(status_code=404, detail="Client not found")
        query = query.filter(FieldVisit.client_id == client_id)
    rows = query.order_by(FieldVisit.last_activity_at.desc()).limit(limit).all()

    visit_ids = [visit.id for visit, _ in rows]
    shot_counts = dict(db.query(FieldShot.visit_id, func.count(FieldShot.id)).filter(
        FieldShot.visit_id.in_(visit_ids),
    ).group_by(FieldShot.visit_id).all()) if visit_ids else {}
    room_counts = dict(db.query(FieldRoom.visit_id, func.count(FieldRoom.id)).filter(
        FieldRoom.visit_id.in_(visit_ids),
    ).group_by(FieldRoom.visit_id).all()) if visit_ids else {}

    me = str(staff.id)
    visits = [
        {
            'id': str(visit.id),
            'client_id': str(client.id),
            'client_name': client.display_name,
            'address': _full_address(client),
            'claim_id': str(visit.claim_id) if visit.claim_id else None,
            'last_activity_at': visit.last_activity_at.isoformat() if visit.last_activity_at else None,
            'room_count': room_counts.get(visit.id, 0),
            'shot_count': shot_counts.get(visit.id, 0),
            'mine': str(visit.created_by_id) == me,
        }
        for visit, client in rows
    ]
    visits.sort(key=lambda row: not row['mine'])
    return {'visits': visits}


@router.post("/")
def start_visit(
    data: VisitStart,
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    """Open a visit for a client, making the client if the address is new"""
    client, client_created = _client_for_visit(db, staff, data)

    visit = None
    if not client_created:
        visit = db.query(FieldVisit).filter(
            FieldVisit.client_id == client.id,
            FieldVisit.last_activity_at >= _utcnow() - SAME_VISIT_WITHIN,
        ).order_by(FieldVisit.last_activity_at.desc()).first()
    resumed = visit is not None
    if visit is None:
        visit = FieldVisit(
            client_id=client.id,
            created_by_id=str(staff.id),
            latitude=data.latitude,
            longitude=data.longitude,
            gps_accuracy=data.gps_accuracy,
            ground_altitude=data.altitude,
            ground_altitude_accuracy=data.altitude_accuracy,
        )
        db.add(visit)
    db.commit()
    return {
        'id': str(visit.id),
        'client_id': str(client.id),
        'client_created': client_created,
        'resumed': resumed,
    }


@router.get("/{visit_id}")
def get_visit(
    visit_id: str,
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    return _visit_detail(db, staff, _require_visit(db, staff, visit_id))


@router.put("/{visit_id}/rooms/{room_id}")
def save_room(
    visit_id: str,
    room_id: str,
    data: RoomSave,
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    """Create or update a room. A phone that hasn't heard the AI named it yet doesn't
    undo that with its placeholder."""
    visit = _require_visit(db, staff, visit_id)
    _require_key(room_id, 'room')
    if data.floor not in FLOOR_LABELS:
        raise HTTPException(status_code=400, detail="Unknown floor")

    room = db.query(FieldRoom).filter(FieldRoom.id == room_id).first()
    if room is not None and str(room.visit_id) != str(visit.id):
        raise HTTPException(status_code=409, detail="That room belongs to another visit")
    if room is None:
        room = FieldRoom(id=room_id, visit_id=visit.id)
        db.add(room)
    if not (room.name_source == 'ai' and data.name_source == 'default'):
        room.name = data.name.strip() or room.name
        room.name_source = data.name_source
    if not (room.floor_source in ('ai', 'user') and data.floor_source in ('default', 'altitude')):
        room.floor = data.floor
        room.floor_source = data.floor_source
    if data.room_type:
        room.room_type = data.room_type
    room.position = data.position
    refile_room(db, room)
    visit.last_activity_at = _utcnow()
    db.commit()
    return _room_out(room)


@router.post("/{visit_id}/shots")
def upload_shot(
    visit_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = FileField(...),
    shot_id: str = Form(...),
    room_id: str = Form(...),
    kind: str = Form('wall'),
    wall: Optional[int] = Form(None),
    captured_at: Optional[str] = Form(None),
    latitude: Optional[float] = Form(None),
    longitude: Optional[float] = Form(None),
    gps_accuracy: Optional[float] = Form(None),
    altitude: Optional[float] = Form(None),
    altitude_accuracy: Optional[float] = Form(None),
    heading: Optional[float] = Form(None),
    pitch: Optional[float] = Form(None),
    steps: Optional[int] = Form(None),
    moved: bool = Form(False),
    # The phone's word for it: two uploads at once would both look first from here
    first_photo: bool = Form(False),
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    """Store one photo or video. Sending the same shot again answers with the first."""
    visit = _require_visit(db, staff, visit_id)
    _require_key(shot_id, 'shot')
    if kind not in SHOT_KINDS:
        raise HTTPException(status_code=400, detail="Unknown kind of shot")

    existing = db.query(FieldShot).filter(FieldShot.id == shot_id).first()
    if existing is not None:
        if str(existing.visit_id) != str(visit.id):
            raise HTTPException(status_code=409, detail="That shot belongs to another visit")
        return _shot_out(existing, db.query(File).filter(File.id == existing.file_id).first())

    room = db.query(FieldRoom).filter(FieldRoom.id == room_id, FieldRoom.visit_id == visit.id).first()
    if room is None:
        # The phone saves the room first and tries again
        raise HTTPException(status_code=409, detail="Save the room first")

    content_type = media_type_of(file.filename, file.content_type)
    video = is_video(content_type)
    if not video and not content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="Only photos and videos")

    filename = file.filename or f"{shot_id}.jpg"
    image: Optional[bytes] = None
    if video:
        if file.size and file.size > MAX_VIDEO_UPLOAD_BYTES:
            raise HTTPException(status_code=400, detail="That video is too large")
        size = file.size or 0
        payload: Any = file.file
    else:
        image = file.file.read()
        if len(image) > MAX_PHOTO_BYTES:
            raise HTTPException(status_code=400, detail="That photo is too large")
        if is_heic(content_type):
            from app.domains.storage.optimization import heic_to_jpeg
            image = heic_to_jpeg(image)
            filename = as_jpeg_name(filename)
            content_type = 'image/jpeg'
        size = len(image)
        payload = BytesIO(image)

    context, context_id = _file_home(visit)
    storage = StorageFactory.get_instance()
    result = storage.upload(
        file_data=payload,
        filename=filename,
        context=context,
        context_id=context_id,
        category='field-visit',
        content_type=browser_video_type(content_type) if video else content_type,
        # Hashing a video to look for a duplicate would mean reading it all again
        optimize=not video,
    )

    file_row = File(
        id=str(uuid.uuid4()),
        filename=result.file_id,
        original_name=filename[:255],
        content_type=content_type,
        size=size,
        url=result.file_url,
        thumbnail_url=result.thumbnail_url,
        storage_provider=storage.provider_name,
        context=context,
        context_id=context_id,
        category=room_label(room),
        uploaded_by=str(staff.id),
    )
    db.add(file_row)

    read_it = not video and should_read(room, first_photo, moved)
    shot = FieldShot(
        id=shot_id,
        visit_id=visit.id,
        room_id=room.id,
        file_id=file_row.id,
        kind=kind,
        wall=wall if kind == 'wall' else None,
        captured_at=_parse_time(captured_at) or _utcnow(),
        latitude=latitude,
        longitude=longitude,
        gps_accuracy=gps_accuracy,
        altitude=altitude,
        altitude_accuracy=altitude_accuracy,
        heading=heading,
        pitch=pitch,
        steps=steps,
        moved=moved,
    )
    db.add(shot)
    visit.last_activity_at = _utcnow()
    db.commit()

    if video:
        queue_processing(OWNER_FILE, file_row.id)
    if read_it:
        background_tasks.add_task(read_room_of_shot, shot_id, image)
    return _shot_out(shot, file_row)


@router.patch("/{visit_id}/shots/{shot_id}")
def update_shot(
    visit_id: str,
    shot_id: str,
    data: ShotUpdate,
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    """Put a shot in another room, or call it something else"""
    visit = _require_visit(db, staff, visit_id)
    shot = db.query(FieldShot).filter(FieldShot.id == shot_id, FieldShot.visit_id == visit.id).first()
    if shot is None:
        raise HTTPException(status_code=404, detail="Shot not found")
    changes = data.dict(exclude_unset=True)
    if 'room_id' in changes:
        room = db.query(FieldRoom).filter(
            FieldRoom.id == changes['room_id'], FieldRoom.visit_id == visit.id,
        ).first()
        if room is None:
            raise HTTPException(status_code=409, detail="Save the room first")
        shot.room_id = room.id
        db.query(File).filter(File.id == shot.file_id).update(
            {File.category: room_label(room)}, synchronize_session=False,
        )
    if 'kind' in changes:
        if changes['kind'] not in SHOT_KINDS:
            raise HTTPException(status_code=400, detail="Unknown kind of shot")
        shot.kind = changes['kind']
    if 'wall' in changes:
        shot.wall = changes['wall']
    visit.last_activity_at = _utcnow()
    db.commit()
    return _shot_out(shot, db.query(File).filter(File.id == shot.file_id).first())


@router.delete("/{visit_id}/shots/{shot_id}")
def delete_shot(
    visit_id: str,
    shot_id: str,
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    """Take a shot off the visit, the way a gallery deletes a file. Already gone is fine:
    a phone may be repeating a delete it never heard the answer to."""
    visit = _require_visit(db, staff, visit_id)
    shot = db.query(FieldShot).filter(FieldShot.id == shot_id, FieldShot.visit_id == visit.id).first()
    if shot is not None:
        db.query(File).filter(File.id == shot.file_id).update(
            {File.is_active: False}, synchronize_session=False,
        )
        db.delete(shot)
        db.commit()
    return {'deleted': True}


@router.put("/{visit_id}/claim")
def link_claim(
    visit_id: str,
    data: ClaimLink,
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    """Put the visit on one of the client's claims, or take it off. Its photos move
    with it, so they're listed once and go wherever that claim's photos go."""
    visit = _require_visit(db, staff, visit_id)
    if data.claim_id:
        require_claim(db, staff, data.claim_id)
        claim = db.query(Claim).filter(Claim.id == data.claim_id).first()
        if claim is None or str(claim.client_id) != str(visit.client_id):
            raise HTTPException(status_code=400, detail="That claim is another client's")
    visit.claim_id = data.claim_id or None
    context, context_id = _file_home(visit)
    file_ids = [row[0] for row in db.query(FieldShot.file_id).filter(FieldShot.visit_id == visit.id).all()]
    if file_ids:
        db.query(File).filter(File.id.in_(file_ids)).update(
            {File.context: context, File.context_id: context_id}, synchronize_session=False,
        )
    db.commit()
    return {'claim_id': str(visit.claim_id) if visit.claim_id else None}
