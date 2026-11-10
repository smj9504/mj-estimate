"""
A client's signature and initials kept on file.

The office can sign the client's lines on a contract with them, with the
customer not there (contract/signature_on_file.py), and on-site signing can use
them too. They get here two ways: the customer ticks "keep on file" while
signing on site, or staff draw, type or upload them on the client page. One
signature and one set of initials per client; keeping a new one replaces it.

Everyone who can see the client can see and change them, as with the rest of
the client's record. Nothing public ever serves them.
"""

import base64
import binascii
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.database_factory import get_db_session as get_db
from app.domains.auth.company_scope import require_client
from app.domains.auth.dependencies import get_current_staff
from app.domains.client.models import ClientSignature
from app.domains.staff.models import Staff

KINDS = ('signature', 'initial')
# onsite: the customer kept it while signing. The rest are staff on the client page
SOURCES = ('onsite', 'drawn', 'typed', 'uploaded')
STAFF_SOURCES = ('drawn', 'typed', 'uploaded')

# A signature is a few KB; this leaves room for an uploaded picture of one
MAX_IMAGE_BYTES = 600 * 1024
_IMAGE_TYPES = {
    'data:image/png;base64': b'\x89PNG\r\n\x1a\n',
    'data:image/jpeg;base64': b'\xff\xd8\xff',
}

router = APIRouter()


def image_problem(value: Any) -> Optional[str]:
    """Why this can't be kept as a signature image, if it can't"""
    if not isinstance(value, str) or ',' not in value:
        return "The signature must be a PNG or JPEG image"
    header, _, payload = value.partition(',')
    magic = _IMAGE_TYPES.get(header.lower())
    if magic is None:
        return "The signature must be a PNG or JPEG image"
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        return "The signature image couldn't be read"
    if not raw.startswith(magic):
        return "The signature image couldn't be read"
    if len(raw) > MAX_IMAGE_BYTES:
        return "The signature image is too large"
    return None


def on_file(db: Any, client_id: Any) -> Dict[str, ClientSignature]:
    """The client's signature and initials on file, by kind"""
    if not client_id:
        return {}
    rows = db.query(ClientSignature).filter(ClientSignature.client_id == str(client_id)).all()
    return {row.kind: row for row in rows if row.kind in KINDS}


def describe(row: Optional[ClientSignature]) -> Optional[Dict[str, Any]]:
    if row is None:
        return None
    kept = row.updated_at or row.created_at
    return {
        'kind': row.kind,
        'image': row.image,
        'signer_name': row.signer_name,
        'source': row.source,
        'kept_at': kept.isoformat() if kept else None,
        'saved_by_name': row.saved_by_name,
        'contract_id': str(row.contract_id) if row.contract_id else None,
    }


def describe_all(rows: Dict[str, ClientSignature]) -> Dict[str, Optional[Dict[str, Any]]]:
    return {kind: describe(rows.get(kind)) for kind in KINDS}


def staff_name(db: Any, staff_id: Any) -> Optional[str]:
    row = db.query(Staff.first_name, Staff.last_name, Staff.username).filter(Staff.id == str(staff_id)).first()
    if not row:
        return None
    return f"{row[0] or ''} {row[1] or ''}".strip() or row[2]


def keep(
    db: Any,
    client_id: Any,
    kind: str,
    image: str,
    signer_name: str,
    source: str,
    saved_by_id: Any = None,
    saved_by_name: Optional[str] = None,
    consent_text: Optional[str] = None,
    contract_id: Any = None,
) -> ClientSignature:
    """Keep this as the client's signature or initials, replacing what was on
    file. Flushed, not committed: the caller's transaction decides."""
    if kind not in KINDS:
        raise ValueError("Unknown kind of signature")
    if source not in SOURCES:
        raise ValueError("Unknown signature source")
    problem = image_problem(image)
    if problem:
        raise ValueError(problem)
    name = (signer_name or '').strip()
    if not name:
        raise ValueError("Enter whose signature this is")

    row = on_file(db, client_id).get(kind)
    if row is None:
        row = ClientSignature(client_id=str(client_id), kind=kind)
        db.add(row)
    row.image = image
    row.signer_name = name[:255]
    row.source = source
    row.consent_text = consent_text
    row.contract_id = str(contract_id) if contract_id else None
    row.saved_by_id = str(saved_by_id) if saved_by_id else None
    row.saved_by_name = (saved_by_name or '')[:255] or None
    db.flush()
    return row


# ── Endpoints ────────────────────────────────────────────────────────────────


class SignatureKeep(BaseModel):
    image: str
    signer_name: str
    source: str = 'drawn'


def _require_kind(kind: str) -> None:
    if kind not in KINDS:
        raise HTTPException(status_code=404, detail="Not found")


@router.get("/{client_id}/signatures")
def get_signatures(
    client_id: str,
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    """The client's signature and initials on file; null for a kind with none"""
    require_client(db, staff, client_id)
    return describe_all(on_file(db, client_id))


@router.put("/{client_id}/signatures/{kind}")
def put_signature(
    client_id: str,
    kind: str,
    data: SignatureKeep,
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    """Keep a signature or initials staff drew, typed or uploaded, replacing any on file"""
    _require_kind(kind)
    require_client(db, staff, client_id)
    if data.source not in STAFF_SOURCES:
        raise HTTPException(status_code=400, detail="Unknown signature source")
    try:
        keep(
            db, client_id, kind, data.image, data.signer_name, data.source,
            saved_by_id=staff.id, saved_by_name=staff_name(db, staff.id),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    return describe_all(on_file(db, client_id))


@router.delete("/{client_id}/signatures/{kind}")
def delete_signature(
    client_id: str,
    kind: str,
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    """Take a signature or initials off file. Contracts already signed with it keep it."""
    _require_kind(kind)
    require_client(db, staff, client_id)
    db.query(ClientSignature).filter(
        ClientSignature.client_id == client_id, ClientSignature.kind == kind,
    ).delete(synchronize_session=False)
    db.commit()
    return describe_all(on_file(db, client_id))
