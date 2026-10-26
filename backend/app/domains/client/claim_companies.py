"""
The companies working a claim or cash job (claim_companies).

A claim can have several. Who sees a claim follows from them: staff see the
claims their companies are assigned to (auth/company_scope.py). Each row
keeps a role for the screens that ask for one (water mitigation company,
reconstruction company); picking companies on the claim form fills the role
in from the company's type.
"""

import logging
from typing import Dict, Iterable, List, Optional

logger = logging.getLogger(__name__)

ROLE_BY_COMPANY_TYPE = {
    'water_mitigation': 'water_mitigation',
    'contractor': 'reconstruction',
    'roofing': 'reconstruction',
    'moving': 'moving',
    'plumber': 'plumber',
}


def role_for_company_type(company_type: Optional[str]) -> str:
    return ROLE_BY_COMPANY_TYPE.get((company_type or '').strip(), 'other')


def companies_by_claim(session, claim_ids: Iterable[str]) -> Dict[str, List[dict]]:
    """{claim_id: [{id, name, role}, ...]}, one entry per company, oldest first"""
    from app.domains.company.models import Company
    from app.domains.contract.models import ClaimCompany

    ids = [str(c) for c in claim_ids if c]
    result: Dict[str, List[dict]] = {cid: [] for cid in ids}
    if not ids:
        return result
    rows = session.query(
        ClaimCompany.claim_id, ClaimCompany.company_id, ClaimCompany.role, Company.name
    ).join(
        Company, Company.id == ClaimCompany.company_id
    ).filter(
        ClaimCompany.claim_id.in_(ids)
    ).order_by(ClaimCompany.assigned_at, ClaimCompany.created_at).all()
    seen = set()
    for claim_id, company_id, role, name in rows:
        key = (str(claim_id), str(company_id))
        if key in seen:
            continue
        seen.add(key)
        result.setdefault(str(claim_id), []).append(
            {'id': str(company_id), 'name': name, 'role': role}
        )
    return result


def add_claim_company(session, claim_id, company_id, role: Optional[str] = None) -> bool:
    """Put a company on a claim unless it is already there. True when added.

    Doesn't commit; the caller's transaction carries it.
    """
    from app.domains.company.models import Company
    from app.domains.contract.models import ClaimCompany

    if not claim_id or not company_id:
        return False
    exists = session.query(ClaimCompany.id).filter(
        ClaimCompany.claim_id == str(claim_id),
        ClaimCompany.company_id == str(company_id),
    ).first()
    if exists:
        return False
    if role is None:
        company = session.query(Company.company_type).filter(Company.id == str(company_id)).first()
        if company is None:
            return False
        role = role_for_company_type(company[0])
    session.add(ClaimCompany(claim_id=str(claim_id), company_id=str(company_id), role=role))
    session.flush()
    return True


def set_claim_companies(session, claim_id, company_ids: Iterable[str]) -> None:
    """Make these the claim's companies: add the new ones, drop the rest.

    A company keeps its existing rows (and their roles) when it stays.
    Doesn't commit.
    """
    from app.domains.company.models import Company
    from app.domains.contract.models import ClaimCompany

    wanted = []
    for cid in company_ids or []:
        cid = str(cid).strip()
        if cid and cid not in wanted:
            wanted.append(cid)

    known = {
        str(r[0]): r[1]
        for r in session.query(Company.id, Company.company_type).filter(Company.id.in_(wanted)).all()
    } if wanted else {}
    missing = [cid for cid in wanted if cid not in known]
    if missing:
        raise ValueError(f"Company not found: {', '.join(missing)}")

    rows = session.query(ClaimCompany).filter(ClaimCompany.claim_id == str(claim_id)).all()
    current = {str(r.company_id) for r in rows}
    for row in rows:
        if str(row.company_id) not in wanted:
            session.delete(row)
    for cid in wanted:
        if cid not in current:
            session.add(ClaimCompany(
                claim_id=str(claim_id), company_id=cid,
                role=role_for_company_type(known[cid]),
            ))
    session.flush()
