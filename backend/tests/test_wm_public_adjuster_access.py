"""A public adjuster's company sees the claims its adjusters are on, with their
clients, follow-ups, supplements, rebuilds and water mitigation jobs, and only
those. Run through the API on a throwaway SQLite database."""

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
from app.domains.claim_followup.models import FollowUpTask  # noqa: E402
from app.domains.client.models import Claim, Client  # noqa: E402
from app.domains.company.models import Company, CompanyContact  # noqa: E402
from app.domains.contract.models import ClaimCompany  # noqa: E402
from app.domains.rebuild.models import RebuildProject  # noqa: E402
from app.domains.staff.models import Staff, StaffCompany, StaffRole  # noqa: E402
from app.domains.supplement.models import SupplementRequest  # noqa: E402
from app.domains.water_mitigation.models import (  # noqa: E402
    WaterMitigationJob,
    WMPhoto,
    WMSheetPAMapping,
)
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


def make_staff(name, role=StaffRole.staff):
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
    # A few tables use types SQLite can't make; nothing here touches those.
    for table in Base.metadata.sorted_tables:
        try:
            table.create(database.engine, checkfirst=True)
        except Exception:
            pass
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)

    session = database.get_session()
    pa_co = Company(name='Fair Claims PA', company_type='public_adjuster')
    other_pa_co = Company(name='Other PA', company_type='public_adjuster')
    wm_co = Company(name='Dry Out LLC', company_type='water_mitigation')
    for row in (pa_co, other_pa_co, wm_co):
        session.add(row)
    session.flush()

    angel = CompanyContact(company_id=pa_co.id, name='Angel')
    vanessa = CompanyContact(company_id=pa_co.id, name='Vanessa')
    otto = CompanyContact(company_id=other_pa_co.id, name='Otto')
    for row in (angel, vanessa, otto):
        session.add(row)
    session.flush()

    staff = {
        'admin': make_staff('Admin', StaffRole.admin),
        'angel': make_staff('Angel'),
        'colleague': make_staff('Colleague'),
        'otto': make_staff('Otto'),
        'dry': make_staff('Dry'),
        'nobody': make_staff('Nobody'),
    }
    for row in staff.values():
        session.add(row)
    session.flush()
    for name, company in (('angel', pa_co), ('colleague', pa_co), ('otto', other_pa_co), ('dry', wm_co)):
        session.add(StaffCompany(staff_id=staff[name].id, company_id=company.id))

    claims = {}

    def claim(number, pa=None):
        """A claim of its own client, with one of everything the screens list"""
        client = Client(display_name=f'Owner {number}', owners=[])
        session.add(client)
        session.flush()
        row = Claim(client_id=client.id, claim_number=number, status='open',
                    pa_contact_id=str(pa.id) if pa else None)
        session.add(row)
        session.flush()
        session.add(FollowUpTask(claim_id=row.id, task_type='general', title=f'Task {number}'))
        session.add(SupplementRequest(claim_id=row.id, title=f'Supplement {number}'))
        session.add(RebuildProject(claim_id=row.id, title=f'Rebuild {number}'))
        claims[number] = row
        return row

    session.add(WMSheetPAMapping(sheet_name='Angel', pa_contact_id=str(angel.id)))
    session.add(WMSheetPAMapping(sheet_name='Otto', pa_contact_id=str(otto.id)))

    def job(address, claim_row=None, sheet=None, company=None):
        row = WaterMitigationJob(
            property_address=address,
            claim_id=claim_row.id if claim_row else None,
            google_sheet_name=sheet,
            company_id=company.id if company else None,
        )
        session.add(row)
        session.flush()
        return row

    jobs = {
        # The PA picked on the claim, Angel's or a colleague's
        'on_claim': job('1 Claim St', claim('C-1', angel), company=wm_co),
        'colleague': job('2 Colleague St', claim('C-2', vanessa)),
        # The PA comes from the sheet tab
        'sheet': job('3 Sheet St', claim('C-3'), sheet='Angel'),
        'sheet_no_claim': job('4 Orphan St', sheet='Angel'),
        # Someone else's PA was picked by hand on a job from Angel's tab
        'moved_away': job('5 Moved St', claim('C-5', otto), sheet='Angel'),
        # Otto's PA picked by hand wins over Otto's sheet too: Angel's job
        'moved_here': job('6 Moved St', claim('C-6', angel), sheet='Otto'),
        'unrelated': job('7 Other St', claim('C-7')),
    }
    photo = WMPhoto(job_id=jobs['sheet'].id, source='upload', file_name='a.jpg', file_path='a.jpg')
    other_photo = WMPhoto(job_id=jobs['unrelated'].id, source='upload', file_name='b.jpg', file_path='b.jpg')
    session.add(photo)
    session.add(other_photo)
    # The company working C-1 has its own people on it; the PA's isn't one of them
    session.add(ClaimCompany(claim_id=claims['C-1'].id, company_id=wm_co.id, role='water_mitigation'))
    session.commit()

    ids = {
        'jobs': {k: str(v.id) for k, v in jobs.items()},
        'staff': {k: str(v.id) for k, v in staff.items()},
        'claims': {k: str(v.id) for k, v in claims.items()},
        'clients': {k: str(v.client_id) for k, v in claims.items()},
        'wm_co': str(wm_co.id),
        'photo': str(photo.id),
        'other_photo': str(other_photo.id),
    }
    roles = {k: v.role for k, v in staff.items()}
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
        current['staff'] = SimpleNamespace(id=ids['staff'][name], role=roles[name], username=name)
        return TestClient(app, raise_server_exceptions=True)

    yield as_, ids, database, current
    app.dependency_overrides.pop(get_current_staff, None)
    app.dependency_overrides.pop(database_factory.get_db_session, None)


def listed(response):
    assert response.status_code == 200, response.text
    return {j['property_address'] for j in response.json()['items']}


def test_the_adjusters_company_sees_its_adjusters_jobs(env):
    as_, _, _, _ = env
    expected = {'1 Claim St', '2 Colleague St', '3 Sheet St', '4 Orphan St', '6 Moved St'}
    assert listed(as_('angel').get('/api/water-mitigation/jobs')) == expected
    assert listed(as_('colleague').get('/api/water-mitigation/jobs')) == expected


def test_a_pa_picked_on_the_claim_wins_over_the_sheet_tab(env):
    as_, _, _, _ = env
    assert listed(as_('otto').get('/api/water-mitigation/jobs')) == {'5 Moved St'}


def test_opening_a_job_follows_the_same_rule(env):
    as_, ids, _, _ = env
    client = as_('angel')
    assert client.get(f"/api/water-mitigation/jobs/{ids['jobs']['on_claim']}").status_code == 200
    assert client.get(f"/api/water-mitigation/jobs/{ids['jobs']['sheet_no_claim']}").status_code == 200
    assert client.get(f"/api/water-mitigation/jobs/{ids['jobs']['moved_away']}").status_code == 404
    assert client.get(f"/api/water-mitigation/jobs/{ids['jobs']['unrelated']}").status_code == 404


def test_a_jobs_photos_follow_it(env):
    as_, ids, database, current = env
    from app.domains.water_mitigation.job_access import require_photo
    from fastapi import HTTPException

    as_('angel')
    session = database.get_session()
    try:
        require_photo(session, current['staff'], ids['photo'])
        with pytest.raises(HTTPException) as refused:
            require_photo(session, current['staff'], ids['other_photo'])
        assert refused.value.status_code == 404
    finally:
        session.close()


def screens(client):
    """The claim numbers each screen lists for the signed-in person"""
    def numbers(path, prefix):
        response = client.get(path)
        assert response.status_code == 200, response.text
        return {row['title'].replace(prefix, '') for row in response.json()}

    response = client.get('/api/clients/')
    assert response.status_code == 200, response.text
    return {
        'clients': {c['display_name'].replace('Owner ', '') for c in response.json()['clients']},
        'followups': numbers('/api/claim-followup/tasks', 'Task '),
        'supplements': numbers('/api/supplements', 'Supplement '),
        'rebuilds': numbers('/api/rebuild/projects', 'Rebuild '),
    }


def on_every_screen(numbers):
    return dict.fromkeys(('clients', 'followups', 'supplements', 'rebuilds'), set(numbers))


def test_the_adjusters_company_sees_its_claims_on_every_screen(env):
    as_, _, _, _ = env
    # C-5 is on Angel's sheet tab, but Otto was picked on the claim
    expected = on_every_screen({'C-1', 'C-2', 'C-3', 'C-6'})
    assert screens(as_('angel')) == expected
    assert screens(as_('colleague')) == expected


def test_a_pa_picked_on_the_claim_wins_on_every_screen(env):
    as_, _, _, _ = env
    assert screens(as_('otto')) == on_every_screen({'C-5'})


def test_the_screens_stay_closed_to_everyone_else(env):
    as_, _, _, _ = env
    assert screens(as_('nobody')) == on_every_screen(set())
    assert screens(as_('dry')) == on_every_screen({'C-1'})
    assert screens(as_('admin')) == on_every_screen({'C-1', 'C-2', 'C-3', 'C-5', 'C-6', 'C-7'})


def test_opening_a_claim_follows_the_same_rule(env):
    as_, ids, _, _ = env
    client = as_('angel')
    for number, expected in (('C-1', 200), ('C-3', 200), ('C-5', 404), ('C-7', 404)):
        claim_id, client_id = ids['claims'][number], ids['clients'][number]
        assert client.get(f'/api/clients/{client_id}').status_code == expected
        assert client.get(f'/api/clients/{client_id}/claims/{claim_id}').status_code == expected
        assert client.get(f'/api/claim-followup/tasks/by-claim/{claim_id}').status_code == expected
        assert client.get(f'/api/supplements/by-claim/{claim_id}').status_code == expected
        assert client.get(f'/api/rebuild/projects/by-claim/{claim_id}').status_code == expected


def test_the_client_page_shows_the_adjusters_claim(env):
    as_, ids, _, _ = env
    page = as_('angel').get(f"/api/clients/{ids['clients']['C-1']}")
    assert page.status_code == 200, page.text
    assert [c['claim_number'] for c in page.json()['claims']] == ['C-1']


def test_the_adjuster_can_save_a_claim_without_joining_its_companies(env):
    # The claim form always sends the companies already on the claim
    as_, ids, _, _ = env
    url = f"/api/clients/{ids['clients']['C-1']}/claims/{ids['claims']['C-1']}"
    saved = as_('angel').put(url, json={'notes': 'Called', 'company_ids': [ids['wm_co']]})
    assert saved.status_code == 200, saved.text
    assert saved.json()['notes'] == 'Called'


def test_others_on_a_claim_still_have_to_keep_their_company(env):
    as_, ids, _, _ = env
    url = f"/api/clients/{ids['clients']['C-1']}/claims/{ids['claims']['C-1']}"
    assert as_('dry').put(url, json={'company_ids': []}).status_code == 400


def test_the_older_rules_still_hold(env):
    as_, ids, _, _ = env
    assert listed(as_('nobody').get('/api/water-mitigation/jobs')) == set()
    assert listed(as_('dry').get('/api/water-mitigation/jobs')) == {'1 Claim St'}
    assert len(listed(as_('admin').get('/api/water-mitigation/jobs'))) == len(ids['jobs'])
    assert as_('nobody').get(f"/api/water-mitigation/jobs/{ids['jobs']['on_claim']}").status_code == 404
    assert as_('admin').get(f"/api/water-mitigation/jobs/{ids['jobs']['unrelated']}").status_code == 200


def test_the_lifecycle_lists_show_the_adjusters_jobs_with_no_claim(env):
    as_, ids, database, _ = env
    session = database.get_session()
    session.query(WaterMitigationJob).update({'status': 'Sent to adjuster'})
    session.commit()
    session.close()
    client = as_('angel')
    response = client.get('/api/claims/lifecycle/pending-estimates')
    assert response.status_code == 200, response.text
    assert {j['job_id'] for j in response.json()} == {
        ids['jobs'][k] for k in ('on_claim', 'colleague', 'sheet', 'sheet_no_claim', 'moved_here')
    }
