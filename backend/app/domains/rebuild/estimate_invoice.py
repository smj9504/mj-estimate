"""
An invoice made from the carrier's estimate, for a Rebuild project's
completion paperwork (owner, 2026-11-25).

  - One line per room: the room's name, its scope in one line
    (scope_summary.py) and what the estimate prices it at (the RCV of its
    lines). The estimate's other areas (Debris Removal, General...) are lines
    of their own; what the rooms don't add up to (O&P or tax priced on the
    summary) is one more line, so the total is the estimate's RCV.
  - What is already paid is listed as payments: the deductible, the prior
    payments, and the ACV payment (the carrier's Net Claim: ACV less the
    deductible and the prior payments). They add up to the ACV, so the
    balance due is what the carrier still owes once the work is done.
  - The invoice is dated the day the work was completed, due two weeks later.

The invoice is a real one (Invoices), issued by the claim's reconstruction
company; its PDF is kept as the project's Invoice completion document.
"""

import logging
import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Water mitigation is billed on its own job, not the rebuild's
_MITIGATION_SECTION = re.compile(r"mitigation", re.IGNORECASE)
# A listing of lines already priced in the rooms, not more to bill
_LISTING_SECTION = re.compile(r"^labor minimums applied$", re.IGNORECASE)

ADJUSTMENT_LINE = "Overhead & profit, tax and other per estimate"
# Due two weeks after the invoice date, the day the work was completed (owner, 2026-11-25)
DUE_DAYS = 14
NEGATIVE_ADJUSTMENT_LINE = "Adjustment to the estimate's RCV"


def _num(value: Any) -> Optional[float]:
    try:
        return None if value is None else float(value)
    except (TypeError, ValueError):
        return None


def line_amount(item: Dict[str, Any]) -> float:
    """What the estimate prices a line at: its RCV (tax and O&P in it), else
    quantity x unit price plus its tax and O&P"""
    rcv = _num(item.get("rcv"))
    if rcv is not None:
        return rcv
    qty = _num(item.get("quantity")) or 0.0
    price = _num(item.get("unit_price")) or 0.0
    return qty * price + (_num(item.get("tax")) or 0.0) + (_num(item.get("op")) or 0.0)


def billed_areas(parsed: Dict[str, Any]) -> List[Dict[str, Any]]:
    """[{name, description, amount}] in the estimate's order: each room (a
    subroom with the room before it) and each other area, with its scope in
    one line and the RCV of its lines. Water mitigation is left out."""
    from app.domains.rebuild.scope_summary import (
        _MITIGATION, _SUBROOM, _area_line, summarize_room,
    )

    areas: List[Tuple[str, List[Dict[str, Any]]]] = []
    for sec in parsed.get("standalone_sections") or []:
        name = (sec.get("name") or "").strip()
        if not _MITIGATION_SECTION.search(name) and not _LISTING_SECTION.match(name):
            areas.append((name or "General", list(sec.get("line_items") or [])))
    for lv in parsed.get("levels") or []:
        rooms: List[Tuple[str, List[Dict[str, Any]]]] = []
        for rm in lv.get("rooms") or []:
            name = (rm.get("name") or "Room").strip()
            m = _SUBROOM.match(name)
            if m and rooms:
                rooms[-1][1].extend(rm.get("line_items") or [])
                continue
            rooms.append((m.group(1) if m else name, list(rm.get("line_items") or [])))
        areas.extend(rooms)
    for sec in parsed.get("appendix_sections") or []:
        name = (sec.get("name") or "").strip()
        if not _MITIGATION_SECTION.search(name) and not _LISTING_SECTION.match(name):
            areas.append((name or "General", list(sec.get("line_items") or [])))

    out = []
    for name, items in areas:
        billed = [li for li in items if not _MITIGATION.search(li.get("description") or "")]
        amount = round(sum(line_amount(li) for li in billed), 2)
        if abs(amount) < 0.005:
            continue
        descs = [(li.get("description") or "").strip() for li in billed]
        out.append({"name": name, "description": _area_line(summarize_room(descs)), "amount": amount})
    return out


def summary_amounts(parsed: Dict[str, Any], neg: Any = None) -> Dict[str, Any]:
    """The estimate's own figures: {rcv, acv, deductible, prior_payments,
    from_summary}. From its summary page (water mitigation coverage left
    out); else the revision's figures as saved when it was uploaded."""
    from app.domains.insurance_extraction.parsers.estimate_summary import (
        _GUIDE_PAGE, _claim_totals_page, _summary_for_blocks,
    )

    # As parse_estimate_summary reads it, keeping each coverage's Net Claim
    pages = [
        [ln.strip() for ln in (text or "").split("\n") if ln.strip()]
        for text in parsed.get("_page_texts") or []
        if not _GUIDE_PAGE.search(text or "")
    ]
    sections = _summary_for_blocks([ln for page in pages for ln in page]) or _claim_totals_page(pages)
    rebuild = [s for s in sections if not _MITIGATION_SECTION.search(s.get("section_name") or "")]
    sections = rebuild or sections
    if sections:
        rcv = sum(s["rcv"] for s in sections)
        acv = sum(s["net_acv"] for s in sections)
        deductible = sum(s["deductible"] for s in sections)
        net_claim = sum(s.get("net_claim") or 0 for s in sections)
        # Net Claim is the ACV less the deductible and the prior payments
        prior = acv - deductible - net_claim if net_claim > 0 else 0.0
        return {
            "rcv": round(rcv, 2), "acv": round(acv, 2), "deductible": round(deductible, 2),
            "prior_payments": round(max(prior, 0.0), 2), "from_summary": True,
        }
    if neg is not None and (_num(getattr(neg, "rcv_amount", None)) or 0) > 0:
        return {
            "rcv": round(float(neg.rcv_amount), 2),
            "acv": round(float(neg.acv_amount or neg.rcv_amount), 2),
            "deductible": round(float(neg.deductible or 0), 2),
            "prior_payments": 0.0, "from_summary": False,
        }
    return {"rcv": None, "acv": None, "deductible": 0.0, "prior_payments": 0.0, "from_summary": False}


def invoice_plan(parsed: Dict[str, Any], neg: Any = None) -> Dict[str, Any]:
    """{lines, total, payments, balance_due, warnings}: what the invoice says"""
    lines = billed_areas(parsed)
    amounts = summary_amounts(parsed, neg)
    warnings: List[str] = []
    rooms_total = round(sum(line["amount"] for line in lines), 2)

    rcv = amounts["rcv"]
    if rcv is None:
        rcv = rooms_total
        warnings.append(
            "The estimate's summary (RCV, ACV, deductible) couldn't be read: the total is what its "
            "lines add up to, and no payments are listed. Check them on the invoice."
        )
    elif not amounts["from_summary"]:
        warnings.append(
            "The estimate's summary page couldn't be read: the RCV, ACV and deductible are the ones "
            "saved with this revision, and no prior payments are listed."
        )

    diff = round(rcv - rooms_total, 2)
    if abs(diff) >= 1.0:
        lines.append({
            "name": ADJUSTMENT_LINE if diff > 0 else NEGATIVE_ADJUSTMENT_LINE,
            "description": "",
            "amount": diff,
        })
        if diff < 0 or (rcv and diff > rcv * 0.25):
            warnings.append(
                f"The rooms come to ${rooms_total:,.2f} but the estimate's RCV is ${rcv:,.2f}; "
                "check the room amounts against the PDF."
            )
    elif lines and abs(diff) >= 0.005:
        # Cents of rounding go on the last line
        lines[-1]["amount"] = round(lines[-1]["amount"] + diff, 2)

    # No figures at all: nothing is listed as paid
    acv = amounts["acv"] if amounts["acv"] is not None else 0.0
    deductible = amounts["deductible"] or 0.0
    prior = amounts["prior_payments"] or 0.0
    payments = [
        {"label": "Deductible", "amount": round(deductible, 2)},
        {"label": "Prior payments", "amount": round(prior, 2)},
        {"label": "ACV payment", "amount": round(acv - deductible - prior, 2)},
    ]
    payments = [p for p in payments if p["amount"] >= 0.005]
    total = round(sum(line["amount"] for line in lines), 2)
    paid = round(sum(p["amount"] for p in payments), 2)
    return {
        "lines": lines,
        "total": total,
        "payments": payments,
        "balance_due": round(total - paid, 2),
        "warnings": warnings,
    }


def _completion_datetime(day: date) -> datetime:
    return datetime.combine(day, time(12, 0), tzinfo=timezone.utc)


def _issuing_company_id(db, project) -> Optional[str]:
    """The claim's reconstruction company, else the contractor's company"""
    from app.domains.contract.models import ClaimCompany

    row = db.query(ClaimCompany.company_id).filter(
        ClaimCompany.claim_id == project.claim_id,
        ClaimCompany.role == "reconstruction",
    ).first()
    if row and row[0]:
        return str(row[0])
    contractor = getattr(project, "contractor", None)
    if contractor is not None and contractor.company_id:
        return str(contractor.company_id)
    return None


def render_invoice_pdf(db, invoice_id: str) -> bytes:
    """The invoice's PDF as the Invoices page prints it"""
    import os
    import tempfile

    from app.common.services.pdf_service import get_pdf_service
    from app.domains.invoice.pdf_data import invoice_pdf_data
    from app.domains.invoice.repository import get_invoice_repository

    invoice = get_invoice_repository(db).get_with_items(str(invoice_id))
    if not invoice:
        raise LookupError("Invoice not found")
    service = get_pdf_service()
    if not service:
        raise RuntimeError("PDF service not available")
    fd, path = tempfile.mkstemp(suffix=".pdf", prefix="rebuild_invoice_")
    os.close(fd)
    try:
        out = service.generate_invoice_pdf(invoice_pdf_data(invoice), path)
        with open(out, "rb") as f:
            return f.read()
    finally:
        for p in {path}:
            try:
                os.unlink(p)
            except OSError:
                pass


def store_invoice_pdf(project_id: str, address: str, invoice_number: str, pdf: bytes) -> Tuple[str, str]:
    """(file_url, file_name) of the invoice PDF stored with the project's documents"""
    from app.common.utils.storage_helpers import upload_bytes_to_storage
    from app.domains.rebuild.service import RebuildService

    title = f"Invoice {invoice_number}".strip()
    file_name = RebuildService._photo_pdf_file_name(address, title)
    storage_name = RebuildService._photo_pdf_file_name(
        *(t.encode("ascii", "ignore").decode("ascii") for t in (address, title)))
    info = upload_bytes_to_storage(
        file_bytes=pdf, filename=storage_name, context="rebuild",
        context_id=str(project_id), category="docs",
    )
    return info["file_url"], file_name


def create_invoice_from_estimate(db, service, project_id: str, negotiation_id: Optional[str],
                                 completion_date: date, staff: Any) -> Dict[str, Any]:
    """Make the invoice, keep its PDF as the project's Invoice completion
    document and the completion date on the project. Returns the document.

    Raises LookupError (no estimate), ValueError (nothing to bill, no company
    to issue it)."""
    from app.domains.client.models import Claim
    from app.domains.invoice import api as invoice_api
    from app.domains.invoice.models import Invoice
    from app.domains.invoice.schemas import (
        ClientInfo, InsuranceInfo, InvoiceCreate, InvoiceItemCreate, InvoiceSection, PaymentRecord,
    )
    from app.domains.invoice.service import InvoiceService
    from app.domains.rebuild.models import RebuildCompletionDoc

    project, neg, _file_rec, parsed = service._read_estimate(db, project_id, negotiation_id)
    plan = invoice_plan(parsed, neg)
    if not plan["lines"] or plan["total"] <= 0:
        raise ValueError(
            "No amounts could be read from this estimate's PDF, so there is nothing to bill. "
            "Make the invoice on the Invoices page instead."
        )
    company_id = _issuing_company_id(db, project)
    if not company_id:
        raise ValueError(
            "Nobody to issue the invoice: put the reconstruction company on the claim, "
            "or a contractor linked to a company on the project."
        )

    claim = db.query(Claim).filter(Claim.id == project.claim_id).first()
    label = service._estimate_label(neg)
    number = InvoiceService(service.database).generate_invoice_number(company_id).get("invoice_number")
    # The invoice says no more than its lines (owner, 2026-11-25): no note,
    # and a section the invoice prints without a heading ("Items")
    section = "Items"

    data = InvoiceCreate(
        invoice_number=number,
        date=completion_date.isoformat(),
        due_date=(completion_date + timedelta(days=DUE_DAYS)).isoformat(),
        status="pending",
        company_id=company_id,
        client=ClientInfo(),
        client_id=claim.client_id if claim else None,
        show_insurance=True,
        insurance=InsuranceInfo(
            company=getattr(claim, "insurance_company", None),
            policy_number=getattr(claim, "insurance_policy_number", None),
            claim_number=getattr(claim, "claim_number", None),
            deductible=next((p["amount"] for p in plan["payments"] if p["label"] == "Deductible"), None),
        ),
        tax_method="percentage",
        tax_rate=0,
        items=[
            InvoiceItemCreate(
                # The invoice prints the description: the room, then its scope
                name=line["name"],
                description=f"{line['name']}: {line['description']}" if line["description"] else line["name"],
                quantity=1, unit="LS",
                rate=line["amount"], taxable=False, primary_group=section, sort_order=i,
            )
            for i, line in enumerate(plan["lines"])
        ],
        sections=[InvoiceSection(id="reconstruction", title=section, showSubtotal=False, taxable=False)],
        payments=[
            # Received before the invoice; when isn't on the estimate
            PaymentRecord(amount=p["amount"], date=None, reference=p["label"], label=p["label"])
            for p in plan["payments"]
        ],
        show_payment_dates=False,
    )
    created = invoice_api.create_invoice(data, db=db, current_staff=staff)
    invoice_id = str(created.id)
    # The invoice is the claim's (Invoices lists it on the claim)
    db.query(Invoice).filter(Invoice.id == invoice_id).update({"claim_id": project.claim_id})
    db.flush()

    address = service._photo_pdf_address(db, project)
    pdf = render_invoice_pdf(db, invoice_id)
    file_url, file_name = store_invoice_pdf(project_id, address, created.invoice_number, pdf)

    doc = RebuildCompletionDoc(
        project_id=project.id,
        doc_type="invoice",
        title=f"Invoice {created.invoice_number}",
        description=f"From {label}. Total ${plan['total']:,.2f}, balance due ${plan['balance_due']:,.2f}.",
        file_url=file_url,
        file_name=file_name,
        mime_type="application/pdf",
        status="final",
        invoice_id=invoice_id,
        created_by_id=getattr(staff, "id", None),
    )
    db.add(doc)
    project.actual_completion = _completion_datetime(completion_date)
    project.final_invoice_amount = plan["total"]
    db.flush()
    logger.info(f"Rebuild project {project_id}: invoice {created.invoice_number} made from {label}")
    return doc


def refresh_invoice_pdf(db, service, doc) -> None:
    """Print the document's invoice again, as it is now (edited on the
    Invoices page), over the document's PDF"""
    from app.domains.invoice.models import Invoice
    from app.domains.rebuild.models import RebuildProject

    if not doc.invoice_id:
        raise ValueError("This document wasn't made from an invoice")
    invoice = db.query(Invoice).filter(Invoice.id == doc.invoice_id).first()
    if not invoice:
        raise LookupError("Its invoice has been deleted")
    project = db.query(RebuildProject).filter(RebuildProject.id == doc.project_id).first()
    address = service._photo_pdf_address(db, project)
    pdf = render_invoice_pdf(db, str(invoice.id))
    doc.file_url, doc.file_name = store_invoice_pdf(str(project.id), address, invoice.invoice_number, pdf)
    doc.title = f"Invoice {invoice.invoice_number}"
    db.flush()
