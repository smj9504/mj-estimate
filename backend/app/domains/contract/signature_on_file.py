"""
Signing a client's lines with the signature they have on file
(client/client_signatures.py). It goes on the homeowner's lines only: their
signature lines take the signature, their initials lines the initials, their
date lines the day. Anyone else's lines (the company's, a witness's) are left
for them, so a contract waiting on the company still asks for it.

The office does this with the customer not there, at the user's choice, so each
use says so on the contract's audit log, with who applied it.
"""

from typing import Any, Dict, Iterable, List

from app.domains.contract.onsite_signing import signature_mappings

CUSTOMER_ROLE = 'homeowner'

# Sent in place of an image for a line the signature on file is to fill
ON_FILE = 'on_file'

# The kind of mark kept on file that each kind of line takes
_KIND_OF_LINE = {'signature': 'signature', 'initial': 'initial'}
_MISSING = {
    'signature': "This client has no signature on file",
    'initial': "This contract has initials lines, and this client has no initials on file",
}


def _line_type(mapping: Dict[str, Any]) -> str:
    return mapping.get('fieldKey', '').partition('.')[0]


def _role(mapping: Dict[str, Any]) -> str:
    return mapping.get('fieldKey', '').partition('.')[2]


def customer_lines(mappings: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The homeowner's signature, initials and date lines"""
    return [m for m in signature_mappings(mappings) if _role(m) == CUSTOMER_ROLE]


def kind_for(mapping: Dict[str, Any]) -> str:
    """The kind on file a line takes ('' for a date line, or one the file can't fill)"""
    if _role(mapping) != CUSTOMER_ROLE:
        return ''
    return _KIND_OF_LINE.get(_line_type(mapping), '')


def kinds_needed(mappings: Iterable[Dict[str, Any]]) -> List[str]:
    """The kinds on file signing these lines would take, signature first"""
    needed = {kind_for(m) for m in customer_lines(mappings)} - {''}
    return [kind for kind in ('signature', 'initial') if kind in needed]


def fields_from_file(mappings: Iterable[Dict[str, Any]], images: Dict[str, str], today: str) -> Dict[str, str]:
    """Every homeowner line filled from the file: line id -> image, or the day for
    a date line. ValueError says what's missing, so nothing is half signed."""
    lines = customer_lines(mappings)
    if not any(_line_type(m) == 'signature' for m in lines):
        raise ValueError("This contract has no line for the client's signature")
    fields: Dict[str, str] = {}
    for line in lines:
        if _line_type(line) == 'date_signed':
            fields[line.get('id', '')] = today
            continue
        kind = kind_for(line)
        if not images.get(kind):
            raise ValueError(_MISSING[kind])
        fields[line.get('id', '')] = images[kind]
    return fields
