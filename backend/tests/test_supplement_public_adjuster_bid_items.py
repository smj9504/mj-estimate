"""A public adjuster login adds bid items but can't change or delete anyone
else's; items a public adjuster added stay open to every public adjuster, and
everyone else keeps full control. No Send to PA for them. Run through the
supplement API on a throwaway SQLite database."""

from datetime import datetime
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.dialects.postgresql import ARRAY, INET, JSONB, UUID as PG_UUID
from sqlalchemy.ext.compiler import compiles

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory  # noqa: E402
from app.core.database_factory import Base, SQLiteDatabase  # noqa: E402
from app.domains.auth.dependencies import get_current_staff  # noqa: E402
from app.domains.client.models import Claim, Client  # noqa: E402
from app.domains.company.models import Company  # noqa: E402
from app.domains.contract.models import ClaimCompany  # noqa: E402
from app.domains.staff.models import Staff, StaffCompany, StaffRole  # noqa: E402
from app.domains.supplement.models import BidItemEstimate, SupplementRequest  # noqa: E402
from app.main import app  # noqa: E402


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


ROLES = {
    'bob': StaffRole.staff,
    'pam': StaffRole.public_adjuster,
    'pete': StaffRole.public_adjuster,
}


@pytest.fixture
def env(tmp_path, monkeypatch):
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

    session = database.get_session()
    company = Company(name='Rebuild Inc', company_type='contractor')
    session.add(company)
    staff = {
        name: Staff(
            staff_number=f'S-{name}', first_name=name, last_name='Test',
            email=f'{name}@example.com', username=name,
            role=role, hire_date=datetime(2026, 1, 1),
        )
        for name, role in ROLES.items()
    }
    for row in staff.values():
        session.add(row)
    session.flush()
    for row in staff.values():
        session.add(StaffCompany(staff_id=row.id, company_id=company.id))
    client = Client(display_name='Pat Client', owners=[])
    session.add(client)
    session.flush()
    claim = Claim(client_id=client.id, claim_number='C-1', status='open')
    session.add(claim)
    session.flush()
    session.add(ClaimCompany(claim_id=claim.id, company_id=company.id, role='reconstruction'))
    supplement = SupplementRequest(claim_id=claim.id, title='Bathroom', status='in_progress')
    session.add(supplement)
    session.flush()
    # Saved before the creator was recorded
    legacy = BidItemEstimate(supplement_id=supplement.id, estimate_type='other', title='Old')
    session.add(legacy)
    session.commit()
    ids = {name: str(row.id) for name, row in staff.items()}
    ids['supplement'] = str(supplement.id)
    ids['legacy'] = str(legacy.id)
    session.close()

    current = {}
    app.dependency_overrides[get_current_staff] = lambda: current['staff']

    def get_db():
        session = database.get_session()
        try:
            yield session
            session.commit()
        finally:
            session.close()
    app.dependency_overrides[database_factory.get_db_session] = get_db

    def as_(name):
        current['staff'] = SimpleNamespace(id=ids[name], role=ROLES[name], username=name)
        return TestClient(app, raise_server_exceptions=True)

    yield as_, ids
    app.dependency_overrides.pop(get_current_staff, None)
    app.dependency_overrides.pop(database_factory.get_db_session, None)


def add_item(api, supplement_id, title):
    r = api.post(f'/api/supplements/{supplement_id}/bid-items', json={
        'supplement_id': supplement_id, 'estimate_type': 'other', 'title': title,
    })
    assert r.status_code == 200, r.text
    return r.json()


def item_url(ids, item_id):
    return f"/api/supplements/{ids['supplement']}/bid-items/{item_id}"


def test_a_public_adjuster_cant_change_or_delete_our_bid_items(env):
    as_, ids = env
    ours = add_item(as_('bob'), ids['supplement'], 'Our bathroom bid')
    assert ours['added_by_public_adjuster'] is False

    pam = as_('pam')
    for item_id in (ours['id'], ids['legacy']):
        assert pam.patch(item_url(ids, item_id), json={'title': 'Changed'}).status_code == 403
        assert pam.delete(item_url(ids, item_id)).status_code == 403

    titles = {i['title'] for i in as_('bob').get(f"/api/supplements/{ids['supplement']}").json()['bid_items']}
    assert titles == {'Our bathroom bid', 'Old'}


def test_public_adjusters_change_and_delete_each_others_bid_items(env):
    as_, ids = env
    theirs = add_item(as_('pam'), ids['supplement'], 'PA estimate')
    assert theirs['added_by_public_adjuster'] is True

    pete = as_('pete')
    r = pete.patch(item_url(ids, theirs['id']), json={'title': 'PA estimate v2'})
    assert r.status_code == 200, r.text
    assert r.json()['added_by_public_adjuster'] is True

    listed = {i['title']: i['added_by_public_adjuster']
              for i in pete.get(f"/api/supplements/{ids['supplement']}").json()['bid_items']}
    assert listed == {'PA estimate v2': True, 'Old': False}

    assert pete.delete(item_url(ids, theirs['id'])).status_code == 200


def test_our_people_keep_full_control_of_a_public_adjusters_items(env):
    as_, ids = env
    theirs = add_item(as_('pam'), ids['supplement'], 'PA estimate')
    bob = as_('bob')
    assert bob.patch(item_url(ids, theirs['id']), json={'custom_amount': 1200}).status_code == 200
    assert bob.delete(item_url(ids, theirs['id'])).status_code == 200


def test_a_public_adjuster_cant_send_to_pa(env):
    as_, ids = env
    r = as_('pam').post(f"/api/supplements/{ids['supplement']}/send-to-pa", json={})
    assert r.status_code == 403
