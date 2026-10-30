"""WM photo previews stay small and cacheable: a gallery loads dozens of them at once.
Runs preview_photo with stand-ins for the repo and storage, so nothing reaches the DB or B2."""
import asyncio
import io
import sys
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.responses import FileResponse, RedirectResponse
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.config import settings
from app.domains.integrations.companycam import client as companycam_client
from app.domains.storage.factory import StorageFactory
from app.domains.water_mitigation.api import preview_photo

FILE_ID = "water-mitigation/job/photos/a.jpeg"
SIGNED_URL = f"https://b2.example/{FILE_ID}?X-Amz-Signature=abc"
CDN_THUMB = "https://img.companycam.com/thumb.jpg"
CDN_WEB = "https://img.companycam.com/web.jpg"


def _jpeg(width=3000, height=2000) -> bytes:
    out = io.BytesIO()
    Image.effect_noise((width, height), 80).convert("RGB").save(out, "JPEG", quality=90)
    return out.getvalue()


class FakeB2:
    def __init__(self, data=b""):
        self.data = data
        self.downloads = []

    def download(self, file_id):
        self.downloads.append(file_id)
        if isinstance(self.data, Exception):
            raise self.data
        return self.data

    def get_url(self, file_id, expires_in=None):
        return SIGNED_URL


def _photo(**overrides):
    return {
        "source": "manual_upload",
        "external_id": None,
        "storage_provider": "b2",
        "storage_file_id": FILE_ID,
        "file_path": FILE_ID,
        "mime_type": "image/jpeg",
        "storage_thumbnail_url": None,
        "storage_web_url": None,
        **overrides,
    }


def _request(photo, size):
    service = SimpleNamespace(photo_repo=SimpleNamespace(get_by_id=lambda _: photo))
    return asyncio.run(preview_photo(uuid4(), size=size, service=service))


@pytest.fixture
def b2(monkeypatch, tmp_path):
    provider = FakeB2(_jpeg())
    monkeypatch.setattr(settings, "STORAGE_BASE_DIR", str(tmp_path))
    monkeypatch.setattr(StorageFactory, "get_instance", classmethod(lambda cls, *a, **k: provider))
    return provider


@pytest.mark.parametrize("size,longest_side", [("thumbnail", 250), ("web", 800)])
def test_b2_preview_is_a_resized_webp_the_browser_can_keep(b2, size, longest_side):
    response = _request(_photo(), size)

    image = Image.open(io.BytesIO(response.body))
    assert image.format == "WEBP"
    assert max(image.size) == longest_side
    assert len(response.body) < len(b2.data) / 5
    assert "immutable" in response.headers["cache-control"]


def test_b2_preview_is_downloaded_once_and_then_served_from_disk(b2):
    photo = _photo()
    service = SimpleNamespace(photo_repo=SimpleNamespace(get_by_id=lambda _: photo))
    photo_id = uuid4()

    first = asyncio.run(preview_photo(photo_id, size="thumbnail", service=service))
    second = asyncio.run(preview_photo(photo_id, size="thumbnail", service=service))

    assert len(b2.downloads) == 1
    assert isinstance(second, FileResponse)
    assert Path(second.path).read_bytes() == first.body


def test_b2_original_stays_a_signed_redirect_and_never_passes_through_the_server(b2):
    response = _request(_photo(), "original")

    assert isinstance(response, RedirectResponse)
    assert response.headers["location"] == SIGNED_URL
    assert b2.downloads == []


def test_b2_video_is_not_resized(b2):
    response = _request(_photo(mime_type="video/mp4"), "thumbnail")

    assert isinstance(response, RedirectResponse)
    assert b2.downloads == []


def test_b2_preview_falls_back_to_the_signed_url_when_the_download_fails(b2):
    b2.data = RuntimeError("B2 is down")

    response = _request(_photo(), "thumbnail")

    assert isinstance(response, RedirectResponse)
    assert response.headers["location"] == SIGNED_URL


@pytest.mark.parametrize("size,stored", [("thumbnail", CDN_THUMB), ("web", CDN_WEB)])
def test_companycam_preview_with_a_stored_cdn_url_skips_the_api(monkeypatch, size, stored):
    def no_api_call(*args, **kwargs):
        raise AssertionError("CompanyCam API must not be called")

    monkeypatch.setattr(companycam_client, "CompanyCamClient", no_api_call)

    response = _request(
        _photo(
            source="companycam",
            external_id="123",
            storage_thumbnail_url=CDN_THUMB,
            storage_web_url=CDN_WEB,
        ),
        size,
    )

    assert isinstance(response, RedirectResponse)
    assert response.headers["location"] == stored
