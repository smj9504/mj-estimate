"""
Cent rounding for document totals.

A line's amount is quantity * rate rounded to cents, and subtotals add up
those rounded amounts, so the lines printed on an invoice or estimate add up
to the subtotal and total printed below them. The editors round the same way
(frontend/src/utils/money.ts); if the two disagree, the edit page and the PDF
show different totals.
"""

from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal('0.01')


def to_cents(value) -> Decimal:
    """Round to cents, halves away from zero. Never returns -0.00.

    A float is first rounded to 6 places to drop binary noise: 3.03 * 7.5 is
    22.724999999999998 as a float and would otherwise round down to 22.72.
    """
    if not isinstance(value, Decimal):
        value = Decimal(str(round(float(value or 0), 6)))
    cents = value.quantize(CENT, rounding=ROUND_HALF_UP)
    return cents if cents else Decimal('0.00')


def line_amount(quantity, rate) -> Decimal:
    """A line item's amount: quantity * rate, rounded to cents."""
    return to_cents(Decimal(str(quantity)) * Decimal(str(rate)))
