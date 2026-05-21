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
    ClaimPaymentCreate,
    ClaimPaymentUpdate,
    ClaimPaymentResponse,
    PaymentSummary,
    ClaimExpenseCreate,
    ClaimExpenseUpdate,
    ClaimExpenseResponse,
    ProfitabilitySummary,
)
from app.domains.client.service import ClientService, ClaimService, ClaimNegotiationService, ClaimPaymentService, ClaimExpenseService

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


def _get_payment_service():
    from app.core.database_factory import get_database
    return ClaimPaymentService(get_database())


def _get_expense_service():
    from app.core.database_factory import get_database
    return ClaimExpenseService(get_database())


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


@router.get("/{client_id}/latest-date-of-loss", response_model=None)
async def get_latest_date_of_loss(
    client_id: str,
    db=Depends(get_db),
):
    """Get the latest date_of_loss from WM jobs linked to this client's claims"""
    try:
        from app.domains.water_mitigation.models import WaterMitigationJob
        from app.domains.client.models import Claim
        from sqlalchemy import desc

        # Find WM jobs linked via claims belonging to this client
        latest_wm = (
            db.query(WaterMitigationJob.date_of_loss)
            .join(Claim, WaterMitigationJob.claim_id == Claim.id)
            .filter(Claim.client_id == client_id)
            .filter(WaterMitigationJob.date_of_loss.isnot(None))
            .order_by(desc(WaterMitigationJob.date_of_loss))
            .first()
        )

        if latest_wm and latest_wm.date_of_loss:
            return {"date_of_loss": latest_wm.date_of_loss.isoformat()}

        # Fallback: check claim's own date_of_loss
        latest_claim = (
            db.query(Claim.date_of_loss)
            .filter(Claim.client_id == client_id)
            .filter(Claim.date_of_loss.isnot(None))
            .order_by(desc(Claim.date_of_loss))
            .first()
        )

        if latest_claim and latest_claim.date_of_loss:
            return {"date_of_loss": latest_claim.date_of_loss.isoformat()}

        return {"date_of_loss": None}
    except Exception as e:
        logger.error(f"Error getting latest date_of_loss: {e}")
        return {"date_of_loss": None}


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
        file_service = FileService(db)
        try:
            file_data = io.BytesIO(file_content)

            file_record = await file_service.upload_file(
                file_data=file_data,
                original_filename=file_name,
                content_type=file.content_type or "application/pdf",
                context="negotiation",
                context_id=claim_id,
            )
            file_service.repository.db_session.commit()
            file_id = str(file_record.get("id", ""))
        finally:
            file_service.repository.db_session.close()

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
    """Add a new negotiation revision (auto-updates claim amounts, creates supplement for review)"""
    try:
        neg_dict = data.dict()
        neg_dict['claim_id'] = claim_id
        result = service.add_negotiation(neg_dict)

        # Auto-create supplement for review
        try:
            from app.domains.claim_followup.service import ClaimFollowUpService
            followup_service = ClaimFollowUpService()
            from app.core.database_factory import get_database
            db = get_database()
            session = db.get_session()
            try:
                from app.domains.client.models import Claim
                claim = session.query(Claim).filter(Claim.id == claim_id).first()
                if claim:
                    estimate_data = {
                        'rcv_amount': float(neg_dict.get('rcv_amount', 0)),
                        'acv_amount': float(neg_dict.get('acv_amount', 0)),
                    }
                    followup_service._auto_create_supplement(session, claim, estimate_data)
                    session.commit()
            finally:
                session.close()
        except Exception as e:
            logger.warning(f"Auto supplement creation failed: {e}")

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

        # Resolve file_id to document_url/document_name
        file_id = update_dict.pop('file_id', None)
        if file_id:
            from app.domains.file.models import File as FileModel
            from app.core.database_factory import get_database
            database = get_database()
            file_session = database.get_readonly_session()
            try:
                file_rec = file_session.query(FileModel).filter(
                    FileModel.id == file_id, FileModel.is_active == True
                ).first()
                if file_rec:
                    update_dict['document_url'] = str(file_rec.id)
                    update_dict['document_name'] = file_rec.original_name
            finally:
                file_session.close()

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


# ============================================================
# Claim Payment endpoints
# ============================================================

@router.get("/{client_id}/claims/{claim_id}/payments", response_model=None)
async def get_payments(
    client_id: str,
    claim_id: str,
    service: ClaimPaymentService = Depends(_get_payment_service),
):
    """Get all payments for a claim"""
    try:
        return service.get_payments_by_claim(claim_id)
    except Exception as e:
        logger.error(f"Error getting payments: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{client_id}/claims/{claim_id}/payment-summary", response_model=None)
async def get_payment_summary(
    client_id: str,
    claim_id: str,
    service: ClaimPaymentService = Depends(_get_payment_service),
):
    """Get payment summary with invoice vs insurance comparison"""
    try:
        return service.get_payment_summary(claim_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting payment summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{client_id}/claims/{claim_id}/payments", response_model=None)
async def create_payment(
    client_id: str,
    claim_id: str,
    data: ClaimPaymentCreate,
    service: ClaimPaymentService = Depends(_get_payment_service),
):
    """Record a new payment"""
    try:
        payment_data = data.dict()
        payment_data['claim_id'] = claim_id
        return service.create_payment(payment_data)
    except Exception as e:
        logger.error(f"Error creating payment: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{client_id}/claims/{claim_id}/payments/{payment_id}", response_model=None)
async def update_payment(
    client_id: str,
    claim_id: str,
    payment_id: str,
    data: ClaimPaymentUpdate,
    service: ClaimPaymentService = Depends(_get_payment_service),
):
    """Update a payment record"""
    try:
        update_data = data.dict(exclude_unset=True)
        result = service.update_payment(payment_id, update_data)
        if not result:
            raise HTTPException(status_code=404, detail="Payment not found")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating payment: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{client_id}/claims/{claim_id}/payments/{payment_id}")
async def delete_payment(
    client_id: str,
    claim_id: str,
    payment_id: str,
    service: ClaimPaymentService = Depends(_get_payment_service),
):
    """Delete a payment record"""
    try:
        success = service.delete_payment(payment_id)
        if not success:
            raise HTTPException(status_code=404, detail="Payment not found")
        return {"message": "Payment deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting payment: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Claim Expense & Profitability endpoints
# ============================================================

@router.get("/{client_id}/claims/{claim_id}/expenses", response_model=None)
async def get_expenses(
    client_id: str, claim_id: str,
    service: ClaimExpenseService = Depends(_get_expense_service),
):
    """Get all expenses for a claim"""
    return service.get_expenses_by_claim(claim_id)


@router.get("/{client_id}/claims/{claim_id}/profitability", response_model=None)
async def get_profitability(
    client_id: str, claim_id: str,
    service: ClaimExpenseService = Depends(_get_expense_service),
):
    """Get profitability summary (revenue, PA fee, expenses, profit)"""
    try:
        return service.get_profitability_summary(claim_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{client_id}/claims/{claim_id}/expenses", response_model=None)
async def create_expense(
    client_id: str, claim_id: str, data: ClaimExpenseCreate,
    service: ClaimExpenseService = Depends(_get_expense_service),
):
    """Record an expense"""
    expense_data = data.dict()
    expense_data['claim_id'] = claim_id
    try:
        return service.create_expense(expense_data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{client_id}/claims/{claim_id}/expenses/{expense_id}", response_model=None)
async def update_expense(
    client_id: str, claim_id: str, expense_id: str, data: ClaimExpenseUpdate,
    service: ClaimExpenseService = Depends(_get_expense_service),
):
    """Update an expense"""
    result = service.update_expense(expense_id, data.dict(exclude_unset=True))
    if not result:
        raise HTTPException(status_code=404, detail="Expense not found")
    return result


@router.delete("/{client_id}/claims/{claim_id}/expenses/{expense_id}")
async def delete_expense(
    client_id: str, claim_id: str, expense_id: str,
    service: ClaimExpenseService = Depends(_get_expense_service),
):
    """Delete an expense"""
    if not service.delete_expense(expense_id):
        raise HTTPException(status_code=404, detail="Expense not found")
    return {"message": "Expense deleted"}


# ============================================================
# Claim Activity (History) endpoints
# ============================================================

@router.get("/{client_id}/claims/{claim_id}/activities", response_model=None)
async def get_claim_activities(client_id: str, claim_id: str):
    """Get all activity history for a claim"""
    from app.core.database_factory import get_database
    from app.domains.client.models import ClaimActivity

    database = get_database()
    session = database.get_readonly_session()
    try:
        activities = session.query(ClaimActivity).filter(
            ClaimActivity.claim_id == claim_id
        ).order_by(ClaimActivity.created_at.desc()).all()

        return [
            {
                "id": str(a.id),
                "claim_id": str(a.claim_id),
                "activity_type": a.activity_type,
                "title": a.title,
                "description": a.description,
                "related_entity_type": a.related_entity_type,
                "related_entity_id": str(a.related_entity_id) if a.related_entity_id else None,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in activities
        ]
    finally:
        session.close()
