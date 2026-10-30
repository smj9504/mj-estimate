"""On-site signing: the questions a template asks, and the whole visit from
picking a company to the signed PDF, the new client, the office's todo and
message, and putting the contract on a claim, on a throwaway SQLite database."""

from datetime import datetime
from io import BytesIO
from pathlib import Path
import base64
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
from app.domains.contract import onsite_signing_api
from app.domains.contract.models import ClaimCompany, ContractInstance, ContractSignature, ContractTemplate
from app.domains.contract.onsite_signing import build_questions, expand_answers, missing_fields
from app.domains.messaging.models import Conversation, ConversationParticipant, Message
from app.domains.staff.models import Staff, StaffCompany, StaffRole
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401

sqlite3.register_adapter(uuid.UUID, str)

TABLES = [
    Staff, StaffCompany, Company, Client, Claim, ClaimTodo, ClaimCompany,
    ContractTemplate, ContractInstance, ContractSignature,
    Conversation, ConversationParticipant, Message,
]

# A real 1x1 PNG, so the PDF step can actually draw it
SIGNATURE = (
    'data:image/png;base64,'
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
)

MAPPINGS = [
    {'id': 'f-dol', 'fieldKey': 'claim.date_of_loss', 'label': 'Date of Loss', 'pageIndex': 0, 'x': 0.1, 'y': 0.1},
    {'id': 'f-name', 'fieldKey': 'client.display_name', 'label': 'Client Name', 'pageIndex': 0, 'x': 0.1, 'y': 0.2},
    {'id': 'f-name2', 'fieldKey': 'wm_job.homeowner_name', 'label': 'Homeowner Name', 'pageIndex': 0, 'x': 0.1, 'y': 0.25},
    {'id': 'f-addr', 'fieldKey': 'wm_job.property_address', 'label': 'Property Address', 'pageIndex': 0, 'x': 0.1, 'y': 0.3},
    {'id': 'f-phone', 'fieldKey': 'client.phone', 'label': 'Phone', 'pageIndex': 0, 'x': 0.1, 'y': 0.4},
    {'id': 'f-co', 'fieldKey': 'company.name', 'label': 'Company', 'pageIndex': 0, 'x': 0.1, 'y': 0.5},
    {'id': 'f-today', 'fieldKey': 'meta.current_date', 'label': 'Date', 'pageIndex': 0, 'x': 0.1, 'y': 0.6},
    {'id': 's-home', 'fieldKey': 'signature.homeowner', 'label': 'Homeowner Signature', 'pageIndex': 0, 'x': 0.1, 'y': 0.7},
    {'id': 's-init', 'fieldKey': 'initial.homeowner', 'label': 'Initials', 'pageIndex': 0, 'x': 0.5, 'y': 0.7},
    {'id': 's-date', 'fieldKey': 'date_signed.homeowner', 'label': 'Date Signed', 'pageIndex': 0, 'x': 0.1, 'y': 0.8},
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


@pytest.fixture
def env(tmp_path, monkeypatch):
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    sa.event.listen(
        database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF')
    )
    Base.metadata.create_all(database.engine, tables=[m.__table__ for m in TABLES])
    # Nothing here may reach the real database, whatever the env file points at
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)
    monkeypatch.setattr(onsite_signing_api, 'get_database', lambda: database)

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

    template_pdf = tmp_path / 'template.pdf'
    blank_pdf(template_pdf)

    session = database.get_session()
    admin = make_staff('Admin', StaffRole.admin)
    field = make_staff('Field', StaffRole.contractor)
    outsider = make_staff('Other', StaffRole.contractor)
    bethany = Company(name='Bethany', company_type='contractor', is_active=True)
    plumber = Company(name='Plumber', company_type='other', is_active=True)
    no_template = Company(name='H Remodeling', company_type='contractor', is_active=True)
    other = Company(name='Other Co', company_type='contractor', is_active=True)
    pat = Client(display_name='Pat Client', owners=[], address='9 Oak St', zipcode='22030', phone='555-0001',
                 normalized_address='9 oak st', is_active=True)
    for row in (admin, field, outsider, bethany, plumber, no_template, other, pat):
        session.add(row)
    session.flush()
    pat.company_id = bethany.id

    def template(company, name, purpose, mappings=MAPPINGS):
        row = ContractTemplate(
            company_id=company.id, name=name, document_type='authorization',
            file_url=str(template_pdf), storage_provider='local',
            field_mappings=json.dumps(mappings), signing_purpose=purpose, is_active=True,
        )
        session.add(row)
        return row

    ewa = template(bethany, 'Water Mitigation EWA', 'water_mitigation')
    template(bethany, 'COS', 'work_completion')
    template(plumber, 'Not a contractor', 'water_mitigation')
    template(other, 'Other EWA', 'water_mitigation')
    template(no_template, 'No signature line', 'water_mitigation', [MAPPINGS[1]])
    session.add(StaffCompany(staff_id=field.id, company_id=bethany.id))
    session.add(StaffCompany(staff_id=outsider.id, company_id=other.id))
    claim = Claim(client_id=pat.id, claim_number='CL-1', status='open')
    session.add(claim)
    session.commit()

    ids = {
        'admin': str(admin.id), 'field': str(field.id), 'outsider': str(outsider.id),
        'bethany': str(bethany.id), 'ewa': str(ewa.id), 'pat': str(pat.id), 'claim': str(claim.id),
        'other': str(other.id),
    }
    roles = {'admin': StaffRole.admin, 'field': StaffRole.contractor, 'outsider': StaffRole.contractor}
    session.close()

    api = FastAPI()
    api.include_router(onsite_signing_api.router, prefix='/onsite')
    api.include_router(contract_api.router, prefix='/contracts')

    def get_db():
        db = database.get_session()
        try:
            yield db
            db.commit()
        finally:
            db.close()

    current = {'as': 'field'}
    api.dependency_overrides[get_db_session] = get_db
    api.dependency_overrides[get_current_staff] = lambda: SimpleNamespace(
        id=ids[current['as']], role=roles[current['as']]
    )
    api.dependency_overrides[contract_api._get_instance_service] = (
        lambda: onsite_signing_api.ContractInstanceService(database)
    )
    return SimpleNamespace(
        http=TestClient(api, raise_server_exceptions=True),
        ids=ids, database=database, current=current,
    )


def sign_payload(env, **over):
    payload = {
        'template_id': env.ids['ewa'],
        'company_id': env.ids['bethany'],
        'address': {'street': '12 New Rd', 'city': 'Fairfax', 'state': 'VA', 'zipcode': '22030'},
        'answers': {
            'client.display_name': 'Sam Homeowner',
            'client.full_address': '12 New Rd, Fairfax, VA 22030',
            'client.phone': '555-0002',
            'claim.date_of_loss': '10/01/2026',
        },
        'today': '10/30/2026',
        'signer_name': 'Sam Homeowner',
        'signature_fields': {'s-home': SIGNATURE, 's-init': SIGNATURE},
        'consent_agreed': True,
    }
    payload.update(over)
    return payload


def rows(env, model):
    session = env.database.get_session()
    try:
        return session.query(model).all()
    finally:
        session.close()


# ── The questions ────────────────────────────────────────────────────────────


def test_one_question_per_fact_and_nothing_automatic():
    known = {'company': {'name': 'Bethany'}}
    questions = build_questions(MAPPINGS, known)
    assert [q['key'] for q in questions] == [
        'client.display_name', 'client.full_address', 'client.phone', 'claim.date_of_loss',
    ]
    assert [q['kind'] for q in questions] == ['text', 'address', 'phone', 'date']


def test_the_name_is_asked_first_whatever_order_the_template_maps():
    by_position = [MAPPINGS[3], MAPPINGS[0], MAPPINGS[1]]
    questions = build_questions(by_position, {})
    assert [q['key'] for q in questions] == ['client.display_name', 'client.full_address', 'claim.date_of_loss']


def test_a_gap_in_the_company_record_is_asked_about():
    questions = build_questions(MAPPINGS, {'company': {'name': ''}})
    assert 'company.name' in [q['key'] for q in questions]


def test_what_is_known_is_filled_in_under_any_key():
    questions = build_questions(MAPPINGS, {'client': {'full_address': '9 Oak St'}, 'company': {'name': 'B'}})
    assert next(q for q in questions if q['key'] == 'client.full_address')['value'] == '9 Oak St'


def test_an_answer_fills_every_key_of_its_fact_and_only_what_was_asked():
    prefill = expand_answers(
        {'client.display_name': ' Sam ', 'company.name': 'Forged Co'},
        ['client.display_name'],
    )
    assert prefill == {'client': {'display_name': 'Sam'}, 'wm_job': {'homeowner_name': 'Sam'}}


def test_missing_fields_names_each_fact_once():
    prefill = {'client': {'phone': '555'}, 'meta': {'current_date': 'x'}, 'company': {'name': 'B'}}
    assert missing_fields(MAPPINGS, prefill) == ['Date of Loss', 'Client Name', 'Property Address']


# ── Companies ────────────────────────────────────────────────────────────────


def test_companies_are_contractors_with_something_to_sign_for_this_purpose(env):
    env.current['as'] = 'admin'
    data = env.http.get('/onsite/companies', params={'purpose': 'water_mitigation'}).json()
    assert [c['name'] for c in data['companies']] == ['Bethany', 'Other Co']
    assert [t['name'] for t in data['companies'][0]['templates']] == ['Water Mitigation EWA']


def test_staff_only_see_their_own_companies(env):
    data = env.http.get('/onsite/companies', params={'purpose': 'water_mitigation'}).json()
    assert [c['name'] for c in data['companies']] == ['Bethany']


def test_someone_elses_template_is_not_found(env):
    response = env.http.post('/onsite/form', json={
        'template_id': env.ids['ewa'], 'company_id': env.ids['bethany'], 'address': {'street': '1 A St'},
    })
    assert response.status_code == 200
    env.current['as'] = 'outsider'
    response = env.http.post('/onsite/form', json={
        'template_id': env.ids['ewa'], 'company_id': env.ids['bethany'], 'address': {'street': '1 A St'},
    })
    assert response.status_code == 404


def test_the_form_starts_from_the_client_on_file(env):
    form = env.http.post('/onsite/form', json={
        'template_id': env.ids['ewa'], 'company_id': env.ids['bethany'], 'client_id': env.ids['pat'],
    }).json()
    values = {q['key']: q['value'] for q in form['questions']}
    assert values['client.display_name'] == 'Pat Client'
    assert values['client.phone'] == '555-0001'
    assert values['client.full_address'] == '9 Oak St, 22030'
    assert {f['id'] for f in form['signature_fields']} == {'s-home', 's-init', 's-date'}


def test_preview_draws_the_answers_and_saves_nothing(env):
    response = env.http.post('/onsite/preview', json={
        'template_id': env.ids['ewa'], 'company_id': env.ids['bethany'],
        'answers': {'client.display_name': 'Sam Homeowner'}, 'today': '10/30/2026',
    })
    assert response.status_code == 200
    text = PdfReader(BytesIO(response.content)).pages[0].extract_text()
    assert 'Sam Homeowner' in text and 'Bethany' in text and '10/30/2026' in text
    assert rows(env, ContractInstance) == []
    assert rows(env, Client)[0].display_name == 'Pat Client' and len(rows(env, Client)) == 1


# ── Signing ──────────────────────────────────────────────────────────────────


def test_signing_makes_the_client_the_contract_and_the_signed_pdf(env):
    result = env.http.post('/onsite/contracts', json=sign_payload(env)).json()

    assert result['client_created'] is True and result['client_name'] == 'Sam Homeowner'
    assert result['pdf_ready'] is True and result['missing_fields'] == []
    assert result['office_notified'] is True

    client = next(c for c in rows(env, Client) if str(c.id) == result['client_id'])
    assert client.address == '12 New Rd' and client.normalized_address == '12 new rd'
    assert str(client.company_id) == env.ids['bethany']
    assert client.owners[0] == {'name': 'Sam Homeowner', 'phone': '555-0002', 'email': None, 'is_primary': True}

    contract = rows(env, ContractInstance)[0]
    assert contract.status == 'signed' and contract.claim_id is None
    assert str(contract.client_id) == result['client_id']

    text = PdfReader(contract.signed_pdf_url).pages[0].extract_text()
    for expected in ('Sam Homeowner', '12 New Rd', '555-0002', '10/01/2026', 'Bethany', '10/30/2026'):
        assert expected in text
    signature = rows(env, ContractSignature)[0]
    assert signature.signer_name == 'Sam Homeowner' and signature.signature_image == SIGNATURE
    assert signature.consent_agreed is True


def test_a_contract_signed_on_site_stays_off_the_field_signing_list(env):
    env.http.post('/onsite/contracts', json=sign_payload(env))
    service = onsite_signing_api.ContractInstanceService(env.database)
    assert service.get_contracts_by_company_for_field(env.ids['bethany']) == []


def test_an_existing_client_gets_the_contract_and_stays_as_it_was(env):
    result = env.http.post('/onsite/contracts', json=sign_payload(
        env, client_id=env.ids['pat'], address=None,
    )).json()
    assert result['client_id'] == env.ids['pat'] and result['client_created'] is False
    assert len(rows(env, Client)) == 1
    pat = rows(env, Client)[0]
    assert pat.display_name == 'Pat Client' and pat.phone == '555-0001'


def test_the_same_address_finds_the_client_instead_of_making_another(env):
    result = env.http.post('/onsite/contracts', json=sign_payload(
        env, address={'street': '9 Oak Street', 'zipcode': '22030'},
    )).json()
    assert result['client_id'] == env.ids['pat'] and result['client_created'] is False


def test_a_client_out_of_reach_is_not_found_by_address(env):
    env.current['as'] = 'outsider'
    session = env.database.get_session()
    template_id = str(session.query(ContractTemplate).filter_by(name='Other EWA').first().id)
    session.close()
    result = env.http.post('/onsite/contracts', json=sign_payload(
        env, template_id=template_id, company_id=env.ids['other'],
        address={'street': '9 Oak St', 'zipcode': '22030'},
    )).json()
    assert result['client_id'] != env.ids['pat'] and result['client_created'] is True


def test_every_signature_line_must_be_signed(env):
    response = env.http.post('/onsite/contracts', json=sign_payload(env, signature_fields={'s-home': SIGNATURE}))
    assert response.status_code == 400 and 'Initials' in response.json()['detail']
    assert rows(env, ContractInstance) == [] and len(rows(env, Client)) == 1


def test_a_signature_must_be_an_image(env):
    response = env.http.post('/onsite/contracts', json=sign_payload(
        env, signature_fields={'s-home': 'not an image', 's-init': SIGNATURE},
    ))
    assert response.status_code == 400


def test_consent_and_a_name_are_required(env):
    assert env.http.post('/onsite/contracts', json=sign_payload(env, consent_agreed=False)).status_code == 400
    assert env.http.post('/onsite/contracts', json=sign_payload(env, signer_name='  ')).status_code == 400
    assert rows(env, ContractInstance) == []


# ── The office ───────────────────────────────────────────────────────────────


def test_admins_get_a_todo_and_a_message(env):
    result = env.http.post('/onsite/contracts', json=sign_payload(env)).json()

    todos = rows(env, ClaimTodo)
    assert [str(t.owner_id) for t in todos] == [env.ids['admin']]
    assert str(todos[0].client_id) == result['client_id']
    assert str(todos[0].contract_id) == result['contract_id']
    assert 'Assign signed contract to a claim' in todos[0].title and todos[0].status == 'todo'

    message = rows(env, Message)[0]
    assert str(message.sender_id) == env.ids['field'] and message.kind == 'text'
    assert 'Sam Homeowner' in message.body and message.related_type == 'client'
    assert str(message.related_id) == result['client_id']
    members = {str(p.staff_id) for p in rows(env, ConversationParticipant)}
    assert members == {env.ids['field'], env.ids['admin']}


def test_an_admin_signing_does_not_message_themselves(env):
    env.current['as'] = 'admin'
    env.http.post('/onsite/contracts', json=sign_payload(env))
    assert [str(t.owner_id) for t in rows(env, ClaimTodo)] == [env.ids['admin']]
    assert rows(env, Message) == []


def test_a_failure_telling_the_office_does_not_lose_the_signature(env, monkeypatch):
    from app.domains.client.service import ClaimTodoService

    def boom(*_, **__):
        raise RuntimeError('todo table is down')

    monkeypatch.setattr(ClaimTodoService, 'create_todo', boom)
    response = env.http.post('/onsite/contracts', json=sign_payload(env))
    assert response.status_code == 200
    assert response.json()['office_notified'] is False
    assert rows(env, ContractInstance)[0].status == 'signed'


def test_putting_it_on_a_claim_finishes_every_admins_todo(env):
    env.http.post('/onsite/contracts', json=sign_payload(env, client_id=env.ids['pat'], address=None))
    contract = rows(env, ContractInstance)[0]
    env.current['as'] = 'admin'

    listed = env.http.get(f"/contracts/clients/{env.ids['pat']}/unassigned").json()
    assert [c['id'] for c in listed['contracts']] == [str(contract.id)]

    response = env.http.put(f'/contracts/contracts/{contract.id}/claim', json={'claim_id': env.ids['claim']})
    assert response.status_code == 200

    assert str(rows(env, ContractInstance)[0].claim_id) == env.ids['claim']
    todo = rows(env, ClaimTodo)[0]
    assert todo.status == 'done' and todo.is_completed is True and str(todo.claim_id) == env.ids['claim']
    assert env.http.get(f"/contracts/clients/{env.ids['pat']}/unassigned").json()['contracts'] == []


def test_a_contract_cannot_go_on_another_clients_claim(env):
    env.http.post('/onsite/contracts', json=sign_payload(env))
    contract = rows(env, ContractInstance)[0]
    env.current['as'] = 'admin'
    response = env.http.put(f'/contracts/contracts/{contract.id}/claim', json={'claim_id': env.ids['claim']})
    assert response.status_code == 400
    assert rows(env, ContractInstance)[0].claim_id is None


# ── Email ────────────────────────────────────────────────────────────────────


def test_email_goes_out_only_with_every_field_filled(env, monkeypatch):
    from app.domains.claim_followup import smtp_service
    from app.core.config import settings

    sent = []
    monkeypatch.setattr(smtp_service.SmtpService, '__init__', lambda self: None)
    monkeypatch.setattr(smtp_service.SmtpService, 'send', lambda self, **kw: sent.append(kw))
    monkeypatch.setattr(settings, 'SMTP_USER', 'office@example.com', raising=False)

    skipped = sign_payload(env)
    skipped['answers'] = {**skipped['answers'], 'client.phone': ''}
    result = env.http.post('/onsite/contracts', json=skipped).json()
    assert result['missing_fields'] == ['Phone']

    refused = env.http.post(f"/onsite/contracts/{result['contract_id']}/email", json={'emails': ['a@example.com']})
    assert refused.status_code == 400 and 'Phone' in refused.json()['detail']
    assert sent == []

    full = env.http.post('/onsite/contracts', json=sign_payload(env)).json()
    assert full['missing_fields'] == []
    response = env.http.post(f"/onsite/contracts/{full['contract_id']}/email", json={'emails': ['a@example.com']})
    assert response.status_code == 200
    assert sent[0]['to_addresses'] == ['a@example.com']
    assert sent[0]['attachments'][0]['data'].startswith(b'%PDF')


def test_someone_elses_contract_cannot_be_emailed(env):
    result = env.http.post('/onsite/contracts', json=sign_payload(env)).json()
    env.current['as'] = 'outsider'
    response = env.http.post(f"/onsite/contracts/{result['contract_id']}/email", json={'emails': ['a@example.com']})
    assert response.status_code == 404


def test_signature_image_constant_is_valid():
    assert base64.b64decode(SIGNATURE.split(',', 1)[1]).startswith(b'\x89PNG')
