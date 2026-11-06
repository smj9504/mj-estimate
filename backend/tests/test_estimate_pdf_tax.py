"""The "Enhanced" estimate PDF (the estimate page's default template, also its
preview) taxes only taxable items, with their share of the adjustments or O&P,
so its tax and total match the page and the saved total. Before, it taxed the
whole subtotal, non-taxable items included."""

from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.common.services.pdf_service import PDFService  # noqa: E402
from app.domains.estimate.service import EstimateService  # noqa: E402

# $100 of taxable work and a $50 vanity that isn't taxed
TAXED = {'name': 'DRY', 'quantity': 10, 'rate': 10, 'taxable': True, 'primary_group': 'Kitchen'}
UNTAXED = {'name': 'VAN', 'quantity': 1, 'rate': 50, 'taxable': False, 'primary_group': 'Kitchen'}
ADJUSTMENTS = [
    {'name': 'Holiday', 'percentage': 10, 'type': 'add', 'order': 1},
    {'name': 'Discount', 'percentage': 5, 'type': 'subtract', 'order': 2},
]


def enhanced(**data):
    return PDFService._prepare_estimate_context(PDFService.__new__(PDFService), {
        'company': {'name': 'Co'}, 'client': {'name': 'Client'}, 'tax_method': 'percentage', **data,
    })


def saved_total(items, **money):
    return EstimateService.calculate_totals(None, items, tax_method='percentage', **money)


def test_adjustments_tax_only_the_taxable_share():
    pdf = enhanced(sections=[{'title': 'Kitchen', 'items': [TAXED, UNTAXED]}],
                   adjustments=ADJUSTMENTS, tax_rate=6)
    # 150 -> +10% 165 -> -5% 156.75; tax 6% of 100 * 1.10 * 0.95 = 104.50 -> 6.27
    assert pdf['tax_amount'] == pytest.approx(6.27, abs=0.005)
    assert pdf['total'] == pytest.approx(163.02, abs=0.005)
    assert pdf['total'] == pytest.approx(
        saved_total([TAXED, UNTAXED], tax_rate=6, adjustments=ADJUSTMENTS)['total_amount'], abs=0.005)


def test_o_and_p_taxes_only_the_taxable_share_of_flat_items():
    pdf = enhanced(items=[TAXED, UNTAXED], op_percent=10, tax_rate=6)
    # 150 + 15 O&P; tax 6% of the taxable 100 and its 10 of O&P = 6.60
    assert pdf['tax_amount'] == pytest.approx(6.60, abs=0.005)
    assert pdf['total'] == pytest.approx(171.60, abs=0.005)
    assert pdf['total'] == pytest.approx(
        saved_total([TAXED, UNTAXED], tax_rate=6, op_percent=10)['total_amount'], abs=0.005)


def test_a_non_taxable_lump_sum_section_is_not_taxed():
    pdf = enhanced(sections=[
        {'title': 'Kitchen', 'items': [TAXED]},
        {'title': 'Permit', 'items': [], 'isLumpSum': True, 'lumpSumAmount': 40, 'taxable': False},
    ], tax_rate=6)
    assert pdf['tax_amount'] == pytest.approx(6.00, abs=0.005)
    assert pdf['total'] == pytest.approx(146.00, abs=0.005)


def test_all_taxable_items_are_taxed_as_before():
    pdf = enhanced(sections=[{'title': 'Kitchen', 'items': [TAXED]}], tax_rate=6)
    assert pdf['tax_amount'] == pytest.approx(6.00, abs=0.005)
    assert pdf['total'] == pytest.approx(106.00, abs=0.005)


def test_a_set_tax_amount_is_kept():
    pdf = enhanced(items=[TAXED, UNTAXED], tax_method='specific', tax_amount=12)
    assert pdf['tax_amount'] == 12
    assert pdf['total'] == pytest.approx(162.00, abs=0.005)
