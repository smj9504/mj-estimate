"""
Messages between staff: one-to-one and group conversations
"""

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType


class Conversation(Base, BaseModel):
    __tablename__ = "conversations"
    __table_args__ = {'extend_existing': True}

    # A group's name; one-to-one conversations have none
    title = Column(String(200))
    is_group = Column(Boolean, default=False, nullable=False)
    created_by_id = Column(UUIDType(), ForeignKey("staff.id", ondelete="SET NULL"))
    # Orders the inbox; set whenever a message is posted
    last_message_at = Column(DateTime(timezone=True), index=True)

    participants = relationship(
        "ConversationParticipant", back_populates="conversation", cascade="all, delete-orphan"
    )


class ConversationParticipant(Base, BaseModel):
    __tablename__ = "conversation_participants"
    __table_args__ = (
        UniqueConstraint('conversation_id', 'staff_id', name='uq_conversation_participant'),
        {'extend_existing': True},
    )

    conversation_id = Column(
        UUIDType(), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    staff_id = Column(UUIDType(), ForeignKey("staff.id", ondelete="CASCADE"), nullable=False, index=True)
    # Messages after this are unread for this person
    last_read_at = Column(DateTime(timezone=True))

    conversation = relationship("Conversation", back_populates="participants")


class Message(Base, BaseModel):
    __tablename__ = "messages"
    __table_args__ = (
        Index('ix_messages_conversation_created', 'conversation_id', 'created_at'),
        {'extend_existing': True},
    )

    conversation_id = Column(
        UUIDType(), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    sender_id = Column(UUIDType(), ForeignKey("staff.id", ondelete="SET NULL"))
    # text: typed by a person; document_transfer: an estimate or invoice sent
    # to accept; notice: an automatic line such as "accepted" or "left the group"
    kind = Column(String(30), default='text', nullable=False)
    body = Column(Text, nullable=False)
    related_type = Column(String(30))
    related_id = Column(UUIDType())
