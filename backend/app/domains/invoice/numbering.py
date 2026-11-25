"""
Company invoice numbers: INV-[CompanyCode]-[Year]-[Sequence].

The next number is one past the highest sequence the company already has
that year - every version of every invoice counted, deleted ones' numbers
never handed out again.
"""

from typing import Tuple

from app.domains.invoice.models import Invoice


def next_company_invoice_number(session, company_code: str, year: str) -> Tuple[str, int]:
    """(invoice number, its sequence) for the company's next invoice in that year.

    session: a SQLAlchemy session or the app's session wrapper (anything with .query)
    """
    prefix = f"INV-{company_code}-{year}-"
    rows = session.query(Invoice.invoice_number).filter(
        Invoice.invoice_number.startswith(prefix, autoescape=True)
    ).all()
    highest = 0
    for (number,) in rows:
        tail = (number or "")[len(prefix):]
        if tail.isdigit():
            highest = max(highest, int(tail))
    sequence = highest + 1
    return f"{prefix}{sequence}", sequence
