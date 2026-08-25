"""
Client/Claim matcher for insurance estimate emails.
Matches incoming estimates to existing clients and claims using:
1. Claim number
2. Policy number + insurance company
3. Address (normalized)
4. Client name + email/phone

Also extracts claim numbers and other identifiers from email/PDF content.
"""

import logging
import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.domains.client.address_utils import normalize_address
from app.domains.client.models import Client, Claim

logger = logging.getLogger(__name__)


@dataclass
class MatchResult:
    """Result of client/claim matching"""
    client_id: Optional[str] = None
    claim_id: Optional[str] = None
    method: Optional[str] = None  # claim_number, policy_number, address, name
    confidence: int = 0
    claim_number_extracted: Optional[str] = None
    policy_number_extracted: Optional[str] = None
    address_extracted: Optional[str] = None
    needs_new_claim: bool = False


def extract_claim_number(text: str) -> Optional[str]:
    """Extract claim number from text using common patterns"""
    patterns = [
        r"claim\s*(?:number|#|no\.?)\s*:?\s*([A-Z0-9][\w-]{4,30})",
        r"claim\s*:?\s*([A-Z0-9][\w-]{4,30})",
        r"file\s*(?:number|#|no\.?)\s*:?\s*([A-Z0-9][\w-]{4,30})",
        r"loss\s*(?:number|#|no\.?)\s*:?\s*([A-Z0-9][\w-]{4,30})",
        # Common claim number formats: XX-XXXX-XXXXX, XXXXXXXXXX
        r"\b(\d{2,3}-\d{3,6}-\d{3,8})\b",
        r"\b([A-Z]{2,3}\d{6,12})\b",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1).strip()

    return None


def extract_policy_number(text: str) -> Optional[str]:
    """Extract policy number from text"""
    patterns = [
        r"policy\s*(?:number|#|no\.?)\s*:?\s*([A-Z0-9][\w-]{4,30})",
        r"policy\s*:?\s*([A-Z0-9][\w-]{4,30})",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1).strip()

    return None


def extract_address(text: str) -> Optional[str]:
    """Extract property/insured address from text"""
    patterns = [
        r"(?:property|insured|loss|risk)\s*address\s*:?\s*(.+?)(?:\n|$)",
        r"(?:location|site)\s*:?\s*(\d+\s+\S+.*?)(?:\n|$)",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            addr = match.group(1).strip()
            if len(addr) > 10:  # Reasonable minimum for an address
                return addr

    return None


def extract_sender_email(sender: str) -> Optional[str]:
    """Extract the bare email address from an email From header, e.g.
    '"Jane Adjuster" <jane@carrier.com>' -> 'jane@carrier.com'."""
    if not sender:
        return None
    match = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", sender)
    return match.group(0).lower() if match else None


def extract_name_guess(text: str) -> Optional[str]:
    """Best-effort guess at a person's name from email/PDF body text, for
    emails with no claim/policy/address markers (e.g. a client forwarding
    their own estimate). Deliberately conservative - only matches a
    capitalized 2-3 word sequence after a clear "Insured:" label or a
    letter sign-off, to avoid mistaking arbitrary text for a name."""
    patterns = [
        r"insured[ \t]*:?[ \t]*([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,2})",
        r"(?:regards|sincerely|thank you|thanks)[,\s]*\n[ \t]*([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){0,2})",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1).strip()

    return None


def extract_insurance_company(text: str) -> Optional[str]:
    """Extract insurance company name from text"""
    patterns = [
        r"(?:insurance|carrier|company)\s*(?:name|company)?\s*:?\s*(.+?)(?:\n|$)",
        r"(?:insurer|underwriter)\s*:?\s*(.+?)(?:\n|$)",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            name = match.group(1).strip()
            if len(name) > 2:
                return name

    return None


def match_by_claim_number(
    db: Session,
    claim_number: str,
) -> Optional[MatchResult]:
    """Match by claim number - highest confidence"""
    claim = db.query(Claim).filter(
        Claim.claim_number == claim_number
    ).first()

    if claim:
        return MatchResult(
            client_id=str(claim.client_id),
            claim_id=str(claim.id),
            method="claim_number",
            confidence=100,
            claim_number_extracted=claim_number,
        )
    return None


def match_by_policy_number(
    db: Session,
    policy_number: str,
    insurance_company: Optional[str] = None,
) -> Optional[MatchResult]:
    """Match by policy number + optional insurance company"""
    query = db.query(Claim).filter(
        Claim.insurance_policy_number == policy_number
    )

    if insurance_company:
        query = query.filter(
            Claim.insurance_company.ilike(f"%{insurance_company}%")
        )

    claim = query.first()
    if claim:
        return MatchResult(
            client_id=str(claim.client_id),
            claim_id=str(claim.id),
            method="policy_number",
            confidence=95 if insurance_company else 85,
            policy_number_extracted=policy_number,
        )

    # Also check Client-level policy number
    client_query = db.query(Client).filter(
        Client.insurance_policy_number == policy_number
    )
    if insurance_company:
        client_query = client_query.filter(
            Client.insurance_company.ilike(f"%{insurance_company}%")
        )

    client = client_query.first()
    if client:
        return MatchResult(
            client_id=str(client.id),
            claim_id=None,
            method="policy_number",
            confidence=80,
            policy_number_extracted=policy_number,
            needs_new_claim=True,
        )

    return None


def match_by_address(
    db: Session,
    address: str,
) -> Optional[MatchResult]:
    """Match by normalized address"""
    normalized = normalize_address(address)
    if not normalized or len(normalized) < 10:
        return None

    # Try normalized_address column first (exact match via index)
    client = db.query(Client).filter(
        Client.normalized_address == normalized
    ).first()

    if client:
        return MatchResult(
            client_id=str(client.id),
            method="address",
            confidence=90,
            address_extracted=address,
            needs_new_claim=True,
        )

    # Fallback: ILIKE search on raw address
    client = db.query(Client).filter(
        Client.address.ilike(f"%{address[:30]}%")
    ).first()

    if client:
        return MatchResult(
            client_id=str(client.id),
            method="address",
            confidence=75,
            address_extracted=address,
            needs_new_claim=True,
        )

    return None


def match_by_name(
    db: Session,
    name: str,
    email_addr: Optional[str] = None,
    phone: Optional[str] = None,
) -> Optional[MatchResult]:
    """Match by client name and/or exact email/phone. At least one of
    name (2+ chars), email_addr, or phone must be given."""
    has_name = bool(name and len(name) >= 2)
    if not has_name and not email_addr and not phone:
        return None

    filters = []
    if has_name:
        filters.append(Client.display_name.ilike(f"%{name}%"))
    if email_addr:
        filters.append(Client.email == email_addr)
    if phone:
        filters.append(Client.phone == phone)

    client = db.query(Client).filter(
        or_(*filters)
    ).first()

    if client:
        confidence = 70
        if email_addr and client.email == email_addr:
            confidence = 85
        elif phone and client.phone == phone:
            confidence = 80

        return MatchResult(
            client_id=str(client.id),
            method="name",
            confidence=confidence,
            needs_new_claim=True,
        )

    return None


def match_email_to_client(
    db: Session,
    email_text: str,
    pdf_text: str,
    sender: Optional[str] = None,
) -> MatchResult:
    """
    Main matching function. Tries matching strategies in priority order.
    Returns MatchResult (may have empty client_id if no match found).

    `sender` is the email's From header, used as a last-resort matching
    signal (Strategy 4) for emails with no claim/policy/address markers -
    e.g. a client forwarding their own estimate directly.
    """
    combined_text = f"{email_text}\n{pdf_text}"

    # Extract identifiers
    claim_number = extract_claim_number(combined_text)
    policy_number = extract_policy_number(combined_text)
    address = extract_address(combined_text)
    insurance_company = extract_insurance_company(combined_text)

    # Strategy 1: Claim number
    if claim_number:
        result = match_by_claim_number(db, claim_number)
        if result:
            return result

    # Strategy 2: Policy number
    if policy_number:
        result = match_by_policy_number(db, policy_number, insurance_company)
        if result:
            result.claim_number_extracted = claim_number
            return result

    # Strategy 3: Address
    if address:
        result = match_by_address(db, address)
        if result:
            result.claim_number_extracted = claim_number
            result.policy_number_extracted = policy_number
            return result

    # Strategy 4: Name / sender email (lowest confidence, last resort)
    sender_email = extract_sender_email(sender) if sender else None
    name_guess = extract_name_guess(combined_text)
    if name_guess or sender_email:
        result = match_by_name(db, name_guess or "", email_addr=sender_email)
        if result:
            result.claim_number_extracted = claim_number
            result.policy_number_extracted = policy_number
            result.address_extracted = address
            return result

    # No match found
    return MatchResult(
        claim_number_extracted=claim_number,
        policy_number_extracted=policy_number,
        address_extracted=address,
    )
