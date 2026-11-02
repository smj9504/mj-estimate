"""Videos and iPhone photos on jobs and claims: everything MagicPlan holds comes in, on a
throwaway SQLite database with stand-ins for the providers. ffmpeg runs for real, on
clips it makes itself, so nothing reaches a provider or Neon."""

import asyncio
import io
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException, UploadFile
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from starlette.datastructures import Headers

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.common.base_repository import SQLAlchemyRepository
from app.common.services import media_types, video_tools
from app.core import database_factory
from app.core.database_factory import Base, SQLiteDatabase
from app.domains.file import video_service
from app.domains.file.models import File, VideoRendition
from app.domains.integrations.companycam import utils as companycam_utils
from app.domains.integrations.companycam import webhook_handler_wm
from app.domains.integrations.magicplan import client as magicplan_client
from app.domains.integrations.magicplan import sync_service as magicplan_sync
from app.domains.integrations.magicplan.client import MagicPlanClient
from app.domains.storage.base import UploadResult
from app.domains.storage.factory import StorageFactory
from app.domains.storage.local_provider import LocalStorageProvider
from app.domains.storage.optimization import ImageOptimizer, heic_to_jpeg
from app.domains.water_mitigation.models import PhotoCategory, WaterMitigationJob, WMPhoto, WMPhotoCategory
from app.domains.water_mitigation.service import WaterMitigationService
from app.main import app

TABLES = [WaterMitigationJob, WMPhoto, PhotoCategory, WMPhotoCategory, File, VideoRendition]

IPHONE_HEVC_PROBE = """Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'IMG_0001.MOV':
  Metadata:
    major_brand     : qt
    creation_time   : 2026-08-24T20:21:39.000000Z
    com.apple.quicktime.model: iPhone 16 Plus
  Duration: 00:01:13.55, start: 0.000000, bitrate: 14900 kb/s
  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv, bt709), 1920x1080, 14664 kb/s, 29.97 fps, 29.97 tbr, 600 tbn (default)
      Side data:
        displaymatrix: rotation of -90.00 degrees
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s (default)
  Stream #0:2[0x3](und): Data: none (mebx / 0x7862656D), 0 kb/s (default)
"""
IPHONE_H264_PROBE = IPHONE_HEVC_PROBE.replace(
    'Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv, bt709)',
    'Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive)',
)
IPHONE_HDR_PROBE = IPHONE_HEVC_PROBE.replace(
    'Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv, bt709)',
    'Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67)',
)


@compiles(JSONB, 'sqlite')
def jsonb_as_json(type_, compiler, **kw):
    return 'JSON'


@pytest.fixture
def db(tmp_path, monkeypatch):
    # The base repository hands datetimes on as strings, which Postgres takes and SQLite refuses
    prepare = SQLAlchemyRepository._prepare_sqlalchemy_data

    def with_datetimes(self, data):
        prepared = prepare(self, data)
        for column in self.model_class.__table__.columns:
            if isinstance(column.type, sa.DateTime) and isinstance(prepared.get(column.name), str):
                prepared[column.name] = datetime.fromisoformat(prepared[column.name].replace('Z', '+00:00'))
        return prepared

    monkeypatch.setattr(SQLAlchemyRepository, '_prepare_sqlalchemy_data', with_datetimes)

    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    sa.event.listen(database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF'))
    Base.metadata.create_all(database.engine, tables=[m.__table__ for m in TABLES])
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)
    monkeypatch.setattr(video_service, 'get_database', lambda: database)
    return database


def make_job(database, address='1 Test St'):
    session = database.get_session()
    job = WaterMitigationJob(property_address=address)
    session.add(job)
    session.commit()
    job_id = str(job.id)
    session.close()
    return job_id


def rows(database):
    session = database.get_session()
    try:
        return session.query(WMPhoto).order_by(WMPhoto.file_name).all()
    finally:
        session.close()


# ── What a file is ────────────────────────────

@pytest.mark.parametrize('filename,declared,expected', [
    # Windows reports an iPhone's .heic with no type, which arrives as octet-stream
    ('IMG_0100.HEIC', 'application/octet-stream', 'image/heic'),
    ('IMG_0100.heic', '', 'image/heic'),
    ('IMG_0001.MOV', 'application/octet-stream', 'video/quicktime'),
    ('IMG_0001.MOV', 'video/quicktime', 'video/quicktime'),
    ('clip.mp4', 'VIDEO/MP4; codecs=avc1', 'video/mp4'),
    ('notes.pdf', 'application/pdf', 'application/pdf'),
    ('mystery', 'application/octet-stream', 'application/octet-stream'),
])
def test_media_type_goes_by_the_name_when_the_browser_doesnt_know(filename, declared, expected):
    assert media_types.media_type_of(filename, declared) == expected


def test_a_mov_is_served_as_mp4_because_some_browsers_wont_try_quicktime():
    assert media_types.browser_video_type('video/quicktime') == 'video/mp4'
    assert media_types.browser_video_type('video/webm') == 'video/webm'


# ── Reading a video ───────────────────────────

def test_probe_reads_an_iphone_clip():
    info = video_tools._parse_probe(IPHONE_HEVC_PROBE)
    assert (info.container, info.codec, info.pixel_format) == ('mov', 'hevc', 'yuv420p')
    assert (info.width, info.height) == (1920, 1080)
    assert info.audio_codec == 'aac'
    assert info.duration_seconds == pytest.approx(73.55)
    assert info.created_at == datetime(2026, 8, 24, 20, 21, 39, tzinfo=timezone.utc)
    assert not info.hdr


def test_hevc_needs_a_copy_but_h264_in_a_mov_plays_as_it_is():
    assert not video_tools._parse_probe(IPHONE_HEVC_PROBE).plays_in_browsers
    assert video_tools._parse_probe(IPHONE_HEVC_PROBE).video_needs_encoding
    assert video_tools._parse_probe(IPHONE_H264_PROBE).plays_in_browsers


def test_iphone_hdr_is_recognised():
    info = video_tools._parse_probe(IPHONE_HDR_PROBE)
    assert info.hdr and info.pixel_format == 'yuv420p10le'
    assert 'tonemap' in video_tools._sdr_filter(info, 1280)
    assert 'tonemap' not in video_tools._sdr_filter(video_tools._parse_probe(IPHONE_HEVC_PROBE), 1280)


def test_h264_in_other_containers_or_with_other_audio_gets_a_copy_without_reencoding():
    in_avi = video_tools._parse_probe(IPHONE_H264_PROBE.replace('mov,mp4,m4a,3gp,3g2,mj2', 'avi'))
    assert not in_avi.plays_in_browsers and not in_avi.video_needs_encoding
    pcm = video_tools._parse_probe(IPHONE_H264_PROBE.replace('aac (LC) (mp4a / 0x6134706D)', 'pcm_s16le'))
    assert not pcm.plays_in_browsers and not pcm.video_needs_encoding


def test_a_cover_image_isnt_taken_for_the_video():
    output = (
        "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x':\n"
        "  Stream #0:0: Video: mjpeg (Baseline), yuvj420p(pc), 600x600 (attached pic)\n"
        "  Stream #0:1: Video: h264 (High), yuv420p(tv), 1280x720\n"
    )
    assert video_tools._parse_probe(output).codec == 'h264'


def test_an_unset_camera_clock_isnt_a_date():
    output = IPHONE_HEVC_PROBE.replace('2026-08-24T20:21:39', '1904-01-01T00:00:00')
    assert video_tools._parse_probe(output).created_at is None


def test_a_signed_url_never_reaches_an_error_message():
    message = video_tools._clean_error('https://s3.amazonaws.com/x.mov?X-Amz-Signature=secret: 403 Forbidden')
    assert 'secret' not in message and '403 Forbidden' in message


def test_a_stream_isnt_saved_as_if_it_were_a_video(tmp_path):
    with pytest.raises(video_tools.VideoToolError):
        video_tools.download_to_file('https://cdn/x/video.m3u8?sig=1', tmp_path / 'x')


# ── ffmpeg, for real ──────────────────────────

@pytest.fixture(scope='module')
def clips(tmp_path_factory):
    folder = tmp_path_factory.mktemp('clips')
    ffmpeg = video_tools.ffmpeg_path()
    if not ffmpeg:
        pytest.skip('ffmpeg is not available')

    def make(name, *args, seconds='2'):
        path = folder / name
        subprocess.run(
            [ffmpeg, '-hide_banner', '-loglevel', 'error', '-y',
             *args[0],
             '-f', 'lavfi', '-i', f'testsrc2=size=640x360:rate=15:duration={seconds}',
             '-f', 'lavfi', '-i', f'sine=frequency=440:duration={seconds}',
             *args[1], '-c:a', 'aac', '-shortest', str(path)],
            check=True,
        )
        return path

    return SimpleNamespace(
        hevc_portrait=make(
            'hevc.mov',
            ['-display_rotation', '-90'],
            ['-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'log-level=error',
             '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', '-metadata', 'creation_time=2026-03-14T15:09:26Z'],
        ),
        h264=make('h264.mov', [], ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']),
        hdr=make(
            'hdr.mov',
            [],
            ['-c:v', 'libx265', '-preset', 'ultrafast',
             '-x265-params', 'log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc',
             '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p10le',
             '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc'],
        ),
        tiny=make('tiny.mp4', [], ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'], seconds='0.3'),
    )


def test_a_copy_of_an_iphone_clip_is_h264_upright_and_starts_quickly(clips, tmp_path):
    info = video_tools.probe(str(clips.hevc_portrait))
    assert info.codec == 'hevc' and not info.plays_in_browsers

    copy = tmp_path / 'copy.mp4'
    video_tools.make_playback_copy(str(clips.hevc_portrait), copy, info)

    made = video_tools.probe(str(copy))
    assert made.plays_in_browsers
    # The rotation flag became real pixels, the right way up
    assert made.height > made.width
    # moov ahead of the data: playback starts before the whole file has loaded
    head = copy.read_bytes()
    assert head.find(b'moov') < head.find(b'mdat')


def test_hdr_comes_out_as_ordinary_video(clips, tmp_path):
    info = video_tools.probe(str(clips.hdr))
    assert info.hdr
    copy = tmp_path / 'copy.mp4'
    video_tools.make_playback_copy(str(clips.hdr), copy, info)
    made = video_tools.probe(str(copy))
    assert made.plays_in_browsers and not made.hdr


def test_a_poster_is_a_picture_the_right_way_up(clips, tmp_path):
    poster = tmp_path / 'poster.jpg'
    video_tools.make_poster(str(clips.hevc_portrait), poster, video_tools.probe(str(clips.hevc_portrait)))
    with Image.open(poster) as image:
        assert image.format == 'JPEG'
        assert image.height > image.width


def test_a_clip_shorter_than_the_seek_still_gets_a_poster(clips, tmp_path):
    poster = tmp_path / 'poster.jpg'
    video_tools.make_poster(str(clips.tiny), poster)
    assert poster.stat().st_size > 0


def test_nothing_starts_that_would_not_fit_in_memory(clips, tmp_path, monkeypatch):
    info = video_tools.probe(str(clips.hevc_portrait))
    monkeypatch.setattr(video_tools, 'memory_headroom', lambda: 40 * 1024 * 1024)
    with pytest.raises(video_tools.VideoLowMemory):
        video_tools.make_playback_copy(str(clips.hevc_portrait), tmp_path / 'copy.mp4', info)


def test_a_4k_clip_asks_for_far_more_room_than_1080p():
    def needed(width, height, pixel_format):
        return video_tools._decoded_frame_bytes(SimpleNamespace(width=width, height=height, pixel_format=pixel_format))

    assert needed(3840, 2160, 'yuv420p10le') == needed(1920, 1080, 'yuv420p') * 8


def test_running_short_of_memory_stops_ffmpeg_rather_than_the_server(clips, tmp_path, monkeypatch):
    # Plenty at the start, then none
    readings = iter([10 ** 10])
    monkeypatch.setattr(video_tools, 'memory_headroom', lambda: next(readings, 0))
    info = video_tools.probe(str(clips.hevc_portrait))
    with pytest.raises(video_tools.VideoLowMemory):
        # Long enough for the watchdog's first look
        video_tools._run(
            ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=60',
             '-c:v', 'libx264', '-preset', 'veryslow', str(tmp_path / 'long.mp4')],
            timeout=60,
        )
    assert info.codec == 'hevc'


# ── Photos ────────────────────────────────────

def _arrow(width=200, height=300) -> Image.Image:
    """White at the top, black below: which way up is plain to see"""
    image = Image.new('RGB', (width, height), (0, 0, 0))
    ImageDraw.Draw(image).rectangle([0, 0, width, height // 3], fill=(255, 255, 255))
    return image


def _top_is_white(image: Image.Image) -> bool:
    rgb = image.convert('RGB')
    return rgb.getpixel((rgb.width // 2, 5))[0] > 200 and rgb.getpixel((rgb.width // 2, rgb.height - 5))[0] < 60


def _heic(with_date='2026:02:03 04:05:06') -> bytes:
    pillow_heif = pytest.importorskip('pillow_heif')
    pillow_heif.register_heif_opener()
    exif = Image.Exif()
    exif.get_ifd(0x8769)[36867] = with_date
    out = io.BytesIO()
    _arrow().save(out, format='HEIF', quality=90, exif=exif.tobytes())
    return out.getvalue()


def test_heic_becomes_a_jpeg_that_keeps_its_date():
    jpeg = heic_to_jpeg(_heic())
    with Image.open(io.BytesIO(jpeg)) as image:
        assert image.format == 'JPEG'
        assert image.size == (200, 300)
        assert _top_is_white(image)
        assert image.getexif().get_ifd(0x8769)[36867] == '2026:02:03 04:05:06'


def test_a_rotated_iphone_jpeg_comes_out_upright():
    # Lying on its side, with EXIF saying to turn it 90 degrees clockwise
    sideways = _arrow().rotate(90, expand=True)
    exif = Image.Exif()
    exif[0x0112] = 6
    data = io.BytesIO()
    sideways.save(data, 'JPEG', exif=exif.tobytes())
    data.seek(0)

    result, _ = ImageOptimizer.optimize(data, max_size=(1920, 1920), format='WebP')
    with Image.open(result) as image:
        assert image.size == (200, 300)
        assert _top_is_white(image)


def test_a_mirrored_front_camera_photo_comes_out_right():
    mirrored = _arrow().transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    exif = Image.Exif()
    exif[0x0112] = 4
    data = io.BytesIO()
    mirrored.save(data, 'JPEG', exif=exif.tobytes())
    data.seek(0)

    result, _ = ImageOptimizer.optimize(data, max_size=(1920, 1920), format='WebP')
    with Image.open(result) as image:
        assert _top_is_white(image)


def test_wide_gamut_colors_keep_their_profile():
    data = io.BytesIO()
    _arrow(3000, 3000).save(data, 'JPEG', icc_profile=b'display-p3-profile')
    data.seek(0)
    result, _ = ImageOptimizer.optimize(data, max_size=(1920, 1920), format='WebP')
    with Image.open(result) as image:
        assert image.info.get('icc_profile') == b'display-p3-profile'


# ── Uploading by hand ─────────────────────────

class FakeStorage:
    provider_name = 'fake'

    def __init__(self):
        self.uploads = []
        self.bodies = {}

    def upload(self, file_data, filename, context, context_id, category=None,
               content_type=None, metadata=None, optimize=True, replace=False):
        self.uploads.append(SimpleNamespace(filename=filename, content_type=content_type, optimize=optimize))
        file_data.seek(0)
        self.bodies[filename] = file_data.read()
        return UploadResult(
            file_id=f'id-{filename}',
            file_path=f'{context}/{context_id}/{filename}',
            file_url=f'fake://{filename}',
            folder_path=f'{context}/{context_id}',
            storage_metadata={'size': len(self.bodies[filename])},
        )


@pytest.fixture
def storage(monkeypatch):
    fake = FakeStorage()
    monkeypatch.setattr(StorageFactory, 'get_instance', classmethod(lambda cls, provider=None: fake))
    return fake


def _upload(service, job_id, name, content_type, body):
    file = UploadFile(file=io.BytesIO(body), filename=name, headers=Headers({'content-type': content_type}))
    return asyncio.run(service.upload_photo(job_id, file))


def test_an_iphone_heic_from_windows_is_stored_as_a_jpeg_dated_when_it_was_taken(db, storage):
    job_id = make_job(db)
    session = db.get_session()
    service = WaterMitigationService(session)

    photo = _upload(service, job_id, 'IMG_0100.HEIC', 'application/octet-stream', _heic())
    session.commit()

    assert photo['file_name'] == 'IMG_0100.jpg'
    assert photo['mime_type'] == 'image/jpeg'
    assert photo['file_type'] == 'photo'
    assert str(photo['captured_date']).startswith('2026-02-03')
    assert storage.uploads[0].content_type == 'image/jpeg'
    assert storage.bodies['IMG_0100.jpg'][:3] == b'\xff\xd8\xff'
    session.close()


def test_a_video_goes_to_storage_as_it_is(db, storage):
    job_id = make_job(db)
    session = db.get_session()
    service = WaterMitigationService(session)

    body = b'\x00\x00\x00\x14ftypqt  ' + b'x' * 500
    photo = _upload(service, job_id, 'IMG_0001.MOV', 'video/quicktime', body)
    session.commit()

    assert (photo['file_type'], photo['mime_type'], photo['file_size']) == ('video', 'video/quicktime', len(body))
    upload = storage.uploads[0]
    # Not read for re-encoding or hashing, and served under a type browsers will try
    assert upload.optimize is False
    assert upload.content_type == 'video/mp4'
    assert storage.bodies['IMG_0001.MOV'] == body
    session.close()


def test_something_that_is_neither_is_refused(db, storage):
    job_id = make_job(db)
    session = db.get_session()
    with pytest.raises(ValueError):
        _upload(WaterMitigationService(session), job_id, 'notes.pdf', 'application/pdf', b'%PDF-1.4')
    assert storage.uploads == []
    session.close()


# ── MagicPlan: all of it ──────────────────────

def _mp_file(index, filetype='image/jpeg', extension='jpg'):
    return {
        'id': f'file-{index}',
        'filename': f'file-{index}.{extension}',
        'filetype': filetype,
        'file': {'url': f'https://s3.example/file-{index}.{extension}?X-Amz-Signature=x', 'size': 100},
        'metadata': {'description': None},
        'user_created': '2026-08-24T20:21:39.000000+00:00',
    }


def test_the_client_reads_every_page_since_magicplan_ignores_per_page():
    pages = {
        1: {'data': [{'id': i} for i in range(10)], 'page_info': {'next_page': 2, 'page_size': 10}},
        2: {'data': [{'id': i} for i in range(10, 20)], 'page_info': {'next_page': 3, 'page_size': 10}},
        3: {'data': [{'id': 20}], 'page_info': {'next_page': None, 'page_size': 10}},
    }
    asked_for = []

    async def fake_request(method, path, params=None, timeout=None):
        asked_for.append(params['page'])
        return pages[params['page']]

    client = MagicPlanClient(api_key='k', customer_id='c')
    client._request = fake_request

    files = asyncio.run(client.get_project_files('project'))
    assert len(files) == 21
    assert asked_for == [1, 2, 3]

    asked_for.clear()
    projects = asyncio.run(client.list_all_projects())
    assert len(projects) == 21


class FakeCache:
    def __init__(self):
        self.values = {}

    async def get(self, key):
        return self.values.get(key)

    async def set(self, key, value, ttl=3600):
        self.values[key] = value
        return True


@pytest.fixture
def magicplan(monkeypatch, tmp_path):
    state = SimpleNamespace(files=[], cache=FakeCache(), queued=[], failing=set(), cancel_after=None, fetched=[])

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get_project_files(self, project_id):
            return list(state.files)

        async def get_project_plan(self, project_id):
            return {'plan_data': {'floors': [{'name': 'First', 'uid': 'f1'}]}}

    def fake_download(url, dest, headers=None):
        name = url.split('/')[-1].split('?')[0]
        if name in state.failing:
            raise video_tools.VideoToolError('Download failed: 500')
        state.fetched.append(name)
        Path(dest).write_bytes(_jpeg_bytes() if name.endswith('.jpg') else b'video-bytes')
        if state.cancel_after and len(state.fetched) == state.cancel_after:
            current = json.loads(state.cache.values[magicplan_sync.sync_status_key(state.job_id)])
            current['status'] = 'cancelled'
            state.cache.values[magicplan_sync.sync_status_key(state.job_id)] = json.dumps(current)
        return 11

    monkeypatch.setattr(magicplan_sync, 'MagicPlanClient', FakeClient)
    monkeypatch.setattr(magicplan_sync, 'get_cache', lambda: state.cache)
    monkeypatch.setattr(magicplan_sync, 'queue_processing', lambda owner, owner_id: state.queued.append((owner, str(owner_id))))
    monkeypatch.setattr(magicplan_sync.video_tools, 'download_to_file', fake_download)
    return state


def _jpeg_bytes() -> bytes:
    out = io.BytesIO()
    Image.new('RGB', (40, 40), (10, 20, 30)).save(out, 'JPEG')
    return out.getvalue()


def _sync(database, job_id, state):
    state.job_id = job_id
    session = database.get_session()
    try:
        return asyncio.run(magicplan_sync.MagicPlanSyncService(session).sync_photos(job_id, 'project', 'Name'))
    finally:
        session.close()


def test_every_photo_and_video_comes_in_and_pdfs_stay_out(db, storage, magicplan):
    job_id = make_job(db)
    magicplan.files = (
        [_mp_file(i) for i in range(23)]
        + [_mp_file(100 + i, 'video/mp4', 'mp4') for i in range(3)]
        + [_mp_file(200, 'application/pdf', 'pdf')]
    )

    result = _sync(db, job_id, magicplan)

    assert result.success
    assert (result.photos_synced, result.videos_synced, result.total_files) == (23, 3, 26)
    stored = rows(db)
    assert len(stored) == 26
    videos = [p for p in stored if p.file_type == 'video']
    assert len(videos) == 3
    assert all(p.mime_type == 'video/mp4' and p.source == 'magicplan' for p in videos)
    # Dated when taken on the device, not when imported
    assert all(p.captured_date.year == 2026 and p.captured_date.month == 8 for p in stored)
    # Each video goes on to get its poster, photos don't
    assert sorted(owner_id for _, owner_id in magicplan.queued) == sorted(str(p.id) for p in videos)
    # A video isn't read for re-encoding or hashing
    assert all(u.optimize is False for u in storage.uploads if u.filename.endswith('.mp4'))


def test_the_page_can_follow_it_and_sees_the_result(db, storage, magicplan):
    job_id = make_job(db)
    magicplan.files = [_mp_file(1), _mp_file(2, 'video/mp4', 'mp4')]

    _sync(db, job_id, magicplan)

    status = json.loads(magicplan.cache.values[magicplan_sync.sync_status_key(job_id)])
    assert status['status'] == 'completed'
    assert status['result']['photos_synced'] == 1
    assert status['result']['videos_synced'] == 1


def test_a_second_sync_brings_nothing_new(db, storage, magicplan):
    job_id = make_job(db)
    magicplan.files = [_mp_file(1), _mp_file(2, 'video/mp4', 'mp4')]
    _sync(db, job_id, magicplan)

    result = _sync(db, job_id, magicplan)

    assert (result.photos_synced, result.videos_synced, result.photos_skipped) == (0, 0, 2)
    assert len(rows(db)) == 2


def test_a_project_already_on_another_job_is_reported_without_errors(db, storage, magicplan):
    first = make_job(db)
    magicplan.files = [_mp_file(1), _mp_file(2)]
    _sync(db, first, magicplan)

    result = _sync(db, make_job(db, '2 Other St'), magicplan)

    assert result.photos_on_other_jobs == 2
    assert result.errors == []


def test_one_bad_file_doesnt_stop_the_rest(db, storage, magicplan):
    job_id = make_job(db)
    magicplan.files = [_mp_file(1), _mp_file(2), _mp_file(3, 'video/mp4', 'mp4')]
    magicplan.failing = {'file-2.jpg'}

    result = _sync(db, job_id, magicplan)

    assert (result.photos_synced, result.videos_synced) == (1, 1)
    assert len(result.errors) == 1
    # The signed URL isn't in what the page shows
    assert 'Signature' not in result.errors[0]


def test_stopping_keeps_what_came_in(db, storage, magicplan):
    job_id = make_job(db)
    magicplan.files = [_mp_file(i) for i in range(5)]
    magicplan.cancel_after = 2

    result = _sync(db, job_id, magicplan)

    assert result.cancelled
    assert len(rows(db)) == 2
    status = json.loads(magicplan.cache.values[magicplan_sync.sync_status_key(job_id)])
    assert status['status'] == 'cancelled'


# ── CompanyCam ────────────────────────────────

CC_VIDEO = {
    'id': '23599704',
    'project_id': '116320650',
    'status': 'processed',
    # format says m3u8 while the URL is the uploaded file: seen on all 338 of ours
    'format': 'm3u8',
    'playback_url': 'https://companycam-video.s3.amazonaws.com/abc.mov?X-Amz-Signature=x',
    'captured_at': 1792257645,
    'thumbnail_urls': {'large': 'https://img/l', 'medium': 'https://img/m', 'small': 'https://img/s'},
}


def test_a_video_can_sit_in_one_list_with_the_photos_without_ids_colliding():
    media = companycam_utils.videos_as_media([CC_VIDEO])
    assert media[0]['id'] == 'companycam_video_23599704'
    summary = companycam_utils.summarize_photo_dates(
        [{'id': 23599704, 'captured_at': 1792257645}] + media, existing_ids={'23599704'},
    )
    assert summary['total_photos'] == 2
    # The photo with the same number is here already; the video isn't
    assert summary['total_new'] == 1


@pytest.mark.parametrize('url,name,content_type', [
    ('https://s3/abc.mov?sig=1', 'companycam_video_1.mov', 'video/quicktime'),
    ('https://s3/abc.mp4?sig=1', 'companycam_video_1.mp4', 'video/mp4'),
    ('https://s3/abc', 'companycam_video_1.mp4', 'video/mp4'),
])
def test_a_video_is_named_for_what_it_really_is(url, name, content_type):
    _, filename, mime, got_url = companycam_utils.video_file_details({'id': 'companycam_video_1', 'playback_url': url})
    assert (filename, mime, got_url) == (name, content_type, url)


def test_a_video_with_no_address_says_so():
    with pytest.raises(ValueError):
        companycam_utils.video_file_details({'id': 'companycam_video_1', 'playback_url': None})


def test_a_project_webhook_doesnt_trash_videos_for_not_being_in_the_photo_list(db):
    job_id = make_job(db)
    session = db.get_session()
    for external_id, name, file_type in (
        ('111', 'a.jpg', 'photo'),
        ('222', 'gone.jpg', 'photo'),
        ('companycam_video_9', 'v.mov', 'video'),
    ):
        session.add(WMPhoto(
            job_id=job_id, source='companycam', external_id=external_id, file_name=name,
            file_path=f'/{name}', file_type=file_type, is_trashed=False,
        ))
    session.commit()

    handler_class = next(
        value for value in vars(webhook_handler_wm).values()
        if isinstance(value, type) and hasattr(value, '_detect_deleted_photos')
    )
    handler = handler_class.__new__(handler_class)
    handler.db = session
    handler.wm_service = SimpleNamespace(get_by_companycam_project=lambda project: {'id': job_id})

    asyncio.run(handler._detect_deleted_photos('project', {'111'}))
    session.commit()
    session.close()

    by_name = {p.file_name: p.is_trashed for p in rows(db)}
    assert by_name == {'a.jpg': False, 'gone.jpg': True, 'v.mov': False}


# ── Making it watchable ───────────────────────

@pytest.fixture
def local_storage(tmp_path, monkeypatch):
    provider = LocalStorageProvider(base_dir=str(tmp_path / 'store'))
    monkeypatch.setattr(StorageFactory, 'get_instance', classmethod(lambda cls, name=None: provider))
    monkeypatch.setattr(video_service.settings, 'STORAGE_BASE_DIR', str(tmp_path / 'store'))
    return provider


def _store_clip(database, provider, path, **photo_fields):
    job_id = make_job(database)
    with open(path, 'rb') as data:
        result, size = video_service.store_video(
            data, path.name, 'video/quicktime', 'water-mitigation', job_id, 'photos', provider
        )
    session = database.get_session()
    photo = WMPhoto(
        job_id=job_id, source='manual_upload', file_name=path.name, file_path=result.file_path,
        file_size=size, mime_type='video/quicktime', file_type='video', storage_provider='local',
        storage_file_id=result.file_id, is_trashed=False, **photo_fields,
    )
    session.add(photo)
    session.commit()
    photo_id = str(photo.id)
    session.close()
    return photo_id


def _rendition(database, owner_id):
    session = database.get_session()
    try:
        return session.query(VideoRendition).filter(VideoRendition.owner_id == owner_id).first()
    finally:
        session.close()


def test_hevc_gets_a_poster_a_copy_and_its_real_date(db, clips, local_storage):
    photo_id = _store_clip(db, local_storage, clips.hevc_portrait, captured_date=datetime.now(timezone.utc))

    video_service.process_video(video_service.OWNER_WM_PHOTO, photo_id)

    row = _rendition(db, photo_id)
    assert row.status == 'ready' and row.error is None
    assert row.codec == 'hevc'
    assert row.duration_seconds == pytest.approx(2, abs=0.5)
    assert row.poster_file_id and row.playback_file_id and row.playback_size > 0
    # A manual upload dates from the moment it was taken, once that's known
    photo = next(p for p in rows(db) if str(p.id) == photo_id)
    assert photo.captured_date.strftime('%Y-%m-%d') == '2026-03-14'


def test_h264_needs_no_copy(db, clips, local_storage):
    photo_id = _store_clip(db, local_storage, clips.h264)

    video_service.process_video(video_service.OWNER_WM_PHOTO, photo_id)

    row = _rendition(db, photo_id)
    assert row.status == 'ready'
    assert row.poster_file_id and not row.playback_file_id


def test_a_provider_thumbnail_means_no_poster_is_made(db, clips, local_storage):
    photo_id = _store_clip(db, local_storage, clips.h264, storage_thumbnail_url='https://img.companycam.com/t')

    video_service.process_video(video_service.OWNER_WM_PHOTO, photo_id)

    assert not _rendition(db, photo_id).poster_file_id


def test_a_file_that_isnt_really_a_video_is_marked_failed_not_stuck(db, local_storage, tmp_path):
    bad = tmp_path / 'bad.mov'
    bad.write_bytes(b'not a video at all')
    photo_id = _store_clip(db, local_storage, bad)

    video_service.process_video(video_service.OWNER_WM_PHOTO, photo_id)

    row = _rendition(db, photo_id)
    assert row.status == 'failed' and row.error


def test_low_memory_puts_a_video_off_without_using_up_its_attempts(db, clips, local_storage, monkeypatch):
    photo_id = _store_clip(db, local_storage, clips.hevc_portrait)
    monkeypatch.setattr(video_tools, 'memory_headroom', lambda: 1024)

    video_service.process_video(video_service.OWNER_WM_PHOTO, photo_id)

    row = _rendition(db, photo_id)
    assert row.status == 'failed' and row.attempts == 0


@pytest.mark.parametrize('status,attempts,age,expected', [
    ('ready', 1, timedelta(days=1), False),
    # Someone is on it
    ('processing', 1, timedelta(minutes=5), False),
    # A restart cut it short
    ('processing', 1, timedelta(hours=2), True),
    ('pending', 0, timedelta(hours=2), True),
    # Not straight away, and not forever
    ('failed', 1, timedelta(minutes=1), False),
    ('failed', 1, timedelta(hours=1), True),
    ('failed', video_service.MAX_ATTEMPTS, timedelta(hours=1), False),
])
def test_what_goes_back_in_the_queue(status, attempts, age, expected):
    rendition = {'status': status, 'attempts': attempts, 'updated_at': datetime.now(timezone.utc) - age}
    assert video_service._needs_processing(rendition) is expected


def test_a_video_never_processed_goes_in_the_queue():
    assert video_service._needs_processing(None) is True


def test_listing_a_gallery_queues_what_is_missing_and_says_how_it_stands(db, monkeypatch):
    queued = []
    monkeypatch.setattr(video_service, 'queue_processing', lambda owner, owner_id: queued.append(owner_id))
    session = db.get_session()
    session.add(VideoRendition(owner_type='file', owner_id='done', status='ready', duration_seconds=12.5, attempts=1))
    session.commit()
    session.close()

    fields = video_service.video_fields('file', ['done', 'new'])

    assert fields['done'] == {'video_status': 'ready', 'duration_seconds': 12.5}
    assert fields['new']['video_status'] == 'pending'
    assert queued == ['new']


def test_a_gallery_still_works_when_the_table_isnt_there_yet(tmp_path, monkeypatch):
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'no_table.db'}")
    monkeypatch.setattr(video_service, 'get_database', lambda: database)
    assert video_service.video_fields('file', ['x']) == {}


# ── Serving ───────────────────────────────────

@pytest.mark.parametrize('header,expected', [
    (None, None),
    ('bytes=0-1', (0, 1)),
    ('bytes=100-', (100, 999)),
    ('bytes=-50', (950, 999)),
    ('bytes=0-5000', (0, 999)),
    # Not something this answers: the whole file is a valid reply
    ('bytes=0-1,5-6', None),
    ('items=0-1', None),
])
def test_ranges(header, expected):
    assert video_service.parse_range(header, 1000) == expected


def test_a_range_past_the_end_is_refused():
    with pytest.raises(HTTPException) as caught:
        video_service.parse_range('bytes=2000-', 1000)
    assert caught.value.status_code == 416
    assert caught.value.headers['Content-Range'] == 'bytes */1000'


def test_a_video_plays_through_the_route_with_ranges(db, clips, local_storage, monkeypatch):
    monkeypatch.setattr(video_service, 'queue_processing', lambda *a: None)
    photo_id = _store_clip(db, local_storage, clips.h264)
    body = clips.h264.read_bytes()
    client = TestClient(app)
    url = f'/api/water-mitigation/photos/{photo_id}/video'

    start = client.get(url, headers={'Range': 'bytes=0-1'})
    assert start.status_code == 206
    assert start.headers['content-range'] == f'bytes 0-1/{len(body)}'
    assert start.headers['content-type'] == 'video/mp4'
    assert start.content == body[:2]

    tail = client.get(url, headers={'Range': f'bytes={len(body) - 10}-'})
    assert tail.status_code == 206 and tail.content == body[-10:]

    whole = client.get(url)
    assert whole.status_code == 200 and whole.content == body
    assert whole.headers['accept-ranges'] == 'bytes'

    assert client.get(url, headers={'Range': f'bytes={len(body) + 1}-'}).status_code == 416


def test_once_there_is_a_copy_the_copy_is_what_plays(db, clips, local_storage):
    photo_id = _store_clip(db, local_storage, clips.hevc_portrait)
    video_service.process_video(video_service.OWNER_WM_PHOTO, photo_id)
    client = TestClient(app)

    played = client.get(f'/api/water-mitigation/photos/{photo_id}/video')
    assert played.status_code == 200
    assert played.content != clips.hevc_portrait.read_bytes()
    assert played.content[4:8] == b'ftyp'

    downloaded = client.get(f'/api/water-mitigation/photos/{photo_id}/download')
    assert downloaded.content == clips.hevc_portrait.read_bytes()
    assert 'attachment' in downloaded.headers['content-disposition']


def test_a_poster_stands_in_until_there_is_one(db, clips, local_storage, monkeypatch):
    monkeypatch.setattr(video_service, 'queue_processing', lambda *a: None)
    photo_id = _store_clip(db, local_storage, clips.h264)
    client = TestClient(app)
    url = f'/api/water-mitigation/photos/{photo_id}/preview'

    waiting = client.get(url, params={'size': 'thumbnail'})
    assert waiting.headers['content-type'] == 'image/svg+xml'
    # Or a browser would keep showing it after the poster's made
    assert waiting.headers['cache-control'] == 'no-store'

    video_service.process_video(video_service.OWNER_WM_PHOTO, photo_id)

    ready = client.get(url, params={'size': 'thumbnail'})
    assert ready.headers['content-type'] == 'image/jpeg'
    with Image.open(io.BytesIO(ready.content)) as image:
        assert image.format == 'JPEG'


def test_a_companycam_thumbnail_is_used_as_it_is(db, clips, local_storage, monkeypatch):
    monkeypatch.setattr(video_service, 'queue_processing', lambda *a: None)
    photo_id = _store_clip(db, local_storage, clips.h264, storage_thumbnail_url='https://img.companycam.com/t')
    response = TestClient(app).get(
        f'/api/water-mitigation/photos/{photo_id}/preview', params={'size': 'web'}, follow_redirects=False
    )
    assert response.status_code == 302
    assert response.headers['location'] == 'https://img.companycam.com/t'


def test_a_browser_is_sent_straight_to_storage_where_it_can_be(db, clips, local_storage, monkeypatch):
    monkeypatch.setattr(video_service, 'queue_processing', lambda *a: None)
    monkeypatch.setattr(local_storage, 'signed_media_url', lambda file_id, expires_in=0: 'https://bucket/signed')
    photo_id = _store_clip(db, local_storage, clips.h264)
    response = TestClient(app).get(f'/api/water-mitigation/photos/{photo_id}/video', follow_redirects=False)
    assert response.status_code == 302
    assert response.headers['location'] == 'https://bucket/signed'
    assert response.headers['cache-control'] == 'no-store'


def test_a_photo_isnt_served_by_the_video_route(db, local_storage):
    job_id = make_job(db)
    session = db.get_session()
    photo = WMPhoto(job_id=job_id, source='manual_upload', file_name='a.jpg', file_path='/a', mime_type='image/jpeg', file_type='photo')
    session.add(photo)
    session.commit()
    photo_id = str(photo.id)
    session.close()
    assert TestClient(app).get(f'/api/water-mitigation/photos/{photo_id}/video').status_code == 404


def test_deleting_a_video_takes_what_was_made_from_it(db, clips, local_storage):
    photo_id = _store_clip(db, local_storage, clips.hevc_portrait)
    video_service.process_video(video_service.OWNER_WM_PHOTO, photo_id)
    row = _rendition(db, photo_id)
    poster, copy = row.poster_file_id, row.playback_file_id
    assert local_storage.exists(poster) and local_storage.exists(copy)

    session = db.get_session()
    video_service.delete_renditions(session, video_service.OWNER_WM_PHOTO, [photo_id])
    session.commit()
    session.close()

    assert _rendition(db, photo_id) is None
    assert not local_storage.exists(poster) and not local_storage.exists(copy)


def test_when_trash_expires_what_was_made_from_a_video_goes_too(db, clips, local_storage):
    photo_id = _store_clip(db, local_storage, clips.hevc_portrait)
    video_service.process_video(video_service.OWNER_WM_PHOTO, photo_id)
    row = _rendition(db, photo_id)
    poster, copy = row.poster_file_id, row.playback_file_id

    session = db.get_session()
    photo = session.query(WMPhoto).filter(WMPhoto.id == photo_id).first()
    photo.is_trashed = True
    photo.trashed_at = datetime.now(timezone.utc) - timedelta(days=60)
    session.commit()

    result = WaterMitigationService(session).cleanup_expired_trash(retention_days=30)
    session.commit()
    session.close()

    assert result['deleted_count'] == 1
    assert _rendition(db, photo_id) is None
    assert not local_storage.exists(poster) and not local_storage.exists(copy)


def test_the_other_storage_providers_read_ranges_without_the_whole_file():
    from app.domains.storage.b2_provider import B2Provider
    from app.domains.storage.gcs_provider import GCSProvider

    assert B2Provider.supports_range and GCSProvider.supports_range and LocalStorageProvider.supports_range

    b2 = B2Provider.__new__(B2Provider)
    b2.bucket_name = 'bucket'
    b2.make_public = False
    asked = {}

    class Client:
        def get_object(self, **kwargs):
            asked.update(kwargs)
            return {'Body': io.BytesIO(b'ab')}

        def generate_presigned_url(self, operation, Params, ExpiresIn):
            return f"https://b2/{Params['Key']}?expires={ExpiresIn}"

    b2.client = Client()
    assert b2.read_range('b2://bucket/water-mitigation/job/a.mov', 5, 6) == b'ab'
    assert asked['Key'] == 'water-mitigation/job/a.mov'
    assert asked['Range'] == 'bytes=5-6'
    assert b2.signed_media_url('b2://bucket/water-mitigation/job/a.mov').startswith('https://b2/water-mitigation/job/a.mov')


def test_a_missing_ffmpeg_fails_the_video_not_the_upload(db, clips, local_storage, monkeypatch):
    monkeypatch.setattr(video_tools, 'ffmpeg_path', lambda: None)
    photo_id = _store_clip(db, local_storage, clips.h264)

    video_service.process_video(video_service.OWNER_WM_PHOTO, photo_id)

    row = _rendition(db, photo_id)
    assert row.status == 'failed'
    assert 'ffmpeg' in row.error

