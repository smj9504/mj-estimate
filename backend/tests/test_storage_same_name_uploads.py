"""Cloud storage keys are a folder and a name, so two files of one name must not
land on one object; only a document updated in place keeps its key."""

import io
from pathlib import Path
from types import SimpleNamespace
import sys

import pytest
from botocore.exceptions import ClientError
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.common.utils import storage_helpers  # noqa: E402
from app.domains.storage.b2_provider import B2Provider  # noqa: E402
from app.domains.storage.base import unique_object_name  # noqa: E402
from app.domains.storage.gcs_provider import GCSProvider  # noqa: E402
from app.domains.storage.optimization import StorageOptimizer  # noqa: E402


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


def gcs_provider(files):
    provider = object.__new__(GCSProvider)
    provider.bucket_name = 'test'
    provider.make_public = False
    provider.bucket = SimpleNamespace(blob=lambda name: FakeBlob(files, name))
    return provider


def fake_s3(files):
    def head_object(Bucket, Key):
        if Key not in files:
            raise ClientError({'Error': {'Code': '404'}}, 'HeadObject')

    def get_object(Bucket, Key):
        if Key not in files:
            raise ClientError({'Error': {'Code': 'NoSuchKey'}}, 'GetObject')
        return {'Body': io.BytesIO(files[Key]), 'ContentLength': len(files[Key])}

    def put_object(Bucket, Key, Body):
        files[Key] = Body

    def upload_fileobj(file_data, bucket, key, ExtraArgs, Config):
        files[key] = file_data.read()

    def delete_object(Bucket, Key):
        del files[Key]

    return SimpleNamespace(
        head_object=head_object, get_object=get_object, put_object=put_object,
        upload_fileobj=upload_fileobj, delete_object=delete_object,
    )


def b2_provider(files):
    provider = object.__new__(B2Provider)
    provider.bucket_name = 'test'
    provider.endpoint_url = 'https://storage.example'
    provider.make_public = False
    provider.client = fake_s3(files)
    return provider


def optimizing(provider):
    """As the deployed provider runs: images to WebP, identical files shared"""
    provider.enable_optimization = True
    provider.optimizer = StorageOptimizer(
        enable_image_optimization=True, enable_deduplication=True, enable_compression=True,
        image_quality=85, image_format='WebP',
    )
    return provider


def jpeg(color) -> bytes:
    buffer = io.BytesIO()
    Image.new('RGB', (400, 300), color).save(buffer, format='JPEG')
    return buffer.getvalue()


def png(color) -> bytes:
    buffer = io.BytesIO()
    Image.new('RGB', (400, 300), color).save(buffer, format='PNG')
    return buffer.getvalue()


both = pytest.mark.parametrize('make_provider', [b2_provider, gcs_provider])


def test_the_stored_name_keeps_the_name_and_its_extension():
    assert unique_object_name('IMG_0001.jpg').startswith('IMG_0001_')
    assert unique_object_name('IMG_0001.jpg').endswith('.jpg')
    assert unique_object_name('report.final.pdf').startswith('report.final_')
    assert unique_object_name('no-extension').startswith('no-extension_')
    assert unique_object_name('IMG_0001.jpg') != unique_object_name('IMG_0001.jpg')


@both
def test_two_files_of_one_name_each_keep_their_own_contents(make_provider):
    files = {}
    provider = make_provider(files)

    def upload(content):
        return provider.upload(
            io.BytesIO(content), 'estimate.pdf', 'claim', 'claim-1',
            category='general', content_type='application/pdf', optimize=False,
        )

    first, second = upload(b'first estimate'), upload(b'second estimate')

    assert first.file_id != second.file_id
    assert files[first.file_id] == b'first estimate'
    assert files[second.file_id] == b'second estimate'
    # Still filed where it was, under a name that says what it is
    assert first.file_id.startswith('claim/claim-1/general/estimate_')
    assert first.file_id.endswith('.pdf')


@both
def test_phone_photos_of_one_name_stay_apart_after_optimizing(make_provider):
    files = {}
    provider = optimizing(make_provider(files))

    def upload(content):
        return provider.upload(
            io.BytesIO(content), 'image.jpg', 'water-mitigation', 'job',
            category='photos', content_type='image/jpeg',
        )

    red, blue = upload(jpeg((200, 30, 30))), upload(jpeg((30, 30, 200)))

    assert red.file_id != blue.file_id
    # A JPEG that fits is stored as it came; anything else is converted
    assert red.file_id.endswith('.jpg')
    converted = provider.upload(
        io.BytesIO(png((30, 200, 30))), 'image.jpg', 'water-mitigation', 'job',
        category='photos', content_type='image/jpeg',
    )
    assert converted.file_id.endswith('.webp')
    assert Image.open(io.BytesIO(files[converted.file_id])).format == 'WEBP'

    def color(result):
        return Image.open(io.BytesIO(files[result.file_id])).convert('RGB').getpixel((10, 10))
    assert color(red)[0] > 150 and color(red)[2] < 100
    assert color(blue)[2] > 150 and color(blue)[0] < 100

    # An identical photo still shares the one already stored
    assert upload(jpeg((200, 30, 30))).file_id == red.file_id


@both
def test_a_document_updated_in_place_keeps_its_key(make_provider):
    files = {}
    provider = make_provider(files)

    def upload(content):
        return provider.upload(
            io.BytesIO(content), 'Sketch Report.pdf', 'water-mitigation', 'job',
            category='documents', content_type='application/pdf', optimize=False, replace=True,
        )

    first, second = upload(b'version one'), upload(b'version two')

    assert first.file_id == second.file_id == 'water-mitigation/job/documents/Sketch Report.pdf'
    assert files == {first.file_id: b'version two'}


@both
def test_going_back_to_an_earlier_version_is_not_answered_by_content(make_provider, monkeypatch):
    files = {}
    provider = make_provider(files)
    # What the optimizer says of any file: its content hash, for sharing
    monkeypatch.setattr(
        provider, '_apply_optimizations',
        lambda file_data, *args: (file_data, {'dedup_key': file_data.getvalue().decode()}),
    )

    def upload(content):
        return provider.upload(
            io.BytesIO(content), 'Sketch Report.pdf', 'water-mitigation', 'job',
            category='documents', content_type='application/pdf', replace=True,
        )

    upload(b'version-one')
    upload(b'version-two')
    key = upload(b'version-one').file_id

    assert files[key] == b'version-one'
    assert not any(name.startswith('_dedup/') for name in files)


def test_the_helper_passes_replace_on(monkeypatch):
    seen = []

    def upload(**kwargs):
        seen.append(kwargs['replace'])
        return SimpleNamespace(file_path='p', file_url='u', file_id='f')

    monkeypatch.setattr(storage_helpers.StorageFactory, 'get_instance', lambda *a: SimpleNamespace(upload=upload))
    storage_helpers.upload_bytes_to_storage(b'x', 'a.pdf', 'c', 'i')
    storage_helpers.upload_bytes_to_storage(b'x', 'a.pdf', 'c', 'i', replace=True)
    assert seen == [False, True]
