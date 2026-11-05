"""A saved packing estimate's PDFs: the estimate itself, and the report sent
to an adjuster with its contents list, its room photos (the claim's packing
photos of the estimate's rooms), or both.
Runs the API on a throwaway SQLite database."""

import io
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
import sys

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from PIL import Image
from pypdf import PdfReader
from sqlalchemy.dialects.postgresql import ARRAY, INET, JSONB, UUID as PG_UUID
from sqlalchemy.dialects.sqlite import base as sqlite_base
from sqlalchemy.ext.compiler import compiles

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory  # noqa: E402
from app.core.database_factory import Base, SQLiteDatabase  # noqa: E402
from app.domains.auth.dependencies import get_current_staff  # noqa: E402
from app.domains.client.models import Claim, Client  # noqa: E402
from app.domains.company.models import Company  # noqa: E402
from app.domains.file.models import File  # noqa: E402
from app.domains.staff.models import StaffRole  # noqa: E402
from app.domains.water_mitigation.models import WaterMitigationJob, WMPhoto  # noqa: E402
from app.main import app  # noqa: E402

ADMIN_ID = '00000000-0000-0000-0000-0000000000ad'
BASE = '/api/packing-estimate'


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

    app.dependency_overrides[get_current_staff] = lambda: SimpleNamespace(
        id=ADMIN_ID, role=StaffRole.admin, username='admin')

    def get_db():
        session = database.get_session()
        try:
            yield session
            session.commit()
        finally:
            session.close()
    app.dependency_overrides[database_factory.get_db_session] = get_db

    yield TestClient(app, raise_server_exceptions=True), database, tmp_path
    app.dependency_overrides.pop(get_current_staff, None)
    app.dependency_overrides.pop(database_factory.get_db_session, None)


def _jpeg(path: Path, color=(200, 120, 40), size=(1600, 1200)) -> str:
    Image.new('RGB', size, color).save(path, format='JPEG')
    return str(path)


def _seed(database, tmp_path):
    """A moving company, and a client's claim with a WM job whose photos are
    filed for packing: two of the kitchen and one of the den"""
    s = database.get_session()
    company = Company(name='Pack & Move Co', address='9 Depot Rd', city='Fairfax',
                      state='VA', zipcode='22030', phone='555-0100', email='office@pack.test')
    client = Client(display_name='Pat & Sam Client', owners=[], phone='555-0199')
    s.add(company)
    s.add(client)
    s.flush()
    claim = Claim(client_id=client.id, claim_number='C-77', status='open')
    s.add(claim)
    s.flush()
    job = WaterMitigationJob(property_address='12 Oak St', status='Lead', claim_id=claim.id)
    s.add(job)
    s.flush()

    def photo(name, color):
        p = WMPhoto(job_id=job.id, source='manual_upload', file_name=name,
                    file_path=_jpeg(tmp_path / name, color), file_type='photo')
        s.add(p)
        s.flush()
        return str(p.id)

    kitchen_1 = photo('kitchen1.jpg', (200, 40, 40))
    kitchen_2 = photo('kitchen2.jpg', (40, 200, 40))
    den = photo('den.jpg', (40, 40, 200))
    s.commit()
    ids = SimpleNamespace(company=str(company.id), client=str(client.id), claim=str(claim.id))
    s.close()
    return ids, (kitchen_1, kitchen_2, den)


def _file_photos(api, ids, photos):
    kitchen_1, kitchen_2, den = photos
    url = f"{BASE}/claims/{ids.claim}/photos"
    assert api.post(url, json={'photos': [
        {'source': 'wm', 'photo_id': kitchen_1, 'room_name': 'Kitchen'},
        {'source': 'wm', 'photo_id': kitchen_2, 'room_name': 'Kitchen'},
        {'source': 'wm', 'photo_id': den, 'room_name': 'Den'},
    ]}).status_code == 200


def _item(name, category='Furniture', **extra):
    return {'name': name, 'category': category, 'quantity': 1, 'size': 'medium', 'weight': 'medium', **extra}


def _photo_estimate(api, ids, name='Pack-out', rooms=None):
    rooms = rooms or [
        {'room_name': 'Kitchen', 'items': [
            _item('Dining table & 4 chairs'),
            _item('Wine glasses <crystal>', 'Kitchenware', quantity=12, is_fragile=True),
        ]},
        {'room_name': 'Den', 'items': [
            _item('Sofa'), _item('55" TV', 'Electronics', is_high_value=True),
        ]},
    ]
    resp = api.post(f"{BASE}/content-estimate", json={
        'client_id': ids.client, 'company_id': ids.company, 'claim_id': ids.claim,
        'calculation_name': name, 'project_address': '12 Oak St\nFairfax, VA 22030',
        'rooms': rooms,
    })
    assert resp.status_code == 200, resp.text
    return resp.json()['id']


def _pdf(resp) -> PdfReader:
    assert resp.status_code == 200, resp.text
    assert resp.headers['content-type'] == 'application/pdf'
    return PdfReader(io.BytesIO(resp.content))


def _text(reader: PdfReader) -> str:
    return ' '.join(' '.join((page.extract_text() or '').split()) for page in reader.pages)


def _image_count(reader: PdfReader) -> int:
    return sum(len(page.images) for page in reader.pages)


# ── Estimate PDF ──────────────────────────────

def test_an_estimate_with_a_company_exports_as_a_pdf(env):
    api, database, tmp_path = env
    ids, _ = _seed(database, tmp_path)
    calc_id = _photo_estimate(api, ids)

    text = _text(_pdf(api.get(f"{BASE}/{calc_id}/export/pdf")))
    assert 'Pack & Move Co' in text
    assert '9 Depot Rd' in text and 'Fairfax, VA 22030' in text
    assert 'Pat & Sam Client' in text
    estimate = api.get(f"{BASE}/{calc_id}").json()
    assert f"Total Estimate: ${estimate['grand_total']:,.2f}" in text


def test_supplement_attachments_use_the_same_pdf(env):
    """A supplement packet attaches the estimate as the estimate page downloads it"""
    from app.domains.pack_calculation.export import saved_estimate_pdf
    from app.domains.pack_calculation.models import PackCalculation

    api, database, tmp_path = env
    ids, _ = _seed(database, tmp_path)
    calc_id = _photo_estimate(api, ids)
    s = database.get_session()
    calc = s.query(PackCalculation).filter(PackCalculation.id == calc_id).first()
    text = _text(PdfReader(io.BytesIO(saved_estimate_pdf(calc))))
    s.close()
    assert 'Pack & Move Co' in text and 'Pat & Sam Client' in text and '555-0199' in text


def test_the_pdf_lists_the_rooms_packed_by_floor(env):
    api, database, tmp_path = env
    ids, _ = _seed(database, tmp_path)
    calc_id = _photo_estimate(api, ids, rooms=[
        {'room_name': 'Master Bedroom', 'floor': '2nd', 'items': [_item('Dresser')]},
        {'room_name': 'Kitchen', 'floor': '1st', 'items': [_item('Dining table')]},
        {'room_name': 'Rec Room', 'floor': 'basement', 'items': [_item('Sofa')]},
        {'room_name': 'Den', 'floor': '1st', 'items': [_item('Desk')]},
    ])

    text = _text(_pdf(api.get(f"{BASE}/{calc_id}/export/pdf")))
    assert 'Pack-Out / Pack-In Locations' in text
    basement = text.index('Basement: Rec Room')
    first = text.index('1st Floor: Kitchen, Den')
    second = text.index('2nd Floor: Master Bedroom')
    # Under the description, basement up, before the line items
    assert text.index('upon restoration completion') < basement < first < second < text.index('Pack-Out Labor')


def test_an_estimate_saved_before_summaries_kept_the_floor_still_lists_it(env):
    """Photo AI rooms kept their floor all along; older summaries don't have it"""
    from app.domains.pack_calculation.export import estimate_locations
    from app.domains.pack_calculation.models import PackCalculation

    api, database, tmp_path = env
    ids, _ = _seed(database, tmp_path)
    calc_id = _photo_estimate(api, ids, rooms=[
        {'room_name': 'Kitchen', 'floor': '1st', 'items': [_item('Dining table')]},
        {'room_name': 'Rec Room', 'floor': 'basement', 'items': [_item('Sofa')]},
    ])
    s = database.get_session()
    calc = s.query(PackCalculation).filter(PackCalculation.id == calc_id).first()
    calc.room_summaries = [{k: v for k, v in r.items() if k != 'floor'} for r in calc.room_summaries]
    s.commit()
    calc = s.query(PackCalculation).filter(PackCalculation.id == calc_id).first()
    assert estimate_locations(calc) == [('1st', 'Kitchen'), ('basement', 'Rec Room')]
    s.close()


def test_a_quick_estimate_lists_its_rooms_and_says_pack_out_only_without_pack_back(env):
    api, database, tmp_path = env
    ids, _ = _seed(database, tmp_path)
    resp = api.post(f"{BASE}/quick-estimate", json={
        'company_id': ids.company, 'include_packback': False,
        'rooms': [
            {'preset': 'bedroom_standard', 'floor': '2nd'},
            {'preset': 'bedroom_standard', 'floor': '2nd'},
            {'preset': 'living_standard', 'floor': '1st'},
        ],
    })
    assert resp.status_code == 200, resp.text
    names = {s['floor']: s['room_name'] for s in resp.json()['room_summaries']}

    text = _text(_pdf(api.get(f"{BASE}/{resp.json()['id']}/export/pdf")))
    assert 'Pack-Out Locations' in text and 'Pack-Out / Pack-In Locations' not in text
    assert f"1st Floor: {names['1st']}" in text
    assert f"2nd Floor: {names['2nd']} x2" in text


def test_rooms_without_a_floor_are_listed_as_rooms():
    from app.domains.pack_calculation.export import _locations_by_floor

    assert _locations_by_floor([(None, 'Bedroom'), (None, 'Kitchen')]) == [('Rooms', 'Bedroom, Kitchen')]
    assert _locations_by_floor([('1st', 'Kitchen'), (None, 'Shed')]) == [
        ('1st Floor', 'Kitchen'), ('Other', 'Shed')]


# ── Report ────────────────────────────────────

def test_the_report_offers_each_rooms_items_and_photos(env):
    api, database, tmp_path = env
    ids, photos = _seed(database, tmp_path)
    _file_photos(api, ids, photos)
    calc_id = _photo_estimate(api, ids)

    options = api.get(f"{BASE}/{calc_id}/report").json()
    assert options == {
        'has_claim': True,
        'rooms': [
            {'room_name': 'Kitchen', 'item_count': 13, 'photo_count': 2},
            {'room_name': 'Den', 'item_count': 2, 'photo_count': 1},
        ],
        'item_count': 15,
        'photo_count': 3,
    }


def test_a_report_shows_the_contents_list_the_photos_or_both(env):
    api, database, tmp_path = env
    ids, photos = _seed(database, tmp_path)
    _file_photos(api, ids, photos)
    calc_id = _photo_estimate(api, ids)
    url = f"{BASE}/{calc_id}/export/report"
    items = ['Dining table & 4 chairs', 'Wine glasses <crystal>', 'Sofa', '55" TV']

    both = _pdf(api.post(url, json={'contents_list': True, 'photos': True}))
    text = _text(both)
    assert 'Contents Report' in text
    assert all(item in text for item in items)
    assert 'Fragile' in text and 'High value' in text
    assert 'Photo 1' in text and 'Photo 3' in text and 'Photo 4' not in text
    assert 'Claim # C-77' in text and 'Pack & Move Co' in text and 'Pat & Sam Client' in text
    assert '2 rooms · 15 items · 3 photos' in text
    assert _image_count(both) == 3

    contents = _pdf(api.post(url, json={'contents_list': True, 'photos': False}))
    text = _text(contents)
    assert 'Contents List' in text
    assert all(item in text for item in items)
    assert 'Photo 1' not in text
    assert _image_count(contents) == 0

    photo_only = _pdf(api.post(url, json={'contents_list': False, 'photos': True}))
    text = _text(photo_only)
    assert 'Photo Report' in text
    assert not any(item in text for item in items)
    assert 'Kitchen' in text and 'Den' in text
    assert _image_count(photo_only) == 3
    assert 'Estimate total' not in text

    resp = api.post(url, json={'contents_list': False, 'photos': False})
    assert resp.status_code == 400


def test_a_report_can_show_the_estimate_total(env):
    api, database, tmp_path = env
    ids, photos = _seed(database, tmp_path)
    calc_id = _photo_estimate(api, ids)
    total = api.get(f"{BASE}/{calc_id}").json()['grand_total']

    text = _text(_pdf(api.post(f"{BASE}/{calc_id}/export/report", json={
        'contents_list': True, 'photos': False, 'estimate_total': True,
    })))
    assert f"Estimate total: ${total:,.2f}" in text


def test_a_room_gets_the_photos_of_the_claims_room_of_its_name(env):
    api, database, tmp_path = env
    ids, photos = _seed(database, tmp_path)
    _file_photos(api, ids, photos)

    # Loaded into a builder that had a Kitchen, the claim's comes in as "Kitchen (2)"
    repeat = _photo_estimate(api, ids, rooms=[{'room_name': 'kitchen (2)', 'items': [_item('Chair')]}])
    assert api.get(f"{BASE}/{repeat}/report").json()['rooms'] == [
        {'room_name': 'kitchen (2)', 'item_count': 1, 'photo_count': 2},
    ]

    # The claim has one Kitchen: only the first room of the name gets it
    both = _photo_estimate(api, ids, rooms=[
        {'room_name': 'Kitchen', 'items': [_item('Table')]},
        {'room_name': 'Kitchen (2)', 'items': [_item('Chair')]},
        {'room_name': 'Garage', 'items': [_item('Bike')]},
    ])
    rooms = api.get(f"{BASE}/{both}/report").json()['rooms']
    assert [r['photo_count'] for r in rooms] == [2, 0, 0]

    # A room without photos still lists its items, and isn't in a photo report
    text = _text(_pdf(api.post(f"{BASE}/{both}/export/report", json={'contents_list': False, 'photos': True})))
    assert 'Garage' not in text
    assert 'Bike' in _text(_pdf(api.post(f"{BASE}/{both}/export/report", json={'photos': False})))


def test_trashed_photos_are_left_out_of_the_report(env):
    api, database, tmp_path = env
    ids, photos = _seed(database, tmp_path)
    _file_photos(api, ids, photos)
    calc_id = _photo_estimate(api, ids)

    s = database.get_session()
    s.query(WMPhoto).filter(WMPhoto.id == photos[0]).first().is_trashed = True
    s.commit()
    s.close()

    assert api.get(f"{BASE}/{calc_id}/report").json()['photo_count'] == 2
    report = _pdf(api.post(f"{BASE}/{calc_id}/export/report", json={'contents_list': False}))
    assert _image_count(report) == 2


def test_an_estimate_without_a_claim_has_only_its_contents_list(env):
    api, database, tmp_path = env
    ids, _ = _seed(database, tmp_path)
    resp = api.post(f"{BASE}/content-estimate", json={
        'project_address': '5 Elm St',
        'rooms': [{'room_name': 'Office', 'items': [_item('Desk')]}],
    })
    calc_id = resp.json()['id']

    options = api.get(f"{BASE}/{calc_id}/report").json()
    assert options['has_claim'] is False and options['photo_count'] == 0

    resp = api.post(f"{BASE}/{calc_id}/export/report", json={'contents_list': False, 'photos': True})
    assert resp.status_code == 400
    assert 'claim' in resp.json()['detail']

    text = _text(_pdf(api.post(f"{BASE}/{calc_id}/export/report", json={'photos': False})))
    assert 'Desk' in text and '5 Elm St' in text
    # No company on it: the estimate PDF still exports
    assert _pdf(api.get(f"{BASE}/{calc_id}/export/pdf"))


def test_a_quick_estimates_contents_list_shows_its_notable_items(env):
    api, database, tmp_path = env
    ids, _ = _seed(database, tmp_path)
    resp = api.post(f"{BASE}/quick-estimate", json={
        'company_id': ids.company,
        'rooms': [{'preset': 'bedroom_standard', 'hints': ['furniture', 'books']}],
    })
    assert resp.status_code == 200, resp.text
    calc_id = resp.json()['id']
    summary = resp.json()['room_summaries'][0]

    text = _text(_pdf(api.post(f"{BASE}/{calc_id}/export/report", json={'photos': False})))
    assert summary['room_name'] in text
    if summary['notable_items']:
        assert summary['notable_items'][0] in text
    assert _pdf(api.get(f"{BASE}/{calc_id}/export/pdf"))


def _saved_photo(database, tmp_path, name, color=(10, 120, 200)):
    s = database.get_session()
    record = File(filename=name, original_name=name, content_type='image/jpeg', size=1,
                  url=_jpeg(tmp_path / name, color), storage_provider='local',
                  context='packing-estimate', context_id='unassigned', category='general')
    s.add(record)
    s.commit()
    file_id = str(record.id)
    s.close()
    return file_id


def test_a_report_shows_the_photos_saved_with_the_estimate(env):
    api, database, tmp_path = env
    ids, photos = _seed(database, tmp_path)
    # The claim has photos of these rooms too; the estimate's own are what it shows
    _file_photos(api, ids, photos)
    # Different pictures: a PDF stores identical ones once
    first = _saved_photo(database, tmp_path, 'a.jpg')
    second = _saved_photo(database, tmp_path, 'b.jpg', (200, 200, 30))
    calc_id = _photo_estimate(api, ids, rooms=[
        {'room_name': 'Kitchen', 'photo_ids': [first, second], 'items': [_item('Table')]},
        {'room_name': 'Den', 'items': [_item('Sofa')]},
    ])

    options = api.get(f"{BASE}/{calc_id}/report").json()
    assert [(r['room_name'], r['photo_count']) for r in options['rooms']] == [('Kitchen', 2), ('Den', 0)]
    assert options['photo_count'] == 2
    report = _pdf(api.post(f"{BASE}/{calc_id}/export/report", json={'contents_list': False}))
    assert _image_count(report) == 2

    # A file gone from storage is left out, and the rest still come
    (tmp_path / 'b.jpg').unlink()
    report = _pdf(api.post(f"{BASE}/{calc_id}/export/report", json={'contents_list': False}))
    assert _image_count(report) == 1


def test_a_report_shows_saved_photos_on_no_claim_too(env):
    api, database, tmp_path = env
    _seed(database, tmp_path)
    photo = _saved_photo(database, tmp_path, 'office.jpg')
    calc_id = api.post(f"{BASE}/content-estimate", json={
        'project_address': '5 Elm St',
        'rooms': [{'room_name': 'Office', 'photo_ids': [photo], 'items': [_item('Desk')]}],
    }).json()['id']

    options = api.get(f"{BASE}/{calc_id}/report").json()
    assert options['has_claim'] is False and options['photo_count'] == 1
    report = _pdf(api.post(f"{BASE}/{calc_id}/export/report", json={'contents_list': False}))
    assert _image_count(report) == 1
