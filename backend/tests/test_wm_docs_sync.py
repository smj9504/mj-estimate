"""A WM job and its WM docs follow-up move together: the follow-up resolves
once the job is paying or done, and resolving the follow-up moves the job to
the status picked in the Resolve form. On a throwaway SQLite database."""

from datetime import datetime
from pathlib import Path
import sys

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.sqlite import base as sqlite_base
from sqlalchemy.ext.compiler import compiles

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory  # noqa: E402
from app.core.database_factory import Base, SQLiteDatabase  # noqa: E402
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401
from app.domains.claim_followup.models import FollowUpTask  # noqa: E402
from app.domains.claim_followup.repository import FollowUpTaskRepository  # noqa: E402
from app.domains.claim_followup.service import ClaimFollowUpService  # noqa: E402
from app.domains.client.models import Claim, ClaimActivity, Client  # noqa: E402
from app.domains.water_mitigation.models import WaterMitigationJob, WMJobStatusHistory  # noqa: E402
from app.domains.water_mitigation.schemas import JobStatusUpdate  # noqa: E402
from app.domains.water_mitigation.service import WaterMitigationService  # noqa: E402

TABLES = [Client, Claim, ClaimActivity, WaterMitigationJob, WMJobStatusHistory, FollowUpTask]


@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(type_, compiler, **kw):
    return 'JSON'


def _accept_iso_strings(monkeypatch):
    """Repositories write dates as ISO strings, which Postgres takes and
    SQLite's DateTime refuses; parse them as Postgres would"""
    real = sqlite_base.DATETIME.bind_processor

    def bind_processor(self, dialect):
        process = real(self, dialect)

        def parse_then_process(value):
            if isinstance(value, str):
                value = datetime.fromisoformat(value.replace('Z', '+00:00'))
            return process(value)
        return parse_then_process
    monkeypatch.setattr(sqlite_base.DATETIME, 'bind_processor', bind_processor)


@pytest.fixture
def env(tmp_path, monkeypatch):
    _accept_iso_strings(monkeypatch)
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    sa.event.listen(
        database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF')
    )
    Base.metadata.create_all(database.engine, tables=[m.__table__ for m in TABLES])
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)

    session = database.get_session()
    client = Client(display_name='Pat Client', owners=[])
    session.add(client)
    session.flush()
    claim = Claim(client_id=client.id, claim_number='CLM-77', status='negotiating')
    other_claim = Claim(client_id=client.id, claim_number='CLM-88', status='negotiating')
    session.add(claim)
    session.add(other_claim)
    session.flush()

    def add_job(status='Follow up', claim_row=claim):
        job = WaterMitigationJob(
            property_address='12 Elm St', claim_id=str(claim_row.id), status=status, active=True,
        )
        session.add(job)
        session.commit()
        return job

    def add_task(job=None, status='awaiting_response', claim_row=claim, task_type='wm_docs_sent'):
        task = FollowUpTask(
            claim_id=str(claim_row.id),
            wm_job_id=str(job.id) if job else None,
            task_type=task_type,
            title='WM Follow up - Docs sent to adjuster',
            status=status,
            followup_interval_days=3,
            contact_count=1,
        )
        session.add(task)
        session.commit()
        return task

    def set_status(job, status):
        WaterMitigationService(session).update_job_status(job.id, JobStatusUpdate(status=status))
        session.commit()

    def reload(row):
        # Other services write through their own sessions
        session._session.expire_all()
        return session.query(type(row)).filter_by(id=row.id).first()

    yield {
        'database': database, 'session': session, 'claim': claim, 'other_claim': other_claim,
        'add_job': add_job, 'add_task': add_task, 'set_status': set_status, 'reload': reload,
    }
    session.close()


# ── The WM job moves, the follow-up follows ──

@pytest.mark.parametrize('status', ['Payment on the way', 'Check received', 'Complete'])
def test_a_paying_or_done_job_resolves_its_docs_followup(env, status):
    job = env['add_job']()
    task = env['add_task'](job)

    env['set_status'](job, status)

    task = env['reload'](task)
    assert task.status == 'resolved'
    assert task.resolved_at is not None
    assert task.resolution_notes == f'Resolved: the WM job moved to {status}.'


@pytest.mark.parametrize('status', ['Insurance reviewing', 'Paperwork received', 'Estimate requested'])
def test_a_job_still_short_of_payment_leaves_it_open(env, status):
    job = env['add_job']()
    task = env['add_task'](job)

    env['set_status'](job, status)

    assert env['reload'](task).status == 'awaiting_response'


def test_only_that_jobs_open_docs_followup_is_touched(env):
    job = env['add_job']()
    other_job = env['add_job'](claim_row=env['other_claim'])
    own = env['add_task'](job)
    cancelled = env['add_task'](job, status='cancelled')
    other_type = env['add_task'](job, task_type='wm_payment_check')
    other_claims = env['add_task'](other_job, claim_row=env['other_claim'])

    env['set_status'](job, 'Check received')

    assert env['reload'](own).status == 'resolved'
    assert env['reload'](cancelled).status == 'cancelled'
    assert env['reload'](other_type).status == 'awaiting_response'
    assert env['reload'](other_claims).status == 'awaiting_response'


def test_one_added_by_hand_waits_for_every_wm_job_on_the_claim(env):
    first = env['add_job']()
    second = env['add_job']()
    by_hand = env['add_task']()  # no job link

    env['set_status'](first, 'Check received')
    assert env['reload'](by_hand).status == 'awaiting_response'

    env['set_status'](second, 'Payment on the way')
    assert env['reload'](by_hand).status == 'resolved'


def test_a_resolution_note_already_there_is_kept(env):
    job = env['add_job']()
    task = env['add_task'](job)
    task.resolution_notes = 'Adjuster said the check is cut.'
    env['session'].commit()

    env['set_status'](job, 'Payment on the way')

    assert env['reload'](task).resolution_notes == (
        'Adjuster said the check is cut.\nResolved: the WM job moved to Payment on the way.'
    )


# ── The follow-up resolves, the WM job follows ──

def _service(env):
    return ClaimFollowUpService(env['database'])


def test_resolving_moves_the_job_to_the_picked_status(env):
    job = env['add_job']()
    task = env['add_task'](job)

    _service(env).resolve_task(str(task.id), wm_job_status='Check received')

    assert env['reload'](job).status == 'Check received'
    assert env['reload'](task).status == 'resolved'
    # Its own resolve note, not the one the WM side adds when it resolves it
    assert env['reload'](task).resolution_notes is None
    history = env['session'].query(WMJobStatusHistory).filter_by(job_id=job.id).all()
    assert [(h.previous_status, h.new_status) for h in history] == [('Follow up', 'Check received')]


def test_keep_leaves_the_job_where_it_is(env):
    job = env['add_job']()
    task = env['add_task'](job)

    _service(env).resolve_task(str(task.id), wm_job_status='keep')

    assert env['reload'](job).status == 'Follow up'
    assert env['reload'](task).status == 'resolved'


def test_a_picked_status_replaces_the_outcomes_paperwork_received(env):
    job = env['add_job']()
    task = env['add_task'](job)

    _service(env).resolve_task(str(task.id), outcome='wm_estimate_only', wm_job_status='keep')

    assert env['reload'](job).status == 'Follow up'


def test_without_a_picked_status_the_outcome_still_moves_it(env):
    job = env['add_job']()
    task = env['add_task'](job)

    _service(env).resolve_task(str(task.id), outcome='wm_estimate_only')

    assert env['reload'](job).status == 'Paperwork received'


def test_one_added_by_hand_moves_the_claims_active_jobs(env):
    first = env['add_job']()
    second = env['add_job'](status='Insurance reviewing')
    by_hand = env['add_task']()

    _service(env).resolve_task(str(by_hand.id), wm_job_status='Payment on the way')

    assert env['reload'](first).status == 'Payment on the way'
    assert env['reload'](second).status == 'Payment on the way'


def test_a_status_the_form_doesnt_offer_is_refused(env):
    job = env['add_job']()
    task = env['add_task'](job)

    with pytest.raises(ValueError):
        _service(env).resolve_task(str(task.id), wm_job_status='Sent to adjuster')

    assert env['reload'](task).status == 'awaiting_response'
    assert env['reload'](job).status == 'Follow up'


def test_other_followups_ignore_a_picked_status(env):
    job = env['add_job']()
    payment = env['add_task'](job, task_type='wm_payment_check')

    _service(env).resolve_task(str(payment.id), wm_job_status='Complete')

    assert env['reload'](job).status == 'Follow up'


# ── The Resolve form sees the job's status ──

def test_a_docs_followup_carries_its_jobs_status(env):
    job = env['add_job'](status='Insurance reviewing')
    linked = env['add_task'](job)
    by_hand = env['add_task']()
    payment = env['add_task'](job, task_type='wm_payment_check')
    env['add_job'](status='Check received')  # a second job, further along

    rows = FollowUpTaskRepository(env['session']).get_tasks_by_claim(str(env['claim'].id))
    by_id = {r['id']: r for r in rows}

    assert by_id[str(linked.id)]['wm_job_status'] == 'Insurance reviewing'
    # By hand: the claim's job furthest behind
    assert by_id[str(by_hand.id)]['wm_job_status'] == 'Insurance reviewing'
    assert 'wm_job_status' not in by_id[str(payment.id)]
