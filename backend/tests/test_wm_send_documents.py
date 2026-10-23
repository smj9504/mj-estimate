"""Documents picked in the water mitigation Documents tab are emailed exactly as
picked and as saved, and only if every one of them can be attached."""

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
from app.domains.water_mitigation.models import WaterMitigationJob, WMDocument  # noqa: E402


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
    for model in (WaterMitigationJob, WMDocument, FollowUpTask, SentEmail, ClaimActivity):
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
        property_address='12 Elm St, Springfield',
        claim_id=claim_id,
        claim_number='CLM-77',
        status='Lead',
    )
    other_job = WaterMitigationJob(property_address='9 Oak Ave')
    session.add_all([job, other_job])
    session.commit()

    def add_doc(filename, owner=job, content=b'%PDF-doc', **fields):
        path = tmp_path / filename
        if content is not None:
            path.write_bytes(content)
        doc = WMDocument(
            job_id=owner.id,
            document_type=fields.pop('document_type', 'Other'),
            filename=filename,
            file_path=str(path),
            file_size=len(content or b''),
            mime_type='application/pdf',
            storage_provider='local',
            is_active=True,
            **fields,
        )
        session.add(doc)
        session.commit()
        return str(doc.id)

    service = AdjusterEmailService(database)
    yield {
        'service': service, 'session': session, 'job_id': str(job.id),
        'claim_id': claim_id, 'add_doc': add_doc, 'other_job': other_job,
        'smtp_calls': smtp_calls,
    }
    session.close()
    engine.dispose()


def send(env, document_ids=()):
    return env['service'].send_documents(env['job_id'], {
        'to_addresses': ['someone@example.com'],
        'cc_addresses': ['cc@example.com'],
        'subject': 'CLM-77 - 12 Elm St',
        'body_html': '<p>Please find the attached documents.</p>',
        'document_ids': list(document_ids),
    })


def test_sends_exactly_the_picked_documents_as_saved(env):
    cos = env['add_doc']('COS signed.pdf', document_type='COS', content=b'%PDF-cos')
    env['add_doc']('EWA.pdf', document_type='EWA')  # not picked
    invoice = env['add_doc']('Invoice INV-1 - 12 Elm St.pdf', document_type='Invoice',
                             content=b'%PDF-saved-invoice', title='Invoice INV-1')

    result = send(env, document_ids=[invoice, cos, invoice])

    [call] = env['smtp_calls']
    assert call['to_addresses'] == ['someone@example.com']
    assert call['cc_addresses'] == ['cc@example.com']
    # In the order picked, each once, byte for byte the saved file
    assert [(a['filename'], a['data']) for a in call['attachments']] == [
        ('Invoice INV-1 - 12 Elm St.pdf', b'%PDF-saved-invoice'),
        ('COS signed.pdf', b'%PDF-cos'),
    ]
    assert result['attachments_count'] == 2

    session = env['session']
    session.expire_all()
    [email] = session.query(SentEmail).all()
    assert str(email.claim_id) == env['claim_id']
    [activity] = session.query(ClaimActivity).all()
    assert activity.activity_type == 'wm_documents_emailed'
    assert 'COS signed.pdf' in activity.description

    # Not a send to the adjuster: the job is left as it was
    job = session.get(WaterMitigationJob, env['job_id'])
    assert job.status == 'Lead'
    assert job.documents_sent_date is None
    assert session.query(FollowUpTask).count() == 0


def test_another_jobs_document_is_refused(env):
    mine = env['add_doc']('Mine.pdf')
    theirs = env['add_doc']('Theirs.pdf', owner=env['other_job'])

    with pytest.raises(ValueError, match='1 document\\(s\\) no longer on this job'):
        send(env, document_ids=[mine, theirs])

    assert env['smtp_calls'] == []


def test_missing_file_blocks_the_send(env):
    present = env['add_doc']('Present.pdf')
    gone = env['add_doc']('Gone.pdf', content=None)

    with pytest.raises(ValueError, match='Failed to attach: Gone.pdf'):
        send(env, document_ids=[present, gone])

    assert env['smtp_calls'] == []
    env['session'].expire_all()
    assert env['session'].query(SentEmail).count() == 0


def test_nothing_picked_is_refused(env):
    with pytest.raises(ValueError, match='No documents selected'):
        send(env)
