"""
A room's name and floor, and keeping its photos filed under them.
"""

from typing import Any, Dict, Optional

from app.domains.file.models import File

from .models import FieldRoom, FieldShot

FLOOR_LABELS: Dict[str, str] = {
    'B': 'Basement',
    '1': '1st floor',
    '2': '2nd floor',
    '3': '3rd floor',
    'A': 'Attic',
}


def room_label(room: FieldRoom) -> str:
    """What the photo galleries show as its category. files.category is 50 long."""
    return f"{FLOOR_LABELS.get(room.floor, room.floor)} · {room.name}"[:50]


def refile_room(db: Any, room: FieldRoom) -> None:
    """Keep the gallery category of the room's photos in step with its name and floor"""
    db.flush()
    file_ids = [row[0] for row in db.query(FieldShot.file_id).filter(FieldShot.room_id == room.id).all()]
    if file_ids:
        db.query(File).filter(File.id.in_(file_ids)).update(
            {File.category: room_label(room)}, synchronize_session=False,
        )


def unique_room_name(db: Any, visit_id: Any, wanted: str, room_id: Optional[str] = None) -> str:
    """Bedroom, then Bedroom 2: a house has several of some rooms"""
    query = db.query(FieldRoom.name).filter(FieldRoom.visit_id == visit_id)
    if room_id:
        query = query.filter(FieldRoom.id != room_id)
    taken = {row[0] for row in query.all()}
    if wanted not in taken:
        return wanted
    number = 2
    while f"{wanted} {number}" in taken:
        number += 1
    return f"{wanted} {number}"
