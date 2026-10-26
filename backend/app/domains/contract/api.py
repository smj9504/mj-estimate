"""
Contract admin API endpoints (requires authentication)
"""

import logging
import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, Form
from pathlib import Path

from app.core.database_factory import get_db_session as get_db
from app.domains.auth.company_scope import (
    company_ids,
    require_claim,
    require_client,
    require_document,
)
from app.domains.auth.dependencies import get_current_staff
from app.domains.contract.models import ClaimCompany, ContractInstance
from app.domains.staff.models import Staff
from app.domains.contract.schemas import (
    ContractTemplateCreate,
    ContractTemplateUpdate,
    ContractTemplateResponse,
    ContractInstanceCreate,
    ContractInstanceUpdate,
    ContractInstanceResponse,
    ClaimCompanyCreate,
    ClaimCompanyResponse,
    FieldMappingUpdate,
)
from app.domains.contract.service import (
    ContractTemplateService,
    ContractInstanceService,
    ClaimCompanyService,
)

logger = logging.getLogger(__name__)
router = APIRouter()


def _get_template_service():
    from app.core.database_factory import get_database
    return ContractTemplateService(get_database())


def _get_instance_service():
    from app.core.database_factory import get_database
    return ContractInstanceService(get_database())


def _get_claim_company_service():
    from app.core.database_factory import get_database
    return ClaimCompanyService(get_database())


# ============================================================
# Contract Templates
# ============================================================

@router.get("/templates")
def list_templates(
    company_id: Optional[str] = None,
    service: ContractTemplateService = Depends(_get_template_service),
    current_staff: Staff = Depends(get_current_staff),
):
    """List all contract templates, optionally filtered by company"""
    try:
        if company_id:
            templates = service.get_by_company(company_id)
        else:
            templates = service.get_all_with_company()
        return {"templates": templates, "total": len(templates)}
    except Exception as e:
        logger.error(f"Error listing templates: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/templates")
async def create_template(
    company_id: str = Form(...),
    name: str = Form(...),
    document_type: str = Form("authorization"),
    description: str = Form(None),
    requires_signature: bool = Form(True),
    signature_roles: str = Form('["homeowner"]'),
    file: UploadFile = File(...),
    service: ContractTemplateService = Depends(_get_template_service),
    current_staff: Staff = Depends(get_current_staff),
):
    """Create a contract template with PDF upload"""
    try:
        # Validate file type
        if not file.filename.lower().endswith('.pdf'):
            raise HTTPException(status_code=400, detail="Only PDF files are allowed")

        # Upload file to cloud storage
        content = await file.read()

        from app.common.utils.storage_helpers import upload_bytes_to_storage
        storage_info = upload_bytes_to_storage(
            file_bytes=content,
            filename=file.filename,
            context="contracts",
            context_id=str(uuid.uuid4()),
            category="templates",
            content_type="application/pdf",
        )

        # Create template record
        template_data = {
            'company_id': company_id,
            'name': name,
            'document_type': document_type,
            'description': description,
            'requires_signature': requires_signature,
            'signature_roles': signature_roles,
            'file_url': storage_info["file_path"],
            'file_name': file.filename,
            'file_size': storage_info["file_size"],
            'storage_provider': storage_info["storage_provider"],
            'storage_file_id': storage_info["storage_file_id"],
        }

        result = service.create(template_data)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating template: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/templates/{template_id}")
def get_template(
    template_id: str,
    service: ContractTemplateService = Depends(_get_template_service),
    current_staff: Staff = Depends(get_current_staff),
):
    try:
        template = service.get_by_id(template_id)
        if not template:
            raise HTTPException(status_code=404, detail="Template not found")
        return template
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/templates/{template_id}")
def update_template(
    template_id: str,
    data: ContractTemplateUpdate,
    service: ContractTemplateService = Depends(_get_template_service),
    current_staff: Staff = Depends(get_current_staff),
):
    try:
        result = service.update(template_id, data.dict(exclude_unset=True))
        if not result:
            raise HTTPException(status_code=404, detail="Template not found")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/templates/{template_id}/upload")
async def replace_template_pdf(
    template_id: str,
    file: UploadFile = File(...),
    service: ContractTemplateService = Depends(_get_template_service),
    current_staff: Staff = Depends(get_current_staff),
):
    """Replace the PDF file of an existing template"""
    try:
        if not file.filename.lower().endswith('.pdf'):
            raise HTTPException(status_code=400, detail="Only PDF files are allowed")

        content = await file.read()

        from app.common.utils.storage_helpers import upload_bytes_to_storage
        storage_info = upload_bytes_to_storage(
            file_bytes=content,
            filename=file.filename,
            context="contracts",
            context_id=template_id,
            category="templates",
            content_type="application/pdf",
        )

        result = service.update(template_id, {
            'file_url': storage_info["file_path"],
            'file_name': file.filename,
            'file_size': storage_info["file_size"],
            'storage_provider': storage_info["storage_provider"],
            'storage_file_id': storage_info["storage_file_id"],
        })
        if not result:
            raise HTTPException(status_code=404, detail="Template not found")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/templates/{template_id}")
def delete_template(
    template_id: str,
    service: ContractTemplateService = Depends(_get_template_service),
    current_staff: Staff = Depends(get_current_staff),
):
    try:
        success = service.delete(template_id)
        if not success:
            raise HTTPException(status_code=404, detail="Template not found")
        return {"message": "Template deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Contract Instances (under claim)
# ============================================================

@router.get("/claims/{claim_id}/contracts")
def list_contracts(
    claim_id: str,
    service: ContractInstanceService = Depends(_get_instance_service),
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    require_claim(db, current_staff, claim_id)
    try:
        contracts = service.get_by_claim(claim_id)
        return {"contracts": contracts, "total": len(contracts)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/claims/{claim_id}/contracts")
def create_contract(
    claim_id: str,
    data: ContractInstanceCreate,
    service: ContractInstanceService = Depends(_get_instance_service),
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Generate a contract from a template for this claim"""
    require_claim(db, current_staff, claim_id)
    if data.client_id:
        require_client(db, current_staff, data.client_id)
    try:
        contract_data = data.dict()
        contract_data['claim_id'] = claim_id
        result = service.create_contract(contract_data)
        return result
    except Exception as e:
        logger.error(f"Error creating contract: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/claims/{claim_id}/contracts/{contract_id}")
def get_contract(
    claim_id: str,
    contract_id: str,
    service: ContractInstanceService = Depends(_get_instance_service),
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    require_document(db, current_staff, ContractInstance, contract_id, "Contract")
    try:
        contract = service.get_by_id(contract_id)
        if not contract:
            raise HTTPException(status_code=404, detail="Contract not found")
        return contract
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/claims/{claim_id}/contracts/{contract_id}/send")
def send_contract(
    claim_id: str,
    contract_id: str,
    service: ContractInstanceService = Depends(_get_instance_service),
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Mark contract as sent and return signing info"""
    require_document(db, current_staff, ContractInstance, contract_id, "Contract")
    try:
        result = service.send_for_signing(contract_id)
        if not result:
            raise HTTPException(
                status_code=404, detail="Contract not found"
            )
        token = result.get('signing_token')
        return {
            "contract": result,
            "signing_url": f"/sign/{token}",
            "signing_token": token,
            "expires_at": result.get('token_expires_at'),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Email Templates by Document Type
# ============================================================

EMAIL_TEMPLATES = {
    # --- Authorization (EWA) ---
    'authorization': {
        'heading': 'Authorization Required',
        'subject': (
            'Action Required: Please Sign Authorization'
            ' — {company}'
        ),
        'body': (
            'We need your written authorization before '
            'we can begin work on your property. Please '
            'review and sign the <strong>Emergency Work '
            'Authorization (EWA)</strong> document from '
            '<strong>{company}</strong>.'
        ),
        'button_text': 'Review & Authorize',
    },
    # --- COS: Water Mitigation ---
    'cos_water_mitigation': {
        'heading': 'Water Mitigation — Certificate of '
                   'Satisfaction',
        'subject': (
            'Water Mitigation Complete — Please Confirm'
            ' Satisfaction — {company}'
        ),
        'body': (
            'The water mitigation work on your property '
            'has been completed, including water '
            'extraction, drying, and moisture monitoring.'
            ' Please review and sign the <strong>'
            'Certificate of Satisfaction (COS)</strong> '
            'to confirm the mitigation work has been '
            'finished to your satisfaction.'
        ),
        'button_text': 'Review & Confirm',
    },
    # --- COS: Rebuild / Restoration ---
    'cos_rebuild': {
        'heading': 'Rebuild/Restoration — Certificate '
                   'of Satisfaction',
        'subject': (
            'Restoration Complete — Please Confirm'
            ' Satisfaction — {company}'
        ),
        'body': (
            'The rebuild and restoration work on your '
            'property has been completed. Please review '
            'and sign the <strong>Certificate of '
            'Satisfaction (COS)</strong> to confirm that '
            'all reconstruction work has been finished '
            'to your satisfaction.'
        ),
        'button_text': 'Review & Confirm',
    },
    # --- COS: General (fallback) ---
    'certificate_of_satisfaction': {
        'heading': 'Certificate of Satisfaction',
        'subject': (
            'Please Confirm Satisfaction — {company}'
        ),
        'body': (
            'The work on your property has been '
            'completed. Please review and sign the '
            '<strong>Certificate of Satisfaction (COS)'
            '</strong> to confirm that all work has '
            'been finished to your satisfaction.'
        ),
        'button_text': 'Review & Confirm',
    },
    # --- Certificate of Completion ---
    'certificate_of_completion': {
        'heading': 'Certificate of Completion',
        'subject': (
            'Work Complete — Please Sign Certificate'
            ' — {company}'
        ),
        'body': (
            'We are pleased to inform you that the work '
            'on your property has been completed. Please '
            'review and sign the <strong>Certificate of '
            'Completion</strong> to acknowledge the '
            'finished work.'
        ),
        'button_text': 'Review & Sign',
    },
    # --- Scope of Work ---
    'scope_of_work': {
        'heading': 'Scope of Work for Review',
        'subject': (
            'Scope of Work Ready for Approval'
            ' — {company}'
        ),
        'body': (
            'The scope of work for your project has '
            'been prepared. Please review the details '
            'and sign to approve the planned work from '
            '<strong>{company}</strong>.'
        ),
        'button_text': 'Review & Approve',
    },
    # --- Lien Waiver ---
    'lien_waiver': {
        'heading': 'Lien Waiver',
        'subject': (
            'Lien Waiver — Signature Required'
            ' — {company}'
        ),
        'body': (
            'A lien waiver document has been prepared '
            'for your records. Please review and sign '
            'the document from '
            '<strong>{company}</strong>.'
        ),
        'button_text': 'Review & Sign',
    },
    # --- Change Order ---
    'change_order': {
        'heading': 'Change Order Approval',
        'subject': (
            'Change Order — Your Approval Needed'
            ' — {company}'
        ),
        'body': (
            'A change order has been submitted for your '
            'project. Please review the updated scope '
            'and cost, and sign to approve the changes '
            'from <strong>{company}</strong>.'
        ),
        'button_text': 'Review & Approve',
    },
    # --- Other (default) ---
    'other': {
        'heading': 'Document Ready for Signature',
        'subject': (
            'Signature Required: {title} — {company}'
        ),
        'body': (
            'You have a document that requires your '
            'signature from <strong>{company}</strong>.'
            '<br/><strong>Document:</strong> {title}'
        ),
        'button_text': 'Review & Sign',
    },
}


def _get_email_template(doc_type: str) -> dict:
    return EMAIL_TEMPLATES.get(
        doc_type, EMAIL_TEMPLATES['other']
    )


def _build_email_html(
    heading: str,
    body_intro: str,
    custom_msg: str,
    signing_url: str,
    button_text: str,
    company: str,
    expires: str,
    company_email: str = '',
    company_phone: str = '',
    company_address: str = '',
) -> str:
    custom_block = (
        f'<p style="margin-top:16px;padding:12px 16px;'
        f'background:#f6f6f6;border-radius:6px;'
        f'border-left:3px solid #1677ff;">'
        f'{custom_msg}</p>'
        if custom_msg else ''
    )

    # Company contact footer (anti-spam: real contact info)
    contact_parts = []
    if company_email:
        contact_parts.append(company_email)
    if company_phone:
        contact_parts.append(company_phone)
    if company_address:
        contact_parts.append(company_address)
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
  <!-- Header -->
  <tr>
    <td style="background:#1677ff;padding:20px 32px;">
      <h1 style="margin:0;color:#ffffff;font-family:
          Arial,sans-serif;font-size:20px;">
        {company}
      </h1>
    </td>
  </tr>
  <!-- Body -->
  <tr>
    <td style="padding:32px;font-family:Arial,sans-serif;
               font-size:15px;line-height:1.6;color:#333;">
      <h2 style="margin:0 0 16px;color:#262626;
                 font-size:22px;">{heading}</h2>
      <p style="margin:0 0 16px;">{body_intro}</p>
      {custom_block}
      <div style="margin:28px 0;text-align:center;">
        <a href="{signing_url}"
           style="background:#1677ff;color:#ffffff;
                  padding:14px 40px;border-radius:6px;
                  text-decoration:none;font-size:16px;
                  font-weight:600;display:inline-block;">
          {button_text}
        </a>
      </div>
      <p style="color:#8c8c8c;font-size:13px;
                word-break:break-all;">
        If the button doesn't work, copy and paste
        this link into your browser:<br/>
        <a href="{signing_url}"
           style="color:#1677ff;">{signing_url}</a>
      </p>
    </td>
  </tr>
  <!-- Footer -->
  <tr>
    <td style="padding:20px 32px;background:#fafafa;
               border-top:1px solid #e8e8e8;
               font-family:Arial,sans-serif;">
      <p style="margin:0 0 8px;color:#8c8c8c;
                font-size:12px;">
        This link will expire on {expires}.
      </p>
      <p style="margin:0;color:#8c8c8c;font-size:12px;">
        <strong>{company}</strong>
        {f'<br/>{contact_line}' if contact_line else ''}
      </p>
      <p style="margin:8px 0 0;color:#bfbfbf;
                font-size:11px;">
        You received this email because a document
        requires your signature. This is a one-time
        notification and not a subscription.
      </p>
    </td>
  </tr>
</table>
</td></tr></table>
</body>
</html>"""


@router.get("/email-templates")
def get_email_templates():
    """Return available email templates for the UI"""
    return {
        k: {
            'heading': v['heading'],
            'subject': v['subject'],
            'button_text': v['button_text'],
            'body_preview': v['body'][:120] + '...'
            if len(v['body']) > 120 else v['body'],
        }
        for k, v in EMAIL_TEMPLATES.items()
    }


@router.post(
    "/claims/{claim_id}/contracts/{contract_id}/send-email"
)
def send_contract_email(
    claim_id: str,
    contract_id: str,
    data: dict,
    service: ContractInstanceService = Depends(
        _get_instance_service
    ),
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Send signing link via email to multiple recipients.
    Body: { emails: string[], message?: string }
    """
    require_document(db, current_staff, ContractInstance, contract_id, "Contract")
    try:
        emails = data.get('emails', [])
        if not emails:
            raise HTTPException(
                status_code=400,
                detail="At least one email is required"
            )

        # Get contract with enriched data
        session = service.database.get_readonly_session()
        try:
            from app.domains.contract.repository import (
                get_instance_repository,
            )
            repo = get_instance_repository(session)
            contract = repo.get_by_id_enriched(contract_id)
        finally:
            session.close()

        if not contract:
            raise HTTPException(
                status_code=404, detail="Contract not found"
            )

        token = contract.get('signing_token')
        if not token:
            raise HTTPException(
                status_code=400,
                detail="Contract has no signing token"
            )

        # Mark as sent if still draft
        if contract.get('status') == 'draft':
            service.send_for_signing(contract_id)

        # Save sent_to_emails for post-signing notification
        import json as _json
        existing = []
        raw = contract.get('sent_to_emails')
        if raw:
            try:
                existing = _json.loads(raw) if isinstance(raw, str) else raw
            except Exception:
                existing = []
        merged = list(set(existing + emails))
        service.update(contract_id, {'sent_to_emails': _json.dumps(merged)})

        # Build signing URL from frontend origin
        origin = data.get('origin_url', '').rstrip('/')
        if not origin:
            from app.core.config import settings
            origin = getattr(
                settings, 'FRONTEND_URL', ''
            ) or 'http://localhost:3000'
        signing_url = f"{origin}/sign/{token}"

        # Build email from template
        company = contract.get(
            'company_name', 'Our Company'
        )
        title = (
            contract.get('title')
            or contract.get('template_name')
            or 'Contract Document'
        )
        client_name = contract.get(
            'client_name', ''
        )
        doc_type = contract.get(
            'document_type', 'other'
        )
        custom_msg = data.get('message', '')

        # Allow frontend to override template key
        template_key = data.get(
            'template_key', doc_type
        )
        tpl = _get_email_template(template_key)
        subject = tpl['subject'].format(
            company=company, title=title,
            client_name=client_name,
        )
        body_intro = tpl['body'].format(
            company=company, title=title,
            client_name=client_name,
        )

        company_email = contract.get(
            'company_email', ''
        )
        company_phone = contract.get(
            'company_phone', ''
        )

        body_html = _build_email_html(
            heading=tpl['heading'],
            body_intro=body_intro,
            custom_msg=custom_msg,
            signing_url=signing_url,
            button_text=tpl['button_text'],
            company=company,
            expires=contract.get(
                'token_expires_at', 'N/A'
            ),
            company_email=company_email or '',
            company_phone=company_phone or '',
        )

        # Send via SMTP — prefer company email account
        from app.domains.claim_followup.smtp_service import (
            SmtpService,
        )
        from app.domains.contract.signing_api import (
            _find_company_email_account,
        )
        smtp = SmtpService()
        company_email = contract.get('company_email', '')
        company_id = contract.get('company_id')
        account_id = _find_company_email_account(company_id)

        cc = data.get('cc', []) or []
        bcc = data.get('bcc', []) or []

        if account_id:
            result = smtp.send(
                account_id=account_id,
                from_address=company_email or '',
                to_addresses=emails,
                subject=subject,
                body_html=body_html,
                cc_addresses=cc,
                bcc_addresses=bcc,
                skip_signature=True,
            )
        else:
            smtp_user = getattr(settings, 'SMTP_USER', '')
            if not smtp_user:
                raise HTTPException(
                    status_code=500,
                    detail="SMTP not configured."
                )
            result = smtp.send(
                account_id=None,
                from_address=smtp_user,
                to_addresses=emails,
                subject=subject,
                body_html=body_html,
                cc_addresses=cc,
                bcc_addresses=bcc,
                reply_to=company_email or smtp_user,
                skip_signature=True,
                display_name_override=company,
            )

        # Audit: document emailed for signature
        try:
            service.append_audit_log(
                contract_id,
                action='emailed',
                detail={
                    'recipients': emails,
                    'cc': cc if cc else None,
                    'template_key': template_key,
                },
            )
        except Exception:
            pass

        return {
            "message": f"Email sent to {len(emails)} "
                       f"recipient(s)",
            "emails": emails,
            "signing_url": signing_url,
            "smtp_result": result,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error sending contract email: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to send email: {str(e)}"
        )


@router.post("/claims/{claim_id}/contracts/{contract_id}/void")
def void_contract(
    claim_id: str,
    contract_id: str,
    service: ContractInstanceService = Depends(
        _get_instance_service
    ),
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    require_document(db, current_staff, ContractInstance, contract_id, "Contract")
    try:
        result = service.void_contract(contract_id)
        if not result:
            raise HTTPException(
                status_code=404, detail="Contract not found"
            )
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete(
    "/claims/{claim_id}/contracts/{contract_id}"
)
def delete_contract(
    claim_id: str,
    contract_id: str,
    service: ContractInstanceService = Depends(
        _get_instance_service
    ),
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Delete a contract instance"""
    require_document(db, current_staff, ContractInstance, contract_id, "Contract")
    try:
        success = service.delete(contract_id)
        if not success:
            raise HTTPException(
                status_code=404, detail="Contract not found"
            )
        return {"message": "Contract deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Send Reminder
# ============================================================

@router.post(
    "/claims/{claim_id}/contracts/{contract_id}"
    "/send-reminder"
)
def send_reminder(
    claim_id: str,
    contract_id: str,
    data: dict,
    service: ContractInstanceService = Depends(
        _get_instance_service
    ),
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Resend signing link as a reminder email.
    Body: { emails: string[], message?: string }
    """
    require_document(db, current_staff, ContractInstance, contract_id, "Contract")
    try:
        emails = data.get('emails', [])
        if not emails:
            raise HTTPException(
                status_code=400,
                detail="At least one email is required"
            )

        session = service.database.get_readonly_session()
        try:
            from app.domains.contract.repository import (
                get_instance_repository,
            )
            repo = get_instance_repository(session)
            contract = repo.get_by_id_enriched(contract_id)
        finally:
            session.close()

        if not contract:
            raise HTTPException(
                status_code=404,
                detail="Contract not found",
            )

        token = contract.get('signing_token')
        if not token:
            raise HTTPException(
                status_code=400,
                detail="Contract has no signing token",
            )

        status = contract.get('status', 'draft')
        if status in ('signed', 'voided'):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot send reminder for "
                       f"{status} contract",
            )

        # Build signing URL
        origin = data.get(
            'origin_url', ''
        ).rstrip('/')
        if not origin:
            from app.core.config import settings
            origin = getattr(
                settings, 'FRONTEND_URL', ''
            ) or 'http://localhost:3000'
        signing_url = f"{origin}/sign/{token}"

        # Build reminder email
        company = contract.get(
            'company_name', 'Our Company'
        )
        title = (
            contract.get('title')
            or contract.get('template_name')
            or 'Contract Document'
        )
        custom_msg = data.get('message', '')
        doc_type = contract.get(
            'document_type', 'other'
        )
        template_key = data.get(
            'template_key', doc_type
        )
        tpl = _get_email_template(template_key)

        subject = (
            f"Reminder: {tpl['subject']}".format(
                company=company, title=title,
                client_name=contract.get(
                    'client_name', ''
                ),
            )
        )
        body_intro = (
            '<strong>This is a friendly reminder'
            '</strong> that the following document '
            'still requires your signature.<br/><br/>'
            + tpl['body'].format(
                company=company, title=title,
                client_name=contract.get(
                    'client_name', ''
                ),
            )
        )

        company_email = contract.get(
            'company_email', ''
        )
        company_phone = contract.get(
            'company_phone', ''
        )

        body_html = _build_email_html(
            heading=f"Reminder: {tpl['heading']}",
            body_intro=body_intro,
            custom_msg=custom_msg,
            signing_url=signing_url,
            button_text=tpl['button_text'],
            company=company,
            expires=contract.get(
                'token_expires_at', 'N/A'
            ),
            company_email=company_email or '',
            company_phone=company_phone or '',
        )

        # Send via SMTP
        from app.domains.claim_followup.smtp_service import (
            SmtpService,
        )
        from app.domains.contract.signing_api import (
            _find_company_email_account,
        )
        smtp = SmtpService()
        company_id = contract.get('company_id')
        account_id = _find_company_email_account(
            company_id
        )

        if account_id:
            smtp.send(
                account_id=account_id,
                from_address=company_email or '',
                to_addresses=emails,
                subject=subject,
                body_html=body_html,
                skip_signature=True,
            )
        else:
            from app.core.config import settings
            smtp_user = getattr(
                settings, 'SMTP_USER', ''
            )
            if not smtp_user:
                raise HTTPException(
                    status_code=500,
                    detail="SMTP not configured.",
                )
            smtp.send(
                account_id=None,
                from_address=smtp_user,
                to_addresses=emails,
                subject=subject,
                body_html=body_html,
                reply_to=company_email or smtp_user,
                skip_signature=True,
                display_name_override=company,
            )

        # Audit: reminder sent
        try:
            service.append_audit_log(
                contract_id,
                action='reminder_sent',
                detail={'recipients': emails},
            )
        except Exception:
            pass

        return {
            "message": f"Reminder sent to "
                       f"{len(emails)} recipient(s)",
            "emails": emails,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error sending reminder: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to send reminder: "
                   f"{str(e)}",
        )


# ============================================================
# Claim Companies
# ============================================================

@router.get("/claims/{claim_id}/companies")
def list_claim_companies(
    claim_id: str,
    service: ClaimCompanyService = Depends(_get_claim_company_service),
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    require_claim(db, current_staff, claim_id)
    try:
        companies = service.get_by_claim(claim_id)
        return {"companies": companies, "total": len(companies)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/claims/{claim_id}/companies")
def assign_company(
    claim_id: str,
    data: ClaimCompanyCreate,
    service: ClaimCompanyService = Depends(_get_claim_company_service),
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    require_claim(db, current_staff, claim_id)
    try:
        company_data = data.dict()
        company_data['claim_id'] = claim_id
        result = service.create(company_data)
        return result
    except Exception as e:
        logger.error(f"Error assigning company: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/claims/{claim_id}/companies/{assignment_id}")
def remove_company(
    claim_id: str,
    assignment_id: str,
    service: ClaimCompanyService = Depends(_get_claim_company_service),
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    require_document(
        db, current_staff, ClaimCompany, assignment_id, "Assignment", company_attr=None
    )
    ids = company_ids(db, current_staff)
    if ids is not None:
        # The claim would drop out of their view with its last company of theirs
        row = db.query(ClaimCompany.claim_id, ClaimCompany.company_id).filter(
            ClaimCompany.id == assignment_id
        ).first()
        if str(row.company_id) in ids:
            others = db.query(ClaimCompany.id).filter(
                ClaimCompany.claim_id == row.claim_id,
                ClaimCompany.company_id.in_(ids),
                ClaimCompany.id != assignment_id,
            ).first()
            if others is None:
                raise HTTPException(
                    status_code=400,
                    detail="You can't remove the last of your companies from this claim.",
                )
    try:
        success = service.delete(assignment_id)
        if not success:
            raise HTTPException(status_code=404, detail="Assignment not found")
        return {"message": "Company removed from claim"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Claim - Plumber Report link
# ============================================================

# ============================================================
# Field Mappings
# ============================================================

@router.get("/templates/{template_id}/field-mappings")
def get_field_mappings(
    template_id: str,
    service: ContractTemplateService = Depends(_get_template_service),
    current_staff: Staff = Depends(get_current_staff),
):
    """Get field mappings and available fields for a template"""
    try:
        return service.get_field_mappings(template_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/templates/{template_id}/field-mappings")
def update_field_mappings(
    template_id: str,
    data: FieldMappingUpdate,
    service: ContractTemplateService = Depends(_get_template_service),
    current_staff: Staff = Depends(get_current_staff),
):
    """Save field mappings for a template"""
    try:
        mappings = [m.dict() for m in data.field_mappings]
        result = service.update_field_mappings(
            template_id, mappings
        )
        if not result:
            raise HTTPException(
                status_code=404, detail="Template not found"
            )
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Prefill Preview & Dashboard
# ============================================================

@router.get("/claims/{claim_id}/prefill-preview")
def get_prefill_preview(
    claim_id: str,
    template_id: str,
    client_id: str,
    company_id: str,
    service: ContractInstanceService = Depends(
        _get_instance_service
    ),
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Preview prefill data before generating a contract"""
    require_claim(db, current_staff, claim_id)
    if client_id:
        require_client(db, current_staff, client_id)
    try:
        return service.get_prefill_preview(
            claim_id, template_id, client_id, company_id
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/claims/{claim_id}/dashboard")
def get_claim_dashboard(
    claim_id: str,
    service: ContractInstanceService = Depends(
        _get_instance_service
    ),
    current_staff: Staff = Depends(get_current_staff),
    db=Depends(get_db),
):
    """Get contracts grouped by company for a claim"""
    require_claim(db, current_staff, claim_id)
    try:
        return service.get_dashboard(claim_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Claim - Plumber Report link
# ============================================================

@router.put("/claims/{claim_id}/plumber-report")
def link_plumber_report(
    claim_id: str,
    plumber_report_id: Optional[str] = None,
    db=Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
):
    """Link or unlink a plumber report to/from a claim"""
    require_claim(db, current_staff, claim_id)
    if plumber_report_id:
        # Linking would make the report visible through the claim
        from app.domains.plumber_report.api import require_report
        require_report(db, current_staff, plumber_report_id)
    try:
        from app.domains.client.models import Claim
        claim = db.query(Claim).filter(Claim.id == claim_id).first()
        if not claim:
            raise HTTPException(status_code=404, detail="Claim not found")

        claim.plumber_report_id = plumber_report_id
        db.commit()
        return {"message": "Plumber report linked" if plumber_report_id else "Plumber report unlinked"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# PDF Serve Endpoints (cloud storage support)
# ============================================================

@router.get("/templates/{template_id}/pdf")
def serve_template_pdf(
    template_id: str,
    service: ContractTemplateService = Depends(_get_template_service),
):
    """Serve template PDF from cloud or local storage."""
    from starlette.responses import Response

    try:
        template = service.get_by_id(template_id)
        if not template:
            raise HTTPException(status_code=404, detail="Template not found")

        file_url = template.get('file_url') if isinstance(template, dict) else getattr(template, 'file_url', '')
        storage_prov = template.get('storage_provider', 'local') if isinstance(template, dict) else getattr(template, 'storage_provider', 'local')
        file_name = template.get('file_name', 'template.pdf') if isinstance(template, dict) else getattr(template, 'file_name', 'template.pdf')

        pdf_bytes = _resolve_contract_pdf(file_url, storage_prov)
        if not pdf_bytes:
            raise HTTPException(status_code=404, detail="Template PDF not found")

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{file_name}"'}
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error serving template PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/contracts/{contract_id}/pdf")
def serve_contract_pdf(
    contract_id: str,
    service: ContractInstanceService = Depends(_get_instance_service),
):
    """Serve filled contract PDF from cloud or local storage."""
    from starlette.responses import Response

    try:
        # Use enriched query to get template file_url as fallback
        session = service.database.get_readonly_session()
        try:
            from app.domains.contract.repository import get_instance_repository
            repo = get_instance_repository(session)
            contract = repo.get_by_id_enriched(contract_id)
        finally:
            session.close()

        if not contract:
            raise HTTPException(status_code=404, detail="Contract not found")

        filled_url = contract.get('filled_pdf_url', '')
        file_url = contract.get('file_url', '')
        pdf_url = filled_url or file_url

        if not pdf_url:
            raise HTTPException(status_code=404, detail="No PDF available")

        # provider must match whichever url we actually picked above -
        # filled_pdf_provider for the instance's own generated PDF,
        # falling back to the template's provider only when we fell back
        # to the template's file_url too (previously this always read the
        # template's provider even when serving the instance's own PDF)
        storage_provider = contract.get('filled_pdf_provider') if filled_url else contract.get('storage_provider')
        pdf_bytes = _resolve_contract_pdf(pdf_url, storage_provider)
        if not pdf_bytes:
            raise HTTPException(status_code=404, detail="Contract PDF not found")

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="contract.pdf"'}
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error serving contract PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _resolve_contract_pdf(
    file_url: str, storage_provider: str = None
) -> bytes:
    """Download contract PDF from cloud storage or read from local."""
    if not file_url:
        return None

    # Try cloud storage first
    if storage_provider and storage_provider not in ('local', ''):
        try:
            from app.domains.storage.factory import StorageFactory
            storage = StorageFactory.get_instance(storage_provider)
            return storage.download(file_url)
        except Exception as e:
            logger.warning(f"Cloud download failed for {file_url}: {e}")

    # Try local filesystem
    backend_dir = Path(__file__).resolve().parents[3]
    if file_url.startswith('/uploads/'):
        local_path = backend_dir / file_url.lstrip('/')
    else:
        local_path = Path(file_url)
    if local_path.exists():
        return local_path.read_bytes()

    # Fallback: try configured storage provider
    # (handles case where files were uploaded as 'local' but only exist
    #  on cloud storage, e.g. deployed environment without /uploads/)
    from app.core.config import settings
    configured = settings.STORAGE_PROVIDER.lower()
    if configured not in ('local', ''):
        try:
            from app.domains.storage.factory import StorageFactory
            storage = StorageFactory.get_instance(configured)
            # Try with file_url as-is (blob path)
            return storage.download(file_url)
        except Exception:
            # Try stripping /uploads/ prefix
            if file_url.startswith('/uploads/'):
                try:
                    return storage.download(file_url.lstrip('/'))
                except Exception as e:
                    logger.warning(f"Fallback download from {configured} failed: {e}")

    return None
