"""
Resolve the real contact behind a follow-up task's assigned role.

A task stores its assignee as a denormalized name/email/phone snapshot plus a
role string. The source of truth for those contacts lives on the Claim:

- public_adjuster -> claim.pa_contact_id (a CompanyContact), else the
  claim.pa_* freetext columns, else the WM sheet tab -> PA mapping.
- adjuster        -> claim.adjuster_* columns.

The pa_contact_id path matters most: the WM Google-Sheet sync is the only
writer of the claim's PA, and it writes *only* the contact id -- never the
pa_name/pa_email freetext. Reading the freetext alone therefore yields a blank
PA on virtually every claim, which is why callers must go through here.
"""

from typing import Any, Dict, Optional


EMPTY_CONTACT: Dict[str, str] = {
    'name': '', 'email': '', 'phone': '', 'company': '', 'contact_id': '',
}


def resolve_pa_contact(session, claim) -> Dict[str, str]:
    """
    Resolve a claim's public adjuster, in priority order:
      1. claim.pa_contact_id -> CompanyContact (set by the WM sheet mapping)
      2. claim.pa_* freetext columns
      3. WM job's google_sheet_name -> WMSheetPAMapping -> CompanyContact

    Always returns the full dict shape; values are '' when nothing resolves.
    """
    if claim is None:
        return dict(EMPTY_CONTACT)

    # Priority 2 first as the baseline, so a contact hit can override it.
    info = {
        'name': getattr(claim, 'pa_name', '') or '',
        'email': getattr(claim, 'pa_email', '') or '',
        'phone': getattr(claim, 'pa_phone', '') or '',
        'company': getattr(claim, 'pa_company', '') or '',
        'contact_id': '',
    }

    contact_id = getattr(claim, 'pa_contact_id', None)

    # Priority 3: fall back to the WM sheet tab -> PA mapping for the contact id.
    if not contact_id and not info['email']:
        try:
            from app.domains.water_mitigation.models import (
                WaterMitigationJob, WMSheetPAMapping,
            )
            wm_job = session.query(WaterMitigationJob).filter(
                WaterMitigationJob.claim_id == claim.id
            ).first()
            if wm_job and wm_job.google_sheet_name:
                mapping = session.query(WMSheetPAMapping).filter(
                    WMSheetPAMapping.sheet_name == wm_job.google_sheet_name
                ).first()
                if mapping and mapping.pa_contact_id:
                    contact_id = mapping.pa_contact_id
        except Exception:
            pass

    # Priority 1: the contact record wins over freetext, field by field.
    if contact_id:
        try:
            from app.domains.company.models import CompanyContact, Company
            contact = session.query(CompanyContact).filter(
                CompanyContact.id == contact_id
            ).first()
            if contact:
                info['name'] = contact.name or info['name']
                info['email'] = contact.email or info['email']
                info['phone'] = contact.phone or info['phone']
                info['contact_id'] = str(contact.id)
                if contact.company_id:
                    comp = session.query(Company).filter(
                        Company.id == contact.company_id
                    ).first()
                    if comp:
                        info['company'] = comp.name or info['company']
        except Exception:
            pass

    return info


def resolve_adjuster_contact(session, claim) -> Dict[str, str]:
    """
    Resolve a claim's insurance-company adjuster. Prefers the claim's own
    columns and falls back to the linked WM job, which is populated by the
    sheet sync even when the claim's copy was never filled in.
    """
    if claim is None:
        return dict(EMPTY_CONTACT)

    info = {
        'name': getattr(claim, 'adjuster_name', '') or '',
        'email': getattr(claim, 'adjuster_email', '') or '',
        'phone': getattr(claim, 'adjuster_phone', '') or '',
        'company': getattr(claim, 'insurance_company', '') or '',
        'contact_id': '',
    }

    if not info['email']:
        try:
            from app.domains.water_mitigation.models import WaterMitigationJob
            wm_job = session.query(WaterMitigationJob).filter(
                WaterMitigationJob.claim_id == claim.id
            ).first()
            if wm_job:
                info['name'] = info['name'] or (wm_job.adjuster_name or '')
                info['email'] = info['email'] or (wm_job.adjuster_email or '')
                info['phone'] = info['phone'] or (wm_job.adjuster_phone or '')
        except Exception:
            pass

    return info


def resolve_contact_for_role(session, claim, role: str) -> Dict[str, str]:
    """Resolve whichever contact the given assigned role refers to."""
    if role == 'public_adjuster':
        return resolve_pa_contact(session, claim)
    if role == 'adjuster':
        return resolve_adjuster_contact(session, claim)
    # 'contractor' and any custom role have no claim-level source of truth.
    return dict(EMPTY_CONTACT)


def assignment_fields_for_role(
    session, claim, role: str
) -> Optional[Dict[str, Any]]:
    """
    Build the assigned_to_* update payload for a role, or None when the role
    has no resolvable contact (so callers leave the existing values alone
    rather than blanking them).
    """
    info = resolve_contact_for_role(session, claim, role)
    if not info.get('email') and not info.get('name'):
        return None
    return {
        'assigned_to_role': role,
        'assigned_to_name': info['name'],
        'assigned_to_email': info['email'],
        'assigned_to_phone': info['phone'],
    }
