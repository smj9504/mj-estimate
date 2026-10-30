"""
Which of a contract's signature lines are still open. The customer can finish a
contract alone from its link, leaving the company's lines for later, so each
signature records the lines it filled.
"""

import json
from typing import Any, Dict, Iterable, List, Optional

from app.domains.contract.onsite_signing import parse_mappings, signature_mappings

COMPANY_ROLE = 'company_rep'

# Mark on a todo saying what it asks of its contract, so doing one thing finishes that todo only
TASK_ASSIGN_CLAIM = 'assign_claim'
TASK_COMPANY_SIGNATURE = 'company_signature'


def signature_placement(mapping: Dict[str, Any]) -> Dict[str, Any]:
    """A signature line as the signing screens place it on the page"""
    key = mapping.get('fieldKey', '')
    field_type, _, role = key.partition('.')
    return {
        'id': mapping.get('id', ''),
        'fieldKey': key,
        'pageIndex': mapping.get('pageIndex', 0),
        'x': mapping.get('x', 0),
        'y': mapping.get('y', 0),
        'width': mapping.get('width', 0.2),
        'height': mapping.get('height', 0.06),
        'fieldType': field_type,
        'signerRole': role,
        'label': mapping.get('label', ''),
    }


def open_company_lines(raw_mappings: Any, filled_per_signature: Iterable[Optional[str]]) -> List[Dict[str, Any]]:
    """The company's lines a signed contract is still waiting on: none until the
    customer has signed. A signature from before lines were recorded may have
    filled any of them (its later lines took the last mark automatically) and its
    PDF can't be read back, so that contract counts as finished."""
    filled_lists = list(filled_per_signature)
    if not filled_lists or any(filled is None for filled in filled_lists):
        return []
    try:
        filled = {line_id for raw in filled_lists for line_id in json.loads(raw)}
        lines = [
            signature_placement(mapping)
            for mapping in signature_mappings(parse_mappings(raw_mappings))
            if mapping.get('fieldKey', '').partition('.')[2] == COMPANY_ROLE and mapping.get('id') not in filled
        ]
    except (TypeError, ValueError):
        return []
    # A date only goes with a signature; on its own there is nothing to sign
    return lines if any(line['fieldType'] != 'date_signed' for line in lines) else []
