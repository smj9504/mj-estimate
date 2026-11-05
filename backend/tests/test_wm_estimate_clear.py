"""Clearing a WM insurance estimate entered by mistake on the WM job: the
estimate comes off the claim, the claim's WM fields and the client's stage go
back to what they were, and the PDF uploaded for it leaves the Document Hub.
Runs the real routes on a throwaway SQLite database."""

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
from app.domains.client.models import Claim, ClaimActivity, ClaimNegotiation, Client  # noqa: E402
from app.domains.file import service as file_service  # noqa: E402
from app.domains.file.models import File  # noqa: E402
from app.domains.staff.models import StaffRole  # noqa: E402
from app.domains.water_mitigation.models import WaterMitigationJob  # noqa: E402
from app.main import app  # noqa: E402

JOBS = '/api/water-mitigation/jobs'


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
    # Every table SQLite can make; the client page counts documents of many kinds
    for table in Base.metadata.sorted_tables:
        try:
            table.create(database.engine, checkfirst=True)
        except Exception:
            pass
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)

    class FakeFileService:
        """Files the upload as a files row, without storage"""
        def __init__(self, _database):
            self.repository = SimpleNamespace(db_session=database.get_session())

        async def upload_file(self, file_data, original_filename, content_type, context, context_id, **_):
            data = file_data.read()
            row = File(filename=original_filename, original_name=original_filename,
                       content_type=content_type, size=len(data), url=f'b2://{original_filename}',
                       storage_provider='b2', context=context, context_id=str(context_id))
            self.repository.db_session.add(row)
            self.repository.db_session.flush()
            return {'id': row.id}
    monkeypatch.setattr(file_service, 'FileService', FakeFileService)

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

    session = database.get_session()
    client = Client(display_name='Park Client', owners=[])
    session.add(client)
    session.flush()
    # WM docs went out; the carrier hasn't answered on the WM yet
    claim = Claim(client_id=client.id, claim_number='C-7', status='open', wm_cost_status='not_received')
    session.add(claim)
    session.flush()
    job = WaterMitigationJob(property_address='7 Pine St', status='Sent to adjuster', claim_id=claim.id)
    session.add(job)
    session.commit()
    ids = SimpleNamespace(client=str(client.id), claim=str(claim.id), job=str(job.id))
    session.close()

    yield TestClient(app, raise_server_exceptions=True), database, ids
    app.dependency_overrides.pop(get_current_staff, None)
    app.dependency_overrides.pop(database_factory.get_db_session, None)


def client_stage(api):
    row = api.get('/api/clients/').json()['clients'][0]
    return row['claim_stage'], row['claim_stage_detail']


def the_claim(database, claim_id):
    session = database.get_session()
    claim = session.query(Claim).filter(Claim.id == claim_id).one()
    fields = SimpleNamespace(**{name: getattr(claim, name) for name in (
        'wm_cost_status', 'wm_estimate_amount', 'wm_estimate_file_id', 'wm_estimate_file_name',
        'current_rcv', 'current_acv',
    )})
    session.close()
    return fields


def test_a_combined_upload_cleared_puts_the_claim_and_stage_back(env):
    api, database, ids = env
    before = client_stage(api)
    assert before == ('awaiting_estimate', 'WM docs sent')

    # The WM slice of a PDF that covered the rebuild too counts as the rebuild estimate
    response = api.post(
        f"{JOBS}/{ids.job}/insurance-estimate",
        files={'file': ('wrong.pdf', b'%PDF-1.4 wrong', 'application/pdf')},
        data={'wm_amount': '6611.88', 'is_combined': 'true',
              'wm_section': '{"section_name": "Water Mitigation", "rcv": 6611.88}'},
    )
    assert response.status_code == 200, response.text
    assert client_stage(api)[0] == 'supplement_prep'
    claim = the_claim(database, ids.claim)
    assert (claim.wm_cost_status, float(claim.wm_estimate_amount)) == ('included_in_rebuild', 6611.88)
    file_id = claim.wm_estimate_file_id
    hub = api.get(f"/api/clients/{ids.client}/all-documents").json()['documents']
    assert any(d['doc_type'] == 'insurance_estimate' for d in hub)

    card = api.get(f"{JOBS}/{ids.job}/financial-comparison").json()['insurance_estimate']
    assert (card['wm_revision_count'], card['can_clear']) == (1, True)

    response = api.delete(f"{JOBS}/{ids.job}/insurance-estimate")
    assert response.status_code == 200, response.text
    assert response.json()['removed'] == 1

    assert client_stage(api) == before
    claim = the_claim(database, ids.claim)
    assert (claim.wm_cost_status, claim.wm_estimate_amount, claim.wm_estimate_file_id,
            claim.wm_estimate_file_name) == ('not_received', None, None, None)
    session = database.get_session()
    assert session.query(ClaimNegotiation).count() == 0
    assert session.query(File).filter(File.id == file_id).one().is_active is False
    activity = session.query(ClaimActivity).filter(
        ClaimActivity.activity_type == 'wm_estimate_cleared').one()
    assert '$6,611.88' in activity.description
    session.close()
    hub = api.get(f"/api/clients/{ids.client}/all-documents").json()['documents']
    assert not any(d['doc_type'] in ('insurance_estimate', 'file') for d in hub)

    card = api.get(f"{JOBS}/{ids.job}/financial-comparison").json()
    assert (card['insurance_estimate']['wm_revision_count'], card['insurance_estimate']['can_clear'],
            card['comparison']['insurance_total']) == (0, False, 0)
    # Nothing left to clear
    assert api.delete(f"{JOBS}/{ids.job}/insurance-estimate").status_code == 404


def test_typed_amounts_clear_together_back_to_before_the_first(env):
    api, database, ids = env
    for amount in (5000, 5200):
        response = api.post(f"{JOBS}/{ids.job}/insurance-estimate/manual", json={'wm_amount': amount})
        assert response.status_code == 200, response.text
    card = api.get(f"{JOBS}/{ids.job}/financial-comparison").json()['insurance_estimate']
    assert (card['wm_revision_count'], card['wm_section']['rcv']) == (2, 5200)

    assert api.delete(f"{JOBS}/{ids.job}/insurance-estimate").json()['removed'] == 2
    claim = the_claim(database, ids.claim)
    assert (claim.wm_cost_status, claim.wm_estimate_amount) == ('not_received', None)
    assert client_stage(api) == ('awaiting_estimate', 'WM docs sent')


def test_an_older_entry_without_the_claim_kept_clears_to_no_wm_estimate(env):
    """Entered before the claim's prior state was kept on the revision; an
    edit on the claim page had pointed the claim's amounts at it"""
    api, database, ids = env
    session = database.get_session()
    claim = session.query(Claim).filter(Claim.id == ids.claim).one()
    claim.wm_cost_status, claim.wm_estimate_amount = 'separate_estimate', 4100
    claim.current_rcv = claim.current_acv = 4100
    session.add(ClaimNegotiation(claim_id=ids.claim, revision_number=1, revision_type='initial',
                                 estimate_category='water_mitigation', rcv_amount=4100, acv_amount=4100,
                                 extraction_metadata={'source': 'wm_job_manual', 'is_manual': True}))
    session.commit()
    session.close()
    assert client_stage(api)[0] == 'supplement_prep'

    assert api.delete(f"{JOBS}/{ids.job}/insurance-estimate").status_code == 200
    claim = the_claim(database, ids.claim)
    assert (claim.wm_cost_status, claim.wm_estimate_amount,
            float(claim.current_rcv), float(claim.current_acv)) == (None, None, 0, 0)
    assert client_stage(api) == ('awaiting_estimate', 'WM docs sent')


def test_the_rebuild_estimate_and_a_later_paid_per_invoice_stay(env):
    api, database, ids = env
    session = database.get_session()
    session.add(ClaimNegotiation(claim_id=ids.claim, revision_number=1, revision_type='initial',
                                 estimate_category='reconstruction', rcv_amount=48000, acv_amount=40000))
    claim = session.query(Claim).filter(Claim.id == ids.claim).one()
    claim.current_rcv, claim.current_acv = 48000, 40000
    session.commit()
    session.close()

    assert api.post(f"{JOBS}/{ids.job}/insurance-estimate/manual", json={'wm_amount': 3000}).status_code == 200
    # Marked paid per invoice after the estimate went in: that stays
    session = database.get_session()
    session.query(Claim).filter(Claim.id == ids.claim).one().wm_cost_status = 'paid_per_invoice'
    session.commit()
    session.close()

    assert api.delete(f"{JOBS}/{ids.job}/insurance-estimate").json()['removed'] == 1
    claim = the_claim(database, ids.claim)
    assert (claim.wm_cost_status, float(claim.current_rcv)) == ('paid_per_invoice', 48000)
    session = database.get_session()
    assert [n.estimate_category for n in session.query(ClaimNegotiation)] == ['reconstruction']
    session.close()
