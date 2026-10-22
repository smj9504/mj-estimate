"""Partial-height wall drywall is billed per LF while its scope item stays in SF."""

from decimal import Decimal

from app.domains.water_mitigation.invoice_calculation_config import (
    convert_partial_wall_quantity,
)


def test_4ft_wall_sf_divides_by_cut_height_for_per_lf_line_item():
    # 3.03 LF wall cut at 4' → 12.11 SF on the scope item
    assert convert_partial_wall_quantity(
        'Wall - Drywall 4ft (Drywall)', Decimal('12.11'), 'SF', 'LF',
    ) == (Decimal('3.03'), 'LF')


def test_2ft_wall_without_sub_type_divides_by_2():
    assert convert_partial_wall_quantity(
        'Wall - Drywall 2ft', Decimal('80.21'), 'SF', 'LF',
    ) == (Decimal('40.11'), 'LF')


def test_per_sf_line_item_keeps_sf():
    assert convert_partial_wall_quantity(
        'Wall - Drywall 4ft (Plaster)', Decimal('12.11'), 'SF', 'SF',
    ) == (Decimal('12.11'), 'SF')


def test_scope_item_already_in_lf_is_left_alone():
    # Added from the "Drywall - 2ft" standard item, which is entered in LF
    assert convert_partial_wall_quantity(
        'Wall - Drywall 2ft', Decimal('40'), 'LF', 'LF',
    ) == (Decimal('40'), 'LF')


def test_full_height_wall_and_unmapped_items_are_left_alone():
    assert convert_partial_wall_quantity(
        'Wall/Drywall (Drywall)', Decimal('96'), 'SF', 'LF',
    ) == (Decimal('96'), 'SF')
    assert convert_partial_wall_quantity(
        'Wall - Drywall 4ft (Drywall)', Decimal('12.11'), 'SF', None,
    ) == (Decimal('12.11'), 'SF')
