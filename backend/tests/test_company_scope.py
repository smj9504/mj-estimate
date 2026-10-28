"""Staff see only the claims and cash jobs of their companies, and the clients
and documents on them; admins see everything. Run through the client API on a
throwaway SQLite database."""

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
from app.domains.client.claim_companies import add_claim_company, companies_by_claim  # noqa: E402
from app.domains.client.models import Claim, ClaimNegotiation, Client  # noqa: E402
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


def make_staff(name, role):
    return Staff(
        staff_number=f'S-{name}', first_name=name, last_name='Test',
        email=f'{name.lower()}@example.com', username=name.lower(),
        role=role, hire_date=datetime(2026, 1, 1),
    )


@pytest.fixture
def env(tmp_path, monkeypatch):
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    sa.event.listen(
        database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF')
    )
    # Every table, one at a time; the client page counts documents of many kinds.
    # A few use types SQLite can't make; nothing here touches those.
    for table in Base.metadata.sorted_tables:
        try:
            table.create(database.engine, checkfirst=True)
        except Exception:
            pass
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)

    session = database.get_session()
    wm_co = Company(name='Dry Out LLC', company_type='water_mitigation')
    build_co = Company(name='Rebuild Inc', company_type='contractor')
    admin = make_staff('Admin', StaffRole.admin)
    alice = make_staff('Alice', StaffRole.staff)
    bob = make_staff('Bob', StaffRole.staff)
    nobody = make_staff('Nobody', StaffRole.staff)
    for row in (wm_co, build_co, admin, alice, bob, nobody):
        session.add(row)
    session.flush()
    session.add(StaffCompany(staff_id=alice.id, company_id=wm_co.id))
    session.add(StaffCompany(staff_id=bob.id, company_id=build_co.id))

    pat = Client(display_name='Pat Shared', owners=[])
    sam = Client(display_name='Sam Rebuild', owners=[])
    lee = Client(display_name='Lee New', owners=[], company_id=wm_co.id)
    kim = Client(display_name='Kim Nobody', owners=[])
    for row in (pat, sam, lee, kim):
        session.add(row)
    session.flush()
    pat_wm = Claim(client_id=pat.id, claim_number='WM-1', status='open')
    pat_build = Claim(client_id=pat.id, claim_number='RB-1', status='open')
    sam_build = Claim(client_id=sam.id, claim_number='RB-2', status='open')
    for row in (pat_wm, pat_build, sam_build):
        session.add(row)
    session.flush()
    session.add(ClaimCompany(claim_id=pat_wm.id, company_id=wm_co.id, role='water_mitigation'))
    session.add(ClaimCompany(claim_id=pat_build.id, company_id=build_co.id, role='reconstruction'))
    session.add(ClaimCompany(claim_id=sam_build.id, company_id=build_co.id, role='reconstruction'))
    revision = ClaimNegotiation(claim_id=pat_build.id, revision_number=1, revision_type='initial')
    session.add(revision)
    session.commit()

    ids = {k: str(v.id) for k, v in {
        'wm_co': wm_co, 'build_co': build_co,
        'admin': admin, 'alice': alice, 'bob': bob, 'nobody': nobody,
        'pat': pat, 'sam': sam, 'lee': lee, 'kim': kim,
        'pat_wm': pat_wm, 'pat_build': pat_build, 'sam_build': sam_build,
        'revision': revision,
    }.items()}
    session.close()

    roles = {'admin': StaffRole.admin, 'alice': StaffRole.staff,
             'bob': StaffRole.staff, 'nobody': StaffRole.staff}
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
        current['staff'] = SimpleNamespace(id=ids[name], role=roles[name], username=name)
        return TestClient(app, raise_server_exceptions=True)

    yield as_, ids, database
    app.dependency_overrides.pop(get_current_staff, None)
    app.dependency_overrides.pop(database_factory.get_db_session, None)


def client_names(response):
    assert response.status_code == 200, response.text
    return sorted(c['display_name'] for c in response.json()['clients'])


def test_each_person_sees_the_clients_of_their_companies(env):
    as_, ids, _ = env
    assert client_names(as_('alice').get('/api/clients/')) == ['Lee New', 'Pat Shared']
    assert client_names(as_('bob').get('/api/clients/')) == ['Pat Shared', 'Sam Rebuild']
    assert client_names(as_('nobody').get('/api/clients/')) == []
    assert client_names(as_('admin').get('/api/clients/')) == [
        'Kim Nobody', 'Lee New', 'Pat Shared', 'Sam Rebuild']
    assert client_names(as_('alice').get('/api/clients/', params={'search': 'a'})) == [
        'Pat Shared']


def test_claim_counts_only_count_visible_claims(env):
    as_, ids, _ = env
    counts = {c['display_name']: c['claim_count'] for c in as_('alice').get('/api/clients/').json()['clients']}
    assert counts == {'Pat Shared': 1, 'Lee New': 0}


def test_the_list_shows_each_clients_newest_visible_claim_and_last_change(env):
    as_, ids, database = env
    session = database.get_session()
    pat = session.query(Client).filter(Client.display_name == 'Pat Shared').one()
    pat.created_at = pat.updated_at = datetime(2025, 12, 1)
    wm = session.query(Claim).filter(Claim.claim_number == 'WM-1').one()
    wm.created_at, wm.updated_at, wm.status = datetime(2026, 1, 1), datetime(2026, 3, 1), 'settled'
    build = session.query(Claim).filter(Claim.claim_number == 'RB-1').one()
    build.created_at, build.updated_at, build.status = datetime(2026, 2, 1), datetime(2026, 2, 5), 'negotiating'
    session.commit()
    session.close()

    def rows(name, **params):
        clients = as_(name).get('/api/clients/', params=params).json()['clients']
        return {c['display_name']: (c['latest_claim_status'], (c['last_activity_at'] or '')[:10])
                for c in clients}

    # Newest claim by when it was opened; last change across the client and its claims
    assert rows('admin')['Pat Shared'] == ('negotiating', '2026-03-01')
    assert rows('bob')['Pat Shared'] == ('negotiating', '2026-02-05')
    assert rows('alice')['Pat Shared'] == ('settled', '2026-03-01')
    assert rows('alice')['Lee New'][0] is None
    assert rows('alice', search='Pat') == {'Pat Shared': ('settled', '2026-03-01')}


def test_a_shared_client_shows_each_company_its_own_claims(env):
    as_, ids, _ = env
    alice_claims = as_('alice').get(f"/api/clients/{ids['pat']}/claims").json()['claims']
    assert [c['claim_number'] for c in alice_claims] == ['WM-1']
    assert alice_claims[0]['companies'] == [
        {'id': ids['wm_co'], 'name': 'Dry Out LLC', 'role': 'water_mitigation'}]

    detail = as_('bob').get(f"/api/clients/{ids['pat']}").json()
    assert [c['claim_number'] for c in detail['claims']] == ['RB-1']


def test_other_companies_clients_claims_and_rows_answer_404(env):
    as_, ids, _ = env
    alice = as_('alice')
    assert alice.get(f"/api/clients/{ids['sam']}").status_code == 404
    assert alice.get(f"/api/clients/{ids['pat']}/claims/{ids['pat_build']}").status_code == 404
    # The row's own claim decides, not the claim in the path
    path = f"/api/clients/{ids['pat']}/claims/{ids['pat_wm']}/negotiations/{ids['revision']}"
    assert alice.delete(path).status_code == 404
    assert alice.get(f"/api/clients/{ids['pat']}/claims/{ids['pat_wm']}").status_code == 200
    assert as_('admin').get(f"/api/clients/{ids['sam']}").status_code == 200


def test_claim_search_finds_only_visible_claims(env):
    as_, ids, _ = env
    found = as_('alice').get('/api/clients/claims/search', params={'q': 'Pat'}).json()['claims']
    assert [c['claim_number'] for c in found] == ['WM-1']
    assert found[0]['claim_type'] == 'insurance'


def test_a_cash_job_has_no_insurance_details_and_gets_the_creators_company(env):
    as_, ids, database = env
    response = as_('alice').post(f"/api/clients/{ids['lee']}/claims", json={
        'client_id': ids['lee'], 'claim_type': 'cash', 'status': 'open',
        'insurance_company': 'Allstate', 'adjuster_name': 'Ann', 'loss_description': 'Kitchen remodel',
    })
    assert response.status_code == 200, response.text
    job = response.json()
    assert job['claim_type'] == 'cash'
    assert job['insurance_company'] is None and job['adjuster_name'] is None
    assert job['loss_description'] == 'Kitchen remodel'
    assert job['claim_number'] == ''
    assert [c['id'] for c in job['companies']] == [ids['wm_co']]
    # Lee now has a cash job of Alice's company, so Bob still can't see Lee
    assert as_('bob').get(f"/api/clients/{ids['lee']}").status_code == 404


def test_claim_companies_can_change_but_not_drop_your_own(env):
    as_, ids, _ = env
    path = f"/api/clients/{ids['pat']}/claims/{ids['pat_wm']}"
    refused = as_('alice').put(path, json={'company_ids': [ids['build_co']]})
    assert refused.status_code == 400

    shared = as_('alice').put(path, json={'company_ids': [ids['wm_co'], ids['build_co']]})
    assert shared.status_code == 200, shared.text
    bob_claims = as_('bob').get(f"/api/clients/{ids['pat']}/claims").json()['claims']
    assert sorted(c['claim_number'] for c in bob_claims) == ['RB-1', 'WM-1']

    moved = as_('admin').put(path, json={'company_ids': [ids['build_co']]})
    assert moved.status_code == 200
    assert as_('alice').get(path).status_code == 404


def test_a_new_client_is_managed_by_the_creators_company(env):
    as_, ids, _ = env
    created = as_('alice').post('/api/clients/', json={'display_name': 'New Person', 'owners': []})
    assert created.status_code == 200, created.text
    assert created.json()['company_id'] == ids['wm_co']
    assert as_('alice').get(f"/api/clients/{created.json()['id']}").status_code == 200
    assert as_('nobody').post('/api/clients/', json={'display_name': 'X', 'owners': []}).status_code == 400


def test_deleting_a_client_with_another_companys_claim_is_refused(env):
    as_, ids, _ = env
    assert as_('alice').delete(f"/api/clients/{ids['pat']}").status_code == 403


def test_admins_pick_each_persons_companies(env):
    as_, ids, _ = env
    admin = as_('admin')
    response = admin.put(f"/api/auth/staff/{ids['nobody']}",
                         json={'company_ids': [ids['wm_co'], ids['build_co']]})
    assert response.status_code == 200, response.text
    assert sorted(response.json()['company_ids']) == sorted([ids['wm_co'], ids['build_co']])
    staff = {s['username']: s for s in admin.get('/api/auth/staff').json()}
    assert sorted(staff['nobody']['company_ids']) == sorted([ids['wm_co'], ids['build_co']])
    assert client_names(as_('nobody').get('/api/clients/')) == ['Lee New', 'Pat Shared', 'Sam Rebuild']

    second = as_('admin').put(f"/api/auth/staff/{ids['nobody']}", json={'company_ids': [ids['build_co']]})
    assert second.status_code == 200, second.text
    assert second.json()['company_ids'] == [ids['build_co']]
    assert client_names(as_('nobody').get('/api/clients/')) == ['Pat Shared', 'Sam Rebuild']
    assert as_('alice').put(f"/api/auth/staff/{ids['bob']}", json={'company_ids': []}).status_code == 403


def test_a_wm_company_lands_on_its_claim_once(env):
    _, ids, database = env
    session = database.get_session()
    raw = session._session
    assert add_claim_company(raw, ids['sam_build'], ids['wm_co'], role='water_mitigation') is True
    assert add_claim_company(raw, ids['sam_build'], ids['wm_co'], role='water_mitigation') is False
    session.commit()
    names = [c['name'] for c in companies_by_claim(raw, [ids['sam_build']])[ids['sam_build']]]
    assert names == ['Rebuild Inc', 'Dry Out LLC']
    session.close()


def test_a_person_in_every_company_sees_them_all_including_new_ones(env):
    as_, ids, database = env
    admin = as_('admin')
    response = admin.put(f"/api/auth/staff/{ids['nobody']}", json={'all_companies': True})
    assert response.status_code == 200, response.text
    assert response.json()['all_companies'] is True
    assert response.json()['company_ids'] == []
    staff = {s['username']: s for s in admin.get('/api/auth/staff').json()}
    assert staff['nobody']['all_companies'] is True and staff['alice']['all_companies'] is False
    # Kim is on no company, so only admins see her
    assert client_names(as_('nobody').get('/api/clients/')) == ['Lee New', 'Pat Shared', 'Sam Rebuild']

    session = database.get_session()
    roof_co = Company(name='Roof Co', company_type='roofing')
    ines = Client(display_name='Ines Roof', owners=[])
    session.add(roof_co)
    session.add(ines)
    session.flush()
    roof_job = Claim(client_id=ines.id, claim_number='RF-1', status='open')
    session.add(roof_job)
    session.flush()
    session.add(ClaimCompany(claim_id=roof_job.id, company_id=roof_co.id, role='reconstruction'))
    session.commit()
    session.close()
    assert client_names(as_('nobody').get('/api/clients/')) == [
        'Ines Roof', 'Lee New', 'Pat Shared', 'Sam Rebuild']
    assert client_names(as_('alice').get('/api/clients/')) == ['Lee New', 'Pat Shared']

    off = as_('admin').put(f"/api/auth/staff/{ids['nobody']}", json={'all_companies': None})
    assert off.status_code == 200, off.text
    assert off.json()['all_companies'] is False
    assert client_names(as_('nobody').get('/api/clients/')) == []


def test_new_work_of_someone_in_every_company_goes_to_their_picked_ones(env):
    as_, ids, _ = env
    as_('admin').put(f"/api/auth/staff/{ids['nobody']}", json={'all_companies': True})
    path = f"/api/clients/{ids['pat']}/claims"
    # Not onto every company at once
    refused = as_('nobody').post(path, json={'client_id': ids['pat'], 'status': 'open'})
    assert refused.status_code == 400

    as_('admin').put(f"/api/auth/staff/{ids['nobody']}", json={'company_ids': [ids['build_co']]})
    created = as_('nobody').post(path, json={'client_id': ids['pat'], 'status': 'open'})
    assert created.status_code == 200, created.text
    assert [c['id'] for c in created.json()['companies']] == [ids['build_co']]
    client = as_('nobody').post('/api/clients/', json={'display_name': 'New Person', 'owners': []})
    assert client.status_code == 200, client.text
    assert client.json()['company_id'] == ids['build_co']


def test_nobody_turns_on_every_company_for_themselves(env):
    as_, ids, _ = env
    as_('alice').put('/api/auth/me', json={'all_companies': True})
    assert client_names(as_('alice').get('/api/clients/')) == ['Lee New', 'Pat Shared']
    assert as_('alice').put(f"/api/auth/staff/{ids['alice']}", json={'all_companies': True}).status_code == 403
