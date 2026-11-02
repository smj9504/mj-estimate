"""File routes give their database connection back. A page of thumbnails asks for dozens
at once and the pool holds ten, so a route that keeps one past its answer, or while it
waits on storage, soon fails every request in the app. On a throwaway SQLite database,
with garbage collection off, because that is what used to hand them back eventually."""

import asyncio
import gc
from pathlib import Path
import sqlite3
import sys
from types import SimpleNamespace
import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory
from app.core.database_factory import Base, SQLiteDatabase
from app.domains.auth.dependencies import get_current_staff
from app.domains.file import api as file_api
from app.domains.file import service as file_service
from app.domains.file import video_service
from app.domains.file.models import File, VideoRendition
from app.domains.product_library import service as product_service
from app.domains.storage.factory import StorageFactory
from app.domains.water_mitigation.models import WaterMitigationJob, WMPhoto
from app.domains.work_order import api as work_order_api
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401

sqlite3.register_adapter(uuid.UUID, str)


@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(element, compiler, **kw):
    return 'JSON'


TABLES = [File, VideoRendition, WaterMitigationJob, WMPhoto]
CONTEXT_ID = str(uuid.uuid4())


class Connections:
    def __init__(self, engine):
        self.out = 0
        sa.event.listen(engine, 'checkout', self._taken)
        sa.event.listen(engine, 'checkin', self._returned)

    def _taken(self, *_):
        self.out += 1

    def _returned(self, *_):
        self.out -= 1


class SlowStorage:
    """Storage, noting how many connections were out while it was waited on"""
    provider_name = 'b2'
    supports_range = True

    def __init__(self, connections):
        self.connections = connections
        self.out_while_waiting = []

    def _waited_on(self):
        self.out_while_waiting.append(self.connections.out)

    def download(self, file_id):
        self._waited_on()
        return b'\xff\xd8\xff\xd9'

    def upload(self, file_data, filename, **_):
        self._waited_on()
        return SimpleNamespace(
            file_id=filename, file_url=f'b2://bucket/{filename}', thumbnail_url=None, storage_metadata={'size': 4},
        )

    def signed_media_url(self, file_id, expires_in=0):
        return f'https://storage.example/{file_id}'


@pytest.fixture
def env(tmp_path, monkeypatch):
    gc.collect()
    gc.disable()
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    sa.event.listen(database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF'))
    Base.metadata.create_all(database.engine, tables=[m.__table__ for m in TABLES])
    # Nothing here may reach the real database, whatever the env file points at
    monkeypatch.setattr(file_api, 'get_database', lambda: database)
    monkeypatch.setattr(video_service, 'get_database', lambda: database)
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)
    monkeypatch.setattr(product_service, 'get_database', lambda: database)

    connections = Connections(database.engine)
    storage = SlowStorage(connections)
    monkeypatch.setattr(StorageFactory, 'get_instance', lambda *_: storage)
    monkeypatch.setattr(file_service, '_storage_provider', storage)
    monkeypatch.setattr(video_service, 'queue_processing', lambda *_: None)
    monkeypatch.setattr(file_api, 'queue_processing', lambda *_: None)

    application = FastAPI()
    application.include_router(file_api.router, prefix='/api/files')
    application.dependency_overrides[get_current_staff] = lambda: SimpleNamespace(id=uuid.uuid4())

    def add_file(content_type='image/jpeg', context='field-visit'):
        session = database.get_session()
        file_id = str(uuid.uuid4())
        session.add(File(
            id=file_id, filename=file_id, original_name='shot', content_type=content_type, size=4,
            url=f'b2://bucket/{file_id}', storage_provider='b2', context=context, context_id=CONTEXT_ID,
            category='Kitchen',
        ))
        session.commit()
        session.close()
        return file_id

    def add_wm_photo():
        session = database.get_session()
        photo_id = str(uuid.uuid4())
        session.add(WMPhoto(
            id=photo_id, job_id=str(uuid.uuid4()), source='manual_upload', file_name='shot.jpg',
            file_path='b2://bucket/shot.jpg', file_size=4, mime_type='image/jpeg', file_type='photo',
            storage_provider='b2', storage_file_id='shot.jpg',
        ))
        session.commit()
        session.close()
        return photo_id

    assert connections.out == 0
    yield SimpleNamespace(
        api=TestClient(application),
        database=database,
        connections=connections,
        storage=storage,
        add_file=add_file,
        add_wm_photo=add_wm_photo,
    )
    gc.enable()
    database.engine.dispose()


@pytest.mark.parametrize('route', ['preview/{}', 'download/{}', 'download/{}?inline=true'])
def test_no_connection_is_held_while_a_photo_comes_from_storage(env, route):
    file_id = env.add_file()
    assert env.api.get(f'/api/files/{route.format(file_id)}').status_code == 200
    assert env.storage.out_while_waiting == [0]
    assert env.connections.out == 0


def test_no_connection_is_held_while_a_job_photo_comes_from_storage(env):
    photo_id = env.add_wm_photo()
    assert env.api.get(f'/api/files/wm-photo/{photo_id}/preview').status_code == 200
    assert env.storage.out_while_waiting == [0]
    assert env.connections.out == 0


@pytest.mark.parametrize('route,status', [
    (f'field-visit/{CONTEXT_ID}', 200),
    (f'field-visit/{CONTEXT_ID}/count', 200),
    (f'field-visit/{CONTEXT_ID}/categories', 200),
    (f'preview/{uuid.uuid4()}', 404),
    (f'download/{uuid.uuid4()}', 404),
    (f'wm-photo/{uuid.uuid4()}/preview', 404),
])
def test_every_read_gives_its_connection_back(env, route, status):
    env.add_file()
    assert env.api.get(f'/api/files/{route}').status_code == status
    assert env.connections.out == 0


def test_changes_give_their_connection_back(env):
    file_id = env.add_file()
    assert env.api.put(f'/api/files/{file_id}', json={'category': 'Bath'}).status_code == 200
    assert env.connections.out == 0

    assert env.api.delete(f'/api/files/{file_id}').status_code == 200
    assert env.connections.out == 0


def test_an_upload_gives_its_connection_back_and_keeps_the_row(env):
    response = env.api.post(
        '/api/files/upload',
        files={'files': ('a.jpg', b'\xff\xd8\xff\xd9', 'image/jpeg')},
        data={'context': 'claim', 'context_id': CONTEXT_ID, 'category': 'Kitchen'},
    )
    assert response.status_code == 200
    assert env.connections.out == 0

    listed = env.api.get(f'/api/files/claim/{CONTEXT_ID}').json()
    assert [row['originalName'] if 'originalName' in row else row['original_name'] for row in listed['data']] == ['a.jpg']


def test_a_video_and_its_poster_leave_no_connection_out(env):
    file_id = env.add_file('video/mp4')
    played = env.api.get(f'/api/files/video/{file_id}', follow_redirects=False)
    assert played.status_code == 302
    assert played.headers['location'] == f'https://storage.example/b2://bucket/{file_id}'
    assert env.api.get(f'/api/files/preview/{file_id}').status_code == 200
    assert env.connections.out == 0


def test_the_count_of_a_work_orders_files_gives_its_connection_back(env):
    found = work_order_api.get_work_order_file_count(uuid.uuid4(), file_type=None, _staff=None)
    assert found == {'count': 0}
    assert env.connections.out == 0


def test_a_products_picture_is_saved_and_its_connection_given_back(env):
    service = product_service.ProductService(db=None)
    file_id = asyncio.run(service._store(uuid.uuid4(), b'\xff\xd8\xff\xd9', 'p.jpg', 'image/jpeg', 'image'))
    assert env.connections.out == 0

    session = env.database.get_session()
    try:
        assert session.query(File).filter(File.id == file_id).first() is not None
    finally:
        session.close()
