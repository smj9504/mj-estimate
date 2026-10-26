"""
Offering estimates and invoices to other people. Mounted at
/api/document-transfers.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.database_factory import get_db_session as get_db
from app.domains.auth.company_scope import require_document
from app.domains.auth.dependencies import get_current_staff
from app.domains.auth.document_access import require_document_access
from app.domains.document_transfer.service import (
    DocumentTransferService,
    SourceGone,
    TransferClosed,
    TransferNotFound,
    document_type_info,
)

router = APIRouter()


class SendDocumentRequest(BaseModel):
    document_type: str = Field(..., pattern='^(estimate|invoice)$')
    document_id: str
    recipient_ids: List[str] = Field(..., min_length=1)
    note: Optional[str] = Field(None, max_length=2000)


@router.post("/")
def send_document(request: SendDocumentRequest, current_staff=Depends(get_current_staff), db=Depends(get_db)):
    """Offer a document to one or more people; each gets a message to accept it"""
    model, _, label, _ = document_type_info(request.document_type)
    require_document_access(db, model, request.document_id, current_staff, label)
    require_document(db, current_staff, model, request.document_id, label)

    service = DocumentTransferService(db)
    try:
        transfers = service.send(
            current_staff, request.document_type, request.document_id, request.recipient_ids, request.note
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    return service.to_dicts(transfers, current_staff)


@router.get("/incoming")
def incoming(
    status: Optional[str] = Query(None, description="pending, accepted, declined or cancelled"),
    current_staff=Depends(get_current_staff),
    db=Depends(get_db),
):
    service = DocumentTransferService(db)
    return service.to_dicts(service.incoming(current_staff, status), current_staff)


@router.get("/outgoing")
def outgoing(
    status: Optional[str] = Query(None, description="pending, accepted, declined or cancelled"),
    current_staff=Depends(get_current_staff),
    db=Depends(get_db),
):
    service = DocumentTransferService(db)
    return service.to_dicts(service.outgoing(current_staff, status), current_staff)


def _answer(action, transfer_id: str, current_staff, db):
    service = DocumentTransferService(db)
    try:
        transfer = action(service)(current_staff, transfer_id)
    except TransferNotFound:
        raise HTTPException(status_code=404, detail="Transfer not found")
    except TransferClosed:
        raise HTTPException(status_code=409, detail="This was already answered or taken back")
    except SourceGone:
        db.commit()  # keep it marked cancelled
        raise HTTPException(status_code=410, detail="The original was deleted, so there's nothing to copy")
    db.commit()
    return service.to_dicts([transfer], current_staff)[0]


@router.post("/{transfer_id}/accept")
def accept(transfer_id: str, current_staff=Depends(get_current_staff), db=Depends(get_db)):
    """Take a copy of the offered document into your own list"""
    return _answer(lambda s: s.accept, transfer_id, current_staff, db)


@router.post("/{transfer_id}/decline")
def decline(transfer_id: str, current_staff=Depends(get_current_staff), db=Depends(get_db)):
    return _answer(lambda s: s.decline, transfer_id, current_staff, db)


@router.post("/{transfer_id}/cancel")
def cancel(transfer_id: str, current_staff=Depends(get_current_staff), db=Depends(get_db)):
    """The sender takes back an offer that hasn't been answered"""
    return _answer(lambda s: s.cancel, transfer_id, current_staff, db)
