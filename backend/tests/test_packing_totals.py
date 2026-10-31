"""A packing estimate adds up, everywhere: each line is its qty x rate, each section
is its lines, the subtotal is its sections, the grand total is what's listed, and
the PDF says the same as the screen. In every region and every kind of job."""

import io
import itertools
import re
import sys
from pathlib import Path

import pytest
from pypdf import PdfReader

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.domains.pack_calculation.export import generate_estimate_pdf  # noqa: E402
from app.domains.pack_calculation.packing_schemas import (  # noqa: E402
    CustomSpecialItem,
    DetectedContentItem,
    QuickEstimateRequest,
    RoomContentInput,
    RoomInput,
    RoomsEstimateRequest,
)
from app.domains.pack_calculation.packing_service import (  # noqa: E402
    REGION_MULTIPLIERS,
    EstimateCalculator,
)


class _Prices:
    """A database with no packing prices: the calculator falls back to its defaults."""

    def query(self, *_):
        return self

    def filter(self, *_):
        return self

    def all(self):
        return []


def calculator():
    return EstimateCalculator(_Prices())


def assert_adds_up(result):
    """Every number on the estimate follows from the lines above it, to the cent."""
    assert set(result.sections) == set(result.section_details), 'a section without lines, or lines without a section'

    for name, detail in result.section_details.items():
        assert detail['lines'], f'{name} has no lines'
        for line in detail['lines']:
            assert line['amount'] == round(line['qty'] * line['rate'], 2), f"{name}: {line['name']}"
        lines_total = round(sum(line['amount'] for line in detail['lines']), 2)
        assert result.sections[name] == lines_total, f'{name}: section vs its lines'

    assert result.subtotal == round(sum(result.sections.values()), 2)

    enabled_supplements = sum(s.amount for s in result.supplements if s.enabled)
    assert result.supplements_total == round(enabled_supplements, 2)
    assert result.grand_total == round(
        result.subtotal + result.op_amount + result.supplements_total + result.contingency_amount, 2,
    )

    material_lines = sum(m.total for m in result.material_details or [])
    assert result.sections.get('Materials', 0) == round(material_lines, 2)


def pdf_totals(result, request):
    """The total and subtotal the PDF prints for this estimate, stored as the API stores it."""
    pdf = generate_estimate_pdf(estimate_data={
        'sections': result.sections,
        'section_details': result.section_details,
        'material_details': [m.model_dump() for m in result.material_details or []],
        'supplements': [s.model_dump() for s in result.supplements],
        'op_amount': result.op_amount,
        'contingency_amount': result.contingency_amount,
        'include_op': result.include_op,
        'op_rate': result.op_rate,
        'include_contingency': result.include_contingency,
        'contingency_rate': result.contingency_rate,
        'staging_type': getattr(request.staging_type, 'value', request.staging_type),
        'storage_months': request.storage_months,
    })
    text = ' '.join(page.extract_text() for page in PdfReader(io.BytesIO(pdf)).pages)
    money = r'\$([\d,]+\.\d\d)'
    total = re.search(r'Total Estimate:\s*' + money, text).group(1)
    subtotal = re.search(r'Items Subtotal\s*' + money, text).group(1)
    return float(total.replace(',', '')), float(subtotal.replace(',', '')), text


def content_items():
    return [
        DetectedContentItem(name='Queen Bed Frame', category='Furniture', size='large', weight='heavy', needs_disassembly=True),
        DetectedContentItem(name='Queen Mattress', category='Furniture', size='large', weight='medium'),
        DetectedContentItem(name='Dresser', category='Furniture', quantity=2, size='large', weight='heavy'),
        DetectedContentItem(name='Dish Set', category='Kitchenware', quantity=37, size='small', weight='light', is_fragile=True),
        DetectedContentItem(name='Book Collection', category='Books', quantity=83, size='small', weight='light'),
        DetectedContentItem(name='Flat Screen TV', category='Electronics', size='large', weight='medium', is_fragile=True, is_high_value=True),
        DetectedContentItem(name='Refrigerator', category='Appliances', size='xlarge', weight='very_heavy'),
        DetectedContentItem(name='Wall Mirror', category='Artwork', size='large', weight='medium', is_fragile=True),
    ]


REGIONS = sorted(REGION_MULTIPLIERS)
STAGING = ['off_site', 'on_site']
PACKBACK = [True, False]

JOBS = list(itertools.product(REGIONS, STAGING, PACKBACK))
JOB_IDS = [f'{r}-{s}-{"back" if p else "noback"}' for r, s, p in JOBS]


def photo_request(region, staging, packback, **extra):
    fields = dict(
        rooms=[
            RoomContentInput(room_name='Master Bedroom', items=content_items(), floor='2nd', density='dense'),
            RoomContentInput(room_name='Kitchen', items=content_items()[3:], contamination='gray_water'),
        ],
        region=region, staging_type=staging, include_packback=packback,
        storage_months=3, include_op=True, op_rate=20, crew_size=3,
        include_contingency=True, contingency_rate=7,
        special_items=['piano'],
        custom_special_items=[CustomSpecialItem(name='Antique Clock Crate', price=212.37)],
    )
    fields.update(extra)
    return RoomsEstimateRequest(**fields)


def quick_request(region, staging, packback, **extra):
    fields = dict(
        rooms=[
            RoomInput(preset='bedroom_standard', hints=['furniture', 'fragile', 'books']),
            RoomInput(preset='kitchen_standard', hints=['kitchenware'], contamination='black_water', floor='3rd'),
        ],
        region=region, staging_type=staging, include_packback=packback,
        storage_months=3, include_op=True, op_rate=20, crew_size=3,
        include_contingency=True, contingency_rate=7,
        special_items=['piano'],
        custom_special_items=[CustomSpecialItem(name='Antique Clock Crate', price=212.37)],
    )
    fields.update(extra)
    return QuickEstimateRequest(**fields)


@pytest.mark.parametrize('region, staging, packback', JOBS, ids=JOB_IDS)
def test_a_photo_estimate_adds_up(region, staging, packback):
    assert_adds_up(calculator().calculate_estimate_from_content(photo_request(region, staging, packback)))


@pytest.mark.parametrize('region, staging, packback', JOBS, ids=JOB_IDS)
def test_a_quick_estimate_adds_up(region, staging, packback):
    assert_adds_up(calculator().calculate_estimate(quick_request(region, staging, packback)))


@pytest.mark.parametrize('months', [0, 1, 12])
@pytest.mark.parametrize('crew', [2, 4, 6])
def test_it_adds_up_for_any_storage_and_crew(months, crew):
    assert_adds_up(calculator().calculate_estimate_from_content(
        photo_request('northeast', 'off_site', True, storage_months=months, crew_size=crew),
    ))
    assert_adds_up(calculator().calculate_estimate(
        quick_request('northeast', 'off_site', True, storage_months=months, crew_size=crew),
    ))


def test_no_storage_means_no_storage_charge_or_line():
    for result in (
        calculator().calculate_estimate_from_content(photo_request('mid_atlantic', 'off_site', True, storage_months=0)),
        calculator().calculate_estimate(quick_request('mid_atlantic', 'off_site', True, storage_months=0)),
        calculator().calculate_estimate_from_content(photo_request('mid_atlantic', 'on_site', True)),
        calculator().calculate_estimate(quick_request('mid_atlantic', 'on_site', True)),
    ):
        assert 'Storage' not in result.sections
        assert 'Storage' not in result.section_details


def test_an_estimate_with_an_empty_room_still_adds_up():
    request = RoomsEstimateRequest(rooms=[RoomContentInput(room_name='Closet', items=[])])
    assert_adds_up(calculator().calculate_estimate_from_content(request))


def test_lines_show_the_region_rate_that_is_charged():
    calc = calculator()
    base = calc.calculate_estimate_from_content(photo_request('mid_atlantic', 'off_site', True))
    northeast = calc.calculate_estimate_from_content(photo_request('northeast', 'off_site', True))
    base_line = base.section_details['Pack-Out Labor']['lines'][0]
    line = northeast.section_details['Pack-Out Labor']['lines'][0]
    assert line['rate'] == round(base_line['rate'] * REGION_MULTIPLIERS['northeast'], 2)


def test_region_applies_to_labor_only():
    calc = calculator()
    base = calc.calculate_estimate_from_content(photo_request('mid_atlantic', 'off_site', True))
    south = calc.calculate_estimate_from_content(photo_request('southeast', 'off_site', True))
    assert south.sections['Materials'] == base.sections['Materials']
    assert south.sections['Storage'] == base.sections['Storage']
    assert south.sections['Special Items'] == base.sections['Special Items']
    assert south.sections['Pack-Out Labor'] < base.sections['Pack-Out Labor']
    van = next(l for l in south.section_details['Transport Out']['lines'] if 'Van' in l['name'])
    assert van['rate'] == next(l for l in base.section_details['Transport Out']['lines'] if 'Van' in l['name'])['rate']


@pytest.mark.parametrize('region', ['mid_atlantic', 'northeast', 'southeast'])
@pytest.mark.parametrize('staging', STAGING)
def test_the_pdf_says_what_the_screen_says(region, staging):
    request = photo_request(region, staging, True)
    result = calculator().calculate_estimate_from_content(request)
    total, subtotal, _ = pdf_totals(result, request)
    assert subtotal == result.subtotal
    assert total == result.grand_total


@pytest.mark.parametrize('region', ['mid_atlantic', 'northeast'])
@pytest.mark.parametrize('staging', STAGING)
def test_the_quick_estimate_pdf_says_what_the_screen_says(region, staging):
    request = quick_request(region, staging, True)
    result = calculator().calculate_estimate(request)
    total, subtotal, _ = pdf_totals(result, request)
    assert subtotal == result.subtotal
    assert total == result.grand_total


def test_the_pdf_shows_quarter_hours_as_they_are_billed():
    request = photo_request('mid_atlantic', 'off_site', True)
    result = calculator().calculate_estimate_from_content(request)
    quarter = next(
        l for d in result.section_details.values() for l in d['lines']
        if l['unit'] == 'HR' and l['qty'] % 0.5 == 0.25
    )
    *_, text = pdf_totals(result, request)
    assert f"{quarter['qty']:g}" in text
