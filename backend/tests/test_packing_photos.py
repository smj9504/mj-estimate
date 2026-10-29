"""A claim's packing photos: claim photos picked for its packing estimate and
filed by room, then handed to the estimate builder as JPEGs for the AI.
Runs the API on a throwaway SQLite database."""

import base64
import io
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
import sys

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.dialects.postgresql import ARRAY, INET, JSONB, UUID as PG_UUID
from sqlalchemy.dialects.sqlite import base as sqlite_base
from sqlalchemy.ext.compiler import compiles

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory  # noqa: E402
from app.core.database_factory import Base, SQLiteDatabase  # noqa: E402
from app.domains.auth.dependencies import get_current_staff  # noqa: E402
from app.domains.client.models import Claim, Client  # noqa: E402
from app.domains.file.models import File  # noqa: E402
from app.domains.staff.models import StaffRole  # noqa: E402
from app.domains.water_mitigation.models import WaterMitigationJob, WMPhoto  # noqa: E402
from app.main import app  # noqa: E402

ADMIN_ID = '00000000-0000-0000-0000-0000000000ad'


@compiles(JSONB, 'sqlite')
def _jsonb(type_, compiler, **kw):
    return 'JSON'


@compiles(ARRAY, 'sqlite')
def _array(type_, compiler, **kw):
    return 'JSON'


@compiles(INET, 'sqlite')
def _inet(type_, compiler, **kw):
    return 'VARCHAR(45)'


@compiles(PG_UUID, 'sqlite')
def _uuid(type_, compiler, **kw):
    return 'VARCHAR(36)'


@pytest.fixture
def env(tmp_path, monkeypatch):
    real = sqlite_base.DATETIME.bind_processor

    def bind_processor(self, dialect):
        process = real(self, dialect)

        def parse_then_process(value):
            if isinstance(value, str):
                value = datetime.fromisoformat(value.replace('Z', '+00:00'))
            return process(value)
        return parse_then_process
    monkeypatch.setattr(sqlite_base.DATETIME, 'bind_processor', bind_processor)

    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    sa.event.listen(
        database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF')
    )
    for table in Base.metadata.sorted_tables:
        try:
            table.create(database.engine, checkfirst=True)
        except Exception:
            pass
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)

    staff = {'role': StaffRole.admin}
    app.dependency_overrides[get_current_staff] = lambda: SimpleNamespace(
        id=ADMIN_ID, role=staff['role'], username='admin')

    def get_db():
        session = database.get_session()
        try:
            yield session
            session.commit()
        finally:
            session.close()
    app.dependency_overrides[database_factory.get_db_session] = get_db

    yield TestClient(app, raise_server_exceptions=True), database, tmp_path, staff
    app.dependency_overrides.pop(get_current_staff, None)
    app.dependency_overrides.pop(database_factory.get_db_session, None)


def _jpeg(path: Path, size=(3000, 2000)) -> str:
    Image.new('RGB', size, (200, 120, 40)).save(path, format='JPEG')
    return str(path)


def _seed(database, tmp_path):
    """A claim with a WM job (two photos and a trashed one), a claim photo and a
    claim PDF; and another claim with a WM photo of its own."""
    s = database.get_session()
    client = Client(display_name='Pat Client', owners=[])
    s.add(client)
    s.flush()
    claim = Claim(client_id=client.id, claim_number='C-1', status='open')
    other = Claim(client_id=client.id, claim_number='C-2', status='open')
    s.add(claim)
    s.add(other)
    s.flush()
    job = WaterMitigationJob(property_address='12 Oak St', status='Lead', claim_id=claim.id)
    other_job = WaterMitigationJob(property_address='12 Oak St', status='Lead', claim_id=other.id)
    s.add(job)
    s.add(other_job)
    s.flush()

    def photo(job_id, name, **extra):
        p = WMPhoto(job_id=job_id, source='manual_upload', file_name=name,
                    file_path=_jpeg(tmp_path / name), file_type='photo', **extra)
        s.add(p)
        return p

    kitchen = photo(job.id, 'kitchen.jpg', location_level='1st Floor', location_room='Kitchen')
    living = photo(job.id, 'living.jpg', location_level='1st Floor', location_room='Living Room')
    trashed = photo(job.id, 'trashed.jpg', is_trashed=True)
    elsewhere = photo(other_job.id, 'elsewhere.jpg')
    claim_photo = File(filename='den.jpg', original_name='den.jpg', content_type='image/jpeg',
                       size=1, url=_jpeg(tmp_path / 'den.jpg', (800, 600)), storage_provider='local',
                       context='claim', context_id=str(claim.id), category='general')
    claim_pdf = File(filename='policy.pdf', original_name='policy.pdf', content_type='application/pdf',
                     size=1, url=str(tmp_path / 'policy.pdf'), storage_provider='local',
                     context='claim', context_id=str(claim.id), category='general')
    s.add(claim_photo)
    s.add(claim_pdf)
    s.commit()
    ids = SimpleNamespace(
        claim=str(claim.id), kitchen=str(kitchen.id), living=str(living.id),
        trashed=str(trashed.id), elsewhere=str(elsewhere.id),
        claim_photo=str(claim_photo.id), claim_pdf=str(claim_pdf.id),
    )
    s.close()
    return ids


def _rooms(photos):
    rooms = {}
    for p in photos:
        rooms.setdefault(p['room_name'], []).append(p['file_name'])
    return list(rooms.items())


def test_photos_are_filed_by_room_and_keep_their_tags(env):
    api, database, tmp_path, _ = env
    ids = _seed(database, tmp_path)
    url = f"/api/packing-estimate/claims/{ids.claim}/photos"

    assert api.get(url).json() == {'photos': []}

    resp = api.post(url, json={
        'room_name': 'Den',
        'photos': [
            {'source': 'wm', 'photo_id': ids.kitchen, 'room_name': 'Kitchen'},
            {'source': 'wm', 'photo_id': ids.living, 'room_name': 'Living Room'},
            {'source': 'claim', 'photo_id': ids.claim_photo},
        ],
    })
    assert resp.status_code == 200
    photos = resp.json()['photos']
    assert _rooms(photos) == [
        ('Kitchen', ['kitchen.jpg']), ('Living Room', ['living.jpg']), ('Den', ['den.jpg']),
    ]
    kitchen = photos[0]
    assert kitchen['location_level'] == '1st Floor'
    assert kitchen['thumbnail_url'] == f"/api/water-mitigation/photos/{ids.kitchen}/preview?size=thumbnail"
    assert photos[2]['thumbnail_url'] == f"/api/files/preview/{ids.claim_photo}"

    # A different spelling joins the room already there; a filed photo moves
    resp = api.post(url, json={'room_name': 'kitchen', 'photos': [{'source': 'claim', 'photo_id': ids.claim_photo}]})
    assert _rooms(resp.json()['photos']) == [
        ('Kitchen', ['kitchen.jpg', 'den.jpg']), ('Living Room', ['living.jpg']),
    ]


def test_only_the_claims_own_live_photos_can_be_filed(env):
    api, database, tmp_path, _ = env
    ids = _seed(database, tmp_path)
    url = f"/api/packing-estimate/claims/{ids.claim}/photos"

    for ref in (
        {'source': 'wm', 'photo_id': ids.elsewhere},     # another claim's job
        {'source': 'wm', 'photo_id': ids.trashed},       # in the job's trash
        {'source': 'claim', 'photo_id': ids.claim_pdf},  # not a photo
        {'source': 'claim', 'photo_id': ids.kitchen},    # wrong source
    ):
        resp = api.post(url, json={'room_name': 'Den', 'photos': [ref]})
        assert resp.status_code == 400, ref
    # Every photo needs a room
    resp = api.post(url, json={'photos': [{'source': 'wm', 'photo_id': ids.kitchen}]})
    assert resp.status_code == 400
    assert api.get(url).json() == {'photos': []}

    assert api.get('/api/packing-estimate/claims/not-a-claim/photos').status_code == 404


def test_rename_keeps_the_room_in_place_and_remove_leaves_the_photo(env):
    api, database, tmp_path, _ = env
    ids = _seed(database, tmp_path)
    url = f"/api/packing-estimate/claims/{ids.claim}/photos"
    photos = api.post(url, json={'photos': [
        {'source': 'wm', 'photo_id': ids.kitchen, 'room_name': 'Kitchen'},
        {'source': 'wm', 'photo_id': ids.living, 'room_name': 'Living Room'},
    ]}).json()['photos']
    kitchen_entry, living_entry = photos[0]['id'], photos[1]['id']

    resp = api.patch(url, json={'ids': [kitchen_entry], 'room_name': 'Main Kitchen'})
    assert _rooms(resp.json()['photos']) == [('Main Kitchen', ['kitchen.jpg']), ('Living Room', ['living.jpg'])]

    # Moving into a room that exists merges into it
    resp = api.patch(url, json={'ids': [living_entry], 'room_name': 'main kitchen'})
    assert _rooms(resp.json()['photos']) == [('Main Kitchen', ['kitchen.jpg', 'living.jpg'])]

    resp = api.post(f"{url}/remove", json={'ids': [living_entry]})
    assert _rooms(resp.json()['photos']) == [('Main Kitchen', ['kitchen.jpg'])]
    s = database.get_session()
    assert s.query(WMPhoto).filter(WMPhoto.id == ids.living).count() == 1

    # Trashed in the job, it drops out of the packing set too
    s.query(WMPhoto).filter(WMPhoto.id == ids.kitchen).update({'is_trashed': True})
    s.commit()
    s.close()
    assert api.get(url).json() == {'photos': []}


def test_the_builder_gets_each_photo_as_a_jpeg_sized_for_the_ai(env):
    api, database, tmp_path, _ = env
    ids = _seed(database, tmp_path)
    url = f"/api/packing-estimate/claims/{ids.claim}/photos"
    photos = api.post(url, json={'room_name': 'Den', 'photos': [
        {'source': 'wm', 'photo_id': ids.kitchen},
        {'source': 'claim', 'photo_id': ids.claim_photo},
    ]}).json()['photos']

    sizes = []
    for p in photos:
        resp = api.get(f"{url}/{p['id']}/image")
        assert resp.status_code == 200
        img = Image.open(io.BytesIO(base64.b64decode(resp.json()['image'])))
        assert img.format == 'JPEG'
        sizes.append(img.size)
    # The 3000px WM photo comes down to 1600; the small claim photo stays as it is
    assert sizes == [(1600, 1067), (800, 600)]

    assert api.get(f"{url}/00000000-0000-0000-0000-000000000000/image").status_code == 404


def test_staff_outside_the_claims_companies_see_nothing(env):
    api, database, tmp_path, staff = env
    ids = _seed(database, tmp_path)
    staff['role'] = StaffRole.staff
    url = f"/api/packing-estimate/claims/{ids.claim}/photos"
    assert api.get(url).status_code == 404
    assert api.post(url, json={'room_name': 'Den', 'photos': [
        {'source': 'wm', 'photo_id': ids.kitchen}]}).status_code == 404
