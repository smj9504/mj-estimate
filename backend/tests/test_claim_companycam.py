"""CompanyCam photos come into a claim's own photos: each only once, on a throwaway
SQLite database with stand-ins for CompanyCam, storage and the cache."""

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
import json
import sys

from fastapi import BackgroundTasks, HTTPException
from fastapi.testclient import TestClient
import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory
from app.core.database_factory import Base, SQLiteDatabase
from app.domains.auth import company_scope
from app.domains.auth.dependencies import get_current_staff
from app.domains.client import claim_companycam
from app.domains.client.models import Claim, Client
from app.domains.file.models import File
from app.domains.integrations.companycam import client as companycam_client
from app.domains.integrations.companycam import project_search
from app.domains.integrations.companycam.utils import photo_download_url, summarize_photo_dates, videos_as_media
from app.domains.storage.base import UploadResult
from app.domains.storage.factory import StorageFactory
from app.domains.water_mitigation.models import WaterMitigationJob, WMPhoto
from app.main import app

TABLES = [Client, Claim, WaterMitigationJob, WMPhoto, File]


@compiles(JSONB, 'sqlite')
def jsonb_as_json(type_, compiler, **kw):
    return 'JSON'


def cc_photo(photo_id, captured_at='2026-10-12T15:00:00Z', **fields):
    return {
        'id': photo_id,
        'captured_at': captured_at,
        'uris': [
            {'type': 'thumbnail', 'uri': f'https://cc/{photo_id}/thumb'},
            {'type': 'web', 'uri': f'https://cc/{photo_id}/web'},
        ],
        **fields,
    }


class FakeCache:
    def __init__(self):
        self.values = {}

    async def get(self, key):
        return self.values.get(key)

    async def set(self, key, value, ttl=3600):
        self.values[key] = value
        return True


class FakeCompanyCam:
    photos = []
    videos = []
    # Photo ids whose download fails
    failing = set()
    on_download = None

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get_project_photos(self, project_id):
        return list(type(self).photos)

    async def get_project_videos_as_media(self, project_id, strict=False):
        return videos_as_media(type(self).videos)

    async def download_photo(self, url):
        photo_id = int(url.split('/')[3])
        if type(self).on_download:
            await type(self).on_download(photo_id)
        if photo_id in type(self).failing:
            raise RuntimeError('CDN dropped it')
        return f'bytes-{photo_id}'.encode()


class FakeStorage:
    provider_name = 'fake'

    def __init__(self):
        self.uploads = []

    def upload(self, file_data, filename, context, context_id, category=None,
               content_type=None, metadata=None, optimize=True):
        self.uploads.append(filename)
        return UploadResult(
            file_id=f'id-{filename}',
            file_path=f'claim/{context_id}/{filename}',
            file_url=f'https://store/{filename}',
            thumbnail_url=f'https://store/thumb-{filename}',
        )


@pytest.fixture
def env(tmp_path, monkeypatch):
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    sa.event.listen(
        database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF')
    )
    Base.metadata.create_all(database.engine, tables=[m.__table__ for m in TABLES])
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)
    monkeypatch.setattr(claim_companycam, 'get_database', lambda: database)

    cache = FakeCache()
    monkeypatch.setattr(claim_companycam, 'get_cache', lambda: cache)
    storage = FakeStorage()
    monkeypatch.setattr(StorageFactory, 'get_instance', classmethod(lambda cls: storage))
    FakeCompanyCam.photos = []
    FakeCompanyCam.videos = []
    FakeCompanyCam.failing = set()
    FakeCompanyCam.on_download = None
    monkeypatch.setattr(companycam_client, 'CompanyCamClient', FakeCompanyCam)

    session = database.get_session()
    client = Client(
        display_name='Pat Client', owners=[],
        address='4215 Middlebrook St', city='Fairfax', state='VA', zipcode='22032',
    )
    session.add(client)
    session.flush()
    claim = Claim(client_id=client.id, claim_number='46-0S0M464', status='open')
    session.add(claim)
    session.flush()
    claim_id = str(claim.id)
    client_id = str(client.id)
    session.commit()
    session.close()
    return SimpleNamespace(
        database=database, cache=cache, storage=storage, claim_id=claim_id, client_id=client_id,
    )


def add_file(env, name, active=True):
    session = env.database.get_session()
    session.add(File(
        filename=name, original_name=name, content_type='image/jpeg', size=1, url='/x',
        context='claim', context_id=env.claim_id, category='general', is_active=active,
    ))
    session.commit()
    session.close()


def add_job_photo(env, external_id, trashed=False):
    session = env.database.get_session()
    job = WaterMitigationJob(claim_id=env.claim_id, property_address='4215 Middlebrook St')
    session.add(job)
    session.flush()
    session.add(WMPhoto(
        job_id=job.id, source='companycam', external_id=external_id,
        file_name=f'companycam_{external_id}.jpg', file_path='/x', is_trashed=trashed,
    ))
    session.commit()
    session.close()


def claim_files(env):
    session = env.database.get_session()
    try:
        return session.query(File).filter(File.context == 'claim', File.context_id == env.claim_id).all()
    finally:
        session.close()


def imported_names(env):
    return sorted(f.original_name for f in claim_files(env))


def final_status(env):
    return json.loads(env.cache.values[claim_companycam._status_key(env.claim_id)])


# ── Picking dates ─────────────────────────────

def test_dates_count_only_what_isnt_on_the_claim_yet(env):
    add_file(env, 'companycam_1.jpg')
    add_file(env, 'companycam_2.jpg', active=False)
    add_job_photo(env, '3')
    add_job_photo(env, '4', trashed=True)
    FakeCompanyCam.photos = [cc_photo(i) for i in (1, 2, 3, 4, 5, 6)]

    result = asyncio.run(claim_companycam.photo_dates(env.claim_id, '77'))

    assert result['project_id'] == '77'
    assert result['total_photos'] == 6
    assert result['total_new'] == 2
    assert result['dates'] == [{'date': '2026-10-12', 'total_count': 6, 'new_count': 2}]


def test_an_uploaded_photo_with_a_lookalike_name_doesnt_count_as_imported(env):
    add_file(env, 'companycam_1_copy.jpg')
    FakeCompanyCam.photos = [cc_photo(1)]
    assert asyncio.run(claim_companycam.photo_dates(env.claim_id, '77'))['total_new'] == 1


def test_date_summary_is_newest_first_with_unknown_last():
    photos = [
        {'id': 1, 'captured_at': '2026-01-05T10:00:00Z'},
        {'id': 2},
        {'id': 3, 'captured_at': '2026-06-05T10:00:00Z'},
        {'id': 4, 'captured_at': '2026-06-05T11:00:00Z'},
    ]
    summary = summarize_photo_dates(photos, {'4'})
    assert summary['dates'] == [
        {'date': '2026-06-05', 'total_count': 2, 'new_count': 1},
        {'date': '2026-01-05', 'total_count': 1, 'new_count': 1},
        {'date': None, 'total_count': 1, 'new_count': 1},
    ]
    assert (summary['total_photos'], summary['total_new']) == (4, 3)


@pytest.mark.parametrize('uris, expected', [
    ([{'type': 'original', 'uri': 'o'}, {'type': 'web', 'uri': 'w'}, {'type': 'large', 'uri': 'l'}], 'l'),
    ([{'type': 'original', 'uri': 'o'}, {'type': 'web', 'uri': 'w'}], 'w'),
    ([{'type': 'thumbnail', 'uri': 't'}, {'type': 'original', 'uri': 'o'}], 'o'),
    ({'web': 'w', 'original': 'o'}, 'w'),
    ([{'type': 'thumbnail', 'uri': 't'}], None),
    ([], None),
])
def test_the_stored_size_is_never_a_thumbnail(uris, expected):
    assert photo_download_url({'uris': uris}) == expected


# ── Importing ─────────────────────────────────

def test_import_stores_new_photos_dated_when_they_were_taken(env):
    add_file(env, 'companycam_1.jpg')
    add_job_photo(env, '2')
    FakeCompanyCam.photos = [
        cc_photo(1), cc_photo(2),
        cc_photo(3, captured_at='2026-03-04T05:06:07Z', description='Back wall'),
    ]

    asyncio.run(claim_companycam.run_import(env.claim_id, 77))

    assert env.storage.uploads == ['companycam_3.jpg']
    stored = next(f for f in claim_files(env) if f.original_name == 'companycam_3.jpg')
    assert stored.filename == 'id-companycam_3.jpg'
    assert stored.url == 'https://store/companycam_3.jpg'
    assert stored.thumbnail_url == 'https://store/thumb-companycam_3.jpg'
    assert stored.storage_provider == 'fake'
    assert stored.content_type == 'image/jpeg'
    assert stored.size == len(b'bytes-3')
    assert stored.category == 'general'
    assert stored.description == 'Back wall'
    assert stored.uploaded_by == 'CompanyCam'
    assert stored.upload_date.replace(tzinfo=None) == datetime(2026, 3, 4, 5, 6, 7)

    status = final_status(env)
    assert status['status'] == 'completed'
    assert (status['synced_count'], status['skipped_existing'], status['total_companycam']) == (1, 2, 3)


def test_importing_again_adds_nothing(env):
    FakeCompanyCam.photos = [cc_photo(1), cc_photo(2)]
    asyncio.run(claim_companycam.run_import(env.claim_id, 77))
    asyncio.run(claim_companycam.run_import(env.claim_id, 77))

    assert imported_names(env) == ['companycam_1.jpg', 'companycam_2.jpg']
    assert final_status(env)['synced_count'] == 0
    assert final_status(env)['skipped_existing'] == 2


def test_a_photo_deleted_from_the_claim_stays_out(env):
    add_file(env, 'companycam_1.jpg', active=False)
    FakeCompanyCam.photos = [cc_photo(1)]
    asyncio.run(claim_companycam.run_import(env.claim_id, 77))
    assert env.storage.uploads == []


def test_only_the_picked_dates_come_in(env):
    FakeCompanyCam.photos = [
        cc_photo(1, captured_at='2026-01-05T10:00:00Z'),
        cc_photo(2, captured_at='2026-06-05T10:00:00Z'),
        {**cc_photo(3), 'captured_at': None},
    ]
    asyncio.run(claim_companycam.run_import(env.claim_id, 77, ['2026-06-05', 'unknown']))

    assert imported_names(env) == ['companycam_2.jpg', 'companycam_3.jpg']
    assert final_status(env)['skipped_date_filtered'] == 1


def test_a_photo_with_no_capture_date_is_dated_today(env):
    FakeCompanyCam.photos = [{**cc_photo(1), 'captured_at': None}]
    before = datetime.now(timezone.utc).replace(tzinfo=None)
    asyncio.run(claim_companycam.run_import(env.claim_id, 77))
    assert claim_files(env)[0].upload_date.replace(tzinfo=None) >= before.replace(microsecond=0)


def test_one_failed_download_doesnt_stop_the_rest(env):
    FakeCompanyCam.photos = [cc_photo(1), cc_photo(2), cc_photo(3)]
    FakeCompanyCam.failing = {2}

    asyncio.run(claim_companycam.run_import(env.claim_id, 77))

    assert imported_names(env) == ['companycam_1.jpg', 'companycam_3.jpg']
    status = final_status(env)
    assert status['status'] == 'completed'
    assert "1 couldn't be imported" in status['message']
    assert len(status['errors']) == 1


def test_nothing_imported_because_of_errors_is_a_failure(env):
    FakeCompanyCam.photos = [cc_photo(1)]
    FakeCompanyCam.failing = {1}
    asyncio.run(claim_companycam.run_import(env.claim_id, 77))
    assert final_status(env)['status'] == 'failed'


def test_a_crash_is_reported_rather_than_left_running(env, monkeypatch):
    FakeCompanyCam.photos = [cc_photo(1)]
    monkeypatch.setattr(claim_companycam, '_imported_ids', lambda *a: 1 / 0)
    asyncio.run(claim_companycam.run_import(env.claim_id, 77))
    status = final_status(env)
    assert status['status'] == 'failed'
    assert 'division by zero' in status['message']


def test_cancelling_keeps_what_came_in_before_it(env, monkeypatch):
    monkeypatch.setattr(claim_companycam, 'BATCH_SIZE', 1)
    FakeCompanyCam.photos = [cc_photo(1), cc_photo(2), cc_photo(3)]

    async def cancel_during_the_first(photo_id):
        await claim_companycam.cancel_import(env.claim_id)

    async def run():
        await env.cache.set(
            claim_companycam._status_key(env.claim_id), json.dumps({'status': 'running'})
        )
        FakeCompanyCam.on_download = cancel_during_the_first
        await claim_companycam.run_import(env.claim_id, 77)

    asyncio.run(run())

    assert imported_names(env) == ['companycam_1.jpg']
    status = final_status(env)
    assert status['status'] == 'cancelled'
    assert status['synced_count'] == 1


# ── Starting and following ────────────────────

def test_start_runs_the_import_in_the_background_with_the_picked_dates(env):
    tasks = BackgroundTasks()
    result = asyncio.run(claim_companycam.start_import(
        env.claim_id, '77', '2026-06-05, unknown,', tasks,
    ))

    assert result['status'] == 'running'
    assert result['success'] is True
    assert asyncio.run(claim_companycam.import_status(env.claim_id))['status'] == 'running'
    task = tasks.tasks[0]
    assert task.func is claim_companycam.run_import_in_background
    assert task.args == (env.claim_id, 77, ['2026-06-05', 'unknown'])


def test_a_second_start_while_running_is_turned_away(env):
    asyncio.run(claim_companycam.start_import(env.claim_id, '77', None, BackgroundTasks()))
    tasks = BackgroundTasks()
    result = asyncio.run(claim_companycam.start_import(env.claim_id, '77', None, tasks))

    assert result['success'] is False
    assert result['status'] == 'running'
    assert tasks.tasks == []


def test_the_background_runner_completes_on_its_own_event_loop(env):
    FakeCompanyCam.photos = [cc_photo(1)]
    claim_companycam.run_import_in_background(env.claim_id, 77, None)
    assert final_status(env)['status'] == 'completed'
    assert imported_names(env) == ['companycam_1.jpg']


def test_nothing_running_reads_as_idle_and_cant_be_cancelled(env):
    assert asyncio.run(claim_companycam.import_status(env.claim_id))['status'] == 'idle'
    assert asyncio.run(claim_companycam.cancel_import(env.claim_id))['success'] is False


@pytest.mark.parametrize('project_id', [None, '', 'abc', '12; DROP', '-5'])
def test_a_project_id_must_be_a_number(env, project_id):
    with pytest.raises(HTTPException) as caught:
        asyncio.run(claim_companycam.start_import(env.claim_id, project_id, None, BackgroundTasks()))
    assert caught.value.status_code == 400


@pytest.mark.parametrize('claim_id', ['not-a-uuid', '00000000-0000-0000-0000-000000000000'])
def test_an_unknown_claim_is_not_found(env, claim_id):
    with pytest.raises(HTTPException) as caught:
        asyncio.run(claim_companycam.start_import(claim_id, '77', None, BackgroundTasks()))
    assert caught.value.status_code == 404


# ── Finding the project ───────────────────────

def test_search_goes_by_the_clients_address(env, monkeypatch):
    seen = {}

    async def fake_search(street, city, state, zipcode, query=None):
        seen.update(street=street, city=city, state=state, zipcode=zipcode, query=query)
        return {'projects': []}

    monkeypatch.setattr(project_search, 'search_projects_by_address', fake_search)
    asyncio.run(claim_companycam.search_projects(env.claim_id))

    assert seen == {
        'street': '4215 Middlebrook St', 'city': 'Fairfax', 'state': 'VA',
        'zipcode': '22032', 'query': None,
    }


def test_a_client_with_no_address_cant_be_searched_for(env):
    session = env.database.get_session()
    session.query(Client).update({'address': None, 'city': None, 'state': None, 'zipcode': None})
    session.commit()
    session.close()

    with pytest.raises(HTTPException) as caught:
        asyncio.run(claim_companycam.search_projects(env.claim_id))
    assert caught.value.status_code == 400


def test_project_search_scores_the_closest_address_first(monkeypatch):
    class Search(FakeCompanyCam):
        async def search_projects(self, query, per_page=50):
            return [
                {'id': 1, 'name': '9 Elsewhere Rd', 'photo_count': 3},
                {'id': 2, 'name': '4215 Middlebrook St', 'photo_count': 8},
            ]

    monkeypatch.setattr(project_search, 'CompanyCamClient', Search)
    result = asyncio.run(project_search.search_projects_by_address(
        '4215 Middlebrook St', 'Fairfax', 'VA', '22032',
    ))

    assert result['job_address'] == '4215 Middlebrook St, Fairfax, VA, 22032'
    assert result['search_query'] == '4215 Middlebrook St'
    assert result['projects'][0]['id'] == '2'
    assert result['projects'][0]['match_score'] == 100.0


# ── Through the routes ────────────────────────

def test_the_routes_run_an_import_from_dates_to_done(env):
    FakeCompanyCam.photos = [
        cc_photo(1, captured_at='2026-01-05T10:00:00Z'),
        cc_photo(2, captured_at='2026-06-05T10:00:00Z'),
    ]
    app.dependency_overrides[get_current_staff] = lambda: SimpleNamespace(id='x', role='admin')
    app.dependency_overrides[database_factory.get_db_session] = lambda: None
    base = f'/api/clients/{env.client_id}/claims/{env.claim_id}'
    try:
        api = TestClient(app)
        dates = api.get(f'{base}/companycam-photo-dates', params={'companycam_project_id': '77'}).json()
        assert [d['date'] for d in dates['dates']] == ['2026-06-05', '2026-01-05']

        # TestClient runs the background task before handing back the response
        started = api.post(f'{base}/sync-companycam-photos', params={
            'companycam_project_id': '77', 'selected_dates': '2026-06-05',
        })
        assert started.json()['success'] is True

        status = api.get(f'{base}/sync-companycam-photos/status').json()
        assert status['status'] == 'completed'
        assert status['synced_count'] == 1
        assert imported_names(env) == ['companycam_2.jpg']

        again = api.get(f'{base}/companycam-photo-dates', params={'companycam_project_id': '77'}).json()
        assert again['total_new'] == 1
    finally:
        app.dependency_overrides.pop(get_current_staff, None)
        app.dependency_overrides.pop(database_factory.get_db_session, None)


# ── Who may ───────────────────────────────────

@pytest.mark.parametrize('method, path', [
    ('get', 'search-companycam-projects'),
    ('get', 'companycam-photo-dates?companycam_project_id=77'),
    ('post', 'sync-companycam-photos?companycam_project_id=77'),
    ('get', 'sync-companycam-photos/status'),
    ('post', 'sync-companycam-photos/cancel'),
])
def test_someone_who_cant_see_the_claim_gets_404_from_every_route(env, monkeypatch, method, path):
    def not_theirs(*args, **kwargs):
        raise HTTPException(status_code=404, detail='Claim not found')

    monkeypatch.setattr(company_scope, 'require_claim', not_theirs)
    # A real way to notice a route running past the guard
    monkeypatch.setattr(claim_companycam, 'get_database', lambda: 1 / 0)
    app.dependency_overrides[get_current_staff] = lambda: SimpleNamespace(id='x', role='staff')
    app.dependency_overrides[database_factory.get_db_session] = lambda: None
    try:
        response = getattr(TestClient(app), method)(
            f'/api/clients/{env.client_id}/claims/{env.claim_id}/{path}'
        )
    finally:
        app.dependency_overrides.pop(get_current_staff, None)
        app.dependency_overrides.pop(database_factory.get_db_session, None)

    assert response.status_code == 404
    assert response.json()['detail'] == 'Claim not found'


# ── Videos ────────────────────────────────────

def cc_video(video_id, captured_at=1792257645, status='processed', extension='mov'):
    return {
        'id': video_id,
        'status': status,
        'format': 'm3u8',
        'captured_at': captured_at,
        'playback_url': f'https://s3.example/{video_id}.{extension}?X-Amz-Signature=x',
        'thumbnail_urls': {'large': f'https://img/{video_id}/l', 'medium': f'https://img/{video_id}/m'},
    }


@pytest.fixture
def videos(env, monkeypatch):
    state = SimpleNamespace(queued=[], failing=set())

    def download(url, dest, headers=None):
        if any(str(video_id) in url for video_id in state.failing):
            raise claim_companycam.video_tools.VideoToolError('Download failed: 500')
        Path(dest).write_bytes(b'video-bytes')
        return 11

    monkeypatch.setattr(claim_companycam.video_tools, 'download_to_file', download)
    monkeypatch.setattr(claim_companycam, 'queue_processing', lambda owner, owner_id: state.queued.append(owner_id))
    return state


def test_videos_come_in_with_the_photos(env, videos):
    FakeCompanyCam.photos = [cc_photo(1)]
    FakeCompanyCam.videos = [cc_video(7), cc_video(8, extension='mp4')]

    asyncio.run(claim_companycam.run_import(env.claim_id, 1))

    by_name = {f.original_name: f for f in claim_files(env)}
    assert set(by_name) == {'companycam_1.jpg', 'companycam_video_7.mov', 'companycam_video_8.mp4'}
    video = by_name['companycam_video_7.mov']
    assert video.content_type == 'video/quicktime'
    assert video.size == len(b'video-bytes')
    assert video.thumbnail_url == 'https://img/7/m'
    assert video.upload_date.year == 2026
    assert by_name['companycam_video_8.mp4'].content_type == 'video/mp4'
    # Each goes on to be checked for what browsers can play
    assert len(videos.queued) == 2
    status = json.loads(env.cache.values[claim_companycam._status_key(env.claim_id)])
    assert status['status'] == 'completed'
    assert status['synced_count'] == 3


def test_a_video_comes_in_only_once(env, videos):
    FakeCompanyCam.videos = [cc_video(7)]
    asyncio.run(claim_companycam.run_import(env.claim_id, 1))

    asyncio.run(claim_companycam.run_import(env.claim_id, 1))

    assert len(claim_files(env)) == 1
    status = json.loads(env.cache.values[claim_companycam._status_key(env.claim_id)])
    assert status['skipped_existing'] == 1


def test_a_video_on_the_claims_job_isnt_imported_again(env, videos):
    add_job_photo(env, 'companycam_video_7')
    FakeCompanyCam.videos = [cc_video(7)]

    asyncio.run(claim_companycam.run_import(env.claim_id, 1))

    assert claim_files(env) == []


def test_a_video_companycam_is_still_working_on_waits_for_the_next_import(env, videos):
    FakeCompanyCam.videos = [cc_video(7, status='processing')]

    asyncio.run(claim_companycam.run_import(env.claim_id, 1))

    assert claim_files(env) == []


def test_a_video_that_wont_download_doesnt_stop_the_rest(env, videos):
    FakeCompanyCam.videos = [cc_video(7), cc_video(8)]
    videos.failing = {7}

    asyncio.run(claim_companycam.run_import(env.claim_id, 1))

    assert [f.original_name for f in claim_files(env)] == ['companycam_video_8.mov']
    status = json.loads(env.cache.values[claim_companycam._status_key(env.claim_id)])
    assert status['status'] == 'completed'
    assert any('video' in error for error in status['errors'])
    # The signed URL stays out of what the page shows
    assert not any('Signature' in error for error in status['errors'])


def test_the_dates_count_videos_too(env, videos):
    FakeCompanyCam.photos = [cc_photo(1, captured_at=1792257645)]
    FakeCompanyCam.videos = [cc_video(7)]

    summary = asyncio.run(claim_companycam.photo_dates(env.claim_id, '1'))

    assert summary['total_photos'] == 2
    assert summary['total_new'] == 2
