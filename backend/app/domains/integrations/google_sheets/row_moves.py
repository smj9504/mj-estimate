"""
Which job each row of a sheet tab is.

A row's number only says where the row is today: inserting, deleting or sorting rows
moves everything below, and a job tied to its number would take on the next property's
values. So before a sync writes anything, the tab's rows and jobs are paired by what
they say, and each job's row number follows its row. A job whose row is gone keeps
everything on it and comes off the sheet (row number NULL, tab name kept) until a row
with its address comes back.
"""

from dataclasses import dataclass, field
import re
from typing import Any, Callable, Dict, List, Optional

from app.domains.integrations.google_sheets.utils import addresses_match

# Below this, a few rows changing at once is ordinary editing
_MANY_ROWS = 5


@dataclass(frozen=True)
class _Facts:
    address: str
    words: str
    claim: str
    name: str
    phone: str
    email: str


@dataclass
class RowPlan:
    moves: Dict[Any, int] = field(default_factory=dict)  # job id -> row, for those on another row now
    off_sheet: List[Any] = field(default_factory=list)  # job ids that were on a row and have none now
    new_rows: List[int] = field(default_factory=list)  # rows no job is on


def _text(value: Any) -> str:
    return str(value or '').strip().lower()


def _words(address: Any) -> str:
    return ' '.join(re.sub(r'[^\w\s]', ' ', _text(address)).split())


def _facts(address: Any, claim: Any, name: Any, phone: Any, email: Any) -> _Facts:
    return _Facts(
        address=str(address or ''),
        words=_words(address),
        claim=_text(claim),
        name=_text(name),
        phone=re.sub(r'\D', '', str(phone or '')),
        email=_text(email),
    )


def _of_job(job: Any) -> _Facts:
    return _facts(
        job.property_address, job.claim_number, job.homeowner_name, job.homeowner_phone, job.homeowner_email,
    )


def _of_row(row: Dict[str, Any]) -> _Facts:
    return _facts(
        row.get('property_address'), row.get('claim_number'), row.get('homeowner_name'),
        row.get('homeowner_phone'), row.get('homeowner_email'),
    )


def same_words(one: Any, other: Any) -> bool:
    """The same address, written with the same words"""
    return _words(one) == _words(other)


def _near(job: _Facts, row: _Facts) -> bool:
    """The same address, however it's written. A number one has and the other lacks is
    fine (a zip left off), but two different ones are apartments 1 and 2."""
    if not addresses_match(job.address, row.address):
        return False
    ours = {word for word in job.words.split() if any(c.isdigit() for c in word)}
    theirs = {word for word in row.words.split() if any(c.isdigit() for c in word)}
    return ours <= theirs or theirs <= ours


def _same_claim(job: _Facts, row: _Facts) -> bool:
    return bool(job.claim) and job.claim == row.claim


def _disagree(job: _Facts, row: _Facts) -> bool:
    """Two incidents at one address: the claim numbers say so, or the names if there are none"""
    if job.claim and row.claim:
        return job.claim != row.claim
    return bool(job.name and row.name and job.name != row.name)


def _same_person(job: _Facts, row: _Facts) -> bool:
    return (
        _same_claim(job, row)
        or (len(job.phone) >= 7 and job.phone == row.phone)
        or (bool(job.email) and job.email == row.email)
        or (bool(job.name) and job.name == row.name)
    )


def row_is_job(job: Any, row: Dict[str, Any]) -> bool:
    """Whether the row on a job's own row number can still be that job: its address, or
    an address someone corrected where it stands, since the rest of it is the same person."""
    ours, theirs = _of_job(job), _of_row(row)
    return _near(ours, theirs) or _same_person(ours, theirs)


def plan_rows(jobs: List[Any], rows: Dict[int, Dict[str, Any]]) -> RowPlan:
    """
    Pair a tab's jobs (on a row or off the sheet) with its rows (number -> parsed row,
    those with an address). The surest pairs go first, so a less sure test only ever
    sees what's left: a job still on its row is settled before anything can claim it.
    """
    open_jobs = {job.id: job for job in jobs}
    job_facts = {job.id: _of_job(job) for job in jobs}
    open_rows = {number: _of_row(row) for number, row in sorted(rows.items())}
    on_row = {job.google_sheet_row_number: job.id for job in jobs if job.google_sheet_row_number is not None}
    plan = RowPlan()

    def distance(job_id: Any, number: int) -> int:
        current: Optional[int] = open_jobs[job_id].google_sheet_row_number
        return abs(current - number) if current is not None else len(rows) + number

    def pair(fits: Callable[[_Facts, _Facts], bool], on_its_row: bool = False) -> None:
        for number, row in list(open_rows.items()):
            if on_its_row:
                candidates = [on_row[number]] if on_row.get(number) in open_jobs else []
            else:
                candidates = list(open_jobs)
            found = [job_id for job_id in candidates if fits(job_facts[job_id], row)]
            if not found:
                continue
            job_id = min(found, key=lambda candidate: (distance(candidate, number), str(candidate)))
            if open_jobs[job_id].google_sheet_row_number != number:
                plan.moves[job_id] = number
            del open_jobs[job_id]
            del open_rows[number]

    def same(job: _Facts, row: _Facts) -> bool:
        return job.words == row.words

    pair(lambda job, row: same(job, row) and not _disagree(job, row), on_its_row=True)
    pair(lambda job, row: same(job, row) and _same_claim(job, row))
    pair(lambda job, row: same(job, row) and not _disagree(job, row))
    pair(lambda job, row: _near(job, row) and not _disagree(job, row), on_its_row=True)
    pair(lambda job, row: _near(job, row) and _same_claim(job, row))
    pair(lambda job, row: _near(job, row) and not _disagree(job, row))
    # Edited where it stands: a corrected claim number or name, or a corrected address
    pair(lambda job, row: _near(job, row) or _same_person(job, row), on_its_row=True)

    plan.off_sheet = [job_id for job_id, job in open_jobs.items() if job.google_sheet_row_number is not None]
    plan.new_rows = list(open_rows)
    return plan


def rows_look_replaced(off_sheet: int, jobs_on_rows: int, unknown_rows: int, row_count: int) -> bool:
    """
    Most of a tab's jobs gone and most of its rows unknown, both at once, isn't rows
    moving: a column moved or the tab was replaced, and carrying on would take every
    job off the sheet and make a job from every row.

    unknown_rows counts rows no job is on, and rows with something in them but no address.
    """
    return (
        off_sheet > _MANY_ROWS
        and unknown_rows > _MANY_ROWS
        and off_sheet * 2 > jobs_on_rows
        and unknown_rows * 2 > row_count
    )
