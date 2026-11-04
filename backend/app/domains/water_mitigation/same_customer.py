"""
Lead jobs that look like the same customer.

Before a job is entered by hand, or a new sheet row becomes a job, whoever is deciding
sees the Lead jobs already there for that customer: the same phone or email, or the same
address however it's written. A Lead is a job nobody has worked yet, so two of them for
one customer are almost always the same lead entered twice, sometimes with the house
number typed differently. That's why a phone or email is enough on its own. Two claim
numbers that differ are two incidents, so those never count as the same.

This only finds them. Linking is the caller's, after someone has said so.
"""

from typing import Any, List, Optional, Tuple

from app.domains.integrations.google_sheets.row_moves import near_address
from app.domains.water_mitigation.models import WaterMitigationJob

LEAD_STATUS = 'Lead'


def phone_digits(value: Any) -> str:
    """The last ten digits, so a leading 1 or the punctuation doesn't matter"""
    return ''.join(c for c in str(value or '') if c.isdigit())[-10:]


def _text(value: Any) -> str:
    return str(value or '').strip().lower()


def why_same(
    job: WaterMitigationJob,
    address: Optional[str] = None,
    phone: Optional[str] = None,
    email: Optional[str] = None,
    claim_number: Optional[str] = None,
) -> List[str]:
    """What this job has in common with the customer: 'phone', 'email', 'address'.
    Nothing when the claim numbers say they are two incidents."""
    ours_claim, theirs_claim = _text(claim_number), _text(job.claim_number)
    if ours_claim and theirs_claim and ours_claim != theirs_claim:
        return []
    reasons = []
    ours = phone_digits(phone)
    if len(ours) >= 7 and ours == phone_digits(job.homeowner_phone):
        reasons.append('phone')
    if _text(email) and _text(email) == _text(job.homeowner_email):
        reasons.append('email')
    # Strict on unit numbers: Apt 1 and Apt 2 are two customers
    if address and str(address).strip() and job.property_address and near_address(job.property_address, address):
        reasons.append('address')
    return reasons


def same_customer_leads(
    db: Any,
    address: Optional[str] = None,
    phone: Optional[str] = None,
    email: Optional[str] = None,
    claim_number: Optional[str] = None,
) -> List[Tuple[WaterMitigationJob, List[str]]]:
    """Active Lead jobs for this customer, oldest first, each with what they share"""
    jobs = db.query(WaterMitigationJob).filter(
        WaterMitigationJob.active.is_(True),
        WaterMitigationJob.status == LEAD_STATUS,
    ).order_by(WaterMitigationJob.created_at).all()
    found = []
    for job in jobs:
        reasons = why_same(job, address, phone, email, claim_number)
        if reasons:
            found.append((job, reasons))
    return found


def full_address(street: Optional[str], city: Optional[str], state: Optional[str], zipcode: Optional[str]) -> str:
    """The address as one line, the way property_address holds it"""
    place = ' '.join(part.strip() for part in (state, zipcode) if part and part.strip())
    return ', '.join(part.strip() for part in (street, city, place) if part and part.strip())
