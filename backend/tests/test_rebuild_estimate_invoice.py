"""A Rebuild project's invoice made from the carrier's estimate
(rebuild/estimate_invoice.py): one line per room at its RCV, the deductible,
prior payments and ACV payment as payments received, dated the day the work
was completed."""
import sqlite3
import sys
import uuid
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.domains.rebuild.estimate_invoice import (  # noqa: E402
    ADJUSTMENT_LINE, billed_areas, invoice_plan, line_amount,
)

SUMMARY = "\n".join([
    "Summary for Dwelling",
    "Line Item Total 2,300.00",
    "Overhead 100.00",
    "Profit 100.00",
    "Replacement Cost Value $2,500.00",
    "Less Depreciation (500.00)",
    "Actual Cash Value $2,000.00",
    "Less Deductible (1,000.00)",
    "Less Prior Payments (300.00)",
    "Net Claim $700.00",
])


def item(desc, rcv):
    return {"description": desc, "rcv": rcv}


def estimate(page_texts=(SUMMARY,)):
    return {
        "standalone_sections": [],
        "levels": [{"name": "Main Level", "rooms": [
            {"name": "Kitchen", "line_items": [
                item("R&R Cabinetry - lower (base) units", 1200.00),
                item("Detach & Reset Countertop - flat laid plastic laminate", 300.00),
                item("Air mover (per 24 hour period)", 90.00),
            ]},
            {"name": "Family Room", "line_items": [item("R&R Carpet", 500.00)]},
            {"name": "Subroom: Closet (1)", "line_items": [item("R&R Carpet", 100.00)]},
        ]}],
        "appendix_sections": [
            {"name": "Debris Removal", "line_items": [item("Haul debris - per pickup truck load", 150.00)]},
            {"name": "Labor Minimums Applied", "line_items": [item("Drywall labor minimum", 250.00)]},
        ],
        "_page_texts": list(page_texts),
    }


def test_a_line_is_priced_at_its_rcv_else_quantity_times_price():
    assert line_amount({"rcv": 12.5}) == 12.5
    assert line_amount({"quantity": 10, "unit_price": 2.0, "tax": 1.0, "op": 3.0}) == 24.0


def test_one_line_per_room_with_its_scope_and_rcv():
    lines = billed_areas(estimate())
    assert lines == [
        {"name": "Kitchen", "description": "Replace cabinets, Detach & reset countertop", "amount": 1500.00},
        # The closet (a subroom) with its room; drying equipment left out
        {"name": "Family Room", "description": "Replace carpet", "amount": 600.00},
        # Debris is billed though the scope doesn't list it; labor minimums
        # applied are a listing of lines already in the rooms
        {"name": "Debris Removal", "description": "", "amount": 150.00},
    ]


def test_the_total_is_the_rcv_and_the_acv_is_received_as_payments():
    plan = invoice_plan(estimate())
    # The rooms come to 2,250; O&P on the summary is the rest of the RCV
    assert plan["lines"][-1] == {"name": ADJUSTMENT_LINE, "description": "", "amount": 250.00}
    assert plan["total"] == 2500.00
    assert plan["payments"] == [
        {"label": "Deductible", "amount": 1000.00},
        {"label": "Prior payments", "amount": 300.00},
        {"label": "ACV payment", "amount": 700.00},
    ]
    # What the carrier still owes: the depreciation
    assert plan["balance_due"] == 500.00
    assert plan["warnings"] == []


def test_without_a_summary_the_revisions_saved_figures_are_used():
    neg = SimpleNamespace(rcv_amount=2250.0, acv_amount=1800.0, deductible=500.0)
    plan = invoice_plan(estimate(page_texts=("",)), neg)
    assert plan["total"] == 2250.00
    assert plan["payments"] == [{"label": "Deductible", "amount": 500.00}, {"label": "ACV payment", "amount": 1300.00}]
    assert plan["balance_due"] == 450.00
    assert plan["warnings"]


def test_without_any_figures_the_lines_are_the_total_and_nothing_is_paid():
    plan = invoice_plan(estimate(page_texts=("",)))
    assert plan["total"] == 2250.00
    assert plan["payments"] == []
    assert plan["balance_due"] == 2250.00
    assert "couldn't be read" in plan["warnings"][0]


# ---------------------------------------------------------------------------
# Made on a project: a real invoice, its PDF as the Invoice completion doc
# ---------------------------------------------------------------------------

def _end_to_end_imports():
    import sqlalchemy as sa
    from sqlalchemy.dialects.postgresql import JSONB
    from sqlalchemy.dialects.sqlite import base as sqlite_base
    from sqlalchemy.ext.compiler import compiles

    import app.main  # noqa: F401  registers every model
    return sa, JSONB, sqlite_base, compiles


@pytest.fixture
def env(tmp_path, monkeypatch):
    from datetime import datetime

    sa, JSONB, sqlite_base, compiles = _end_to_end_imports()
    from app.core import database_factory
    from app.core.database_factory import Base, SQLiteDatabase
    from app.domains.client.models import Claim, ClaimNegotiation, Client
    from app.domains.company.models import Company
    from app.domains.contract.models import ClaimCompany
    from app.domains.file.models import File as FileRecord
    from app.domains.insurance_extraction.service import InsuranceExtractionService
    from app.domains.invoice.models import Invoice, InvoiceItem, InvoiceRevision
    from app.domains.invoice.service import InvoiceService
    from app.domains.rebuild import api as rebuild_api
    from app.domains.rebuild.models import RebuildCompletionDoc, RebuildContractor, RebuildProject
    from app.domains.rebuild.service import RebuildService
    from app.domains.staff.models import Staff, StaffRole

    @compiles(JSONB, 'sqlite')
    def _jsonb(type_, compiler, **kw):
        return 'JSON'

    sqlite3.register_adapter(uuid.UUID, str)
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
    sa.event.listen(database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF'))
    tables = [Staff, Company, ClaimCompany, Client, Claim, ClaimNegotiation, FileRecord, Invoice, InvoiceItem,
              InvoiceRevision, RebuildContractor, RebuildProject, RebuildCompletionDoc]
    Base.metadata.create_all(database.engine, tables=[m.__table__ for m in tables])
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)
    monkeypatch.setattr(rebuild_api, '_get_service', lambda: RebuildService(database=database))
    monkeypatch.setattr(rebuild_api, '_require_project', lambda *a: None)
    monkeypatch.setattr(rebuild_api, '_require_doc', lambda *a: None)
    monkeypatch.setattr(InsuranceExtractionService, '_resolve_pdf_path', lambda self, url, provider=None: (url, None))
    monkeypatch.setattr(InvoiceService, 'generate_invoice_number', lambda self, company_id=None: {'invoice_number': 'MJ-2026-0042'})
    stored = {}

    def fake_upload(file_bytes, filename, **kw):
        stored['pdf'], stored['filename'] = file_bytes, filename
        return {'file_url': f'local/{filename}'}
    monkeypatch.setattr('app.common.utils.storage_helpers.upload_bytes_to_storage', fake_upload)

    s = database.get_session()
    boss = Staff(staff_number='BOSS', first_name='Boss', last_name='Tester', email='boss@example.com',
                 role=StaffRole.super_admin, hire_date=datetime(2026, 1, 1), username='boss',
                 is_active=True, can_login=True)
    company = Company(name='MJ Rebuild', company_type='contractor', address='1 Main St', city='Fairfax',
                      state='VA', zipcode='22030')
    client = Client(display_name='Pat Homeowner', owners=[], address='12 Oak St', city='Fairfax',
                    state='VA', zipcode='22030')
    for row in [boss, company, client]:
        s.add(row)
    s.flush()
    claim = Claim(client_id=client.id, claim_number='CLM-0042', insurance_company='State Farm',
                  insurance_policy_number='POL-7')
    s.add(claim)
    s.flush()
    s.add(ClaimCompany(claim_id=claim.id, company_id=company.id, role='reconstruction'))
    project = RebuildProject(claim_id=claim.id, title='Rebuild - 12 Oak St', status='completed',
                             property_address='12 Oak St, Fairfax, VA 22030')
    s.add(project)
    s.commit()
    env = SimpleNamespace(db=s, project=project, claim=claim, boss=boss, company=company,
                          stored=stored, tmp=tmp_path, api=rebuild_api)
    yield env
    s.close()


def add_estimate_pdf(env, rev=3):
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    from app.domains.client.models import ClaimNegotiation
    from app.domains.file.models import File as FileRecord

    header = "DESCRIPTION QUANTITY UNIT PRICE TAX O&P RCV DEPREC. ACV"
    lines = [
        "Insured: Pat Homeowner", "Claim Number: CLM-0042", "",
        "Main Level", "Kitchen Height: 8'", header,
        "1. R&R Cabinetry - lower (base) units 12.00 LF 90.00 20.00 100.00 1,200.00 0.00 1,200.00",
        "2. Detach & Reset Countertop - flat laid plastic laminate 20.00 SF 12.00 10.00 50.00 300.00 0.00 300.00",
        "Totals: Kitchen 30.00 150.00 1,500.00 0.00 1,500.00",
        "Family Room Height: 8'", header,
        "3. R&R Carpet 40.00 SF 13.00 20.00 60.00 600.00 0.00 600.00",
        "Totals: Family Room 20.00 60.00 600.00 0.00 600.00",
        "", *SUMMARY.replace("2,500.00", "2,350.00").replace("2,300.00", "2,100.00").split("\n"),
    ]
    path = env.tmp / f"estimate-rev{rev}.pdf"
    c = canvas.Canvas(str(path), pagesize=letter)
    y = 750
    for ln in lines:
        c.setFont("Helvetica", 8)
        c.drawString(30, y, ln)
        y -= 14
    c.save()
    rec = FileRecord(id=str(uuid.uuid4()), filename=path.name, original_name=path.name,
                     content_type='application/pdf', size=path.stat().st_size, context='negotiation',
                     context_id=str(env.claim.id), category='insurance_estimate', url=str(path),
                     storage_provider='local', is_active=True)
    neg = ClaimNegotiation(id=uuid.uuid4(), claim_id=env.claim.id, revision_number=rev,
                           revision_type='supplement', estimate_category='reconstruction',
                           document_url=rec.id, document_name=rec.original_name)
    for row in [rec, neg]:
        env.db.add(row)
    env.db.commit()
    return neg


def test_the_preview_says_what_the_invoice_will(env):
    from app.domains.rebuild.schemas import RebuildInvoiceRequest

    add_estimate_pdf(env)
    plan = env.api.preview_invoice_from_estimate(
        project_id=str(env.project.id), data=RebuildInvoiceRequest(), db=env.db, current_staff=env.boss)
    assert [(line["name"], line["amount"]) for line in plan["lines"]] == [
        ("Kitchen", 1500.00), ("Family Room", 600.00), (ADJUSTMENT_LINE, 250.00),
    ]
    assert plan["total"] == 2350.00
    assert plan["balance_due"] == 350.00
    assert plan["source"]["label"] == "Rev #3 · Supplement · Reconstruction"


def test_the_invoice_is_made_dated_the_completion_day_and_kept_as_its_pdf(env):
    from app.domains.invoice.models import Invoice, InvoiceItem
    from app.domains.rebuild.models import RebuildCompletionDoc
    from app.domains.rebuild.schemas import RebuildInvoiceRequest

    add_estimate_pdf(env)
    doc = env.api.create_invoice_from_estimate(
        project_id=str(env.project.id),
        data=RebuildInvoiceRequest(completion_date=date(2026, 11, 20)),
        db=env.db, current_staff=env.boss,
    )
    env.db.commit()

    assert doc.doc_type == "invoice"
    assert doc.title == "Invoice MJ-2026-0042"
    assert doc.status == "final"
    assert env.stored["pdf"].startswith(b"%PDF")
    assert env.stored["filename"] == "12 Oak St, Fairfax, VA 22030 - Invoice MJ-2026-0042.pdf"

    invoice = env.db.query(Invoice).filter(Invoice.id == str(doc.invoice_id)).one()
    assert invoice.invoice_date.date() == date(2026, 11, 20)
    assert str(invoice.claim_id) == str(env.claim.id)
    assert str(invoice.company_id) == str(env.company.id)
    assert invoice.insurance_company == "State Farm"
    assert invoice.insurance_claim_number == "CLM-0042"
    assert float(invoice.total_amount) == 2350.00
    assert [(p["reference"], p["amount"]) for p in invoice.payments] == [
        ("Deductible", 1000.00), ("Prior payments", 300.00), ("ACV payment", 700.00),
    ]
    assert float(invoice.balance_due) == 350.00
    items = env.db.query(InvoiceItem).filter(InvoiceItem.invoice_id == invoice.id).order_by(InvoiceItem.order_index).all()
    assert [(i.name, i.description, float(i.amount)) for i in items] == [
        ("Kitchen", "Kitchen: Replace cabinets, Detach & reset countertop", 1500.00),
        ("Family Room", "Family Room: Replace carpet", 600.00),
        (ADJUSTMENT_LINE, ADJUSTMENT_LINE, 250.00),
    ]
    # The invoice calls each payment what it is
    assert [p["label"] for p in invoice.payments] == ["Deductible", "Prior payments", "ACV payment"]

    env.db.refresh(env.project)
    assert env.project.actual_completion.date() == date(2026, 11, 20)
    assert float(env.project.final_invoice_amount) == 2350.00
    assert env.db.query(RebuildCompletionDoc).count() == 1


def test_without_a_completion_date_it_asks_for_one(env):
    from fastapi import HTTPException

    from app.domains.rebuild.schemas import RebuildInvoiceRequest

    add_estimate_pdf(env)
    with pytest.raises(HTTPException) as e:
        env.api.create_invoice_from_estimate(
            project_id=str(env.project.id), data=RebuildInvoiceRequest(), db=env.db, current_staff=env.boss)
    assert e.value.status_code == 400


def test_without_a_company_to_issue_it_says_so(env):
    from fastapi import HTTPException

    from app.domains.contract.models import ClaimCompany
    from app.domains.rebuild.schemas import RebuildInvoiceRequest

    env.db.query(ClaimCompany).delete()
    env.db.commit()
    add_estimate_pdf(env)
    with pytest.raises(HTTPException) as e:
        env.api.create_invoice_from_estimate(
            project_id=str(env.project.id), data=RebuildInvoiceRequest(completion_date=date(2026, 11, 20)),
            db=env.db, current_staff=env.boss)
    assert e.value.status_code == 422
    assert "reconstruction company" in e.value.detail


def test_the_pdf_is_printed_again_after_the_invoice_is_edited(env):
    from app.domains.invoice.models import Invoice
    from app.domains.rebuild.schemas import RebuildInvoiceRequest

    add_estimate_pdf(env)
    doc = env.api.create_invoice_from_estimate(
        project_id=str(env.project.id), data=RebuildInvoiceRequest(completion_date=date(2026, 11, 20)),
        db=env.db, current_staff=env.boss)
    env.db.commit()
    env.db.query(Invoice).filter(Invoice.id == str(doc.invoice_id)).update({"invoice_number": "MJ-2026-0043"})
    env.db.commit()

    again = env.api.refresh_invoice_pdf(
        project_id=str(env.project.id), doc_id=str(doc.id), db=env.db, current_staff=env.boss)
    assert again.title == "Invoice MJ-2026-0043"
    assert env.stored["filename"].endswith(" - Invoice MJ-2026-0043.pdf")
