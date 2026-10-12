"""Sketch report memory regressions; no database or storage required."""
import base64
import io
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.common.services import document_resources as resources
from app.domains.water_mitigation import sketch_pdf_service
from app.domains.water_mitigation.sketch_pdf_service import SketchPdfService


def background(image, fmt):
    buf = io.BytesIO()
    image.save(buf, format=fmt)
    return SimpleNamespace(id='floor', background_image_url='/bg', storage_provider='db',
                           storage_file_id=None, background_image_data=buf.getvalue())


def decode(data_uri):
    header, b64 = data_uri.split(',', 1)
    return header, Image.open(io.BytesIO(base64.b64decode(b64)))


@pytest.mark.parametrize('fmt', ['PNG', 'WEBP'])
def test_background_is_embedded_as_bounded_jpeg(fmt):
    floor = background(Image.new('RGBA', (3000, 1500), (0, 0, 0, 0)), fmt)
    data_uri, width, height = SketchPdfService(None)._load_background_image_data_uri(floor)
    header, image = decode(data_uri)
    assert header == 'data:image/jpeg;base64'
    assert image.format == 'JPEG' and image.size == (1600, 800) == (width, height)
    # Transparent areas are flattened onto the white page, not black.
    assert image.getpixel((10, 10)) == (255, 255, 255)


def test_weasyprint_budget_scales_with_floor_count(monkeypatch):
    requested = []
    monkeypatch.setattr(sketch_pdf_service, 'require_memory', requested.append)
    weasyprint = ModuleType('weasyprint')
    weasyprint.HTML = lambda string: SimpleNamespace(write_pdf=lambda: b'%PDF')
    monkeypatch.setitem(sys.modules, 'weasyprint', weasyprint)
    service = SketchPdfService(None)
    for floors in (1, 3):
        service._floor_count = floors
        service._html_to_pdf_weasyprint('<p>sketch</p>')
    assert requested == [34 * resources.MIB, 54 * resources.MIB]
