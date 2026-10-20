"""A follow-up sent from the water mitigation screen counts on the claim's open
WM docs follow-up, the same as one sent from the follow-up screen."""

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401
from app.domains.claim_followup.models import FollowUpTask, SentEmail  # noqa: E402
from app.domains.claim_followup.smtp_service import SmtpService  # noqa: E402
from app.domains.client.models import ClaimActivity  # noqa: E402
from app.domains.water_mitigation.adjuster_email_service import AdjusterEmailService  # noqa: E402
from app.domains.water_mitigation.models import WaterMitigationJob  # noqa: E402


@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(type_, compiler, **kw):
    return 'JSON'


class FakeDatabase:
    def __init__(self, engine):
        self._sessions = sessionmaker(bind=engine)

    def get_session(self):
        return self._sessions()

    get_readonly_session = get_session


@pytest.fixture
def env(tmp_path, monkeypatch):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'wm.db'}")
    for model in (WaterMitigationJob, FollowUpTask, SentEmail, ClaimActivity):
        model.__table__.create(engine)
    database = FakeDatabase(engine)

    smtp_calls = []
    monkeypatch.setattr(
        SmtpService, 'send',
        lambda self, **kwargs: smtp_calls.append(kwargs) or {'message_id': '<sent@test>'},
    )

    session = database.get_session()
    claim_id = '11111111-1111-1111-1111-111111111111'
    job = WaterMitigationJob(
        property_address='12 Elm St',
        claim_id=claim_id,
        claim_number='CLM-77',
        adjuster_name='Pat Lee',
        adjuster_email='pat@carrier.com',
    )
    session.add(job)
    session.commit()

    def add_task(status='pending', linked=True, **fields):
        task = FollowUpTask(
            claim_id=claim_id,
            wm_job_id=str(job.id) if linked else None,
            task_type='wm_docs_sent',
            title='WM Follow up - Docs sent to adjuster',
            status=status,
            followup_interval_days=3,
            contact_count=0,
            **fields,
        )
        session.add(task)
        session.commit()
        return task

    service = AdjusterEmailService(database)
    yield {
        'service': service, 'session': session, 'job_id': str(job.id),
        'claim_id': claim_id, 'add_task': add_task, 'smtp_calls': smtp_calls,
    }
    session.close()
    engine.dispose()


def send(env):
    return env['service'].send_followup(env['job_id'], {
        'to_addresses': ['pat@carrier.com'],
        'subject': 'Follow Up - CLM-77',
        'body_html': '<p>Checking in on the documents.</p>',
    })


def sent_emails(env):
    env['session'].expire_all()
    return env['session'].query(SentEmail).all()


def test_send_counts_as_contact_on_open_wm_docs_followup(env):
    task = env['add_task']()

    result = send(env)

    [email] = sent_emails(env)
    assert str(email.followup_task_id) == str(task.id)
    assert str(email.claim_id) == env['claim_id']
    assert email.status == 'sent'
    # Recorded just as composed, the same as a send from the follow-up screen
    assert email.subject == 'Follow Up - CLM-77'
    assert email.body_html == '<p>Checking in on the documents.</p>'
    assert result['followup_task_id'] == str(task.id)

    env['session'].refresh(task)
    assert task.contact_count == 1
    assert task.status == 'awaiting_response'
    assert task.last_contacted_at is not None
    next_date = task.next_followup_date.replace(tzinfo=timezone.utc)
    assert next_date - datetime.now(timezone.utc) > timedelta(days=2, hours=23)
    assert len(env['smtp_calls']) == 1


def test_resolved_followup_is_left_alone(env):
    task = env['add_task'](status='resolved')

    result = send(env)

    [email] = sent_emails(env)
    assert email.followup_task_id is None
    # Still on the claim, so it shows in the claim's whole history
    assert str(email.claim_id) == env['claim_id']
    assert result['followup_task_id'] is None
    env['session'].refresh(task)
    assert task.contact_count == 0
    assert task.status == 'resolved'


def test_prefers_the_followup_linked_to_this_job(env):
    env['add_task'](linked=False)
    linked = env['add_task']()

    assert env['service'].get_open_followup_task(env['job_id'])['id'] == str(linked.id)


def test_falls_back_to_a_followup_added_by_hand(env):
    by_hand = env['add_task'](linked=False)

    send(env)

    [email] = sent_emails(env)
    assert str(email.followup_task_id) == str(by_hand.id)


def test_no_open_followup(env):
    env['add_task'](status='cancelled')

    assert env['service'].get_open_followup_task(env['job_id']) is None
    assert env['service'].generate_followup_email(env['job_id'])['followup_task'] is None
