"""
Telling which room a photo shows, since a browser has nothing that can.

Asked about a room's first photo, which names it if nobody has, and about the
first photo after someone has walked a fair way: a different answer there is
what offers "Bathroom?" on the camera. A basement can also be told from the
photo, which altitude rarely manages.
"""

import asyncio
import logging
from typing import Any, Dict, Optional

from app.core.config import settings
from app.core.database_factory import get_database

from .models import FieldRoom, FieldShot
from .rooms import refile_room, unique_room_name

logger = logging.getLogger(__name__)

ROOM_TITLES: Dict[str, str] = {
    'kitchen': 'Kitchen',
    'bathroom': 'Bathroom',
    'bedroom': 'Bedroom',
    'living_room': 'Living room',
    'dining_room': 'Dining room',
    'hallway': 'Hallway',
    'stairs': 'Stairs',
    'laundry': 'Laundry',
    'closet': 'Closet',
    'office': 'Office',
    'garage': 'Garage',
    'utility': 'Utility',
    'basement': 'Basement',
    'attic': 'Attic',
    'exterior': 'Exterior',
}
OTHER = 'other'

ROOM_PROMPT = """This photo was taken while documenting a house room by room, often after water damage, so the room may be emptied, torn up or under repair.

Say which room it shows, going by plumbing, fixtures, built-ins and what's left in it. Use "other" when it is none of the listed rooms.

basement: true only for a below-grade space, such as foundation walls, exposed joists overhead, small windows high on the wall, or a sump pump or furnace.

confident: false when the photo is a close-up or shows too little of the room to tell."""

ROOM_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "room": {"type": "string", "enum": [*ROOM_TITLES, OTHER]},
        "basement": {"type": "boolean"},
        "confident": {"type": "boolean"},
    },
    "required": ["room", "basement", "confident"],
    "additionalProperties": False,
}


def can_read_rooms() -> bool:
    return settings.ENABLE_AI_PHOTO_CLASSIFICATION and bool(settings.ANTHROPIC_API_KEY or settings.GEMINI_API_KEY)


def should_read(room: FieldRoom, first_photo: bool, moved: bool) -> bool:
    """Only where the answer can change something; each one is a paid API call"""
    return can_read_rooms() and (moved or (first_photo and room.room_type is None))


async def _ask(image: bytes) -> Optional[Dict[str, Any]]:
    from app.domains.water_mitigation.ai_classification_service import (
        _parse_json_response,
        _resize_image,
        ai_classification_service,
    )

    resized, mime_type = await asyncio.to_thread(_resize_image, image, max_size=1280)
    text = await ai_classification_service._call_vision(
        prompt=ROOM_PROMPT,
        schema=ROOM_SCHEMA,
        image_data=resized,
        mime_type=mime_type,
        max_output_tokens=256,
    )
    return _parse_json_response(text)


def apply_reading(db: Any, shot: FieldShot, reading: Dict[str, Any]) -> None:
    """Note what the photo showed. Nothing someone chose by hand is overruled."""
    if not reading.get('confident'):
        return
    room_type = reading.get('room')
    if room_type != OTHER and room_type not in ROOM_TITLES:
        return
    room = shot.room
    shot.ai_room_type = room_type
    shot.ai_basement = bool(reading.get('basement'))

    if room.room_type is None:
        room.room_type = room_type
        if room.name_source != 'user' and room_type != OTHER:
            room.name = unique_room_name(db, room.visit_id, ROOM_TITLES[room_type], room.id)
            room.name_source = 'ai'
    if shot.ai_basement and room.floor_source in ('default', 'altitude'):
        room.floor = 'B'
        room.floor_source = 'ai'
    refile_room(db, room)


def read_room_of_shot(shot_id: str, image: bytes) -> None:
    """Runs after the upload has answered. Failing only means the room keeps its name."""
    try:
        reading = asyncio.run(_ask(image))
    except Exception as e:
        logger.warning(f"Could not read the room in shot {shot_id}: {e}")
        return
    if not reading:
        return

    session = get_database().get_session()
    try:
        shot = session.query(FieldShot).filter(FieldShot.id == shot_id).first()
        if shot:
            apply_reading(session, shot, reading)
            session.commit()
    except Exception as e:
        session.rollback()
        logger.warning(f"Could not save the room read from shot {shot_id}: {e}")
    finally:
        session.close()
