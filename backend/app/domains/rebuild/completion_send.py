"""
A Rebuild project's completion documents (COC, invoice, completion photos,
...) taken out together: downloaded at once - as a ZIP of the files, or as
one PDF of them all - or emailed to the public adjuster, the carrier's
adjuster or anyone else, from one of the company's mailboxes
(owner, 2026-11-25).

Each document is attached as it is saved; nothing is rendered at send time.
Sent, the documents can be marked as sent on the project's checklist.
"""

import io
import logging
import re
import zipfile
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# The checklist's documents and the project flag each one sets once sent
SENT_FLAGS = {"coc": "coc_sent", "invoice": "invoice_sent", "completion_photo": "photos_sent"}


def _clean_name(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', " ", name or "")
    return re.sub(r"\s+", " ", name).strip(" .") or "document"


def _file_name(doc, mime_type: str) -> str:
    """The name it downloads and attaches as: its own file name, else its title"""
    name = _clean_name(doc.file_name or doc.title or "document")
    if "." not in name[-6:]:
        name += ".pdf" if "pdf" in (mime_type or "pdf") else ""
    return name


def doc_file(session, doc) -> Optional[Dict[str, Any]]:
    """{filename, data, mime_type} of a completion document's file, or None
    when it has none (recorded as sent outside the app) or it can't be read"""
    mime = doc.mime_type or "application/pdf"
    data: Optional[bytes] = None
    try:
        if doc.file_url:
            if doc.file_url.startswith("/uploads/"):
                from pathlib import Path

                local = Path(__file__).resolve().parents[3] / doc.file_url.lstrip("/")
                data = local.read_bytes() if local.exists() else None
            else:
                from app.domains.storage.factory import StorageFactory

                data = StorageFactory.get_instance().download(doc.file_url)
        elif doc.file_id:
            from app.domains.file.models import File as FileRecord
            from app.domains.pack_calculation.packing_photos import _stored_file_bytes

            record = session.query(FileRecord).filter(FileRecord.id == str(doc.file_id)).first()
            if record is not None:
                data = _stored_file_bytes(record)
                mime = record.content_type or mime
    except Exception as e:
        logger.warning(f"Completion doc {doc.id} ({doc.title}) could not be read: {e}")
        data = None
    if not data:
        return None
    return {"filename": _file_name(doc, mime), "data": data, "mime_type": mime}


def collect(session, project_id: str, doc_ids: Optional[List[str]] = None) -> Tuple[List[Any], List[Dict[str, Any]], List[str]]:
    """(the documents, their files, the titles of the ones that couldn't be
    read): the ones named, in that order, else every document with a file in
    the checklist's order (COC, invoice, photos, then the rest)"""
    from app.domains.rebuild.models import RebuildCompletionDoc

    docs = session.query(RebuildCompletionDoc).filter(
        RebuildCompletionDoc.project_id == str(project_id)
    ).order_by(RebuildCompletionDoc.created_at).all()
    if doc_ids:
        by_id = {str(d.id): d for d in docs}
        wanted = [str(i) for i in dict.fromkeys(doc_ids)]
        missing = [i for i in wanted if i not in by_id]
        if missing:
            raise LookupError("A chosen document is no longer on this project")
        docs = [by_id[i] for i in wanted]
    else:
        rank = {t: i for i, t in enumerate(SENT_FLAGS)}
        docs = sorted(
            [d for d in docs if d.file_url or d.file_id],
            key=lambda d: rank.get(d.doc_type, len(rank)),
        )
    files, failed = [], []
    taken: Dict[str, int] = {}
    for d in docs:
        f = doc_file(session, d)
        if f is None:
            failed.append(d.title or "document")
            continue
        # Two files of one name in a ZIP or an email: the second gets a number
        stem, dot, ext = f["filename"].rpartition(".")
        key = f["filename"].lower()
        if key in taken:
            taken[key] += 1
            f["filename"] = f"{stem} ({taken[key]}).{ext}" if dot else f"{f['filename']} ({taken[key]})"
        else:
            taken[key] = 1
        files.append(f)
    return docs, files, failed


def zip_bundle(files: List[Dict[str, Any]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.writestr(f["filename"], f["data"])
    return buf.getvalue()


def pdf_bundle(files: List[Dict[str, Any]]) -> bytes:
    """One PDF of them all, in order; a photo becomes a page of its own"""
    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter()
    for f in files:
        data = f["data"]
        if not (f["mime_type"] or "").endswith("pdf") and not data[:5] == b"%PDF-":
            from PIL import Image, ImageOps

            with Image.open(io.BytesIO(data)) as img:
                page = ImageOps.exif_transpose(img).convert("RGB")
                out = io.BytesIO()
                page.save(out, format="PDF", resolution=150)
                data = out.getvalue()
        writer.append(PdfReader(io.BytesIO(data)))
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def bundle_name(address: str, ext: str) -> str:
    stem = " - ".join(p for p in (_clean_name(address) if address else "", "Completion Documents") if p)
    return f"{stem}.{ext}"


# ----------------------------------------------------------------------------
# Email
# ----------------------------------------------------------------------------

def _issuing_company(session, project):
    from app.domains.company.models import Company
    from app.domains.rebuild.estimate_invoice import _issuing_company_id

    company_id = _issuing_company_id(session, project)
    if not company_id:
        return None
    return session.query(Company).filter(Company.id == company_id).first()


def recipients(session, claim) -> List[Dict[str, str]]:
    """Who the documents usually go to: the public adjuster first, then the
    carrier's adjusters, then the client - each once"""
    from app.domains.client.models import Client
    from app.domains.company.models import CompanyContact

    out: List[Dict[str, str]] = []
    seen = set()

    def add(name: Optional[str], email: Optional[str], role: str) -> None:
        email = (email or "").strip()
        if email and email.lower() not in seen:
            seen.add(email.lower())
            out.append({"name": (name or "").strip(), "email": email, "role": role})

    if claim is None:
        return out
    pa_contact_id = getattr(claim, "pa_contact_id", None)
    if pa_contact_id:
        contact = session.query(CompanyContact).filter(CompanyContact.id == pa_contact_id).first()
        if contact:
            company = getattr(contact, "company", None)
            add(contact.name or (company.name if company else ""), contact.email, "pa")
    add(getattr(claim, "pa_name", None) or getattr(claim, "pa_company", None), getattr(claim, "pa_email", None), "pa")
    add(getattr(claim, "adjuster_name", None), getattr(claim, "adjuster_email", None), "adjuster")
    for entry in getattr(claim, "additional_adjusters", None) or []:
        if isinstance(entry, dict):
            add(entry.get("name") or entry.get("company"), entry.get("email"), "adjuster")
    client = session.query(Client).filter(Client.id == claim.client_id).first() if claim.client_id else None
    if client is not None:
        owners = client.owners or []
        primary = next((o for o in owners if o.get("is_primary")), owners[0] if owners else None)
        add(client.display_name, client.email or (primary or {}).get("email"), "client")
    return out


def email_info(session, project, *, staff, sender_email: Optional[str]) -> Dict[str, Any]:
    """What the email dialog opens with: the mailboxes the person may send
    from, the people the documents usually go to, a subject and a body"""
    from app.domains.client.models import Claim
    from app.domains.water_mitigation.adjuster_email_service import AdjusterEmailService
    from app.domains.rebuild.service import RebuildService

    claim = session.query(Claim).filter(Claim.id == project.claim_id).first()
    company = _issuing_company(session, project)
    accounts = AdjusterEmailService(None)._get_email_accounts(
        session, company_id=company.id if company else None, sender_email=sender_email, staff=staff,
    )
    address = RebuildService._photo_pdf_address(session, project)
    short = address.split(",")[0].strip()
    claim_number = getattr(claim, "claim_number", "") or ""
    subject = " - ".join(p for p in (claim_number, short, "Completion Documents") if p)
    body = "\n\n".join([
        "<p>Hello,</p>",
        f"<p>The work{f' at {address}' if address else ''} is complete. Please find the completion "
        "documents attached.</p>",
        "<p>Let me know if you have any questions.</p>",
        "<p>Thank you.</p>",
    ])
    return {
        "email_accounts": accounts,
        "recipients": recipients(session, claim),
        "subject": subject,
        "body_html": body,
    }


def send(session, service, project, data: Dict[str, Any], *, sender) -> Dict[str, Any]:
    """Email the chosen documents; with mark_sent, the checklist marks them
    sent. Raises ValueError when there is no one to send to or nothing could
    be attached (nothing is sent then)."""
    from app.common.services.document_resources import require_memory
    from app.domains.claim_followup.service import ClaimFollowUpService, require_sending_account
    from app.domains.client.models import Claim, ClaimActivity
    from app.domains.water_mitigation.adjuster_email_service import AdjusterEmailService

    to = [a for a in (data.get("to_addresses") or []) if a]
    if not to:
        raise ValueError("Add at least one recipient")
    doc_ids = [str(i) for i in data.get("doc_ids") or []]
    if not doc_ids:
        raise ValueError("Pick at least one document")
    require_sending_account(session, data.get("email_account_id"), staff=sender)

    docs, files, failed = collect(session, str(project.id), doc_ids)
    if failed:
        raise ValueError(
            f"Couldn't read {', '.join(failed)}, so the email was not sent. "
            "Open the document to check it, or leave it out."
        )
    mailer = AdjusterEmailService(service.database)
    files = mailer._compress_attachments_if_needed(files)
    mailer._assert_within_email_limit(files)

    company = _issuing_company(session, project)
    payload = {
        "claim_id": str(project.claim_id),
        "email_account_id": data.get("email_account_id"),
        "to_addresses": to,
        "cc_addresses": data.get("cc_addresses") or [],
        "bcc_addresses": data.get("bcc_addresses") or [],
        "subject": data.get("subject") or "Completion Documents",
        "body_html": data.get("body_html") or "",
        "attachments": files,
    }
    if company is not None and company.name:
        payload["display_name"] = company.name
    require_memory(6 * sum(len(f["data"]) for f in files))
    result = ClaimFollowUpService(service.database).send_email(payload, sender=sender)

    claim = session.query(Claim).filter(Claim.id == project.claim_id).first()
    everyone = {a.lower() for a in to + list(payload["cc_addresses"]) + list(payload["bcc_addresses"])}
    if data.get("mark_sent", True):
        now = datetime.now(timezone.utc)
        for d in docs:
            d.status = "sent"
            flag = SENT_FLAGS.get(d.doc_type)
            if flag:
                setattr(project, flag, True)
        project.docs_sent_date = now
        roles = {r["role"] for r in recipients(session, claim) if r["email"].lower() in everyone}
        if "pa" in roles and "adjuster" in roles:
            project.docs_sent_to = "both"
        elif "pa" in roles:
            project.docs_sent_to = "public_adjuster"
        elif "adjuster" in roles:
            project.docs_sent_to = "insurance_company"
    session.add(ClaimActivity(
        claim_id=project.claim_id,
        activity_type="rebuild_documents_emailed",
        title=f"Completion documents emailed ({to[0]})",
        description=f"{len(files)} document(s) emailed: {', '.join(f['filename'] for f in files)}",
        related_entity_type="rebuild_project",
        related_entity_id=str(project.id),
    ))
    session.flush()
    return {"success": True, "email_id": str(result.get("id", "")), "attachments_count": len(files)}
