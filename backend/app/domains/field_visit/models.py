"""
A field visit: someone on site documents a property room by room.

Rooms and shots take their ids from the phone, so a photo taken with no signal
has its identity before it reaches the server and sending it twice changes nothing.
The picture itself is an ordinary row of the files table.
"""

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Index, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType


class FieldVisit(Base, BaseModel):
    __tablename__ = "field_visits"
    __table_args__ = (
        Index('ix_field_visits_client_id', 'client_id'),
        Index('ix_field_visits_company_id', 'company_id'),
        Index('ix_field_visits_last_activity_at', 'last_activity_at'),
        {'extend_existing': True},
    )

    client_id = Column(UUIDType(), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False)
    # Set when the office puts the visit on a claim; its photos then live on that claim
    claim_id = Column(UUIDType(), ForeignKey("claims.id", ondelete="SET NULL"), nullable=True)
    created_by_id = Column(UUIDType(), ForeignKey("staff.id", ondelete="SET NULL"), nullable=True)
    # Whose visit it is: only that company's people see and change it, besides admins.
    # None leaves it to admins.
    company_id = Column(UUIDType(), ForeignKey("companies.id", ondelete="SET NULL"), nullable=True)

    latitude = Column(Float)
    longitude = Column(Float)
    gps_accuracy = Column(Float)
    # Taken at the door, so it counts as the first floor
    ground_altitude = Column(Float)
    ground_altitude_accuracy = Column(Float)

    last_activity_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    rooms = relationship("FieldRoom", back_populates="visit", cascade="all, delete-orphan")
    shots = relationship("FieldShot", back_populates="visit", cascade="all, delete-orphan")


class FieldRoom(Base):
    __tablename__ = "field_rooms"
    __table_args__ = (
        Index('ix_field_rooms_visit_id', 'visit_id'),
        {'extend_existing': True},
    )

    id = Column(String(36), primary_key=True)  # Made by the phone
    visit_id = Column(UUIDType(), ForeignKey("field_visits.id", ondelete="CASCADE"), nullable=False)

    name = Column(String(100), nullable=False)
    name_source = Column(String(10), nullable=False, default='default')  # default | ai | user
    floor = Column(String(2), nullable=False, default='1')  # B | 1 | 2 | 3 | A
    floor_source = Column(String(10), nullable=False, default='default')  # default | altitude | ai | user
    room_type = Column(String(30))  # kitchen, bathroom...: picked, or read from its first photo
    position = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    visit = relationship("FieldVisit", back_populates="rooms")
    shots = relationship("FieldShot", back_populates="room", cascade="all, delete-orphan")


class FieldShot(Base):
    __tablename__ = "field_shots"
    __table_args__ = (
        Index('ix_field_shots_visit_id', 'visit_id'),
        Index('ix_field_shots_room_id', 'room_id'),
        Index('ix_field_shots_file_id', 'file_id'),
        {'extend_existing': True},
    )

    id = Column(String(36), primary_key=True)  # Made by the phone
    visit_id = Column(UUIDType(), ForeignKey("field_visits.id", ondelete="CASCADE"), nullable=False)
    room_id = Column(String(36), ForeignKey("field_rooms.id", ondelete="CASCADE"), nullable=False)
    file_id = Column(String(36), nullable=False)

    kind = Column(String(10), nullable=False, default='wall')  # wall | demo | video
    wall = Column(Integer)  # 1 to 4, for a wall

    captured_at = Column(DateTime(timezone=True))
    # What the phone knew then. Kept raw, because floor guesses from altitude
    # can only be tuned against real visits
    latitude = Column(Float)
    longitude = Column(Float)
    gps_accuracy = Column(Float)
    altitude = Column(Float)
    altitude_accuracy = Column(Float)
    heading = Column(Float)
    pitch = Column(Float)
    steps = Column(Integer)  # Walked since the shot before it

    moved = Column(Boolean, nullable=False, default=False)  # Enough steps that this may be another room
    ai_room_type = Column(String(30))
    ai_basement = Column(Boolean)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    visit = relationship("FieldVisit", back_populates="shots")
    room = relationship("FieldRoom", back_populates="shots")
