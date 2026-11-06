"""The Clients list runs in the Water Mitigation list's order (2026-11-06):

- a client with an active WM job sorts by when its newest active WM job was
  made, as the WM list sorts its jobs (active, newest first);
- every other client - no WM job, or only inactive ones - slots in by when it
  or one of its claims last changed.

Run through the API on a throwaway SQLite database."""

from datetime import datetime, timezone
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
from app.domains.staff.models import Staff, StaffRole  # noqa: E402
from app.domains.water_mitigation.models import WaterMitigationJob  # noqa: E402
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


def day(month, d):
    return datetime(2026, month, d, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def api(tmp_path, monkeypatch):
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
    admin = Staff(
        staff_number='S-Admin', first_name='Admin', last_name='Test',
        email='admin@example.com', username='admin', role=StaffRole.admin,
        hire_date=datetime(2026, 1, 1), is_active=True, can_login=True,
    )
    session.add(admin)

    def client(name, created, updated=None):
        row = Client(display_name=name, owners=[], created_at=created, updated_at=updated)
        session.add(row)
        session.flush()
        return row

    def claim(owner, number, created, updated=None):
        row = Claim(client_id=owner.id, claim_number=number, status='open',
                    created_at=created, updated_at=updated)
        session.add(row)
        session.flush()
        return row

    def wm_job(on_claim, created, active=True):
        session.add(WaterMitigationJob(
            property_address=f'{on_claim.claim_number} address', status='Lead',
            active=active, claim_id=on_claim.id, created_at=created, updated_at=created,
        ))

    # Recently edited, no claims: slots in by that edit
    client('Edited', day(10, 1), day(11, 5))
    # Claim changed today, but its WM job was made on 11/01: sorts by the job
    b = client('Older WM', day(10, 1))
    wm_job(claim(b, 'C-B', day(10, 1), day(11, 6)), day(11, 1))
    c = client('Newest WM', day(10, 2))
    wm_job(claim(c, 'C-C', day(10, 2)), day(11, 3))
    # Only an inactive WM job: off the WM list, so by its claim's last change
    d = client('Closed WM', day(9, 1))
    wm_job(claim(d, 'C-D', day(9, 1), day(10, 15)), day(11, 4), active=False)
    client('Untouched', day(10, 20))
    # Two active WM jobs: the newer one places it
    f = client('Two WM', day(8, 1))
    f_claim = claim(f, 'C-F', day(8, 1))
    wm_job(f_claim, day(9, 1))
    wm_job(f_claim, day(11, 2))
    session.commit()
    admin_id = str(admin.id)
    session.close()

    app.dependency_overrides[get_current_staff] = lambda: SimpleNamespace(
        id=admin_id, role=StaffRole.admin, username='admin')

    def get_db():
        db = database.get_session()
        try:
            yield db
            db.commit()
        finally:
            db.close()
    app.dependency_overrides[database_factory.get_db_session] = get_db

    yield TestClient(app, raise_server_exceptions=True)
    app.dependency_overrides.pop(get_current_staff, None)
    app.dependency_overrides.pop(database_factory.get_db_session, None)


def test_clients_follow_the_wm_list_with_the_rest_slotted_in_by_date(api):
    got = api.get('/api/clients/', params={'limit': 1000})
    assert got.status_code == 200, got.text
    assert [c['display_name'] for c in got.json()['clients']] == [
        'Edited',      # 11/05 updated
        'Newest WM',   # 11/03 WM job
        'Two WM',      # 11/02 WM job
        'Older WM',    # 11/01 WM job
        'Untouched',   # 10/20 created
        'Closed WM',   # 10/15 claim changed
    ]


def test_each_row_says_which_wm_job_date_placed_it(api):
    rows = {c['display_name']: c for c in api.get('/api/clients/').json()['clients']}
    assert rows['Two WM']['wm_job_created_at'].startswith('2026-11-02')
    assert rows['Older WM']['wm_job_created_at'].startswith('2026-11-01')
    assert rows['Closed WM']['wm_job_created_at'] is None
    assert rows['Edited']['wm_job_created_at'] is None
