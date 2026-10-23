"""Debris disposal fee is priced per CY, so the bag count is billed as CY."""

from decimal import Decimal

from app.domains.water_mitigation.invoice_calculation_config import (
    calculate_debris_disposal_fee,
)


def test_bag_count_converts_to_cy_rounded_up_to_half():
    # 11 bags × 0.208 CY = 2.29 CY → 2.5 CY
    quantity, note = calculate_debris_disposal_fee(11, Decimal('0.4279'))
    assert quantity == Decimal('2.5')
    assert '11 bags × 0.208 CY = 2.29 CY' in note
    assert 'Billed at 2.5 CY' in note
    assert 'Total debris: 0.43 tons' in note


def test_single_bag_bills_minimum_half_cy():
    quantity, _ = calculate_debris_disposal_fee(1)
    assert quantity == Decimal('0.5')


def test_exact_half_cy_is_not_rounded_up_further():
    # 12 bags × 0.208 CY = 2.496 CY → 2.5 CY; 24 bags = 4.992 CY → 5.0 CY
    assert calculate_debris_disposal_fee(12)[0] == Decimal('2.5')
    assert calculate_debris_disposal_fee(24)[0] == Decimal('5.0')


def test_no_debris_calculation_defaults_to_one():
    quantity, note = calculate_debris_disposal_fee(0)
    assert quantity == Decimal('1')
    assert 'Run debris calculation' in note
