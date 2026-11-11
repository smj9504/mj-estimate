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
from typing import Any, Dict, List, Optional, Tuple

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


# Words that end a street address, not part of the street's own name
_STREET_SUFFIXES = {
    "way", "pl", "place", "dr", "drive", "ct", "court", "rd", "road", "st",
    "street", "ln", "lane", "ave", "av", "avenue", "blvd", "boulevard", "ter",
    "terrace", "cir", "circle", "pkwy", "parkway", "hwy", "highway", "trl",
    "trail", "sq", "square", "loop", "pike", "cv", "cove", "xing", "crossing",
    "n", "s", "e", "w", "ne", "nw", "se", "sw",
}
_UNIT_PATTERN = re.compile(r"\s(?:apt|unit|ste|suite|#)\b.*$", re.IGNORECASE)
# One short word ("Oak", "Elm") turns up in ordinary text too often
_MIN_STREET_NAME_LEN = 5


def street_name(address: Optional[str]) -> Optional[str]:
    """The street's own name, lowercased - how mail about a property names it
    when it leaves out the house number: "larkspur" from "4821 Larkspur Way,
    Fairfax, VA 22030", "cedar hollow" from "500 Cedar Hollow Pl". None
    for an address without a house number, or a name too short to tell from
    an ordinary word."""
    first = _UNIT_PATTERN.sub("", (address or "").split(",")[0].strip())
    words = [w.strip(".").lower() for w in first.split()]
    if len(words) < 2 or not words[0].isdigit():
        return None
    words = words[1:]
    while len(words) > 1 and words[-1] in _STREET_SUFFIXES:
        words.pop()
    if words[-1] in _STREET_SUFFIXES:
        return None  # "12 Court St" - nothing left but an ordinary word
    name = " ".join(words)
    return name if len(name) >= _MIN_STREET_NAME_LEN else None


def mentions_street(lowered_text: str, address: Optional[str]) -> bool:
    """Whether lowercased text names the property: "4821 larkspur" or just
    "larkspur"."""
    words = (address or "").split(",")[0].split()
    if len(words) >= 2 and words[0].isdigit():
        house = " ".join(words[:2]).lower()
        if re.search(rf"\b{re.escape(house)}\b", lowered_text):
            return True
    name = street_name(address)
    return bool(name and re.search(rf"\b{re.escape(name)}\b", lowered_text))


class ClaimContactIndex:
    """Every claim's people by email address - its adjusters, public adjuster
    and homeowner - with the street it is at, read once per poll.

    Mail from someone on several claims often names the property by its
    street alone ("a supplement for larkspur"), with no claim number or
    labelled address for the text rules to find. The sender narrows it to
    their own claims, and the street picks one of those.
    """

    def __init__(self, claims: List[Dict[str, Any]]):
        self._by_address: Dict[str, List[Dict[str, Any]]] = {}
        for claim in claims:
            for address in claim["contacts"]:
                self._by_address.setdefault(address, []).append(claim)

    @classmethod
    def load(cls, session) -> "ClaimContactIndex":
        from app.domains.client.adjusters import additional_adjuster_emails

        rows = (
            session.query(
                Claim.id, Claim.client_id, Claim.adjuster_email,
                Claim.additional_adjusters, Claim.pa_email,
                Client.email, Client.address,
            )
            .join(Client, Client.id == Claim.client_id)
            .all()
        )
        claims = []
        for claim_id, client_id, adjuster, others, pa, homeowner, address in rows:
            raw = [adjuster, pa, homeowner] + additional_adjuster_emails(others)
            contacts = {
                a for a in (extract_sender_email(r) for r in raw if r) if a
            }
            if contacts and address:
                claims.append({
                    "claim_id": str(claim_id),
                    "client_id": str(client_id),
                    "address": address,
                    "contacts": contacts,
                })
        return cls(claims)

    def match(self, text: str, sender: Optional[str]) -> Optional[MatchResult]:
        """The one claim of the sender's whose street the text names."""
        sender_address = extract_sender_email(sender) if sender else None
        claims = self._by_address.get(sender_address or "", [])
        if not claims:
            return None
        lowered = (text or "").lower()
        named = [c for c in claims if mentions_street(lowered, c["address"])]
        clients = {c["client_id"] for c in named}
        if len(clients) != 1:
            return None
        return MatchResult(
            client_id=named[0]["client_id"],
            # A client with two claims at the address leaves the claim open
            claim_id=named[0]["claim_id"] if len(named) == 1 else None,
            method="contact_street",
            confidence=80,
        )


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
