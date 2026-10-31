"""
Field Signing API - Signed-in endpoints for the iPad field signing flow. Everyone
sees only their own companies, as on On-site Signing. The customer's signature
itself goes through the public signing route, by token.

Provides:
- Company listing (with active templates)
- Contract listing by company (for field workers)
- Prefill data update + PDF regeneration
- Contract view with prefill/field_mappings
- Email sending with EMAIL_TEMPLATES
"""

import json
import logging
from datetime import datetime
from html import escape

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Dict, Any, List, Optional

from app.core.database_factory import get_db_session as get_db
from app.domains.auth.company_scope import company_ids, require_document
from app.domains.auth.dependencies import get_current_staff
from app.domains.contract.models import ContractInstance, ContractTemplate
from app.domains.contract.schemas import SignatureFieldPlacement

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_services():
    from app.core.database_factory import get_database
    from app.domains.contract.service import ContractInstanceService
    db = get_database()
    return ContractInstanceService(db), db


def _require_company(db: Any, staff: Any, company_id: str) -> None:
    """404 outside this person's companies, as for anything out of their scope"""
    allowed = company_ids(db, staff)
    if allowed is not None and str(company_id) not in allowed:
        raise HTTPException(status_code=404, detail="Company not found")


def _require_contract(db: Any, staff: Any, token: str) -> None:
    """404 unless the token's contract is one this person may see"""
    row = db.query(ContractInstance.id).filter(ContractInstance.signing_token == token).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Contract not found")
    require_document(db, staff, ContractInstance, row[0], "Contract")


def _find_company_email_account(company_id):
    """Find an active, sendable email account for the company."""
    if not company_id:
        return None
    try:
        from app.core.database_factory import get_database
        from sqlalchemy import text
        db = get_database()
        session = db.get_readonly_session()
        try:
            result = session.execute(
                text(
                    "SELECT id FROM email_accounts "
                    "WHERE company_id = :cid AND is_active = true "
                    "AND (can_send = true OR can_send IS NULL) "
                    "LIMIT 1"
                ),
                {"cid": str(company_id)},
            )
            row = result.fetchone()
            return str(row[0]) if row else None
        finally:
            session.close()
    except Exception as e:
        logger.debug(f"Could not find company email account: {e}")
        return None


# ── Request Schemas ──────────────────────────────────────────────────────────


class PrefillUpdateRequest(BaseModel):
    prefill_data: Dict[str, Any]


class SendEmailRequest(BaseModel):
    emails: List[str]


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get("/companies")
def get_companies_with_templates(
    staff: Any = Depends(get_current_staff),
    scope_db: Any = Depends(get_db),
):
    """List this person's companies that have active contract templates."""
    allowed = company_ids(scope_db, staff)
    try:
        from app.core.database_factory import get_database
        from sqlalchemy import text
        db = get_database()
        session = db.get_readonly_session()
        try:
            result = session.execute(text("""
                SELECT c.id, c.name, COUNT(t.id) as template_count
                FROM companies c
                JOIN contract_templates t ON t.company_id = c.id
                WHERE t.is_active = true AND c.is_active = true
                GROUP BY c.id, c.name
                ORDER BY c.name
            """))
            companies = [
                {
                    "id": str(row[0]),
                    "name": row[1],
                    "template_count": row[2],
                }
                for row in result.fetchall()
                if allowed is None or str(row[0]) in allowed
            ]
            return {"companies": companies}
        finally:
            session.close()
    except Exception as e:
        logger.error(f"Error listing companies: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load companies")


@router.get("/companies/{company_id}/contracts")
def get_company_contracts(
    company_id: str,
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    """List existing contract instances for a company (for field signing)."""
    _require_company(db, staff, company_id)
    try:
        service, _ = _get_services()
        contracts = service.get_contracts_by_company_for_field(company_id)
        return {"contracts": contracts}
    except Exception as e:
        logger.error(f"Error listing company contracts: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load contracts")


@router.get("/companies/{company_id}/templates")
def get_company_templates(
    company_id: str,
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    """List active contract templates for a company."""
    _require_company(db, staff, company_id)
    try:
        from app.core.database_factory import get_database
        from app.domains.contract.service import ContractTemplateService
        db = get_database()
        tmpl_service = ContractTemplateService(db)
        templates = tmpl_service.get_by_company(company_id)
        return {"templates": templates}
    except Exception as e:
        logger.error(f"Error listing templates: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load templates")


class FieldContractCreateRequest(BaseModel):
    template_id: str
    company_id: str
    title: Optional[str] = None
    token_expires_days: int = 30


@router.post("/create")
def create_field_contract(
    data: FieldContractCreateRequest,
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    """
    Create a contract instance from a template for field signing.
    Does not require claim_id or client_id — fields are filled on-site.
    """
    _require_company(db, staff, data.company_id)
    template = db.query(ContractTemplate.id).filter(
        ContractTemplate.id == data.template_id,
        ContractTemplate.company_id == data.company_id,
    ).first()
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    try:
        service, _ = _get_services()

        create_data = {
            'template_id': data.template_id,
            'company_id': data.company_id,
            'title': data.title,
            'token_expires_days': data.token_expires_days,
        }

        result = service.create_field_contract(create_data)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating field contract: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to create contract")


@router.get("/{token}/view")
def get_contract_for_field(
    token: str,
    request: Request,
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    """
    Get contract data for field signing, including prefill_data and field_mappings.
    Similar to signing_api GET /{token} but with extra data for field editing.
    """
    _require_contract(db, staff, token)
    try:
        service, _ = _get_services()
        contract = service.get_by_token(token)

        if not contract:
            raise HTTPException(status_code=404, detail="Contract not found")

        # Check token expiry
        expires = contract.get('token_expires_at')
        if expires:
            if isinstance(expires, str):
                expires = datetime.fromisoformat(expires)
            expires_naive = expires.replace(tzinfo=None) if hasattr(expires, 'tzinfo') and expires.tzinfo else expires
            if datetime.utcnow() > expires_naive:
                raise HTTPException(status_code=410, detail="Signing link has expired")

        if contract.get('status') == 'voided':
            raise HTTPException(status_code=410, detail="Contract has been voided")

        # Mark as viewed if first time (sent → viewed)
        if contract.get('status') == 'sent':
            service.update(str(contract['id']), {
                'status': 'viewed',
                'viewed_at': datetime.utcnow(),
            })

        # Audit: document viewed
        try:
            service.append_audit_log(
                str(contract['id']),
                action='viewed',
                ip=(
                    request.client.host
                    if request.client else None
                ),
                user_agent=request.headers.get(
                    'user-agent', ''
                ),
                detail={'source': 'field_signing'},
            )
        except Exception:
            pass

        # Parse prefill_data
        prefill_data = {}
        raw_prefill = contract.get('prefill_data')
        if raw_prefill:
            if isinstance(raw_prefill, str):
                prefill_data = json.loads(raw_prefill)
            elif isinstance(raw_prefill, dict):
                prefill_data = raw_prefill

        # Parse field_mappings
        field_mappings = []
        raw_mappings = contract.get('field_mappings')
        if raw_mappings:
            if isinstance(raw_mappings, str):
                field_mappings = json.loads(raw_mappings)
            elif isinstance(raw_mappings, list):
                field_mappings = raw_mappings

        # Extract signature fields
        sig_fields = _extract_signature_fields(field_mappings)

        # PDF URL (use public proxy)
        proxy_pdf_url = f"/api/sign/{token}/pdf"

        return {
            "contract_id": str(contract['id']),
            "title": contract.get('title'),
            "company_name": contract.get('company_name'),
            "client_name": contract.get('client_name'),
            "client_email": contract.get('client_email'),
            "template_name": contract.get('template_name'),
            "document_type": contract.get('document_type'),
            "status": contract.get('status', 'draft'),
            "file_url": proxy_pdf_url,
            "filled_pdf_url": proxy_pdf_url if contract.get('filled_pdf_url') else None,
            "requires_signature": contract.get('requires_signature', True),
            "signature_roles": contract.get('signature_roles'),
            "signature_fields": [sf.dict() for sf in sig_fields],
            "existing_signatures": [
                {
                    "signer_name": s.get("signer_name"),
                    "signer_role": s.get("signer_role"),
                    "signed_at": s.get("signed_at"),
                }
                for s in contract.get("signatures", [])
            ],
            # Extra fields for field editing
            "prefill_data": prefill_data,
            "field_mappings": field_mappings,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting contract for field: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load contract")


@router.put("/{token}/prefill")
def update_prefill(
    token: str,
    data: PrefillUpdateRequest,
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    """Update prefill data and regenerate filled PDF."""
    _require_contract(db, staff, token)
    try:
        service, _ = _get_services()
        result = service.update_prefill_and_regenerate(token, data.prefill_data)
        return {"message": "Prefill updated and PDF regenerated", "contract_id": str(result['id'])}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating prefill: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to update prefill")


@router.post("/{token}/send-email")
def send_email_with_template(
    token: str,
    data: SendEmailRequest,
    staff: Any = Depends(get_current_staff),
    db: Any = Depends(get_db),
):
    """
    Send signed PDF via email using EMAIL_TEMPLATES for document_type-specific content.
    """
    _require_contract(db, staff, token)
    try:
        emails = [e.strip() for e in data.emails if e.strip() and '@' in e.strip()]
        if not emails:
            raise HTTPException(status_code=400, detail="No valid email addresses provided")

        service, _ = _get_services()
        contract = service.get_by_token(token)
        if not contract:
            raise HTTPException(status_code=404, detail="Contract not found")

        send_signed_contract(service, contract, emails, source='field_signing')

        return {
            "message": f"Signed contract sent to "
                       f"{len(emails)} recipient(s)",
            "emails": emails,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error sending email: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to send email",
        )


# ── Helpers ──────────────────────────────────────────────────────────────────


def send_signed_contract(service, contract: dict, emails: List[str], source: str) -> None:
    """Email the signed PDF, with EMAIL_TEMPLATES wording for its document type."""
    send_signed_contracts(service, [contract], emails, source)


def send_signed_contracts(service, contracts: List[dict], emails: List[str], source: str) -> None:
    """Email signed PDFs of one company together, one attached per contract, with
    EMAIL_TEMPLATES wording for their document type when they share one."""
    from app.domains.contract.api import _resolve_contract_pdf

    attachments = []
    for contract in contracts:
        if contract.get('status') != 'signed':
            raise HTTPException(status_code=400, detail="Contract has not been signed yet")
        signed_url = contract.get('signed_pdf_url') or contract.get('filled_pdf_url')
        signed_provider = contract.get('signed_pdf_provider') or contract.get('filled_pdf_provider')
        pdf_bytes = _resolve_contract_pdf(signed_url, signed_provider) if signed_url else None
        if not pdf_bytes:
            raise HTTPException(status_code=404, detail="Signed PDF not available")
        title_safe = (contract.get('title') or 'Contract').replace(' ', '_')
        attachments.append({
            'data': pdf_bytes,
            'filename': f"{title_safe}_Signed.pdf",
            'mime_type': 'application/pdf',
        })

    # Build email using EMAIL_TEMPLATES
    first = contracts[0]
    company = first.get('company_name', 'Our Company')
    titles = [c.get('title') or c.get('template_name') or 'Contract' for c in contracts]
    title = titles[0] if len(titles) == 1 else ', '.join(titles[:-1]) + ' and ' + titles[-1]
    client_name = first.get('client_name', '')
    document_types = {c.get('document_type', 'other') for c in contracts}

    from app.domains.contract.api import EMAIL_TEMPLATES
    if len(document_types) == 1:
        template = EMAIL_TEMPLATES.get(document_types.pop(), EMAIL_TEMPLATES.get('other', {}))
        heading = template.get('heading', 'Signed Document')
    else:
        heading = 'Signed Documents'

    subject = f"Signed: {title} - {company}"

    body_html = _build_signed_email_html(
        heading=heading,
        title=title,
        company=company,
        client_name=client_name,
        company_email=first.get('company_email', ''),
        company_phone=first.get('company_phone', ''),
    )

    # Send
    from app.domains.claim_followup.smtp_service import SmtpService
    from app.core.config import settings

    smtp = SmtpService()
    company_email = first.get('company_email', '')
    company_id = first.get('company_id')
    account_id = _find_company_email_account(company_id)

    if account_id:
        smtp.send(
            account_id=account_id,
            from_address=company_email or '',
            to_addresses=emails,
            subject=subject,
            body_html=body_html,
            skip_signature=True,
            attachments=attachments,
        )
    else:
        smtp_user = getattr(settings, 'SMTP_USER', '')
        if not smtp_user:
            raise HTTPException(status_code=500, detail="Email service not configured")
        smtp.send(
            account_id=None,
            from_address=smtp_user,
            to_addresses=emails,
            subject=subject,
            body_html=body_html,
            reply_to=company_email or smtp_user,
            skip_signature=True,
            display_name_override=company,
            attachments=attachments,
        )

    # Audit: signed copy sent
    for contract in contracts:
        try:
            service.append_audit_log(
                str(contract['id']),
                action='sent_copy',
                detail={
                    'recipients': emails,
                    'source': source,
                },
            )
        except Exception:
            pass


def _extract_signature_fields(mappings: list) -> list:
    """Extract signature/initial/date_signed fields from field mappings."""
    sig_types = ('signature', 'initial', 'date_signed')
    result = []
    if not isinstance(mappings, list):
        return result
    for m in mappings:
        fk = m.get('fieldKey', '')
        parts = fk.split('.', 1)
        if len(parts) == 2 and parts[0] in sig_types:
            result.append(SignatureFieldPlacement(
                id=m.get('id', ''),
                pageIndex=m.get('pageIndex', 0),
                x=m.get('x', 0),
                y=m.get('y', 0),
                width=m.get('width', 0.2),
                height=m.get('height', 0.06),
                fieldType=parts[0],
                signerRole=parts[1],
                label=m.get('label', ''),
            ))
    return result


def _build_signed_email_html(
    heading: str,
    title: str,
    company: str,
    client_name: str,
    company_email: str = '',
    company_phone: str = '',
) -> str:
    """Build HTML email for sending signed contract copy."""
    heading, title, company, client_name = (
        escape(v or '') for v in (heading, title, company, client_name)
    )
    company_email, company_phone = escape(company_email or ''), escape(company_phone or '')
    contact_parts = []
    if company_email:
        contact_parts.append(company_email)
    if company_phone:
        contact_parts.append(company_phone)
    contact_line = ' | '.join(contact_parts)

    return f"""
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;">
<table width="100%" cellpadding="0" cellspacing="0"
       style="background:#f5f5f5;padding:24px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0"
       style="background:#ffffff;border-radius:8px;
              overflow:hidden;
              box-shadow:0 2px 8px rgba(0,0,0,0.06);">
  <tr>
    <td style="background:#1677ff;padding:20px 32px;">
      <h1 style="margin:0;color:#ffffff;font-family:
          Arial,sans-serif;font-size:20px;">
        {company}
      </h1>
    </td>
  </tr>
  <tr>
    <td style="padding:32px;font-family:Arial,sans-serif;
               font-size:15px;line-height:1.6;color:#333;">
      <h2 style="margin:0 0 16px;color:#262626;
                 font-size:22px;">{heading}</h2>
      <p style="margin:0 0 16px;">
        {f'Dear {client_name},' if client_name else 'Hello,'}
      </p>
      <p style="margin:0 0 16px;">
        Please find attached a signed copy of
        <strong>{title}</strong> from <strong>{company}</strong>.
        Please keep this document for your records.
      </p>
    </td>
  </tr>
  <tr>
    <td style="padding:20px 32px;background:#fafafa;
               border-top:1px solid #e8e8e8;
               font-family:Arial,sans-serif;">
      <p style="margin:0;color:#8c8c8c;font-size:12px;">
        <strong>{company}</strong>
        {f'<br/>{contact_line}' if contact_line else ''}
      </p>
      <p style="margin:8px 0 0;color:#bfbfbf;font-size:11px;">
        This email was sent from {company}.
      </p>
    </td>
  </tr>
</table>
</td></tr></table>
</body>
</html>"""
