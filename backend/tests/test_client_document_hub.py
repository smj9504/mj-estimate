"""The client page's Document Hub: answered at the address the page asks, with every kind
of document it lists. On a throwaway SQLite database."""

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
from app.core import database_factory
from app.core.database_factory import Base, SQLiteDatabase, get_db
from app.domains.auth.dependencies import get_current_staff
from app.domains.client import api as client_api
from app.domains.client.models import Claim, ClaimNegotiation, Client
from app.domains.contract.models import ContractInstance, ContractTemplate
from app.domains.staff.models import StaffRole
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
from app.main import app as whole_app

sqlite3.register_adapter(uuid.UUID, str)


@compiles(JSONB, 'sqlite')
def jsonb_as_json(type_, compiler, **kw):
    return 'JSON'


@compiles(ARRAY, 'sqlite')
def array_as_json(type_, compiler, **kw):
    return 'JSON'


def model(table_name):
    return next(m.class_ for m in Base.registry.mappers if getattr(m.class_, '__tablename__', None) == table_name)


HUB_TABLES = [
    'sent_emails', 'invoices', 'estimates', 'work_orders', 'water_mitigation_jobs', 'cabinet_estimates',
    # Where the stored files come from (client/document_files.py)
    'files', 'followup_tasks', 'supplement_requests', 'bid_item_estimates', 'wm_documents',
    'rebuild_projects', 'rebuild_completion_docs',
]


@pytest.fixture
def env(tmp_path, monkeypatch):
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    sa.event.listen(database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF'))
    tables = [Client, Claim, ClaimNegotiation, ContractTemplate, ContractInstance, *map(model, HUB_TABLES)]
    Base.metadata.create_all(database.engine, tables=[m.__table__ for m in tables])
    # Nothing here may reach the real database, whatever the env file points at
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)
    monkeypatch.setattr(client_api, 'get_database', lambda: database, raising=False)

    session = database.get_session()
    client = Client(display_name='12 Elm St', owners=[], address='12 Elm St', is_active=True)
    session.add(client)
    session.flush()
    claim = Claim(client_id=client.id, claim_number='CLM-1')
    session.add(claim)
    session.flush()
    session.commit()
    ids = SimpleNamespace(client=str(client.id), claim=str(claim.id))

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
    yield SimpleNamespace(api=TestClient(application), session=session, ids=ids)
    session.close()
    database.engine.dispose()


def test_the_app_answers_at_the_address_the_page_asks():
    paths = {route.path for route in whole_app.routes}
    assert '/api/clients/{client_id}/all-documents' in paths


def test_an_insurance_estimate_is_listed_with_its_file(env):
    env.session.add(ClaimNegotiation(
        claim_id=env.ids.claim, revision_number=2, revision_type='supplement', rcv_amount=300,
        document_url='file-1', document_name='estimate.pdf', received_from='Adjuster',
        date_received=datetime(2026, 10, 15, tzinfo=timezone.utc),
    ))
    env.session.commit()

    response = env.api.get(f'/api/clients/{env.ids.client}/all-documents')
    assert response.status_code == 200, response.text
    found = response.json()
    assert found['claims'] == [{'id': env.ids.claim, 'claim_number': 'CLM-1'}]
    [document] = found['documents']
    assert document['doc_type'] == 'insurance_estimate'
    assert document['title'] == 'Insurance Est. Rev.2 (supplement)'
    assert document['file_id'] == 'file-1'
    assert document['amount'] == 300


def test_a_revision_with_nothing_attached_is_not_a_document(env):
    env.session.add(ClaimNegotiation(claim_id=env.ids.claim, revision_number=1, rcv_amount=300))
    env.session.commit()
    assert env.api.get(f'/api/clients/{env.ids.client}/all-documents').json()['documents'] == []


def test_a_client_nobody_has_is_not_found(env):
    assert env.api.get(f'/api/clients/{uuid.uuid4()}/all-documents').status_code == 404


def _app_routes():
    """The page paths App.tsx serves, as patterns"""
    import re
    app_tsx = Path(__file__).resolve().parents[2] / 'frontend' / 'src' / 'App.tsx'
    paths = re.findall(r'path: "([^"]+)"', app_tsx.read_text(encoding='utf-8'))
    return [re.compile('^' + re.sub(r':[^/]+', '[^/]+', p) + '$') for p in paths if p != '*']


def test_every_document_opens_a_page_the_app_has(env):
    Invoice, Estimate, WorkOrder = model('invoices'), model('estimates'), model('work_orders')
    claim_id = env.ids.claim
    # Invoices and estimates show to their owner or a super admin
    super_admin = SimpleNamespace(id=uuid.uuid4(), role=StaffRole.super_admin, is_active=True)
    env.api.app.dependency_overrides[get_current_staff] = lambda: super_admin
    env.session.add(Invoice(invoice_number='INV-1', client_id=env.ids.client, claim_id=claim_id,
                            client_name='12 Elm St'))
    env.session.add(Estimate(estimate_number='EST-1', client_id=env.ids.client, claim_id=claim_id,
                             client_name='12 Elm St'))
    env.session.add(Estimate(estimate_number='EST-2', estimate_type='insurance', client_id=env.ids.client,
                             claim_id=claim_id, client_name='12 Elm St'))
    env.session.add(WorkOrder(work_order_number='WO-1', client_id=env.ids.client, claim_id=claim_id,
                              company_id=uuid.uuid4(), client_name='12 Elm St', document_type='WO',
                              created_by_staff_id=uuid.uuid4()))
    env.session.commit()

    response = env.api.get(f'/api/clients/{env.ids.client}/all-documents')
    assert response.status_code == 200, response.text
    links = {d['title']: d['link'] for d in response.json()['documents']}
    by_number = {title.split('#')[1].split(' ')[0]: link for title, link in links.items() if '#' in title}
    assert by_number['INV-1'].endswith('/edit') and by_number['INV-1'].startswith('/invoices/')
    assert by_number['EST-1'].startswith('/edit/estimate/')
    assert by_number['EST-2'].startswith('/insurance-estimate/')
    assert by_number['WO-1'].startswith('/work-order/')

    routes = _app_routes()
    for title, link in links.items():
        assert any(r.match(link) for r in routes), f'{title} links to {link}, which no page serves'
