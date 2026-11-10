"""Rebuild completion docs signed with the client's signature on file (the
office applies it, the client not there): the stored images go in the client's
boxes, never one sent from the browser, and the claim's log names who did it.
In-memory SQLite; the template PDF, prefill and storage are stand-ins."""
import base64
import io
import json
import sqlite3
import sys
import uuid
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from PIL import Image
from pypdf import PdfReader
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: F401  registers every model
from app.domains.client.models import Claim, ClaimActivity, Client, ClientSignature
from app.domains.contract.models import ContractTemplate
from app.domains.rebuild import api as rebuild_api
from app.domains.rebuild.models import RebuildCompletionDoc, RebuildContractor, RebuildProject
from app.domains.rebuild.service import RebuildService
from app.domains.staff.models import Staff, StaffRole


@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(type_, compiler, **kw):
    return 'JSON'


sqlite3.register_adapter(uuid.UUID, str)

SIGNATURE = {'pageIndex': 0, 'x': 0.51, 'y': 0.76, 'width': 0.22, 'height': 0.06, 'fieldKey': 'signature.homeowner'}
DATE = {'pageIndex': 0, 'x': 0.51, 'y': 0.84, 'width': 0.22, 'height': 0.03, 'fieldKey': 'date_signed.homeowner'}
INITIAL = {'pageIndex': 0, 'x': 0.1, 'y': 0.9, 'width': 0.08, 'height': 0.04, 'fieldKey': 'initial.homeowner'}
CONTRACTOR = {'pageIndex': 0, 'x': 0.1, 'y': 0.76, 'width': 0.22, 'height': 0.06, 'fieldKey': 'signature.contractor'}
NAME = {'pageIndex': 0, 'x': 0.28, 'y': 0.33, 'width': 0.58, 'height': 0.03, 'fieldKey': 'client.display_name'}


def png(size, color=(20, 20, 120, 255)):
    buf = io.BytesIO()
    Image.new('RGBA', size, color).save(buf, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def template_pdf(pages=1):
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    for _ in range(pages):
        c.drawString(72, 720, 'Certificate of Completion')
        c.showPage()
    c.save()
    return buf.getvalue()


@pytest.fixture
def env(monkeypatch):
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    for model in (Client, Claim, ClaimActivity, ClientSignature, Staff, ContractTemplate, RebuildContractor,
                  RebuildProject, RebuildCompletionDoc):
        model.__table__.create(engine)
    make = sessionmaker(bind=engine)
    database = SimpleNamespace(get_session=make, get_readonly_session=make)

    def service():
        svc = RebuildService(database=database)
        svc._build_prefill_with_session = lambda session, project: {'client': {'display_name': 'Pat Homeowner'}}
        svc._load_template_pdf = lambda url, provider: template_pdf(env.pages)
        return svc

    monkeypatch.setattr(rebuild_api, '_get_service', service)
    monkeypatch.setattr(rebuild_api, '_require_project', lambda *a: None)
    saved = {}

    def fake_upload(file_bytes, filename, **kw):
        saved['pdf'] = file_bytes
        return {'file_url': f'local/{filename}', 'file_path': filename}
    monkeypatch.setattr('app.common.utils.storage_helpers.upload_bytes_to_storage', fake_upload)

    s = make()
    staff = Staff(id=uuid.uuid4(), staff_number='S-1', first_name='Office', last_name='Person',
                  email='office@example.com', role=StaffRole.admin, hire_date=datetime(2024, 1, 1),
                  username='office')
    client = Client(id=uuid.uuid4(), display_name='Pat Homeowner', owners=[])
    claim = Claim(id=uuid.uuid4(), client_id=client.id, claim_number='CLM-1')
    project = RebuildProject(id=uuid.uuid4(), claim_id=claim.id, title='Rebuild - 12 Oak St', status='pending')
    s.add_all([staff, client, claim, project])
    s.commit()
    env = SimpleNamespace(s=s, staff=staff, client=client, claim=claim, project=project, saved=saved, pages=1)
    yield env
    s.close()


def keep(env, kind='signature', size=(300, 100), name='Pat Homeowner'):
    env.s.add(ClientSignature(client_id=env.client.id, kind=kind, signer_name=name,
                              image=png(size), source='uploaded'))
    env.s.commit()


def template(env, mappings):
    row = ContractTemplate(id=uuid.uuid4(), company_id=uuid.uuid4(), name='Certificate of Completion',
                           document_type='certificate_of_completion', file_url='contracts/coc.pdf',
                           field_mappings=json.dumps(mappings))
    env.s.add(row)
    env.s.commit()
    return row


def generate(env, mappings, **data):
    tmpl = template(env, mappings)
    body = {'template_id': str(tmpl.id), 'doc_type': 'coc', 'title': 'Certificate of Completion', **data}
    return rebuild_api.generate_document(str(env.project.id), body, db=env.s, current_staff=env.staff)


def pdf(env):
    return PdfReader(io.BytesIO(env.saved['pdf']))


def activities(env):
    env.s.expire_all()
    return env.s.query(ClaimActivity).filter_by(claim_id=env.claim.id).all()


def test_signs_the_clients_box_with_the_stored_signature_not_a_sent_one(env):
    keep(env, size=(300, 100))
    doc = generate(env, [NAME, SIGNATURE, DATE], signature_on_file=True, authorized=True,
                   signature_image=png((40, 40), (200, 0, 0, 255)), signature_field_key='signature.contractor')
    page = pdf(env).pages[0]
    assert [img.image.size for img in page.images] == [(300, 100)]
    # The client's date box gets the day (MM/DD/YYYY)
    assert any(part.count('/') == 2 and len(part) == 10 for part in page.extract_text().split())
    assert doc['doc_type'] == 'coc'


def test_initials_on_file_go_in_the_clients_initials_boxes(env):
    keep(env, size=(300, 100))
    keep(env, kind='initial', size=(60, 40), name='PH')
    generate(env, [SIGNATURE, DATE, INITIAL], signature_on_file=True, authorized=True)
    sizes = sorted(img.image.size for img in pdf(env).pages[0].images)
    assert sizes == [(60, 40), (300, 100)]


def test_the_claims_log_names_who_applied_it_and_what_they_confirmed(env):
    keep(env)
    doc = generate(env, [SIGNATURE, DATE], signature_on_file=True, authorized=True,
                   authorization_text='Pat Homeowner allowed us to sign this document with their signature on file.')
    [activity] = activities(env)
    assert activity.activity_type == 'signed_on_file'
    assert activity.title == "Certificate of Completion signed with Pat Homeowner's signature on file"
    assert activity.description == (
        'Office Person applied it. Pat Homeowner allowed us to sign this document with their signature on file.')
    assert str(activity.related_entity_id) == str(env.project.id)
    assert str(activity.created_by_id) == str(env.staff.id)
    row = env.s.query(RebuildCompletionDoc).filter_by(id=str(doc['id'])).one()
    assert str(row.created_by_id) == str(env.staff.id)


def test_a_template_without_signature_boxes_takes_it_at_the_bottom_with_the_name(env):
    keep(env, name='Pat Homeowner')
    env.pages = 2
    generate(env, [NAME], signature_on_file=True, authorized=True)
    pages = pdf(env).pages
    assert len(pages[0].images) == 0 and len(pages[1].images) == 1
    assert 'Pat Homeowner' in pages[1].extract_text()


@pytest.mark.parametrize('mappings, data, reason', [
    ([SIGNATURE], {}, 'Confirm the client allowed us'),
    ([CONTRACTOR], {'authorized': True}, "no line for the client's signature"),
])
def test_refused_without_consent_or_a_box_for_the_client(env, mappings, data, reason):
    keep(env)
    with pytest.raises(HTTPException) as err:
        generate(env, mappings, signature_on_file=True, **data)
    assert err.value.status_code == 400 and reason in err.value.detail
    assert env.s.query(RebuildCompletionDoc).count() == 0
    assert activities(env) == []


def test_refused_when_the_client_has_no_signature_on_file(env):
    keep(env, kind='initial')
    with pytest.raises(HTTPException) as err:
        generate(env, [SIGNATURE], signature_on_file=True, authorized=True)
    assert err.value.status_code == 400 and 'no signature on file' in err.value.detail
    assert env.s.query(RebuildCompletionDoc).count() == 0


def test_a_signature_drawn_here_works_as_before_and_logs_nothing(env):
    keep(env)
    generate(env, [SIGNATURE, DATE, INITIAL], signature_image=png((40, 40)), signature_field_key='signature.homeowner')
    # Initials are only filled from the file
    assert [img.image.size for img in pdf(env).pages[0].images] == [(40, 40)]
    assert activities(env) == []
