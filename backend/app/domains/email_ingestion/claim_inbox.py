"""
Searching the inboxes for one claim's mail now.

The ingestion poll stores claim mail in received_emails once a morning, so a
reply that comes in later shows on the claim only the next day. This looks
for the claim's mail on demand: replies to what we sent about it, and
anything naming its claim number, its street address or its street. Each message found
is filed by the same matching as the poll, so mail about another claim goes
to that claim, not this one.

Mail from the claim's adjuster or PA isn't searched by sender: they write
about many claims, and the newest of those would crowd this claim's mail out
of the search limit. Gmail can't search the References header, so a reply to
a reply is found by its subject or text naming the address.
"""

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from app.core.database_factory import get_database
from app.domains.email_ingestion.matcher import street_name
from app.domains.water_mitigation.adjuster_inbox import (
    _MIN_CLAIM_NUMBER_LEN,
    _imap_quote,
    normalize_claim_number,
    search_since,
)

# Replies are looked for to this many of the claim's latest sent emails
_MAX_THREADS = 20
_SEARCH_LIMIT = 50


def street_search_term(address: Optional[str]) -> Optional[str]:
    """House number and street name, as mail about the property names it:
    "6315 Cardinal" from "6315 Cardinal Hill Pl, Springfield VA 22152".
    None for an address that doesn't start with a house number."""
    words = (address or "").split(",")[0].split()
    if len(words) >= 2 and words[0].isdigit():
        return " ".join(words[:2])
    return None


def claim_search_terms(
    claim_number: Optional[str],
    address: Optional[str],
    sent_message_ids: Iterable[str],
) -> List[str]:
    """IMAP search keys (one search each) for the claim's mail."""
    terms = [
        f"HEADER In-Reply-To {quoted}"
        for quoted in map(_imap_quote, sent_message_ids) if quoted
    ]
    if len(normalize_claim_number(claim_number)) >= _MIN_CLAIM_NUMBER_LEN:
        quoted = _imap_quote(claim_number)
        if quoted:
            terms.append(f"TEXT {quoted}")
    quoted = _imap_quote(street_search_term(address) or "")
    if quoted:
        terms.append(f"TEXT {quoted}")
    # The street alone, as people on the claim write it: "a supplement for
    # larkspur". Mail from anyone else naming it is fetched but not filed.
    quoted = _imap_quote(street_name(address) or "")
    if quoted:
        terms.append(f"TEXT {quoted}")
    return terms


class ClaimInboxService:
    """Search the connected inboxes for one claim's mail."""

    def __init__(self, database=None):
        self.database = database or get_database()

    def check_claim_inbox(self, claim_id: str) -> Dict[str, Any]:
        """Search every connected inbox for the claim's mail and store what
        matches a claim. Raises ValueError for an unknown claim."""
        from app.domains.claim_followup.models import SentEmail
        from app.domains.client.models import Claim, Client
        from app.domains.email_ingestion.service import EmailIngestionService

        session = self.database.get_readonly_session()
        try:
            row = (
                session.query(Claim.claim_number, Claim.created_at, Client.address)
                .join(Client, Client.id == Claim.client_id)
                .filter(Claim.id == claim_id)
                .first()
            )
            if not row:
                raise ValueError("Claim not found")
            claim_number, created_at, address = row
            sent_ids = [
                message_id for (message_id,) in (
                    session.query(SentEmail.smtp_message_id)
                    .filter(
                        SentEmail.claim_id == claim_id,
                        SentEmail.smtp_message_id.isnot(None),
                    )
                    .order_by(SentEmail.created_at.desc())
                    .limit(_MAX_THREADS)
                )
            ]
        finally:
            session.close()

        criteria = claim_search_terms(claim_number, address, sent_ids)
        if not criteria:
            # Nothing to search for is as checked as it gets
            checked_at = datetime.now(timezone.utc)
            return {
                "checked_at": checked_at,
                "accounts_checked": 0,
                "saved": 0,
                "new_on_claim": 0,
                "errors": [],
                "skipped_reason": (
                    "The claim has no claim number, street address or sent email to search for."
                ),
                "inbox_checked_at": self._record_check(claim_id, checked_at),
            }
        before = self._count_on_claim(claim_id)
        result = EmailIngestionService(self.database).search_inboxes(
            criteria, since_date=search_since(created_at), limit=_SEARCH_LIMIT
        )
        # `saved` also counts mail the search turned up about other claims
        result["new_on_claim"] = max(self._count_on_claim(claim_id) - before, 0)
        # Only a search that reached an inbox counts: with none connected or
        # every one failing, the client page keeps asking for a check
        result["inbox_checked_at"] = (
            self._record_check(claim_id, result["checked_at"])
            if result.get("accounts_checked") else None
        )
        return result

    def _record_check(self, claim_id: str, checked_at: datetime) -> datetime:
        """Store the check on the claim without counting it as an edit"""
        from sqlalchemy import update

        from app.domains.client.models import Claim

        session = self.database.get_session()
        try:
            session.execute(
                update(Claim)
                .where(Claim.id == claim_id)
                .values(inbox_checked_at=checked_at, updated_at=Claim.updated_at)
            )
            session.commit()
        finally:
            session.close()
        return checked_at

    def _count_on_claim(self, claim_id: str) -> int:
        """Messages filed on the claim, a copy in each of two inboxes once"""
        from sqlalchemy import distinct, func

        from app.domains.email_ingestion.models import ReceivedEmail

        session = self.database.get_readonly_session()
        try:
            return session.query(func.count(distinct(ReceivedEmail.message_id))).filter(
                ReceivedEmail.matched_claim_id == claim_id
            ).scalar() or 0
        finally:
            session.close()
