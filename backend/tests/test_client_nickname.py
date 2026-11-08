"""A client can carry a nickname, what staff call it among themselves
("아이스크림집", "목사님"). It saves and clears like any field, everyone who
can see the client sees it, and the client and claim searches find it -
but only for the people who may see that client.

Run through the API on a throwaway SQLite database."""

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


@pytest.fixture
def env(tmp_path, monkeypatch):
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    sa.event.listen(
        database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF')
    )
    # A few tables use types SQLite can't make; nothing here touches those.
    for table in Base.metadata.sorted_tables:
        try:
            table.create(database.engine, checkfirst=True)
        except Exception:
            pass
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)

    session = database.get_session()

    def staff(username, role):
        row = Staff(
            staff_number=f'S-{username}', first_name=username, last_name='Test',
            email=f'{username}@example.com', username=username, role=role,
            hire_date=datetime(2026, 1, 1), is_active=True, can_login=True,
        )
        session.add(row)
        session.flush()
        return row

    ours = Company(name='Our Co')
    theirs = Company(name='Their Co')
    session.add(ours)
    session.add(theirs)
    session.flush()

    admin = staff('admin', StaffRole.admin)
    our_staff = staff('ours', StaffRole.staff)
    their_staff = staff('theirs', StaffRole.staff)
    session.add(StaffCompany(staff_id=our_staff.id, company_id=ours.id))
    session.add(StaffCompany(staff_id=their_staff.id, company_id=theirs.id))

    shop = Client(display_name='Jin Park', nickname='아이스크림집', owners=[],
                  address='12 Elm St', company_id=ours.id)
    session.add(shop)
    session.add(Client(display_name='Sam Lee', owners=[], address='9 Oak Ave', company_id=ours.id))
    session.flush()
    claim = Claim(client_id=shop.id, claim_number='CLM-1', status='open', company_id=ours.id)
    session.add(claim)
    session.flush()
    # Staff see a claim through the companies assigned to it
    session.add(ClaimCompany(claim_id=claim.id, company_id=ours.id, role='water_mitigation'))
    session.commit()

    people = {
        'admin': SimpleNamespace(id=str(admin.id), role=StaffRole.admin, username='admin'),
        'ours': SimpleNamespace(id=str(our_staff.id), role=StaffRole.staff, username='ours'),
        'theirs': SimpleNamespace(id=str(their_staff.id), role=StaffRole.staff, username='theirs'),
    }
    shop_id = str(shop.id)
    session.close()

    def get_db():
        db = database.get_session()
        try:
            yield db
            db.commit()
        finally:
            db.close()
    app.dependency_overrides[database_factory.get_db_session] = get_db

    def as_(who):
        app.dependency_overrides[get_current_staff] = lambda: people[who]
        return TestClient(app, raise_server_exceptions=True)

    yield SimpleNamespace(as_=as_, shop_id=shop_id)
    app.dependency_overrides.pop(get_current_staff, None)
    app.dependency_overrides.pop(database_factory.get_db_session, None)


def names(response):
    assert response.status_code == 200, response.text
    return [c['display_name'] for c in response.json()['clients']]


def test_the_list_and_the_client_page_carry_the_nickname(env):
    api = env.as_('ours')
    listed = api.get('/api/clients/', params={'limit': 100}).json()['clients']
    assert {c['display_name']: c['nickname'] for c in listed} == {
        'Jin Park': '아이스크림집', 'Sam Lee': None,
    }
    page = api.get(f'/api/clients/{env.shop_id}')
    assert page.status_code == 200, page.text
    assert page.json()['nickname'] == '아이스크림집'


def test_searches_find_a_client_by_its_nickname(env):
    api = env.as_('ours')
    assert names(api.get('/api/clients/', params={'search': '아이스크림'})) == ['Jin Park']
    assert names(api.get('/api/clients/search', params={'q': '아이스크림'})) == ['Jin Park']

    claims = api.get('/api/clients/claims/search', params={'q': '아이스크림'})
    assert claims.status_code == 200, claims.text
    [claim] = claims.json()['claims']
    assert claim['claim_number'] == 'CLM-1'
    assert claim['client_name'] == 'Jin Park'
    assert claim['client_nickname'] == '아이스크림집'


def test_someone_who_cant_see_the_client_cant_find_it_by_nickname(env):
    api = env.as_('theirs')
    assert names(api.get('/api/clients/', params={'search': '아이스크림'})) == []
    assert names(api.get('/api/clients/search', params={'q': '아이스크림'})) == []
    claims = api.get('/api/clients/claims/search', params={'q': '아이스크림'})
    assert claims.json()['claims'] == []


def test_a_nickname_saves_trimmed_stays_when_left_out_and_clears_when_blank(env):
    api = env.as_('ours')
    url = f'/api/clients/{env.shop_id}'

    saved = api.put(url, json={'nickname': '  목사님   댁 '})
    assert saved.status_code == 200, saved.text
    assert api.get(url).json()['nickname'] == '목사님 댁'

    # Editing something else leaves it alone
    assert api.put(url, json={'notes': 'Side door'}).status_code == 200
    assert api.get(url).json()['nickname'] == '목사님 댁'

    assert api.put(url, json={'nickname': '   '}).status_code == 200
    assert api.get(url).json()['nickname'] is None

    too_long = api.put(url, json={'nickname': 'x' * 101})
    assert too_long.status_code == 422


def test_a_new_client_can_start_with_a_nickname(env):
    api = env.as_('admin')
    made = api.post('/api/clients/', json={
        'display_name': 'Grace Church', 'nickname': '목사님', 'owners': [],
    })
    assert made.status_code == 200, made.text
    assert names(api.get('/api/clients/search', params={'q': '목사'})) == ['Grace Church']
