"""
On-site signing: someone in the field finds the client (or starts from just an
address), picks what the document is for and which company it's from, fills in
what the template maps, and has the customer sign. The contract and, if needed,
the client are only created at that last step, so an abandoned visit leaves
nothing behind. The office then decides which claim the contract belongs to.

Some purposes sign every one of the company's documents for them at once (water
mitigation: the authorization and the sign-off). Those are asked about once,
signed in one go, and made into one contract each.
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
    SIGNED_TOGETHER,
    SIGNING_PURPOSES,
    build_questions,
    expand_answers,
    has_signature_field,
    known_value,
    missing_fields,
    parse_mappings,
    period_error,
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


class OnsiteSubject(BaseModel):
    company_id: UUID
    client_id: Optional[UUID] = None
    address: Optional[OnsiteAddress] = None


class OnsiteForm(OnsiteSubject):
    # Every document being signed in this visit
    template_ids: List[UUID]


class OnsitePreview(BaseModel):
    template_id: UUID
    company_id: UUID
    answers: Dict[str, Optional[str]] = {}
    # The device's date, so an evening signing isn't dated tomorrow (UTC)
    today: Optional[str] = None


class OnsiteDocumentSignatures(BaseModel):
    template_id: UUID
    # Mapping id -> signature or initials image (data URL), or the date for date_signed
    signature_fields: Dict[str, str]


class OnsiteContractCreate(OnsiteSubject):
    documents: List[OnsiteDocumentSignatures]
    answers: Dict[str, Optional[str]] = {}
    today: Optional[str] = None
    signer_name: str
    consent_agreed: bool = False
    consent_text: Optional[str] = None


class OnsiteEmail(BaseModel):
    contract_ids: List[str]
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


# Documents run in the order a job does: permission to start, then sign-offs
_DOCUMENT_ORDER = (
    'authorization', 'scope_of_work', 'change_order',
    'certificate_of_completion', 'certificate_of_satisfaction', 'lien_waiver',
)


def _document_order(template: ContractTemplate) -> Tuple[int, str]:
    kind = template.document_type
    rank = _DOCUMENT_ORDER.index(kind) if kind in _DOCUMENT_ORDER else len(_DOCUMENT_ORDER)
    return rank, (template.name or '').lower()


def _signable(templates: List[ContractTemplate]) -> List[ContractTemplate]:
    """Those with something to sign, in the order they're signed"""
    usable = [t for t in templates if has_signature_field(parse_mappings(t.field_mappings))]
    return sorted(usable, key=_document_order)


def _is_water_mitigation(templates: List[ContractTemplate]) -> bool:
    return any(t.signing_purpose == 'water_mitigation' for t in templates)


def _require_documents(
    db: Any, staff: Any, template_ids: List[Any], company_id: Any,
) -> Tuple[List[ContractTemplate], Company]:
    """The documents of one visit, in the order they're signed. A purpose signed
    together takes every one of the company's documents for it, or none."""
    if not template_ids:
        raise HTTPException(status_code=400, detail="Pick a document to sign")
    if len({str(t) for t in template_ids}) != len(template_ids):
        raise HTTPException(status_code=400, detail="A document is listed twice")
    chosen = [_require_template(db, staff, template_id, company_id) for template_id in template_ids]
    templates, company = [row[0] for row in chosen], chosen[0][1]

    for purpose in sorted({t.signing_purpose for t in templates} & set(SIGNED_TOGETHER)):
        together = _signable(db.query(ContractTemplate).filter(
            ContractTemplate.company_id == company.id,
            ContractTemplate.is_active.is_(True),
            ContractTemplate.signing_purpose == purpose,
        ).all())
        if {str(t.id) for t in together} != {str(t.id) for t in templates}:
            raise HTTPException(
                status_code=400,
                detail="These documents are signed together: " + ', '.join(t.name for t in together),
            )
    return sorted(templates, key=_document_order), company


def _allowed_answers(templates: List[ContractTemplate], known: Dict[str, Any]) -> List[str]:
    """What this visit asks about: everything any of its documents does"""
    mappings = [m for t in templates for m in parse_mappings(t.field_mappings)]
    return [q['key'] for q in build_questions(mappings, known, _is_water_mitigation(templates))]


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


def _signature_fields(
    mappings: List[Dict[str, Any]], given: Dict[str, str], today: str, document: str = '',
) -> Dict[str, str]:
    """Every signature and initials line must be signed; dates fill themselves"""
    on = f" on {document}" if document else ''
    fields: Dict[str, str] = {}
    for mapping in signature_mappings(mappings):
        field_id, key = mapping.get('id', ''), mapping.get('fieldKey', '')
        value = given.get(field_id, '')
        if key.startswith('date_signed.'):
            fields[field_id] = value.strip() or today
        elif _is_image(value):
            fields[field_id] = value
        else:
            raise HTTPException(status_code=400, detail=f"Missing{on}: {mapping.get('label') or key}")
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


def _tell_the_office(staff: Any, contracts: List[Dict[str, Any]], client: Client) -> bool:
    """One todo for the visit, on the board of whoever collected the signature,
    to put its contracts on a claim; it finishes once they all are. Every admin
    gets a message about it, except the one who signed. A failure here mustn't
    undo signatures the customer has already given, so it is reported, not
    raised."""
    from app.domains.client.service import ClaimTodoService
    from app.domains.messaging.service import MessagingService

    titles = [contract.get('title') or 'Contract' for contract in contracts]
    where = client.address or client.display_name
    if len(contracts) == 1:
        task = f"Assign signed contract to a claim: {titles[0]}, {where}"
        news = (f"Signed on site: {titles[0]} for {client.display_name} ({where}). "
                "It needs to be assigned to a claim.")
    else:
        task = f"Assign {len(contracts)} signed contracts to a claim: {', '.join(titles)}, {where}"
        news = (f"Signed on site: {', '.join(titles)} for {client.display_name} ({where}). "
                "They need to be assigned to a claim.")
    database = get_database()
    session = database.get_session()
    try:
        admins = [str(row[0]) for row in session.query(Staff.id).filter(
            Staff.role.in_(ALL_DATA_ROLES),
            Staff.is_active.is_(True),
            Staff.can_login.is_(True),
        ).all()]

        ClaimTodoService(database).create_todo({
            'title': task[:500],
            'owner_id': str(staff.id),
            'client_id': str(client.id),
            'contract_id': str(contracts[0]['id']),
            'contract_ids': json.dumps([str(contract['id']) for contract in contracts]),
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
                news,
                related_type='client',
                related_id=client.id,
            )
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        ids = ', '.join(str(contract.get('id')) for contract in contracts)
        logger.error(f"Could not tell the office about contracts {ids}: {e}", exc_info=True)
        return False
    finally:
        session.close()


def _sign_document(
    service: ContractInstanceService,
    template: ContractTemplate,
    company: Company,
    client: Client,
    answers: Dict[str, Dict[str, str]],
    today: str,
    signatures: Dict[str, str],
    primary_signature: str,
    signer: Dict[str, Any],
    actor_name: Optional[str],
    made: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Make one document's contract and sign it, closed to its link. The contract
    goes on `made` as soon as it exists, so a failure after can void it."""
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
    made.append(contract)
    token = contract['signing_token']
    ip, user_agent = signer['ip'], signer['user_agent']
    service.sign_contract(
        token,
        {
            'signer_name': signer['name'],
            'signer_role': 'homeowner',
            'signature_image': primary_signature,
            'signature_type': 'drawn',
            'signed_at': datetime.utcnow(),
            'ip_address': ip,
            'user_agent': user_agent,
            'consent_agreed': True,
            'consent_text': signer['consent_text'],
        },
        signature_fields=signatures,
    )
    signed = service.get_by_token(token)
    contract_id = str(signed['id'])
    detail = {'signer_name': signer['name'], 'signer_role': 'homeowner', 'source': 'onsite_signing'}
    service.append_audit_log(contract_id, action='signer_name_entered', ip=ip, user_agent=user_agent, detail=detail)
    service.append_audit_log(
        contract_id, action='signed', ip=ip, user_agent=user_agent,
        detail={**detail, 'collected_by': actor_name}, actor_name=signer['name'],
    )
    service.append_audit_log(contract_id, action='agreement_completed', ip=ip, user_agent=user_agent)
    service.close_signing_link(contract_id)
    return signed


def _void_unfinished(service: ContractInstanceService, contracts: List[Dict[str, Any]]) -> None:
    """Documents signed together stand or fall together: when one can't be made,
    those made so far are voided, so signing again doesn't leave doubles or a
    draft whose link still opens"""
    for contract in contracts:
        contract_id = str(contract['id'])
        try:
            service.update(contract_id, {'status': 'voided', 'voided_at': datetime.utcnow()})
            service.close_signing_link(contract_id)
            service.append_audit_log(
                contract_id, action='voided',
                detail={'reason': 'Another document signed with it on site could not be saved'},
            )
        except Exception as e:
            logger.error(f"Could not void contract {contract_id} after a failed on-site signing: {e}")


def _load_contract(service: ContractInstanceService, contract_id: str) -> Optional[Dict[str, Any]]:
    session = service.database.get_readonly_session()
    try:
        return service._get_repository_instance(session).get_by_id_enriched(contract_id)
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

    found: Dict[str, Tuple[Company, List[ContractTemplate]]] = {}
    for company, template in query.order_by(Company.name).all():
        found.setdefault(str(company.id), (company, []))[1].append(template)

    companies = []
    for company, templates in found.values():
        # Without a signature line there is nothing to sign
        signable = _signable(templates)
        if not signable:
            continue
        companies.append({
            'id': str(company.id),
            'name': company.name,
            'templates': [
                {'id': str(t.id), 'name': t.name, 'document_type': t.document_type} for t in signable
            ],
        })
    return {'companies': companies}


@router.post("/form")
def get_form(
    data: OnsiteForm,
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    """The questions to ask for these documents, once for all of them, and each
    document's signature lines"""
    templates, company = _require_documents(db, staff, data.template_ids, data.company_id)
    if data.client_id:
        require_client(db, staff, data.client_id)
    known = _known_values(db, company, data.client_id, data.address)
    all_mappings = [m for t in templates for m in parse_mappings(t.field_mappings)]
    return {
        'documents': [
            {
                'template_id': str(t.id),
                'template_name': t.name,
                'signature_fields': [
                    signature_placement(m) for m in signature_mappings(parse_mappings(t.field_mappings))
                ],
            }
            for t in templates
        ],
        'questions': build_questions(all_mappings, known, _is_water_mitigation(templates)),
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
    allowed = _allowed_answers([template], known)
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
    """Sign: makes the client if needed, a contract and signed PDF for each
    document, then tells the office. Everything is checked before anything is
    made. An email is only offered if every mapped field was filled."""
    templates, company = _require_documents(
        db, staff, [document.template_id for document in data.documents], data.company_id,
    )
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
    given = {str(document.template_id): document.signature_fields for document in data.documents}
    signing = []
    for template in templates:
        mappings = parse_mappings(template.field_mappings)
        name = template.name if len(templates) > 1 else ''
        signatures = _signature_fields(mappings, given[str(template.id)], today, name)
        signing.append((template, mappings, signatures, _primary_signature(mappings, signatures)))

    known = _known_values(db, company, data.client_id, data.address)
    allowed = set(_allowed_answers(templates, known))
    asked = {key: value for key, value in data.answers.items() if key in allowed}
    problem = period_error(asked)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    answers = expand_answers(asked, allowed)

    if data.client_id:
        client = db.query(Client).filter(Client.id == str(data.client_id)).first()
        client_created = False
    else:
        client, client_created = _find_or_create_client(db, staff, company, data.address, answers, signer_name)
    db.commit()

    actor = db.query(Staff.first_name, Staff.last_name).filter(Staff.id == str(staff.id)).first()
    actor_name = f"{actor[0]} {actor[1]}".strip() if actor else None
    signer = {
        'name': signer_name,
        'consent_text': data.consent_text,
        'ip': request.client.host if request.client else None,
        'user_agent': request.headers.get('user-agent', ''),
    }

    service = _service()
    made: List[Dict[str, Any]] = []
    signed_contracts: List[Dict[str, Any]] = []
    try:
        for template, _, signatures, primary_signature in signing:
            signed_contracts.append(_sign_document(
                service, template, company, client, answers, today,
                signatures, primary_signature, signer, actor_name, made,
            ))
    except Exception:
        _void_unfinished(service, made)
        raise

    office_notified = _tell_the_office(staff, signed_contracts, client)

    contracts = []
    for signed, (_, mappings, _, _) in zip(signed_contracts, signing):
        contract_id = str(signed['id'])
        contracts.append({
            'contract_id': contract_id,
            'contract_number': signed.get('contract_number'),
            'title': signed.get('title'),
            'pdf_ready': bool(signed.get('signed_pdf_url')),
            'pdf_url': f"/api/contracts/contracts/{contract_id}/pdf",
            'missing_fields': missing_fields(mappings, _prefill_of(signed)),
        })
    return {
        'client_id': str(client.id),
        'client_name': client.display_name,
        'client_created': client_created,
        'client_email': known_value(_prefill_of(signed_contracts[0]), 'client.email'),
        'office_notified': office_notified,
        'contracts': contracts,
    }


@router.post("/contracts/email")
def email_signed_contracts(
    data: OnsiteEmail,
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    """Email the signed PDFs of one visit together. They only go out when every
    mapped field of every one of them was filled."""
    from app.domains.contract.field_signing_api import send_signed_contracts

    contract_ids = list(dict.fromkeys(c.strip() for c in data.contract_ids if c.strip()))
    if not contract_ids:
        raise HTTPException(status_code=400, detail="Pick a contract to email")
    for contract_id in contract_ids:
        require_document(db, staff, ContractInstance, contract_id, "Contract")
    emails = [e.strip() for e in data.emails if e.strip() and '@' in e.strip()]
    if not emails:
        raise HTTPException(status_code=400, detail="Enter a valid email address")

    service = _service()
    contracts = [_load_contract(service, contract_id) for contract_id in contract_ids]
    if not all(contracts):
        raise HTTPException(status_code=404, detail="Contract not found")
    if len({str(c.get('company_id')) for c in contracts}) > 1:
        raise HTTPException(status_code=400, detail="Contracts from different companies go in separate emails")

    missing: List[str] = []
    for contract in contracts:
        for label in missing_fields(parse_mappings(contract.get('field_mappings')), _prefill_of(contract)):
            if label not in missing:
                missing.append(label)
    if missing:
        raise HTTPException(
            status_code=400,
            detail="Every field must be filled to email this contract. Missing: " + ', '.join(missing),
        )
    send_signed_contracts(service, contracts, emails, source='onsite_signing')
    noun = 'contract' if len(contracts) == 1 else 'contracts'
    return {'message': f"Signed {noun} sent to {len(emails)} recipient(s)", 'emails': emails}
