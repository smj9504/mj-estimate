"""MagicPlan import: every page of a project's files, photos and videos both,
and the poster frame a video shows as in the photo gallery. No database or
network required."""
import asyncio
import io
import sys
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest
from fastapi import HTTPException
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: E402,F401  (registers every model, so WMPhoto's mapper can resolve)
from app.core.config import settings  # noqa: E402
from app.domains.integrations.magicplan import sync_service  # noqa: E402
from app.domains.integrations.magicplan.client import MagicPlanClient  # noqa: E402
from app.domains.storage.base import UploadResult  # noqa: E402
from app.domains.water_mitigation import api as wm_api  # noqa: E402
from app.domains.water_mitigation import video_preview  # noqa: E402
from app.domains.water_mitigation.video_preview import (  # noqa: E402
    extract_poster_frame,
    is_video,
)


# ── Paging ───────────────────────────────────────────────────

def paged_client(total_items, page_size_seen):
    """A client whose API serves `total_items` files 50 to a page."""
    client = MagicPlanClient(api_key="key", customer_id="customer")

    async def fake_request(method, path, params=None, timeout=None):
        page_size_seen.append(params)
        page, size = params["page"], params["page_size"]
        start = (page - 1) * size
        items = [{"id": str(i)} for i in range(start, min(start + size, total_items))]
        total_pages = -(-total_items // size)
        return {"data": items, "page_info": {"current_page": page, "total_pages": total_pages}}

    client._request = fake_request
    return client


def test_project_files_come_from_every_page():
    calls = []
    files = asyncio.run(paged_client(123, calls).get_project_files("project-1"))

    assert [f["id"] for f in files] == [str(i) for i in range(123)]
    assert [c["page"] for c in calls] == [1, 2, 3]
    # The API's default is 10 a page; 50 is its maximum
    assert all(c["page_size"] == 50 for c in calls)


def test_all_projects_come_from_every_page():
    calls = []
    projects = asyncio.run(paged_client(51, calls).list_all_projects())
    assert len(projects) == 51
    assert [c["page"] for c in calls] == [1, 2]


def test_a_list_without_page_info_stops_on_a_short_page():
    client = MagicPlanClient(api_key="key", customer_id="customer")
    pages = [[{"id": str(i)} for i in range(50)], [{"id": "last"}]]
    calls = []

    async def fake_request(method, path, params=None, timeout=None):
        calls.append(params["page"])
        return pages[params["page"] - 1]

    client._request = fake_request
    assert len(asyncio.run(client.get_project_files("project-1"))) == 51
    assert calls == [1, 2]


# ── Sync ─────────────────────────────────────────────────────

class FakeClient:
    def __init__(self, files, blobs):
        self.files = files
        self.blobs = blobs

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get_project_files(self, project_id):
        return self.files

    async def get_project_plan(self, project_id):
        return {"plan_data": {"floors": [{"name": "1st Floor", "uid": "f1"}]}}

    async def download_file_to(self, url, dest):
        data = self.blobs[url]
        dest.write(data)
        return len(data)


class FakeStorage:
    def __init__(self):
        self.uploads = {}

    def upload(self, file_data, filename, context, context_id, category=None,
               content_type=None, **kwargs):
        self.uploads[filename] = (file_data.read(), content_type)
        return UploadResult(file_id=f"wm/{filename}", file_path=f"wm/{filename}", folder_path="wm")


class FakeDB:
    def __init__(self, existing_external_ids=()):
        self.existing = [(ext_id,) for ext_id in existing_external_ids]
        self.added = []

    def query(self, *columns):
        rows = self.existing
        return SimpleNamespace(filter=lambda *a: SimpleNamespace(all=lambda: rows))

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        pass

    def rollback(self):
        pass


def media_file(file_id, filename, filetype, **extra):
    return {
        "id": file_id,
        "filename": filename,
        "filetype": filetype,
        "file": {"url": f"https://cdn.example/{filename}"},
        "user_created": "2026-10-20T15:29:47.000000+00:00",
        **extra,
    }


def test_sync_imports_photos_and_videos(monkeypatch):
    video_bytes = b"\x00\x00\x00\x18ftypmp42" + b"v" * 5000
    files = [
        media_file("p1", "kitchen.jpg", "image/jpeg", metadata={"description": "Wet baseboard"}),
        media_file("p2", "hall.png", "image/png"),
        media_file("v1", "walkthrough.mp4", "video/mp4"),
        media_file("v2", "closet.mov", "video/quicktime"),
        media_file("d1", "report.pdf", "application/pdf"),
        media_file("old", "already.jpg", "image/jpeg"),
    ]
    blobs = {f["file"]["url"]: b"jpeg-" + f["id"].encode() for f in files}
    blobs["https://cdn.example/walkthrough.mp4"] = video_bytes
    storage = FakeStorage()
    db = FakeDB(existing_external_ids=["magicplan_old"])

    monkeypatch.setattr(sync_service, "MagicPlanClient", lambda: FakeClient(files, blobs))
    monkeypatch.setattr(sync_service.StorageFactory, "create", lambda *a, **k: storage)
    # A tiny spool limit: the video goes through the on-disk path, whole
    monkeypatch.setattr(sync_service, "SPOOL_MAX_BYTES", 64)

    result = asyncio.run(
        sync_service.MagicPlanSyncService(db).sync_photos("job-1", "project-1", "Quartz Ln")
    )

    assert result.success and not result.errors
    assert (result.photos_synced, result.videos_synced, result.photos_skipped) == (2, 2, 1)

    rows = {row.file_name: row for row in db.added}
    assert set(rows) == {"kitchen.jpg", "hall.png", "walkthrough.mp4", "closet.mov"}
    assert rows["walkthrough.mp4"].file_type == "video"
    assert rows["walkthrough.mp4"].mime_type == "video/mp4"
    assert rows["walkthrough.mp4"].file_size == len(video_bytes)
    assert rows["closet.mov"].file_type == "video"
    assert rows["kitchen.jpg"].file_type == "photo"
    assert rows["kitchen.jpg"].external_id == "magicplan_p1"
    assert rows["kitchen.jpg"].description == "Wet baseboard"
    assert rows["kitchen.jpg"].captured_date.isoformat() == "2026-10-20T15:29:47+00:00"
    assert storage.uploads["walkthrough.mp4"] == (video_bytes, "video/mp4")


def test_one_failed_download_does_not_stop_the_rest(monkeypatch):
    files = [media_file("p1", "a.jpg", "image/jpeg"), media_file("v1", "b.mp4", "video/mp4")]
    blobs = {"https://cdn.example/a.jpg": b"jpeg"}  # the video's URL is missing
    db = FakeDB()

    monkeypatch.setattr(sync_service, "MagicPlanClient", lambda: FakeClient(files, blobs))
    monkeypatch.setattr(sync_service.StorageFactory, "create", lambda *a, **k: FakeStorage())

    result = asyncio.run(sync_service.MagicPlanSyncService(db).sync_photos("job-1", "project-1"))

    assert result.success
    assert (result.photos_synced, result.videos_synced) == (1, 0)
    assert len(result.errors) == 1 and "video v1" in result.errors[0]
    assert [row.file_name for row in db.added] == ["a.jpg"]


# ── Videos in the gallery ────────────────────────────────────

def test_is_video_trusts_the_mime_type():
    assert is_video({"file_type": "video", "mime_type": "video/mp4"})
    assert is_video(SimpleNamespace(file_type="photo", mime_type="video/quicktime"))
    assert is_video({"file_type": "video", "mime_type": None})
    assert not is_video({"file_type": "photo", "mime_type": "image/jpeg"})
    # Uploads stored any non-image/* type as file_type='video'
    assert not is_video({"file_type": "video", "mime_type": "application/octet-stream"})


def write_video(path: Path, frames=30, fps=10, size=(64, 48)) -> Path:
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    for i in range(frames):
        frame = np.full((size[1], size[0], 3), (i * 8) % 256, dtype=np.uint8)
        writer.write(frame)
    writer.release()
    return path


def test_poster_frame_is_a_still_from_the_video(tmp_path):
    frame = extract_poster_frame(str(write_video(tmp_path / "clip.mp4")))
    image = Image.open(io.BytesIO(frame))
    assert image.format == "JPEG"
    assert image.size == (64, 48)


def test_unreadable_video_has_no_poster_frame(tmp_path):
    broken = tmp_path / "broken.mp4"
    broken.write_bytes(b"not a video")
    assert extract_poster_frame(str(broken)) is None


def test_poster_is_rendered_once_at_every_gallery_size(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "STORAGE_BASE_DIR", str(tmp_path / "storage"))
    video = write_video(tmp_path / "clip.mp4", size=(640, 360))
    loads = []
    real_load = video_preview.load_video_poster

    async def counting_load(*args):
        loads.append(args)
        return await real_load(*args)

    monkeypatch.setattr(video_preview, "load_video_poster", counting_load)

    first = asyncio.run(wm_api._video_poster_response("vid-1", "thumbnail", str(video), "local", None))
    assert first.media_type == "image/webp"
    thumbnail = Image.open(io.BytesIO(first.body))
    assert thumbnail.format == "WEBP"
    assert thumbnail.size == (250, 141)

    # The web size was rendered from the same fetch and comes from the cache
    web = asyncio.run(wm_api._video_poster_response("vid-1", "web", str(video), "local", None))
    assert Path(web.path).name == "vid-1.webp"
    assert len(loads) == 1


def test_video_without_a_frame_is_not_refetched(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "STORAGE_BASE_DIR", str(tmp_path / "storage"))
    broken = tmp_path / "broken.mp4"
    broken.write_bytes(b"not a video")
    loads = []

    async def failing_load(*args):
        loads.append(args)
        return None

    monkeypatch.setattr(video_preview, "load_video_poster", failing_load)

    for _ in range(2):
        with pytest.raises(HTTPException) as err:
            asyncio.run(wm_api._video_poster_response("vid-2", "thumbnail", str(broken), "local", None))
        assert err.value.status_code == 404
    assert len(loads) == 1
