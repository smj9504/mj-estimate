"""Photos load fast: a grid gets small pictures made once and kept, full photos go out in one
piece with a length, and a browser keeps them. On a throwaway SQLite database, with real
JPEGs and a stand-in for storage that counts what it's asked for."""

import asyncio
import io
from pathlib import Path
import re
import sqlite3
import sys
from types import SimpleNamespace
import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
import pytest
import sqlalchemy as sa

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory
from app.core.database_factory import Base, SQLiteDatabase
from app.domains.file import api as file_api
from app.domains.file import service as file_service
from app.domains.file import thumbnails, video_service
from app.domains.file.models import File, VideoRendition
from app.domains.storage.factory import StorageFactory
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401

sqlite3.register_adapter(uuid.UUID, str)


def jpeg(width=1920, height=1440, **save) -> bytes:
    image = Image.effect_noise((width, height), 40).convert('RGB')
    output = io.BytesIO()
    image.save(output, 'JPEG', quality=80, **save)
    return output.getvalue()


PHOTO = jpeg()


class Storage:
    provider_name = 'b2'
    supports_range = True

    def __init__(self):
        self.objects = {}
        self.downloads = []
        self.uploads = []

    @staticmethod
    def _key(file_id):
        return file_id.replace('b2://bucket/', '')

    def download(self, file_id):
        self.downloads.append(self._key(file_id))
        if self._key(file_id) not in self.objects:
            raise FileNotFoundError(file_id)
        return self.objects[self._key(file_id)]

    def upload(self, file_data, filename, context, context_id, **options):
        assert options.get('replace') and not options.get('optimize')
        key = f'{context}/{context_id}/{filename}'
        self.objects[key] = file_data.read()
        self.uploads.append(key)
        return SimpleNamespace(file_id=key, file_url=f'b2://bucket/{key}', thumbnail_url=None)

    def signed_media_url(self, file_id, expires_in=0):
        return f'https://storage.example/{file_id}'


@pytest.fixture
def env(tmp_path, monkeypatch):
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    sa.event.listen(database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF'))
    Base.metadata.create_all(database.engine, tables=[File.__table__, VideoRendition.__table__])
    # Nothing here may reach the real database, whatever the env file points at
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)
    monkeypatch.setattr(file_api, 'get_database', lambda: database)
    monkeypatch.setattr(video_service, 'get_database', lambda: database)
    monkeypatch.setattr(thumbnails.settings, 'STORAGE_BASE_DIR', str(tmp_path / 'disk'))

    storage = Storage()
    monkeypatch.setattr(StorageFactory, 'get_instance', lambda *_: storage)
    monkeypatch.setattr(file_service, '_storage_provider', storage)
    monkeypatch.setattr(video_service, 'queue_processing', lambda *_: None)

    application = FastAPI()
    application.include_router(file_api.router, prefix='/api/files')

    def add_file(content=PHOTO, content_type='image/jpeg', active=True):
        file_id = str(uuid.uuid4())
        storage.objects[f'photos/{file_id}.jpg'] = content
        session = database.get_session()
        session.add(File(
            id=file_id, filename=file_id, original_name='shot.jpg', content_type=content_type, size=len(content),
            url=f'b2://bucket/photos/{file_id}.jpg', storage_provider='b2', context='field-visit',
            context_id=str(uuid.uuid4()), category='Kitchen', is_active=active,
        ))
        session.commit()
        session.close()
        return file_id

    yield SimpleNamespace(api=TestClient(application), storage=storage, add_file=add_file)
    database.engine.dispose()


def size_of(content):
    with Image.open(io.BytesIO(content)) as image:
        return image.size


# ── Thumbnails ──────────────────────────────────────────────────────────────


def test_a_thumbnail_is_a_small_picture_a_browser_keeps(env):
    file_id = env.add_file()
    response = env.api.get(f'/api/files/thumbnail/{file_id}')
    assert response.status_code == 200
    assert response.headers['content-type'] == 'image/jpeg'
    assert 'immutable' in response.headers['cache-control']
    assert max(size_of(response.content)) == thumbnails.LONG_SIDE
    assert len(response.content) < len(PHOTO) / 5


def test_a_thumbnail_is_made_once_and_then_read_from_disk(env):
    file_id = env.add_file()
    original = f'photos/{file_id}.jpg'
    env.api.get(f'/api/files/thumbnail/{file_id}')
    assert env.storage.downloads.count(original) == 1
    assert env.storage.uploads == [f'file-thumbnails/{file_id}/thumbnail.jpg']

    env.storage.downloads.clear()
    again = env.api.get(f'/api/files/thumbnail/{file_id}')
    assert again.status_code == 200
    assert env.storage.downloads == []


def test_after_a_deploy_empties_the_disk_it_comes_back_from_storage(env, tmp_path):
    file_id = env.add_file()
    made = env.api.get(f'/api/files/thumbnail/{file_id}').content
    thumbnails.cache_path(file_id).unlink()
    env.storage.downloads.clear()

    response = env.api.get(f'/api/files/thumbnail/{file_id}')
    assert response.content == made
    assert env.storage.downloads == [f'file-thumbnails/{file_id}/thumbnail.jpg']
    assert thumbnails.cache_path(file_id).exists()


def test_moving_a_photo_to_a_claim_does_not_lose_its_thumbnail(env):
    file_id = env.add_file()
    env.api.get(f'/api/files/thumbnail/{file_id}')
    assert 'field-visit' not in env.storage.uploads[0]


def test_a_sideways_photo_comes_out_upright(env):
    exif = Image.Exif()
    exif[0x0112] = 6
    file_id = env.add_file(jpeg(1600, 1200, exif=exif))
    width, height = size_of(env.api.get(f'/api/files/thumbnail/{file_id}').content)
    assert height > width


def test_what_cant_be_shrunk_falls_back_to_the_preview(env):
    file_id = env.add_file(b'not really a picture')
    response = env.api.get(f'/api/files/thumbnail/{file_id}', follow_redirects=False)
    assert response.status_code == 302
    assert response.headers['location'] == f'../preview/{file_id}'
    assert env.api.get(f'/api/files/thumbnail/{file_id}').status_code == 200


def test_a_document_goes_to_the_preview_without_being_read(env):
    file_id = env.add_file(b'%PDF', content_type='application/pdf')
    response = env.api.get(f'/api/files/thumbnail/{file_id}', follow_redirects=False)
    assert response.status_code == 302
    assert env.storage.downloads == []


def test_a_video_shows_its_poster(env):
    file_id = env.add_file(b'', content_type='video/mp4')
    response = env.api.get(f'/api/files/thumbnail/{file_id}')
    assert response.status_code == 200
    assert response.headers['content-type'] == 'image/svg+xml'


@pytest.mark.parametrize('file_id', [str(uuid.uuid4()), 'not-a-uuid', '..%2F..%2Fsecret'])
def test_a_file_that_isnt_there_is_not_found(env, file_id):
    assert env.api.get(f'/api/files/thumbnail/{file_id}').status_code == 404


def test_a_deleted_file_has_no_thumbnail(env):
    file_id = env.add_file(active=False)
    assert env.api.get(f'/api/files/thumbnail/{file_id}').status_code == 404


def test_keeping_one_made_on_arrival_means_nobody_waits_for_it(env):
    file_id = env.add_file()
    thumbnails.keep_from_photo(file_id, 'b2', PHOTO)
    env.storage.downloads.clear()
    assert env.api.get(f'/api/files/thumbnail/{file_id}').status_code == 200
    assert env.storage.downloads == []


def test_a_photo_that_cant_be_read_on_arrival_is_left_alone(env):
    thumbnails.keep_from_photo(str(uuid.uuid4()), 'b2', b'not really a picture')
    assert env.storage.uploads == []


def test_many_thumbnails_at_once_all_arrive(env):
    ids = [env.add_file(jpeg(400, 300)) for _ in range(12)]

    async def fetch_all():
        import httpx
        transport = httpx.ASGITransport(app=env.api.app)
        async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
            return await asyncio.gather(*[client.get(f'/api/files/thumbnail/{file_id}') for file_id in ids])

    assert {response.status_code for response in asyncio.run(fetch_all())} == {200}


# ── Full photos ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize('route', ['preview/{}', 'download/{}?inline=true'])
def test_a_photo_goes_out_in_one_piece_and_a_browser_keeps_it(env, route):
    file_id = env.add_file()
    response = env.api.get(f'/api/files/{route.format(file_id)}')
    assert response.status_code == 200
    assert response.content == PHOTO
    assert response.headers['content-length'] == str(len(PHOTO))
    assert 'transfer-encoding' not in response.headers
    assert 'immutable' in response.headers['cache-control']


def test_a_download_says_attachment_and_isnt_kept(env):
    file_id = env.add_file()
    response = env.api.get(f'/api/files/download/{file_id}')
    assert response.headers['content-disposition'].startswith('attachment')
    assert 'cache-control' not in response.headers


def test_bytes_in_memory_are_never_streamed():
    """StreamingResponse iterates a BytesIO line by line, with a thread hop per line: 3,579
    pieces and 1.4s of CPU to send a 969KB photo that a Response sends in 3ms."""
    root = Path(file_api.__file__).resolve().parents[2]
    pattern = re.compile(r'StreamingResponse\(\s*(?:io\.)?BytesIO\(|StreamingResponse\(\s*(?:pdf|excel)_bytes\b')
    found = [str(path.relative_to(root)) for path in root.rglob('*.py') if pattern.search(path.read_text(encoding='utf-8'))]
    assert found == []
