"""
Messages between staff: one-to-one and group conversations.

Mounted at /api/messages. The page asks /unread-count and the open
conversation's /messages?after=... on a timer; there's no push.
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.database_factory import get_db_session as get_db
from app.domains.auth.dependencies import get_current_staff
from app.domains.messaging.service import ConversationNotFound, MessagingService, parse_iso

router = APIRouter()


class StartConversationRequest(BaseModel):
    participant_ids: List[str] = Field(..., min_length=1)
    # Naming it, or picking more than one person, makes a group
    title: Optional[str] = Field(None, max_length=200)


class RenameConversationRequest(BaseModel):
    title: str = Field(..., max_length=200)


class AddParticipantsRequest(BaseModel):
    staff_ids: List[str] = Field(..., min_length=1)


class SendMessageRequest(BaseModel):
    body: str = Field(..., min_length=1, max_length=5000)


def _conversation_or_404(service: MessagingService, conversation_id: str, staff: Any):
    try:
        return service.require_conversation(conversation_id, staff.id)
    except ConversationNotFound:
        raise HTTPException(status_code=404, detail="Conversation not found")


def _summary(service: MessagingService, conversation: Any, staff: Any) -> Dict[str, Any]:
    member_ids = service.member_ids(conversation.id)
    return service.conversation_summary(conversation, str(staff.id), member_ids, service.names(member_ids))


def _message_dicts(service: MessagingService, messages: list, viewer: Any) -> List[Dict[str, Any]]:
    """Messages for the page, with each offered document's current state"""
    from app.domains.document_transfer.service import DocumentTransferService

    names = service.names({m.sender_id for m in messages})
    transfer_service = DocumentTransferService(service.db)
    transfers = transfer_service.by_ids(
        m.related_id for m in messages if m.related_type == 'document_transfer'
    )
    transfer_names = service.names(
        {t.from_staff_id for t in transfers.values()} | {t.to_staff_id for t in transfers.values()}
    )
    result = []
    for message in messages:
        item = service.message_dict(message, names)
        transfer = transfers.get(str(message.related_id)) if message.related_id else None
        item['transfer'] = transfer_service.to_dict(transfer, viewer, transfer_names) if transfer else None
        result.append(item)
    return result


@router.get("/people")
def list_people(current_staff=Depends(get_current_staff), db=Depends(get_db)):
    """Everyone who can be messaged or sent a document"""
    return MessagingService(db).people()


@router.get("/unread-count")
def unread_count(current_staff=Depends(get_current_staff), db=Depends(get_db)):
    return {'unread': MessagingService(db).unread_total(current_staff.id)}


@router.get("/conversations")
def list_conversations(current_staff=Depends(get_current_staff), db=Depends(get_db)):
    return MessagingService(db).inbox(current_staff.id)


@router.post("/conversations")
def start_conversation(
    request: StartConversationRequest,
    current_staff=Depends(get_current_staff),
    db=Depends(get_db),
):
    """Open a conversation; with one person and no name it reuses the
    existing one-to-one conversation"""
    service = MessagingService(db)
    try:
        conversation = service.start(current_staff, request.participant_ids, request.title)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    return _summary(service, conversation, current_staff)


@router.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: str, current_staff=Depends(get_current_staff), db=Depends(get_db)):
    service = MessagingService(db)
    conversation = _conversation_or_404(service, conversation_id, current_staff)
    return _summary(service, conversation, current_staff)


@router.patch("/conversations/{conversation_id}")
def rename_conversation(
    conversation_id: str,
    request: RenameConversationRequest,
    current_staff=Depends(get_current_staff),
    db=Depends(get_db),
):
    service = MessagingService(db)
    conversation = _conversation_or_404(service, conversation_id, current_staff)
    try:
        service.rename(conversation, current_staff, request.title)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    return _summary(service, conversation, current_staff)


@router.post("/conversations/{conversation_id}/participants")
def add_participants(
    conversation_id: str,
    request: AddParticipantsRequest,
    current_staff=Depends(get_current_staff),
    db=Depends(get_db),
):
    service = MessagingService(db)
    conversation = _conversation_or_404(service, conversation_id, current_staff)
    try:
        service.add_members(conversation, current_staff, request.staff_ids)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    return _summary(service, conversation, current_staff)


@router.delete("/conversations/{conversation_id}/participants/me")
def leave_conversation(conversation_id: str, current_staff=Depends(get_current_staff), db=Depends(get_db)):
    service = MessagingService(db)
    conversation = _conversation_or_404(service, conversation_id, current_staff)
    try:
        service.leave(conversation, current_staff)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    return {'left': True}


@router.get("/conversations/{conversation_id}/messages")
def list_messages(
    conversation_id: str,
    before: Optional[str] = Query(None, description="Older than this time, for scrolling back"),
    after: Optional[str] = Query(None, description="Newer than this time, for checking for new ones"),
    limit: int = Query(50, ge=1, le=200),
    current_staff=Depends(get_current_staff),
    db=Depends(get_db),
):
    service = MessagingService(db)
    conversation = _conversation_or_404(service, conversation_id, current_staff)
    try:
        messages = service.messages(conversation.id, before=parse_iso(before), after=parse_iso(after), limit=limit)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _message_dicts(service, messages, current_staff)


@router.post("/conversations/{conversation_id}/messages")
def send_message(
    conversation_id: str,
    request: SendMessageRequest,
    current_staff=Depends(get_current_staff),
    db=Depends(get_db),
):
    service = MessagingService(db)
    conversation = _conversation_or_404(service, conversation_id, current_staff)
    try:
        message = service.post(conversation, current_staff.id, request.body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    return _message_dicts(service, [message], current_staff)[0]


@router.post("/conversations/{conversation_id}/read")
def mark_read(conversation_id: str, current_staff=Depends(get_current_staff), db=Depends(get_db)):
    service = MessagingService(db)
    conversation = _conversation_or_404(service, conversation_id, current_staff)
    service.mark_read(conversation.id, current_staff.id)
    db.commit()
    return {'unread': service.unread_total(current_staff.id)}
