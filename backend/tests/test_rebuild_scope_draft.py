"""Rebuild project: a scope of work drafted from the claim's insurance
estimate PDF (POST /rebuild/projects/{id}/scope-draft), on in-memory SQLite
and Xactimate-style PDFs written here."""
import sqlite3
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: F401  registers every model
from app.domains.client.models import Claim, ClaimNegotiation, Client
from app.domains.file.models import File as FileRecord
from app.domains.insurance_extraction.service import InsuranceExtractionService
from app.domains.rebuild import api as rebuild_api
from app.domains.rebuild.models import RebuildContractor, RebuildProject
from app.domains.rebuild.schemas import RebuildScopeDraftRequest
from app.domains.rebuild.service import RebuildService


@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(type_, compiler, **kw):
    return 'JSON'


sqlite3.register_adapter(uuid.UUID, str)

HEADER = "DESCRIPTION QUANTITY UNIT PRICE TAX O&P RCV DEPREC. ACV"
KITCHEN = [
    "Main Level",
    "Kitchen Height: 8'",
    HEADER,
    '1. R&R 1/2" drywall - hung, taped, floated, ready for paint 120.00 SF 2.50 3.00 60.00 363.00 0.00 363.00',
    "2. Paint the ceiling - two coats 140.00 SF 1.00 2.00 28.00 170.00 0.00 170.00",
    "3. Air mover (per 24 hour period) 6.00 DA 25.00 0.00 30.00 180.00 0.00 180.00",
    "Totals: Kitchen 5.00 118.00 713.00 0.00 713.00",
]
BATHROOM = [
    "Main Level",
    "Bathroom Height: 8'",
    HEADER,
    "1. Detach & Reset Toilet 1.00 EA 220.00 0.00 44.00 264.00 0.00 264.00",
    "Totals: Bathroom 0.00 44.00 264.00 0.00 264.00",
]


def mirror(text):
    """A font that prints each character at 288 minus its code ('S' as 'Í')"""
    return "".join(chr(288 - ord(c)) if "!" <= c <= "~" else c for c in text)


def write_mirrored_pdf(path: Path, lines) -> Path:
    import pymupdf

    doc = pymupdf.open()
    page = doc.new_page()
    y = 72
    for ln in lines:
        page.insert_text((36, y), mirror(ln), fontsize=8)
        y += 14
    doc.save(str(path))
    doc.close()
    return path


def write_pdf(path: Path, lines) -> Path:
    c = canvas.Canvas(str(path), pagesize=letter)
    y = 750
    for ln in ["Insured: Pat Homeowner", "Claim Number: CLM-1", "", *lines]:
        c.setFont("Helvetica", 8)
        c.drawString(30, y, ln)
        y -= 14
    c.save()
    return path


@pytest.fixture
def db(monkeypatch, tmp_path):
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    for model in (Client, Claim, ClaimNegotiation, RebuildContractor, RebuildProject, FileRecord):
        model.__table__.create(engine)
    make = sessionmaker(bind=engine)
    database = SimpleNamespace(get_session=make, get_readonly_session=make)
    monkeypatch.setattr(rebuild_api, '_get_service', lambda: RebuildService(database=database))
    monkeypatch.setattr(rebuild_api, '_require_project', lambda *a: None)
    # The stored url is the PDF's own path here
    monkeypatch.setattr(InsuranceExtractionService, '_resolve_pdf_path', lambda self, url, provider=None: (url, None))
    s = make()
    s.tmp = tmp_path
    yield s
    s.close()


def make_project(s):
    client = Client(id=uuid.uuid4(), display_name='Pat Homeowner', owners=[])
    claim = Claim(id=uuid.uuid4(), client_id=client.id, claim_number='CLM-1')
    project = RebuildProject(id=uuid.uuid4(), claim_id=claim.id, title='Rebuild - 12 Oak St', status='completed')
    s.add_all([client, claim, project])
    s.commit()
    return project, claim


def add_estimate(s, claim, lines, rev, kind='supplement', category='reconstruction', days_ago=0, writer=write_pdf):
    pdf = writer(s.tmp / f'{uuid.uuid4()}.pdf', lines)
    rec = FileRecord(id=str(uuid.uuid4()), filename=pdf.name, original_name=f'estimate-rev{rev}.pdf',
                     content_type='application/pdf', size=pdf.stat().st_size, context='negotiation',
                     context_id=str(claim.id), category='insurance_estimate', url=str(pdf),
                     storage_provider='local', is_active=True)
    neg = ClaimNegotiation(id=uuid.uuid4(), claim_id=claim.id, revision_number=rev, revision_type=kind,
                           estimate_category=category, document_url=rec.id, document_name=rec.original_name,
                           date_received=datetime.utcnow() - timedelta(days=days_ago))
    s.add_all([rec, neg])
    s.commit()
    return neg


def draft(project, negotiation_id=None, s=None):
    return rebuild_api.draft_scope(
        project_id=str(project.id), data=RebuildScopeDraftRequest(negotiation_id=negotiation_id),
        db=s, current_staff=None,
    )


def test_drafts_from_the_latest_rebuild_estimate(db):
    project, claim = make_project(db)
    add_estimate(db, claim, BATHROOM, rev=1, kind='initial', days_ago=30)
    latest = add_estimate(db, claim, KITCHEN, rev=2, days_ago=3)
    # Newer, but water mitigation only: not what the rebuild works from
    add_estimate(db, claim, BATHROOM, rev=1, kind='initial', category='water_mitigation', days_ago=1)

    result = draft(project, s=db)

    assert result['text'] == 'Kitchen\nReplace drywall, Paint ceiling'
    assert result['skipped_count'] == 1  # the air mover
    assert result['source']['negotiation_id'] == str(latest.id)
    assert result['source']['label'] == 'Rev #2 · Supplement · Reconstruction'
    assert result['source']['document_name'] == 'estimate-rev2.pdf'


def test_drafts_from_the_revision_asked_for(db):
    project, claim = make_project(db)
    first = add_estimate(db, claim, BATHROOM, rev=1, kind='initial', days_ago=30)
    add_estimate(db, claim, KITCHEN, rev=2, days_ago=3)

    result = draft(project, negotiation_id=first.id, s=db)

    assert result['text'] == 'Bathroom\nD&R toilet'
    assert result['source']['label'] == 'Rev #1 · Initial · Reconstruction'


def test_another_claims_estimate_is_not_found(db):
    project, _ = make_project(db)
    _, other_claim = make_project(db)
    theirs = add_estimate(db, other_claim, KITCHEN, rev=1)

    with pytest.raises(HTTPException) as e:
        draft(project, negotiation_id=theirs.id, s=db)
    assert e.value.status_code == 404


def test_no_estimate_on_the_claim(db):
    project, _ = make_project(db)
    with pytest.raises(HTTPException) as e:
        draft(project, s=db)
    assert e.value.status_code == 404
    assert 'No insurance estimate PDF' in e.value.detail


def test_a_pdf_without_readable_lines_says_so(db):
    project, claim = make_project(db)
    add_estimate(db, claim, ["Thank you for your business."], rev=1)
    with pytest.raises(HTTPException) as e:
        draft(project, s=db)
    assert e.value.status_code == 422
    assert "No line items could be read from Rev #1" in e.value.detail


def test_an_estimate_printed_in_a_mirrored_font_is_read_from_its_text(db):
    project, claim = make_project(db)
    add_estimate(db, claim, KITCHEN, rev=3, writer=write_mirrored_pdf)

    result = draft(project, s=db)

    assert result['text'] == 'Kitchen\nReplace drywall, Paint ceiling'
    assert result['skipped_count'] == 1


def test_an_estimate_of_only_mitigation_lines_says_so(db):
    project, claim = make_project(db)
    add_estimate(db, claim, [
        "Main Level", "Kitchen Height: 8'", HEADER,
        "1. Air mover (per 24 hour period) 6.00 DA 25.00 0.00 30.00 180.00 0.00 180.00",
        "2. Dehumidifier (per 24 hour period) - XLarge 3.00 DA 90.00 0.00 54.00 324.00 0.00 324.00",
        "Totals: Kitchen 0.00 84.00 504.00 0.00 504.00",
    ], rev=1, kind='initial')
    with pytest.raises(HTTPException) as e:
        draft(project, s=db)
    assert e.value.status_code == 422
    assert "No rebuild work in Rev #1 · Initial · Reconstruction" in e.value.detail


def test_the_draft_saves_with_its_source(db):
    project, claim = make_project(db)
    add_estimate(db, claim, KITCHEN, rev=2)
    result = draft(project, s=db)

    from app.domains.rebuild.schemas import RebuildProjectUpdate
    saved = rebuild_api.update_project(
        project_id=str(project.id),
        data=RebuildProjectUpdate(scope_of_work=result['text'], scope_source=result['source']),
        db=db, current_staff=None,
    )
    assert saved['scope_of_work'] == result['text']
    assert saved['scope_source']['label'] == 'Rev #2 · Supplement · Reconstruction'
