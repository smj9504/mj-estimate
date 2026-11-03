"""
Adjusters past the first on a claim or water mitigation job.

A carrier sometimes hands a claim to a third-party adjusting firm, so a claim
can have up to three adjusters: the first in the adjuster_* columns, the
others in additional_adjusters as [{company, name, phone, email}].
"""

from typing import Any, Dict, Iterable, List, Optional

MAX_ADDITIONAL_ADJUSTERS = 2

ADJUSTER_FIELDS = ('company', 'name', 'phone', 'email')


def clean_additional_adjusters(value: Optional[Iterable[Any]]) -> Optional[List[Dict[str, str]]]:
    """Trimmed entries with blank ones dropped; None stays None (not sent).
    More than MAX_ADDITIONAL_ADJUSTERS filled-in entries is an error."""
    if value is None:
        return None
    cleaned = []
    for entry in value:
        if not isinstance(entry, dict):
            continue
        row = {f: str(entry.get(f) or '').strip() for f in ADJUSTER_FIELDS}
        if any(row.values()):
            cleaned.append(row)
    if len(cleaned) > MAX_ADDITIONAL_ADJUSTERS:
        raise ValueError(
            f'At most {MAX_ADDITIONAL_ADJUSTERS} additional adjusters '
            f'({MAX_ADDITIONAL_ADJUSTERS + 1} in all)'
        )
    return cleaned


def additional_adjuster_emails(value: Optional[Iterable[Any]]) -> List[str]:
    """The email addresses in a stored additional_adjusters list."""
    return [
        entry['email'].strip()
        for entry in value or []
        if isinstance(entry, dict) and (entry.get('email') or '').strip()
    ]
