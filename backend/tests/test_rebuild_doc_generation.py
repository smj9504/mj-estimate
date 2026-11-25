"""Rebuild completion-doc generation; no database or storage required."""
import base64
import io
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image
from pypdf import PdfReader
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.common.utils.storage_helpers as storage_helpers
from app.domains.rebuild.service import RebuildService

MAPPINGS = [
    {'pageIndex': 0, 'x': 0.28, 'y': 0.33, 'width': 0.58, 'height': 0.03, 'fieldKey': 'client.display_name'},
    {'pageIndex': 0, 'x': 0.62, 'y': 0.41, 'width': 0.25, 'height': 0.03, 'fieldKey': 'wm_job.claim_number'},
    {'pageIndex': 0, 'x': 0.51, 'y': 0.76, 'width': 0.22, 'height': 0.06, 'fieldKey': 'signature.homeowner',
     'fieldType': 'signature'},
    {'pageIndex': 0, 'x': 0.51, 'y': 0.84, 'width': 0.22, 'height': 0.03, 'fieldKey': 'date_signed.homeowner'},
]
PREFILL = {
    'client': {'display_name': 'Pat Homeowner'},
    'wm_job': {'claim_number': '070748-GR'},
    # A typed value under a signature key must never print as text
    'signature': {'homeowner': 'SHOULD NOT PRINT'},
}


def template_pdf(pages=1):
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    for _ in range(pages):
        c.drawString(72, 720, 'Certificate of Completion')
        c.showPage()
    c.save()
    return buf.getvalue()


def signature_png():
    buf = io.BytesIO()
    Image.new('RGBA', (300, 100), (20, 20, 120, 255)).save(buf, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


@pytest.fixture
def service(monkeypatch):
    uploads = {}

    def fake_upload(file_bytes, filename, context, context_id, category='documents', content_type='application/pdf'):
        uploads.update(bytes=file_bytes, context=context, context_id=context_id)
        return {'file_url': f'gs://bucket/{context}/{context_id}/{filename}', 'storage_provider': 'gcs'}

    monkeypatch.setattr(storage_helpers, 'upload_bytes_to_storage', fake_upload)
    svc = RebuildService(database=SimpleNamespace())
    svc.uploads = uploads
    return svc


def generate(svc, pages=1, mappings=MAPPINGS, **kwargs):
    svc._load_template_pdf = lambda url, provider: template_pdf(pages)
    template = SimpleNamespace(file_url='contracts/t/templates/coc.pdf', storage_provider='gcs')
    url = svc._generate_filled_pdf('project-1', template, mappings, PREFILL, **kwargs)
    return url, PdfReader(io.BytesIO(svc.uploads['bytes']))


def test_fills_mapped_fields_and_stores_under_the_project(service):
    url, pdf = generate(service)
    text = pdf.pages[0].extract_text()
    assert 'Pat Homeowner' in text and '070748-GR' in text
    assert 'SHOULD NOT PRINT' not in text
    assert service.uploads['context'] == 'rebuild' and service.uploads['context_id'] == 'project-1'
    assert url.startswith('gs://bucket/rebuild/project-1/')


def test_signature_goes_in_the_mapped_box_with_todays_date(service):
    _, pdf = generate(service, signature_image=signature_png(), signature_field_key='signature.homeowner')
    page = pdf.pages[0]
    assert len(page.images) == 1
    # The date box of the same signer gets a date (MM/DD/YYYY)
    assert any(part.count('/') == 2 and len(part) == 10 for part in page.extract_text().split())


def test_signature_without_a_box_lands_on_the_last_page(service):
    unsigned = [m for m in MAPPINGS if not m['fieldKey'].startswith(('signature.', 'date_signed.'))]
    _, pdf = generate(service, pages=2, mappings=unsigned, signature_image=signature_png(), signature_name='Pat')
    assert len(pdf.pages[0].images) == 0
    assert len(pdf.pages[1].images) == 1
    assert 'Pat' in pdf.pages[1].extract_text()


def test_missing_template_pdf_is_a_clear_error(service, monkeypatch):
    import app.domains.contract.api as contract_api
    monkeypatch.setattr(contract_api, '_resolve_contract_pdf', lambda url, provider: None)
    with pytest.raises(ValueError, match='could not be found'):
        service._load_template_pdf('contracts/t/templates/missing.pdf', 'gcs')


# ---------------------------------------------------------------------------
# The work's dates: the project's Start and Completed, in boxes mapped to them
# or in custom boxes labelled as them
# ---------------------------------------------------------------------------

WORK_PREFILL = {'project': {'start_date': '11/03/2026', 'completion_date': '11/20/2026'}}


def box(key, label=None, y=0.3):
    return {'pageIndex': 0, 'x': 0.2, 'y': y, 'width': 0.4, 'height': 0.03, 'fieldKey': key, 'label': label}


def test_work_dates_print_in_their_boxes_mapped_or_custom_labelled(service):
    service._load_template_pdf = lambda url, provider: template_pdf()
    template = SimpleNamespace(file_url='contracts/t/templates/coc.pdf', storage_provider='gcs')
    mappings = [
        box('custom.field_1', 'Work Start Date', 0.30),
        box('custom.field_2', 'Completion Date', 0.40),
        box('project.completion_date', 'Done', 0.50),
        # Not the work's: left as it is
        box('custom.field_3', 'Mitigation End Date', 0.60),
    ]
    service._generate_filled_pdf('project-1', template, mappings, WORK_PREFILL)
    text = PdfReader(io.BytesIO(service.uploads['bytes'])).pages[0].extract_text()
    assert text.count('11/03/2026') == 1
    assert text.count('11/20/2026') == 2


def test_a_custom_box_keeps_what_was_typed_in_it(service):
    prefill = {**WORK_PREFILL, 'custom': {'field_1': '11/05/2026'}}
    assert service._resolve_field_value(prefill, 'custom.field_1', 'Work Start Date') == '11/05/2026'
    assert service._resolve_field_value(WORK_PREFILL, 'custom.field_1', 'Work Start Date') == '11/03/2026'
    assert service._resolve_field_value(WORK_PREFILL, 'custom.field_1', 'Notes') == ''


def test_work_dates_typed_on_the_document_are_kept_on_the_project(service):
    from datetime import date

    project = SimpleNamespace(start_date=None, actual_completion=None)
    mappings = [box('custom.field_1', 'Work Start Date'), box('custom.field_2', 'Completion Date'),
                box('custom.field_3', 'Notes')]
    service._keep_work_dates(project, mappings, {
        'custom.field_1': '11/03/2026', 'custom.field_2': 'Nov 20, 2026', 'custom.field_3': '12/01/2026',
    })
    assert project.start_date.date() == date(2026, 11, 3)
    assert project.actual_completion.date() == date(2026, 11, 20)

    # What isn't a date leaves the project's as it was
    service._keep_work_dates(project, mappings, {'custom.field_2': 'when the floor is in'})
    assert project.actual_completion.date() == date(2026, 11, 20)
