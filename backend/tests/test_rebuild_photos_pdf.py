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
        saved['filename'] = filename
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


def make_project(s, property_address=None, **client_address):
    client = Client(id=uuid.uuid4(), display_name='Pat Homeowner', owners=[], **client_address)
    claim = Claim(id=uuid.uuid4(), client_id=client.id, claim_number='CLM-1')
    project = RebuildProject(id=uuid.uuid4(), claim_id=claim.id, title='Rebuild - 12 Oak St', status='pending',
                             property_address=property_address)
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


def make_pdf(s, project, photos=None, pages=None, rotations=None,
             doc_type='completion_photo', title='Completion Photos'):
    return rebuild_api.photos_to_pdf(
        project_id=str(project.id), photos=photos, pages=json.dumps(pages) if pages is not None else '',
        rotations=json.dumps(rotations or {}), doc_type=doc_type, title=title,
        db=s, current_staff=None,
    )


def pdf_pages(data: bytes):
    from pypdf import PdfReader
    return PdfReader(BytesIO(data)).pages


def shapes(page):
    out = []
    for image in page.images:
        w, h = image.image.size
        out.append('portrait' if h > w else 'landscape')
    return sorted(out)


def test_uploads_and_claim_photos_make_one_pdf_in_the_chosen_order_two_to_a_page(db):
    project, claim = make_project(db)
    wm = add_wm_photo(db, claim.id)
    done = add_claim_file(db, claim.id)

    doc = make_pdf(db, project, photos=[upload(jpeg((400, 300)))], pages=[
        {'source': 'claim', 'id': done.id},
        {'source': 'wm', 'id': str(wm.id)},
        {'upload': 0},
    ])

    assert doc['doc_type'] == 'completion_photo'
    pages = pdf_pages(db.saved['pdf'])
    # The first two share a page, the third has the last one to itself; each
    # keeps its photo's shape
    assert [shapes(p) for p in pages] == [['landscape', 'portrait'], ['landscape']]


def test_uploads_alone_still_work_without_a_page_order(db):
    project, _ = make_project(db)
    make_pdf(db, project, photos=[upload(jpeg((400, 300))), upload(jpeg((300, 400))), upload(jpeg((40, 30)))])
    assert len(pdf_pages(db.saved['pdf'])) == 2


def test_every_page_has_the_address_on_top_and_its_number_below(db):
    project, _ = make_project(db, property_address='12 Oak St, Springfield, IL 62701')
    doc = make_pdf(db, project, photos=[upload(jpeg((400, 300))) for _ in range(5)])

    pages = pdf_pages(db.saved['pdf'])
    assert len(pages) == 3
    for n, page in enumerate(pages, 1):
        text = page.extract_text()
        assert '12 Oak St, Springfield, IL 62701' in text
        assert 'Completion Photos' in text
        assert f'Page {n} of 3' in text
    # Named by the address, downloaded and attached under it
    assert doc['file_name'] == '12 Oak St, Springfield, IL 62701 - Completion Photos.pdf'
    assert db.saved['filename'] == doc['file_name']


def test_without_a_project_address_the_clients_is_used(db):
    project, _ = make_project(db, address='7 Elm Ave', city='Dayton', state='OH', zipcode='45402')
    doc = make_pdf(db, project, photos=[upload(jpeg((400, 300)))])
    assert '7 Elm Ave' in pdf_pages(db.saved['pdf'])[0].extract_text()
    assert doc['file_name'].startswith('7 Elm Ave')
    assert doc['file_name'].endswith(' - Completion Photos.pdf')


def test_with_no_address_at_all_the_title_heads_the_page_and_names_the_file(db):
    project, _ = make_project(db)
    doc = make_pdf(db, project, photos=[upload(jpeg((400, 300)))])
    assert 'Completion Photos' in pdf_pages(db.saved['pdf'])[0].extract_text()
    assert doc['file_name'] == 'Completion Photos.pdf'


def test_a_photographed_paper_document_keeps_a_page_to_itself(db):
    project, _ = make_project(db, property_address='12 Oak St')
    doc = make_pdf(db, project, photos=[upload(jpeg((300, 400))), upload(jpeg((300, 400)))],
                   doc_type='coc', title='Certificate of Completion')
    pages = pdf_pages(db.saved['pdf'])
    assert len(pages) == 2
    assert '12 Oak St' in pages[1].extract_text()
    assert doc['file_name'] == '12 Oak St - Certificate of Completion.pdf'


def test_the_file_name_drops_what_a_file_name_cant_hold():
    name = RebuildService._photo_pdf_file_name('12 Oak St #3', 'Before/After: "final"?')
    assert name == '12 Oak St #3 - Before After final.pdf'


def test_a_title_in_another_script_stays_on_the_doc_but_storage_gets_ascii(db):
    project, _ = make_project(db, property_address='12 Oak St')
    doc = make_pdf(db, project, photos=[upload(jpeg((400, 300)))], title='완료 사진')
    assert doc['file_name'] == '12 Oak St - 완료 사진.pdf'
    assert db.saved['filename'] == '12 Oak St.pdf'


def test_the_pdf_opens_under_its_name(db, monkeypatch):
    project, _ = make_project(db, property_address='12 Oak St, Springfield, IL 62701')
    doc = make_pdf(db, project, photos=[upload(jpeg((400, 300)))], title='완료 사진')
    pdf = db.saved['pdf']
    monkeypatch.setattr('app.domains.storage.factory.StorageFactory.get_instance',
                        lambda *a: SimpleNamespace(download=lambda *a, **k: pdf))

    response = rebuild_api.serve_completion_doc_pdf(str(project.id), str(doc['id']))

    disposition = response.headers['content-disposition']
    assert disposition.startswith('inline; filename="12 Oak St, Springfield, IL 62701 -')
    assert "filename*=UTF-8''12%20Oak%20St%2C%20Springfield%2C%20IL%2062701%20-%20%EC%99%84" in disposition
    assert response.body == pdf


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
