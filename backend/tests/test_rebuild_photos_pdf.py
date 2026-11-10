"""Rebuild photos to PDF: uploads mixed with photos already on the claim (its WM
jobs' photos and its own photo files), on in-memory SQLite and local files."""
import json
import sqlite3
import sys
import uuid
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.datastructures import UploadFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: F401  registers every model
from app.domains.client.models import Claim, Client
from app.domains.company.models import Company
from app.domains.file.models import File as FileRecord
from app.domains.rebuild import api as rebuild_api
from app.domains.rebuild.models import RebuildCompletionDoc, RebuildContractor, RebuildProject
from app.domains.rebuild.service import RebuildService
from app.domains.water_mitigation.models import WaterMitigationJob, WMPhoto


@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(type_, compiler, **kw):
    return 'JSON'


# The base repository hands a uuid-looking string column a UUID, which Postgres
# takes as text and SQLite refuses
sqlite3.register_adapter(uuid.UUID, str)


@pytest.fixture
def db(monkeypatch, tmp_path):
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    for model in (Client, Claim, Company, RebuildContractor, RebuildProject, RebuildCompletionDoc,
                  WaterMitigationJob, WMPhoto, FileRecord):
        model.__table__.create(engine)
    make = sessionmaker(bind=engine)
    database = SimpleNamespace(get_session=make, get_readonly_session=make)
    monkeypatch.setattr(rebuild_api, '_get_service', lambda: RebuildService(database=database))
    monkeypatch.setattr(rebuild_api, '_require_project', lambda *a: None)

    saved = {}

    def fake_upload(file_bytes, filename, **kw):
        saved['pdf'] = file_bytes
        return {'file_url': f'local/{filename}', 'file_path': filename}
    monkeypatch.setattr('app.common.utils.storage_helpers.upload_bytes_to_storage', fake_upload)

    s = make()
    s.saved = saved
    s.tmp = tmp_path
    yield s
    s.close()


def jpeg(size, color='red', orientation=None) -> bytes:
    out = BytesIO()
    img = Image.new('RGB', size, color)
    if orientation:
        exif = Image.Exif()
        exif[0x0112] = orientation
        img.save(out, format='JPEG', exif=exif)
    else:
        img.save(out, format='JPEG')
    return out.getvalue()


def make_project(s):
    client = Client(id=uuid.uuid4(), display_name='Pat Homeowner', owners=[])
    claim = Claim(id=uuid.uuid4(), client_id=client.id, claim_number='CLM-1')
    project = RebuildProject(id=uuid.uuid4(), claim_id=claim.id, title='Rebuild - 12 Oak St', status='pending')
    s.add_all([client, claim, project])
    s.commit()
    return project, claim


def add_wm_photo(s, claim_id, size=(300, 400), trashed=False, name='wm.jpg'):
    job = s.query(WaterMitigationJob).filter_by(claim_id=claim_id).first()
    if job is None:
        job = WaterMitigationJob(id=uuid.uuid4(), claim_id=claim_id, property_address='12 Oak St', status='lead')
        s.add(job)
        s.commit()
    path = s.tmp / f'{uuid.uuid4()}.jpg'
    path.write_bytes(jpeg(size, 'blue'))
    photo = WMPhoto(id=uuid.uuid4(), job_id=job.id, source='companycam', file_name=name,
                    file_path=str(path), mime_type='image/jpeg', is_trashed=trashed)
    s.add(photo)
    s.commit()
    return photo


def add_claim_file(s, claim_id, size=(500, 300), name='done.jpg'):
    path = s.tmp / f'{uuid.uuid4()}.jpg'
    path.write_bytes(jpeg(size, 'green'))
    record = FileRecord(id=str(uuid.uuid4()), filename=name, original_name=name, content_type='image/jpeg',
                        size=path.stat().st_size, context='claim', context_id=str(claim_id),
                        url=str(path), storage_provider='local', is_active=True)
    s.add(record)
    s.commit()
    return record


def upload(data: bytes, name='phone.jpg') -> UploadFile:
    return UploadFile(file=BytesIO(data), filename=name)


def make_pdf(s, project, photos=None, pages=None, rotations=None):
    return rebuild_api.photos_to_pdf(
        project_id=str(project.id), photos=photos, pages=json.dumps(pages) if pages is not None else '',
        rotations=json.dumps(rotations or {}), doc_type='completion_photo', title='Completion Photos',
        db=s, current_staff=None,
    )


def pdf_pages(data: bytes):
    from pypdf import PdfReader
    return PdfReader(BytesIO(data)).pages


def test_uploads_and_claim_photos_make_one_pdf_in_the_chosen_order(db):
    project, claim = make_project(db)
    wm = add_wm_photo(db, claim.id)
    done = add_claim_file(db, claim.id)

    doc = make_pdf(db, project, photos=[upload(jpeg((400, 300)))], pages=[
        {'source': 'claim', 'id': done.id},
        {'upload': 0},
        {'source': 'wm', 'id': str(wm.id)},
    ])

    assert doc['doc_type'] == 'completion_photo'
    pages = pdf_pages(db.saved['pdf'])
    assert len(pages) == 3
    # Each page's one picture keeps its photo's shape: landscape, landscape, portrait
    shapes = []
    for page in pages:
        (image,) = page.images
        w, h = image.image.size
        shapes.append('portrait' if h > w else 'landscape')
    assert shapes == ['landscape', 'landscape', 'portrait']


def test_uploads_alone_still_work_without_a_page_order(db):
    project, _ = make_project(db)
    make_pdf(db, project, photos=[upload(jpeg((400, 300))), upload(jpeg((300, 400)))])
    assert len(pdf_pages(db.saved['pdf'])) == 2


def test_a_trashed_photo_or_another_claims_photo_is_refused(db):
    project, claim = make_project(db)
    trashed = add_wm_photo(db, claim.id, trashed=True)
    _, other_claim = make_project(db)
    elsewhere = add_claim_file(db, other_claim.id)

    for ref in ({'source': 'wm', 'id': str(trashed.id)}, {'source': 'claim', 'id': elsewhere.id}):
        with pytest.raises(HTTPException) as err:
            make_pdf(db, project, pages=[ref])
        assert err.value.status_code == 400
        assert 'no longer on this claim' in err.value.detail
    assert 'pdf' not in db.saved


def test_a_page_pointing_past_the_uploads_is_refused(db):
    project, _ = make_project(db)
    with pytest.raises(HTTPException) as err:
        make_pdf(db, project, photos=[upload(jpeg((40, 30)))], pages=[{'upload': 1}])
    assert err.value.status_code == 400


def test_a_phone_photo_comes_out_upright_and_then_turned_as_asked():
    # Stored 400x200 with EXIF "rotate 90": the browser shows it 200x400
    upright, size = RebuildService._photo_page_jpeg(jpeg((400, 200), orientation=6), 0)
    assert size == (200, 400)
    turned, size = RebuildService._photo_page_jpeg(jpeg((400, 200), orientation=6), 90)
    assert size == (400, 200)


def test_a_large_photo_is_shrunk_for_its_page():
    _, size = RebuildService._photo_page_jpeg(jpeg((4000, 3000)), 0)
    assert max(size) == RebuildService.PDF_PHOTO_PX


def test_more_than_the_cap_is_refused(db):
    project, _ = make_project(db)
    pages = [('p.jpg', lambda: jpeg((10, 10)))] * (RebuildService.MAX_PDF_PHOTOS + 1)
    with pytest.raises(ValueError, match='up to'):
        rebuild_api._get_service().photos_to_pdf(str(project.id), pages, {}, 'completion_photo', 'Completion Photos')


def test_project_detail_lists_the_claims_wm_jobs_and_client(db):
    project, claim = make_project(db)
    add_wm_photo(db, claim.id)
    detail = rebuild_api._get_service().get_project(str(project.id))
    assert detail['client_id'] == str(claim.client_id)
    assert [j['property_address'] for j in detail['wm_jobs']] == ['12 Oak St']
