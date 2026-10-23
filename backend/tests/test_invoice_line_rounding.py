"""Invoice totals add up the cent-rounded line amounts, the same lines the PDF prints."""

from decimal import Decimal

from app.common.services.pdf_service import PDFService
from app.common.utils.money import line_amount, to_cents
from app.domains.invoice.service import InvoiceService

# Lines from INV-BE1K-2026-25: none of them come to whole cents
ITEMS = [
    {'primary_group': 'Ground Floor', 'quantity': 152.37, 'rate': 5.80},   # 883.746
    {'primary_group': 'Ground Floor', 'quantity': 40.11, 'rate': 0.75},    # 30.0825
    {'primary_group': '2nd Floor', 'quantity': 3.03, 'rate': 7.50},        # 22.725
    {'primary_group': '2nd Floor', 'quantity': 64.46, 'rate': 0.75},       # 48.345
]


def test_line_amount_rounds_halves_up_despite_float_noise():
    assert 3.03 * 7.5 == 22.724999999999998
    assert line_amount(3.03, 7.5) == Decimal('22.73')
    assert line_amount(1, -22.725) == Decimal('-22.73')


def test_to_cents_never_returns_negative_zero():
    assert str(to_cents(-0.004)) == '0.00'


def test_totals_and_pdf_agree_with_the_printed_lines():
    printed = [PDFService._format_currency(i['quantity'] * i['rate']) for i in ITEMS]
    assert printed == ['$883.75', '$30.08', '$22.73', '$48.35']

    totals = InvoiceService.calculate_totals(None, ITEMS)
    assert totals['total_amount'] == 984.91          # unrounded lines: 984.8985

    pdf = PDFService._prepare_invoice_context(PDFService.__new__(PDFService), {
        'items': ITEMS,
        'payments': [{'amount': 984.91}],
        'company': {'name': 'Co'},
        'client': {'name': 'Client'},
    })
    assert pdf['total'] == 984.91
    assert PDFService._format_number_smart(pdf['total'] - pdf['total_paid']) == '0'
