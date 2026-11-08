"""The follow-up task lists carry how the claim's rebuild estimate comes to be
(who writes it, the companies that did the WM) to the browser: the Resolve
form's writer picker and the claim progress read them. Through the real
routes, so the response schema can't drop them. On a throwaway SQLite
database."""

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
from app.domains.claim_followup.models import FollowUpTask  # noqa: E402
from app.domains.client.models import Claim, Client  # noqa: E402
from app.domains.company.models import Company  # noqa: E402
from app.domains.contract.models import ClaimCompany  # noqa: E402
from app.domains.staff.models import StaffRole  # noqa: E402
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


@pytest.fixture
def env(tmp_path, monkeypatch):
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
    # The list enriches from many tables; a few use types SQLite can't make
    # and nothing here touches those
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

    yield TestClient(app, raise_server_exceptions=True), database
    app.dependency_overrides.pop(get_current_staff, None)
    app.dependency_overrides.pop(database_factory.get_db_session, None)


def _claim_with_tasks(database, **claim_fields):
    """A claim whose WM was done by Dry Out Co (a WM job) and Flood Fix (the
    water_mitigation role), with one follow-up task. Returns ids."""
    session = database.get_session()
    dry_out = Company(name='Dry Out Co')
    flood_fix = Company(name='Flood Fix')
    build_right = Company(name='Build Right')
    for company in (dry_out, flood_fix, build_right):
        session.add(company)
    pat = Client(display_name='Pat Client', owners=[])
    session.add(pat)
    session.flush()
    fields = {key: (build_right.id if value == 'Build Right' else value)
              for key, value in claim_fields.items()}
    claim = Claim(client_id=pat.id, claim_number='CLM-77', status='negotiating', **fields)
    session.add(claim)
    session.flush()
    session.add(WaterMitigationJob(property_address='12 Elm St', status='Follow up',
                                   claim_id=str(claim.id), company_id=dry_out.id, active=True))
    session.add(ClaimCompany(claim_id=claim.id, company_id=flood_fix.id, role='water_mitigation'))
    task = FollowUpTask(claim_id=claim.id, task_type='insurance_estimate_pending',
                        title='Waiting for the estimate', status='pending',
                        followup_interval_days=3, contact_count=0)
    session.add(task)
    session.commit()
    ids = {
        'claim': str(claim.id), 'task': str(task.id), 'build_right': str(build_right.id),
        'wm_companies': sorted([str(dry_out.id), str(flood_fix.id)]),
    }
    session.close()
    return ids


def _both_lists(api, ids):
    by_claim = api.get(f"/api/claim-followup/tasks/by-claim/{ids['claim']}")
    listed = api.get('/api/claim-followup/tasks', params={'claim_id': ids['claim']})
    assert by_claim.status_code == 200, by_claim.text
    assert listed.status_code == 200, listed.text
    return {'by-claim': by_claim.json()[0], 'list': listed.json()[0]}


def test_both_task_lists_carry_who_writes_the_rebuild_estimate(env):
    api, database = env
    ids = _claim_with_tasks(
        database,
        estimate_origin='contractor_prepared',
        contractor_estimate_stage='awaiting_approval',
        rebuild_estimate_company_id='Build Right',
        wm_cost_status='paid_per_invoice',
    )

    for name, row in _both_lists(api, ids).items():
        assert row['estimate_origin'] == 'contractor_prepared', name
        assert row['contractor_estimate_stage'] == 'awaiting_approval', name
        assert row['rebuild_estimate_company_id'] == ids['build_right'], name
        assert row['rebuild_estimate_company_name'] == 'Build Right', name
        # The Resolve form keeps these out of the writer picker
        assert row['wm_company_ids'] == ids['wm_companies'], name
        assert row['wm_cost_status'] == 'paid_per_invoice', name


def test_a_claim_with_nothing_chosen_yet_says_so(env):
    api, database = env
    ids = _claim_with_tasks(database)

    for name, row in _both_lists(api, ids).items():
        assert row['estimate_origin'] == '', name
        assert row['contractor_estimate_stage'] == '', name
        assert row['rebuild_estimate_company_id'] is None, name
        assert row['rebuild_estimate_company_name'] is None, name
        # Still known: the picker has to leave them out whenever it opens
        assert row['wm_company_ids'] == ids['wm_companies'], name
