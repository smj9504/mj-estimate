"""
The public adjuster on a claim.

pa_contact_id (a company contact) says who the PA is. The pa_* columns and
has_public_adjuster mirror it for everything that reads the claim directly:
the PA fee in the profit view and the contractor portal, supplement mail, the
follow-up contacts. So whatever links a contact fills the mirror too.

The claim edit API keeps its own copy of this rule for its request dicts
(client/api.py _sync_claim_pa_fields).
"""

from typing import Any

from sqlalchemy import select


def link_pa_contact(session: Any, claim: Any, contact_id: Any) -> None:
    """Put a PA contact on the claim and mirror it onto pa_* and has_public_adjuster.

    Replacing a different contact rewrites the mirror, which described the old
    PA. Linking where there was none, or re-linking the same contact, fills only
    empty fields, so a name or email typed by hand stays.
    """
    from app.domains.company.models import Company, CompanyContact

    contact_id = str(contact_id)
    replacing = bool(claim.pa_contact_id) and str(claim.pa_contact_id) != contact_id
    claim.pa_contact_id = contact_id
    claim.has_public_adjuster = True

    contact = session.execute(
        select(CompanyContact).where(CompanyContact.id == contact_id)
    ).scalar_one_or_none()
    if contact is None:
        return
    company = None
    if contact.company_id:
        company = session.execute(
            select(Company).where(Company.id == contact.company_id)
        ).scalar_one_or_none()

    values = {
        'pa_name': contact.name,
        'pa_email': contact.email,
        'pa_phone': contact.phone,
        'pa_company': company.name if company else None,
    }
    for field, value in values.items():
        if replacing:
            setattr(claim, field, value or None)
        elif value and not getattr(claim, field):
            setattr(claim, field, value)
