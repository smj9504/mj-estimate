"""
On-site signing: someone in the field finds the client (or starts from just an
address), picks what the document is for and which company it's from, fills in
what the template maps, and has the customer sign. The contract and, if needed,
the client are only created at that last step, so an abandoned visit leaves
nothing behind. The office then decides which claim the contract belongs to.
"""

import base64
import binascii
import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from starlette.responses import Response

from app.core.database_factory import get_database, get_db_session as get_db
from app.domains.auth.company_scope import (
    ALL_DATA_ROLES,
    client_condition,
    company_ids,
    require_client,
    require_document,
    scoped,
)
from app.domains.auth.dependencies import get_current_staff
from app.domains.client.address_utils import normalize_address
from app.domains.client.models import Client
from app.domains.company.models import Company
from app.domains.contract.models import ContractInstance, ContractTemplate
from app.domains.contract.onsite_signing import (
    SIGNING_PURPOSES,
    build_questions,
    expand_answers,
    has_signature_field,
    known_value,
    missing_fields,
    parse_mappings,
    signature_mappings,
)
from app.domains.contract.service import ContractInstanceService
from app.domains.contract.signature_lines import TASK_ASSIGN_CLAIM, signature_placement
from app.domains.staff.models import Staff

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Requests ─────────────────────────────────────────────────────────────────


class OnsiteAddress(BaseModel):
    street: str
    city: Optional[str] = None
    state: Optional[str] = None
    zipcode: Optional[str] = None


class OnsiteForm(BaseModel):
    template_id: UUID
    company_id: UUID
    client_id: Optional[UUID] = None
    address: Optional[OnsiteAddress] = None


class OnsitePreview(BaseModel):
    template_id: UUID
    company_id: UUID
    answers: Dict[str, Optional[str]] = {}
    # The device's date, so an evening signing isn't dated tomorrow (UTC)
    today: Optional[str] = None


class OnsiteContractCreate(OnsiteForm):
    answers: Dict[str, Optional[str]] = {}
    today: Optional[str] = None
    signer_name: str
    # Mapping id -> signature or initials image (data URL), or the date for date_signed
    signature_fields: Dict[str, str]
    consent_agreed: bool = False
    consent_text: Optional[str] = None


class OnsiteEmail(BaseModel):
    emails: List[str]


# ── Helpers ──────────────────────────────────────────────────────────────────


def _service() -> ContractInstanceService:
    return ContractInstanceService(get_database())


def _require_template(db: Any, staff: Any, template_id: Any, company_id: Any) -> Tuple[ContractTemplate, Company]:
    """A template this person may use on site: on the screen, of a contractor
    they belong to. 404 otherwise, as for anything out of their scope."""
    row = db.query(ContractTemplate, Company).join(
        Company, ContractTemplate.company_id == Company.id
    ).filter(
        ContractTemplate.id == str(template_id),
        ContractTemplate.company_id == str(company_id),
        ContractTemplate.is_active.is_(True),
        ContractTemplate.signing_purpose.isnot(None),
        Company.is_active.is_(True),
        Company.company_type == 'contractor',
    ).first()
    allowed = company_ids(db, staff)
    if row is None or (allowed is not None and str(company_id) not in allowed):
        raise HTTPException(status_code=404, detail="Template not found")
    return row[0], row[1]


def _full_address(address: OnsiteAddress) -> str:
    place = ' '.join(p.strip() for p in (address.state or '', address.zipcode or '') if p.strip())
    parts = [address.street.strip(), (address.city or '').strip(), place]
    return ', '.join(p for p in parts if p)


def _known_values(db: Any, company: Company, client_id: Any, address: Optional[OnsiteAddress]) -> Dict[str, Any]:
    """What's on record before anyone is asked anything"""
    known: Dict[str, Any] = {
        'company': {
            'name': company.name,
            'address': company.address,
            'phone': company.phone,
            'email': company.email,
            'license_number': company.license_number,
        },
    }
    if client_id:
        client = db.query(Client).filter(Client.id == str(client_id)).first()
        if client:
            street = client.address or ''
            place = ' '.join(p for p in (client.state or '', client.zipcode or '') if p)
            known['client'] = {
                'display_name': client.display_name,
                'address': street,
                'city': client.city,
                'state': client.state,
                'zipcode': client.zipcode,
                'phone': client.phone,
                'email': client.email,
                'full_address': ', '.join(p for p in (street, client.city or '', place) if p),
            }
            known['claim'] = {
                'insurance_company': client.insurance_company,
                'insurance_policy_number': client.insurance_policy_number,
            }
    elif address:
        known['client'] = {
            'address': address.street.strip(),
            'city': address.city,
            'state': address.state,
            'zipcode': address.zipcode,
            'full_address': _full_address(address),
        }
    return known


def _prefill_of(contract: Dict[str, Any]) -> Dict[str, Any]:
    raw = contract.get('prefill_data')
    if isinstance(raw, str) and raw:
        return json.loads(raw)
    return raw if isinstance(raw, dict) else {}


def _today(value: Optional[str]) -> str:
    try:
        return datetime.strptime(value or '', '%m/%d/%Y').strftime('%m/%d/%Y')
    except ValueError:
        return datetime.utcnow().strftime('%m/%d/%Y')


def _is_image(value: str) -> bool:
    if not value.startswith('data:image/') or ',' not in value:
        return False
    try:
        return bool(base64.b64decode(value.split(',', 1)[1], validate=True))
    except (binascii.Error, ValueError):
        return False


def _signature_fields(mappings: List[Dict[str, Any]], given: Dict[str, str], today: str) -> Dict[str, str]:
    """Every signature and initials line must be signed; dates fill themselves"""
    fields: Dict[str, str] = {}
    for mapping in signature_mappings(mappings):
        field_id, key = mapping.get('id', ''), mapping.get('fieldKey', '')
        value = given.get(field_id, '')
        if key.startswith('date_signed.'):
            fields[field_id] = value.strip() or today
        elif _is_image(value):
            fields[field_id] = value
        else:
            raise HTTPException(status_code=400, detail=f"Missing: {mapping.get('label') or key}")
    return fields


def _primary_signature(mappings: List[Dict[str, Any]], signatures: Dict[str, str]) -> str:
    """The image kept on the signature record: the customer's, if the template has one"""
    lines = [m for m in signature_mappings(mappings) if m.get('fieldKey', '').startswith('signature.')]
    lines.sort(key=lambda m: m.get('fieldKey') != 'signature.homeowner')
    if not lines:
        raise HTTPException(status_code=400, detail="This template has no signature line")
    return signatures[lines[0].get('id', '')]


def _find_or_create_client(
    db: Any, staff: Any, company: Company, address: OnsiteAddress, values: Dict[str, Any], signer_name: str,
) -> Tuple[Client, bool]:
    """The client at this address, among those this person may see, or a new one
    managed by the company so they can find it again. Search can miss an address
    typed differently; the normalized form catches that."""
    street = address.street.strip()
    normalized = normalize_address(street)
    query = scoped(db.query(Client), client_condition(db, staff)).filter(
        Client.normalized_address == normalized,
        Client.is_active.is_(True),
    )
    if address.zipcode:
        # A street name repeats across towns; a client with no zip can't rule itself out
        query = query.filter((Client.zipcode == address.zipcode) | Client.zipcode.is_(None))
    existing = query.first()
    if existing:
        return existing, False

    name = known_value(values, 'client.display_name') or signer_name
    phone = known_value(values, 'client.phone') or None
    email = known_value(values, 'client.email') or None
    client = Client(
        display_name=name,
        owners=[{'name': name, 'phone': phone, 'email': email, 'is_primary': True}],
        address=street,
        normalized_address=normalized,
        city=address.city,
        state=address.state,
        zipcode=address.zipcode,
        phone=phone,
        email=email,
        insurance_company=known_value(values, 'claim.insurance_company') or None,
        insurance_policy_number=known_value(values, 'claim.insurance_policy_number') or None,
        company_id=company.id,
        is_active=True,
    )
    db.add(client)
    db.flush()
    return client, True


def _tell_the_office(staff: Any, contract: Dict[str, Any], client: Client) -> bool:
    """Every admin gets a todo to put the contract on a claim and a message about
    it. Whoever signed it needn't message themselves. A failure here mustn't undo
    a signature the customer has already given, so it is reported, not raised."""
    from app.domains.client.service import ClaimTodoService
    from app.domains.messaging.service import MessagingService

    title = contract.get('title') or 'Contract'
    where = client.address or client.display_name
    database = get_database()
    session = database.get_session()
    try:
        admins = [str(row[0]) for row in session.query(Staff.id).filter(
            Staff.role.in_(ALL_DATA_ROLES),
            Staff.is_active.is_(True),
            Staff.can_login.is_(True),
        ).all()]

        todos = ClaimTodoService(database)
        for admin_id in admins:
            todos.create_todo({
                'title': f"Assign signed contract to a claim: {title}, {where}",
                'owner_id': admin_id,
                'client_id': str(client.id),
                'contract_id': str(contract['id']),
                'contract_task': TASK_ASSIGN_CLAIM,
            })

        messaging = MessagingService(session)
        for admin_id in admins:
            if admin_id == str(staff.id):
                continue
            conversation = messaging.direct_conversation(staff.id, admin_id)
            messaging.post(
                conversation,
                staff.id,
                f"Signed on site: {title} for {client.display_name} ({where}). "
                "It needs to be assigned to a claim.",
                related_type='client',
                related_id=client.id,
            )
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        logger.error(f"Could not tell the office about contract {contract.get('id')}: {e}", exc_info=True)
        return False
    finally:
        session.close()


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get("/companies")
def list_companies(
    purpose: str,
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    """Contractors of this person's that have something to sign for this purpose"""
    if purpose not in SIGNING_PURPOSES:
        raise HTTPException(status_code=400, detail="Unknown purpose")
    query = db.query(Company, ContractTemplate).join(
        ContractTemplate, ContractTemplate.company_id == Company.id
    ).filter(
        Company.company_type == 'contractor',
        Company.is_active.is_(True),
        ContractTemplate.is_active.is_(True),
        ContractTemplate.signing_purpose == purpose,
    )
    allowed = company_ids(db, staff)
    if allowed is not None:
        query = query.filter(Company.id.in_(allowed))

    companies: Dict[str, Dict[str, Any]] = {}
    for company, template in query.order_by(Company.name, ContractTemplate.name).all():
        # Without a signature line there is nothing to sign
        if not has_signature_field(parse_mappings(template.field_mappings)):
            continue
        entry = companies.setdefault(str(company.id), {
            'id': str(company.id), 'name': company.name, 'templates': [],
        })
        entry['templates'].append({
            'id': str(template.id), 'name': template.name, 'document_type': template.document_type,
        })
    return {'companies': list(companies.values())}


@router.post("/form")
def get_form(
    data: OnsiteForm,
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    """The questions to ask for this template, and the signature lines to sign"""
    template, company = _require_template(db, staff, data.template_id, data.company_id)
    if data.client_id:
        require_client(db, staff, data.client_id)
    mappings = parse_mappings(template.field_mappings)
    known = _known_values(db, company, data.client_id, data.address)
    return {
        'template_id': str(template.id),
        'template_name': template.name,
        'questions': build_questions(mappings, known),
        'signature_fields': [signature_placement(m) for m in signature_mappings(mappings)],
    }


@router.post("/preview")
def preview_pdf(
    data: OnsitePreview,
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    """The filled-in document to review before signing. Nothing is saved."""
    from app.domains.contract.api import _resolve_contract_pdf
    from app.domains.contract.signing_api import _generate_filled_pdf_bytes

    template, company = _require_template(db, staff, data.template_id, data.company_id)
    pdf = _resolve_contract_pdf(template.file_url, template.storage_provider)
    if not pdf:
        raise HTTPException(status_code=404, detail="The template's PDF is missing")

    mappings = parse_mappings(template.field_mappings)
    known = _known_values(db, company, None, None)
    allowed = [q['key'] for q in build_questions(mappings, known)]
    today = _today(data.today)
    prefill = {
        **known,
        'meta': {'current_date': today, 'contract_number': ''},
    }
    for category, fields in expand_answers(data.answers, allowed).items():
        prefill.setdefault(category, {}).update(fields)
    prefill.setdefault('wm_job', {})['today'] = today

    filled = _generate_filled_pdf_bytes(pdf, mappings, prefill)
    return Response(content=filled or pdf, media_type="application/pdf")


@router.post("/contracts")
def create_signed_contract(
    data: OnsiteContractCreate,
    request: Request,
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    """Sign: makes the client if needed, the contract, and the signed PDF, then
    tells the office. An email is only offered if every mapped field was filled."""
    template, company = _require_template(db, staff, data.template_id, data.company_id)
    if data.client_id:
        require_client(db, staff, data.client_id)
    elif not data.address or not data.address.street.strip():
        raise HTTPException(status_code=400, detail="Pick a client or enter an address")

    signer_name = data.signer_name.strip()
    if not signer_name:
        raise HTTPException(status_code=400, detail="Enter the signer's name")
    if not data.consent_agreed:
        raise HTTPException(status_code=400, detail="The signer must agree to sign electronically")

    today = _today(data.today)
    mappings = parse_mappings(template.field_mappings)
    signatures = _signature_fields(mappings, data.signature_fields, today)
    primary_signature = _primary_signature(mappings, signatures)

    known = _known_values(db, company, data.client_id, data.address)
    allowed = [q['key'] for q in build_questions(mappings, known)]
    answers = expand_answers(data.answers, allowed)

    if data.client_id:
        client = db.query(Client).filter(Client.id == str(data.client_id)).first()
        client_created = False
    else:
        client, client_created = _find_or_create_client(db, staff, company, data.address, answers, signer_name)
    db.commit()

    actor = db.query(Staff.first_name, Staff.last_name).filter(Staff.id == str(staff.id)).first()
    actor_name = f"{actor[0]} {actor[1]}".strip() if actor else None

    service = _service()
    contract = service.create_onsite_contract(
        {
            'template_id': str(template.id),
            'company_id': str(company.id),
            'client_id': str(client.id),
            'title': template.name,
        },
        answers,
        today,
        actor_name=actor_name,
    )
    token = contract['signing_token']

    ip = request.client.host if request.client else None
    user_agent = request.headers.get('user-agent', '')
    service.sign_contract(
        token,
        {
            'signer_name': signer_name,
            'signer_role': 'homeowner',
            'signature_image': primary_signature,
            'signature_type': 'drawn',
            'signed_at': datetime.utcnow(),
            'ip_address': ip,
            'user_agent': user_agent,
            'consent_agreed': True,
            'consent_text': data.consent_text,
        },
        signature_fields=signatures,
    )
    signed = service.get_by_token(token)
    contract_id = str(signed['id'])
    detail = {'signer_name': signer_name, 'signer_role': 'homeowner', 'source': 'onsite_signing'}
    service.append_audit_log(contract_id, action='signer_name_entered', ip=ip, user_agent=user_agent, detail=detail)
    service.append_audit_log(
        contract_id, action='signed', ip=ip, user_agent=user_agent,
        detail={**detail, 'collected_by': actor_name}, actor_name=signer_name,
    )
    service.append_audit_log(contract_id, action='agreement_completed', ip=ip, user_agent=user_agent)
    service.close_signing_link(contract_id)

    office_notified = _tell_the_office(staff, signed, client)

    prefill = _prefill_of(signed)
    missing = missing_fields(mappings, prefill)
    pdf_ready = bool(signed.get('signed_pdf_url'))
    return {
        'contract_id': contract_id,
        'contract_number': signed.get('contract_number'),
        'title': signed.get('title'),
        'client_id': str(client.id),
        'client_name': client.display_name,
        'client_created': client_created,
        'client_email': known_value(prefill, 'client.email'),
        'pdf_ready': pdf_ready,
        'pdf_url': f"/api/contracts/contracts/{contract_id}/pdf",
        'office_notified': office_notified,
        'missing_fields': missing,
    }


@router.post("/contracts/{contract_id}/email")
def email_signed_contract(
    contract_id: str,
    data: OnsiteEmail,
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    """Email the signed PDF. Only a contract with every mapped field filled goes out."""
    from app.domains.contract.field_signing_api import send_signed_contract

    require_document(db, staff, ContractInstance, contract_id, "Contract")
    emails = [e.strip() for e in data.emails if e.strip() and '@' in e.strip()]
    if not emails:
        raise HTTPException(status_code=400, detail="Enter a valid email address")

    service = _service()
    session = service.database.get_readonly_session()
    try:
        contract = service._get_repository_instance(session).get_by_id_enriched(contract_id)
    finally:
        session.close()
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")

    missing = missing_fields(parse_mappings(contract.get('field_mappings')), _prefill_of(contract))
    if missing:
        raise HTTPException(
            status_code=400,
            detail="Every field must be filled to email this contract. Missing: " + ', '.join(missing),
        )
    send_signed_contract(service, contract, emails, source='onsite_signing')
    return {'message': f"Signed contract sent to {len(emails)} recipient(s)", 'emails': emails}
