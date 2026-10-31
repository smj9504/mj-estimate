"""Deleting a client takes everything linked to it and no one else's records, and only
an admin may do it. Run through the API on a throwaway SQLite database, foreign keys on."""

from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
import sqlite3
import sys
from types import SimpleNamespace
import uuid

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.dialects.postgresql import ARRAY, INET, JSONB, UUID as PG_UUID
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.database_factory import Base, get_db_session  # noqa: E402
from app.domains.acculynx_archive.models import AccuLynxArchivedDocument, AccuLynxArchivedJob  # noqa: E402
from app.domains.auth import company_scope  # noqa: E402
from app.domains.auth.dependencies import get_current_staff  # noqa: E402
from app.domains.bathroom_estimate.models import BathroomEstimate  # noqa: E402
from app.domains.cabinet_estimate.models import CabinetEstimate  # noqa: E402
from app.domains.claim_followup.models import CommunicationLog, FollowUpTask, SentEmail  # noqa: E402
from app.domains.client import client_delete  # noqa: E402
from app.domains.client.models import (  # noqa: E402
    Claim, ClaimActivity, ClaimExpense, ClaimNegotiation, ClaimNote, ClaimPayment, ClaimTodo, ClaimTodoAssignee, Client,
)
from app.domains.contract.models import ClaimCompany, ContractInstance, ContractSignature, ContractTemplate  # noqa: E402
from app.domains.credit.models import AppliedDiscount, CreditTransaction, CustomerCredit  # noqa: E402
from app.domains.crew_upload.models import UploadLink, UploadSession  # noqa: E402
from app.domains.document_transfer.models import DocumentTransfer  # noqa: E402
from app.domains.document_types.models import WorkOrderDocumentType, WorkOrderTrade  # noqa: E402
from app.domains.electrician_report.models import ElectricianReport  # noqa: E402
from app.domains.email_ingestion.models import EmailIngestionLog, ReceivedEmail  # noqa: E402
from app.domains.estimate.models import Estimate, EstimateItem  # noqa: E402
from app.domains.file.models import File  # noqa: E402
from app.domains.integrations.models import CompanyCamPhoto  # noqa: E402
from app.domains.invoice.models import Invoice, InvoiceItem  # noqa: E402
from app.domains.material_order.models import MaterialOrder, MaterialOrderItem  # noqa: E402
from app.domains.pack_calculation.models import PackCalculation, PackingPhoto, PackItem, PackRoom  # noqa: E402
from app.domains.payment.models import BillingSchedule, Payment, PaymentRefund  # noqa: E402
from app.domains.plumber_report.models import PlumberReport  # noqa: E402
from app.domains.plumber_report.templates.models import PlumberReportTemplateUsage  # noqa: E402
from app.domains.rebuild.models import RebuildCompletionDoc, RebuildProject  # noqa: E402
from app.domains.receipt.models import Receipt  # noqa: E402
from app.domains.roofing_estimate.models import RoofingEstimate  # noqa: E402
from app.domains.siding_estimate.models import SidingEstimate  # noqa: E402
from app.domains.sketch.models import Fixture, Measurement, Room, Sketch, Wall  # noqa: E402
from app.domains.staff.models import StaffRole  # noqa: E402
from app.domains.storage.factory import StorageFactory  # noqa: E402
from app.domains.supplement.models import BidItemEstimate, SupplementFollowUp, SupplementRequest  # noqa: E402
from app.domains.water_mitigation.models import (  # noqa: E402
    PhotoCategory, WaterMitigationJob, WMDocument, WMDocumentSlotOverride, WMJobStatusHistory, WMPhoto, WMPhotoCategory,
)
from app.domains.water_mitigation.sketch_models import WMFloorSketch  # noqa: E402
from app.domains.work_order.models import WorkOrder, WorkOrderStaffAssignment  # noqa: E402
from app.main import app  # noqa: E402

sqlite3.register_adapter(uuid.UUID, str)


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


SHARED_PHOTO = 'water-mitigation/shared/photos/both-jobs.webp'
SAME_NAME = 'Pat Shared Name'


def blank(model, **given):
    """A row with throwaway values in every required column"""
    values = dict(given)
    for column in sa.inspect(model).columns:
        if column.key in values or column.primary_key or column.nullable:
            continue
        if column.default is not None or column.server_default is not None:
            continue
        kind = column.type
        if column.foreign_keys or type(kind).__name__ in ('UUIDType', 'UUID'):
            values[column.key] = uuid.uuid4() if getattr(kind, 'as_uuid', False) else str(uuid.uuid4())
        elif isinstance(kind, sa.Enum):
            values[column.key] = next(iter(kind.enum_class)) if kind.enum_class else kind.enums[0]
        else:
            # Different every time, for the columns that must be unique
            text = uuid.uuid4().hex[:8]
            values[column.key] = {
                str: text, int: 0, float: 0.0, bool: False, Decimal: Decimal(0), dict: {}, list: [],
                datetime: datetime(2026, 1, 1), date: date(2026, 1, 1),
            }.get(kind.python_type, text)
    return model(**values)


def seed_client(session, label, shared_report_id=None):
    """A client with a row in every kind of table that hangs off one. Returns the client,
    every row made, and the keys of its stored files that are on no one else's records."""
    made = []

    def add(model, **values):
        row = blank(model, **values)
        session.add(row)
        session.flush()
        made.append((model, sa.inspect(row).identity))
        return row

    client = add(Client, display_name=label, owners=[])
    add(AccuLynxArchivedDocument, archived_job_id=add(
        AccuLynxArchivedJob, client_id=client.id, acculynx_job_id=f'{label}-job',
    ).id, acculynx_file_id=f'{label}-file')

    only_ours = add(PlumberReport)
    electric = add(ElectricianReport)
    claim = add(
        Claim, client_id=client.id, plumber_report_id=only_ours.id, electrician_report_id=electric.id,
        insurance_estimate_file_id=None,
    )
    second_claim = add(Claim, client_id=client.id, plumber_report_id=shared_report_id)
    add(PlumberReportTemplateUsage, report_id=only_ours.id)

    def stored_file(context, context_id, **values):
        key = f'{context}/{label}/{uuid.uuid4()}.pdf'
        row = add(
            File, context=context, context_id=str(context_id), url=f'b2://bucket/{key}',
            storage_provider='b2', **values,
        )
        return row, key

    keys = []
    for context, context_id in (
        ('negotiation', claim.id), ('claim-negotiation', claim.id), ('electrician-report', electric.id),
    ):
        keys.append(stored_file(context, context_id)[1])

    # Files found by the column that points at them, whatever context they were uploaded under
    def file_id():
        row, key = stored_file('contractor_portal', 'check_photo')
        keys.append(key)
        return row.id

    claim.insurance_estimate_file_id = file_id()
    claim.wm_estimate_file_id = file_id()
    add(ClaimNegotiation, claim_id=claim.id, document_url=file_id())
    add(ClaimExpense, claim_id=claim.id, receipt_file_id=file_id())
    add(ClaimPayment, claim_id=claim.id, check_photo_file_id=file_id())
    add(PackingPhoto, claim_id=claim.id, photo_id=file_id())
    add(ClaimNote, claim_id=claim.id)
    add(ClaimActivity, claim_id=claim.id)
    add(ClaimCompany, claim_id=claim.id, company_id=str(uuid.uuid4()))

    supplement = add(SupplementRequest, claim_id=claim.id, document_file_id=file_id())
    bid = add(BidItemEstimate, supplement_id=supplement.id, custom_document_file_id=file_id())
    add(SupplementFollowUp, supplement_id=supplement.id, reply_attachment_ids=[file_id()])
    keys.append(stored_file('supplement', supplement.id)[1])
    keys.append(stored_file('supplement_bid_item', bid.id)[1])

    task = add(FollowUpTask, claim_id=claim.id)
    keys.append(stored_file('insurance_estimate', task.id)[1])
    keys.append(stored_file('wm_estimate', task.id)[1])
    sent = add(SentEmail, claim_id=claim.id, followup_task_id=task.id)
    add(CommunicationLog, claim_id=claim.id, followup_task_id=task.id, sent_email_id=sent.id)

    project = add(RebuildProject, claim_id=claim.id)
    rebuilt = f'rebuild/{label}/coc.pdf'
    keys.append(rebuilt)
    add(RebuildCompletionDoc, project_id=project.id, file_url=f'b2://bucket/{rebuilt}')

    # A water mitigation job and what sits under it
    job = add(WaterMitigationJob, claim_id=claim.id)
    keys.append(stored_file('water-mitigation', job.id)[1])
    photo_key = f'water-mitigation/{label}/photos/own.webp'
    keys.append(photo_key)
    photo = add(WMPhoto, job_id=job.id, storage_provider='b2', storage_file_id=photo_key)
    # The category is a shared list entry, and stays
    category = blank(PhotoCategory)
    session.add(category)
    session.flush()
    add(WMPhotoCategory, photo_id=photo.id, category_id=category.id)
    add(WMPhoto, job_id=job.id, storage_provider='b2', storage_file_id=SHARED_PHOTO)
    # A sketch background kept in the database has nothing in storage
    add(WMFloorSketch, job_id=job.id, storage_provider='db')
    document_key = f'water-mitigation/{label}/documents/own.pdf'
    keys.append(document_key)
    document = add(
        WMDocument, job_id=job.id, storage_provider='b2', storage_file_id=document_key,
        source_storage_file_id='contracts/template/templates/shared-template.pdf',
    )
    add(WMDocumentSlotOverride, job_id=job.id, document_id=document.id)
    add(WMJobStatusHistory, job_id=job.id)
    add(UploadSession, link_id=add(UploadLink, context='water-mitigation', context_id=job.id).id)
    add(CompanyCamPhoto, water_mitigation_job_id=job.id, companycam_photo_id=f'{label}-cc', companycam_project_id='p')

    # Contracts, on the claim and on the client directly
    signed_key = f'contracts/{label}/signed.pdf'
    keys.append(signed_key)
    contract = add(
        ContractInstance, claim_id=claim.id, client_id=client.id, status='signed',
        signed_pdf_url=f'b2://bucket/{signed_key}', signed_pdf_provider='b2',
        filled_pdf_url='b2://bucket/contracts/template/templates/shared-template.pdf', filled_pdf_provider='b2',
    )
    add(ContractSignature, contract_instance_id=contract.id)
    add(ContractInstance, client_id=client.id)

    # Todos: on a contract, on a claim, and on the client with no claim
    add(ClaimTodo, claim_id=claim.id, contract_id=contract.id)
    add(ClaimTodoAssignee, todo_id=add(ClaimTodo, claim_id=second_claim.id).id, staff_id=str(uuid.uuid4()))
    add(ClaimTodo, client_id=client.id)

    # Money documents, linked to the client alone and to the claim alone
    invoice = add(Invoice, client_id=client.id)
    add(InvoiceItem, invoice_id=invoice.id)
    add(Receipt, invoice_id=invoice.id)
    add(Invoice, claim_id=claim.id)
    keys.append(stored_file('invoice', invoice.id)[1])
    estimate = add(Estimate, claim_id=claim.id)
    add(EstimateItem, estimate_id=estimate.id)
    add(DocumentTransfer, document_type='estimate', source_id=estimate.id)
    add(DocumentTransfer, document_type='invoice', source_id=invoice.id)

    sketch = add(Sketch, estimate_id=estimate.id)
    room = add(Room, sketch_id=sketch.id)
    add(Fixture, room_id=room.id, wall_id=add(Wall, room_id=room.id).id)
    add(Measurement, sketch_id=sketch.id)
    add(Sketch, invoice_id=invoice.id)

    work_order = add(WorkOrder, client_id=client.id)
    add(Sketch, work_order_id=work_order.id)
    order_key = uuid.UUID(str(work_order.id))
    add(WorkOrderStaffAssignment, work_order_id=order_key)
    add(WorkOrderDocumentType, work_order_id=order_key)
    add(WorkOrderTrade, work_order_id=order_key)
    add(BillingSchedule, work_order_id=order_key)
    add(PaymentRefund, payment_id=add(Payment, work_order_id=order_key).id)
    credit = add(CustomerCredit, work_order_id=order_key)
    add(AppliedDiscount, work_order_id=order_key, customer_credit_id=credit.id)
    add(CreditTransaction, customer_credit_id=credit.id)

    # A restoration on the claim, and an option in its group with no claim of its own
    for model in (CabinetEstimate, BathroomEstimate):
        restore = add(model, claim_id=claim.id)
        restore.group_id = restore.id
        add(model, group_id=restore.id, claim_id=None, kind='option')
    add(RoofingEstimate, claim_id=claim.id)
    add(SidingEstimate, claim_id=claim.id)
    add(MaterialOrderItem, order_id=add(MaterialOrder, claim_id=claim.id).id)
    pack = add(PackCalculation, claim_id=claim.id, client_id=client.id)
    add(PackItem, room_id=add(PackRoom, calculation_id=pack.id).id)

    add(ReceivedEmail, matched_client_id=client.id, message_id=f'{label}-m1')
    add(ReceivedEmail, matched_wm_job_id=job.id, message_id=f'{label}-m2')
    log_file, log_key = stored_file('email-ingestion', 'account')
    keys.append(log_key)
    log = blank(
        EmailIngestionLog, matched_client_id=client.id, matched_claim_id=claim.id, status='pending',
        file_id=log_file.id, message_id=f'{label}-m3', attachment_hash=f'{label}-hash',
    )
    session.add(log)
    session.flush()

    return SimpleNamespace(client=client, made=made, keys=keys, log_id=log.id)


def seed_everyone(session):
    """Pat is deleted in these tests. Sam shares a photo and a plumber report with Pat, and an
    invoice elsewhere merely has Pat's name on it: all of those must still be there after."""
    shared_report = blank(PlumberReport)
    session.add(blank(ContractTemplate, file_url='b2://bucket/contracts/template/templates/shared-template.pdf'))
    session.add(shared_report)
    session.flush()
    pat = seed_client(session, 'Pat', shared_report_id=shared_report.id)
    sam = seed_client(session, 'Sam', shared_report_id=shared_report.id)
    bystander = blank(Invoice, client_name=SAME_NAME, client_id=None, claim_id=None)
    session.add(bystander)
    session.flush()
    sam.made.append((PlumberReport, shared_report.id))
    sam.made.append((Invoice, bystander.id))
    return SimpleNamespace(pat=pat, sam=sam)


def missing(session, rows):
    return [(model.__name__, row_id) for model, row_id in rows if session.get(model, row_id) is None]


def present(session, rows):
    return [(model.__name__, row_id) for model, row_id in rows if session.get(model, row_id) is not None]


class FakeStorage:
    def __init__(self):
        self.deleted = []

    def delete(self, key):
        self.deleted.append(key)
        return True


@pytest.fixture
def db():
    engine = sa.create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread': False})
    sa.event.listen(
        engine, 'connect',
        lambda conn, _: conn.create_function('gen_random_uuid', 0, lambda: str(uuid.uuid4())),
    )
    with engine.connect() as connection:
        # A few tables use types SQLite can't make; nothing here touches those
        for table in Base.metadata.sorted_tables:
            try:
                table.create(connection, checkfirst=True)
            except Exception:
                pass
        # It points at one of those tables, and the delete has to clear it
        connection.exec_driver_sql("""
            CREATE TABLE IF NOT EXISTS plumber_report_template_usage (
                id VARCHAR(36) PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                template_id VARCHAR(36),
                used_by VARCHAR(36),
                used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                report_id VARCHAR(36) REFERENCES plumber_reports (id)
            )
        """)
        connection.commit()
        connection.exec_driver_sql('PRAGMA foreign_keys=OFF')
    with Session(engine) as session:
        yield session
    engine.dispose()


@pytest.fixture
def world(db):
    everyone = seed_everyone(db)
    db.commit()
    db.connection().exec_driver_sql('PRAGMA foreign_keys=ON')
    db.commit()
    return everyone


@pytest.fixture
def storage(monkeypatch):
    fake = FakeStorage()
    monkeypatch.setattr(StorageFactory, 'create', lambda provider=None: fake)
    return fake


@pytest.fixture
def api(db):
    def use_db():
        yield db

    def as_role(role):
        app.dependency_overrides[get_current_staff] = lambda: SimpleNamespace(id=str(uuid.uuid4()), role=role)
        return TestClient(app, raise_server_exceptions=False)

    app.dependency_overrides[get_db_session] = use_db
    yield as_role
    app.dependency_overrides.pop(get_db_session, None)
    app.dependency_overrides.pop(get_current_staff, None)


def test_every_linked_record_goes(world, db, api, storage):
    response = api(StaffRole.admin).delete(f'/api/clients/{world.pat.client.id}')

    assert response.status_code == 200, response.text
    db.expire_all()
    assert present(db, world.pat.made) == []


def test_other_clients_records_stay(world, db, api, storage):
    api(StaffRole.admin).delete(f'/api/clients/{world.pat.client.id}')

    db.expire_all()
    assert missing(db, world.sam.made) == []


def test_stored_files_go_except_ones_others_use(world, db, api, storage):
    api(StaffRole.admin).delete(f'/api/clients/{world.pat.client.id}')

    gone = {client_delete._blob_path(key) for key in storage.deleted}
    assert gone == set(world.pat.keys)
    # On Sam's job too
    assert SHARED_PHOTO not in gone
    # Pointed at by a contract, but it is the template's PDF
    assert 'contracts/template/templates/shared-template.pdf' not in gone


def test_email_log_stays_to_stop_the_mail_being_queued_again(world, db, api, storage):
    api(StaffRole.admin).delete(f'/api/clients/{world.pat.client.id}')

    db.expire_all()
    log = db.get(EmailIngestionLog, world.pat.log_id)
    assert log.message_id == 'Pat-m3'
    assert log.attachment_hash == 'Pat-hash'
    assert log.status == 'skipped'
    assert log.file_id is None
    assert log.matched_client_id is None
    assert log.matched_claim_id is None


@pytest.mark.parametrize('role', [StaffRole.staff, StaffRole.manager, StaffRole.supervisor])
def test_only_admins_may_delete_or_preview(world, db, api, storage, monkeypatch, role):
    # Someone who can see the client: anyone else is already turned away with a 404
    monkeypatch.setattr(company_scope, 'require_client', lambda *args, **kwargs: None)
    client = api(role)

    assert client.delete(f'/api/clients/{world.pat.client.id}').status_code == 403
    assert client.get(f'/api/clients/{world.pat.client.id}/delete-preview').status_code == 403
    db.expire_all()
    assert missing(db, world.pat.made) == []
    assert storage.deleted == []


@pytest.mark.parametrize('role', [StaffRole.admin, StaffRole.super_admin])
def test_admin_roles_may_delete(world, api, storage, role):
    response = api(role).delete(f'/api/clients/{world.pat.client.id}')

    assert response.status_code == 200, response.text


def test_preview_says_what_goes(world, api, storage):
    response = api(StaffRole.admin).get(f'/api/clients/{world.pat.client.id}/delete-preview')

    assert response.status_code == 200, response.text
    items = {item['label']: item['count'] for item in response.json()['items']}
    assert items['Claims and cash jobs'] == 2
    assert items['Water mitigation jobs'] == 1
    assert items['Contracts'] == 2
    assert items['Invoices'] == 2
    # General, two cabinet, two bathroom, roofing, siding
    assert items['Estimates'] == 7
    assert items['Work orders'] == 1
    assert items['AccuLynx archived jobs'] == 1
    # Sent on the claim, plus received on the client and on the job
    assert items['Emails'] == 3


def test_preview_leaves_out_what_a_client_does_not_have(db, api):
    client = blank(Client, display_name='Nothing Linked', owners=[])
    db.add(client)
    db.commit()

    response = api(StaffRole.admin).get(f'/api/clients/{client.id}/delete-preview')

    assert response.json() == {'items': []}


@pytest.mark.parametrize('method,suffix', [('delete', ''), ('get', '/delete-preview')])
def test_unknown_client_is_not_found(db, api, method, suffix):
    response = getattr(api(StaffRole.admin), method)(f'/api/clients/{uuid.uuid4()}{suffix}')

    assert response.status_code == 404


def test_a_failed_delete_keeps_everything(world, db, api, storage, monkeypatch):
    def fail(*args):
        raise RuntimeError('Something went wrong late in the delete')

    monkeypatch.setattr(client_delete, '_not_used_elsewhere', fail)

    response = api(StaffRole.admin).delete(f'/api/clients/{world.pat.client.id}')

    assert response.status_code == 500
    db.expire_all()
    assert missing(db, world.pat.made) == []
    assert storage.deleted == []
