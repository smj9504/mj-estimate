"""
Client, Claim, and ClaimNegotiation API endpoints
"""

import logging
import os
import tempfile
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.core.database_factory import get_db_session as get_db
from app.domains.client.schemas import (
    ClientCreate,
    ClientUpdate,
    ClientListResponse,
    ClientDetailResponse,
    ClaimCreate,
    ClaimUpdate,
    ClaimSummaryResponse,
    ClaimDetailResponse,
    ClaimNegotiationCreate,
    ClaimNegotiationUpdate,
    ClaimNegotiationResponse,
)
from app.domains.client.service import ClientService, ClaimService, ClaimNegotiationService

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_client_service():
    from app.core.database_factory import get_database
    return ClientService(get_database())


def _get_claim_service():
    from app.core.database_factory import get_database
    return ClaimService(get_database())


def _get_negotiation_service():
    from app.core.database_factory import get_database
    return ClaimNegotiationService(get_database())


# ============================================================
# Client endpoints
# ============================================================

@router.get("/", response_model=None)
async def list_clients(
    skip: int = 0,
    limit: int = 100,
    search: Optional[str] = None,
    is_active: Optional[bool] = None,
    service: ClientService = Depends(_get_client_service),
):
    """List all clients with claim counts"""
    try:
        if search:
            clients = service.search(search, limit=limit)
            return {"clients": clients, "total": len(clients)}

        filters = {}
        if is_active is not None:
            filters['is_active'] = is_active

        clients = service.get_all_with_counts(
            filters=filters if filters else None,
            limit=limit,
            offset=skip,
        )
        return {"clients": clients, "total": len(clients), "skip": skip, "limit": limit}
    except Exception as e:
        logger.error(f"Error listing clients: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/", response_model=None)
async def create_client(
    data: ClientCreate,
    db=Depends(get_db),
    service: ClientService = Depends(_get_client_service),
):
    """Create a new client"""
    try:
        client_dict = data.dict()
        # Convert owners to list of dicts
        if 'owners' in client_dict:
            client_dict['owners'] = [
                o if isinstance(o, dict) else o
                for o in client_dict['owners']
            ]
        result = service.create(client_dict)
        return result
    except Exception as e:
        logger.error(f"Error creating client: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/search")
async def search_clients(
    q: str,
    limit: int = 20,
    service: ClientService = Depends(_get_client_service),
):
    """Search clients by name"""
    try:
        results = service.search(q, limit=limit)
        return {"clients": results, "total": len(results)}
    except Exception as e:
        logger.error(f"Error searching clients: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{client_id}", response_model=None)
async def get_client(
    client_id: str,
    service: ClientService = Depends(_get_client_service),
):
    """Get client detail with all claims and documents"""
    try:
        client = service.get_with_claims(client_id)
        if not client:
            raise HTTPException(status_code=404, detail="Client not found")
        return client
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting client: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{client_id}", response_model=None)
async def update_client(
    client_id: str,
    data: ClientUpdate,
    service: ClientService = Depends(_get_client_service),
):
    """Update a client"""
    try:
        update_dict = data.dict(exclude_unset=True)
        result = service.update(client_id, update_dict)
        if not result:
            raise HTTPException(status_code=404, detail="Client not found")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating client: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{client_id}")
async def delete_client(
    client_id: str,
    service: ClientService = Depends(_get_client_service),
):
    """Delete a client"""
    try:
        success = service.delete(client_id)
        if not success:
            raise HTTPException(status_code=404, detail="Client not found")
        return {"message": "Client deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting client: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Claim endpoints (nested under client)
# ============================================================

@router.get("/{client_id}/claims", response_model=None)
async def list_claims(
    client_id: str,
    service: ClaimService = Depends(_get_claim_service),
):
    """List all claims for a client"""
    try:
        claims = service.get_by_client(client_id)
        return {"claims": claims, "total": len(claims)}
    except Exception as e:
        logger.error(f"Error listing claims: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{client_id}/claims", response_model=None)
async def create_claim(
    client_id: str,
    data: ClaimCreate,
    service: ClaimService = Depends(_get_claim_service),
):
    """Create a new claim for a client"""
    try:
        claim_dict = data.dict()
        claim_dict['client_id'] = client_id
        result = service.create_with_initial_negotiation(claim_dict)
        return result
    except Exception as e:
        logger.error(f"Error creating claim: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{client_id}/claims/{claim_id}", response_model=None)
async def get_claim(
    client_id: str,
    claim_id: str,
    service: ClaimService = Depends(_get_claim_service),
):
    """Get claim detail with negotiations and linked documents"""
    try:
        claim = service.get_with_details(claim_id)
        if not claim:
            raise HTTPException(status_code=404, detail="Claim not found")
        return claim
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting claim: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{client_id}/claims/{claim_id}", response_model=None)
async def update_claim(
    client_id: str,
    claim_id: str,
    data: ClaimUpdate,
    service: ClaimService = Depends(_get_claim_service),
):
    """Update a claim"""
    try:
        update_dict = data.dict(exclude_unset=True)
        result = service.update(claim_id, update_dict)
        if not result:
            raise HTTPException(status_code=404, detail="Claim not found")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating claim: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{client_id}/claims/{claim_id}")
async def delete_claim(
    client_id: str,
    claim_id: str,
    service: ClaimService = Depends(_get_claim_service),
):
    """Delete a claim"""
    try:
        success = service.delete(claim_id)
        if not success:
            raise HTTPException(status_code=404, detail="Claim not found")
        return {"message": "Claim deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting claim: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{client_id}/claims/{claim_id}/documents", response_model=None)
async def get_claim_documents(
    client_id: str,
    claim_id: str,
    service: ClaimService = Depends(_get_claim_service),
):
    """Get all documents linked to a claim"""
    try:
        documents = service.get_linked_documents(claim_id)
        return documents
    except Exception as e:
        logger.error(f"Error getting claim documents: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Negotiation endpoints (nested under claim)
# ============================================================

@router.post("/{client_id}/claims/{claim_id}/negotiations/extract-pdf", response_model=None)
async def extract_pdf_summary(
    client_id: str,
    claim_id: str,
    file: UploadFile = File(...),
):
    """Upload insurance estimate PDF and extract summary sections via AI.
    Returns extracted sections for user review before saving.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    tmp_path = None
    try:
        # Read file content
        file_content = await file.read()
        file_name = file.filename

        # Save uploaded file to storage via FileService
        import io
        from app.core.database_factory import get_database
        from app.domains.file.service import FileService

        db = get_database()
        session = db.get_session()
        try:
            file_service = FileService(db)
            file_data = io.BytesIO(file_content)

            file_record = await file_service.upload_file(
                file_data=file_data,
                original_filename=file_name,
                content_type=file.content_type or "application/pdf",
                context="negotiation",
                context_id=claim_id,
            )
            session.commit()
            file_id = str(file_record.get("id", ""))
        finally:
            session.close()

        # Write to temp file for PDF parsing
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".pdf")
        try:
            with os.fdopen(tmp_fd, "wb") as tmp_f:
                tmp_f.write(file_content)
        except Exception:
            try:
                os.close(tmp_fd)
            except OSError:
                pass
            raise

        # Extract summary sections
        from app.domains.client.negotiation_pdf_service import extract_summary_from_pdf
        result = extract_summary_from_pdf(tmp_path)

        return {
            "sections": result["sections"],
            "totals": result["totals"],
            "validation": result["validation"],
            "file_id": file_id,
            "file_name": file_name,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error extracting PDF summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path and os.path.isfile(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


@router.get("/{client_id}/claims/{claim_id}/negotiations", response_model=None)
async def list_negotiations(
    client_id: str,
    claim_id: str,
    service: ClaimNegotiationService = Depends(_get_negotiation_service),
):
    """List all negotiation revisions for a claim"""
    try:
        negotiations = service.get_by_claim(claim_id)
        return {"negotiations": negotiations, "total": len(negotiations)}
    except Exception as e:
        logger.error(f"Error listing negotiations: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{client_id}/claims/{claim_id}/negotiations", response_model=None)
async def add_negotiation(
    client_id: str,
    claim_id: str,
    data: ClaimNegotiationCreate,
    service: ClaimNegotiationService = Depends(_get_negotiation_service),
):
    """Add a new negotiation revision (auto-updates claim amounts)"""
    try:
        neg_dict = data.dict()
        neg_dict['claim_id'] = claim_id
        result = service.add_negotiation(neg_dict)
        return result
    except Exception as e:
        logger.error(f"Error adding negotiation: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{client_id}/claims/{claim_id}/negotiations/{negotiation_id}", response_model=None)
async def update_negotiation(
    client_id: str,
    claim_id: str,
    negotiation_id: str,
    data: ClaimNegotiationUpdate,
    service: ClaimNegotiationService = Depends(_get_negotiation_service),
):
    """Update a negotiation revision"""
    try:
        update_dict = data.dict(exclude_unset=True)
        result = service.update(negotiation_id, update_dict)
        if not result:
            raise HTTPException(status_code=404, detail="Negotiation not found")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating negotiation: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{client_id}/claims/{claim_id}/negotiations/{negotiation_id}")
async def delete_negotiation(
    client_id: str,
    claim_id: str,
    negotiation_id: str,
    service: ClaimNegotiationService = Depends(_get_negotiation_service),
):
    """Delete a negotiation revision"""
    try:
        success = service.delete(negotiation_id)
        if not success:
            raise HTTPException(status_code=404, detail="Negotiation not found")
        return {"message": "Negotiation deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting negotiation: {e}")
        raise HTTPException(status_code=500, detail=str(e))
