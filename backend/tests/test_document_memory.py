"""Regression tests; no database, credentials, or outbound email required."""
import io
import sys
import threading
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pymupdf
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.common.services import document_resources as resources
from app.common.services import pdf_service


def test_jobs_are_reentrant_but_do_not_overlap():
    entered, finish = threading.Event(), threading.Event()

    @resources.document_job
    def nested():
        return 42

    @resources.document_job
    def work():
        assert nested() == 42
        entered.set()
        assert finish.wait(5)

    thread = threading.Thread(target=work)
    thread.start()
    try:
        assert entered.wait(5)
        with pytest.raises(resources.DocumentResourceError, match='Another document'):
            nested()
    finally:
        finish.set()
        thread.join(5)
    assert nested() == 42


def test_budget_failure_releases_lock(monkeypatch):
    monkeypatch.setattr(resources, 'memory_headroom', lambda: 80 * resources.MIB)
    ran = []

    @resources.document_job
    def work():
        ran.append(True)

    with pytest.raises(resources.DocumentResourceError, match='insufficient memory'):
        work()
    assert ran == []
    monkeypatch.setattr(resources, 'memory_headroom', lambda: None)
    work()
    assert ran == [True]


def test_read_refuses_oversize_before_open(tmp_path, monkeypatch):
    path = tmp_path / 'large.pdf'
    path.write_bytes(b'x' * 20)
    monkeypatch.setattr('builtins.open', lambda *a, **k: pytest.fail('must not read'))
    with pytest.raises(resources.DocumentResourceError):
        resources.read_bounded(path, 10)


def test_disk_writer_preserves_page_order(tmp_path):
    path = tmp_path / 'merged.pdf'
    writer = resources.DiskPDFWriter(path)
    for number in range(15):
        with pymupdf.open() as page:
            page.new_page().insert_text((20, 20), f'Page {number}')
            writer.append(io.BytesIO(page.tobytes()))
    with pymupdf.open(path) as result:
        assert len(result) == 15
        assert [p.get_text().strip() for p in result] == [f'Page {n}' for n in range(15)]


@pytest.fixture
def local_settings(monkeypatch):
    module = ModuleType('app.core.config')
    module.settings = SimpleNamespace(STORAGE_PROVIDER='local')
    monkeypatch.setitem(sys.modules, 'app.core.config', module)


def render_report(tmp_path, photo_paths, **options):
    photos = [dict(id=str(i), file_path=str(path), storage_provider='local')
              for i, path in enumerate(photo_paths)]
    config = {'sections': [{'title': 'Drying', 'layout': 'four', 'photos': [
        {'photo_id': p['id'], 'caption': f'Photo {i}'} for i, p in enumerate(photos)
    ]}]}
    output = tmp_path / 'report.pdf'
    pdf_service.generate_water_mitigation_report_pdf(
        {'id': 'test', 'property_address': '123 Test Street'}, config, photos,
        str(output), company_data={'name': 'Test'}, **options,
    )
    return output


@pytest.mark.parametrize('compress', [False, True])
def test_report_embeds_resized_jpeg_not_full_original(tmp_path, local_settings, compress):
    photo = tmp_path / 'large.jpg'
    with Image.new('RGB', (4000, 3000), 'red') as img:
        img.save(photo)
    output = render_report(tmp_path, [photo] * 9, compress=compress)
    with pymupdf.open(output) as doc:
        assert len(doc) == 4
        for page in list(doc)[1:]:
            assert page.get_images()
            assert all(max(image[2:4]) <= 1800 for image in page.get_images())
        assert 'Page 2' in doc[1].get_text()
        assert 'Page 4' in doc[3].get_text()


def test_oversized_png_fails_before_pixel_decode(tmp_path, local_settings, monkeypatch):
    photo = tmp_path / 'oversized.png'
    with Image.new('RGB', (5000, 4000), 'white') as img:
        img.save(photo)
    original = Image.Image.load

    def guarded_load(image, *args, **kwargs):
        if image.width * image.height > 16_000_000:
            pytest.fail('Oversized PNG was decoded')
        return original(image, *args, **kwargs)

    monkeypatch.setattr(Image.Image, 'load', guarded_load)
    with pytest.raises(resources.DocumentResourceError, match='resolution'):
        render_report(tmp_path, [photo])


def test_photo_error_cleans_temporary_jpegs(tmp_path, local_settings, monkeypatch):
    photo = tmp_path / 'photo.jpg'
    with Image.new('RGB', (3000, 2000), 'red') as img:
        img.save(photo)
    original = resources.DiskPDFWriter.append
    calls = []

    def fail_second_page(self, buffer):
        calls.append(1)
        if len(calls) > 1:
            raise RuntimeError('disk full')
        return original(self, buffer)

    monkeypatch.setattr(resources.DiskPDFWriter, 'append', fail_second_page)
    import tempfile
    monkeypatch.setattr(tempfile, 'tempdir', str(tmp_path))
    with pytest.raises(RuntimeError, match='disk full'):
        render_report(tmp_path, [photo], compress=True)
    assert list(tmp_path.glob('tmp*.jpg')) == []


@pytest.fixture
def email_service(monkeypatch):
    # The tested attachment code needs no DB connection. Stub only the DB
    # factory to keep these tests independent of deployment credentials.
    module = ModuleType('app.core.database_factory')
    module.get_database = lambda: None
    monkeypatch.setitem(sys.modules, 'app.core.database_factory', module)
    import importlib.util
    path = Path(__file__).resolve().parents[1] / 'app/domains/water_mitigation/adjuster_email_service.py'
    spec = importlib.util.spec_from_file_location('_wm_resource_test.email', path)
    email_module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, email_module)
    spec.loader.exec_module(email_module)
    return email_module.AdjusterEmailService(database=object())


def test_attachment_oversize_is_not_swallowed(tmp_path, email_service):
    path = tmp_path / 'huge.pdf'
    with path.open('wb') as f:
        f.truncate(email_service._MAX_COMPRESSIBLE_SIZE + 1)
    doc = SimpleNamespace(id='test', file_path=str(path), storage_file_id=None,
                          storage_provider='local', mime_type='application/pdf')
    with pytest.raises(resources.DocumentResourceError):
        email_service._attachment_from_wm_document(doc, 'huge.pdf')


def test_attachment_collection_stops_before_fetching_more(email_service, monkeypatch):
    module = sys.modules[type(email_service).__module__]
    monkeypatch.setattr(module, '__package__', '_wm_resource_test')
    package = ModuleType('_wm_resource_test')
    package.__path__ = []
    models = ModuleType('_wm_resource_test.models')
    models.WMDocument = models.WMScopeInvoice = object
    monkeypatch.setitem(sys.modules, package.__name__, package)
    monkeypatch.setitem(sys.modules, models.__name__, models)
    monkeypatch.setattr(email_service, '_get_slot_overrides', lambda *args: {})
    monkeypatch.setattr(email_service, '_get_invoice_attachment', lambda *args, **kw: {
        'filename': 'invoice.pdf', 'data': b'a' * (8 * resources.MIB),
    })
    monkeypatch.setattr(email_service, '_get_w9_attachment', lambda *args, **kw: {
        'filename': 'w9.pdf', 'data': b'a' * (17 * resources.MIB),
    })
    monkeypatch.setattr(email_service, '_get_sketch_attachment',
                        lambda *args, **kw: pytest.fail('download continued past total limit'))
    with pytest.raises(resources.DocumentResourceError):
        email_service._collect_attachments(
            None, SimpleNamespace(id='test', property_address='Test'),
            ['invoice', 'w9', 'sketch'],
        )


def test_linux_compression_failure_never_decodes_in_server(email_service, monkeypatch):
    cls = type(email_service)
    monkeypatch.setattr(sys, 'platform', 'linux')
    monkeypatch.setattr(cls, '_find_ghostscript', classmethod(lambda cls: '/usr/bin/gs'))
    monkeypatch.setattr(cls, '_compress_pdf_gs', staticmethod(lambda *args: None))
    monkeypatch.setattr(cls, '_compress_pdf_images', lambda *args: pytest.fail('unsafe fallback'))
    assert cls._compress_pdf(b'pdf', cls._COMPRESSION_LEVELS[0]) is None


def test_gs_launch_is_memory_capped_and_cleans_files(email_service, monkeypatch):
    import subprocess
    monkeypatch.setattr(sys, 'platform', 'linux')
    paths = []

    def run(command, **kwargs):
        assert command[0] == sys.executable
        assert 'RLIMIT_AS' in command[2]
        assert kwargs['timeout'] == 120
        source = Path(command[-1])
        destination = Path(next(c.split('=', 1)[1] for c in command if c.startswith('-sOutputFile=')))
        paths.extend([source, destination])
        destination.write_bytes(b'x' * 100)  # Compressor output grew: must not read it.
        return SimpleNamespace(returncode=0, stderr='')

    monkeypatch.setattr(subprocess, 'run', run)
    monkeypatch.setattr(
        sys.modules[type(email_service).__module__], 'read_bounded',
        lambda *args: pytest.fail('must not read larger compressor output'),
    )
    assert email_service._compress_pdf_gs(b'pdf', email_service._COMPRESSION_LEVELS[0], '/usr/bin/gs') is None
    assert all(not path.exists() for path in paths)


def test_b2_oversize_and_stale_length_are_bounded():
    from app.domains.storage.b2_provider import B2Provider
    provider = object.__new__(B2Provider)
    provider.bucket_name = 'test'

    class Body(io.BytesIO):
        def read(self, size=-1):
            assert size == 11
            return super().read(size)

    for reported_size in [100, 0]:
        body = Body(b'x' * 100)
        provider.client = SimpleNamespace(get_object=lambda **kw: {
            'Body': body, 'ContentLength': reported_size,
        })
        with pytest.raises(resources.DocumentResourceError):
            provider.download('test.pdf', max_bytes=10)
        assert body.closed


@pytest.mark.parametrize('version', [1, 2])
def test_container_budget_uses_limit_and_reclaimable_cache(tmp_path, monkeypatch, version):
    root = tmp_path / 'cgroup'
    root.mkdir()
    if version == 2:
        files = {'memory.max': '536870912', 'memory.current': '419430400',
                 'memory.stat': 'inactive_file 52428800\n'}
    else:
        files = {'memory.limit_in_bytes': '536870912', 'memory.usage_in_bytes': '419430400',
                 'memory.stat': 'total_inactive_file 52428800\n'}
    for name, content in files.items():
        (root / name).write_text(content)
    monkeypatch.setattr(resources, 'Path', lambda unused: root)
    assert resources.memory_headroom() == 162 * resources.MIB
