"""Sketch report insurance info on/off; renders the HTML only, no database or browser."""
import sys
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.domains.water_mitigation.sketch_pdf_service import SketchPdfService

INSURANCE = ('Acme Mutual', 'POL-12345', 'CLM-67890')


def render(variant, show_insurance):
    job = SimpleNamespace(
        company=None, property_address='12 Main St', homeowner_name='Pat Doe',
        homeowner_phone='555-0100', homeowner_email='pat@example.com',
        insurance_company=INSURANCE[0], insurance_policy_number=INSURANCE[1],
        claim_number=INSURANCE[2], date_of_loss=datetime(2026, 9, 1),
        mitigation_start_date=datetime(2026, 9, 2), mitigation_end_date=datetime(2026, 9, 6),
    )
    service = SketchPdfService(None)
    service._template_variant = variant
    service._show_insurance = show_insurance
    return service._render_html(job, [])


@pytest.mark.parametrize('variant', ['a', 'b', 'c'])
def test_insurance_info_follows_the_switch(variant):
    shown, hidden = render(variant, True), render(variant, False)
    for value in INSURANCE:
        assert value in shown
        assert value not in hidden
    for label in ('Insurance', 'Policy', 'Claim'):
        assert label not in hidden
    # The homeowner side of the jobsite block is unaffected.
    for html in (shown, hidden):
        assert '12 Main St' in html and 'Pat Doe' in html and 'September 01, 2026' in html


def test_insurance_is_shown_by_default():
    assert SketchPdfService(None)._show_insurance is True


def test_table_layout_spans_the_mitigation_row_over_the_remaining_columns():
    assert 'colspan="4"' in render('a', True)
    assert 'colspan="1"' in render('a', False)
    assert 'col-divider"></td>' not in render('a', False)


def test_copy_without_insurance_is_saved_as_the_jobs_sketch_report(monkeypatch):
    """Saved like any other render, so it is what goes out to the carrier."""
    from app.common.utils import storage_helpers
    from app.domains.water_mitigation import document_repository, sketch_api

    calls = {}

    class FakePdfService:
        def __init__(self, db):
            pass

        def generate_sketch_report(self, job_id, template_variant='a', show_insurance=True):
            calls['show_insurance'] = show_insurance
            return b'%PDF-no-claim'

    class FakeRepo:
        def __init__(self, db):
            pass

        def get_by_type(self, job_id, document_type, is_active=True):
            return []

        def create(self, data):
            calls['created'] = data

    def upload(file_bytes, **kwargs):
        calls['uploaded'] = file_bytes
        return {'file_path': 'p', 'file_size': len(file_bytes),
                'storage_provider': 'local', 'storage_file_id': 'f'}

    job = SimpleNamespace(property_address='12 Main St')
    db = SimpleNamespace(
        query=lambda *a: SimpleNamespace(filter=lambda *a: SimpleNamespace(first=lambda: job)),
        commit=lambda: calls.setdefault('committed', True),
    )
    monkeypatch.setattr(sketch_api, 'SketchPdfService', FakePdfService)
    monkeypatch.setattr(storage_helpers, 'upload_bytes_to_storage', upload)
    monkeypatch.setattr(document_repository, 'WMDocumentRepository', FakeRepo)

    sketch_api.generate_sketch_report(
        'job-1', template_variant='a', show_insurance=False, db=db, current_user=None
    )

    assert calls['show_insurance'] is False
    assert calls['uploaded'] == b'%PDF-no-claim'
    assert calls['created']['document_type'] == 'sketch_report'
    assert calls['committed']
