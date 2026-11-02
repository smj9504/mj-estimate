"""A crop keeps the photo's quality, shows in a browser and gets a usable name."""

import asyncio
import io
from types import SimpleNamespace
from uuid import uuid4

import cv2
import numpy as np
import pymupdf
import pytest
from PIL import Image, ImageDraw

from app.common.services import pdf_service
from app.common.utils import storage_helpers
from app.domains.water_mitigation import api as wm_api
from app.domains.water_mitigation.schemas import PerspectiveCropRequest

CORNERS = [{'x': 0.08, 'y': 0.05}, {'x': 0.93, 'y': 0.08}, {'x': 0.95, 'y': 0.95}, {'x': 0.05, 'y': 0.92}]


def form_photo(size=(1440, 1920)):
    """Fine black lines, like text on a photographed form."""
    img = Image.new('RGB', size, 'white')
    draw = ImageDraw.Draw(img)
    for y in range(0, size[1], 6):
        draw.line([(0, y), (size[0], y + 40)], fill=(20, 20, 20), width=1)
    return img


def edge_energy(img):
    return cv2.Laplacian(np.asarray(img.convert('L')), cv2.CV_64F).var()


def jpeg_bytes(img, **kwargs):
    buffer = io.BytesIO()
    img.save(buffer, format='JPEG', **kwargs)
    return buffer.getvalue()


# --- The crop's pixels ---

def test_crop_is_sharper_than_the_bilinear_default():
    img = form_photo()
    crop = pdf_service.perspective_crop(img, CORNERS)

    array = np.asarray(img)
    h, w = array.shape[:2]
    src = np.float32([[p['x'] * w, p['y'] * h] for p in CORNERS])
    dst = np.float32([[0, 0], [crop.width - 1, 0], [crop.width - 1, crop.height - 1], [0, crop.height - 1]])
    bilinear = cv2.warpPerspective(array, cv2.getPerspectiveTransform(src, dst), crop.size)

    assert edge_energy(crop) > edge_energy(Image.fromarray(bilinear)) * 1.2


def test_crop_has_as_many_pixels_as_the_photo_has_there():
    crop = pdf_service.perspective_crop(form_photo(), CORNERS)
    top = np.hypot((CORNERS[1]['x'] - CORNERS[0]['x']) * 1440, (CORNERS[1]['y'] - CORNERS[0]['y']) * 1920)
    bottom = np.hypot((CORNERS[2]['x'] - CORNERS[3]['x']) * 1440, (CORNERS[2]['y'] - CORNERS[3]['y']) * 1920)
    assert crop.width == round(max(top, bottom))


def test_corner_on_the_photos_edge_pulls_in_no_black():
    img = Image.new('RGB', (800, 600), 'white')
    whole = [{'x': 0, 'y': 0}, {'x': 1, 'y': 0}, {'x': 1, 'y': 1}, {'x': 0, 'y': 1}]
    crop = pdf_service.perspective_crop(img, whole)
    assert np.asarray(crop).min() == 255


def test_saved_crop_keeps_full_colour_and_its_profile():
    img = form_photo((400, 300))
    img.info['icc_profile'] = b'fake-display-p3'
    saved = Image.open(io.BytesIO(pdf_service.cropped_photo_jpeg(img, CORNERS)))
    assert saved.format == 'JPEG'
    assert saved.layer[0][1] == 1 and saved.layer[0][2] == 1  # 4:4:4: no colour subsampling
    assert saved.info['icc_profile'] == b'fake-display-p3'


# --- Into the PDF ---

def only_image(pdf_path):
    with pymupdf.open(pdf_path) as doc:
        return doc.extract_image(doc[0].get_images()[0][0])


def write_jpeg(path, img, **kwargs):
    path.write_bytes(jpeg_bytes(img, **kwargs))
    return str(path)


def test_jpeg_that_fits_goes_into_the_pdf_byte_for_byte(tmp_path):
    photo = write_jpeg(tmp_path / 'crop.jpg', form_photo(), quality=95, subsampling=0)
    output = tmp_path / 'out.pdf'
    pdf_service.generate_images_pdf([photo], str(output))
    assert only_image(output)['image'] == (tmp_path / 'crop.jpg').read_bytes()


def test_rotation_turns_the_page_without_touching_the_jpeg(tmp_path):
    img = Image.new('RGB', (1000, 600), 'white')
    img.paste((220, 30, 30), (0, 0, 200, 600))  # A red band down its left side
    photo = write_jpeg(tmp_path / 'p.jpg', img, quality=95)
    output = tmp_path / 'out.pdf'
    pdf_service.generate_images_pdf([photo], str(output), rotations={photo: 90})

    assert only_image(output)['image'] == (tmp_path / 'p.jpg').read_bytes()
    with pymupdf.open(output) as doc:
        page = doc[0].get_pixmap(dpi=40)
        rendered = Image.frombytes('RGB', (page.width, page.height), page.samples)
    # Clockwise: the left side ends up on top. Sideways it fills the page's height,
    # so the band is the top fifth of the page
    width, height = rendered.size
    r, g, _ = rendered.getpixel((width // 2, height // 10))
    assert r > 180 and g < 90
    r, g, _ = rendered.getpixel((width // 2, height // 2))
    assert g > 200


@pytest.mark.parametrize('kwargs', [
    {'compress': True},
    {'scan_effect': 'bw_scan'},
])
def test_compress_and_scan_effect_still_rewrite_the_photo(tmp_path, kwargs):
    photo = write_jpeg(tmp_path / 'p.jpg', form_photo(), quality=95, subsampling=0)
    output = tmp_path / 'out.pdf'
    pdf_service.generate_images_pdf([photo], str(output), **kwargs)
    assert only_image(output)['image'] != (tmp_path / 'p.jpg').read_bytes()
    assert output.stat().st_size < (tmp_path / 'p.jpg').stat().st_size


@pytest.mark.parametrize('orientation, too_large', [(6, False), (1, True)])
def test_jpeg_needing_work_is_not_embedded_as_it_is(tmp_path, orientation, too_large):
    img = form_photo((2600, 1000) if too_large else (1000, 800))
    exif = img.getexif()
    exif[0x0112] = orientation
    path = tmp_path / 'p.jpg'
    img.save(path, exif=exif.tobytes())
    assert pdf_service._jpeg_fit_for_page(path, pdf_service.FULL_PAGE_PHOTO_PX) is None


def test_webp_is_not_embedded_as_it_is(tmp_path):
    path = tmp_path / 'p.webp'
    form_photo((800, 600)).save(path)
    assert pdf_service._jpeg_fit_for_page(path, pdf_service.FULL_PAGE_PHOTO_PX) is None


# --- The file name ---

@pytest.mark.parametrize('source, taken, expected', [
    ('IMG_2041.jpg', set(), 'IMG_2041_cropped.jpg'),
    ('companycam_123.webp', set(), 'companycam_123_cropped.jpg'),
    ('IMG_2041.jpg', {'IMG_2041_cropped.jpg'}, 'IMG_2041_cropped_2.jpg'),
    ('IMG_2041.jpg', {'IMG_2041_cropped.jpg', 'IMG_2041_cropped_2.jpg'}, 'IMG_2041_cropped_3.jpg'),
    ('IMG_2041_cropped.jpg', set(), 'IMG_2041_cropped.jpg'),
    ('IMG_2041_cropped_2.jpg', {'IMG_2041_cropped.jpg'}, 'IMG_2041_cropped_2.jpg'),
    ('cropped_cropped.jpg', set(), 'photo_cropped.jpg'),
    ('cropped_IMG_9.jpg', set(), 'IMG_9_cropped.jpg'),
    ('', set(), 'photo_cropped.jpg'),
    (None, set(), 'photo_cropped.jpg'),
])
def test_cropped_file_name(source, taken, expected):
    assert wm_api._cropped_file_name(source, taken) == expected


# --- Saving it ---

@pytest.fixture
def crop_route(monkeypatch, tmp_path):
    """The crop endpoint around a stored photo, with what it uploads and records kept."""
    job_id = str(uuid4())
    photo_path = tmp_path / 'stored.jpg'
    photo_path.write_bytes(jpeg_bytes(form_photo((1440, 1920)), quality=85))
    photo = {
        'id': str(uuid4()), 'job_id': job_id, 'source': 'manual_upload', 'external_id': None,
        'file_name': 'IMG_2041.jpg', 'file_path': str(photo_path), 'category': 'documentation',
        'title': None, 'captured_date': '2026-10-01T10:00:00', 'location_level': '1st Floor',
        'location_room': 'Kitchen', 'storage_provider': 'local', 'storage_file_id': None,
    }
    uploads, created = [], []

    def upload(**kwargs):
        uploads.append(kwargs)
        return {'file_path': 'key/x.jpg', 'storage_provider': 'b2', 'storage_file_id': 'key/x.jpg',
                'file_size': len(kwargs['file_bytes'])}

    monkeypatch.setattr(storage_helpers, 'upload_bytes_to_storage', upload)
    query = SimpleNamespace(filter=lambda *a: [('IMG_2041_cropped.jpg',)])
    repo = SimpleNamespace(
        get_by_id=lambda pid: photo,
        _convert_to_dict=lambda entity: entity,
        create=lambda data: created.append(data) or {**data, 'id': str(uuid4())},
    )
    service = SimpleNamespace(photo_repo=repo, session=SimpleNamespace(query=lambda *a: query))
    cleared = []
    monkeypatch.setattr(wm_api, '_invalidate_photo_list_cache', lambda: cleared.append(1))
    request = PerspectiveCropRequest(points=CORNERS)
    db = SimpleNamespace(commit=lambda: None)

    def run(photo_overrides=None):
        photo.update(photo_overrides or {})
        return wm_api.perspective_crop_photo(uuid4(), request, service, db)

    return SimpleNamespace(run=run, uploads=uploads, created=created, cleared=cleared)


def test_crop_is_stored_as_an_untouched_jpeg(crop_route):
    crop_route.run()
    upload = crop_route.uploads[0]
    assert upload['content_type'] == 'image/jpeg'  # B2 serves what it was told: PDF is refused by an <img>
    assert upload['optimize'] is False  # The optimizer would shrink it to 1920px and rewrite it as WebP
    assert Image.open(io.BytesIO(upload['file_bytes'])).format == 'JPEG'


def test_crop_record_is_named_and_filed_with_its_source(crop_route):
    result = crop_route.run()
    record = crop_route.created[0]
    assert record['file_name'] == 'IMG_2041_cropped_2.jpg'
    assert record['file_type'] == 'photo'
    assert record['title'] is None
    assert record['category'] == 'documentation'
    assert record['captured_date'] == '2026-10-01T10:00:00'
    assert (record['location_level'], record['location_room']) == ('1st Floor', 'Kitchen')
    assert result['preview_url'].endswith('/preview?size=web')
    assert crop_route.cleared == [1]  # Or the new photo stays out of the gallery for 30 seconds


def test_companycam_crop_uses_the_full_size_original(crop_route, monkeypatch):
    big = jpeg_bytes(form_photo((3024, 4032)), quality=90)
    monkeypatch.setattr(wm_api, '_companycam_original', lambda external_id: big)
    crop_route.run({'source': 'companycam', 'external_id': '999'})
    width, _ = Image.open(io.BytesIO(crop_route.uploads[0]['file_bytes'])).size
    assert width > 2500  # 1920px storage copy would give about 1270


def test_companycam_answer_no_bigger_than_storage_is_ignored(crop_route, monkeypatch):
    monkeypatch.setattr(wm_api, '_companycam_original', lambda external_id: jpeg_bytes(form_photo((200, 200))))
    crop_route.run({'source': 'companycam', 'external_id': '999'})
    width, _ = Image.open(io.BytesIO(crop_route.uploads[0]['file_bytes'])).size
    assert width > 1000


def test_companycam_failure_falls_back_to_storage(crop_route, monkeypatch):
    monkeypatch.setattr(wm_api, '_companycam_original', lambda external_id: None)
    crop_route.run({'source': 'companycam', 'external_id': '999'})
    assert len(crop_route.created) == 1


def test_missing_file_is_a_404(crop_route, monkeypatch):
    def missing(*args, **kwargs):
        raise FileNotFoundError('gone')

    monkeypatch.setattr(storage_helpers, 'download_from_storage', missing)
    with pytest.raises(wm_api.HTTPException) as error:
        crop_route.run({'file_path': 'not/here.jpg'})
    assert error.value.status_code == 404


# --- Showing it ---

def preview(monkeypatch, photo, tmp_path, stored=b'jpeg bytes'):
    from app.domains.storage import factory

    monkeypatch.setattr(wm_api, '_read_photo_and_release', lambda service, photo_id: photo)
    monkeypatch.setattr('app.core.config.settings.STORAGE_BASE_DIR', str(tmp_path))
    storage = SimpleNamespace(
        download=lambda key: stored,
        get_url=lambda key, expires_in=None: f'https://b2.example/{key}',
    )
    monkeypatch.setattr(factory.StorageFactory, 'get_instance', lambda *a: storage)
    return asyncio.run(wm_api.preview_photo(uuid4(), SimpleNamespace(), 'original', SimpleNamespace()))


def b2_photo(source):
    return {'source': source, 'external_id': None, 'storage_provider': 'b2', 'file_path': 'key/x.jpg',
            'mime_type': 'image/jpeg', 'storage_file_id': 'key/x.jpg'}


def test_crop_on_b2_is_served_as_an_image_whatever_b2_has_it_labelled(monkeypatch, tmp_path):
    response = preview(monkeypatch, b2_photo('cropped'), tmp_path)
    assert response.status_code == 200
    assert response.media_type == 'image/jpeg'


def test_other_b2_photos_still_redirect(monkeypatch, tmp_path):
    response = preview(monkeypatch, b2_photo('manual_upload'), tmp_path)
    assert response.status_code == 302


def test_helper_passes_optimize_on(monkeypatch):
    seen = []

    def upload(**kwargs):
        seen.append(kwargs['optimize'])
        return SimpleNamespace(file_path='p', file_url='u', file_id='f')

    monkeypatch.setattr(storage_helpers.StorageFactory, 'get_instance', lambda *a: SimpleNamespace(upload=upload))
    storage_helpers.upload_bytes_to_storage(b'x', 'a.pdf', 'c', 'i')
    storage_helpers.upload_bytes_to_storage(b'x', 'a.jpg', 'c', 'i', optimize=False)
    assert seen == [True, False]
