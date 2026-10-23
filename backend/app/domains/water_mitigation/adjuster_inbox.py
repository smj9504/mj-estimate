"""
Adjuster mail on water mitigation jobs.

Before a follow-up goes out, the adjuster may already have answered -
"still under review", "please resend the W-9". The email ingestion poll
keeps claim-related inbound mail in received_emails; this works out which
WM job a message is about (JobMailIndex), and searches the inboxes for one
job on demand so the follow-up screen doesn't wait for the next poll.
"""

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from app.core.database_factory import get_database
from app.domains.email_ingestion.matcher import extract_sender_email

logger = logging.getLogger(__name__)

# Mail with no claim number is filed by its sender only while the job is
# still waiting on the carrier; an adjuster handles many claims over time.
_CLOSED_STATUSES = {"Lead", "Complete"}

# Shorter claim numbers turn up inside phone numbers, zip codes and dates.
_MIN_CLAIM_NUMBER_LEN = 5

_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]")

# The on-demand search looks back from when the job was entered, so mail
# from before the documents went out (inspection scheduling) still counts.
_SEARCH_LOOKBACK = timedelta(days=30)
_SEARCH_MAX_AGE = timedelta(days=365)
_SEARCH_LIMIT = 50


def normalize_claim_number(value: Optional[str]) -> str:
    """Letters and digits only, lowercased: "01-234-5678" == "012345678"."""
    return re.sub(r"[^0-9a-z]", "", (value or "").lower())


def job_adjuster_addresses(job, claim_adjuster_email: Optional[str] = None) -> Set[str]:
    """Every carrier-side address on the job, lowercased: the adjuster, the
    extra contacts in adjuster_emails, and the linked claim's adjuster."""
    raw = [job.adjuster_email, claim_adjuster_email]
    for entry in job.adjuster_emails or []:
        if isinstance(entry, dict):
            raw.append(entry.get("email"))
    return {addr for addr in (extract_sender_email(r) for r in raw if r) if addr}


def _text_tokens(text: str) -> Set[str]:
    """Normalized words that could be a claim number. Dashed runs count
    whole and in parts, so "0123456-Smith" still finds 0123456."""
    tokens = set()
    for token in _TOKEN_PATTERN.findall(text):
        tokens.add(normalize_claim_number(token))
        if "-" in token:
            tokens.update(normalize_claim_number(p) for p in token.split("-"))
    return {t for t in tokens if len(t) >= _MIN_CLAIM_NUMBER_LEN}


def _mentions_job(job: Dict[str, Any], lowered_text: str) -> bool:
    """Whether the message names the homeowner's last name or the street
    address - how adjusters refer to a claim when they leave out its number."""
    name_parts = (job["homeowner_name"] or "").lower().split()
    if name_parts and len(name_parts[-1]) >= 3:
        if re.search(rf"\b{re.escape(name_parts[-1])}\b", lowered_text):
            return True
    street = (job["street"] or "").lower().split(",")[0].split()
    # House number plus the first word of the street name: "123 main"
    if len(street) >= 2 and street[0].isdigit():
        if re.search(rf"\b{re.escape(' '.join(street[:2]))}\b", lowered_text):
            return True
    return False


# What an adjuster's reply says about the documents, for picking the
# follow-up template. A review in progress implies they arrived, so it is
# checked first; "haven't received" is checked before "received".
_REPLY_SIGNALS = [
    ("review_update", re.compile(
        r"\b(?:under review|being reviewed|in review|pending review|reviewing"
        r"|review is in progress|will (?:be )?review(?:ing)?)\b",
        re.IGNORECASE,
    )),
    ("receipt", re.compile(
        r"(?:\bnot|n't|\bnever)\s+(?:yet\s+)?(?:been\s+)?(?:received|receive|got|gotten|seen)\b",
        re.IGNORECASE,
    )),
    ("review_status", re.compile(
        r"\b(?:received|receipt of|got it|got the|thanks? (?:you )?for (?:sending|the))\b",
        re.IGNORECASE,
    )),
]

# Follow-up templates by how far along they assume the claim is
_TEMPLATE_ORDER = ["receipt", "review_status", "review_update"]


def classify_reply(text: str) -> Optional[Tuple[str, str]]:
    """(template, sentence) for what a reply says about the documents, or
    None when it says nothing about them. `text` should have the quoted
    original stripped - our own follow-up asks whether they "received" it.
    """
    for template, pattern in _REPLY_SIGNALS:
        match = pattern.search(text or "")
        if match:
            # The sentence it's in, to show why the template was picked
            start = max(text.rfind(c, 0, match.start()) for c in ".!?\n") + 1
            ends = [i for i in (text.find(c, match.end()) for c in ".!?\n") if i != -1]
            sentence = text[start:min(ends) + 1 if ends else len(text)].strip()
            return template, sentence[:200]
    return None


def further_template(a: str, b: Optional[str]) -> str:
    """Whichever of two follow-up templates assumes the claim is further along."""
    if b not in _TEMPLATE_ORDER:
        return a
    return max(a, b, key=_TEMPLATE_ORDER.index)


class JobMailIndex:
    """Every active WM job's claim, claim number and adjuster addresses,
    read once per poll so matching a message is a set of dict lookups."""

    def __init__(self, jobs: List[Dict[str, Any]]):
        self._jobs = {job["id"]: job for job in jobs}
        self._by_claim_id: Dict[str, List[Dict[str, Any]]] = {}
        self._by_claim_number: Dict[str, List[Dict[str, Any]]] = {}
        self._by_address: Dict[str, List[Dict[str, Any]]] = {}
        # Newest first, so ties go to the most recent job
        for job in jobs:
            if job["claim_id"]:
                self._by_claim_id.setdefault(job["claim_id"], []).append(job)
            claim_number = normalize_claim_number(job["claim_number"])
            if len(claim_number) >= _MIN_CLAIM_NUMBER_LEN:
                self._by_claim_number.setdefault(claim_number, []).append(job)
            if job["open"]:
                for address in job["addresses"]:
                    self._by_address.setdefault(address, []).append(job)

    @classmethod
    def load(cls, session) -> "JobMailIndex":
        from app.domains.client.models import Claim
        from .models import WaterMitigationJob

        rows = (
            session.query(WaterMitigationJob, Claim.adjuster_email, Claim.client_id)
            .outerjoin(Claim, Claim.id == WaterMitigationJob.claim_id)
            .filter(WaterMitigationJob.active == True)  # noqa: E712
            .order_by(WaterMitigationJob.created_at.desc())
            .all()
        )
        return cls([
            {
                "id": str(job.id),
                "claim_id": str(job.claim_id) if job.claim_id else None,
                "client_id": str(client_id) if client_id else None,
                "claim_number": job.claim_number,
                "open": job.status not in _CLOSED_STATUSES,
                "addresses": job_adjuster_addresses(job, claim_adjuster_email),
                "homeowner_name": job.homeowner_name,
                "street": job.property_street or job.property_address,
            }
            for job, claim_adjuster_email, client_id in rows
        ])

    def claim_of(self, job_id: str) -> Tuple[Optional[str], Optional[str]]:
        """(claim_id, client_id) of a job in the index."""
        job = self._jobs.get(job_id)
        return (job["claim_id"], job["client_id"]) if job else (None, None)

    def match(
        self,
        subject: Optional[str],
        text: str,
        sender: Optional[str],
        claim_id: Optional[str] = None,
        own_address: Optional[str] = None,
    ) -> Tuple[Optional[str], Optional[str], Optional[int]]:
        """(job_id, method, confidence) for one inbound message, or Nones.

        In order: the job on the claim the message already matched, a job
        whose claim number appears in it, then a job waiting on the sender
        when the sender is an adjuster on it.
        """
        sender_address = extract_sender_email(sender) if sender else None
        # A copy of our own outgoing mail is not a reply
        if sender_address and own_address and sender_address == own_address.lower():
            return None, None, None

        if claim_id and str(claim_id) in self._by_claim_id:
            return self._by_claim_id[str(claim_id)][0]["id"], "claim", 95

        full_text = f"{subject or ''}\n{text or ''}"
        hits: Dict[str, Dict[str, Any]] = {}
        for token in _text_tokens(full_text):
            for job in self._by_claim_number.get(token, []):
                hits.setdefault(job["id"], job)
        if hits:
            jobs = list(hits.values())
            best = next((j for j in jobs if j["open"]), jobs[0])
            return best["id"], "claim_number", 100 if len(jobs) == 1 else 90

        if sender_address:
            jobs = self._by_address.get(sender_address, [])
            if len(jobs) == 1:
                return jobs[0]["id"], "adjuster_email", 80
            if len(jobs) > 1:
                lowered = full_text.lower()
                named = [j for j in jobs if _mentions_job(j, lowered)]
                if len(named) == 1:
                    return named[0]["id"], "adjuster_email", 75
        return None, None, None


def _job_mail_filter(job):
    """received_emails rows about the job: matched to it, or to its claim -
    the claim matcher filed mail before WM matching existed, and still files
    replies to emails the follow-up screen sent."""
    from sqlalchemy import or_

    from app.domains.email_ingestion.models import ReceivedEmail

    condition = ReceivedEmail.matched_wm_job_id == job.id
    if job.claim_id:
        condition = or_(condition, ReceivedEmail.matched_claim_id == job.claim_id)
    return condition


def suggest_followup_template(session, job) -> Optional[Dict[str, Any]]:
    """The follow-up template the adjuster's own latest word calls for.

    Reads the adjuster's mail since the documents went out, newest first,
    and takes the first that says where the documents stand. None when the
    adjuster hasn't said.
    """
    from app.domains.claim_followup.reply_tracker import _extract_reply_body
    from app.domains.client.models import Claim
    from app.domains.email_ingestion.models import ReceivedEmail
    from app.domains.email_ingestion.service import _html_to_text

    claim_adjuster_email = None
    if job.claim_id:
        claim_adjuster_email = session.query(Claim.adjuster_email).filter(
            Claim.id == job.claim_id
        ).scalar()
    addresses = job_adjuster_addresses(job, claim_adjuster_email)
    if not addresses:
        return None

    query = session.query(ReceivedEmail).filter(_job_mail_filter(job))
    if job.documents_sent_date:
        query = query.filter(ReceivedEmail.received_at >= job.documents_sent_date)
    rows = query.order_by(ReceivedEmail.received_at.desc().nullslast()).limit(20).all()

    for row in rows:
        if extract_sender_email(row.sender or "") not in addresses:
            continue
        text = row.body_text or _html_to_text(row.body_html)
        found = classify_reply(_extract_reply_body(text or row.snippet or ""))
        if found:
            template, sentence = found
            return {
                "template": template,
                "email_id": str(row.id),
                "sender": row.sender,
                "received_at": row.received_at,
                "sentence": sentence,
            }
    return None


def _imap_quote(value: str) -> Optional[str]:
    """An IMAP search string, or None if it can't be sent as plain ASCII."""
    cleaned = re.sub(r'["\\]', "", value or "").strip()
    if not cleaned or not cleaned.isascii():
        return None
    return f'"{cleaned}"'


def _is_send_only(account: Dict[str, Any]) -> bool:
    # Send-only accounts (Resend etc.) have no inbox; see EmailAccount.smtp_server
    return account.get("provider_type") == "custom" and bool(account.get("smtp_server"))


class AdjusterInboxService:
    """Inbound mail about one WM job: list it, or search the inboxes now."""

    def __init__(self, database=None):
        self.database = database or get_database()

    def _load_job(self, session, job_id: str):
        from app.domains.client.models import Claim
        from .models import WaterMitigationJob

        row = (
            session.query(WaterMitigationJob, Claim.adjuster_email)
            .outerjoin(Claim, Claim.id == WaterMitigationJob.claim_id)
            .filter(WaterMitigationJob.id == job_id)
            .first()
        )
        if not row:
            raise ValueError("Job not found")
        job, claim_adjuster_email = row
        return job, job_adjuster_addresses(job, claim_adjuster_email)

    def list_job_emails(self, job_id: str, limit: int = 100) -> Dict[str, Any]:
        """Stored inbound mail for the job (see _job_mail_filter), newest
        first, bodies left out."""
        from app.domains.email_ingestion.models import EmailAccount, ReceivedEmail
        from app.domains.email_ingestion.service import _received_email_dict

        session = self.database.get_readonly_session()
        try:
            job, addresses = self._load_job(session, job_id)
            rows = (
                session.query(ReceivedEmail, EmailAccount.email_address)
                .join(EmailAccount, EmailAccount.id == ReceivedEmail.email_account_id)
                .filter(_job_mail_filter(job))
                .order_by(ReceivedEmail.received_at.desc().nullslast())
                .limit(limit)
                .all()
            )
            items = []
            for row, account_email in rows:
                item = _received_email_dict(row, include_body=False)
                item["account_email"] = account_email
                item["from_adjuster"] = extract_sender_email(row.sender or "") in addresses
                items.append(item)
            return {"items": items, "adjuster_addresses": sorted(addresses)}
        finally:
            session.close()

    def check_job_inbox(self, job_id: str) -> Dict[str, Any]:
        """Search every connected inbox for mail from the job's adjusters or
        quoting its claim number, and store what matches.

        The ingestion poll runs once a day; a follow-up decided on
        yesterday's view of the inbox can go out after the adjuster replied.
        """
        from app.domains.email_ingestion.service import EmailIngestionService

        session = self.database.get_readonly_session()
        try:
            job, addresses = self._load_job(session, job_id)
            claim_number = job.claim_number
            created_at = job.created_at
        finally:
            session.close()

        criteria = [f"FROM {q}" for q in map(_imap_quote, sorted(addresses)) if q]
        if len(normalize_claim_number(claim_number)) >= _MIN_CLAIM_NUMBER_LEN:
            quoted = _imap_quote(claim_number)
            if quoted:
                criteria.append(f"TEXT {quoted}")

        now = datetime.now(timezone.utc)
        result: Dict[str, Any] = {
            "checked_at": now,
            "accounts_checked": 0,
            "saved": 0,
            "errors": [],
            "skipped_reason": None,
        }
        if not criteria:
            result["skipped_reason"] = "The job has no adjuster email or claim number to search for."
            return result

        since = now - _SEARCH_MAX_AGE
        if created_at:
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
            since = max(since, created_at - _SEARCH_LOOKBACK)

        ingestion = EmailIngestionService(self.database)
        accounts = [a for a in ingestion.get_accounts() if not _is_send_only(a)]
        if not accounts:
            result["skipped_reason"] = "No email inbox is connected."
            return result

        for account in accounts:
            try:
                result["saved"] += ingestion.search_account(
                    account, criteria, since_date=since, limit=_SEARCH_LIMIT
                )
                result["accounts_checked"] += 1
            except Exception as e:
                logger.warning(
                    f"Adjuster inbox check failed for {account['email_address']}: {e}"
                )
                result["errors"].append({
                    "account": account["email_address"],
                    "error": str(e),
                })
        return result
