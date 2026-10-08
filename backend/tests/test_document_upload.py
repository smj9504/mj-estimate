"""Upload/CORS regression coverage without production storage or database access."""

import importlib.util
import asyncio
import io
from pathlib import Path
import sys
import tempfile
import threading
from types import SimpleNamespace

import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.cors import get_cors_origins, with_cors
from app.common.services.document_upload import upload_document_file, upload_document_stream
from app.domains.storage.b2_provider import B2Provider

ORIGIN = 'https://simple-works.vercel.app'
UPLOAD_PATH = '/api/water-mitigation/jobs/test/documents/upload'


@pytest.fixture
def launcher(monkeypatch):
    monkeypatch.setenv('CORS_ORIGINS', f'["{ORIGIN}"]')
    path = Path(__file__).resolve().parents[1] / 'app/asgi.py'
    spec = importlib.util.spec_from_file_location('_test_launcher', path)
    module = importlib.util.module_from_spec(spec)
    # Keep the real launcher's HTTP logic, but do not import the DB/schedulers.
    with monkeypatch.context() as scoped:
        scoped.setattr(threading.Thread, 'start', lambda self: None)
        spec.loader.exec_module(module)
        return module.LauncherASGI()


def test_startup_preflight_and_503_are_readable(launcher):
    client = TestClient(with_cors(launcher))
    preflight = client.options(UPLOAD_PATH, headers={
        'Origin': ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
    })
    assert preflight.status_code == 200
    assert preflight.headers['access-control-allow-origin'] == ORIGIN
    response = client.post(UPLOAD_PATH, headers={'Origin': ORIGIN})
    assert response.status_code == 503
    assert response.headers['access-control-allow-origin'] == ORIGIN
    assert response.headers['retry-after'] == '5'
    assert 'Retry-After' in response.headers['access-control-expose-headers']
    assert 'starting' in response.json()['detail']


def test_unhandled_upload_error_has_cors(launcher):
    async def failing_upload(request):
        raise RuntimeError('storage unavailable')

    launcher._real_app = Starlette(routes=[Route(UPLOAD_PATH, failing_upload, methods=['POST'])])
    client = TestClient(with_cors(launcher), raise_server_exceptions=False)
    response = client.post(UPLOAD_PATH, headers={'Origin': ORIGIN})
    assert response.status_code == 500
    assert response.headers['access-control-allow-origin'] == ORIGIN


def test_cors_does_not_allow_unconfigured_origin(launcher):
    client = TestClient(with_cors(launcher))
    response = client.options(UPLOAD_PATH, headers={
        'Origin': 'https://untrusted.example',
        'Access-Control-Request-Method': 'POST',
    })
    assert response.status_code == 400
    assert 'access-control-allow-origin' not in response.headers


def test_launcher_refreshes_policy_after_settings_load(launcher, monkeypatch):
    client = TestClient(with_cors(launcher))
    assert client.get('/health', headers={'Origin': ORIGIN}).headers['access-control-allow-origin'] == ORIGIN
    monkeypatch.setenv('CORS_ORIGINS', '["https://other.example"]')
    response = client.options(UPLOAD_PATH, headers={
        'Origin': 'https://other.example', 'Access-Control-Request-Method': 'POST',
    })
    assert response.status_code == 200
    assert response.headers['access-control-allow-origin'] == 'https://other.example'


@pytest.mark.parametrize('value', [f'["{ORIGIN}/"]', f'"{ORIGIN}"', f' {ORIGIN}/, '])
def test_shared_origin_parser(value, monkeypatch):
    monkeypatch.setenv('CORS_ORIGINS', value)
    assert get_cors_origins() == [ORIGIN]


def test_document_upload_passes_disk_spool_without_reading_it():
    received = []
    with tempfile.SpooledTemporaryFile(max_size=1024) as source:
        source.write(b'x' * 4096)
        assert source._rolled

        def upload(**kwargs):
            assert kwargs['file_data'] is source
            assert kwargs['optimize'] is False
            assert source.tell() == 0
            received.append(kwargs)
            return SimpleNamespace(file_path='stored.pdf')

        result, size = upload_document_stream(
            SimpleNamespace(upload=upload), source,
            filename='report.pdf', context='water-mitigation', context_id='test',
        )
        assert size == 4096
        assert result.file_path == 'stored.pdf'
        assert len(received) == 1


def test_cancelled_request_waits_for_worker_before_closing_spool():
    async def scenario():
        entered, finish = threading.Event(), threading.Event()
        source = io.BytesIO(b'pdf')

        def upload(**kwargs):
            entered.set()
            assert finish.wait(5)
            assert not source.closed
            return SimpleNamespace(file_path='stored.pdf')

        async def request():
            try:
                await upload_document_file(SimpleNamespace(upload=upload), source)
            finally:
                source.close()

        task = asyncio.create_task(request())
        assert await asyncio.to_thread(entered.wait, 5)
        task.cancel()
        await asyncio.sleep(0)
        try:
            assert not task.done()
            assert not source.closed
        finally:
            finish.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert source.closed

    asyncio.run(scenario())


def test_b2_upload_never_materializes_whole_file(monkeypatch):
    class BoundedFile(io.BytesIO):
        def read(self, size=-1):
            assert 0 <= size <= 8 * 1024 * 1024, 'Unbounded file read'
            return super().read(size)

    source = BoundedFile(b'test document')
    provider = object.__new__(B2Provider)
    provider.bucket_name = 'test'
    provider.endpoint_url = 'https://storage.example'
    provider.make_public = False
    monkeypatch.setattr(provider, '_build_blob_path', lambda *args: 'documents/report.pdf')
    monkeypatch.setattr(provider, '_apply_optimizations',
                        lambda *args: pytest.fail('Document bytes must not be transformed'))
    calls = []

    def upload(fileobj, bucket, key, *, ExtraArgs, Config):
        assert fileobj is source
        assert bucket == 'test'
        assert key == 'documents/report.pdf'
        assert ExtraArgs['ContentType'] == 'application/pdf'
        assert ExtraArgs['Metadata']['original_filename'] == 'report.pdf'
        assert Config.use_threads is False
        assert Config.max_concurrency == 1
        assert Config.multipart_chunksize == 8 * 1024 * 1024
        assert Config.preferred_transfer_client == 'classic'
        calls.append(fileobj.read(4096))
        fileobj.close()  # Managed transfers may close the file before returning.

    provider.client = SimpleNamespace(upload_fileobj=upload)
    result = provider.upload(source, 'report.pdf', 'water-mitigation', 'job',
                             content_type='application/pdf', optimize=False)
    assert calls == [b'test document']
    assert result.storage_metadata['size'] == len(b'test document')
    assert result.file_path == 'documents/report.pdf'
