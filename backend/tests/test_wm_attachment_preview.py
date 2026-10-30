"""Clicking an attachment in the water mitigation send dialog shows the file the
send would attach: the same choice between documents, without the compression."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401
from app.common.services.document_resources import DOCUMENT_LOCK, DocumentResourceError  # noqa: E402
from app.common.utils import storage_helpers  # noqa: E402
from app.domains.company.models import Company  # noqa: E402
from app.domains.file.models import File as FileModel  # noqa: E402
from app.domains.water_mitigation.adjuster_email_service import AdjusterEmailService  # noqa: E402
from app.domains.water_mitigation.models import (  # noqa: E402
    WaterMitigationJob, WMDocument, WMDocumentSlotOverride, WMScopeInvoice,
)
from app.domains.water_mitigation.sketch_models import (  # noqa: E402
    WMContainmentZone, WMContentManipulation, WMContentProtection, WMDemolitionZone,
    WMEquipmentPlacement, WMFloorProtection, WMFloorSketch,
)
from app.domains.water_mitigation.sketch_pdf_service import SketchPdfService  # noqa: E402


@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(type_, compiler, **kw):
    return 'JSON'


@compiles(UUID, 'sqlite')
def _uuid_on_sqlite(type_, compiler, **kw):
    return 'CHAR(36)'


class FakeDatabase:
    def __init__(self, engine):
        self._sessions = sessionmaker(bind=engine)

    def get_session(self):
        return self._sessions()

    get_readonly_session = get_session


@pytest.fixture
def env(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'wm.db'}")
    for model in (
        WaterMitigationJob, WMDocument, WMDocumentSlotOverride, WMScopeInvoice,
        WMFloorSketch, WMDemolitionZone, WMEquipmentPlacement, WMContainmentZone,
        WMFloorProtection, WMContentProtection, WMContentManipulation, Company, FileModel,
    ):
        model.__table__.create(engine)
    database = FakeDatabase(engine)

    session = database.get_session()
    job = WaterMitigationJob(property_address='12 Elm St, Springfield')
    session.add(job)
    session.commit()

    def add_doc(filename, content=b'%PDF-doc', **fields):
        path = tmp_path / filename
        if content is not None:
            path.write_bytes(content)
        doc = WMDocument(
            job_id=job.id,
            document_type=fields.pop('document_type', 'Other'),
            filename=filename,
            file_path=str(path),
            file_size=len(content or b''),
            mime_type=fields.pop('mime_type', 'application/pdf'),
            storage_provider='local',
            is_active=True,
            **fields,
        )
        session.add(doc)
        session.commit()
        return doc

    service = AdjusterEmailService(database)
    yield {
        'service': service, 'session': session, 'job': job, 'job_id': str(job.id),
        'add_doc': add_doc, 'tmp_path': tmp_path,
    }
    session.close()
    engine.dispose()


def preview(env, slot):
    return env['service'].get_attachment_preview(env['job_id'], slot)


@pytest.mark.parametrize('slot, document_type', [
    ('photo_report', 'photo_report'),
    ('cos', 'COS'),
    ('ewa', 'EWA'),
    ('sketch', 'sketch_report'),
])
def test_shows_the_saved_document_byte_for_byte(env, slot, document_type):
    env['session'].add(WMFloorSketch(job_id=env['job'].id, floor_label='Main', floor_order=0))
    env['session'].commit()
    env['add_doc']('Saved.pdf', content=b'%PDF-saved', document_type=document_type)

    attachment = preview(env, slot)

    assert attachment['data'] == b'%PDF-saved'
    assert attachment['mime_type'] == 'application/pdf'


def test_a_saved_invoice_wins_over_the_generated_one(env):
    # The readiness check names no document here, and the send still picks this
    env['session'].add(WMScopeInvoice(job_id=env['job'].id, invoice_id=uuid4()))
    env['session'].commit()
    env['add_doc']('Invoice INV-1.pdf', content=b'%PDF-invoice', document_type='Invoice')

    assert preview(env, 'invoice')['data'] == b'%PDF-invoice'


def test_shows_the_company_w9(env):
    session = env['session']
    w9_path = env['tmp_path'] / 'w9.pdf'
    w9_path.write_bytes(b'%PDF-w9')
    w9 = FileModel(
        id=str(uuid4()), filename='w9.pdf', original_name='w9.pdf',
        content_type='application/pdf', size=7, url=str(w9_path),
        context='company', context_id=str(uuid4()), category='w9',
        storage_provider='local',
    )
    company = Company(name='Enter Construction', w9_file_id=w9.id)
    session.add_all([w9, company])
    session.commit()
    env['job'].company_id = company.id
    session.commit()

    assert preview(env, 'w9')['data'] == b'%PDF-w9'


def test_an_unsaved_sketch_is_saved_so_the_send_attaches_the_same_file(env, monkeypatch):
    env['session'].add(WMFloorSketch(job_id=env['job'].id, floor_label='Main', floor_order=0))
    env['session'].commit()

    renders = []
    monkeypatch.setattr(
        SketchPdfService, 'generate_sketch_report',
        lambda self, job_id, template_variant='a': renders.append(job_id) or b'%PDF-sketch',
    )
    saved_path = env['tmp_path'] / 'sketch.pdf'
    def upload(file_bytes, filename, **kwargs):
        saved_path.write_bytes(file_bytes)
        return {
            'file_path': str(saved_path), 'file_size': len(file_bytes),
            'storage_provider': 'local', 'storage_file_id': '',
        }
    monkeypatch.setattr(storage_helpers, 'upload_bytes_to_storage', upload)

    assert preview(env, 'sketch')['data'] == b'%PDF-sketch'
    assert preview(env, 'sketch')['data'] == b'%PDF-sketch'
    assert len(renders) == 1

    session = env['session']
    session.expire_all()
    [doc] = session.query(WMDocument).filter(WMDocument.document_type == 'sketch_report').all()
    assert doc.file_path == str(saved_path)


def test_over_the_email_limit_is_shown_without_compressing(env, monkeypatch):
    service = env['service']
    monkeypatch.setattr(service, '_EMAIL_SIZE_LIMIT', 1)
    compressions = []
    monkeypatch.setattr(
        service, '_compress_pdf', lambda data, level: compressions.append(level) or data,
    )
    env['add_doc']('Big.pdf', content=b'%PDF-big', document_type='COS')

    assert preview(env, 'cos')['data'] == b'%PDF-big'
    assert compressions == []

    # The send itself still compresses: the switch only affects the preview
    session = env['session']
    attachments, _failed = service._collect_attachments(session, env['job'], ['cos'])
    assert attachments[0]['data'] == b'%PDF-big'
    assert compressions


def test_a_missing_slot_never_renders_a_photo_report(env, monkeypatch):
    def render(*args, **kwargs):
        raise AssertionError('must not render a Photo Report for a preview')
    monkeypatch.setattr(env['service'], '_generate_photo_report_attachment', render)

    with pytest.raises(ValueError, match="isn't on the job yet"):
        preview(env, 'photo_report')


def test_an_unreadable_file_says_the_send_would_fail_too(env):
    env['add_doc']('Gone.pdf', content=None, document_type='EWA')

    with pytest.raises(ValueError, match='sending it would fail too'):
        preview(env, 'ewa')


def test_an_unknown_slot_is_refused(env):
    with pytest.raises(ValueError, match="Unknown slot 'nope'"):
        preview(env, 'nope')


def test_waits_its_turn_with_other_document_work(env):
    env['add_doc']('COS.pdf', document_type='COS')
    # The lock is re-entrant, so the other work has to be on another thread
    with ThreadPoolExecutor(max_workers=1) as other_thread:
        assert DOCUMENT_LOCK.acquire(blocking=False)
        try:
            with pytest.raises(DocumentResourceError, match='Another document or email'):
                other_thread.submit(preview, env, 'cos').result()
        finally:
            DOCUMENT_LOCK.release()
