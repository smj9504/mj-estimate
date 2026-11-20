"""Closing or denying a claim wraps up its linked work; reopening puts it back
(client/claim_closeout.py, 2026-11-20).

- the suggestions follow each item's state; construction under way, a
  supplement the carrier is reviewing and, on Closed, money still owed have
  none and must be picked;
- what is picked is saved with the claim, or nothing is;
- reopening offers to put back what the closeout changed, unticking what was
  changed by hand since;
- the follow-up Resolve's Denied + Close the claim does the same.

Run through the API on a throwaway SQLite database."""

from datetime import datetime
from pathlib import Path
import json
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
from app.domains.client import claim_closeout as cc  # noqa: E402
from app.domains.client.models import Claim, ClaimActivity, ClaimCloseout, Client  # noqa: E402
from app.domains.rebuild.models import RebuildProject  # noqa: E402
from app.domains.staff.models import Staff, StaffRole  # noqa: E402
from app.domains.supplement.models import SupplementRequest  # noqa: E402
from app.domains.water_mitigation.models import WaterMitigationJob, WMJobStatusHistory  # noqa: E402
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


# ── The suggestions, by state ─────────────────────────────────────────────

def test_rebuild_suggestions():
    assert cc.rebuild_choice('assigned', 'closed')['default'] == 'cancelled'
    assert cc.rebuild_choice('pending', 'denied')['default'] == 'cancelled'
    in_progress = cc.rebuild_choice('in_progress', 'closed')
    assert in_progress['default'] is None
    assert [o['value'] for o in in_progress['options']] == ['completed', 'cancelled', 'keep']
    assert cc.rebuild_choice('in_progress', 'denied')['default'] is None
    assert cc.rebuild_choice('invoiced', 'closed')['default'] == 'closed'
    assert cc.rebuild_choice('closed', 'closed') is None
    assert cc.rebuild_choice('cancelled', 'denied') is None


def test_supplement_suggestions():
    assert cc.supplement_choice('identified', 'closed')['default'] == 'withdrawn'
    assert cc.supplement_choice('in_progress', 'denied')['default'] == 'withdrawn'
    assert cc.supplement_choice('submitted', 'closed')['default'] is None
    assert cc.supplement_choice('under_review', 'denied')['default'] == 'denied'
    assert cc.supplement_choice('approved', 'closed') is None


def test_followup_suggestions():
    assert cc.task_choice('pending', 'supplement_estimate_prep', None, 'closed')['default'] == 'cancelled'
    owed = cc.task_choice('awaiting_confirmation', 'payment_check', 'issued', 'closed')
    assert owed['default'] is None
    assert [o['value'] for o in owed['options']] == ['received', 'cancelled', 'keep']
    assert cc.task_choice('pending', 'depreciation_recovery', None, 'denied')['default'] == 'cancelled'
    assert cc.task_choice('pending', 'wm_payment_check', 'received', 'closed')['default'] == 'resolved'
    assert cc.task_choice('resolved', 'general', None, 'closed') is None


def test_wm_job_stays_unless_picked():
    assert cc.wm_choice('Sent to adjuster', 'closed')['default'] == 'keep'
    assert cc.wm_choice('Sent to adjuster', 'denied')['default'] == 'keep'
    assert cc.wm_choice('Complete', 'closed') is None


# ── Through the API ───────────────────────────────────────────────────────

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
    admin = Staff(
        staff_number='S-A', first_name='Ada', last_name='Test', email='ada@example.com',
        username='ada', role=StaffRole.admin, hire_date=datetime(2026, 1, 1),
        is_active=True, can_login=True,
    )
    session.add(admin)
    client = Client(display_name='Pat Example', owners=[])
    session.add(client)
    session.flush()
    claim = Claim(client_id=client.id, claim_number='CLM-1', status='negotiating')
    session.add(claim)
    session.flush()

    rows = SimpleNamespace(
        rebuild_new=RebuildProject(claim_id=claim.id, title='Kitchen rebuild', status='assigned'),
        rebuild_busy=RebuildProject(claim_id=claim.id, title='Basement rebuild', status='in_progress'),
        supp_draft=SupplementRequest(claim_id=claim.id, title='Supplement 2', status='in_progress'),
        supp_sent=SupplementRequest(claim_id=claim.id, title='Supplement 1', status='submitted'),
        supp_done=SupplementRequest(claim_id=claim.id, title='Supplement 0', status='approved'),
        prep=FollowUpTask(claim_id=claim.id, task_type='supplement_estimate_prep',
                          title='Prepare supplement', status='pending'),
        pay=FollowUpTask(claim_id=claim.id, task_type='payment_check', title='Rebuild payment',
                         status='awaiting_confirmation', payment_status='issued'),
        docs=FollowUpTask(claim_id=claim.id, task_type='wm_docs_sent', title='WM docs',
                          status='awaiting_response'),
        old=FollowUpTask(claim_id=claim.id, task_type='general', title='Old call', status='resolved'),
        wm=WaterMitigationJob(claim_id=claim.id, property_address='1 Test Way, Testville',
                              status='Sent to adjuster', active=True),
    )
    for row in vars(rows).values():
        session.add(row)
    session.commit()
    ids = SimpleNamespace(client=str(client.id), claim=str(claim.id), admin=str(admin.id),
                          **{k: str(v.id) for k, v in vars(rows).items()})
    session.close()

    app.dependency_overrides[get_current_staff] = lambda: SimpleNamespace(
        id=ids.admin, role=StaffRole.admin, username='ada')

    def get_db():
        db = database.get_session()
        try:
            yield db
            db.commit()
        finally:
            db.close()
    app.dependency_overrides[database_factory.get_db_session] = get_db

    def status_of(model, row_id):
        db = database.get_session()
        try:
            return db.query(model).filter(model.id == row_id).first()
        finally:
            db.close()

    yield SimpleNamespace(api=TestClient(app, raise_server_exceptions=True), ids=ids,
                          get=status_of, database=database)
    app.dependency_overrides.clear()


def _url(env, tail=''):
    return f'/api/clients/{env.ids.client}/claims/{env.ids.claim}{tail}'


def _picks(env):
    i = env.ids
    return [
        {'kind': 'rebuild', 'id': i.rebuild_new, 'to': 'cancelled'},
        {'kind': 'rebuild', 'id': i.rebuild_busy, 'to': 'completed'},
        {'kind': 'supplement', 'id': i.supp_draft, 'to': 'withdrawn'},
        {'kind': 'supplement', 'id': i.supp_sent, 'to': 'approved'},
        {'kind': 'followup', 'id': i.prep, 'to': 'cancelled'},
        {'kind': 'followup', 'id': i.pay, 'to': 'received'},
        {'kind': 'followup', 'id': i.docs, 'to': 'cancelled'},
        {'kind': 'wm_job', 'id': i.wm, 'to': 'keep'},
    ]


def test_preview_lists_linked_work_with_suggestions(env):
    r = env.api.get(_url(env, '/closeout-preview'), params={'to': 'closed'})
    assert r.status_code == 200, r.text
    items = {i['id']: i for i in r.json()['items']}
    i = env.ids
    assert items[i.rebuild_new]['default'] == 'cancelled'
    assert items[i.rebuild_busy]['default'] is None
    assert items[i.supp_draft]['default'] == 'withdrawn'
    assert items[i.supp_sent]['default'] is None
    assert items[i.supp_done]['done'] is True
    assert items[i.prep]['default'] == 'cancelled'
    assert items[i.pay]['default'] is None
    assert items[i.old]['done'] is True
    assert items[i.wm]['default'] == 'keep'
    assert env.api.get(_url(env, '/closeout-preview'), params={'to': 'open'}).status_code == 400


def test_closing_without_a_must_pick_saves_nothing(env):
    picks = [p for p in _picks(env) if p['id'] != env.ids.rebuild_busy]
    r = env.api.put(_url(env), json={'status': 'closed', 'closeout_items': picks})
    assert r.status_code == 400
    assert 'Basement rebuild' in r.json()['detail']
    assert env.get(Claim, env.ids.claim).status == 'negotiating'
    assert env.get(RebuildProject, env.ids.rebuild_new).status == 'assigned'


def test_close_then_reopen(env):
    i = env.ids
    r = env.api.put(_url(env), json={'status': 'closed', 'closeout_items': _picks(env)})
    assert r.status_code == 200, r.text
    assert env.get(Claim, i.claim).status == 'closed'
    assert env.get(RebuildProject, i.rebuild_new).status == 'cancelled'
    busy = env.get(RebuildProject, i.rebuild_busy)
    assert busy.status == 'completed' and busy.actual_completion is not None
    assert env.get(SupplementRequest, i.supp_draft).status == 'withdrawn'
    assert env.get(SupplementRequest, i.supp_sent).status == 'approved'
    assert env.get(SupplementRequest, i.supp_done).status == 'approved'
    assert env.get(FollowUpTask, i.prep).status == 'cancelled'
    pay = env.get(FollowUpTask, i.pay)
    assert pay.status == 'resolved' and pay.payment_status == 'received'
    assert env.get(FollowUpTask, i.old).status == 'resolved'
    assert env.get(WaterMitigationJob, i.wm).status == 'Sent to adjuster'

    db = env.database.get_session()
    record = db.query(ClaimCloseout).filter(ClaimCloseout.claim_id == i.claim).one()
    assert record.from_status == 'negotiating' and record.to_status == 'closed'
    assert {c['id'] for c in record.items} == {
        i.rebuild_new, i.rebuild_busy, i.supp_draft, i.supp_sent, i.prep, i.pay, i.docs}
    assert db.query(ClaimActivity).filter(
        ClaimActivity.claim_id == i.claim,
        ClaimActivity.title == 'Claim closed: linked work wrapped up',
    ).count() == 1
    # Someone reopens a supplement by hand while the claim is closed
    db.query(SupplementRequest).filter(SupplementRequest.id == i.supp_draft).update({'status': 'identified'})
    db.commit()
    db.close()

    preview = env.api.get(_url(env, '/reopen-preview')).json()
    items = {x['id']: x for x in preview['items']}
    assert preview['to_status'] == 'closed'
    assert items[i.rebuild_busy]['before_status'] == 'in_progress'
    assert items[i.rebuild_busy]['default'] is True
    assert items[i.supp_draft]['changed_since'] is True
    assert items[i.supp_draft]['default'] is False

    keys = [{'kind': x['kind'], 'id': x['id']} for x in preview['items'] if x['default']]
    r = env.api.put(_url(env), json={'status': 'negotiating', 'reopen_items': keys})
    assert r.status_code == 200, r.text
    assert env.get(RebuildProject, i.rebuild_new).status == 'assigned'
    busy = env.get(RebuildProject, i.rebuild_busy)
    assert busy.status == 'in_progress' and busy.actual_completion is None
    assert env.get(SupplementRequest, i.supp_draft).status == 'identified'  # left as set by hand
    assert env.get(SupplementRequest, i.supp_sent).status == 'submitted'
    pay = env.get(FollowUpTask, i.pay)
    assert pay.status == 'awaiting_confirmation' and pay.payment_status == 'issued'
    assert pay.resolved_at is None
    assert env.get(FollowUpTask, i.docs).status == 'awaiting_response'
    # The record is used up
    assert env.api.get(_url(env, '/reopen-preview')).json()['items'] == []


def test_closing_without_picks_leaves_linked_work(env):
    r = env.api.put(_url(env), json={'status': 'closed'})
    assert r.status_code == 200, r.text
    assert env.get(Claim, env.ids.claim).status == 'closed'
    assert env.get(RebuildProject, env.ids.rebuild_new).status == 'assigned'
    assert env.api.get(_url(env, '/reopen-preview')).json()['items'] == []
    # And opening it again with nothing to put back is fine
    assert env.api.put(_url(env), json={'status': 'open'}).status_code == 200


def test_wm_job_completed_through_its_own_path(env):
    i = env.ids
    picks = [p if p['id'] != i.wm else {**p, 'to': 'Complete'} for p in _picks(env)]
    picks = [p if p['id'] != i.docs else {**p, 'to': 'keep'} for p in picks]
    r = env.api.put(_url(env), json={'status': 'closed', 'closeout_items': picks})
    assert r.status_code == 200, r.text
    assert env.get(WaterMitigationJob, i.wm).status == 'Complete'
    # The WM page's rule: a Complete job leaves its docs follow-up nothing to chase
    assert env.get(FollowUpTask, i.docs).status == 'resolved'
    db = env.database.get_session()
    assert db.query(WMJobStatusHistory).filter(WMJobStatusHistory.job_id == i.wm).count() == 1
    db.close()

    keys = [{'kind': 'wm_job', 'id': i.wm}]
    assert env.api.put(_url(env), json={'status': 'open', 'reopen_items': keys}).status_code == 200
    assert env.get(WaterMitigationJob, i.wm).status == 'Sent to adjuster'
    db = env.database.get_session()
    assert db.query(WMJobStatusHistory).filter(WMJobStatusHistory.job_id == i.wm).count() == 2
    # Going back to Sent to adjuster doesn't make another docs follow-up
    assert db.query(FollowUpTask).filter(
        FollowUpTask.claim_id == i.claim, FollowUpTask.task_type == 'wm_docs_sent').count() == 1
    db.close()


def test_a_bad_value_is_refused(env):
    picks = [p if p['id'] != env.ids.rebuild_new else {**p, 'to': 'completed'} for p in _picks(env)]
    r = env.api.put(_url(env), json={'status': 'closed', 'closeout_items': picks})
    assert r.status_code == 400
    assert env.get(Claim, env.ids.claim).status == 'negotiating'


def test_claim_update_checks_the_status():
    from pydantic import ValidationError
    from app.domains.client.schemas import ClaimUpdate
    with pytest.raises(ValidationError):
        ClaimUpdate(status='bogus')
    assert ClaimUpdate(status='closed').status == 'closed'


def test_followup_denied_closes_the_claim_with_picks(env):
    i = env.ids
    r = env.api.get(f'/api/claim-followup/tasks/{i.docs}/closeout-preview', params={'to': 'denied'})
    assert r.status_code == 200, r.text
    items = {x['id']: x for x in r.json()['items']}
    assert i.docs not in items  # the task being resolved isn't listed
    assert items[i.supp_sent]['default'] == 'denied'
    assert items[i.pay]['default'] == 'cancelled'
    assert items[i.rebuild_busy]['default'] is None

    picks = [
        {'kind': x['kind'], 'id': x['id'], 'to': x['default'] or 'cancelled'}
        for x in items.values() if not x['done']
    ]
    r = env.api.post(f'/api/claim-followup/tasks/{i.docs}/resolve', data={
        'outcome': 'denied', 'denied_action': 'complete',
        'closeout_items': json.dumps(picks),
    })
    assert r.status_code == 200, r.text
    assert env.get(Claim, i.claim).status == 'denied'
    assert env.get(FollowUpTask, i.docs).status == 'resolved'
    assert env.get(SupplementRequest, i.supp_sent).status == 'denied'
    assert env.get(RebuildProject, i.rebuild_busy).status == 'cancelled'
    assert env.get(FollowUpTask, i.pay).status == 'cancelled'
    assert env.get(WaterMitigationJob, i.wm).status == 'Sent to adjuster'


def test_followup_denied_without_a_must_pick_is_refused(env):
    i = env.ids
    r = env.api.post(f'/api/claim-followup/tasks/{i.docs}/resolve', data={
        'outcome': 'denied', 'denied_action': 'complete',
        'closeout_items': json.dumps([]),
    })
    assert r.status_code == 400
    assert env.get(Claim, i.claim).status == 'negotiating'
    assert env.get(FollowUpTask, i.docs).status == 'awaiting_response'
