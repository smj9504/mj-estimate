"""
AccuLynx integration API endpoints.

All routes are claim-scoped (claim_id) rather than tied to any one
domain (water mitigation, roofing, etc.) since claim_id is the
cross-domain key - see app/domains/client/models.py: Claim.
"""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database_factory import get_database

from .client import AccuLynxClient
from .lead_service import AccuLynxLeadCreationError, AccuLynxLeadService
from .models import AccuLynxJobLink, AccuLynxUpload
from .schemas import (
    AccuLynxContactLinkResponse,
    AccuLynxContactSearchItem,
    AccuLynxContactSearchResponse,
    AccuLynxCreateLeadRequest,
    AccuLynxJobSearchItem,
    AccuLynxJobSearchResponse,
    AccuLynxLinkRequest,
    AccuLynxLinkResponse,
    AccuLynxSyncResult,
    AccuLynxUploadStatus,
    AccuLynxUserItem,
)
from .service import AccuLynxSyncError, AccuLynxSyncService

logger = logging.getLogger(__name__)

router = APIRouter()


def get_db():
    database = get_database()
    db = database.get_session()
    try:
        yield db
    finally:
        db.close()


@router.get("/jobs/search", response_model=AccuLynxJobSearchResponse, summary="Search AccuLynx jobs/leads")
async def search_acculynx_jobs(q: str):
    """Search AccuLynx jobs (leads) by address/name text, for the claim-linking picker."""
    client = AccuLynxClient()
    try:
        raw = await client.search_jobs(search_term=q)
    except Exception as e:
        logger.error(f"AccuLynx job search failed: {e}")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"AccuLynx search failed: {e}")

    items = []
    for item in raw.get("items", []):
        address = item.get("locationAddress") or {}
        address_str = ", ".join(
            filter(None, [address.get("street1"), address.get("city"), address.get("state")])
        )
        items.append(AccuLynxJobSearchItem(
            id=item.get("id"),
            job_number=item.get("jobNumber"),
            job_name=item.get("jobName"),
            address=address_str or None,
            current_milestone=item.get("currentMilestone")
        ))

    return AccuLynxJobSearchResponse(items=items, count=raw.get("count", len(items)))


@router.get("/contacts/search", response_model=AccuLynxContactSearchResponse, summary="Search AccuLynx contacts")
async def search_acculynx_contacts(q: str):
    """Search AccuLynx contacts by name/company, for the create-lead picker."""
    client = AccuLynxClient()
    try:
        raw = await client.search_contacts(search_term=q)
    except Exception as e:
        logger.error(f"AccuLynx contact search failed: {e}")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"AccuLynx contact search failed: {e}")

    items = []
    for item in raw.get("items", []):
        address = item.get("mailingAddress") or {}
        state = address.get("state") or {}
        address_str = ", ".join(
            filter(None, [address.get("street1"), address.get("city"), state.get("abbreviation")])
        )
        emails = item.get("emailAddresses") or []
        phones = item.get("phoneNumbers") or []
        items.append(AccuLynxContactSearchItem(
            id=item.get("id"),
            first_name=item.get("firstName"),
            last_name=item.get("lastName"),
            company_name=item.get("companyName"),
            email=emails[0].get("address") if emails else None,
            phone=phones[0].get("number") if phones else None,
            address=address_str or None
        ))

    return AccuLynxContactSearchResponse(items=items, count=raw.get("count", len(items)))


@router.get("/users", response_model=list[AccuLynxUserItem], summary="List AccuLynx company users")
async def list_acculynx_users():
    """List active company users, for the job-representative picker."""
    client = AccuLynxClient()
    try:
        raw = await client.get_users()
    except Exception as e:
        logger.error(f"AccuLynx user list failed: {e}")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"AccuLynx user list failed: {e}")

    return [
        AccuLynxUserItem(
            id=u.get("id"),
            display_name=u.get("displayName") or f"{u.get('firstName', '')} {u.get('lastName', '')}".strip(),
            role=(u.get("role") or {}).get("name")
        )
        for u in raw
    ]


@router.post("/claims/{claim_id}/create-lead", response_model=AccuLynxLinkResponse, summary="Create a new AccuLynx lead for a claim")
async def create_acculynx_lead(
    claim_id: str,
    payload: AccuLynxCreateLeadRequest,
    db: Session = Depends(get_db)
):
    """
    Create a brand new AccuLynx job/lead (optionally creating a new
    contact first) and link it to this claim. See
    AccuLynxLeadService.create_lead for the full flow.
    """
    service = AccuLynxLeadService(db)
    try:
        return await service.create_lead(claim_id, payload)
    except AccuLynxLeadCreationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"AccuLynx lead creation failed for claim {claim_id}: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"AccuLynx lead creation failed: {e}")


@router.get(
    "/clients/{client_id}/contact-link",
    response_model=AccuLynxContactLinkResponse,
    summary="Get a client's linked AccuLynx contact, if any"
)
async def get_client_acculynx_contact_link(client_id: str, db: Session = Depends(get_db)):
    """
    Look up the AccuLynx contact previously used for this client (customer),
    so the create-lead form can offer to reuse it instead of creating a
    duplicate contact for another one of their claims.
    """
    service = AccuLynxLeadService(db)
    result = await service.get_contact_link_display(client_id)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No AccuLynx contact linked for this client")
    return result


@router.post("/claims/{claim_id}/link", response_model=AccuLynxLinkResponse, summary="Link a claim to an AccuLynx job")
async def link_claim_to_acculynx(
    claim_id: str,
    payload: AccuLynxLinkRequest,
    db: Session = Depends(get_db)
):
    existing = db.query(AccuLynxJobLink).filter(AccuLynxJobLink.claim_id == claim_id).first()

    if existing:
        existing.acculynx_job_id = payload.acculynx_job_id
        existing.acculynx_job_number = payload.acculynx_job_number
        existing.linked_at = datetime.utcnow()
    else:
        existing = AccuLynxJobLink(
            claim_id=claim_id,
            acculynx_job_id=payload.acculynx_job_id,
            acculynx_job_number=payload.acculynx_job_number
        )
        db.add(existing)

    db.commit()
    db.refresh(existing)
    return existing


@router.delete("/claims/{claim_id}/link", status_code=status.HTTP_204_NO_CONTENT, summary="Unlink a claim from AccuLynx")
async def unlink_claim_from_acculynx(claim_id: str, db: Session = Depends(get_db)):
    link = db.query(AccuLynxJobLink).filter(AccuLynxJobLink.claim_id == claim_id).first()
    if link:
        db.delete(link)
        db.commit()
    return None


@router.get("/claims/{claim_id}/link", response_model=AccuLynxLinkResponse, summary="Get a claim's AccuLynx link")
async def get_claim_acculynx_link(claim_id: str, db: Session = Depends(get_db)):
    link = db.query(AccuLynxJobLink).filter(AccuLynxJobLink.claim_id == claim_id).first()
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim is not linked to an AccuLynx job")
    return link


@router.post("/claims/{claim_id}/sync", response_model=AccuLynxSyncResult, summary="Send claim files to AccuLynx")
async def sync_claim_to_acculynx(claim_id: str, db: Session = Depends(get_db)):
    """
    Send all not-yet-synced files for this claim (generic claim files +
    water mitigation photos/documents, if any) to the linked AccuLynx job.
    """
    service = AccuLynxSyncService(db)
    try:
        return await service.sync_claim_files(claim_id)
    except AccuLynxSyncError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"AccuLynx sync failed for claim {claim_id}: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Sync failed: {e}")


@router.get("/claims/{claim_id}/sync-status", response_model=list[AccuLynxUploadStatus], summary="Get sync status for a claim")
async def get_claim_sync_status(claim_id: str, db: Session = Depends(get_db)):
    rows = db.query(AccuLynxUpload).filter(AccuLynxUpload.claim_id == claim_id).all()
    return rows


@router.get("/health", summary="AccuLynx integration health check")
async def acculynx_health_check():
    from app.core.config import settings

    client = AccuLynxClient()
    healthy = await client.health_check()
    return {
        "service_name": "acculynx",
        "is_configured": bool(settings.ACCULYNX_API_KEY and settings.ACCULYNX_DOCUMENT_FOLDER_ID),
        "is_healthy": healthy
    }
