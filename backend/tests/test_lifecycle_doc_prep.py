"""The claims dashboard's Doc prep list: WM jobs whose documents haven't gone
to the adjuster, supplement estimates to write and depreciation packets to put
together, on a throwaway SQLite database."""

from datetime import datetime
from pathlib import Path
import sys

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory
from app.core.database_factory import Base, SQLiteDatabase
from app.domains.claim_followup.lifecycle_api import get_doc_prep
from app.domains.claim_followup.models import FollowUpTask
from app.domains.client.models import Claim, ClaimActivity, Client
from app.domains.water_mitigation.models import WaterMitigationJob
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401

TABLES = [Client, Claim, ClaimActivity, FollowUpTask, WaterMitigationJob]


@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(type_, compiler, **kw):
    return 'JSON'


@pytest.fixture
def database(tmp_path, monkeypatch):
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    # Only the tables this list reads; the rest use Postgres-only types,
    # so foreign keys pointing at them can't be checked
    sa.event.listen(
        database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF')
    )
    Base.metadata.create_all(database.engine, tables=[m.__table__ for m in TABLES])
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)
    return database


def test_doc_prep_lists_three_kinds_oldest_first(database):
    session = database.get_session()
    client = Client(display_name='Pat Client', owners=[], address='12 Oak St')
    session.add(client)
    session.flush()
    claim = Claim(client_id=client.id, claim_number='C-100', insurance_company='Acme Mutual',
                  status='open')
    session.add(claim)
    session.flush()

    def job(status, created, active=True):
        j = WaterMitigationJob(property_address=f'{status} house', status=status,
                               active=active, created_at=created)
        session.add(j)
        return j

    def task(task_type, status='pending', phase=None, created=datetime(2026, 9, 1)):
        t = FollowUpTask(claim_id=claim.id, task_type=task_type, title=task_type,
                         status=status, depreciation_phase=phase, created_at=created)
        session.add(t)
        return t

    lead = job('Lead', datetime(2026, 9, 10))
    prepping = job('Doc prepping', datetime(2026, 8, 1))
    job('Sent to adjuster', datetime(2026, 7, 1))
    job('Lead', datetime(2026, 7, 1), active=False)

    supp = task('supplement_estimate_prep', created=datetime(2026, 9, 5))
    task('supplement_estimate_prep', status='resolved')
    task('supplement_sent')
    task('depreciation_recovery', phase='in_construction')
    task('depreciation_recovery', status='awaiting_response', phase='docs_sent_insurance')
    # Started long ago, but construction only finished on Oct 1
    dep = task('depreciation_recovery', phase='preparing_docs', created=datetime(2026, 6, 1))
    session.flush()
    session.add(ClaimActivity(claim_id=claim.id, activity_type='depreciation_phase_changed',
                              title='Depreciation: Construction Completed',
                              related_entity_type='followup_task', related_entity_id=dep.id,
                              created_at=datetime(2026, 9, 20)))
    session.add(ClaimActivity(claim_id=claim.id, activity_type='depreciation_phase_changed',
                              title='Depreciation: Preparing Documents',
                              related_entity_type='followup_task', related_entity_id=dep.id,
                              created_at=datetime(2026, 10, 1)))
    # Construction done, but the phase was set without an activity: falls back to creation
    undated_dep = task('depreciation_recovery', phase='construction_done',
                       created=datetime(2026, 9, 7))
    session.commit()
    ids = {
        'lead': f'wm:{lead.id}', 'prepping': f'wm:{prepping.id}',
        'supp': f'task:{supp.id}', 'dep': f'task:{dep.id}', 'undated_dep': f'task:{undated_dep.id}',
    }
    session.close()

    items = get_doc_prep()

    assert [i['id'] for i in items] == [
        ids['prepping'], ids['supp'], ids['undated_dep'], ids['lead'], ids['dep'],
    ]
    by_id = {i['id']: i for i in items}
    assert by_id[ids['prepping']]['kind'] == 'wm_docs'
    assert by_id[ids['supp']]['kind'] == 'supplement_estimate'
    assert by_id[ids['dep']]['kind'] == 'depreciation_docs'
    assert by_id[ids['dep']]['since'].startswith('2026-10-01')
    # Task rows carry the claim's address, homeowner and number
    assert by_id[ids['supp']]['property_address'] == '12 Oak St'
    assert by_id[ids['supp']]['homeowner_name'] == 'Pat Client'
    assert by_id[ids['supp']]['claim_number'] == 'C-100'
