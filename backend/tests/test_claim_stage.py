"""A claim's lifecycle stage, worked out from its records, and the client list
showing the claim still being worked. The rules run on plain facts; the list,
claim rows and edits run on a throwaway SQLite database."""

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
from app.domains.client.claim_stage import StageFacts, claim_stage, derive_stage  # noqa: E402
from app.domains.client.models import Claim, ClaimPayment, Client  # noqa: E402
from app.domains.staff.models import StaffRole  # noqa: E402
from app.domains.supplement.models import BidItemEstimate, SupplementRequest  # noqa: E402
from app.domains.water_mitigation.models import WaterMitigationJob  # noqa: E402
from app.main import app  # noqa: E402


def claim(**fields):
    return {'status': 'open', 'claim_type': 'insurance', **fields}


def task(task_type, status='pending', phase=None, payment=None):
    return (task_type, status, phase, payment)


def stage(claim_fields=None, **facts):
    return derive_stage(claim(**(claim_fields or {})), StageFacts(**facts))


# ── Before the carrier's first estimate ──

def test_wm_job_status_sets_the_early_stages():
    assert stage(wm_statuses=['Lead']) == ('mitigation', 'Lead')
    assert stage(wm_statuses=['Doc prepping']) == ('wm_docs', 'Preparing WM docs')
    assert stage(wm_statuses=['Sent to adjuster']) == ('awaiting_estimate', 'WM docs sent')
    # The job furthest behind holds the claim back
    assert stage(wm_statuses=['Sent to adjuster', 'Lead'])[0] == 'mitigation'
    # A WM docs follow-up out with the adjuster means the docs went
    assert stage(wm_statuses=['Lead'], tasks=[task('wm_docs_sent', 'awaiting_response')])[0] == 'awaiting_estimate'
    assert stage() == ('awaiting_estimate', '')


def test_the_contractor_prepared_path_waits_on_our_estimate():
    fields = {'estimate_origin': 'contractor_prepared', 'contractor_estimate_stage': 'requested'}
    assert stage(fields) == ('awaiting_estimate', 'We write the estimate')
    fields['contractor_estimate_stage'] = 'awaiting_approval'
    assert stage(fields) == ('awaiting_estimate', 'Our estimate awaiting approval')
    # Approved: the claim has its first estimate
    fields['contractor_estimate_stage'] = 'approved_initial_received'
    assert stage(fields)[0] == 'supplement_prep'


# ── Supplement ──

def test_supplement_records_move_prep_to_follow_up_to_construction():
    estimate = {'insurance_estimate_received': True}
    assert stage(estimate) == ('supplement_prep', 'No supplement yet')
    assert stage(estimate, supplements={'s1': ('identified', 'supplement')})[0] == 'supplement_prep'
    assert stage(estimate, supplements={'s1': ('submitted', 'supplement')})[0] == 'supplement_followup'
    # Every bid item went to the PA: the supplement is out even if not marked submitted
    assert stage(estimate, supplements={'s1': ('in_progress', 'supplement')},
                 bids={'s1': ['sent', 'approved']})[0] == 'supplement_followup'
    assert stage(estimate, supplements={'s1': ('in_progress', 'supplement')},
                 bids={'s1': ['sent', 'draft']})[0] == 'supplement_prep'
    # Our own writing comes first when another supplement is already out
    assert stage(estimate, supplements={'s1': ('submitted', 'supplement'),
                                        's2': ('identified', 'supplement')})[0] == 'supplement_prep'
    assert stage(estimate, supplements={'s1': ('approved', 'supplement')}) == ('construction', 'Not started')
    assert stage({**estimate, 'construction_started_at': datetime(2026, 9, 1)},
                 supplements={'s1': ('approved', 'supplement')}) == ('construction', 'In progress')
    # A final carrier revision ends negotiation without supplement records
    assert stage(estimate, revision_types={'initial', 'final'})[0] == 'construction'


def test_supplement_follow_up_tasks_count_too():
    estimate = {'current_rcv': 1000}
    assert stage(estimate, tasks=[task('supplement_estimate_prep')])[0] == 'supplement_prep'
    assert stage(estimate, tasks=[task('supplement_sent', 'awaiting_response')])[0] == 'supplement_followup'


# ── Appraisal ──

def test_appraisal_runs_its_own_estimate_and_follow_up():
    appraisal = {'status': 'appraisal'}
    assert stage(appraisal) == ('appraisal_prep', 'Writing contractor estimate')
    assert stage(appraisal, tasks=[task('appraisal', 'awaiting_response')])[0] == 'appraisal_followup'
    assert stage(appraisal, revision_types={'initial', 'appraisal'})[0] == 'construction'
    # A denied claim taken to appraisal stays 'open' with an open appraisal task
    assert stage(tasks=[task('appraisal')])[0] == 'appraisal_prep'


# ── After construction ──

def test_finishing_construction_opens_depreciation_then_settlement():
    done = {'insurance_estimate_received': True, 'construction_completed_at': datetime(2026, 10, 1)}
    assert stage(done, supplements={'s1': ('approved', 'supplement')}) == (
        'depreciation', 'Prepare depreciation docs')
    # No supplement ever started: nothing holds the file back
    assert stage(done) == ('depreciation', 'Prepare depreciation docs')
    assert stage(done, tasks=[task('depreciation_recovery', 'awaiting_response', 'docs_sent_pa')]) == (
        'depreciation', 'Docs sent to PA')
    # Finished without the estimate on file: construction only starts once it came
    assert stage({'construction_completed_at': datetime(2026, 10, 1)})[0] == 'depreciation'
    assert stage(done, depreciation_paid=True) == ('settlement', 'Depreciation paid')
    assert stage({**done, 'payment_status': 'paid'}) == ('settlement', 'Paid in full')


def test_a_rebuild_that_finishes_first_waits_on_the_paperwork():
    done = {'insurance_estimate_received': True, 'construction_completed_at': datetime(2026, 10, 1)}
    info = claim_stage(claim(**done), StageFacts(supplements={'s1': ('submitted', 'supplement')}))
    assert (info['stage'], info['construction']) == ('supplement_followup', 'done')
    assert stage(done, supplements={'s1': ('identified', 'supplement')})[0] == 'supplement_prep'
    assert stage(done, tasks=[task('supplement_estimate_prep')])[0] == 'supplement_prep'
    # Appraisal not decided yet
    appraisal = {**done, 'status': 'appraisal'}
    assert stage(appraisal, tasks=[task('appraisal', 'awaiting_response')])[0] == 'appraisal_followup'
    assert stage(appraisal, revision_types={'initial', 'appraisal'})[0] == 'depreciation'
    # The depreciation file went out anyway (allowed during appraisal)
    assert stage(appraisal, tasks=[
        task('appraisal', 'awaiting_response'),
        task('depreciation_recovery', 'awaiting_response', 'docs_sent_insurance'),
    ]) == ('depreciation', 'Docs sent to carrier')


def test_the_depreciation_task_phase_tracks_construction_without_dates():
    estimate = {'insurance_estimate_received': True}
    building = StageFacts(supplements={'s1': ('submitted', 'supplement')},
                          tasks=[task('depreciation_recovery', 'pending', 'in_construction')])
    info = claim_stage(claim(**estimate), building)
    assert (info['stage'], info['construction']) == ('supplement_followup', 'in_progress')

    built = StageFacts(tasks=[task('depreciation_recovery', 'pending', 'preparing_docs')])
    info = claim_stage(claim(**estimate), built)
    assert (info['stage'], info['construction']) == ('depreciation', 'done')

    paid = StageFacts(tasks=[task('depreciation_recovery', 'resolved', 'payment_received', 'received')])
    assert claim_stage(claim(**estimate), paid)['stage'] == 'settlement'


# ── Status and override ──

def test_closed_denied_and_cash_jobs_keep_their_status():
    assert stage({'status': 'closed'}, wm_statuses=['Lead']) == ('closed', '')
    assert stage({'status': 'denied'}) == ('denied', '')
    assert stage({'claim_type': 'cash'}) == ('open', '')
    assert stage({'claim_type': 'cash', 'status': 'closed'}) == ('closed', '')


def test_a_stage_set_by_hand_holds_until_the_records_pass_it():
    facts = StageFacts(wm_statuses=['Lead'])
    info = claim_stage(claim(stage_override='supplement_prep'), facts)
    assert (info['stage'], info['stage_source'], info['auto_stage']) == (
        'supplement_prep', 'manual', 'mitigation')

    # The records caught up and moved past it
    later = StageFacts(supplements={'s1': ('submitted', 'supplement')})
    info = claim_stage(claim(stage_override='supplement_prep', current_rcv=500), later)
    assert (info['stage'], info['stage_source']) == ('supplement_followup', 'auto')

    # Never over a closed claim, and never on a cash job
    assert claim_stage(claim(status='closed', stage_override='depreciation'), facts)['stage'] == 'closed'
    assert claim_stage(claim(claim_type='cash', stage_override='depreciation'), facts)['stage'] == 'open'


# ── The client list and claim rows ──

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
    # Every table; the client page counts documents of many kinds. A few use
    # types SQLite can't make; nothing here touches those.
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


def test_the_list_shows_the_newest_claim_still_being_worked(env):
    api, database = env
    session = database.get_session()
    pat = Client(display_name='Pat Client', owners=[])
    session.add(pat)
    session.flush()
    working = Claim(client_id=pat.id, claim_number='C-1', status='negotiating',
                    insurance_estimate_received=True, created_at=datetime(2026, 1, 1))
    finished = Claim(client_id=pat.id, claim_number='C-2', status='closed',
                     created_at=datetime(2026, 5, 1))
    session.add(working)
    session.add(finished)
    session.flush()
    supp = SupplementRequest(claim_id=working.id, title='Kitchen', status='in_progress')
    session.add(supp)
    session.flush()
    session.add(BidItemEstimate(supplement_id=supp.id, estimate_type='cabinet', status='sent'))
    session.add(FollowUpTask(claim_id=working.id, task_type='depreciation_recovery',
                             title='Depreciation', depreciation_phase='in_construction'))
    session.add(WaterMitigationJob(property_address='12 Oak St', status='Complete',
                                   claim_id=working.id))
    session.commit()
    pat_id, working_id, supp_id = str(pat.id), str(working.id), supp.id
    session.close()

    row = api.get('/api/clients/').json()['clients'][0]
    assert row['latest_claim_status'] == 'negotiating'
    assert (row['claim_stage'], row['claim_stage_detail'], row['claim_construction']) == (
        'supplement_followup', 'Submitted, awaiting approval', 'in_progress')
    assert (row['claim_count'], row['active_claim_count']) == (2, 1)

    claims = {c['claim_number']: c for c in api.get(f'/api/clients/{pat_id}/claims').json()['claims']}
    assert claims['C-1']['stage'] == 'supplement_followup'
    assert claims['C-2']['stage'] == 'closed'
    detail = api.get(f'/api/clients/{pat_id}/claims/{working_id}').json()
    assert detail['stage'] == 'supplement_followup'

    # Construction finishes first: the supplement is still out, so it waits
    response = api.put(f'/api/clients/{pat_id}/claims/{working_id}',
                       json={'construction_completed_at': '2026-10-01'})
    assert response.status_code == 200, response.text
    row = api.get('/api/clients/').json()['clients'][0]
    assert (row['claim_stage'], row['claim_construction']) == ('supplement_followup', 'done')

    # The supplement is approved: on to depreciation
    session = database.get_session()
    session.query(SupplementRequest).filter(SupplementRequest.id == supp_id).one().status = 'approved'
    session.commit()
    session.close()
    row = api.get('/api/clients/').json()['clients'][0]
    assert (row['claim_stage'], row['claim_stage_detail']) == ('depreciation', 'Prepare depreciation docs')


def test_a_stage_set_by_hand_and_handed_back(env):
    api, database = env
    session = database.get_session()
    lee = Client(display_name='Lee Client', owners=[])
    session.add(lee)
    session.flush()
    only = Claim(client_id=lee.id, claim_number='C-9', status='open')
    session.add(only)
    session.flush()
    session.add(WaterMitigationJob(property_address='9 Elm St', status='Doc prepping', claim_id=only.id))
    session.commit()
    lee_id, claim_id = str(lee.id), str(only.id)
    session.close()

    path = f'/api/clients/{lee_id}/claims/{claim_id}'
    assert api.put(path, json={'stage_override': 'not_a_stage'}).status_code == 422
    assert api.put(path, json={'stage_override': 'awaiting_estimate'}).status_code == 200
    row = api.get('/api/clients/').json()['clients'][0]
    assert (row['claim_stage'], row['claim_stage_source']) == ('awaiting_estimate', 'manual')

    assert api.put(path, json={'stage_override': ''}).status_code == 200
    claim_row = api.get(f'/api/clients/{lee_id}/claims').json()['claims'][0]
    assert claim_row['stage_override'] is None
    assert (claim_row['stage'], claim_row['stage_source']) == ('wm_docs', 'auto')


def test_depreciation_paid_shows_settlement(env):
    api, database = env
    session = database.get_session()
    kim = Client(display_name='Kim Client', owners=[])
    session.add(kim)
    session.flush()
    paid = Claim(client_id=kim.id, claim_number='C-5', status='settled',
                 construction_completed_at=datetime(2026, 8, 1))
    session.add(paid)
    session.flush()
    session.add(ClaimPayment(claim_id=paid.id, payment_type='depreciation_recovery', amount=1200))
    session.commit()
    session.close()

    row = api.get('/api/clients/').json()['clients'][0]
    assert (row['claim_stage'], row['claim_stage_detail']) == ('settlement', 'Depreciation paid')
