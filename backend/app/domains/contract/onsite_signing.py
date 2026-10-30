"""
What an on-site signing asks for, worked out from a template's field mappings.

Templates map the same fact under different keys (client.display_name and
wm_job.homeowner_name are one person), so each fact is asked once and its answer
fills every key. Dates and the company's own details fill themselves, unless the
company's record is missing the value; then it is asked for like anything else.
"""

import json
from typing import Any, Dict, Iterable, List, Optional

# Keep in sync with SIGNING_PURPOSES in frontend/src/types/contract.ts
SIGNING_PURPOSES = ('water_mitigation', 'work_completion')

SIGNATURE_TYPES = ('signature', 'initial', 'date_signed')

# Each group is one fact; the first key is the one the question goes by
SAME_ANSWER = (
    ('client.display_name', 'wm_job.homeowner_name'),
    ('client.full_address', 'wm_job.property_address', 'wm_job.property_full_address'),
    ('client.address', 'wm_job.property_street'),
    ('client.city', 'wm_job.property_city'),
    ('client.state', 'wm_job.property_state'),
    ('client.zipcode', 'wm_job.property_zipcode'),
    ('client.phone', 'wm_job.homeowner_phone'),
    ('client.email', 'wm_job.homeowner_email'),
    ('claim.claim_number', 'wm_job.claim_number'),
    ('claim.insurance_company', 'wm_job.insurance_company'),
    ('claim.insurance_policy_number', 'wm_job.insurance_policy_number'),
    ('claim.date_of_loss', 'wm_job.date_of_loss'),
    ('claim.adjuster_name', 'wm_job.adjuster_name'),
    ('claim.adjuster_phone', 'wm_job.adjuster_phone'),
    ('claim.adjuster_email', 'wm_job.adjuster_email'),
)
_GROUP_OF = {key: group for group in SAME_ANSWER for key in group}

# Filled in when the contract is made, never asked for
AUTOMATIC_KEYS = ('meta.current_date', 'meta.contract_number', 'wm_job.today')

# Questions run the way a conversation does: who, then the claim, then the job
_CATEGORY_ORDER = {'client': 0, 'claim': 1, 'wm_job': 2, 'company': 3}


def parse_mappings(raw: Any) -> List[Dict[str, Any]]:
    mappings = json.loads(raw) if isinstance(raw, str) and raw else raw
    return mappings if isinstance(mappings, list) else []


def is_signature_key(key: str) -> bool:
    return key.split('.', 1)[0] in SIGNATURE_TYPES


def signature_mappings(mappings: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [m for m in mappings if is_signature_key(m.get('fieldKey', ''))]


def has_signature_field(mappings: Iterable[Dict[str, Any]]) -> bool:
    return any(m.get('fieldKey', '').startswith('signature.') for m in mappings)


def question_key(key: str) -> str:
    """The key a fact is asked under"""
    group = _GROUP_OF.get(key)
    return group[0] if group else key


def _read(values: Dict[str, Any], key: str) -> str:
    category, _, field = key.partition('.')
    section = values.get(category)
    value = section.get(field) if isinstance(section, dict) else None
    return str(value).strip() if value not in (None, '') else ''


def known_value(values: Dict[str, Any], key: str) -> str:
    """What's already known about a fact, under any of its keys"""
    for member in _GROUP_OF.get(key, (key,)):
        found = _read(values, member)
        if found:
            return found
    return ''


def kind_of(key: str) -> str:
    """How the field should be entered on a phone"""
    field = key.partition('.')[2]
    if 'date' in field:
        return 'date'
    if 'address' in field or 'street' in field:
        return 'address'
    if 'phone' in field:
        return 'phone'
    if 'email' in field:
        return 'email'
    return 'text'


def build_questions(mappings: Iterable[Dict[str, Any]], known: Dict[str, Any]) -> List[Dict[str, Any]]:
    """One question per fact the template needs, with what's already known filled in"""
    questions: Dict[str, Dict[str, Any]] = {}
    for mapping in mappings:
        key = mapping.get('fieldKey', '')
        if not key or is_signature_key(key) or key in AUTOMATIC_KEYS:
            continue
        asked_as = question_key(key)
        if asked_as in questions:
            continue
        value = known_value(known, asked_as)
        # The company's details come from its record; only a gap is worth asking about
        if key.startswith('company.') and value:
            continue
        questions[asked_as] = {
            'key': asked_as,
            'label': mapping.get('label') or asked_as,
            'kind': kind_of(asked_as),
            'value': value,
        }
    # sorted() is stable, so within a category the template's order stands
    return sorted(
        questions.values(),
        key=lambda q: (
            _CATEGORY_ORDER.get(q['key'].split('.', 1)[0], len(_CATEGORY_ORDER)),
            q['key'] != 'client.display_name',
        ),
    )


def expand_answers(answers: Dict[str, Optional[str]], allowed: Iterable[str]) -> Dict[str, Dict[str, str]]:
    """Answers to questions, as prefill data with every key of each fact set.
    Only what was asked counts, so a request can't rewrite the company's details."""
    allowed = set(allowed)
    prefill: Dict[str, Dict[str, str]] = {}
    for key, value in answers.items():
        if key not in allowed:
            continue
        text = (value or '').strip()
        for member in _GROUP_OF.get(key, (key,)):
            category, _, field = member.partition('.')
            prefill.setdefault(category, {})[field] = text
    return prefill


def missing_fields(mappings: Iterable[Dict[str, Any]], prefill: Dict[str, Any]) -> List[str]:
    """Labels of the mapped fields the contract went out without"""
    missing: Dict[str, str] = {}
    for mapping in mappings:
        key = mapping.get('fieldKey', '')
        if not key or is_signature_key(key) or known_value(prefill, key):
            continue
        missing.setdefault(question_key(key), mapping.get('label') or key)
    return list(missing.values())
