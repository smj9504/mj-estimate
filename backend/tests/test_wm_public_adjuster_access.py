"""A public adjuster's company sees the water mitigation jobs its adjusters are
on, and only those. Run through the WM API on a throwaway SQLite database."""

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
from app.domains.auth import company_scope  # noqa: E402
from app.domains.auth.dependencies import get_current_staff  # noqa: E402
from app.domains.client.models import Claim, Client  # noqa: E402
from app.domains.company.models import Company, CompanyContact  # noqa: E402
from app.domains.staff.models import Staff, StaffCompany, StaffRole  # noqa: E402
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

    client = Client(display_name='Pat', owners=[])
    session.add(client)
    session.flush()

    def claim(number, pa=None):
        row = Claim(client_id=client.id, claim_number=number, status='open',
                    pa_contact_id=str(pa.id) if pa else None)
        session.add(row)
        session.flush()
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
    session.commit()

    ids = {
        'jobs': {k: str(v.id) for k, v in jobs.items()},
        'staff': {k: str(v.id) for k, v in staff.items()},
        'claim': str(jobs['on_claim'].claim_id),
        'client': str(client.id),
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


def test_seeing_a_job_does_not_open_its_claim_or_client(env):
    as_, ids, database, current = env
    as_('angel')
    session = database.get_session()
    try:
        assert not company_scope.can_see_claim(session, current['staff'], ids['claim'])
        assert not company_scope.can_see_client(session, current['staff'], ids['client'])
    finally:
        session.close()


def test_the_older_rules_still_hold(env):
    as_, ids, _, _ = env
    assert listed(as_('nobody').get('/api/water-mitigation/jobs')) == set()
    assert listed(as_('dry').get('/api/water-mitigation/jobs')) == {'1 Claim St'}
    assert len(listed(as_('admin').get('/api/water-mitigation/jobs'))) == len(ids['jobs'])
    assert as_('nobody').get(f"/api/water-mitigation/jobs/{ids['jobs']['on_claim']}").status_code == 404
    assert as_('admin').get(f"/api/water-mitigation/jobs/{ids['jobs']['unrelated']}").status_code == 200
