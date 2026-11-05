"""The Document Hub lists the files stored on a client's claims and opens them
in the page - only behind a login, and only a file on a claim of that client."""

from datetime import datetime, timezone
from pathlib import Path
import sqlite3
import sys
from types import SimpleNamespace
import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.ext.compiler import compiles

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory  # noqa: E402
from app.core.database_factory import Base, SQLiteDatabase, get_db  # noqa: E402
from app.domains.auth.dependencies import get_current_staff  # noqa: E402
from app.domains.client import api as client_api  # noqa: E402
from app.domains.client.models import Claim, ClaimNegotiation, Client  # noqa: E402
from app.domains.contract.models import ContractInstance, ContractTemplate  # noqa: E402
from app.domains.file.models import File  # noqa: E402
from app.domains.rebuild.models import RebuildCompletionDoc, RebuildProject  # noqa: E402
from app.domains.staff.models import StaffRole  # noqa: E402
from app.domains.water_mitigation.models import WaterMitigationJob, WMDocument  # noqa: E402
import app.main  # noqa: E402,F401

sqlite3.register_adapter(uuid.UUID, str)


@compiles(JSONB, 'sqlite')
def jsonb_as_json(type_, compiler, **kw):
    return 'JSON'


@compiles(ARRAY, 'sqlite')
def array_as_json(type_, compiler, **kw):
    return 'JSON'


def model(table_name):
    return next(m.class_ for m in Base.registry.mappers if getattr(m.class_, '__tablename__', None) == table_name)


TABLES = [
    'sent_emails', 'invoices', 'estimates', 'work_orders', 'water_mitigation_jobs', 'cabinet_estimates',
    'files', 'followup_tasks', 'supplement_requests', 'bid_item_estimates', 'wm_documents',
    'rebuild_projects', 'rebuild_completion_docs',
]
WHEN = datetime(2026, 11, 1, tzinfo=timezone.utc)


@pytest.fixture
def env(tmp_path, monkeypatch):
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    sa.event.listen(database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF'))
    tables = [Client, Claim, ClaimNegotiation, ContractTemplate, ContractInstance, *map(model, TABLES)]
    Base.metadata.create_all(database.engine, tables=[m.__table__ for m in tables])
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)
    monkeypatch.setattr(client_api, 'get_database', lambda: database, raising=False)

    # Cloud storage stand-in: key -> bytes
    stored = {}

    class FakeStorage:
        def download(self, key):
            if key not in stored:
                raise FileNotFoundError(key)
            return stored[key]

    from app.domains.storage.factory import StorageFactory
    monkeypatch.setattr(StorageFactory, 'get_instance', staticmethod(lambda *a, **k: FakeStorage()))

    session = database.get_session()
    client = Client(display_name='12 Elm St', owners=[], address='12 Elm St', is_active=True)
    other = Client(display_name='9 Oak Ave', owners=[], address='9 Oak Ave', is_active=True)
    session.add(client)
    session.add(other)
    session.flush()
    claim = Claim(client_id=client.id, claim_number='CLM-1')
    other_claim = Claim(client_id=other.id, claim_number='CLM-9')
    session.add(claim)
    session.add(other_claim)
    session.commit()

    application = FastAPI()
    application.include_router(client_api.router, prefix='/api/clients')

    def use_db():
        db = database.get_session()
        try:
            yield db
        finally:
            db.close()

    application.dependency_overrides[get_db] = use_db
    admin = SimpleNamespace(id=uuid.uuid4(), role=StaffRole.admin, is_active=True)
    application.dependency_overrides[get_current_staff] = lambda: admin

    def local_file(name, content):
        path = tmp_path / name
        path.write_bytes(content)
        return str(path)

    yield SimpleNamespace(
        api=TestClient(application), app=application, session=session, stored=stored,
        client=str(client.id), claim=str(claim.id), other_claim=str(other_claim.id),
        local_file=local_file,
    )
    session.close()
    database.engine.dispose()


def hub(env):
    response = env.api.get(f'/api/clients/{env.client}/all-documents')
    assert response.status_code == 200, response.text
    return response.json()['documents']


def open_file(env, file, client=None):
    return env.api.get(f"/api/clients/{client or env.client}/document-files/{file['source']}/{file['id']}")


def add_file(env, context, context_id, name='letter.pdf', content=b'%PDF-letter', **fields):
    row = File(
        filename=name, original_name=name, content_type=fields.pop('content_type', 'application/pdf'),
        size=len(content), url=env.local_file(name, content), storage_provider='local',
        context=context, context_id=context_id, created_at=WHEN, **fields,
    )
    env.session.add(row)
    env.session.commit()
    return row


def test_a_wm_document_is_listed_and_opens(env):
    job = WaterMitigationJob(property_address='12 Elm St', claim_id=env.claim)
    env.session.add(job)
    env.session.flush()
    env.session.add(WMDocument(
        job_id=job.id, document_type='COS', filename='COS.pdf', title='Certificate of Satisfaction',
        file_path=env.local_file('COS.pdf', b'%PDF-cos'), storage_provider='local',
        mime_type='application/pdf', is_active=True,
    ))
    env.session.commit()

    [row] = [d for d in hub(env) if d['doc_type'] == 'file']
    assert row['title'] == 'COS.pdf'
    assert row['description'] == 'WM job · Certificate of Satisfaction'
    assert row['claim_number'] == 'CLM-1'
    response = open_file(env, row['file'])
    assert response.status_code == 200
    assert response.content == b'%PDF-cos'
    assert response.headers['content-type'] == 'application/pdf'
    assert response.headers['content-disposition'].startswith('inline')


def test_a_pdf_email_filed_on_the_claim_opens_from_cloud_storage(env):
    env.stored['b2://bucket/report.pdf'] = b'%PDF-report'
    env.session.add(File(
        filename='report.pdf', original_name='Photo Report.pdf', content_type='application/pdf',
        size=11, url='b2://bucket/report.pdf', storage_provider='b2',
        context='claim-document', context_id=env.claim, category='photo_report', created_at=WHEN,
    ))
    env.session.commit()

    [row] = [d for d in hub(env) if d['doc_type'] == 'file']
    assert (row['title'], row['description']) == ('Photo Report.pdf', 'Photo report')
    assert open_file(env, row['file']).content == b'%PDF-report'


def test_an_insurance_estimate_opens_from_its_own_row_and_is_not_listed_twice(env):
    uploaded = add_file(env, 'negotiation', env.claim, name='carrier.pdf', content=b'%PDF-carrier')
    # Email ingestion keeps the storage url instead of the file id
    emailed = add_file(env, 'claim-negotiation', env.claim, name='emailed.pdf', content=b'%PDF-emailed')
    env.session.add(ClaimNegotiation(claim_id=env.claim, revision_number=1, rcv_amount=100,
                                     document_url=uploaded.id, document_name='carrier.pdf', date_received=WHEN))
    env.session.add(ClaimNegotiation(claim_id=env.claim, revision_number=2, rcv_amount=200,
                                     document_url=emailed.url, document_name='emailed.pdf', date_received=WHEN))
    env.session.commit()

    documents = hub(env)
    assert [d for d in documents if d['doc_type'] == 'file'] == []
    rows = sorted((d for d in documents if d['doc_type'] == 'insurance_estimate'), key=lambda d: d['amount'])
    assert [open_file(env, d['file']).content for d in rows] == [b'%PDF-carrier', b'%PDF-emailed']


def test_a_signed_contract_opens_from_its_row(env):
    env.session.add(ContractInstance(
        template_id=str(uuid.uuid4()), company_id=str(uuid.uuid4()),
        client_id=env.client, claim_id=env.claim, title='Work Authorization', status='signed',
        signed_pdf_url=env.local_file('signed.pdf', b'%PDF-signed'), signed_pdf_provider='local',
        filled_pdf_url=env.local_file('filled.pdf', b'%PDF-filled'), filled_pdf_provider='local',
    ))
    env.session.commit()

    [row] = [d for d in hub(env) if d['doc_type'] == 'contract']
    assert row['file']['filename'] == 'Work Authorization.pdf'
    assert open_file(env, row['file']).content == b'%PDF-signed'


def test_a_rebuild_completion_document_opens(env):
    project = RebuildProject(claim_id=env.claim, title='Rebuild', property_address='12 Elm St')
    env.session.add(project)
    env.session.flush()
    env.stored['rebuild/coc.pdf'] = b'%PDF-coc'
    env.session.add(RebuildCompletionDoc(
        project_id=project.id, doc_type='coc', title='Certificate of Completion',
        file_name='COC.pdf', file_url='rebuild/coc.pdf', mime_type='application/pdf',
    ))
    env.session.commit()

    [row] = [d for d in hub(env) if d['doc_type'] == 'file']
    assert row['description'] == 'Rebuild · Certificate of Completion'
    assert open_file(env, row['file']).content == b'%PDF-coc'


def test_photos_stay_in_the_photo_viewer(env):
    add_file(env, 'claim-document', env.claim, name='site.jpg', content=b'jpg', content_type='image/jpeg')
    assert [d for d in hub(env) if d['doc_type'] == 'file'] == []


def test_a_file_of_another_clients_claim_does_not_open_here(env):
    theirs = add_file(env, 'claim-document', env.other_claim, name='theirs.pdf', content=b'%PDF-theirs')
    file = {'source': 'file', 'id': theirs.id}
    assert open_file(env, file).status_code == 404
    other_client = env.session.query(Claim).filter(Claim.id == env.other_claim).one().client_id
    assert open_file(env, file, client=str(other_client)).status_code == 200


def test_unknown_sources_and_ids_are_not_found(env):
    assert open_file(env, {'source': 'secrets', 'id': 'x'}).status_code == 404
    assert open_file(env, {'source': 'contract', 'id': 'not-a-uuid'}).status_code == 404
    assert open_file(env, {'source': 'file', 'id': str(uuid.uuid4())}).status_code == 404


def test_a_file_missing_from_storage_says_so(env):
    env.session.add(File(
        filename='gone.pdf', original_name='gone.pdf', content_type='application/pdf', size=1,
        url='b2://bucket/gone.pdf', storage_provider='b2',
        context='claim-document', context_id=env.claim, category='letter', created_at=WHEN,
    ))
    env.session.commit()
    [row] = [d for d in hub(env) if d['doc_type'] == 'file']
    response = open_file(env, row['file'])
    assert response.status_code == 404
    assert 'could not be read' in response.json()['detail']


def test_opening_a_file_takes_a_login(env):
    letter = add_file(env, 'claim-document', env.claim)
    env.app.dependency_overrides.pop(get_current_staff)
    assert open_file(env, {'source': 'file', 'id': letter.id}).status_code in (401, 403)
