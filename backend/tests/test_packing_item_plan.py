"""A content item's size, weight, category, fragile and quantity decide how it's
packed and how long it takes; what the analysis can't settle goes to the
estimator, whose choices are what get priced and saved."""

import re
import sys
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.dialects.postgresql import ARRAY, INET, JSONB, UUID as PG_UUID
from sqlalchemy.dialects.sqlite import base as sqlite_base
from sqlalchemy.ext.compiler import compiles

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory  # noqa: E402
from app.core.database_factory import Base, SQLiteDatabase  # noqa: E402
from app.domains.auth.dependencies import get_current_staff  # noqa: E402
from app.domains.pack_calculation.item_plan import (  # noqa: E402
    METHODS,
    apply_plan,
    flags_for_storage,
    flags_from_storage,
    method_label,
    plan_item,
    weight_class_from_lb,
)
from app.domains.pack_calculation.packing_schemas import (  # noqa: E402
    DetectedContentItem,
    RoomContentInput,
    RoomsEstimateRequest,
)
from app.domains.pack_calculation.packing_service import EstimateCalculator  # noqa: E402
from app.domains.pack_calculation.taxonomy import normalize_items_list  # noqa: E402
from app.domains.pack_calculation.vision import _build_room_analysis_response  # noqa: E402
from app.domains.staff.models import StaffRole  # noqa: E402
from app.main import app  # noqa: E402

ADMIN_ID = '00000000-0000-0000-0000-0000000000ad'


@compiles(JSONB, 'sqlite')
def _jsonb(type_, compiler, **kw):
    return 'JSON'


@compiles(ARRAY, 'sqlite')
def _array(type_, compiler, **kw):
    return 'JSON'


@compiles(INET, 'sqlite')
def _inet(type_, compiler, **kw):
    return 'VARCHAR(45)'


@compiles(PG_UUID, 'sqlite')
def _uuid(type_, compiler, **kw):
    return 'VARCHAR(36)'


@pytest.fixture
def env(tmp_path, monkeypatch):
    real = sqlite_base.DATETIME.bind_processor

    def bind_processor(self, dialect):
        process = real(self, dialect)

        def parse_then_process(value):
            if isinstance(value, str):
                value = datetime.fromisoformat(value.replace('Z', '+00:00'))
            return process(value)
        return parse_then_process
    monkeypatch.setattr(sqlite_base.DATETIME, 'bind_processor', bind_processor)

    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    sa.event.listen(
        database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF')
    )
    for table in Base.metadata.sorted_tables:
        try:
            table.create(database.engine, checkfirst=True)
        except Exception:
            pass
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)

    app.dependency_overrides[get_current_staff] = lambda: SimpleNamespace(
        id=ADMIN_ID, role=StaffRole.admin, username='admin')

    def get_db():
        session = database.get_session()
        try:
            yield session
            session.commit()
        finally:
            session.close()
    app.dependency_overrides[database_factory.get_db_session] = get_db

    yield TestClient(app, raise_server_exceptions=True), database
    app.dependency_overrides.pop(get_current_staff, None)
    app.dependency_overrides.pop(database_factory.get_db_session, None)


def item(name, category='Other', quantity=1, size='medium', weight='medium', **extra):
    return DetectedContentItem(
        name=name, category=category, quantity=quantity, size=size, weight=weight, **extra,
    )


class _NoPrices:
    """A database with no packing prices: the calculator falls back to its defaults."""

    def query(self, *_):
        return self

    def filter(self, *_):
        return self

    def all(self):
        return []


def calculator():
    return EstimateCalculator(_NoPrices())


def room(items, name='Bedroom', **extra):
    return RoomContentInput(room_name=name, items=items, **extra)


def estimate(rooms, **extra):
    request = RoomsEstimateRequest(rooms=rooms, **extra)
    return calculator().calculate_estimate_from_content(request), request


BEDROOM = [
    ('Queen Bed Frame', 'Furniture', 1, 'large', 'heavy', {'needs_disassembly': True}),
    ('Queen Mattress', 'Furniture', 1, 'large', 'medium', {}),
    ('Dresser', 'Furniture', 1, 'large', 'heavy', {}),
    ('Nightstand', 'Furniture', 2, 'medium', 'medium', {}),
    ('Table Lamp', 'Fragile', 2, 'small', 'light', {'is_fragile': True}),
    ('Framed Picture', 'Artwork', 3, 'small', 'light', {'is_fragile': True}),
    ('Clothing Items', 'Clothing', 30, 'small', 'light', {}),
    ('Flat Screen TV', 'Electronics', 1, 'medium', 'medium', {'is_fragile': True}),
]


def bedroom_items():
    return [item(n, c, q, s, w, **e) for n, c, q, s, w, e in BEDROOM]


# ── Packing method follows what the item is ───

@pytest.mark.parametrize('name, category, size, weight, fragile, expected', [
    ('Queen Mattress', 'Furniture', 'large', 'medium', False, 'mattress_bag'),
    ('Flat Screen TV', 'Electronics', 'medium', 'medium', True, 'tv_box'),
    ('TV Stand', 'Furniture', 'medium', 'medium', False, 'blanket_wrap'),
    ('Gaming Console', 'Electronics', 'small', 'light', False, 'box_padded'),
    ('Computer Monitor', 'Electronics', 'medium', 'light', True, 'box_padded'),
    ('Computer Monitor', 'Electronics', 'large', 'medium', True, 'tv_box'),
    ('Hanging Garments', 'Clothing', 'small', 'light', False, 'wardrobe_box'),
    ('Clothing Items', 'Clothing', 'small', 'light', False, 'soft_pack'),
    ('Quilt Blanket', 'Other', 'small', 'light', False, 'soft_pack'),
    ('Dish Set', 'Kitchenware', 'small', 'light', True, 'dish_pack'),
    ('Pot and Pan Set', 'Kitchenware', 'small', 'medium', False, 'box_standard'),
    ('Book Collection', 'Books', 'small', 'light', False, 'book_box'),
    ('Sofa', 'Furniture', 'large', 'heavy', False, 'cover_wrap'),
    ('Dresser', 'Furniture', 'large', 'heavy', False, 'blanket_wrap'),
    ('Wall Mirror', 'Artwork', 'medium', 'medium', True, 'mirror_box'),
    ('Table Lamp', 'Fragile', 'small', 'light', True, 'lamp_box'),
    ('Refrigerator', 'Appliances', 'xlarge', 'very_heavy', False, 'appliance_secure'),
    ('Toaster', 'Appliances', 'small', 'light', False, 'box_padded'),
    ('Area Rug', 'Other', 'large', 'medium', False, 'rug_roll'),
    ('Storage Bin', 'Other', 'medium', 'medium', False, 'move_as_is'),
    ('Ladder', 'Tools', 'medium', 'medium', False, 'move_as_is'),
    ('Ceramic Vase', 'Fragile', 'small', 'light', True, 'box_fragile'),
    ('Sculpture', 'Artwork', 'large', 'very_heavy', True, 'crate'),
    ('Treadmill', 'Sports', 'xlarge', 'very_heavy', False, 'blanket_wrap'),
])
def test_method_follows_the_kind_of_item(name, category, size, weight, fragile, expected):
    subject = item(name, category, size=size, weight=weight, is_fragile=fragile)
    if name == 'Sculpture':
        subject.is_high_value = True
    assert plan_item(subject).method == expected


def test_a_mattress_gets_the_bag_for_its_size():
    assert plan_item(item('King Mattress', 'Furniture', size='xlarge')).materials == {'mattress_king': 1}
    assert plan_item(item('Twin Mattress', 'Furniture', size='medium')).materials == {'mattress_twin': 1}
    # No size in the name: the item's size decides
    assert plan_item(item('Mattress', 'Furniture', size='large')).materials == {'mattress_queen': 1}


# ── Labor follows size, weight, fragile, quantity ─

def test_bigger_and_heavier_takes_longer():
    small = plan_item(item('Cabinet', 'Furniture', size='small', weight='medium')).total_hours
    large = plan_item(item('Cabinet', 'Furniture', size='large', weight='medium')).total_hours
    heavy = plan_item(item('Cabinet', 'Furniture', size='large', weight='heavy')).total_hours
    very_heavy = plan_item(item('Cabinet', 'Furniture', size='large', weight='very_heavy')).total_hours
    assert small < large < heavy < very_heavy


def test_fragile_moves_the_hours_to_the_fragile_tier_and_adds_cushioning():
    plain = plan_item(item('Cabinet', 'Furniture', size='large', weight='heavy'))
    fragile = plan_item(item('Cabinet', 'Furniture', size='large', weight='heavy', is_fragile=True))
    assert set(plain.tier_hours) == {'standard'}
    assert set(fragile.tier_hours) == {'fragile'}
    assert fragile.total_hours > plain.total_hours
    assert 'bubble_24' in fragile.materials and 'bubble_24' not in plain.materials


def test_quantity_scales_per_unit_and_keeps_one_setup():
    one = plan_item(item('Dish Set', 'Kitchenware', 1, 'small', 'light', is_fragile=True))
    forty = plan_item(item('Dish Set', 'Kitchenware', 40, 'small', 'light', is_fragile=True))
    assert forty.base_hours == one.base_hours
    assert forty.total_hours == pytest.approx(one.base_hours + one.per_unit_hours * 40)


def test_a_piece_of_a_batch_is_not_slowed_by_weight():
    light = plan_item(item('Book Collection', 'Books', 80, 'small', 'light')).total_hours
    heavy = plan_item(item('Book Collection', 'Books', 80, 'small', 'heavy')).total_hours
    assert light == heavy


def test_disassembly_and_high_value_are_their_own_labor_tiers():
    plan = plan_item(item(
        'Desk', 'Furniture', 2, 'large', 'heavy', needs_disassembly=True, is_high_value=True,
    ))
    assert set(plan.tier_hours) == {'standard', 'furniture_disassembly', 'specialty'}
    assert sum(plan.tier_hours.values()) == pytest.approx(plan.total_hours, abs=0.01)


def test_a_large_appliance_is_appliance_labor():
    assert set(plan_item(item('Refrigerator', 'Appliances', size='xlarge', weight='very_heavy')).tier_hours) == {'appliance'}


def test_a_heavy_piece_takes_longer_to_carry_than_a_light_one():
    light = plan_item(item('Cabinet', 'Furniture', size='large', weight='light')).carry_minutes
    heavy = plan_item(item('Cabinet', 'Furniture', size='large', weight='very_heavy')).carry_minutes
    assert heavy > light
    # Books go out in boxes: a fraction of a box each
    assert plan_item(item('Book Collection', 'Books', size='small', weight='light')).carry_minutes < 0.1


def test_missing_size_and_weight_fall_back_to_the_category():
    plan = plan_item(DetectedContentItem(name='Old Wardrobe', category='Furniture'))
    assert (plan.size, plan.weight) == ('large', 'heavy')


# ── The estimator's method wins ───────────────

def test_a_chosen_method_stays_when_attributes_change():
    subject = item('Dresser', 'Furniture', size='large', weight='heavy',
                   packing_method='crate', packing_locked=True)
    assert plan_item(subject).method == 'crate'
    subject.size = 'medium'
    assert plan_item(subject).method == 'crate'


def test_an_automatic_method_follows_the_attributes():
    subject = item('Mixer', 'Appliances', size='small', weight='light')
    apply_plan(subject)
    assert subject.packing_method == 'box_padded'
    subject.size = 'xlarge'
    apply_plan(subject)
    assert subject.packing_method == 'appliance_secure'


def test_an_unknown_chosen_method_is_ignored():
    subject = item('Dresser', 'Furniture', size='large', weight='heavy',
                   packing_method='Wrap it nicely', packing_locked=True)
    assert plan_item(subject).method == 'blanket_wrap'


def test_method_label_shows_old_free_text_as_it_is():
    assert method_label('blanket_wrap') == 'Blanket wrap'
    assert method_label('Empty drawers and wrap') == 'Empty drawers and wrap'
    assert method_label(None) == ''


# ── The estimate ──────────────────────────────

def test_a_typical_bedroom_stays_near_the_old_room_estimate():
    hours = calculator().classify_labor_hours([room(bedroom_items())])
    # The room-based estimate gave this bedroom 9.3 person-hours
    assert 6.5 <= sum(hours.values()) <= 10.5


def test_a_nearly_empty_room_costs_less_than_a_full_one():
    calc = calculator()
    empty = calc.classify_labor_hours([room([item('Twin Mattress', 'Furniture')])])
    full = calc.classify_labor_hours([room(bedroom_items())])
    assert sum(empty.values()) < sum(full.values()) / 2


def test_changing_one_item_moves_the_price():
    light, _ = estimate([room([item('Cabinet', 'Furniture', 4, 'large', 'light')])])
    heavy, _ = estimate([room([item('Cabinet', 'Furniture', 4, 'large', 'very_heavy')])])
    assert heavy.sections['Pack-Out Labor'] > light.sections['Pack-Out Labor']
    fragile, _ = estimate([room([item('Cabinet', 'Furniture', 4, 'large', 'light', is_fragile=True)])])
    assert fragile.sections['Pack-Out Labor'] > light.sections['Pack-Out Labor']


def test_a_small_fragile_line_still_shows_on_the_estimate():
    result, _ = estimate([room([
        item('Ceramic Vase', 'Fragile', 1, 'small', 'light', is_fragile=True),
    ])])
    lines = {l['name'] for l in result.section_details['Pack-Out Labor']['lines']}
    assert 'Fragile / High-Care Items' in lines


def test_labor_lines_add_up_to_their_section():
    result, _ = estimate([room(bedroom_items())])
    for section in ('Pack-Out Labor', 'Pack-Back Labor'):
        lines = result.section_details[section]['lines']
        assert sum(l['amount'] for l in lines) == pytest.approx(result.sections[section], abs=0.05)


def test_fragile_rooms_keep_their_pack_back_labor():
    result, _ = estimate([room([
        item('Dish Set', 'Kitchenware', 60, 'small', 'light', is_fragile=True),
    ], name='Kitchen')])
    standard = next(l for l in result.section_details['Pack-Back Labor']['lines'] if l['name'] == 'Standard Pack-Back')
    assert standard['qty'] >= 1.5


def test_an_item_that_may_not_be_there_is_not_priced_until_kept():
    unsure = item('Cabinet', 'Furniture', 1, 'xlarge', 'very_heavy', uncertain_fields=['presence'])
    without, _ = estimate([room([item('Lamp', 'Fragile', is_fragile=True)])])
    withheld, _ = estimate([room([item('Lamp', 'Fragile', is_fragile=True), unsure])])
    assert withheld.total_items == without.total_items
    assert withheld.grand_total == without.grand_total

    kept = unsure.model_copy(update={'uncertain_fields': []})
    counted, _ = estimate([room([item('Lamp', 'Fragile', is_fragile=True), kept])])
    assert counted.total_items == without.total_items + 1
    assert counted.grand_total > without.grand_total


def test_other_doubts_are_priced_on_the_ais_best_guess():
    unsure = item('Cabinet', 'Furniture', 1, 'large', 'heavy', uncertain_fields=['weight'])
    sure = item('Cabinet', 'Furniture', 1, 'large', 'heavy')
    assert estimate([room([unsure])])[0].grand_total == estimate([room([sure])])[0].grand_total


def test_what_the_screen_sent_cannot_change_the_price():
    honest = item('Cabinet', 'Furniture', 1, 'large', 'heavy')
    tampered = honest.model_copy(update={
        'base_labor_hours': 0, 'per_unit_labor_hours': 0, 'required_materials': [],
        'packing_method': 'move_as_is', 'estimated_labor_hours': 0,
    })
    assert estimate([room([tampered])])[0].grand_total == estimate([room([honest])])[0].grand_total


def test_a_rooms_items_share_boxes():
    twelve, _ = estimate([room([item('Dish Set', 'Kitchenware', 12, 'small', 'light', is_fragile=True)])])
    thirteen, _ = estimate([room([item('Dish Set', 'Kitchenware', 13, 'small', 'light', is_fragile=True)])])
    assert twelve.materials['box_dish'] == 1
    assert thirteen.materials['box_dish'] == 2
    split, _ = estimate([room([
        item('Dish Set', 'Kitchenware', 6, 'small', 'light', is_fragile=True),
        item('Glassware Set', 'Kitchenware', 6, 'small', 'light', is_fragile=True),
    ])])
    assert split.materials['box_dish'] == 1


def test_every_material_a_method_uses_has_a_price():
    from app.domains.pack_calculation.packing_service import MATERIAL_CODES
    for method in METHODS.values():
        for by_size in method.materials:
            for key in by_size:
                assert key in MATERIAL_CODES, key


def test_the_screen_offers_exactly_these_methods():
    constants = Path(__file__).resolve().parents[2] / 'frontend/src/components/packing-estimate/constants.ts'
    block = constants.read_text(encoding='utf-8').split('PACKING_METHOD_OPTIONS')[1].split('];')[0]
    assert set(re.findall(r"value: '(\w+)'", block)) == set(METHODS)


# ── Analysis results ──────────────────────────

def analysis(*items):
    return _build_room_analysis_response({'items': list(items), 'density': 'normal'}, 'Bedroom').items


def seen(name='Cabinet', **extra):
    return {
        'name': name, 'category': 'Furniture', 'quantity': 1, 'size': 'large', 'weight': 'heavy',
        'is_high_value': False, 'is_fragile': False, 'needs_disassembly': False,
        'item_confidence': 0.95, 'uncertain': [], **extra,
    }


def test_the_analysis_fills_in_method_and_labor_from_attributes():
    [result] = analysis(seen())
    assert result.packing_method == 'blanket_wrap'
    assert result.estimated_labor_hours == plan_item(result).total_hours
    assert result.uncertain_fields == []


def test_only_a_low_confidence_can_hold_an_item_out_of_the_price():
    [result] = analysis(seen('Book Collection', uncertain=['presence', 'quantity'], item_confidence=0.9))
    assert result.uncertain_fields == ['quantity']


def test_what_the_ai_cannot_tell_reaches_the_estimator_with_its_reason():
    [result] = analysis(seen(uncertain=['weight', 'not-a-field'], uncertainty_note="Can't tell solid wood."))
    assert result.uncertain_fields == ['weight']
    assert result.review_note == "Can't tell solid wood."


def test_low_confidence_is_kept_for_a_decision_and_a_guess_is_dropped():
    results = analysis(seen('Clear'), seen('Maybe', item_confidence=0.6), seen('Guess', item_confidence=0.3))
    assert [r.name for r in results] == ['Maybe', 'Clear']
    assert results[0].uncertain_fields == ['presence']


def test_items_needing_a_decision_come_first():
    results = analysis(seen('A'), seen('B', uncertain=['size']), seen('C'), seen('D', uncertain=['weight']))
    assert [r.name for r in results] == ['B', 'D', 'A', 'C']


def test_a_missing_or_invalid_answer_is_a_question_not_an_error():
    [result] = analysis(seen(size=None, weight='enormous'))
    assert set(result.uncertain_fields) == {'size', 'weight'}
    assert (result.size, result.weight) == ('large', 'heavy')  # the category's default


def test_a_size_and_weight_that_dont_go_together_are_questioned():
    [result] = analysis(seen(size='small', weight='very_heavy'))
    assert result.uncertain_fields == ['weight']
    assert result.review_note


def test_an_item_with_doubts_about_presence_does_not_count_in_the_totals():
    response = _build_room_analysis_response(
        {'items': [seen('Clear'), seen('Maybe', item_confidence=0.6, is_fragile=True)]}, 'Bedroom',
    )
    assert response.fragile_count == 0
    assert response.total_labor_hours == pytest.approx(plan_item(response.items[1]).total_hours, abs=0.01)


# ── Taxonomy ──────────────────────────────────

def test_fragile_the_item_list_does_not_expect_goes_to_the_estimator():
    # The AI saw a glass top; the item list says coffee tables aren't fragile
    table = {'name': 'Coffee Table', 'category': 'Furniture', 'is_fragile': True}
    normalize_items_list([table])
    assert table['is_fragile'] is True
    assert table['_taxonomy_review'] == ['fragile']


def test_fragile_the_ai_missed_is_simply_fragile():
    # Nothing to decide: a vase always is
    vase = {'name': 'Ceramic Vase', 'category': 'Fragile', 'is_fragile': False}
    normalize_items_list([vase])
    assert vase['is_fragile'] is True
    assert vase['_taxonomy_review'] == []


def test_agreeing_with_the_list_raises_no_question():
    bed = {'name': 'Queen Bed Frame', 'category': 'Furniture', 'is_fragile': False, 'is_high_value': True}
    normalize_items_list([bed])
    assert bed['_taxonomy_review'] == []
    assert bed['is_high_value'] is False


# ── Quick Estimate is still room-based ────────

def test_quick_estimate_still_works_from_presets():
    from app.domains.pack_calculation.packing_schemas import QuickEstimateRequest, RoomInput
    result = calculator().calculate_estimate(QuickEstimateRequest(rooms=[
        RoomInput(preset='bedroom_standard', hints=['furniture', 'fragile']),
    ]))
    assert result.grand_total > 0
    assert 'Pack-Out Labor' in result.sections


# ── Saved with the estimate ───────────────────

def test_weight_survives_being_stored_as_pounds():
    from app.domains.pack_calculation.item_plan import WEIGHT_CLASS_LB
    for weight, pounds in WEIGHT_CLASS_LB.items():
        assert weight_class_from_lb(pounds) == weight
    assert weight_class_from_lb(None) is None


def test_open_questions_survive_being_stored_among_the_flags():
    stored = flags_for_storage(['HEAVY'], ['weight', 'size'])
    assert flags_from_storage(stored) == (['HEAVY'], ['weight', 'size'])
    assert flags_from_storage(None) == ([], [])


def test_the_item_plan_endpoint_prices_an_edit(env):
    client = env[0]
    edited = item('Dresser', 'Furniture', 2, 'large', 'very_heavy').model_dump()
    res = client.post('/api/packing-estimate/item-plan', json=edited)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body['packing_method'] == 'blanket_wrap'
    assert body['estimated_labor_hours'] == plan_item(item('Dresser', 'Furniture', 2, 'large', 'very_heavy')).total_hours
    assert 'HEAVY' in body['estimator_flags']


def test_a_size_the_older_calculator_wrote_is_not_passed_on(env):
    from app.domains.pack_calculation.models import PackCalculation, PackEstimateMode, PackItem, PackRoom
    client, database = env
    session = database.get_session()
    calc = PackCalculation(estimate_mode=PackEstimateMode.PHOTO_AI, crew_size=4, created_by_id=ADMIN_ID)
    session.add(calc)
    session.flush()
    room_row = PackRoom(calculation_id=calc.id, room_name='Den', floor_level='MAIN_LEVEL', input_method='IMAGE')
    session.add(room_row)
    session.flush()
    session.add(PackItem(room_id=room_row.id, item_name='Old Dresser', item_category='Furniture', size_category='Huge'))
    session.commit()
    calc_id = str(calc.id)
    session.close()

    [saved] = client.get(f'/api/packing-estimate/{calc_id}').json()['rooms'][0]['items']
    assert saved['size'] is None
    # So recalculating it works, from the category's defaults
    assert client.post('/api/packing-estimate/item-plan', json=saved).status_code == 200


def test_saving_and_reading_back_keeps_every_decision(env):
    client = env[0]
    payload = RoomsEstimateRequest(rooms=[room(
        [
            item('Dresser', 'Furniture', 2, 'large', 'very_heavy', is_fragile=True),
            item('Bookcase', 'Furniture', 1, 'large', 'heavy',
                 packing_method='crate', packing_locked=True),
            item('Chair', 'Furniture', 1, 'medium', 'medium', uncertain_fields=['weight']),
            item('Maybe a Cabinet', 'Furniture', 1, 'large', 'heavy', uncertain_fields=['presence']),
        ],
        floor='2nd',
    )]).model_dump(mode='json')

    res = client.post('/api/packing-estimate/content-estimate', json=payload)
    assert res.status_code == 200, res.text
    estimate_id = res.json()['id']

    detail = client.get(f'/api/packing-estimate/{estimate_id}').json()
    [saved_room] = detail['rooms']
    assert saved_room['floor'] == '2nd'
    saved = {i['name']: i for i in saved_room['items']}

    # What wasn't priced isn't on the estimate
    assert set(saved) == {'Dresser', 'Bookcase', 'Chair'}

    assert saved['Dresser']['size'] == 'large'
    assert saved['Dresser']['weight'] == 'very_heavy'
    assert saved['Dresser']['is_fragile'] is True
    assert saved['Dresser']['packing_method'] == 'blanket_wrap'
    assert saved['Dresser']['packing_locked'] is False

    # A chosen method comes back chosen, so a recalculation keeps it
    assert saved['Bookcase']['packing_method'] == 'crate'
    assert saved['Bookcase']['packing_locked'] is True

    # An open question stays open, and isn't shown as an ordinary flag
    assert saved['Chair']['uncertain_fields'] == ['weight']
    assert not any('REVIEW' in f for f in saved['Chair']['estimator_flags'])
