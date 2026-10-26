"""Saving a generated invoice's PDF replaces only that invoice's earlier PDF:
the job's other invoices keep theirs, and uploaded invoices stay."""

from pathlib import Path
from types import SimpleNamespace
import sys
import uuid

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401
from app.domains.staff.models import StaffRole  # noqa: E402

# The routes take the signed-in person; an admin sees every claim
ADMIN = SimpleNamespace(id='00000000-0000-0000-0000-0000000000ad', role=StaffRole.admin)
import app.common.services.pdf_service as pdf_service_module  # noqa: E402
import app.common.utils.storage_helpers as storage_helpers  # noqa: E402
import app.core.database_factory as database_factory  # noqa: E402
import app.domains.invoice.service as invoice_service_module  # noqa: E402
from app.domains.water_mitigation.models import WaterMitigationJob, WMDocument  # noqa: E402
from app.domains.water_mitigation.scope_api import download_invoice_pdf_with_document  # noqa: E402

INV_1 = uuid.UUID('11111111-0000-0000-0000-000000000001')
INV_2 = uuid.UUID('11111111-0000-0000-0000-000000000002')
NUMBERS = {str(INV_1): 'INV-1', str(INV_2): 'INV-2'}


@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(type_, compiler, **kw):
    return 'JSON'


class FakeInvoiceService:
    def __init__(self, database):
        pass

    def get_with_items(self, invoice_id):
        return {'invoice_number': NUMBERS[invoice_id], 'items': []}


class FakePdfService:
    def generate_invoice_pdf(self, pdf_data, path, template_variant='a'):
        Path(path).write_bytes(f"%PDF-{pdf_data['invoice_number']}".encode())
        return path


@pytest.fixture
def env(tmp_path, monkeypatch):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'wm.db'}")
    for model in (WaterMitigationJob, WMDocument):
        model.__table__.create(engine)
    session = sessionmaker(bind=engine)()

    monkeypatch.setattr(database_factory, 'get_database', lambda: None)
    monkeypatch.setattr(invoice_service_module, 'InvoiceService', FakeInvoiceService)
    monkeypatch.setattr(pdf_service_module, 'get_pdf_service', lambda: FakePdfService())
    monkeypatch.setattr(
        storage_helpers, 'upload_bytes_to_storage',
        lambda file_bytes, filename, **kw: {
            'file_path': str(tmp_path / filename), 'file_size': len(file_bytes),
            'storage_provider': 'local', 'storage_file_id': filename,
        },
    )

    job = WaterMitigationJob(property_address='12 Elm St, Springfield')
    session.add(job)
    session.commit()
    yield {'session': session, 'job': job}
    session.close()
    engine.dispose()


def save_pdf(env, invoice_id):
    download_invoice_pdf_with_document(
        job_id=uuid.UUID(str(env['job'].id)), invoice_id=invoice_id,
        template_variant='a', db=env['session'], current_user=ADMIN,
    )


def test_saving_again_replaces_only_that_invoices_pdf(env):
    session = env['session']
    uploaded = WMDocument(
        job_id=env['job'].id, document_type='Invoice', filename='Carrier invoice.pdf',
        file_path='uploads/carrier.pdf', upload_source='manual_upload', is_active=True,
    )
    session.add(uploaded)
    session.commit()

    save_pdf(env, INV_1)
    save_pdf(env, INV_2)
    save_pdf(env, INV_1)

    session.expire_all()
    docs = session.query(WMDocument).all()
    active = [
        (str(d.invoice_id) if d.invoice_id else None, d.filename)
        for d in docs if d.is_active
    ]
    assert len(active) == 3
    assert set(active) == {
        (None, 'Carrier invoice.pdf'),
        (str(INV_1), 'Invoice INV-1 - 12 Elm St.pdf'),
        (str(INV_2), 'Invoice INV-2 - 12 Elm St.pdf'),
    }
    # Only INV-1's first PDF was replaced
    [replaced] = [d for d in docs if not d.is_active]
    assert str(replaced.invoice_id) == str(INV_1)
