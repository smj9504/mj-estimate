"""A WM document in cloud storage downloads even when its filename isn't
latin-1, which response headers have to be."""

from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote
import sys
import uuid

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: E402,F401
from app.domains.storage.factory import StorageFactory  # noqa: E402
from app.domains.water_mitigation.api import download_document  # noqa: E402


class FakeStorage:
    def download(self, key):
        return b'%PDF-cloud'


def service_with(filename):
    doc = {
        'file_path': 'water-mitigation/job/documents/x.pdf',
        'storage_provider': 'b2',
        'storage_file_id': 'water-mitigation/job/documents/x.pdf',
        'mime_type': 'application/pdf',
        'filename': filename,
    }
    repo = SimpleNamespace(get_by_id=lambda doc_id: object(), _convert_to_dict=lambda d: doc)
    return SimpleNamespace(document_repo=repo)


@pytest.fixture(autouse=True)
def cloud(monkeypatch):
    monkeypatch.setattr(StorageFactory, 'get_instance', staticmethod(lambda provider=None: FakeStorage()))


def test_non_latin1_filename_downloads_under_its_real_name():
    filename = '견적서 – 12 Elm St.pdf'

    response = download_document(document_id=uuid.uuid4(), service=service_with(filename))

    assert response.body == b'%PDF-cloud'
    disposition = response.headers['content-disposition']
    assert disposition.startswith('attachment; filename="12 Elm St.pdf"')
    assert f"filename*=UTF-8''{quote(filename)}" in disposition


def test_ascii_filename_is_sent_as_is():
    response = download_document(document_id=uuid.uuid4(), service=service_with('COS - 12 Elm St.pdf'))

    assert response.headers['content-disposition'] == 'attachment; filename="COS - 12 Elm St.pdf"'
