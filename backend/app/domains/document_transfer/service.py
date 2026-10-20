"""
Offering an estimate or invoice to someone else.

Sending creates a pending offer and a message to the recipient. The recipient
gets their own copy (new number, draft, payments cleared) only on accepting;
the sender keeps the original either way.
"""

from typing import Any, Dict, Iterable, List, Optional

from app.core import database_factory
from app.domains.document_transfer.models import DocumentTransfer
from app.domains.estimate.models import Estimate
from app.domains.invoice.models import Invoice
from app.domains.messaging.service import MessagingService, iso, utcnow

# document_type -> (model, number column, label, page that opens it)
DOCUMENT_TYPES = {
    'estimate': (Estimate, 'estimate_number', 'Estimate', '/edit/estimate/{id}'),
    'invoice': (Invoice, 'invoice_number', 'Invoice', '/invoices/{id}/edit'),
}


class TransferNotFound(Exception):
    """No such offer, or it isn't this person's to act on"""


class TransferClosed(Exception):
    """The offer was already accepted, declined or cancelled"""


class SourceGone(Exception):
    """The original document was deleted before the offer was accepted"""


def document_type_info(document_type: str):
    if document_type not in DOCUMENT_TYPES:
        raise ValueError("document_type must be 'estimate' or 'invoice'")
    return DOCUMENT_TYPES[document_type]


def describe(transfer: DocumentTransfer) -> str:
    """Estimate #1234 (Jane Doe)"""
    _, _, label, _ = DOCUMENT_TYPES[transfer.document_type]
    text = f"{label} #{transfer.document_number or '—'}"
    if transfer.client_name:
        text += f" ({transfer.client_name})"
    return text


class DocumentTransferService:
    def __init__(self, db: Any):
        self.db = db
        self.messaging = MessagingService(db)

    def send(
        self,
        staff: Any,
        document_type: str,
        document_id: str,
        recipient_ids: Iterable[str],
        note: Optional[str] = None,
    ) -> List[DocumentTransfer]:
        """Offer a document to each recipient. The caller has checked that
        this person may open the document."""
        model, number_field, label, _ = document_type_info(document_type)
        document = self.db.query(model).filter(model.id == str(document_id)).first()
        if document is None:
            raise ValueError(f"{label} not found")

        me = str(staff.id)
        recipients = self.messaging.require_active_staff(set(map(str, recipient_ids)) - {me})
        if not recipients:
            raise ValueError("Pick someone other than yourself")
        note = (note or '').strip() or None

        transfers = []
        for recipient_id in recipients:
            pending = self.db.query(DocumentTransfer).filter(
                DocumentTransfer.source_id == str(document.id),
                DocumentTransfer.to_staff_id == recipient_id,
                DocumentTransfer.status == 'pending',
            ).first()
            if pending:
                # Already waiting for them; don't offer it twice
                transfers.append(pending)
                continue

            transfer = DocumentTransfer(
                document_type=document_type,
                source_id=str(document.id),
                document_number=getattr(document, number_field),
                client_name=document.client_name,
                from_staff_id=me,
                to_staff_id=recipient_id,
                note=note,
                status='pending',
            )
            self.db.add(transfer)
            self.db.flush()

            body = f"Sent you {describe(transfer)}. Accept it to get your own copy."
            if note:
                body += f"\n\n{note}"
            conversation = self.messaging.direct_conversation(me, recipient_id)
            self.messaging.post(
                conversation, me, body,
                kind='document_transfer', related_type='document_transfer', related_id=transfer.id,
            )
            transfers.append(transfer)
        return transfers

    def _for_recipient(self, transfer_id: str, staff: Any) -> DocumentTransfer:
        transfer = self._get(transfer_id)
        if transfer is None or str(transfer.to_staff_id) != str(staff.id):
            raise TransferNotFound()
        if transfer.status != 'pending':
            raise TransferClosed()
        return transfer

    def _get(self, transfer_id: str) -> Optional[DocumentTransfer]:
        try:
            return self.db.query(DocumentTransfer).filter(DocumentTransfer.id == str(transfer_id)).first()
        except ValueError:  # not a UUID
            return None

    def accept(self, staff: Any, transfer_id: str) -> DocumentTransfer:
        """Copy the document, as it is now, into the recipient's own list"""
        transfer = self._for_recipient(transfer_id, staff)
        copy = self._copy(transfer, owner_id=str(staff.id))
        if copy is None:
            transfer.status = 'cancelled'
            transfer.responded_at = utcnow()
            self.db.flush()
            raise SourceGone()

        transfer.status = 'accepted'
        transfer.copy_id = copy['id']
        transfer.responded_at = utcnow()
        self._reply(transfer, staff, f"Accepted {describe(transfer)}")
        return transfer

    def decline(self, staff: Any, transfer_id: str) -> DocumentTransfer:
        transfer = self._for_recipient(transfer_id, staff)
        transfer.status = 'declined'
        transfer.responded_at = utcnow()
        self._reply(transfer, staff, f"Declined {describe(transfer)}")
        return transfer

    def cancel(self, staff: Any, transfer_id: str) -> DocumentTransfer:
        """The sender takes back an offer that hasn't been answered"""
        transfer = self._get(transfer_id)
        if transfer is None or str(transfer.from_staff_id) != str(staff.id):
            raise TransferNotFound()
        if transfer.status != 'pending':
            raise TransferClosed()
        transfer.status = 'cancelled'
        transfer.responded_at = utcnow()
        self._reply(transfer, staff, f"Took back {describe(transfer)}")
        return transfer

    def _reply(self, transfer: DocumentTransfer, staff: Any, body: str) -> None:
        """Note the answer in the conversation the offer came through"""
        other = transfer.from_staff_id if str(staff.id) == str(transfer.to_staff_id) else transfer.to_staff_id
        if not other:
            self.db.flush()
            return
        conversation = self.messaging.direct_conversation(staff.id, other)
        self.messaging.post(
            conversation, staff.id, body,
            kind='transfer_reply', related_type='document_transfer', related_id=transfer.id,
        )

    def _copy(self, transfer: DocumentTransfer, owner_id: str) -> Optional[Dict[str, Any]]:
        """The recipient's copy: a new number, draft, and for an invoice no
        payments. It keeps the original's company."""
        from app.domains.estimate.service import EstimateService
        from app.domains.invoice.service import InvoiceService

        service_class = EstimateService if transfer.document_type == 'estimate' else InvoiceService
        service = service_class(database_factory.get_database())
        return service.duplicate(str(transfer.source_id), owner_id=owner_id)

    # Lists

    def incoming(self, staff: Any, status: Optional[str] = None) -> List[DocumentTransfer]:
        query = self.db.query(DocumentTransfer).filter(DocumentTransfer.to_staff_id == str(staff.id))
        if status:
            query = query.filter(DocumentTransfer.status == status)
        return query.order_by(DocumentTransfer.created_at.desc()).all()

    def outgoing(self, staff: Any, status: Optional[str] = None) -> List[DocumentTransfer]:
        query = self.db.query(DocumentTransfer).filter(DocumentTransfer.from_staff_id == str(staff.id))
        if status:
            query = query.filter(DocumentTransfer.status == status)
        return query.order_by(DocumentTransfer.created_at.desc()).all()

    def by_ids(self, transfer_ids: Iterable[Any]) -> Dict[str, DocumentTransfer]:
        ids = {str(i) for i in transfer_ids if i}
        if not ids:
            return {}
        rows = self.db.query(DocumentTransfer).filter(DocumentTransfer.id.in_(ids)).all()
        return {str(t.id): t for t in rows}

    def to_dicts(self, transfers: List[DocumentTransfer], viewer: Any) -> List[Dict[str, Any]]:
        names = self.messaging.names(
            {t.from_staff_id for t in transfers} | {t.to_staff_id for t in transfers}
        )
        return [self.to_dict(t, viewer, names) for t in transfers]

    def to_dict(self, transfer: DocumentTransfer, viewer: Any, names: Dict[str, str]) -> Dict[str, Any]:
        _, _, label, link = DOCUMENT_TYPES[transfer.document_type]
        is_recipient = str(viewer.id) == str(transfer.to_staff_id)
        # Only the recipient can open the copy
        copy_link = link.format(id=transfer.copy_id) if transfer.copy_id and is_recipient else None
        return {
            'id': str(transfer.id),
            'document_type': transfer.document_type,
            'document_label': label,
            'document_number': transfer.document_number,
            'client_name': transfer.client_name,
            'source_id': str(transfer.source_id),
            'from_staff_id': str(transfer.from_staff_id) if transfer.from_staff_id else None,
            'from_name': names.get(str(transfer.from_staff_id)),
            'to_staff_id': str(transfer.to_staff_id),
            'to_name': names.get(str(transfer.to_staff_id)),
            'note': transfer.note,
            'status': transfer.status,
            'copy_id': str(transfer.copy_id) if transfer.copy_id and is_recipient else None,
            'copy_link': copy_link,
            'created_at': iso(transfer.created_at),
            'responded_at': iso(transfer.responded_at),
        }
