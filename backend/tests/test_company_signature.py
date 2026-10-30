"""The company signs later: a customer finishes a contract alone from its link, the
office hears about it, and someone at the company signs its lines under their own
name. Also that the field-signing screen needs a login and stays in its own
companies. On a throwaway SQLite database, through the real routes."""

from datetime import datetime
from io import BytesIO
from pathlib import Path
import json
import sqlite3
import sys
from types import SimpleNamespace
import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from pypdf import PdfReader
from reportlab.pdfgen import canvas
import sqlalchemy as sa

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.common.base_repository import SQLAlchemyRepository
from app.core import database_factory
from app.core.database_factory import Base, SQLiteDatabase, get_db_session
from app.domains.auth.dependencies import get_current_staff
from app.domains.client.models import Claim, ClaimTodo, Client
from app.domains.company.models import Company
from app.domains.contract import api as contract_api
from app.domains.contract import field_signing_api, signing_api
from app.domains.contract.models import ClaimCompany, ContractInstance, ContractSignature, ContractTemplate
from app.domains.contract.service import ContractInstanceService
from app.domains.contract.signature_lines import TASK_ASSIGN_CLAIM, open_company_lines
from app.domains.staff.models import Staff, StaffCompany, StaffRole
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401

sqlite3.register_adapter(uuid.UUID, str)

TABLES = [
    Staff, StaffCompany, Company, Client, Claim, ClaimTodo, ClaimCompany,
    ContractTemplate, ContractInstance, ContractSignature,
]

SIGNATURE = (
    'data:image/png;base64,'
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
)
# A different image: a PDF keeps identical ones as one
REP_SIGNATURE = (
    'data:image/png;base64,'
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
)

MAPPINGS = [
    {'id': 'f-name', 'fieldKey': 'client.display_name', 'label': 'Client', 'pageIndex': 0, 'x': 0.1, 'y': 0.1},
    {'id': 's-home', 'fieldKey': 'signature.homeowner', 'label': 'Signature', 'pageIndex': 0, 'x': 0.1, 'y': 0.5,
     'width': 0.3, 'height': 0.05},
    {'id': 's-rep', 'fieldKey': 'signature.company_rep', 'label': 'Rep', 'pageIndex': 0, 'x': 0.5, 'y': 0.5,
     'width': 0.3, 'height': 0.05},
    {'id': 'd-rep', 'fieldKey': 'date_signed.company_rep', 'label': 'Rep date', 'pageIndex': 0, 'x': 0.5, 'y': 0.6,
     'width': 0.3, 'height': 0.03},
]


def make_staff(first, role):
    return Staff(
        staff_number=f'S-{first}', first_name=first, last_name='Test',
        email=f'{first.lower()}@example.com', username=first.lower(),
        role=role, hire_date=datetime(2026, 1, 1),
    )


def blank_pdf(path):
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(612, 792))
    pdf.drawString(50, 750, 'Authorization to Perform Work')
    pdf.save()
    path.write_bytes(buffer.getvalue())


def images_of(path):
    return len(list(PdfReader(path).pages[0].images))


@pytest.fixture
def env(tmp_path, monkeypatch):
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    sa.event.listen(
        database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF')
    )
    Base.metadata.create_all(database.engine, tables=[m.__table__ for m in TABLES])
    # Nothing here may reach the real database, whatever the env file points at
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)

    # The base repository hands datetimes on as ISO strings, which Postgres takes and SQLite won't
    prepare = SQLAlchemyRepository._prepare_sqlalchemy_data

    def with_datetimes(self, data):
        prepared = prepare(self, data)
        for key, value in prepared.items():
            column = self.model_class.__table__.columns.get(key)
            if column is not None and isinstance(column.type, sa.DateTime) and isinstance(value, str):
                prepared[key] = datetime.fromisoformat(value)
        return prepared

    monkeypatch.setattr(SQLAlchemyRepository, '_prepare_sqlalchemy_data', with_datetimes)

    # Storage: local files only, no provider
    from app.common.utils import storage_helpers
    from app.domains.storage.factory import StorageFactory

    def fake_upload(file_bytes, filename, **_):
        out = tmp_path / filename
        out.write_bytes(file_bytes)
        return {'file_url': str(out), 'storage_provider': 'local'}

    def no_storage(*_, **__):
        raise RuntimeError('no storage in tests')

    monkeypatch.setattr(storage_helpers, 'upload_bytes_to_storage', fake_upload)
    monkeypatch.setattr(StorageFactory, 'get_instance', no_storage)

    # What's emailed after a signature, without an email service
    emailed = []
    monkeypatch.setattr(
        signing_api, '_send_signed_notification', lambda _, token, name: emailed.append((token, name))
    )

    template_pdf = tmp_path / 'template.pdf'
    blank_pdf(template_pdf)

    session = database.get_session()
    admin = make_staff('Admin', StaffRole.admin)
    rep = make_staff('Rep', StaffRole.contractor)
    outsider = make_staff('Other', StaffRole.contractor)
    nobody = make_staff('Nobody', StaffRole.contractor)
    bethany = Company(name='Bethany', company_type='contractor', is_active=True)
    other = Company(name='Other Co', company_type='contractor', is_active=True)
    pat = Client(display_name='Pat Client', owners=[], address='9 Oak St', company_id=None, is_active=True)
    for row in (admin, rep, outsider, nobody, bethany, other, pat):
        session.add(row)
    session.flush()
    claim = Claim(client_id=pat.id, claim_number='CL-1', status='open')
    session.add(claim)
    session.flush()
    # Both companies work this claim, so the other company's people can see its contracts
    session.add(ClaimCompany(claim_id=claim.id, company_id=bethany.id, role='water_mitigation'))
    session.add(ClaimCompany(claim_id=claim.id, company_id=other.id, role='rebuild'))
    template = ContractTemplate(
        company_id=bethany.id, name='EWA', document_type='authorization', file_url=str(template_pdf),
        storage_provider='local', field_mappings=json.dumps(MAPPINGS), is_active=True,
    )
    other_template = ContractTemplate(
        company_id=other.id, name='Other EWA', document_type='authorization', file_url=str(template_pdf),
        storage_provider='local', field_mappings=json.dumps(MAPPINGS), is_active=True,
    )
    session.add(template)
    session.add(other_template)
    session.add(StaffCompany(staff_id=rep.id, company_id=bethany.id))
    session.add(StaffCompany(staff_id=outsider.id, company_id=other.id))
    session.commit()

    ids = {
        'admin': str(admin.id), 'rep': str(rep.id), 'outsider': str(outsider.id), 'nobody': str(nobody.id),
        'bethany': str(bethany.id), 'other': str(other.id), 'pat': str(pat.id), 'claim': str(claim.id),
        'template': str(template.id), 'other_template': str(other_template.id),
    }
    roles = {
        'admin': StaffRole.admin, 'rep': StaffRole.contractor,
        'outsider': StaffRole.contractor, 'nobody': StaffRole.contractor,
    }
    session.close()

    api = FastAPI()
    api.include_router(signing_api.router, prefix='/sign')
    api.include_router(contract_api.router, prefix='/contracts')
    api.include_router(field_signing_api.router, prefix='/field-sign')

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
    service = ContractInstanceService(database)
    api.dependency_overrides[contract_api._get_instance_service] = lambda: service
    return SimpleNamespace(
        api=api, http=TestClient(api, raise_server_exceptions=True), ids=ids, database=database,
        current=current, service=service, emailed=emailed,
    )


def signed_by_the_customer(env, **over):
    """A contract the customer signed alone from its link"""
    contract = env.service.create_contract({
        'template_id': env.ids['template'], 'company_id': env.ids['bethany'],
        'client_id': env.ids['pat'], 'claim_id': env.ids['claim'],
    })
    payload = {
        'signer_name': 'Pat Client',
        'signer_role': 'homeowner',
        'signature_image': SIGNATURE,
        'signature_fields': {'s-home': SIGNATURE},
        'consent_agreed': True,
    }
    payload.update(over)
    response = env.http.post(f"/sign/{contract['signing_token']}", json=payload)
    assert response.status_code == 200, response.text
    return env.service.get_by_token(contract['signing_token'])


def company_signature(env, contract_id, **over):
    payload = {
        'signature_fields': {'s-rep': REP_SIGNATURE},
        'today': '10/30/2026',
        'consent_agreed': True,
        'consent_text': 'I agree',
    }
    payload.update(over)
    return env.http.post(f'/contracts/contracts/{contract_id}/company-signature', json=payload)


def todos(env):
    session = env.database.get_session()
    try:
        return [(t.title, str(t.owner_id), t.contract_task, t.status) for t in session.query(ClaimTodo).all()]
    finally:
        session.close()


# ── Which lines are open ─────────────────────────────────────────────────────


def test_the_lines_a_signature_filled_are_closed():
    lines = open_company_lines(json.dumps(MAPPINGS), [json.dumps(['s-home'])])
    assert [line['id'] for line in lines] == ['s-rep', 'd-rep']
    assert lines[0]['fieldType'] == 'signature' and lines[0]['signerRole'] == 'company_rep'
    assert open_company_lines(json.dumps(MAPPINGS), [json.dumps(['s-home', 's-rep', 'd-rep'])]) == []


def test_nothing_is_open_before_the_customer_signs():
    assert open_company_lines(json.dumps(MAPPINGS), []) == []


def test_a_signature_from_before_lines_were_recorded_counts_as_finished():
    # Its rep line most likely took the customer's mark, so it mustn't look blank
    assert open_company_lines(json.dumps(MAPPINGS), [None]) == []


def test_a_date_alone_is_nothing_to_sign():
    only_date = [m for m in MAPPINGS if m['id'] != 's-rep']
    assert open_company_lines(json.dumps(only_date), [json.dumps(['s-home'])]) == []


def test_broken_mappings_dont_break_the_contract_lists():
    assert open_company_lines('not json', [json.dumps([])]) == []
    assert open_company_lines(None, [json.dumps([])]) == []


# ── The customer signs, the office hears ─────────────────────────────────────


def test_a_customer_leaving_the_company_lines_tells_every_admin(env):
    contract = signed_by_the_customer(env)

    assert contract['status'] == 'signed'
    assert [line['id'] for line in contract['open_company_lines']] == ['s-rep', 'd-rep']
    assert todos(env) == [
        ('Sign for the company: EWA, 9 Oak St', env.ids['admin'], 'company_signature', 'todo'),
    ]


def test_a_rep_signing_on_the_customers_device_leaves_nothing_to_ask(env):
    contract = signed_by_the_customer(env, signature_fields={'s-home': SIGNATURE, 's-rep': REP_SIGNATURE})
    assert contract['open_company_lines'] == [] and todos(env) == []


def test_a_draft_has_nothing_waiting_on_the_company(env):
    contract = env.service.create_contract({
        'template_id': env.ids['template'], 'company_id': env.ids['bethany'],
        'client_id': env.ids['pat'], 'claim_id': env.ids['claim'],
    })
    assert env.service.get_by_id_enriched(str(contract['id']))['open_company_lines'] == []


def test_the_link_only_signs_once_so_its_holder_cant_sign_for_the_company(env):
    contract = signed_by_the_customer(env)
    response = env.http.post(f"/sign/{contract['signing_token']}", json={
        'signer_name': 'Pat Client',
        'signer_role': 'company_rep',
        'signature_image': SIGNATURE,
        'signature_fields': {'s-rep': SIGNATURE},
        'consent_agreed': True,
    })
    assert response.status_code == 400
    stored = env.service.get_by_token(contract['signing_token'])
    assert stored['signature_count'] == 1 and images_of(stored['signed_pdf_url']) == 1


# ── The company signs ────────────────────────────────────────────────────────


def test_someone_at_the_company_signs_under_their_own_name(env, monkeypatch):
    # Storage is off here, and the hash reads the PDF back from it
    monkeypatch.setattr(ContractInstanceService, '_compute_pdf_hash', lambda *_: 'hash-of-the-pdf')
    contract = signed_by_the_customer(env)

    response = company_signature(env, contract['id'])

    assert response.status_code == 200, response.text
    signed = response.json()
    assert signed['open_company_lines'] == [] and signed['status'] == 'signed'
    # Both signatures on the PDF, and the customer's signing date still the contract's
    assert images_of(signed['signed_pdf_url']) == 2
    assert env.service.get_by_token(contract['signing_token'])['signed_at'] == contract['signed_at']
    assert '10/30/2026' in PdfReader(signed['signed_pdf_url']).pages[0].extract_text()

    new = signed['signatures'][-1]
    assert new['signer_name'] == 'Rep Test' and new['signer_role'] == 'company_rep'
    assert new['signature_image'] == REP_SIGNATURE and new['consent_agreed'] is True
    assert new['document_hash'] == 'hash-of-the-pdf'
    assert json.loads(new['signed_field_ids']) == ['d-rep', 's-rep']


def test_signing_finishes_the_todo_and_sends_the_finished_pdf(env):
    contract = signed_by_the_customer(env)
    env.emailed.clear()

    assert company_signature(env, contract['id']).status_code == 200

    assert [t[3] for t in todos(env)] == ['done']
    assert env.emailed == [(contract['signing_token'], 'Rep Test')]


def test_the_customer_can_see_the_finished_pdf_from_their_link(env):
    contract = signed_by_the_customer(env)
    company_signature(env, contract['id'])
    response = env.http.get(f"/sign/{contract['signing_token']}/pdf")
    assert len(list(PdfReader(BytesIO(response.content)).pages[0].images)) == 2


def test_it_can_only_be_signed_once(env):
    contract = signed_by_the_customer(env)
    company_signature(env, contract['id'])
    assert company_signature(env, contract['id']).status_code == 409
    assert env.service.get_by_token(contract['signing_token'])['signature_count'] == 2


def test_it_needs_consent_and_a_real_signature(env):
    contract = signed_by_the_customer(env)
    assert company_signature(env, contract['id'], consent_agreed=False).status_code == 400
    assert company_signature(env, contract['id'], signature_fields={}).status_code == 400
    assert company_signature(env, contract['id'], signature_fields={'s-rep': 'not an image'}).status_code == 400
    assert env.service.get_by_token(contract['signing_token'])['signature_count'] == 1


def test_other_lines_cant_be_drawn_on_through_it(env):
    contract = signed_by_the_customer(env)
    response = company_signature(env, contract['id'], signature_fields={'s-rep': REP_SIGNATURE, 's-home': REP_SIGNATURE})
    assert response.status_code == 200
    # Still the customer's signature and the rep's, nothing over the customer's line
    assert images_of(response.json()['signed_pdf_url']) == 2


def test_only_someone_at_the_issuing_company_can_sign(env):
    contract = signed_by_the_customer(env)

    env.current['as'] = 'outsider'  # On the same claim, for a different company
    assert company_signature(env, contract['id']).status_code == 403
    env.current['as'] = 'nobody'  # Can't see it at all
    assert company_signature(env, contract['id']).status_code == 404
    env.current['as'] = 'admin'
    assert company_signature(env, contract['id']).status_code == 200


def test_nothing_is_recorded_when_the_pdf_cant_be_made(env):
    contract = signed_by_the_customer(env)
    Path(contract['signed_pdf_url']).unlink()

    response = company_signature(env, contract['id'])

    assert response.status_code == 500
    stored = env.service.get_by_token(contract['signing_token'])
    assert stored['signature_count'] == 1 and stored['signed_pdf_url'] == contract['signed_pdf_url']
    assert [t[3] for t in todos(env)] == ['todo']


def test_a_customer_signature_with_no_pdf_isnt_signed_over(env):
    contract = signed_by_the_customer(env)
    session = env.database.get_session()
    session.query(ContractInstance).update({'signed_pdf_url': None})
    session.commit()
    session.close()

    assert company_signature(env, contract['id']).status_code == 500
    assert env.service.get_by_token(contract['signing_token'])['signature_count'] == 1


def test_a_contract_signed_before_this_isnt_offered(env):
    contract = signed_by_the_customer(env)
    session = env.database.get_session()
    session.query(ContractSignature).update({'signed_field_ids': None})
    session.commit()
    session.close()

    assert env.service.get_by_token(contract['signing_token'])['open_company_lines'] == []
    assert company_signature(env, contract['id']).status_code == 409


def test_a_voided_contract_isnt_offered(env):
    contract = signed_by_the_customer(env)
    env.service.update(str(contract['id']), {'status': 'voided'})
    assert env.service.get_by_token(contract['signing_token'])['open_company_lines'] == []
    assert company_signature(env, contract['id']).status_code == 409


# ── Each todo finishes with its own task ─────────────────────────────────────


def test_putting_it_on_a_claim_leaves_the_signature_todo_and_vice_versa(env):
    contract = signed_by_the_customer(env)
    session = env.database.get_session()
    session.add(ClaimTodo(
        title='Assign', owner_id=env.ids['admin'], contract_id=str(contract['id']),
        contract_task=TASK_ASSIGN_CLAIM, status='todo',
    ))
    session.commit()
    session.close()

    env.service.assign_to_claim(str(contract['id']), env.ids['claim'])
    assert {t[2]: t[3] for t in todos(env)} == {'company_signature': 'todo', 'assign_claim': 'done'}

    session = env.database.get_session()
    session.query(ClaimTodo).filter(ClaimTodo.contract_task == TASK_ASSIGN_CLAIM).update({'status': 'todo'})
    session.commit()
    session.close()

    company_signature(env, contract['id'])
    assert {t[2]: t[3] for t in todos(env)} == {'company_signature': 'done', 'assign_claim': 'todo'}


# ── The field-signing screen needs a login ───────────────────────────────────


def field_routes(env, token='some-token'):
    return [
        ('get', '/field-sign/companies', None),
        ('get', f"/field-sign/companies/{env.ids['bethany']}/contracts", None),
        ('get', f"/field-sign/companies/{env.ids['bethany']}/templates", None),
        ('post', '/field-sign/create', {'template_id': env.ids['template'], 'company_id': env.ids['bethany']}),
        ('get', f'/field-sign/{token}/view', None),
        ('put', f'/field-sign/{token}/prefill', {'prefill_data': {}}),
        ('post', f'/field-sign/{token}/send-email', {'emails': ['a@example.com']}),
    ]


def test_no_field_signing_route_opens_without_a_login(env):
    # The real auth dependency this time
    del env.api.dependency_overrides[get_current_staff]
    for method, path, body in field_routes(env):
        response = env.http.request(method, path, json=body)
        assert response.status_code in (401, 403), f'{method} {path}: {response.status_code}'


def test_the_customers_link_still_opens_without_a_login(env):
    contract = env.service.create_contract({
        'template_id': env.ids['template'], 'company_id': env.ids['bethany'],
        'client_id': env.ids['pat'], 'claim_id': env.ids['claim'],
    })
    del env.api.dependency_overrides[get_current_staff]
    assert env.http.get(f"/sign/{contract['signing_token']}").status_code == 200
    assert env.http.get(f"/sign/{contract['signing_token']}/pdf").status_code == 200


def test_field_signing_lists_only_this_persons_companies(env):
    names = lambda: [c['name'] for c in env.http.get('/field-sign/companies').json()['companies']]  # noqa: E731
    assert names() == ['Bethany']
    env.current['as'] = 'nobody'
    assert names() == []
    env.current['as'] = 'admin'
    assert names() == ['Bethany', 'Other Co']


def test_field_signing_keeps_out_of_another_companys_contracts(env):
    made = env.http.post('/field-sign/create', json={
        'template_id': env.ids['other_template'], 'company_id': env.ids['other'],
    })
    assert made.status_code == 404

    env.current['as'] = 'outsider'
    made = env.http.post('/field-sign/create', json={
        'template_id': env.ids['other_template'], 'company_id': env.ids['other'],
    })
    assert made.status_code == 200, made.text
    token = made.json()['signing_token']

    env.current['as'] = 'rep'
    assert env.http.get(f"/field-sign/companies/{env.ids['other']}/contracts").status_code == 404
    assert env.http.get(f"/field-sign/companies/{env.ids['other']}/templates").status_code == 404
    for method, path, body in field_routes(env, token)[4:]:
        assert env.http.request(method, path, json=body).status_code == 404, path

    env.current['as'] = 'outsider'
    assert env.http.get(f'/field-sign/{token}/view').status_code == 200
    contracts = env.http.get(f"/field-sign/companies/{env.ids['other']}/contracts").json()['contracts']
    assert [c['signing_token'] for c in contracts] == [token]


def test_a_template_of_another_company_cant_be_used(env):
    made = env.http.post('/field-sign/create', json={
        'template_id': env.ids['other_template'], 'company_id': env.ids['bethany'],
    })
    assert made.status_code == 404
