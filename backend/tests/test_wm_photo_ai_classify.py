"""AI photo classification and CompanyCam sync against the real photo repository (in-memory SQLite)."""
import asyncio
import io
import sys
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from PIL import Image
from sqlalchemy import create_engine, event, text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.config import settings
from app.domains.water_mitigation import api
from app.domains.water_mitigation import service as service_module
from app.domains.water_mitigation.ai_classification_service import ai_classification_service
from app.domains.water_mitigation.models import (
    PhotoAnalysisCache,
    PhotoCategory,
    WMPhoto,
    WMPhotoCategory,
)
from app.domains.water_mitigation.photo_similarity import compute_visual_signature
from app.domains.water_mitigation.repository import WMPhotoRepository
from app.domains.water_mitigation.service import WaterMitigationService
from app.main import app as _app  # noqa: F401 - registers every model the mappers refer to

AI_RESULT = {"category": "day-1", "confidence": 0.9}


@compiles(JSONB, "sqlite")
def _jsonb_on_sqlite(element, compiler, **kw):
    return "JSON"


@compiles(PG_UUID, "sqlite")
def _uuid_on_sqlite(element, compiler, **kw):
    return "VARCHAR(36)"


class SQLitePhotoRepository(WMPhotoRepository):
    """The base repository passes dates as ISO strings, which SQLite's DateTime refuses."""

    def _prepare_sqlalchemy_data(self, data):
        prepared = super()._prepare_sqlalchemy_data(data)
        if isinstance(prepared.get("captured_date"), str):
            prepared["captured_date"] = datetime.fromisoformat(prepared["captured_date"])
        return prepared


def image_bytes(color=(120, 40, 200)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), color).save(buf, format="JPEG")
    return buf.getvalue()


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    event.listen(
        engine, "connect",
        lambda conn, _: conn.create_function("gen_random_uuid", 0, lambda: str(uuid4())),
    )
    for model in (WMPhoto, PhotoCategory, WMPhotoCategory):
        model.__table__.create(engine)
    # Two PhotoAnalysisCache models share this table, so its metadata also carries the
    # pack estimate cache's required columns. Only the ones the WM model writes are made here.
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE photo_analysis_cache (id VARCHAR(36) PRIMARY KEY, photo_id VARCHAR(36), "
            "ai_result JSON, user_corrected BOOLEAN, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
            "updated_at DATETIME)"
        ))
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


@pytest.fixture
def classifier(monkeypatch):
    """AI enabled, with the vision call replaced. Returns the calls it received."""
    calls = []

    async def classify(image_data, mime_type):
        calls.append(image_data)
        return dict(AI_RESULT)

    monkeypatch.setattr(settings, "ENABLE_AI_PHOTO_CLASSIFICATION", True)
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(ai_classification_service, "classify_photo_two_phase", classify)
    return calls


def add_photo(db, path, signature=None) -> WMPhoto:
    photo = WMPhoto(
        job_id=uuid4(),
        file_name=path.name,
        file_path=str(path),
        mime_type="image/jpeg",
        source="manual_upload",
        visual_signature=signature,
    )
    db.add(photo)
    db.commit()
    return photo


def classify_photo(db, photo, monkeypatch, force_refresh=False):
    monkeypatch.setattr(api, "require_photos", lambda *args: None)
    return asyncio.run(api.ai_classify_photos(
        request=api.AIClassifyRequest(photo_ids=[str(photo.id)], force_refresh=force_refresh),
        background_tasks=None,
        service=SimpleNamespace(photo_repo=SQLitePhotoRepository(db)),
        db=db,
        current_staff=None,
    ))


def test_ai_classify_fingerprints_and_classifies_an_uncached_photo(db, classifier, monkeypatch, tmp_path):
    data = image_bytes()
    path = tmp_path / "photo.jpg"
    path.write_bytes(data)
    photo = add_photo(db, path)

    response = classify_photo(db, photo, monkeypatch)

    assert response.failed == 0 and response.classified == 1
    assert response.results[0]["category"] == "day-1"
    assert classifier == [data]
    # Rolling back shows both writes were committed, not just flushed
    db.rollback()
    assert db.get(WMPhoto, photo.id).visual_signature == compute_visual_signature(data)
    assert db.query(PhotoAnalysisCache).count() == 1


def test_ai_classify_leaves_an_existing_fingerprint_alone(db, classifier, monkeypatch, tmp_path):
    path = tmp_path / "photo.jpg"
    path.write_bytes(image_bytes())
    photo = add_photo(db, path, signature="existing")

    response = classify_photo(db, photo, monkeypatch, force_refresh=True)

    assert response.failed == 0
    db.rollback()
    assert db.get(WMPhoto, photo.id).visual_signature == "existing"


def test_ai_classify_is_not_blocked_by_an_image_it_cannot_fingerprint(db, classifier, monkeypatch, tmp_path):
    path = tmp_path / "photo.jpg"
    path.write_bytes(b"not an image")
    photo = add_photo(db, path)

    response = classify_photo(db, photo, monkeypatch)

    assert response.failed == 0 and response.classified == 1
    db.rollback()
    # Stays NULL so the gallery's backfill can still decide what to do with it
    assert db.get(WMPhoto, photo.id).visual_signature is None


@pytest.fixture
def wm_service(db, monkeypatch):
    company_id = uuid4()
    upload = SimpleNamespace(file_path="wm/photo.jpg", file_id="file-1", thumbnail_url=None, folder_path="wm")
    monkeypatch.setattr(
        service_module.StorageFactory, "get_instance",
        lambda *args: SimpleNamespace(upload=lambda **kwargs: upload),
    )
    service = object.__new__(WaterMitigationService)
    service.session = db
    service.photo_repo = SQLitePhotoRepository(db)
    service.job_repo = SimpleNamespace(
        get_by_id=lambda job_id: {"company_id": company_id, "companycam_project_id": "7"}
    )
    return service


@pytest.mark.parametrize("tags", [[], ["Kitchen"]])
def test_save_companycam_photo_returns_the_record(db, wm_service, tags):
    saved = asyncio.run(wm_service.save_companycam_photo(
        job_id=uuid4(),
        photo_bytes=image_bytes(),
        filename="companycam_1.jpg",
        companycam_photo_id="1",
        companycam_tags=tags,
    ))

    assert isinstance(saved, WMPhoto)
    assert db.query(WMPhotoCategory).filter(WMPhotoCategory.photo_id == saved.id).count() == len(tags)


def test_companycam_sync_saves_fingerprint_tags_and_ai_category(db, wm_service, classifier, monkeypatch):
    data = image_bytes()

    class FakeCompanyCam:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def list_project_photos(self, project_id, page, per_page):
            return [{"id": 101, "uris": [{"type": "web", "uri": "https://cc/101.jpg"}], "tags": ["Kitchen"]}]

        async def download_photo(self, url):
            return data

    async def no_status(*args, **kwargs):
        return None

    monkeypatch.setattr("app.domains.integrations.companycam.client.CompanyCamClient", FakeCompanyCam)
    monkeypatch.setattr("app.core.cache.get_cache", lambda: SimpleNamespace(get=no_status, set=no_status))

    result = asyncio.run(wm_service.sync_companycam_photos(uuid4()))

    assert result["errors"] == []
    assert result["synced_count"] == 1
    assert classifier == [data]
    db.commit()
    photo = db.query(WMPhoto).one()
    assert photo.visual_signature == compute_visual_signature(data)
    assert photo.category == "day-1"
    assert db.query(WMPhotoCategory).filter(WMPhotoCategory.photo_id == photo.id).count() == 1
    assert db.query(PhotoAnalysisCache).filter(PhotoAnalysisCache.photo_id == photo.id).count() == 1
