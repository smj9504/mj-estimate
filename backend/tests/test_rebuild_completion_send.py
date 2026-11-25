"""A Rebuild project's completion documents taken out together
(rebuild/completion_send.py): downloaded at once as a ZIP or one PDF, and
emailed to the public adjuster or anyone, marking them sent."""
import io
import sqlite3
import sys
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def pdf_bytes(text):
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    c.drawString(72, 720, text)
    c.save()
    return buf.getvalue()


@pytest.fixture
def env(tmp_path, monkeypatch):
    import sqlalchemy as sa
    from sqlalchemy.dialects.postgresql import JSONB
    from sqlalchemy.dialects.sqlite import base as sqlite_base
    from sqlalchemy.ext.compiler import compiles

    import app.main  # noqa: F401  registers every model
    from app.core import database_factory
    from app.core.database_factory import Base, SQLiteDatabase
    from app.domains.client.models import Claim, ClaimActivity, Client
    from app.domains.company.models import Company, CompanyContact
    from app.domains.contract.models import ClaimCompany
    from app.domains.rebuild import api as rebuild_api
    from app.domains.rebuild.models import RebuildCompletionDoc, RebuildContractor, RebuildProject
    from app.domains.rebuild.service import RebuildService
    from app.domains.staff.models import Staff, StaffRole

    @compiles(JSONB, 'sqlite')
    def _jsonb(type_, compiler, **kw):
        return 'JSON'

    sqlite3.register_adapter(uuid.UUID, str)
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
    sa.event.listen(database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF'))
    tables = [Staff, Company, CompanyContact, ClaimCompany, Client, Claim, ClaimActivity,
              RebuildContractor, RebuildProject, RebuildCompletionDoc]
    Base.metadata.create_all(database.engine, tables=[m.__table__ for m in tables])
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)
    monkeypatch.setattr(rebuild_api, '_get_service', lambda: RebuildService(database=database))
    monkeypatch.setattr(rebuild_api, '_require_project', lambda *a: None)

    stored = {}

    class FakeStorage:
        def download(self, url):
            if url not in stored:
                raise FileNotFoundError(url)
            return stored[url]
    monkeypatch.setattr('app.domains.storage.factory.StorageFactory.get_instance', lambda *a, **k: FakeStorage())
    sent = []
    monkeypatch.setattr('app.domains.claim_followup.service.require_sending_account', lambda *a, **k: None)
    monkeypatch.setattr('app.domains.claim_followup.service.ClaimFollowUpService.send_email',
                        lambda self, payload, sender: sent.append(payload) or {'id': 'mail-1'})

    s = database.get_session()
    boss = Staff(staff_number='BOSS', first_name='Boss', last_name='Tester', email='boss@example.com',
                 role=StaffRole.super_admin, hire_date=datetime(2026, 1, 1), username='boss',
                 is_active=True, can_login=True)
    company = Company(name='MJ Rebuild', company_type='contractor')
    pa_firm = Company(name='Best PA', company_type='public_adjuster')
    client = Client(display_name='Pat Homeowner', owners=[], email='pat@example.com')
    for row in [boss, company, pa_firm, client]:
        s.add(row)
    s.flush()
    pa = CompanyContact(company_id=pa_firm.id, name='Paula Adjuster', email='paula@bestpa.com')
    s.add(pa)
    s.flush()
    claim = Claim(client_id=client.id, claim_number='CLM-0042', adjuster_name='Carl Carrier',
                  adjuster_email='carl@carrier.com', pa_contact_id=str(pa.id))
    s.add(claim)
    s.flush()
    s.add(ClaimCompany(claim_id=claim.id, company_id=company.id, role='reconstruction'))
    project = RebuildProject(claim_id=claim.id, title='Rebuild', status='completed',
                             property_address='12 Oak St, Fairfax, VA 22030')
    s.add(project)
    s.flush()

    def add_doc(doc_type, title, content=None, file_name=None):
        url = f'b2://docs/{uuid.uuid4()}.pdf' if content is not None else None
        if content is not None:
            stored[url] = content
        doc = RebuildCompletionDoc(project_id=project.id, doc_type=doc_type, title=title,
                                   file_url=url, file_name=file_name, status='final')
        s.add(doc)
        s.flush()
        return doc

    photos = add_doc('completion_photo', 'Completion Photos', pdf_bytes('photos'), '12 Oak St - Completion Photos.pdf')
    coc = add_doc('coc', 'Certificate of Completion', pdf_bytes('coc'), 'COC_12_Oak_St.pdf')
    invoice = add_doc('invoice', 'Invoice MJ-0042', pdf_bytes('invoice'), '12 Oak St - Invoice MJ-0042.pdf')
    add_doc('other', 'Lien waiver (mailed)')  # recorded, no file
    s.commit()
    yield SimpleNamespace(db=s, project=project, boss=boss, docs=SimpleNamespace(coc=coc, invoice=invoice, photos=photos),
                          stored=stored, sent=sent, api=rebuild_api)
    s.close()


def test_every_document_with_a_file_downloads_as_a_zip_in_checklist_order(env):
    resp = env.api.download_completion_docs(project_id=str(env.project.id), format='zip', ids=None,
                                            db=env.db, current_staff=env.boss)
    assert resp.media_type == 'application/zip'
    assert 'Completion Documents.zip' in resp.headers['content-disposition']
    names = zipfile.ZipFile(io.BytesIO(resp.body)).namelist()
    assert names == ['COC_12_Oak_St.pdf', '12 Oak St - Invoice MJ-0042.pdf', '12 Oak St - Completion Photos.pdf']


def test_or_as_one_pdf(env):
    from pypdf import PdfReader

    resp = env.api.download_completion_docs(project_id=str(env.project.id), format='pdf', ids=None,
                                            db=env.db, current_staff=env.boss)
    pages = PdfReader(io.BytesIO(resp.body)).pages
    assert [p.extract_text().strip() for p in pages] == ['coc', 'invoice', 'photos']
    assert '12 Oak St, Fairfax, VA 22030 - Completion Documents.pdf' in resp.headers['content-disposition']


def test_the_chosen_ones_only_in_the_order_chosen(env):
    ids = f'{env.docs.invoice.id},{env.docs.coc.id}'
    resp = env.api.download_completion_docs(project_id=str(env.project.id), format='zip', ids=ids,
                                            db=env.db, current_staff=env.boss)
    assert zipfile.ZipFile(io.BytesIO(resp.body)).namelist() == ['12 Oak St - Invoice MJ-0042.pdf', 'COC_12_Oak_St.pdf']


def test_the_email_dialog_offers_the_pa_the_adjuster_and_the_client(env):
    info = env.api.completion_docs_email_info(project_id=str(env.project.id), db=env.db, current_staff=env.boss)
    assert [(r['email'], r['role']) for r in info['recipients']] == [
        ('paula@bestpa.com', 'pa'), ('carl@carrier.com', 'adjuster'), ('pat@example.com', 'client'),
    ]
    assert info['subject'] == 'CLM-0042 - 12 Oak St - Completion Documents'


def test_emailing_attaches_them_and_marks_them_sent(env):
    from app.domains.client.models import ClaimActivity
    from app.domains.rebuild.models import RebuildCompletionDoc

    result = env.api.send_completion_docs(project_id=str(env.project.id), data={
        'doc_ids': [str(env.docs.coc.id), str(env.docs.invoice.id), str(env.docs.photos.id)],
        'to_addresses': ['paula@bestpa.com'], 'cc_addresses': ['carl@carrier.com'],
        'subject': 'Completion documents', 'body_html': '<p>Attached.</p>', 'email_account_id': 'acct-1',
    }, db=env.db, current_staff=env.boss)
    env.db.commit()

    assert result['attachments_count'] == 3
    [mail] = env.sent
    assert mail['to_addresses'] == ['paula@bestpa.com']
    assert mail['display_name'] == 'MJ Rebuild'
    assert [a['filename'] for a in mail['attachments']] == [
        'COC_12_Oak_St.pdf', '12 Oak St - Invoice MJ-0042.pdf', '12 Oak St - Completion Photos.pdf']
    assert mail['claim_id'] == str(env.project.claim_id)

    env.db.refresh(env.project)
    assert env.project.coc_sent and env.project.invoice_sent and env.project.photos_sent
    assert env.project.docs_sent_to == 'both'
    assert env.project.docs_sent_date is not None
    statuses = {d.title: d.status for d in env.db.query(RebuildCompletionDoc).all()}
    assert statuses['Certificate of Completion'] == 'sent'
    assert statuses['Lien waiver (mailed)'] == 'final'
    assert env.db.query(ClaimActivity).filter(ClaimActivity.activity_type == 'rebuild_documents_emailed').count() == 1


def test_sent_without_marking_leaves_the_checklist_alone(env):
    env.api.send_completion_docs(project_id=str(env.project.id), data={
        'doc_ids': [str(env.docs.coc.id)], 'to_addresses': ['someone@example.com'],
        'email_account_id': 'acct-1', 'mark_sent': False,
    }, db=env.db, current_staff=env.boss)
    env.db.commit()
    env.db.refresh(env.project)
    assert not env.project.coc_sent


def test_a_document_that_cant_be_read_stops_the_send(env):
    from fastapi import HTTPException

    env.stored.clear()
    with pytest.raises(HTTPException) as e:
        env.api.send_completion_docs(project_id=str(env.project.id), data={
            'doc_ids': [str(env.docs.coc.id)], 'to_addresses': ['paula@bestpa.com'], 'email_account_id': 'acct-1',
        }, db=env.db, current_staff=env.boss)
    assert e.value.status_code == 400
    assert 'was not sent' in e.value.detail
    assert env.sent == []


def test_no_recipient_is_refused(env):
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as e:
        env.api.send_completion_docs(project_id=str(env.project.id), data={
            'doc_ids': [str(env.docs.coc.id)], 'to_addresses': [], 'email_account_id': 'acct-1',
        }, db=env.db, current_staff=env.boss)
    assert e.value.status_code == 400
