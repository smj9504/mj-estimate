"""
Public signing API - NO authentication required.
Accessed via signing token URL.
"""

import json
import logging
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request

from app.domains.contract.schemas import (
    SigningRequest, SigningResponse,
    ContractViewResponse, SignatureFieldPlacement,
)
from app.domains.contract.service import ContractInstanceService

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_service():
    from app.core.database_factory import get_database
    return ContractInstanceService(get_database())


@router.get("/{token}")
async def get_contract_for_signing(token: str, request: Request):
    """
    Public endpoint: Get contract details for the signing page.
    No authentication required - token is the auth.
    """
    try:
        service = _get_service()
        contract = service.get_by_token(token)

        if not contract:
            raise HTTPException(status_code=404, detail="Contract not found or link is invalid")

        # Check token expiry
        expires = contract.get('token_expires_at')
        if expires:
            if isinstance(expires, str):
                expires = datetime.fromisoformat(expires)
            # Strip timezone info for comparison with utcnow()
            expires_naive = expires.replace(tzinfo=None) if hasattr(expires, 'tzinfo') and expires.tzinfo else expires
            if datetime.utcnow() > expires_naive:
                raise HTTPException(status_code=410, detail="This signing link has expired")

        if contract.get('status') == 'voided':
            raise HTTPException(status_code=410, detail="This contract has been voided")

        # Mark as viewed if first time
        if contract.get('status') == 'sent':
            service.update(str(contract['id']), {
                'status': 'viewed',
                'viewed_at': datetime.utcnow(),
            })

        # Audit: log document viewed
        _append_audit(
            service, str(contract['id']),
            action='viewed',
            ip=request.client.host if request.client else None,
            user_agent=request.headers.get('user-agent', ''),
        )

        # Use public token-based PDF URL (no auth needed)
        cid = contract['id']
        proxy_pdf_url = f"/api/sign/{token}/pdf"

        # Extract signature field placements from template
        sig_fields = _extract_signature_fields(contract)

        return ContractViewResponse(
            contract_id=cid,
            title=contract.get('title'),
            company_name=contract.get('company_name'),
            client_name=contract.get('client_name'),
            template_name=contract.get('template_name'),
            document_type=contract.get('document_type'),
            file_url=proxy_pdf_url,
            filled_pdf_url=(
                proxy_pdf_url
                if contract.get('filled_pdf_url') else None
            ),
            status=contract.get('status', 'draft'),
            requires_signature=contract.get(
                'requires_signature', True
            ),
            signature_roles=contract.get('signature_roles'),
            signature_fields=sig_fields,
            existing_signatures=[
                {
                    'signer_name': s.get('signer_name'),
                    'signer_role': s.get('signer_role'),
                    'signed_at': s.get('signed_at'),
                }
                for s in contract.get('signatures', [])
            ],
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting contract for signing: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load contract")


def _append_audit(
    service, contract_id: str,
    action: str, ip: str = None,
    user_agent: str = None,
    detail: dict = None,
):
    """Append an event to the contract's audit_log."""
    try:
        contract = service.get_by_id(contract_id)
        if not contract:
            return

        raw = contract.get('audit_log')
        log = []
        if raw:
            if isinstance(raw, str):
                log = json.loads(raw)
            elif isinstance(raw, list):
                log = raw

        log.append({
            'action': action,
            'timestamp': datetime.utcnow().isoformat(),
            'ip': ip,
            'user_agent': (user_agent or '')[:200],
            'detail': detail,
        })

        service.update(contract_id, {
            'audit_log': json.dumps(log),
        })
    except Exception as e:
        logger.warning(f"Failed to append audit log: {e}")


def _extract_signature_fields(contract: dict):
    """Extract signature/initial/date_signed fields from
    the template's field_mappings JSON."""
    sig_types = ('signature', 'initial', 'date_signed')
    result = []

    # field_mappings may be stored as JSON string
    raw = contract.get('field_mappings')
    if not raw:
        return result

    mappings = raw
    if isinstance(raw, str):
        try:
            mappings = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return result

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


@router.post("/{token}")
async def sign_contract(token: str, data: SigningRequest, request: Request):
    """
    Public endpoint: Submit a signature for a contract.
    Captures signer info + IP + user agent for legal validity.
    """
    try:
        service = _get_service()

        sig_data = {
            'signer_name': data.signer_name,
            'signer_role': data.signer_role,
            'signature_image': data.signature_image,
            'signature_type': data.signature_type,
            'typed_name': data.typed_name,
            'signed_at': datetime.utcnow(),
            'ip_address': (
                request.client.host
                if request.client else None
            ),
            'user_agent': request.headers.get(
                'user-agent', ''
            ),
            'consent_agreed': data.consent_agreed,
            'consent_text': data.consent_text,
        }

        result = service.sign_contract(
            token, sig_data,
            signature_fields=data.signature_fields,
        )

        # Audit: log document signed
        contract_for_audit = service.get_by_token(token)
        if contract_for_audit:
            _append_audit(
                service, str(contract_for_audit['id']),
                action='signed',
                ip=request.client.host if request.client else None,
                user_agent=request.headers.get('user-agent', ''),
                detail={
                    'signer_name': data.signer_name,
                    'signer_role': data.signer_role,
                    'consent_agreed': data.consent_agreed,
                },
            )

        # Send signed PDF notification emails (async, don't block response)
        try:
            _send_signed_notification(service, token, data.signer_name)
        except Exception as e:
            logger.warning(f"Post-signing email notification failed: {e}")

        return SigningResponse(
            contract_id=result.get('contract_instance_id', ''),
            signer_name=data.signer_name,
            signed_at=result.get('signed_at', datetime.utcnow()),
            message="Contract signed successfully",
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error signing contract: {e}")
        raise HTTPException(
            status_code=500, detail="Failed to sign contract"
        )


@router.get("/{token}/pdf")
async def get_contract_pdf_public(token: str):
    """
    Public endpoint: Serve contract PDF by signing token.
    No authentication required.
    If no filled PDF exists, generates one on-the-fly
    from template + prefill data.
    """
    from starlette.responses import Response

    try:
        service = _get_service()
        contract = service.get_by_token(token)
        if not contract:
            raise HTTPException(
                status_code=404, detail="Contract not found"
            )

        filled_url = contract.get('filled_pdf_url', '')
        file_url = contract.get('file_url', '')
        storage_prov = contract.get('storage_provider')

        from app.domains.contract.api import (
            _resolve_contract_pdf,
        )

        # 1) Try filled PDF first
        if filled_url:
            pdf_bytes = _resolve_contract_pdf(
                filled_url, storage_prov
            )
            if pdf_bytes:
                return Response(
                    content=pdf_bytes,
                    media_type="application/pdf",
                    headers={
                        "Content-Disposition":
                            'inline; filename="contract.pdf"'
                    },
                )

        # 2) No filled PDF — generate on-the-fly
        template_url = file_url
        if not template_url:
            raise HTTPException(
                status_code=404, detail="No PDF available"
            )

        template_bytes = _resolve_contract_pdf(
            template_url, storage_prov
        )
        if not template_bytes:
            raise HTTPException(
                status_code=404, detail="PDF not found"
            )

        # Try to overlay prefill data on template
        field_mappings_raw = contract.get('field_mappings')
        prefill_raw = contract.get('prefill_data')
        if field_mappings_raw and prefill_raw:
            try:
                overlay = _generate_filled_pdf_bytes(
                    template_bytes,
                    field_mappings_raw,
                    prefill_raw,
                )
                if overlay:
                    template_bytes = overlay
            except Exception as e:
                logger.warning(
                    f"On-the-fly PDF fill failed: {e}"
                )

        return Response(
            content=template_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition":
                    'inline; filename="contract.pdf"'
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error serving public contract PDF: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=500, detail="Failed to load PDF"
        )


def _generate_filled_pdf_bytes(
    template_bytes: bytes,
    field_mappings_raw,
    prefill_raw,
) -> bytes:
    """Generate a filled PDF from template bytes +
    field mappings + prefill data. Returns PDF bytes."""
    from io import BytesIO
    from pypdf import PdfReader, PdfWriter
    from reportlab.pdfgen import canvas as rl_canvas
    from reportlab.pdfbase.pdfmetrics import stringWidth

    # Parse mappings and prefill
    mappings = field_mappings_raw
    if isinstance(mappings, str):
        mappings = json.loads(mappings)
    prefill = prefill_raw
    if isinstance(prefill, str):
        prefill = json.loads(prefill)

    if not isinstance(mappings, list) or not prefill:
        return None

    # Filter to text-only fields (skip signature/initial)
    sig_prefixes = ('signature.', 'initial.', 'date_signed.')
    text_mappings = [
        m for m in mappings
        if not any(
            m.get('fieldKey', '').startswith(p)
            for p in sig_prefixes
        )
    ]
    if not text_mappings:
        return None

    def resolve(field_key):
        parts = field_key.split('.', 1)
        if len(parts) != 2:
            return ''
        cat, key = parts
        cat_data = prefill.get(cat, {})
        if isinstance(cat_data, str):
            try:
                cat_data = json.loads(cat_data)
            except Exception:
                return ''
        val = cat_data.get(key)
        return str(val) if val is not None else ''

    # Check if any field has a value
    has_values = any(
        resolve(m.get('fieldKey', '')) for m in text_mappings
    )
    if not has_values:
        return None

    reader = PdfReader(BytesIO(template_bytes))
    writer = PdfWriter()

    # Group by page
    page_map = {}
    for m in text_mappings:
        pi = m.get('pageIndex', 0)
        page_map.setdefault(pi, []).append(m)

    for pg in range(len(reader.pages)):
        page = reader.pages[pg]
        pw = float(page.mediabox.width)
        ph = float(page.mediabox.height)

        fields = page_map.get(pg, [])
        if fields:
            buf = BytesIO()
            c = rl_canvas.Canvas(buf, pagesize=(pw, ph))

            for f in fields:
                val = resolve(f.get('fieldKey', ''))
                if not val:
                    continue
                fx = f.get('x', 0) * pw
                fw = f.get('width', 0.25) * pw
                fh = f.get('height', 0.03) * ph
                fy = ph - (f.get('y', 0) * ph) - fh
                fs = f.get('fontSize', 12)

                # Font color
                fc = f.get('fontColor', '#000000')
                try:
                    r = int(fc[1:3], 16) / 255
                    g = int(fc[3:5], 16) / 255
                    b = int(fc[5:7], 16) / 255
                    c.setFillColorRGB(r, g, b)
                except Exception:
                    c.setFillColorRGB(0, 0, 0)

                # Auto-shrink
                usable = fw - 4
                sz = fs
                while sz > 5:
                    if stringWidth(val, "Helvetica", sz) <= usable:
                        break
                    sz -= 0.5

                c.setFont("Helvetica", sz)
                ty = fy + (fh - sz) / 2
                c.drawString(fx + 2, ty, val)

            c.save()
            buf.seek(0)
            overlay = PdfReader(buf)
            if overlay.pages:
                page.merge_page(overlay.pages[0])

        writer.add_page(page)

    out = BytesIO()
    writer.write(out)
    return out.getvalue()


def _send_signed_notification(service, token: str, signer_name: str):
    """Send signed PDF to company email + original recipients after signing."""
    import json as _json

    contract = service.get_by_token(token)
    if not contract:
        return

    # Collect recipients: company email + original sent_to_emails
    recipients = set()
    company_email = contract.get('company_email', '')
    if company_email:
        recipients.add(company_email)

    raw_sent = contract.get('sent_to_emails')
    if raw_sent:
        try:
            sent_list = _json.loads(raw_sent) if isinstance(raw_sent, str) else raw_sent
            for e in sent_list:
                if e and '@' in e:
                    recipients.add(e)
        except Exception:
            pass

    if not recipients:
        logger.info("[SignedNotification] No recipients for signed PDF notification")
        return

    # Get signed PDF bytes
    signed_url = contract.get('signed_pdf_url') or contract.get('filled_pdf_url')
    pdf_attachment = None
    if signed_url:
        try:
            from app.domains.contract.api import _resolve_contract_pdf
            pdf_bytes = _resolve_contract_pdf(signed_url, contract.get('storage_provider'))
            if pdf_bytes:
                title_safe = (contract.get('title') or 'Contract').replace(' ', '_')
                pdf_attachment = {
                    'data': pdf_bytes,
                    'filename': f"{title_safe}_Signed.pdf",
                    'mime_type': 'application/pdf',
                }
        except Exception as e:
            logger.warning(f"[SignedNotification] Could not load signed PDF: {e}")

    # Build email
    company = contract.get('company_name', 'Our Company')
    title = contract.get('title') or contract.get('template_name') or 'Contract'
    signed_at = contract.get('signed_at')
    signed_date = ''
    if signed_at:
        try:
            if isinstance(signed_at, str):
                signed_at = datetime.fromisoformat(signed_at)
            signed_date = signed_at.strftime('%B %d, %Y at %I:%M %p')
        except Exception:
            signed_date = str(signed_at)

    subject = f"Signed: {title} — {company}"
    body_html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #f0f7ff; border-radius: 8px; padding: 24px; margin-bottom: 20px; text-align: center;">
            <div style="font-size: 32px; margin-bottom: 8px;">✅</div>
            <h2 style="margin: 0; color: #1a1a1a;">{title}</h2>
            <p style="color: #666; margin: 8px 0 0;">Signed by <strong>{signer_name}</strong></p>
            {f'<p style="color: #999; margin: 4px 0 0; font-size: 13px;">{signed_date}</p>' if signed_date else ''}
        </div>
        <p style="color: #333; line-height: 1.6;">
            The document <strong>{title}</strong> has been signed by <strong>{signer_name}</strong>.
            {' A copy of the signed document is attached to this email.' if pdf_attachment else ''}
        </p>
        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee; color: #999; font-size: 12px;">
            <p>This is an automated notification from {company}.</p>
        </div>
    </div>
    """

    # Send
    try:
        from app.domains.claim_followup.smtp_service import SmtpService
        from app.core.config import settings

        smtp = SmtpService()
        smtp_user = getattr(settings, 'SMTP_USER', '')
        if not smtp_user:
            logger.warning("[SignedNotification] SMTP not configured, skipping")
            return

        reply_to = company_email or getattr(settings, 'SMTP_FROM_EMAIL', '') or smtp_user

        smtp.send(
            account_id=None,
            from_address=smtp_user,
            to_addresses=list(recipients),
            subject=subject,
            body_html=body_html,
            reply_to=reply_to,
            skip_signature=True,
            display_name_override=company,
            attachments=[pdf_attachment] if pdf_attachment else [],
        )
        logger.info(
            f"[SignedNotification] Signed PDF sent to {list(recipients)} "
            f"for contract {contract.get('id')}"
        )
    except Exception as e:
        logger.error(f"[SignedNotification] Failed to send: {e}")
