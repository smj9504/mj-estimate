"""Contract templates and contracts stay inside the companies a person belongs to.

- The template list shows only the caller's companies' templates; another
  company's template can't be read, edited, re-uploaded, re-mapped or deleted.
- A template that contracts were made from can't be deleted: the ORM cascade
  would delete those contracts, signed ones included.
- A contract can only be issued for one of the caller's companies (its mailbox
  sends the signing link), from that company's template, and only that
  company's people send it.
- A signing link only points at the app's own address, whatever origin_url says.

On a throwaway SQLite database, through the real routes. Made-up data only.
"""

from datetime import datetime
from io import BytesIO
from pathlib import Path
import sqlite3
import sys
from types import SimpleNamespace
import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from reportlab.pdfgen import canvas
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.common.base_repository import SQLAlchemyRepository
from app.core import database_factory
from app.core.database_factory import Base, SQLiteDatabase, get_db_session
from app.domains.auth.dependencies import get_current_staff
from app.domains.client.models import Claim, Client
from app.domains.company.models import Company, CompanyContact
from app.domains.contract import api as contract_api
from app.domains.contract.models import ClaimCompany, ContractInstance, ContractSignature, ContractTemplate
from app.domains.contract.service import ContractInstanceService, ContractTemplateService
from app.domains.staff.models import Staff, StaffCompany, StaffRole
from app.domains.water_mitigation.models import WaterMitigationJob, WMSheetPAMapping
import app.main  # noqa: E402,F401  (registers every model, as the app does)

sqlite3.register_adapter(uuid.UUID, str)


@compiles(JSONB, 'sqlite')
def jsonb_as_json(type_, compiler, **kw):
    return 'JSON'


TABLES = [
    Staff, StaffCompany, Company, Client, Claim, ClaimCompany,
    ContractTemplate, ContractInstance, ContractSignature,
    CompanyContact, WaterMitigationJob, WMSheetPAMapping,
]


def make_staff(first, role):
    return Staff(
        staff_number=f'S-{first}', first_name=first, last_name='Test',
        email=f'{first.lower()}@example.com', username=first.lower(),
        role=role, hire_date=datetime(2026, 1, 1),
    )


def pdf_bytes():
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(612, 792))
    pdf.drawString(50, 750, 'Authorization to Perform Work')
    pdf.save()
    return buffer.getvalue()


@pytest.fixture
def env(tmp_path, monkeypatch):
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    sa.event.listen(database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF'))
    Base.metadata.create_all(database.engine, tables=[m.__table__ for m in TABLES])
    # Nothing here may reach the real database, whatever the env file points at
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)

    prepare = SQLAlchemyRepository._prepare_sqlalchemy_data

    def with_datetimes(self, data):
        prepared = prepare(self, data)
        for key, value in prepared.items():
            column = self.model_class.__table__.columns.get(key)
            if column is not None and isinstance(column.type, sa.DateTime) and isinstance(value, str):
                prepared[key] = datetime.fromisoformat(value)
        return prepared

    monkeypatch.setattr(SQLAlchemyRepository, '_prepare_sqlalchemy_data', with_datetimes)

    from app.common.utils import storage_helpers
    from app.domains.storage.factory import StorageFactory

    def fake_upload(file_bytes, filename, **_):
        out = tmp_path / f'{uuid.uuid4()}-{filename}'
        out.write_bytes(file_bytes)
        return {
            'file_url': str(out), 'file_path': str(out), 'file_size': len(file_bytes),
            'storage_provider': 'local', 'storage_file_id': None,
        }

    def no_storage(*_, **__):
        raise RuntimeError('no storage in tests')

    monkeypatch.setattr(storage_helpers, 'upload_bytes_to_storage', fake_upload)
    monkeypatch.setattr(StorageFactory, 'get_instance', no_storage)

    template_pdf = tmp_path / 'template.pdf'
    template_pdf.write_bytes(pdf_bytes())

    session = database.get_session()
    admin = make_staff('Admin', StaffRole.admin)
    rep = make_staff('Rep', StaffRole.contractor)
    outsider = make_staff('Other', StaffRole.contractor)
    harbor = Company(name='Harbor Restoration', company_type='contractor', is_active=True)
    other = Company(name='Other Co', company_type='contractor', is_active=True)
    client = Client(display_name='Pat Example', owners=[], address='9 Oak St', company_id=None, is_active=True)
    for row in (admin, rep, outsider, harbor, other, client):
        session.add(row)
    session.flush()
    claim = Claim(client_id=client.id, claim_number='CL-100', status='open')
    session.add(claim)
    session.flush()
    # Both companies work this claim, so each side can see the other's contracts on it
    session.add(ClaimCompany(claim_id=claim.id, company_id=harbor.id, role='water_mitigation'))
    session.add(ClaimCompany(claim_id=claim.id, company_id=other.id, role='rebuild'))
    template = ContractTemplate(
        company_id=harbor.id, name='Harbor EWA', document_type='authorization',
        file_url=str(template_pdf), storage_provider='local', is_active=True,
    )
    other_template = ContractTemplate(
        company_id=other.id, name='Other EWA', document_type='authorization',
        file_url=str(template_pdf), storage_provider='local', is_active=True,
    )
    session.add(template)
    session.add(other_template)
    session.add(StaffCompany(staff_id=rep.id, company_id=harbor.id))
    session.add(StaffCompany(staff_id=outsider.id, company_id=other.id))
    session.commit()
    ids = {
        'admin': str(admin.id), 'rep': str(rep.id), 'outsider': str(outsider.id),
        'harbor': str(harbor.id), 'other': str(other.id), 'client': str(client.id),
        'claim': str(claim.id), 'template': str(template.id), 'other_template': str(other_template.id),
    }
    roles = {'admin': StaffRole.admin, 'rep': StaffRole.contractor, 'outsider': StaffRole.contractor}
    session.close()

    api = FastAPI()
    api.include_router(contract_api.router, prefix='/contracts')

    def get_db():
        db = database.get_session()
        try:
            yield db
            db.commit()
        finally:
            db.close()

    current = {'as': 'rep'}
    api.dependency_overrides[get_db_session] = get_db
    api.dependency_overrides[get_current_staff] = lambda: SimpleNamespace(
        id=ids[current['as']], role=roles[current['as']]
    )
    instances = ContractInstanceService(database)
    templates = ContractTemplateService(database)
    api.dependency_overrides[contract_api._get_instance_service] = lambda: instances
    api.dependency_overrides[contract_api._get_template_service] = lambda: templates

    sent = []

    class FakeSmtp:
        def send(self, **kwargs):
            sent.append(kwargs)
            return {'success': True}

    from app.domains.claim_followup import smtp_service
    from app.domains.contract import signing_api
    monkeypatch.setattr(smtp_service, 'SmtpService', FakeSmtp)
    monkeypatch.setattr(signing_api, '_find_company_email_account', lambda company_id: f'acct-{company_id}')

    return SimpleNamespace(
        http=TestClient(api, raise_server_exceptions=True), ids=ids, current=current,
        database=database, instances=instances, sent=sent,
    )


def contract_for(env, company='harbor', template='template'):
    return env.instances.create_contract({
        'template_id': env.ids[template], 'company_id': env.ids[company],
        'client_id': env.ids['client'], 'claim_id': env.ids['claim'],
    })


def template_count(env):
    session = env.database.get_session()
    try:
        return session.query(ContractTemplate).count(), session.query(ContractInstance).count()
    finally:
        session.close()


# ── Templates ────────────────────────────────────────────────────────────────


def test_the_list_shows_only_the_callers_companies(env):
    names = [t['name'] for t in env.http.get('/contracts/templates').json()['templates']]
    assert names == ['Harbor EWA']
    other = env.http.get('/contracts/templates', params={'company_id': env.ids['other']}).json()
    assert other == {'templates': [], 'total': 0}
    env.current['as'] = 'admin'
    names = sorted(t['name'] for t in env.http.get('/contracts/templates').json()['templates'])
    assert names == ['Harbor EWA', 'Other EWA']


@pytest.mark.parametrize('method,suffix,kwargs', [
    ('get', '', {}),
    ('put', '', {'json': {'name': 'Hijacked'}}),
    ('post', '/upload', {'files': {'file': ('x.pdf', pdf_bytes(), 'application/pdf')}}),
    ('get', '/field-mappings', {}),
    ('put', '/field-mappings', {'json': {'field_mappings': []}}),
    ('delete', '', {}),
])
def test_another_companys_template_is_out_of_reach(env, method, suffix, kwargs):
    url = f"/contracts/templates/{env.ids['other_template']}{suffix}"
    response = getattr(env.http, method)(url, **kwargs)
    assert response.status_code == 404
    session = env.database.get_session()
    try:
        row = session.query(ContractTemplate).filter(ContractTemplate.id == env.ids['other_template']).one()
        assert row.name == 'Other EWA' and row.field_mappings is None
    finally:
        session.close()


def test_own_template_still_edits(env):
    response = env.http.put(f"/contracts/templates/{env.ids['template']}", json={'name': 'Harbor EWA v2'})
    assert response.status_code == 200, response.text
    assert response.json()['name'] == 'Harbor EWA v2'


def test_a_template_is_only_added_for_your_own_company(env):
    def add(company):
        return env.http.post('/contracts/templates', data={'company_id': env.ids[company], 'name': 'New'},
                             files={'file': ('new.pdf', pdf_bytes(), 'application/pdf')})
    assert add('other').status_code == 403
    assert add('harbor').status_code == 200


def test_a_template_with_contracts_is_not_deleted(env):
    contract_for(env)
    response = env.http.delete(f"/contracts/templates/{env.ids['template']}")
    assert response.status_code == 409
    assert "can't be deleted" in response.json()['detail']
    assert template_count(env) == (2, 1)


def test_an_unused_template_still_deletes(env):
    response = env.http.delete(f"/contracts/templates/{env.ids['template']}")
    assert response.status_code == 200, response.text
    assert template_count(env) == (1, 0)


# ── Contracts ────────────────────────────────────────────────────────────────


def create(env, company, template):
    return env.http.post(f"/contracts/claims/{env.ids['claim']}/contracts", json={
        'template_id': env.ids[template], 'claim_id': env.ids['claim'],
        'client_id': env.ids['client'], 'company_id': env.ids[company],
    })


def test_a_contract_is_only_issued_for_your_own_company(env):
    assert create(env, 'other', 'other_template').status_code == 403
    assert create(env, 'other', 'template').status_code == 403
    assert template_count(env)[1] == 0


def test_the_template_has_to_be_the_issuing_companys(env):
    env.current['as'] = 'admin'
    assert create(env, 'harbor', 'other_template').status_code == 400


def test_own_company_contract_is_issued(env):
    response = create(env, 'harbor', 'template')
    assert response.status_code == 200, response.text


@pytest.mark.parametrize('route', ['send-email', 'send-reminder'])
def test_only_the_issuing_companys_people_send_it(env, route):
    contract = contract_for(env, company='other', template='other_template')
    url = f"/contracts/claims/{env.ids['claim']}/contracts/{contract['id']}/{route}"
    response = env.http.post(url, json={'emails': ['someone@example.com']})
    assert response.status_code == 403
    assert env.sent == []


def test_a_signing_link_points_at_the_app_whatever_origin_url_says(env, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, 'FRONTEND_URL', 'https://app.example.com')
    monkeypatch.setenv('CORS_ORIGINS', 'https://app.example.com,https://staging.example.com')
    contract = contract_for(env)
    url = f"/contracts/claims/{env.ids['claim']}/contracts/{contract['id']}/send-email"

    response = env.http.post(url, json={'emails': ['pat@example.com'], 'origin_url': 'https://evil.example.net'})
    assert response.status_code == 200, response.text
    assert 'https://app.example.com/sign/' in env.sent[-1]['body_html']
    assert 'evil.example.net' not in env.sent[-1]['body_html']

    env.http.post(url, json={'emails': ['pat@example.com'], 'origin_url': 'https://staging.example.com/'})
    assert 'https://staging.example.com/sign/' in env.sent[-1]['body_html']


def test_signing_link_origin_falls_back_to_frontend_url(monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, 'FRONTEND_URL', 'https://app.example.com/')
    monkeypatch.setenv('CORS_ORIGINS', '*')
    assert contract_api._signing_link_origin('https://evil.example.net') == 'https://app.example.com'
    assert contract_api._signing_link_origin(None) == 'https://app.example.com'
    assert contract_api._signing_link_origin('https://app.example.com') == 'https://app.example.com'
