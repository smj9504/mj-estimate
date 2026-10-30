"""The filled PDF: a contract made from a template carries its text from the start,
and whatever reaches the signed PDF is what was entered, once. On a throwaway
SQLite database, through the real signing route."""

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
from app.core.database_factory import Base, SQLiteDatabase
from app.domains.client.models import Claim, Client
from app.domains.company.models import Company
from app.domains.contract import signing_api
from app.domains.contract.models import ClaimCompany, ContractInstance, ContractSignature, ContractTemplate
from app.domains.contract.service import ContractInstanceService
from app.domains.staff.models import Staff
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401

sqlite3.register_adapter(uuid.UUID, str)

TABLES = [Staff, Company, Client, Claim, ClaimCompany, ContractTemplate, ContractInstance, ContractSignature]

# A real 1x1 PNG, so the PDF step can actually draw it
SIGNATURE = (
    'data:image/png;base64,'
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
)

# Someone else's: a different image, since a PDF keeps identical ones as one
OTHER_SIGNATURE = (
    'data:image/png;base64,'
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
)

MAPPINGS = [
    {'id': 'f-name', 'fieldKey': 'client.display_name', 'label': 'Client', 'pageIndex': 0, 'x': 0.1, 'y': 0.1},
    {'id': 'f-co', 'fieldKey': 'company.name', 'label': 'Company', 'pageIndex': 0, 'x': 0.1, 'y': 0.2},
    {'id': 'f-num', 'fieldKey': 'meta.contract_number', 'label': 'Number', 'pageIndex': 0, 'x': 0.1, 'y': 0.3},
    {'id': 'f-job', 'fieldKey': 'custom.field_1', 'label': 'Job code', 'pageIndex': 0, 'x': 0.1, 'y': 0.4,
     'inputMode': 'signer'},
    {'id': 's-home', 'fieldKey': 'signature.homeowner', 'label': 'Signature', 'pageIndex': 0, 'x': 0.1, 'y': 0.6,
     'width': 0.3, 'height': 0.05},
    {'id': 's-rep', 'fieldKey': 'signature.company_rep', 'label': 'Rep', 'pageIndex': 0, 'x': 0.5, 'y': 0.6,
     'width': 0.3, 'height': 0.05},
]


def blank_pdf(path):
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(612, 792))
    pdf.drawString(50, 750, 'Authorization to Perform Work')
    pdf.save()
    path.write_bytes(buffer.getvalue())


def text_of(path_or_bytes):
    source = BytesIO(path_or_bytes) if isinstance(path_or_bytes, bytes) else path_or_bytes
    return PdfReader(source).pages[0].extract_text()


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

    template_pdf = tmp_path / 'template.pdf'
    blank_pdf(template_pdf)

    session = database.get_session()
    company = Company(name='Bethany', company_type='contractor', is_active=True)
    client = Client(display_name='Pat Client', owners=[], is_active=True)
    session.add(company)
    session.add(client)
    session.flush()
    template = ContractTemplate(
        company_id=company.id, name='EWA', document_type='authorization', file_url=str(template_pdf),
        storage_provider='local', field_mappings=json.dumps(MAPPINGS), is_active=True,
    )
    session.add(template)
    session.commit()
    ids = {'company': str(company.id), 'client': str(client.id), 'template': str(template.id)}
    session.close()

    api = FastAPI()
    api.include_router(signing_api.router, prefix='/sign')
    return SimpleNamespace(
        http=TestClient(api, raise_server_exceptions=True),
        service=ContractInstanceService(database),
        database=database,
        ids=ids,
    )


def make_contract(env, **over):
    data = {'template_id': env.ids['template'], 'company_id': env.ids['company'], 'client_id': env.ids['client']}
    data.update(over)
    return env.service.create_contract(data)


def signing_payload(**over):
    payload = {
        'signer_name': 'Pat Client',
        'signer_role': 'homeowner',
        'signature_image': SIGNATURE,
        'signature_type': 'drawn',
        'signature_fields': {'s-home': SIGNATURE},
        'consent_agreed': True,
    }
    payload.update(over)
    return payload


def sign(env, token, **over):
    response = env.http.post(f'/sign/{token}', json=signing_payload(**over))
    assert response.status_code == 200, response.text
    return env.service.get_by_token(token)


def test_a_new_contract_gets_its_filled_pdf(env):
    contract = make_contract(env)
    stored = env.service.get_by_token(contract['signing_token'])

    assert stored['filled_pdf_url'] and stored['filled_pdf_provider'] == 'local'
    text = text_of(stored['filled_pdf_url'])
    assert 'Pat Client' in text and 'Bethany' in text
    assert stored['contract_number'] in text


def test_a_field_left_to_the_signer_stays_blank_until_they_fill_it(env):
    contract = make_contract(env, prefill_overrides={'custom': {'field_1': 'JOB-7'}})
    stored = env.service.get_by_token(contract['signing_token'])
    assert 'JOB-7' not in text_of(stored['filled_pdf_url'])


def test_the_public_pdf_link_serves_the_filled_pdf(env):
    contract = make_contract(env)
    response = env.http.get(f"/sign/{contract['signing_token']}/pdf")
    assert response.status_code == 200
    assert 'Pat Client' in text_of(response.content)


def test_signing_keeps_the_text_once_and_adds_the_signature(env):
    contract = make_contract(env)
    signed = sign(env, contract['signing_token'])

    assert signed['status'] == 'signed' and signed['signed_pdf_url']
    text = text_of(signed['signed_pdf_url'])
    assert text.count('Pat Client') == 1 and text.count('Bethany') == 1
    assert images_of(signed['signed_pdf_url']) == 1


def test_what_the_signer_typed_is_on_the_signed_pdf_once(env):
    contract = make_contract(env)
    signed = sign(env, contract['signing_token'], signer_field_values={'custom.field_1': 'JOB-7'})

    text = text_of(signed['signed_pdf_url'])
    assert text.count('JOB-7') == 1 and text.count('Pat Client') == 1


def test_values_saved_before_signing_reach_the_document(env):
    contract = make_contract(env)
    token = contract['signing_token']
    first = env.service.get_by_token(token)['filled_pdf_url']

    env.service.update_prefill_and_regenerate(token, {'client': {'display_name': 'Sam Homeowner'}, 'custom': {'field_1': 'JOB-9'}})
    stored = env.service.get_by_token(token)
    assert stored['filled_pdf_url'] != first
    assert 'Sam Homeowner' in text_of(stored['filled_pdf_url'])
    assert 'JOB-9' in text_of(stored['filled_pdf_url'])
    assert 'Pat Client' not in text_of(stored['filled_pdf_url'])

    signed = sign(env, token)
    text = text_of(signed['signed_pdf_url'])
    assert text.count('Sam Homeowner') == 1 and text.count('JOB-9') == 1 and 'Pat Client' not in text


def test_a_failed_regeneration_never_lets_the_old_values_be_signed(env, monkeypatch):
    contract = make_contract(env)
    token = contract['signing_token']
    monkeypatch.setattr(ContractInstanceService, '_generate_filled_pdf', lambda *_, **__: None)

    env.service.update_prefill_and_regenerate(token, {'client': {'display_name': 'Sam Homeowner'}})
    stored = env.service.get_by_token(token)
    assert stored['filled_pdf_url'] is None and stored['filled_pdf_provider'] is None

    signed = sign(env, token)
    text = text_of(signed['signed_pdf_url'])
    assert text.count('Sam Homeowner') == 1 and 'Pat Client' not in text


def test_a_filled_pdf_that_is_gone_does_not_cost_the_signed_pdf(env):
    contract = make_contract(env)
    token = contract['signing_token']
    Path(env.service.get_by_token(token)['filled_pdf_url']).unlink()

    signed = sign(env, token)
    assert signed['signed_pdf_url']
    assert text_of(signed['signed_pdf_url']).count('Pat Client') == 1
    assert images_of(signed['signed_pdf_url']) == 1


def test_a_link_signs_only_once(env):
    token = make_contract(env)['signing_token']
    first = sign(env, token)

    response = env.http.post(f'/sign/{token}', json=signing_payload(
        signer_name='Rep', signer_role='company_rep', signature_fields={'s-rep': OTHER_SIGNATURE},
    ))

    assert response.status_code == 400
    stored = env.service.get_by_token(token)
    assert stored['signed_pdf_url'] == first['signed_pdf_url'] and len(stored['signatures']) == 1


def test_a_contract_made_without_a_filled_pdf_still_signs(env):
    # Drafts from before the fix have none, and field contracts until their fields are saved
    contract = env.service.create_field_contract({
        'template_id': env.ids['template'], 'company_id': env.ids['company'],
    })
    token = contract['signing_token']
    assert env.service.get_by_token(token).get('filled_pdf_url') is None

    env.service.update_prefill_and_regenerate(token, {'client': {'display_name': 'Sam Homeowner'}})
    signed = sign(env, token)
    assert text_of(signed['signed_pdf_url']).count('Sam Homeowner') == 1


@pytest.mark.parametrize('name', ['', '   '])
def test_a_signature_without_a_name_is_refused(env, name):
    contract = make_contract(env)
    token = contract['signing_token']

    response = env.http.post(f'/sign/{token}', json=signing_payload(signer_name=name))

    assert response.status_code == 422
    stored = env.service.get_by_token(token)
    assert stored['status'] != 'signed' and not stored.get('signatures')


def test_a_signature_with_no_name_field_is_refused(env):
    contract = make_contract(env)
    payload = signing_payload()
    del payload['signer_name']
    assert env.http.post(f"/sign/{contract['signing_token']}", json=payload).status_code == 422


def test_the_signers_name_is_recorded(env):
    contract = make_contract(env)
    signed = sign(env, contract['signing_token'], signer_name='  Sam Lee ')
    assert [s['signer_name'] for s in signed['signatures']] == ['Sam Lee']


def test_someone_elses_line_stays_blank_unless_they_signed_it(env):
    token = make_contract(env)['signing_token']
    assert images_of(sign(env, token)['signed_pdf_url']) == 1

    token = make_contract(env)['signing_token']
    both = {'s-home': SIGNATURE, 's-rep': OTHER_SIGNATURE}
    assert images_of(sign(env, token, signature_fields=both)['signed_pdf_url']) == 2


def test_the_signed_email_does_not_take_a_name_as_html(env, monkeypatch):
    from app.domains.claim_followup import smtp_service

    sent = {}

    class FakeSmtp:
        def send(self, **kwargs):
            sent.update(kwargs)

    monkeypatch.setattr(smtp_service, 'SmtpService', FakeSmtp)
    monkeypatch.setattr(signing_api, '_find_company_email_account', lambda _: 'account')
    session = env.database.get_session()
    session.query(Company).update({'email': 'office@example.com'})
    session.commit()
    session.close()

    contract = make_contract(env)
    signing_api._send_signed_notification(env.service, contract['signing_token'], '<a href="http://x">Sam</a>')

    assert '<a href="http://x">' not in sent['body_html']
    assert '&lt;a href=' in sent['body_html']
