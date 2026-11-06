"""A standard estimate keeps its money settings: adjustments, O&P and the tax
method are saved, come back when it is opened again, and count in the saved
total from the first save. Before, adjustments were never saved, the edit page
reopened every estimate with no adjustments, no O&P and percentage tax, and a
new estimate was saved with the items' sum as its total. Runs the real routes
on a throwaway SQLite database."""

from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
import sys

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
from app.domains.estimate import api as estimate_api  # noqa: E402
from app.domains.staff.models import StaffRole  # noqa: E402
from app.main import app  # noqa: E402

ESTIMATES = '/api/estimates'


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
def api(tmp_path, monkeypatch):
    # The repository writes dates as ISO strings, which Postgres takes and
    # SQLite's DateTime refuses; parse them as Postgres would
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
        id='00000000-0000-0000-0000-0000000000ad', role=StaffRole.admin, username='admin')

    def get_db():
        session = database.get_session()
        try:
            yield session
            session.commit()
        finally:
            session.close()
    app.dependency_overrides[database_factory.get_db_session] = get_db

    yield TestClient(app, raise_server_exceptions=True)
    app.dependency_overrides.pop(get_current_staff, None)
    app.dependency_overrides.pop(database_factory.get_db_session, None)


# What the estimate page sends: $100 of taxable work and $50 that isn't
ITEMS = [
    {'name': 'DRY', 'description': 'Drywall', 'quantity': 10, 'unit': 'SF', 'rate': 10,
     'taxable': True, 'primary_group': 'Kitchen', 'sort_order': 0},
    {'name': 'VAN', 'description': 'Vanity', 'quantity': 1, 'unit': 'EA', 'rate': 50,
     'taxable': False, 'primary_group': 'Kitchen', 'sort_order': 1},
]
SECTIONS = [{'id': 'section-1', 'title': 'Kitchen', 'order': 0, 'showSubtotal': True,
             'is_lump_sum': False, 'taxable': True}]


def new_estimate(**money):
    return {
        'estimate_number': 'EST-1',
        'estimate_type': 'standard',
        'client_name': 'Jane Homeowner',
        'estimate_date': '2026-11-01T00:00:00',
        'status': 'draft',
        'insurance_company': 'State Farm',
        'adjuster_name': 'Pat Adjuster',
        'payment_schedule': [
            {'label': 'Deposit', 'type': 'percentage', 'value': 30, 'due_label': 'Upon signing', 'sort_order': 0},
        ],
        'items': ITEMS,
        'sections_data': SECTIONS,
        **money,
    }


# Items $150; +10% Holiday makes $165; -5% Discount makes $156.75.
# Tax 6% on the taxable $100 carried through both: 100 * 1.10 * 0.95 = 104.50 -> $6.27
WITH_ADJUSTMENTS = dict(
    adjustments=[
        {'name': 'Holiday', 'percentage': 10, 'type': 'add', 'order': 1},
        {'name': 'Discount', 'percentage': 5, 'type': 'subtract', 'order': 2},
    ],
    tax_method='percentage',
    tax_rate=6,
)


def test_a_new_estimate_saves_its_adjustments_and_counts_them(api):
    created = api.post(f'{ESTIMATES}/', json=new_estimate(**WITH_ADJUSTMENTS))
    assert created.status_code == 200, created.text
    assert created.json()['total_amount'] == pytest.approx(163.02, abs=0.01)
    assert created.json()['tax_amount'] == pytest.approx(6.27, abs=0.01)

    opened = api.get(f"{ESTIMATES}/{created.json()['id']}").json()
    assert [(a['name'], a['percentage'], a['type'], a['order']) for a in opened['adjustments']] == [
        ('Holiday', 10, 'add', 1),
        ('Discount', 5, 'subtract', 2),
    ]
    assert opened['total_amount'] == pytest.approx(163.02, abs=0.01)
    assert opened['tax_method'] == 'percentage'
    assert opened['tax_rate'] == 6
    # Left out of the first save before
    assert opened['insurance_company'] == 'State Farm'
    assert opened['adjuster_name'] == 'Pat Adjuster'
    assert [p['label'] for p in opened['payment_schedule']] == ['Deposit']


def test_o_and_p_and_a_set_tax_amount_come_back_after_an_update(api):
    estimate_id = api.post(f'{ESTIMATES}/', json=new_estimate(**WITH_ADJUSTMENTS)).json()['id']

    # Adjustments taken off, legacy O&P 10% and a set $12 tax instead
    updated = api.put(f'{ESTIMATES}/{estimate_id}', json=new_estimate(
        adjustments=[], op_percent=10, tax_method='specific', tax_amount=12,
    ))
    assert updated.status_code == 200, updated.text

    opened = api.get(f'{ESTIMATES}/{estimate_id}').json()
    assert opened['adjustments'] == []
    assert opened['op_percent'] == 10
    assert opened['tax_method'] == 'specific'
    assert opened['tax_amount'] == 12
    # $150 + $15 O&P + $12 tax
    assert opened['total_amount'] == pytest.approx(177.0, abs=0.01)


def test_a_new_estimate_with_o_and_p_saves_the_full_total(api):
    created = api.post(f'{ESTIMATES}/', json=new_estimate(op_percent=10, tax_method='percentage', tax_rate=6))
    # $150 + $15 O&P; tax 6% on the taxable $100 plus its share of O&P ($110) = $6.60
    assert created.json()['total_amount'] == pytest.approx(171.60, abs=0.01)


def test_an_estimate_with_old_unnamed_adjustments_still_opens(api):
    estimate_id = api.post(f'{ESTIMATES}/', json=new_estimate(**WITH_ADJUSTMENTS)).json()['id']
    database = database_factory.get_database()
    session = database.get_session()
    session.execute(
        sa.text("UPDATE estimates SET adjustments = :value WHERE id = :id"),
        {'value': '[{"percentage": 10, "type": "percentage"}, {"name": null, "order": null}]', 'id': estimate_id},
    )
    session.commit()
    session.close()

    opened = api.get(f'{ESTIMATES}/{estimate_id}')
    assert opened.status_code == 200, opened.text
    assert [a['name'] for a in opened.json()['adjustments']] == ['', '']


def test_the_downloaded_pdf_gets_the_adjustments_and_tax_method(api, monkeypatch):
    estimate_id = api.post(f'{ESTIMATES}/', json=new_estimate(**WITH_ADJUSTMENTS)).json()['id']
    seen = {}

    class FakePdf:
        def generate_estimate_pdf(self, data, output_path, template_type='estimate'):
            seen.update(data)
            Path(output_path).write_bytes(b'%PDF-1.4 fake')
            return output_path
    monkeypatch.setattr(estimate_api, 'get_pdf_service', lambda: FakePdf())

    response = api.post(f'{ESTIMATES}/{estimate_id}/pdf')
    assert response.status_code == 200, response.text
    assert [a['name'] for a in seen['adjustments']] == ['Holiday', 'Discount']
    assert seen['tax_method'] == 'percentage'
    assert [p['label'] for p in seen['payment_schedule']] == ['Deposit']
