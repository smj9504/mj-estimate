"""An uploaded insurance estimate PDF is read back from cloud storage for
auto-parsing, whether its row says b2:// (since the move to B2) or gs://
(before it). b2:// used to be taken for a local path, so every upload since
the move came back "Could not auto-parse"."""

from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
import os
import sys

import pytest
from reportlab.pdfgen import canvas

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: E402,F401
from app.domains.insurance_extraction.service import InsuranceExtractionService  # noqa: E402
from app.domains.storage.factory import StorageFactory  # noqa: E402
from app.domains.supplement import api as supplement_api  # noqa: E402

B2_URL = 'b2://mj-estimate-storage/negotiation/claim-1/insurance_estimate/estimate.pdf'
GS_URL = 'gs://mj-estimate-storage/negotiation/claim-1/insurance_estimate/old.pdf'


SUMMARY = [
    'Summary for Dwelling',
    'Line Item Total 6,771.69',
    'Replacement Cost Value $6,844.89',
    'Less Depreciation (1,554.13)',
    'Actual Cash Value $5,290.76',
    'Less Deductible (1,000.00)',
    'Net Claim $4,290.76',
]


def estimate_pdf() -> bytes:
    out = BytesIO()
    pdf = canvas.Canvas(out)
    for i, line in enumerate(SUMMARY):
        pdf.drawString(72, 720 - 18 * i, line)
    pdf.save()
    return out.getvalue()


class FakeStorage:
    def __init__(self):
        self.keys = []

    def download(self, key):
        self.keys.append(key)
        return estimate_pdf()


@pytest.fixture
def storage(monkeypatch):
    fake = FakeStorage()
    monkeypatch.setenv('STORAGE_PROVIDER', 'b2')
    monkeypatch.setattr(StorageFactory, 'get_instance', staticmethod(lambda provider=None: fake))
    monkeypatch.setattr(StorageFactory, 'create', staticmethod(lambda provider=None: fake))
    return fake


def resolve(url, provider):
    svc = InsuranceExtractionService.__new__(InsuranceExtractionService)
    return svc._resolve_pdf_path(url, provider)


def test_b2_pdf_is_downloaded_to_a_temp_file(storage):
    path, tmp = resolve(B2_URL, 'b2')
    try:
        assert path == tmp and os.path.isfile(path)
        assert Path(path).read_bytes().startswith(b'%PDF')
        assert storage.keys == [B2_URL]
    finally:
        os.unlink(tmp)


def test_gs_pdf_from_before_the_move_falls_back_to_its_b2_key(storage, monkeypatch):
    def gcs_gone(provider=None):
        raise RuntimeError('GCS not configured')
    monkeypatch.setattr(StorageFactory, 'create', staticmethod(gcs_gone))

    path, tmp = resolve(GS_URL, 'gcs')
    try:
        assert os.path.isfile(path)
        assert storage.keys == ['negotiation/claim-1/insurance_estimate/old.pdf']
    finally:
        os.unlink(tmp)


def test_extract_pdf_route_parses_a_b2_upload(storage, monkeypatch):
    file_rec = SimpleNamespace(id='f1', url=B2_URL, storage_provider='b2')
    query = SimpleNamespace(filter=lambda *a: query, first=lambda: file_rec)
    session = SimpleNamespace(query=lambda *a: query, close=lambda: None)
    monkeypatch.setattr(supplement_api, 'get_database', lambda: SimpleNamespace(get_session=lambda: session))

    result = supplement_api.extract_insurance_estimate_pdf('f1', current_staff=None)

    assert result['success'] is True, result.get('error')
    assert storage.keys == [B2_URL]
    assert result['totals']['rcv_amount'] == 6844.89
    assert result['totals']['acv_amount'] == 5290.76
    assert [s['section_name'] for s in result['sections']] == ['Dwelling']
