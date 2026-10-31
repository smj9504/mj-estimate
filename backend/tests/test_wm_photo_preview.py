"""WM photo previews stay small and cacheable: a gallery loads dozens of them at once.
Runs preview_photo with stand-ins for the repo and storage, so nothing reaches the DB or B2.
The connection tests use a real SQLAlchemy pool on a scratch SQLite file."""
import asyncio
import io
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from PIL import Image
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.config import settings
from app.domains.integrations.companycam import client as companycam_client
from app.domains.storage.factory import StorageFactory
from app.domains.water_mitigation import api as wm_api
from app.domains.water_mitigation.api import download_photo, preview_photo
from app.domains.water_mitigation.service import WaterMitigationService

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


def _service(photo):
    return SimpleNamespace(
        session=SimpleNamespace(close=lambda: None),
        photo_repo=SimpleNamespace(get_by_id=lambda _: photo),
    )


def _request(photo, size):
    return asyncio.run(preview_photo(uuid4(), size=size, service=_service(photo)))


@pytest.fixture
def b2(monkeypatch, tmp_path):
    provider = FakeB2(_jpeg())
    monkeypatch.setattr(settings, "STORAGE_BASE_DIR", str(tmp_path))
    monkeypatch.setattr(StorageFactory, "get_instance", classmethod(lambda cls, *a, **k: provider))
    # A semaphore that had to make a task wait stays bound to that test's event loop
    monkeypatch.setattr(wm_api, "_preview_download_slots", asyncio.Semaphore(4), raising=False)
    return provider


@pytest.fixture
def small_pool(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'pool.db'}",
        poolclass=QueuePool,
        pool_size=2,
        max_overflow=0,
        pool_timeout=1,
        connect_args={"check_same_thread": False},
    )
    yield engine
    engine.dispose()


def _service_on(engine, photo):
    """A service whose repo reads through a real session, the way the request's does:
    the read opens a transaction and the session keeps the connection until it ends."""
    session = sessionmaker(bind=engine, expire_on_commit=False)()

    def get_by_id(_):
        session.execute(text("select 1"))
        return photo

    return SimpleNamespace(session=session, photo_repo=SimpleNamespace(get_by_id=get_by_id))


@pytest.mark.parametrize("size,longest_side", [("thumbnail", 250), ("web", 800)])
def test_b2_preview_is_a_resized_webp_the_browser_can_keep(b2, size, longest_side):
    response = _request(_photo(), size)

    image = Image.open(io.BytesIO(response.body))
    assert image.format == "WEBP"
    assert max(image.size) == longest_side
    assert len(response.body) < len(b2.data) / 5
    assert "immutable" in response.headers["cache-control"]


def test_b2_preview_is_downloaded_once_and_then_served_from_disk(b2):
    service = _service(_photo())
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


def test_a_page_of_cold_thumbnails_bigger_than_the_db_pool_all_load(b2, small_pool):
    b2.data = _jpeg(600, 400)

    async def burst():
        return await asyncio.gather(
            *[
                preview_photo(uuid4(), size="thumbnail", service=_service_on(small_pool, _photo()))
                for _ in range(12)
            ],
            return_exceptions=True,
        )

    results = asyncio.run(burst())

    assert [r for r in results if isinstance(r, Exception)] == []
    assert all(r.media_type == "image/webp" for r in results)


@pytest.mark.parametrize(
    "route,kwargs",
    [(preview_photo, {"size": "thumbnail"}), (download_photo, {})],
    ids=["preview", "download"],
)
def test_no_db_connection_is_held_while_the_photo_downloads(b2, small_pool, route, kwargs):
    b2.data = _jpeg(600, 400)
    held = []
    plain_download = b2.download

    def download(file_id):
        held.append(small_pool.pool.checkedout())
        return plain_download(file_id)

    b2.download = download

    asyncio.run(route(uuid4(), service=_service_on(small_pool, _photo()), **kwargs))

    assert held == [0]


def test_waiting_for_a_db_connection_does_not_stop_the_event_loop(b2, small_pool):
    b2.data = _jpeg(600, 400)

    async def run():
        busy = [small_pool.connect(), small_pool.connect()]
        started = time.monotonic()
        request = asyncio.create_task(
            preview_photo(uuid4(), size="thumbnail", service=_service_on(small_pool, _photo()))
        )
        await asyncio.sleep(0.05)
        loop_was_free_for = time.monotonic() - started
        for connection in busy:
            connection.close()
        return loop_was_free_for, await request

    loop_time, response = asyncio.run(run())

    assert loop_time < 0.5
    assert response.media_type == "image/webp"


def test_a_burst_of_cold_thumbnails_only_downloads_a_few_at_a_time(b2):
    b2.data = _jpeg(600, 400)
    lock = threading.Lock()
    running = {"now": 0, "most": 0}
    plain_download = b2.download

    def download(file_id):
        with lock:
            running["now"] += 1
            running["most"] = max(running["most"], running["now"])
        time.sleep(0.05)
        with lock:
            running["now"] -= 1
        return plain_download(file_id)

    b2.download = download

    async def burst():
        return await asyncio.gather(
            *[
                preview_photo(uuid4(), size="thumbnail", service=_service(_photo()))
                for _ in range(16)
            ]
        )

    asyncio.run(burst())

    assert len(b2.downloads) == 16
    assert running["most"] <= 4


def test_upload_holds_no_db_connection_while_the_file_goes_to_storage(monkeypatch, small_pool):
    held = []

    def upload(**_):
        held.append(small_pool.pool.checkedout())
        return SimpleNamespace(
            file_path=FILE_ID, file_id=FILE_ID, thumbnail_url=None, folder_path="photos"
        )

    monkeypatch.setattr(
        StorageFactory, "get_instance", classmethod(lambda cls, *a, **k: SimpleNamespace(upload=upload))
    )
    session = sessionmaker(bind=small_pool, expire_on_commit=False)()

    def read_job(_):
        session.execute(text("select 1"))
        return {"id": "job"}

    def create_photo(data):
        session.execute(text("select 1"))
        return data

    service = WaterMitigationService.__new__(WaterMitigationService)
    service.session = session
    service.job_repo = SimpleNamespace(get_by_id=read_job)
    service.photo_repo = SimpleNamespace(create=create_photo)
    file = UploadFile(
        io.BytesIO(_jpeg(600, 400)), filename="a.jpg", headers={"content-type": "image/jpeg"}
    )

    created = asyncio.run(service.upload_photo(uuid4(), file))

    assert held == [0]
    assert created["storage_file_id"] == FILE_ID
    session.close()
