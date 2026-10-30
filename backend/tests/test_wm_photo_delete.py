"""Permanently deleting a WM photo removes its stored file, unless another record shares it.
Identical uploads share one stored file, so the storage providers' dedup is covered too."""
import io
import sys
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.domains.storage.b2_provider import B2Provider
from app.domains.storage.gcs_provider import GCSProvider
from app.domains.water_mitigation import service as service_module
from app.domains.water_mitigation.models import PhotoCategory, WMDocument, WMPhoto, WMPhotoCategory
from app.domains.water_mitigation.repository import WMPhotoRepository
from app.domains.water_mitigation.service import WaterMitigationService
from app.main import app as _app  # noqa: F401 - registers every model the mappers refer to

FILE_ID = "water-mitigation/job/photos/a.webp"


@compiles(JSONB, "sqlite")
def _jsonb_on_sqlite(element, compiler, **kw):
    return "JSON"


@compiles(PG_UUID, "sqlite")
def _uuid_on_sqlite(element, compiler, **kw):
    return "VARCHAR(36)"


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    event.listen(
        engine, "connect",
        lambda conn, _: conn.create_function("gen_random_uuid", 0, lambda: str(uuid4())),
    )
    for model in (WMPhoto, WMDocument, PhotoCategory, WMPhotoCategory):
        model.__table__.create(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


@pytest.fixture
def deleted_files(monkeypatch):
    """File ids the cloud storage provider was asked to delete."""
    deleted = []

    def delete(file_id):
        deleted.append(file_id)
        return True

    monkeypatch.setattr(
        service_module.StorageFactory, "get_instance",
        lambda *args: SimpleNamespace(delete=delete),
    )
    return deleted


@pytest.fixture
def wm_service(db):
    service = object.__new__(WaterMitigationService)
    service.session = db
    service.photo_repo = WMPhotoRepository(db)
    return service


def add_photo(db, file_id=FILE_ID, provider="gcs", file_path=None, **fields) -> WMPhoto:
    photo = WMPhoto(
        job_id=uuid4(),
        file_name="a.webp",
        file_path=file_path or file_id,
        source="manual_upload",
        storage_provider=provider,
        storage_file_id=file_id,
        **fields,
    )
    db.add(photo)
    db.commit()
    return photo


def test_deleting_a_photo_removes_its_stored_file_and_record(db, wm_service, deleted_files):
    photo = add_photo(db)

    assert wm_service.delete_photo(photo.id) is True

    assert deleted_files == [FILE_ID]
    assert db.query(WMPhoto).count() == 0


@pytest.mark.parametrize("other_is_trashed", [False, True])
def test_a_file_another_photo_shares_goes_only_with_the_last_photo(
    db, wm_service, deleted_files, other_is_trashed
):
    photo, other = add_photo(db), add_photo(db, is_trashed=other_is_trashed)

    assert wm_service.delete_photo(photo.id) is True
    assert deleted_files == []
    assert db.query(WMPhoto).one().id == other.id

    assert wm_service.delete_photo(other.id) is True
    assert deleted_files == [FILE_ID]


def test_a_file_a_document_shares_is_kept(db, wm_service, deleted_files):
    photo = add_photo(db)
    db.add(WMDocument(
        job_id=uuid4(), document_type="other", filename="a.webp", file_path=FILE_ID, storage_file_id=FILE_ID,
    ))
    db.commit()

    assert wm_service.delete_photo(photo.id) is True

    assert deleted_files == []


def test_a_local_photo_file_is_removed(db, wm_service, deleted_files, tmp_path):
    path = tmp_path / "a.jpg"
    path.write_bytes(b"image")
    photo = add_photo(db, file_id=None, provider="local", file_path=str(path))

    assert wm_service.delete_photo(photo.id) is True

    assert not path.exists()
    assert deleted_files == []


def test_a_photo_that_cannot_be_removed_keeps_its_file(db, wm_service, deleted_files, monkeypatch):
    photo = add_photo(db)

    def refuse(photo_id):
        raise RuntimeError("database refused")

    monkeypatch.setattr(wm_service.photo_repo, "delete", refuse)

    with pytest.raises(RuntimeError):
        wm_service.delete_photo(photo.id)

    assert deleted_files == []


def test_deleting_a_missing_photo_touches_nothing(wm_service, deleted_files):
    assert wm_service.delete_photo(uuid4()) is False
    assert deleted_files == []


class FakeBlob:
    size = 5
    content_type = None

    def __init__(self, files, name):
        self.files, self.name = files, name

    def exists(self):
        return self.name in self.files

    def download_as_text(self):
        return self.files[self.name]

    def upload_from_file(self, file_data, content_type=None):
        self.files[self.name] = file_data.read()

    def upload_from_string(self, text):
        self.files[self.name] = text

    def delete(self):
        del self.files[self.name]


def gcs_provider(files, monkeypatch):
    provider = object.__new__(GCSProvider)
    provider.bucket_name = "test"
    provider.make_public = False
    provider.bucket = SimpleNamespace(blob=lambda name: FakeBlob(files, name))
    return provider


def b2_provider(files, monkeypatch):
    def get_object(Bucket, Key):
        return {"Body": io.BytesIO(files[Key])}

    def put_object(Bucket, Key, Body):
        files[Key] = Body

    def upload_fileobj(file_data, bucket, key, ExtraArgs, Config):
        files[key] = file_data.read()

    def delete_object(Bucket, Key):
        del files[Key]

    provider = object.__new__(B2Provider)
    provider.bucket_name = "test"
    provider.endpoint_url = "https://storage.example"
    provider.make_public = False
    provider.client = SimpleNamespace(
        get_object=get_object, put_object=put_object,
        upload_fileobj=upload_fileobj, delete_object=delete_object,
    )
    monkeypatch.setattr(provider, "_object_exists", lambda key: key in files)
    return provider


@pytest.mark.parametrize("make_provider", [gcs_provider, b2_provider])
def test_identical_upload_reuses_a_file_until_it_is_deleted(make_provider, monkeypatch):
    files = {}
    provider = make_provider(files, monkeypatch)
    paths = iter(["photos/first.webp", "photos/second.webp"])
    monkeypatch.setattr(provider, "_build_blob_path", lambda *args: next(paths))
    monkeypatch.setattr(
        provider, "_apply_optimizations",
        lambda file_data, *args: (file_data, {"dedup_key": "same", "file_hash": "abc"}),
    )

    def upload():
        return provider.upload(io.BytesIO(b"image"), "a.webp", "water-mitigation", "job", category="photos")

    first = upload()
    assert first.file_id == "photos/first.webp"
    assert upload().file_id == "photos/first.webp"

    assert provider.delete(first.file_id) is True

    again = upload()
    assert again.file_id == "photos/second.webp"
    assert files["photos/second.webp"] == b"image"
    # The reference now points at the new file, so the next identical upload reuses it
    assert upload().file_id == "photos/second.webp"
