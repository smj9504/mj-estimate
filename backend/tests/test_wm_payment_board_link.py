"""WM manager payment link (2026-11-06):

- the board shows each job's status;
- the link can set who the check went to (and clear it), but nothing else
  rides along on that request;
- "Insurance reviewing" is a WM status, stands in for "Follow up" when the
  carrier's estimate arrives, and its follow-up email asks for an update.

Run through the API on a throwaway SQLite database."""

from datetime import datetime
from pathlib import Path
import sys

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.dialects.postgresql import ARRAY, INET, JSONB, UUID as PG_UUID
from sqlalchemy.ext.compiler import compiles

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory  # noqa: E402
from app.core.database_factory import Base, SQLiteDatabase  # noqa: E402
from app.domains.staff.models import Staff, StaffRole  # noqa: E402
from app.domains.water_mitigation.models import WaterMitigationJob  # noqa: E402
from app.domains.water_mitigation.payment_board_models import WMPaymentBoardToken  # noqa: E402
from app.domains.water_mitigation.schemas import JobStatusUpdate  # noqa: E402
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
    session.flush()
    session.add(WMPaymentBoardToken(token='board-link', is_active=True, created_by_id=admin.id))
    session.add(WMPaymentBoardToken(token='old-link', is_active=False, created_by_id=admin.id))
    job = WaterMitigationJob(
        property_address='12 Elm St', status='Insurance reviewing', active=True,
        invoice_amount=4200, check_recipient='customer',
    )
    session.add(job)
    session.commit()
    job_id = str(job.id)
    session.close()

    def get_db():
        db = database.get_session()
        try:
            yield db
            db.commit()
        finally:
            db.close()
    app.dependency_overrides[database_factory.get_db_session] = get_db

    yield database, job_id, TestClient(app, raise_server_exceptions=True)
    app.dependency_overrides.pop(database_factory.get_db_session, None)


def _job(database, job_id):
    session = database.get_session()
    try:
        return session.query(WaterMitigationJob).filter(WaterMitigationJob.id == job_id).one()
    finally:
        session.close()


def test_the_board_shows_each_jobs_status(env):
    _, job_id, api = env
    board = api.get('/api/wm-payment-board/board-link').json()
    assert board['valid'] is True
    [row] = board['items']
    assert row['id'] == job_id
    assert row['status'] == 'Insurance reviewing'


@pytest.mark.parametrize('recipient', ['contractor', 'pa', None])
def test_the_link_sets_who_the_check_went_to(env, recipient):
    database, job_id, api = env
    got = api.patch(f'/api/wm-payment-board/board-link/jobs/{job_id}/check-recipient',
                    json={'check_recipient': recipient})
    assert got.status_code == 200, got.text
    assert got.json()['check_recipient'] == recipient
    assert _job(database, job_id).check_recipient == recipient


def test_the_check_recipient_request_reaches_nothing_else(env):
    database, job_id, api = env
    got = api.patch(f'/api/wm-payment-board/board-link/jobs/{job_id}/check-recipient',
                    json={'check_recipient': 'contractor', 'invoice_amount': 1,
                          'approved_amount': 1, 'status': 'Complete', 'payment_received': True})
    assert got.status_code == 200, got.text
    job = _job(database, job_id)
    assert job.check_recipient == 'contractor'
    assert float(job.invoice_amount) == 4200
    assert job.approved_amount is None
    assert job.status == 'Insurance reviewing'
    assert not job.payment_received


def test_the_link_refuses_an_unknown_check_recipient(env):
    database, job_id, api = env
    got = api.patch(f'/api/wm-payment-board/board-link/jobs/{job_id}/check-recipient',
                    json={'check_recipient': 'someone else'})
    assert got.status_code == 422
    assert _job(database, job_id).check_recipient == 'customer'


@pytest.mark.parametrize('token', ['old-link', 'no-such-link'])
def test_a_dead_link_cannot_set_the_check_recipient(env, token):
    database, job_id, api = env
    got = api.patch(f'/api/wm-payment-board/{token}/jobs/{job_id}/check-recipient',
                    json={'check_recipient': 'contractor'})
    assert got.status_code == 404
    assert _job(database, job_id).check_recipient == 'customer'


def test_insurance_reviewing_is_a_status():
    assert JobStatusUpdate(status='Insurance reviewing').status == 'Insurance reviewing'
    with pytest.raises(ValidationError):
        JobStatusUpdate(status='Insurance review')


def test_the_carriers_estimate_moves_insurance_reviewing_on(env):
    database, job_id, _ = env
    from app.domains.claim_followup.service import ClaimFollowUpService

    session = database.get_session()
    job = session.query(WaterMitigationJob).filter(WaterMitigationJob.id == job_id).one()
    job.claim_id = 'c0000000-0000-0000-0000-000000000001'
    session.flush()
    ClaimFollowUpService()._update_wm_jobs_paperwork_received(session, job.claim_id)
    session.commit()
    session.close()
    assert _job(database, job_id).status == 'Paperwork received'


def test_the_follow_up_for_insurance_reviewing_asks_for_an_update(env, monkeypatch):
    database, job_id, _ = env
    from app.domains.water_mitigation.adjuster_email_service import AdjusterEmailService

    service = AdjusterEmailService(database)
    # No mail to read in this database
    monkeypatch.setattr(service, '_suggest_template_from_mail', lambda session, job: None)
    email = service.generate_followup_email(job_id)
    assert email['template'] == 'review_update'
    assert 'under review' in email['body_html']
