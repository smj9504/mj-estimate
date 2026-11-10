"""
The stored files behind a client's claims, for the client page's Document Hub.

Each file is named by (source, id):
- file: a row of the files table on the claim - the carrier's estimate PDFs
  (uploaded or filed from email), other PDFs email filed on the claim (photo
  reports, letters), follow-up estimate uploads and supplement PDFs.
- wm_document: a WM job's document (COS, EWA, photo report, sketch, invoice...).
- contract: a contract's signed PDF, or its filled PDF until it is signed.
- rebuild_doc: a rebuild project's completion document (COC, invoice...).

The hub reads them only through GET /api/clients/{id}/document-files/{source}/{id},
which takes a login and checks the claim is one the person may see. The older
download URLs open without either, so the hub doesn't use them.

The client page's email composer attaches the same files by (source, id);
the send checks them the same way (claim_followup/api.py send_email).

Photos and videos stay out: the claim's photo viewer has them.
"""

import logging
import mimetypes
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# File contexts whose context_id is the claim's id
_CLAIM_FILE_CONTEXTS = ("negotiation", "claim-negotiation", "claim-document")
# ...and the ones keyed by one of the claim's follow-up tasks
_TASK_FILE_CONTEXTS = {"insurance_estimate": "Insurance estimate", "wm_estimate": "WM estimate"}

SOURCES = ("file", "wm_document", "contract", "rebuild_doc")


def _iso(dt) -> Optional[str]:
    return dt.isoformat() if dt else None


def _humanize(value: Optional[str]) -> str:
    text = (value or "").replace("_", " ").replace("-", " ").strip()
    return text[:1].upper() + text[1:] if text else ""


def _media_type(mime: Optional[str], filename: str) -> str:
    if mime:
        return mime
    guessed, _ = mimetypes.guess_type(filename or "")
    return guessed or "application/octet-stream"


def _is_photo_or_video(mime: Optional[str]) -> bool:
    return (mime or "").startswith(("image/", "video/"))


def negotiation_files(session, negotiations) -> Dict[str, Any]:
    """The File row behind each insurance-estimate revision, by negotiation
    id. document_url is a File id, except on revisions email filed, where it
    is the file's storage url."""
    from app.domains.file.models import File

    refs = {str(n.id): n.document_url for n in negotiations if n.document_url}
    if not refs:
        return {}
    values = list(set(refs.values()))
    rows = session.query(File).filter(
        File.is_active.isnot(False),
        (File.id.in_(values)) | (File.url.in_(values)),
    ).all()
    by_id = {str(f.id): f for f in rows}
    by_url = {f.url: f for f in rows}
    return {
        neg_id: by_id.get(ref) or by_url.get(ref)
        for neg_id, ref in refs.items()
        if by_id.get(ref) or by_url.get(ref)
    }


def _file_entry(f, claim_id: str, label: str) -> Dict[str, Any]:
    return {
        "source": "file", "id": str(f.id), "claim_id": claim_id,
        "filename": f.original_name or f.filename or "document",
        "mime_type": _media_type(f.content_type, f.original_name or ""),
        "date": f.created_at, "label": label,
        "read": ("file", f.url, f.storage_provider),
    }


def claim_files(session, claim_ids: List[str], skip_file_ids=()) -> List[Dict[str, Any]]:
    """Every stored document file on these claims, oldest source first. A
    File id in skip_file_ids is left out (the hub shows it on its own row)."""
    if not claim_ids:
        return []
    from app.domains.claim_followup.models import FollowUpTask
    from app.domains.client.models import Claim
    from app.domains.file.models import File
    from app.domains.rebuild.models import RebuildCompletionDoc, RebuildProject
    from app.domains.supplement.models import BidItemEstimate, SupplementRequest
    from app.domains.water_mitigation.models import WaterMitigationJob, WMDocument

    entries: List[Dict[str, Any]] = []
    seen = {str(i) for i in skip_file_ids if i}

    def add_file(f, claim_id: str, label: str) -> None:
        if f is None or str(f.id) in seen or f.is_active is False:
            return
        if _is_photo_or_video(f.content_type):
            return
        seen.add(str(f.id))
        entries.append(_file_entry(f, claim_id, label))

    # Files filed on the claim itself
    for f in session.query(File).filter(
        File.context.in_(_CLAIM_FILE_CONTEXTS), File.context_id.in_(claim_ids),
    ).order_by(File.created_at.desc()):
        label = (
            _humanize(f.category) if f.context == "claim-document" and f.category
            else "Insurance estimate"
        )
        add_file(f, str(f.context_id), label)

    # Estimates uploaded from a follow-up task
    task_claim = {
        str(t): str(c) for t, c in session.query(FollowUpTask.id, FollowUpTask.claim_id).filter(
            FollowUpTask.claim_id.in_(claim_ids)
        )
    }
    if task_claim:
        for f in session.query(File).filter(
            File.context.in_(tuple(_TASK_FILE_CONTEXTS)), File.context_id.in_(list(task_claim)),
        ).order_by(File.created_at.desc()):
            claim_id = task_claim.get(str(f.context_id))
            if claim_id:
                add_file(f, claim_id, _TASK_FILE_CONTEXTS[f.context])

    # Files the claim and its supplements point at by id
    pointers: List[Tuple[str, str, str]] = []  # (file id, claim id, label)
    for claim in session.query(Claim).filter(Claim.id.in_(claim_ids)):
        if claim.insurance_estimate_file_id:
            pointers.append((claim.insurance_estimate_file_id, str(claim.id), "Insurance estimate"))
        if claim.wm_estimate_file_id:
            pointers.append((claim.wm_estimate_file_id, str(claim.id), "WM estimate"))
    supplements = session.query(SupplementRequest).filter(
        SupplementRequest.claim_id.in_(claim_ids)
    ).all()
    sup_claim = {str(s.id): str(s.claim_id) for s in supplements}
    for s in supplements:
        if s.document_file_id:
            pointers.append((s.document_file_id, str(s.claim_id), "Supplement estimate"))
    if sup_claim:
        for item in session.query(BidItemEstimate).filter(
            BidItemEstimate.supplement_id.in_(list(sup_claim)),
            BidItemEstimate.custom_document_file_id.isnot(None),
        ):
            pointers.append((
                item.custom_document_file_id, sup_claim[str(item.supplement_id)],
                "Supplement bid item",
            ))
    if pointers:
        files = {str(f.id): f for f in session.query(File).filter(
            File.id.in_([p[0] for p in pointers])
        )}
        for file_id, claim_id, label in pointers:
            add_file(files.get(str(file_id)), claim_id, label)

    # WM job documents
    jobs = {
        str(j): str(c) for j, c in session.query(
            WaterMitigationJob.id, WaterMitigationJob.claim_id
        ).filter(WaterMitigationJob.claim_id.in_(claim_ids))
    }
    if jobs:
        for doc in session.query(WMDocument).filter(
            WMDocument.job_id.in_(list(jobs)), WMDocument.is_active.isnot(False),
        ).order_by(WMDocument.created_at.desc()):
            if _is_photo_or_video(doc.mime_type):
                continue
            entries.append({
                "source": "wm_document", "id": str(doc.id),
                "claim_id": jobs[str(doc.job_id)],
                "filename": doc.filename or doc.title or "document",
                "mime_type": _media_type(doc.mime_type, doc.filename or ""),
                "date": doc.created_at,
                "label": f"WM job · {doc.title or _humanize(doc.document_type)}",
                "read": ("wm_document", doc.storage_file_id or doc.file_path, doc.storage_provider),
            })

    # Rebuild completion documents (COC, invoice ...)
    projects = {
        str(p): str(c) for p, c in session.query(
            RebuildProject.id, RebuildProject.claim_id
        ).filter(RebuildProject.claim_id.in_(claim_ids))
    }
    if projects:
        for doc in session.query(RebuildCompletionDoc).filter(
            RebuildCompletionDoc.project_id.in_(list(projects)),
            RebuildCompletionDoc.file_url.isnot(None),
        ).order_by(RebuildCompletionDoc.created_at.desc()):
            if not doc.file_url or _is_photo_or_video(doc.mime_type):
                continue
            entries.append({
                "source": "rebuild_doc", "id": str(doc.id),
                "claim_id": projects[str(doc.project_id)],
                "filename": doc.file_name or f"{doc.title or 'document'}.pdf",
                "mime_type": _media_type(doc.mime_type, doc.file_name or ".pdf"),
                "date": doc.created_at,
                "label": f"Rebuild · {doc.title or _humanize(doc.doc_type)}",
                "read": ("rebuild_doc", doc.file_url, None),
            })
    return entries


def contract_file(contract) -> Optional[Dict[str, Any]]:
    """The contract's signed PDF, or its filled one until it is signed"""
    if contract.signed_pdf_url:
        url, provider, label = contract.signed_pdf_url, contract.signed_pdf_provider, "Signed contract"
    elif contract.filled_pdf_url:
        url, provider, label = contract.filled_pdf_url, contract.filled_pdf_provider, "Contract"
    else:
        return None
    title = contract.title or "Contract"
    return {
        "source": "contract", "id": str(contract.id),
        "claim_id": str(contract.claim_id) if contract.claim_id else None,
        "filename": f"{title}.pdf", "mime_type": "application/pdf",
        "date": contract.signed_at or contract.created_at, "label": label,
        "read": ("contract", url, provider),
    }


def public_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
    """What the hub row carries about its file"""
    return {
        "source": entry["source"], "id": entry["id"],
        "filename": entry["filename"], "mime_type": entry["mime_type"],
    }


def file_row(entry: Dict[str, Any], claim_map: Dict[str, str]) -> Dict[str, Any]:
    """A Document Hub row for a file of its own"""
    claim_id = entry.get("claim_id")
    return {
        "id": f"{entry['source']}:{entry['id']}",
        "doc_type": "file",
        "title": entry["filename"],
        "description": entry["label"],
        "status": None,
        "claim_id": claim_id,
        "claim_number": claim_map.get(claim_id, "") if claim_id else "",
        "date": _iso(entry["date"]),
        "amount": None,
        "link": None,
        "file": public_entry(entry),
    }


def visible_scope(session, staff, client_id: str) -> Tuple[List[str], Optional[List[str]]]:
    """The client's claim ids this person may see, and their company ids
    (None when they see everything) - what find_hub_files checks against."""
    from app.domains.auth import company_scope
    from app.domains.client.models import Claim

    claim_ids = [str(c.id) for c in company_scope.scoped(
        session.query(Claim.id).filter(Claim.client_id == client_id),
        company_scope.claim_condition(session, staff, Claim.id),
    )]
    return claim_ids, company_scope.company_ids(session, staff)


def _find_contract(session, client_id: str, claim_ids: List[str], own_companies, contract_id: str):
    import uuid

    from app.domains.contract.models import ContractInstance

    try:
        uuid.UUID(contract_id)
    except ValueError:
        return None
    contract = session.query(ContractInstance).filter(
        ContractInstance.id == contract_id, ContractInstance.client_id == client_id,
    ).first()
    if contract is None:
        return None
    on_claim = contract.claim_id and str(contract.claim_id) in claim_ids
    own_company = own_companies is None or (
        contract.company_id and str(contract.company_id) in own_companies
    )
    if not (on_claim or (not contract.claim_id and own_company)):
        return None
    return contract_file(contract)


def find_hub_files(
    session, client_id: str, claim_ids: List[str], own_companies,
    refs: List[Tuple[str, str]],
) -> List[Optional[Dict[str, Any]]]:
    """Each file (source, id) in refs if the hub would show it to this
    person, else None in its place: on one of the claims they may see, or on
    a client-level contract of their company."""
    found: Dict[Tuple[str, str], Optional[Dict[str, Any]]] = {}
    wanted = [(s, i) for s, i in refs if s in SOURCES]
    for source, file_id in wanted:
        if source == "contract" and (source, file_id) not in found:
            found[(source, file_id)] = _find_contract(
                session, client_id, claim_ids, own_companies, file_id,
            )

    if any(s != "contract" for s, _ in wanted):
        if any(s == "file" for s, _ in wanted) and claim_ids:
            # Insurance-estimate PDFs: the hub opens them from their own rows
            from app.domains.client.models import ClaimNegotiation

            negotiations = session.query(ClaimNegotiation).filter(
                ClaimNegotiation.claim_id.in_(claim_ids)
            ).all()
            claim_of = {str(n.id): str(n.claim_id) for n in negotiations}
            for neg_id, f in negotiation_files(session, negotiations).items():
                found.setdefault(
                    ("file", str(f.id)), _file_entry(f, claim_of[neg_id], "Insurance estimate"),
                )
        for entry in claim_files(session, claim_ids):
            found.setdefault((entry["source"], entry["id"]), entry)
    return [found.get((s, i)) for s, i in refs]


def find_hub_file(
    session, client_id: str, claim_ids: List[str], own_companies, source: str, file_id: str,
) -> Optional[Dict[str, Any]]:
    """The file (source, file_id) if the hub would show it to this person"""
    return find_hub_files(session, client_id, claim_ids, own_companies, [(source, file_id)])[0]


def read_hub_file(entry: Dict[str, Any], max_bytes: Optional[int] = None) -> bytes:
    """The file's bytes from wherever it is stored. Raises FileNotFoundError,
    or DocumentResourceError when max_bytes is given and the file is larger."""
    from app.common.services.document_resources import DocumentResourceError, check_size, read_bounded

    def read_local(path: Path) -> bytes:
        return read_bounded(path, max_bytes) if max_bytes is not None else path.read_bytes()

    kind, location, provider = entry["read"]
    if not location:
        raise FileNotFoundError("No stored file")
    from app.domains.storage.factory import StorageFactory

    if kind == "contract":
        from app.domains.contract.api import _resolve_contract_pdf

        data = _resolve_contract_pdf(location, provider)
        if not data:
            raise FileNotFoundError("Contract PDF not found")
        if max_bytes is not None:
            check_size(len(data), max_bytes)
        return data

    if kind == "rebuild_doc":
        # Generated docs keep a storage path in the default provider;
        # older ones sit under /uploads/
        if not location.startswith("/uploads/"):
            try:
                return StorageFactory.get_instance().download(location, max_bytes=max_bytes)
            except DocumentResourceError:
                raise
            except Exception as e:
                logger.warning(f"Rebuild doc not in storage ({location}): {e}")
        local = Path(__file__).resolve().parents[3] / location.lstrip("/")
        if local.exists():
            return read_local(local)
        raise FileNotFoundError("Rebuild document not found")

    if provider:
        in_cloud = provider != "local"
    else:
        # A files row from before storage_provider existed: tell by the url
        # (as file/thumbnails.stored_in_cloud does); a WM document without
        # one is local
        in_cloud = kind == "file" and location.startswith(("gs://", "b2://", "https://", "http://"))
    if in_cloud:
        return StorageFactory.get_instance(provider).download(location, max_bytes=max_bytes)
    local = Path(location)
    if local.exists():
        return read_local(local)
    raise FileNotFoundError("File not found on disk")


def email_attachment(entry: Dict[str, Any], max_bytes: int) -> Dict[str, Any]:
    """The file as an email attachment, its bytes in "data". Raises like
    read_hub_file. A name without an extension gets one from its type, so
    the recipient's mail app can open it."""
    data = read_hub_file(entry, max_bytes=max_bytes)
    filename = entry["filename"]
    if not Path(filename).suffix:
        filename += mimetypes.guess_extension(entry["mime_type"]) or ""
    return {
        "filename": filename,
        "data": data,
        "mime_type": entry["mime_type"],
        "size": len(data),
        # Which hub file it was; the sent email keeps no copy of the bytes
        "source": entry["source"],
        "document_id": entry["id"],
    }
