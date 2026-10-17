"""
Read-only endpoints for the AccuLynx archive (see __init__.py).

Document files are not served by the app - they live in each job's Google
Drive folder, so only the listing and a link to the folder are returned.
"""

import logging
from collections import Counter
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database_factory import get_database

from .models import AccuLynxArchivedDocument, AccuLynxArchivedJob, AccuLynxArchivedMessage

logger = logging.getLogger(__name__)

router = APIRouter()


def get_db():
    db = get_database().SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _num(value):
    return float(value) if value is not None else None


def _iso(value):
    return value.isoformat() if value else None


def _drive_url(job: AccuLynxArchivedJob):
    if job.drive_folder_id:
        return f"https://drive.google.com/drive/folders/{job.drive_folder_id}"
    if job.drive_folder_name:
        # before folder ids are mapped: Drive search finds the folder by its name
        return "https://drive.google.com/drive/search?q=" + quote(f'"{job.drive_folder_name}"')
    return None


def _job_summary(job: AccuLynxArchivedJob) -> dict:
    return {
        "id": str(job.id),
        "client_id": str(job.client_id),
        "acculynx_job_id": job.acculynx_job_id,
        "job_number": job.job_number,
        "job_name": job.job_name,
        "milestone": job.milestone,
        "trade_types": job.trade_types,
        "work_type": job.work_type,
        "address": job.address,
        "city": job.city,
        "state": job.state,
        "zipcode": job.zipcode,
        "job_created_at": _iso(job.job_created_at),
        "milestone_date": _iso(job.milestone_date),
        "insurance_company": job.insurance_company,
        "claim_number": job.claim_number,
        "date_of_loss": _iso(job.date_of_loss),
        "damage_location": job.damage_location,
        "adjuster_name": job.adjuster_name,
        "adjuster_phone": job.adjuster_phone,
        "adjuster_email": job.adjuster_email,
        "approved_job_value": _num(job.approved_job_value),
        "total_received": _num(job.total_received),
        "balance_due": _num(job.balance_due),
        "drive_folder_name": job.drive_folder_name,
        "drive_url": _drive_url(job),
        "document_count": job.document_count or 0,
        "message_count": job.message_count or 0,
    }


@router.get("/clients/{client_id}/jobs", summary="Archived AccuLynx jobs for a client")
def list_client_jobs(client_id: str, db: Session = Depends(get_db)):
    jobs = (
        db.query(AccuLynxArchivedJob)
        .filter(AccuLynxArchivedJob.client_id == client_id,
                AccuLynxArchivedJob.import_status == "complete")
        .order_by(AccuLynxArchivedJob.job_created_at.desc())
        .all()
    )
    return [_job_summary(j) for j in jobs]


@router.get("/jobs/{job_id}", summary="Archived AccuLynx job with documents, messages and payments")
def get_job(job_id: str, db: Session = Depends(get_db)):
    job = db.get(AccuLynxArchivedJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Archived job not found")

    raw = job.raw or {}
    received = ((raw.get("payments") or {}).get("receivedPayments") or {}).get("payments") or []
    payments = sorted(
        (
            {
                "date": p.get("paymentDate"),
                "amount": p.get("amount"),
                "from": (p.get("from") or "").strip() or None,
                "check_number": p.get("checkNumber") or None,
                "notes": p.get("notes") or None,
            }
            for p in received
        ),
        key=lambda p: p["date"] or "",
    )

    documents = (
        db.query(AccuLynxArchivedDocument)
        .filter(AccuLynxArchivedDocument.archived_job_id == job.id)
        .order_by(AccuLynxArchivedDocument.folder_name, AccuLynxArchivedDocument.uploaded_at)
        .all()
    )
    messages = (
        db.query(AccuLynxArchivedMessage)
        .filter(AccuLynxArchivedMessage.archived_job_id == job.id)
        .order_by(AccuLynxArchivedMessage.sent_at)
        .all()
    )

    return {
        **_job_summary(job),
        "payments": payments,
        "documents": [
            {
                "id": str(d.id),
                "folder_name": d.folder_name,
                "drive_path": d.drive_path,
                "name": d.name,
                "content_type": d.content_type,
                "size": d.size,
                "uploaded_by": d.uploaded_by,
                "uploaded_at": _iso(d.uploaded_at),
            }
            for d in documents
        ],
        "messages": [
            {
                "id": str(m.id),
                "thread_id": m.thread_id,
                "message_type": m.message_type,
                "subject": m.subject,
                "sender_name": m.sender_name,
                "sender_email": m.sender_email,
                "recipients": m.recipients or [],
                "sent_at": _iso(m.sent_at),
                "body_text": m.body_text,
                "attachments": m.attachments or [],
            }
            for m in messages
        ],
    }


@router.get("/summary", summary="Archive totals, to check an import")
def get_summary(db: Session = Depends(get_db)):
    jobs = db.query(AccuLynxArchivedJob.import_status).all()
    return {
        "jobs": dict(Counter(status for (status,) in jobs)),
        "documents": db.query(AccuLynxArchivedDocument).count(),
        "messages": db.query(AccuLynxArchivedMessage).count(),
    }
