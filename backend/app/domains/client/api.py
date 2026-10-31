"""
Client, Claim, and ClaimNegotiation API endpoints
"""

import asyncio
import logging
import os
import tempfile
import uuid
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile

from app.core.database_factory import get_db_session as get_db
from app.domains.auth import company_scope
from app.domains.auth.dependencies import get_current_staff, require_admin
from app.domains.auth.document_access import can_access_document
from app.domains.client.claim_paths import SameCompanyAsWMError
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
    ClaimNoteCreate,
    ClaimNoteUpdate,
    ClaimTodoCreate,
    ClaimTodoUpdate,
    TodoCreate,
    TodoReorder,
    TodoUpdate,
)
from app.domains.client.service import (
    ClientService, ClaimService, ClaimNegotiationService,
    ClaimPaymentService, ClaimExpenseService,
    ClaimNoteService, ClaimTodoService,
)

logger = logging.getLogger(__name__)


def _claim_row_models():
    from app.domains.client.models import (
        ClaimExpense, ClaimNegotiation, ClaimNote, ClaimPayment, ClaimTodo,
    )
    return {
        'negotiation_id': (ClaimNegotiation, 'Negotiation'),
        'payment_id': (ClaimPayment, 'Payment'),
        'expense_id': (ClaimExpense, 'Expense'),
        'note_id': (ClaimNote, 'Note'),
        'todo_id': (ClaimTodo, 'Todo'),
    }


def _guard_path(request: Request, staff=Depends(get_current_staff), db=Depends(get_db)):
    """Every route here with a client, claim or claim row in its path answers
    404 unless the signed-in person may see it (auth/company_scope.py). The
    row's own claim decides, not the ids before it in the path."""
    if company_scope.sees_everything(staff):
        return
    params = request.path_params
    for key, (model, label) in _claim_row_models().items():
        if key in params:
            company_scope.require_document(db, staff, model, params[key], label, company_attr=None)
    if 'claim_id' in params:
        company_scope.require_claim(db, staff, params['claim_id'])
    elif 'client_id' in params:
        company_scope.require_client(db, staff, params['client_id'])


# Client and claim data is staff-only: every endpoint here needs a signed-in
# staff member, and only reaches the clients and claims they may see
router = APIRouter(dependencies=[Depends(get_current_staff), Depends(_guard_path)])


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


def _get_note_service():
    from app.core.database_factory import get_database
    return ClaimNoteService(get_database())


def _get_todo_service():
    from app.core.database_factory import get_database
    return ClaimTodoService(get_database())


# ============================================================
# Client endpoints
# ============================================================

@router.get("/", response_model=None)
def list_clients(
    skip: int = 0,
    limit: int = 100,
    search: Optional[str] = None,
    is_active: Optional[bool] = None,
    source: Optional[str] = None,  # 'acculynx' | 'manual'
    current_staff=Depends(get_current_staff),
    service: ClientService = Depends(_get_client_service),
):
    """List the clients the signed-in person may see, with claim counts"""
    try:
        counts = service.count_by_source(staff=current_staff)
        if search:
            clients = service.search(search, limit=limit, source=source, staff=current_staff)
            return {"clients": clients, "total": len(clients), "counts": counts}

        filters = {}
        if is_active is not None:
            filters['is_active'] = is_active

        clients = service.get_all_with_counts(
            filters=filters if filters else None,
            limit=limit,
            offset=skip,
            source=source,
            staff=current_staff,
        )
        return {"clients": clients, "total": len(clients), "skip": skip, "limit": limit,
                "counts": counts}
    except Exception as e:
        logger.error(f"Error listing clients: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/", response_model=None)
def create_client(
    data: ClientCreate,
    db=Depends(get_db),
    current_staff=Depends(get_current_staff),
    service: ClientService = Depends(_get_client_service),
):
    """Create a new client"""
    own_companies = company_scope.company_ids(db, current_staff)
    if own_companies is not None:
        # Until it has a claim, the client shows to the people of the company managing it
        if not own_companies:
            raise HTTPException(
                status_code=400,
                detail="You don't belong to a company yet. Ask an admin to add you to one.",
            )
        if not data.company_id or str(data.company_id) not in own_companies:
            home = company_scope.home_company_ids(db, current_staff)
            data.company_id = (home or own_companies)[0]
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
def search_clients(
    q: str,
    limit: int = 20,
    current_staff=Depends(get_current_staff),
    service: ClientService = Depends(_get_client_service),
):
    """Search clients by name"""
    try:
        results = service.search(q, limit=limit, staff=current_staff)
        return {"clients": results, "total": len(results)}
    except Exception as e:
        logger.error(f"Error searching clients: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/claims/search")
def search_claims(
    q: Optional[str] = None,
    claim_id: Optional[str] = None,
    limit: int = 20,
    db=Depends(get_db),
    current_staff=Depends(get_current_staff),
):
    """Search the claims and cash jobs the signed-in person may see by client
    name, property address, or claim number. Pass claim_id instead of q to
    resolve a single known claim (e.g. a preset form value)."""
    from sqlalchemy import or_
    from app.domains.client.models import Client, Claim

    if not q and not claim_id:
        return {"claims": [], "total": 0}

    try:
        query = db.query(Claim, Client).join(Client, Client.id == Claim.client_id)
        query = company_scope.scoped(query, company_scope.claim_condition(db, current_staff, Claim.id))
        if claim_id:
            query = query.filter(Claim.id == claim_id)
        else:
            term = f"%{q.strip()}%"
            query = query.filter(or_(
                Client.display_name.ilike(term),
                Client.address.ilike(term),
                Client.city.ilike(term),
                Claim.claim_number.ilike(term),
            ))
        rows = (
            query
            .order_by(Claim.created_at.desc())
            .limit(limit)
            .all()
        )
        claims = []
        for claim, client in rows:
            address = ', '.join(p for p in [client.address, client.city, client.state] if p)
            claims.append({
                'id': str(claim.id),
                'client_id': str(client.id),
                'claim_number': claim.claim_number,
                'claim_type': claim.claim_type or 'insurance',
                'insurance_company': claim.insurance_company,
                'date_of_loss': claim.date_of_loss.isoformat() if claim.date_of_loss else None,
                'client_name': client.display_name,
                'address': address,
            })
        return {"claims": claims, "total": len(claims)}
    except Exception as e:
        logger.error(f"Error searching claims: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{client_id}", response_model=None)
def get_client(
    client_id: str,
    current_staff=Depends(get_current_staff),
    service: ClientService = Depends(_get_client_service),
):
    """Get client detail with the claims and documents the signed-in person may see"""
    try:
        client = service.get_with_claims(client_id, staff=current_staff)
        if not client:
            raise HTTPException(status_code=404, detail="Client not found")
        return client
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting client: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{client_id}", response_model=None)
def update_client(
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


@router.get("/{client_id}/delete-preview")
def get_client_delete_preview(
    client_id: str,
    _admin=Depends(require_admin),
    db=Depends(get_db),
):
    """What deleting a client would take with it"""
    from app.domains.client.client_delete import linked_counts

    items = linked_counts(db, client_id)
    if items is None:
        raise HTTPException(status_code=404, detail="Client not found")
    return {"items": items}


@router.delete("/{client_id}")
def delete_client(
    client_id: str,
    background_tasks: BackgroundTasks,
    _admin=Depends(require_admin),
    db=Depends(get_db),
):
    """Delete a client and everything linked to it"""
    from app.domains.client.client_delete import delete_client_and_everything, delete_stored_files

    try:
        stored_files = delete_client_and_everything(db, client_id)
        if stored_files is None:
            raise HTTPException(status_code=404, detail="Client not found")
        db.commit()
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error deleting client: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    background_tasks.add_task(delete_stored_files, stored_files)
    return {"message": "Client deleted successfully"}


# ============================================================
# Claim endpoints (nested under client)
# ============================================================

@router.get("/{client_id}/claims", response_model=None)
def list_claims(
    client_id: str,
    current_staff=Depends(get_current_staff),
    service: ClaimService = Depends(_get_claim_service),
    db=Depends(get_db),
):
    """List a client's claims and cash jobs that the signed-in person may see"""
    try:
        claims = service.get_by_client(client_id, staff=current_staff)

        # Resolve pa_contact_id -> CompanyContact for claims where the PA was
        # linked via a company contact rather than typed into the freetext
        # pa_name/pa_email/pa_company fields (same priority as
        # water_mitigation/adjuster_email_service.py's PA resolution), so
        # callers that only read claim.pa_email (e.g. the client email
        # composer's "To" options) still find the right address.
        from app.domains.company.models import CompanyContact

        contact_ids = {c.get('pa_contact_id') for c in claims if c.get('pa_contact_id') and not c.get('pa_email')}
        if contact_ids:
            contacts = db.query(CompanyContact).filter(CompanyContact.id.in_(contact_ids)).all()
            contacts_by_id = {str(c.id): c for c in contacts}
            for claim in claims:
                contact = contacts_by_id.get(claim.get('pa_contact_id'))
                if contact and not claim.get('pa_email'):
                    claim['pa_name'] = contact.name or claim.get('pa_name')
                    claim['pa_email'] = contact.email or claim.get('pa_email')
                    if contact.company:
                        claim['pa_company'] = contact.company.name or claim.get('pa_company')

        return {"claims": claims, "total": len(claims)}
    except Exception as e:
        logger.error(f"Error listing claims: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{client_id}/latest-date-of-loss", response_model=None)
def get_latest_date_of_loss(
    client_id: str,
    db=Depends(get_db),
    current_staff=Depends(get_current_staff),
):
    """Get the latest date_of_loss from WM jobs linked to this client's claims"""
    try:
        from app.domains.water_mitigation.models import WaterMitigationJob
        from app.domains.client.models import Claim
        from sqlalchemy import desc

        # Find WM jobs linked via claims belonging to this client
        claim_scope = company_scope.claim_condition(db, current_staff, Claim.id)
        latest_wm = (
            company_scope.scoped(
                db.query(WaterMitigationJob.date_of_loss)
                .join(Claim, WaterMitigationJob.claim_id == Claim.id)
                .filter(Claim.client_id == client_id)
                .filter(WaterMitigationJob.date_of_loss.isnot(None)),
                claim_scope,
            )
            .order_by(desc(WaterMitigationJob.date_of_loss))
            .first()
        )

        if latest_wm and latest_wm.date_of_loss:
            return {"date_of_loss": latest_wm.date_of_loss.isoformat()}

        # Fallback: check claim's own date_of_loss
        latest_claim = (
            company_scope.scoped(
                db.query(Claim.date_of_loss)
                .filter(Claim.client_id == client_id)
                .filter(Claim.date_of_loss.isnot(None)),
                claim_scope,
            )
            .order_by(desc(Claim.date_of_loss))
            .first()
        )

        if latest_claim and latest_claim.date_of_loss:
            return {"date_of_loss": latest_claim.date_of_loss.isoformat()}

        return {"date_of_loss": None}
    except Exception as e:
        logger.error(f"Error getting latest date_of_loss: {e}")
        return {"date_of_loss": None}


def _checked_company_ids(db, staff, company_ids, creating: bool) -> List[str]:
    """The companies to put on a claim. Someone who isn't an admin has to keep
    one of their own on it, or they would lose the claim; a new claim with
    none picked gets the ones picked for them (never every company)."""
    ids = [str(c) for c in company_ids or []]
    own = company_scope.company_ids(db, staff)
    if own is None:
        return ids
    if not ids and creating:
        ids = company_scope.home_company_ids(db, staff)
        if not ids and own:
            raise HTTPException(status_code=400, detail="Pick the companies working it")
    if not set(ids) & set(own):
        raise HTTPException(
            status_code=400,
            detail="Keep at least one of your companies on it, or you won't be able to see it",
        )
    return ids


@router.post("/{client_id}/claims", response_model=None)
def create_claim(
    client_id: str,
    data: ClaimCreate,
    db=Depends(get_db),
    current_staff=Depends(get_current_staff),
    service: ClaimService = Depends(_get_claim_service),
):
    """Create a new claim or cash job for a client"""
    claim_dict = data.dict()
    company_ids = _checked_company_ids(db, current_staff, claim_dict.pop('company_ids', None), creating=True)
    try:
        claim_dict['client_id'] = client_id
        result = service.create_with_initial_negotiation(claim_dict, company_ids=company_ids)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating claim: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{client_id}/claims/{claim_id}", response_model=None)
def get_claim(
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


def _sync_claim_pa_fields(update_dict: dict, contact_id: str) -> None:
    """
    Mirror a linked PA CompanyContact onto the claim's denormalized pa_*
    columns (in place). Clearing the link clears the mirror.

    Only fills fields the caller did not set explicitly, so a manually typed
    name or email still wins over the contact record.
    """
    if not contact_id:
        update_dict.setdefault('pa_name', None)
        update_dict.setdefault('pa_company', None)
        update_dict.setdefault('pa_email', None)
        update_dict.setdefault('pa_phone', None)
        update_dict.setdefault('has_public_adjuster', False)
        return

    try:
        from app.domains.company.models import Company, CompanyContact
        from app.core.database_factory import get_database

        session = get_database().get_session()
        try:
            contact = session.query(CompanyContact).filter(
                CompanyContact.id == contact_id
            ).first()
            if not contact:
                return
            update_dict.setdefault('pa_name', contact.name or None)
            update_dict.setdefault('pa_email', contact.email or None)
            update_dict.setdefault('pa_phone', contact.phone or None)
            if contact.company_id:
                company = session.query(Company).filter(
                    Company.id == contact.company_id
                ).first()
                if company:
                    update_dict.setdefault('pa_company', company.name or None)
            update_dict['has_public_adjuster'] = True
        finally:
            session.close()
    except Exception as e:
        logger.warning(f"Could not sync PA contact {contact_id}: {e}")


@router.put("/{client_id}/claims/{claim_id}", response_model=None)
def update_claim(
    client_id: str,
    claim_id: str,
    data: ClaimUpdate,
    db=Depends(get_db),
    current_staff=Depends(get_current_staff),
    service: ClaimService = Depends(_get_claim_service),
):
    """Update a claim or cash job; company_ids replaces the companies working it"""
    update_dict = data.dict(exclude_unset=True)
    company_ids = update_dict.pop('company_ids', None)
    if company_ids is not None:
        company_ids = _checked_company_ids(db, current_staff, company_ids, creating=False)
    try:

        # Linking a PA contact is the source of truth for who the public
        # adjuster is, so keep the denormalized pa_* columns and the
        # has_public_adjuster flag in step with it. Without this the claim
        # would still read as "no PA" to anything looking at the freetext.
        if 'pa_contact_id' in update_dict:
            contact_id = (update_dict.get('pa_contact_id') or '').strip()
            update_dict['pa_contact_id'] = contact_id or None
            _sync_claim_pa_fields(update_dict, contact_id)

        result = service.update(claim_id, update_dict) if update_dict else service.get_by_id(claim_id)
        if not result:
            raise HTTPException(status_code=404, detail="Claim not found")
        if company_ids is not None:
            service.set_companies(claim_id, company_ids)
        return result
    except HTTPException:
        raise
    except SameCompanyAsWMError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating claim: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{client_id}/claims/{claim_id}")
def delete_claim(
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
def get_claim_documents(
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
        result = await asyncio.to_thread(extract_summary_from_pdf, tmp_path)

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
def list_negotiations(
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
def add_negotiation(
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

        # Auto-create supplement for review (single session to prevent race conditions)
        try:
            from app.domains.claim_followup.service import ClaimFollowUpService
            from app.domains.client.models import Claim
            from app.core.database_factory import get_database

            followup_service = ClaimFollowUpService()
            db = get_database()
            with db.get_session() as session:
                claim = session.query(Claim).filter(Claim.id == claim_id).first()
                if claim:
                    estimate_data = {
                        'rcv_amount': float(neg_dict.get('rcv_amount', 0)),
                        'acv_amount': float(neg_dict.get('acv_amount', 0)),
                    }
                    followup_service._auto_create_supplement(session, claim, estimate_data)
                    session.commit()
        except Exception as e:
            logger.warning(f"Auto supplement creation failed: {e}")

        return result
    except Exception as e:
        logger.error(f"Error adding negotiation: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{client_id}/claims/{claim_id}/negotiations/{negotiation_id}", response_model=None)
def update_negotiation(
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
def delete_negotiation(
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
def get_payments(
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
def get_payment_summary(
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
def create_payment(
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
def update_payment(
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
def delete_payment(
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
def get_expenses(
    client_id: str, claim_id: str,
    service: ClaimExpenseService = Depends(_get_expense_service),
):
    """Get all expenses for a claim"""
    return service.get_expenses_by_claim(claim_id)


@router.get("/{client_id}/claims/{claim_id}/profitability", response_model=None)
def get_profitability(
    client_id: str, claim_id: str,
    service: ClaimExpenseService = Depends(_get_expense_service),
):
    """Get profitability summary (revenue, PA fee, expenses, profit)"""
    try:
        return service.get_profitability_summary(claim_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{client_id}/claims/{claim_id}/expenses", response_model=None)
def create_expense(
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
def update_expense(
    client_id: str, claim_id: str, expense_id: str, data: ClaimExpenseUpdate,
    service: ClaimExpenseService = Depends(_get_expense_service),
):
    """Update an expense"""
    result = service.update_expense(expense_id, data.dict(exclude_unset=True))
    if not result:
        raise HTTPException(status_code=404, detail="Expense not found")
    return result


@router.delete("/{client_id}/claims/{claim_id}/expenses/{expense_id}")
def delete_expense(
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
def get_claim_activities(client_id: str, claim_id: str):
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


# ────────────────────────────────────────
# Client All-Documents Aggregation
# ────────────────────────────────────────

@router.get("/clients/{client_id}/all-documents")
def get_all_documents(
    client_id: str,
    doc_type: Optional[str] = None,
    claim_id: Optional[str] = None,
    current_staff=Depends(get_current_staff),
):
    """
    Aggregate all documents for a client across all claims.

    Returns a unified list of: emails, invoices, estimates, contracts,
    insurance_estimates, work_orders, wm_jobs, cabinet_estimates,
    plumber_reports, packing_estimates. Invoices and estimates are only the
    ones the signed-in person may open.
    """
    from app.core.database_factory import get_database
    from app.domains.client.models import Client, Claim, ClaimNegotiation

    database = get_database()
    session = database.get_readonly_session()
    try:
        # Verify client exists
        client = session.query(Client).filter(Client.id == client_id).first()
        if not client:
            raise HTTPException(status_code=404, detail="Client not found")

        # Get the client's claim IDs this person may see
        claims = company_scope.scoped(
            session.query(Claim).filter(Claim.client_id == client_id),
            company_scope.claim_condition(session, current_staff, Claim.id),
        ).all()
        claim_map = {str(c.id): c.claim_number or "N/A" for c in claims}
        claim_ids = list(claim_map.keys())
        own_companies = company_scope.company_ids(session, current_staff)

        def _visible(row) -> bool:
            """A client-level document: on a visible claim, or issued by their company"""
            if own_companies is None:
                return True
            if row.claim_id and str(row.claim_id) in claim_map:
                return True
            return bool(row.company_id) and str(row.company_id) in own_companies

        # Apply claim filter if specified
        if claim_id:
            if claim_id not in claim_ids:
                raise HTTPException(status_code=404, detail="Claim not found for client")
            claim_ids = [claim_id]

        docs = []

        def _iso(dt):
            return dt.isoformat() if dt else None

        # 1. Sent Emails
        if not doc_type or doc_type == 'email':
            from app.domains.claim_followup.models import SentEmail
            emails = session.query(SentEmail).filter(
                SentEmail.claim_id.in_(claim_ids),
                SentEmail.status.in_(['sent', 'sending']),
            ).order_by(SentEmail.sent_at.desc()).all()
            for e in emails:
                to_str = ", ".join(e.to_addresses or [])
                att_count = len(e.attachments or [])
                docs.append({
                    "id": str(e.id),
                    "doc_type": "email",
                    "title": e.subject or "(No subject)",
                    "description": f"To: {to_str}" + (f" ({att_count} attachment{'s' if att_count != 1 else ''})" if att_count else ""),
                    "status": e.status,
                    "claim_id": str(e.claim_id) if e.claim_id else None,
                    "claim_number": claim_map.get(str(e.claim_id), ""),
                    "date": _iso(e.sent_at or e.created_at),
                    "amount": None,
                    "reply_received": e.reply_received,
                    "link": None,
                })

        # 2. Invoices
        if not doc_type or doc_type == 'invoice':
            from app.domains.invoice.models import Invoice
            invoices = session.query(Invoice).filter(
                Invoice.client_id == client_id,
            ).order_by(Invoice.created_at.desc()).all()
            if claim_id:
                invoices = [i for i in invoices if str(i.claim_id) == claim_id]
            invoices = [i for i in invoices if can_access_document(i.owner_id, current_staff) and _visible(i)]
            for inv in invoices:
                docs.append({
                    "id": str(inv.id),
                    "doc_type": "invoice",
                    "title": f"Invoice #{inv.invoice_number or '—'}",
                    "description": inv.client_name or "",
                    "status": inv.status or "draft",
                    "claim_id": str(inv.claim_id) if inv.claim_id else None,
                    "claim_number": claim_map.get(str(inv.claim_id), "") if inv.claim_id else "",
                    "date": _iso(inv.invoice_date or inv.created_at),
                    "amount": float(inv.total_amount or 0),
                    "link": f"/invoices/{inv.id}",
                })

        # 3. Estimates
        if not doc_type or doc_type == 'estimate':
            from app.domains.estimate.models import Estimate
            estimates = session.query(Estimate).filter(
                Estimate.client_id == client_id,
            ).order_by(Estimate.created_at.desc()).all()
            if claim_id:
                estimates = [e for e in estimates if str(e.claim_id) == claim_id]
            estimates = [e for e in estimates if can_access_document(e.owner_id, current_staff) and _visible(e)]
            for est in estimates:
                total = float(est.rcv_amount or est.total_amount or 0)
                docs.append({
                    "id": str(est.id),
                    "doc_type": "estimate",
                    "title": f"Estimate #{est.estimate_number or '—'}"
                             + (f" ({est.estimate_type})" if est.estimate_type else ""),
                    "description": est.client_name or "",
                    "status": est.status or "draft",
                    "claim_id": str(est.claim_id) if est.claim_id else None,
                    "claim_number": claim_map.get(str(est.claim_id), "") if est.claim_id else "",
                    "date": _iso(est.estimate_date or est.created_at),
                    "amount": total,
                    "link": f"/estimates/{est.id}",
                })

        # 4. Contracts
        if not doc_type or doc_type == 'contract':
            from app.domains.contract.models import ContractInstance
            contracts = session.query(ContractInstance).filter(
                ContractInstance.client_id == client_id,
            ).order_by(ContractInstance.created_at.desc()).all()
            if claim_id:
                contracts = [c for c in contracts if str(c.claim_id) == claim_id]
            contracts = [c for c in contracts if _visible(c)]
            for ct in contracts:
                docs.append({
                    "id": str(ct.id),
                    "doc_type": "contract",
                    "title": ct.title or f"Contract #{ct.contract_number or '—'}",
                    "description": "",
                    "status": ct.status or "draft",
                    "claim_id": str(ct.claim_id) if ct.claim_id else None,
                    "claim_number": claim_map.get(str(ct.claim_id), "") if ct.claim_id else "",
                    "date": _iso(ct.signed_at or ct.sent_at or ct.created_at),
                    "amount": None,
                    "link": None,
                })

        # 5. Insurance Estimates (Negotiations with files)
        if not doc_type or doc_type == 'insurance_estimate':
            negotiations = session.query(ClaimNegotiation).filter(
                ClaimNegotiation.claim_id.in_(claim_ids),
            ).order_by(ClaimNegotiation.date_received.desc()).all()
            for neg in negotiations:
                file_id = neg.file_id or getattr(neg, 'document_url', None)
                if not file_id and not neg.document_name:
                    continue
                total = float(neg.rcv_amount or 0)
                docs.append({
                    "id": str(neg.id),
                    "doc_type": "insurance_estimate",
                    "title": f"Insurance Est. Rev.{neg.revision_number}"
                             + (f" ({neg.revision_type})" if neg.revision_type else ""),
                    "description": neg.received_from or "",
                    "status": neg.extraction_status or "uploaded",
                    "claim_id": str(neg.claim_id),
                    "claim_number": claim_map.get(str(neg.claim_id), ""),
                    "date": _iso(neg.date_received or neg.created_at),
                    "amount": total,
                    "file_id": str(file_id) if file_id else None,
                    "link": None,
                })

        # 6. Work Orders
        if not doc_type or doc_type == 'work_order':
            from app.domains.work_order.models import WorkOrder
            wos = session.query(WorkOrder).filter(
                WorkOrder.client_id == client_id,
            ).order_by(WorkOrder.created_at.desc()).all()
            if claim_id:
                wos = [w for w in wos if str(w.claim_id) == claim_id]
            wos = [w for w in wos if _visible(w)]
            for wo in wos:
                docs.append({
                    "id": str(wo.id),
                    "doc_type": "work_order",
                    "title": f"Work Order #{wo.work_order_number or '—'}",
                    "description": wo.work_description or "",
                    "status": wo.status or "draft",
                    "claim_id": str(wo.claim_id) if wo.claim_id else None,
                    "claim_number": claim_map.get(str(wo.claim_id), "") if wo.claim_id else "",
                    "date": _iso(wo.scheduled_start_date or wo.created_at),
                    "amount": float(wo.estimated_cost or 0) if wo.estimated_cost else None,
                    "link": f"/work-orders/{wo.id}",
                })

        # 7. WM Jobs
        if not doc_type or doc_type == 'wm_job':
            from app.domains.water_mitigation.models import WaterMitigationJob
            wm_jobs = session.query(WaterMitigationJob).filter(
                WaterMitigationJob.claim_id.in_(claim_ids),
            ).order_by(WaterMitigationJob.created_at.desc()).all()
            for wm in wm_jobs:
                docs.append({
                    "id": str(wm.id),
                    "doc_type": "wm_job",
                    "title": f"WM Job - {wm.property_address or '—'}",
                    "description": f"Status: {wm.status or '—'}",
                    "status": wm.status or "Lead",
                    "claim_id": str(wm.claim_id) if wm.claim_id else None,
                    "claim_number": claim_map.get(str(wm.claim_id), "") if wm.claim_id else "",
                    "date": _iso(wm.mitigation_start_date or wm.created_at),
                    "amount": float(wm.invoice_amount or 0) if wm.invoice_amount else None,
                    "link": f"/water-mitigation/{wm.id}",
                })

        # 8. Cabinet Estimates
        if not doc_type or doc_type == 'cabinet_estimate':
            try:
                from app.domains.cabinet_estimate.models import CabinetEstimate
                cab_ests = session.query(CabinetEstimate).filter(
                    CabinetEstimate.claim_id.in_(claim_ids),
                ).order_by(CabinetEstimate.created_at.desc()).all()
                for ce in cab_ests:
                    docs.append({
                        "id": str(ce.id),
                        "doc_type": "cabinet_estimate",
                        "title": f"Cabinet Est. - {getattr(ce, 'property_address', '') or '—'}",
                        "description": "",
                        "status": getattr(ce, 'status', 'draft') or "draft",
                        "claim_id": str(ce.claim_id) if ce.claim_id else None,
                        "claim_number": claim_map.get(str(ce.claim_id), "") if ce.claim_id else "",
                        "date": _iso(ce.created_at),
                        "amount": float(getattr(ce, 'total', 0) or 0),
                        "link": f"/cabinet-estimates/{ce.id}",
                    })
            except Exception:
                pass

        # Sort all docs by date descending
        docs.sort(key=lambda d: d.get("date") or "", reverse=True)

        return {
            "client_id": client_id,
            "total": len(docs),
            "documents": docs,
            "claims": [{"id": cid, "claim_number": cnum} for cid, cnum in claim_map.items()],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting all documents for client {client_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        session.close()


# ============================================================
# Claim Note endpoints
# ============================================================

@router.get("/{client_id}/claims/{claim_id}/notes", response_model=None)
def get_notes(
    client_id: str, claim_id: str,
    service: ClaimNoteService = Depends(_get_note_service),
):
    """Get all notes for a claim"""
    return service.get_notes_by_claim(claim_id)


@router.post("/{client_id}/claims/{claim_id}/notes", response_model=None)
def create_note(
    client_id: str, claim_id: str, data: ClaimNoteCreate,
    service: ClaimNoteService = Depends(_get_note_service),
):
    """Create a note"""
    note_data = data.dict()
    note_data['claim_id'] = claim_id
    try:
        return service.create_note(note_data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/{client_id}/claims/{claim_id}/notes/{note_id}", response_model=None)
def update_note(
    client_id: str, claim_id: str, note_id: str, data: ClaimNoteUpdate,
    service: ClaimNoteService = Depends(_get_note_service),
):
    """Update a note"""
    result = service.update_note(note_id, data.dict(exclude_unset=True))
    if not result:
        raise HTTPException(status_code=404, detail="Note not found")
    return result


@router.delete("/{client_id}/claims/{claim_id}/notes/{note_id}")
def delete_note(
    client_id: str, claim_id: str, note_id: str,
    service: ClaimNoteService = Depends(_get_note_service),
):
    """Delete a note"""
    if not service.delete_note(note_id):
        raise HTTPException(status_code=404, detail="Note not found")
    return {"message": "Note deleted"}


# ============================================================
# Claim Todo endpoints
# ============================================================

@router.get("/{client_id}/claims/{claim_id}/todos", response_model=None)
def get_todos(
    client_id: str, claim_id: str,
    service: ClaimTodoService = Depends(_get_todo_service),
):
    """Get all todos for a claim"""
    return service.get_todos_by_claim(claim_id)


@router.post("/{client_id}/claims/{claim_id}/todos", response_model=None)
def create_todo(
    client_id: str, claim_id: str, data: ClaimTodoCreate,
    service: ClaimTodoService = Depends(_get_todo_service),
):
    """Create a todo"""
    todo_data = data.dict()
    todo_data['claim_id'] = claim_id
    todo_data['client_id'] = client_id
    try:
        return service.create_todo(todo_data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/{client_id}/claims/{claim_id}/todos/{todo_id}", response_model=None)
def update_todo(
    client_id: str, claim_id: str, todo_id: str, data: ClaimTodoUpdate,
    service: ClaimTodoService = Depends(_get_todo_service),
):
    """Update a todo (including completion toggle)"""
    result = service.update_todo(todo_id, data.dict(exclude_unset=True))
    if not result:
        raise HTTPException(status_code=404, detail="Todo not found")
    return result


@router.delete("/{client_id}/claims/{claim_id}/todos/{todo_id}")
def delete_todo(
    client_id: str, claim_id: str, todo_id: str,
    service: ClaimTodoService = Depends(_get_todo_service),
):
    """Delete a todo"""
    if not service.delete_todo(todo_id):
        raise HTTPException(status_code=404, detail="Todo not found")
    return {"message": "Todo deleted"}


# ============================================================
# Dashboard: Active Todos (global)
# ============================================================

todo_dashboard_router = APIRouter(dependencies=[Depends(get_current_staff)])


@todo_dashboard_router.get("/active", response_model=None)
def get_active_todos(
    include_completed: bool = False,
    current_staff=Depends(get_current_staff),
    service: ClaimTodoService = Depends(_get_todo_service),
):
    """Active (uncompleted) todos across the claims the signed-in person may see, for the dashboard"""
    return service.get_active_todos(include_completed=include_completed, staff=current_staff)


# ============================================================
# Todo board: each person's todos, with or without a client, by column and drag order
# ============================================================

todo_router = APIRouter()


def _check_todo_links(db, staff, client_id=None, claim_id=None) -> None:
    """A todo can only be tied to a client or claim the person may see"""
    if claim_id:
        company_scope.require_claim(db, staff, claim_id)
    if client_id:
        company_scope.require_client(db, staff, client_id)


def _board_assignees(db, staff, assignee_ids, client_id=None, claim_id=None) -> List[str]:
    """Who a new todo is for: the person adding it, unless they pick others. Each
    must be able to sign in and to see the client or claim the todo is tied to.
    The person adding it comes first when they're on it, so it counts as theirs."""
    from app.domains.staff.models import Staff

    picked = [staff.id] if assignee_ids is None else assignee_ids
    ids = list(dict.fromkeys(str(i) for i in picked if i))
    if not ids:
        raise HTTPException(status_code=400, detail="Pick who the todo is for")
    people = {str(person.id): person for person in db.query(Staff).filter(
        Staff.id.in_(ids), Staff.is_active.is_(True), Staff.can_login.is_(True),
    ).all()}
    if set(ids) - set(people):
        raise HTTPException(status_code=400, detail="Some of the people picked can't be given todos")
    for person_id in ids:
        person = people[person_id]
        if claim_id and not company_scope.can_see_claim(db, person, claim_id):
            raise HTTPException(status_code=400, detail=f"{person.full_name} can't see this claim")
        if client_id and not claim_id and not company_scope.can_see_client(db, person, client_id):
            raise HTTPException(status_code=400, detail=f"{person.full_name} can't see this client")
    ids.sort(key=lambda person_id: person_id != str(staff.id))
    return ids


def _require_board_todo(db, staff, todo_id: str) -> None:
    """A todo assigned to you, or one on a claim (or claimless client) you may see"""
    from app.domains.client.models import ClaimTodo, ClaimTodoAssignee

    if company_scope.sees_everything(staff):
        return
    try:
        uuid.UUID(str(todo_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="Todo not found")
    todo = db.query(ClaimTodo).filter(ClaimTodo.id == todo_id).first()
    if todo is None:
        raise HTTPException(status_code=404, detail="Todo not found")
    if todo.owner_id and str(todo.owner_id) == str(staff.id):
        return
    if db.query(ClaimTodoAssignee.todo_id).filter(
        ClaimTodoAssignee.todo_id == todo.id, ClaimTodoAssignee.staff_id == str(staff.id),
    ).first():
        return
    if todo.claim_id:
        visible = company_scope.can_see_claim(db, staff, todo.claim_id)
    else:
        visible = bool(todo.client_id) and company_scope.can_see_client(db, staff, todo.client_id)
    if not visible:
        raise HTTPException(status_code=404, detail="Todo not found")


@todo_router.get("/", response_model=None)
def list_board_todos(
    client_id: Optional[str] = None,
    claim_id: Optional[str] = None,
    staff=Depends(get_current_staff),
    service: ClaimTodoService = Depends(_get_todo_service),
):
    """Your board; or one client's todos, whoever owns them (with claim_id: that claim's and the client's general ones)"""
    if client_id or claim_id:
        db = service.database.get_readonly_session()
        try:
            if claim_id:
                company_scope.require_claim(db, staff, claim_id)
            if client_id:
                company_scope.require_client(db, staff, client_id)
        finally:
            db.close()
        return service.list_todos(client_id=client_id, claim_id=claim_id, staff=staff)
    return service.list_todos(owner_id=str(staff.id))


@todo_router.post("/", response_model=None)
def create_board_todo(
    data: TodoCreate,
    staff=Depends(get_current_staff),
    db=Depends(get_db),
    service: ClaimTodoService = Depends(_get_todo_service),
):
    """Add a todo at the top of its column on the board of each person it's for:
    yours, unless you pick others"""
    _check_todo_links(db, staff, data.client_id, data.claim_id)
    people = _board_assignees(db, staff, data.assignee_ids, data.client_id, data.claim_id)
    todo_data = data.dict(exclude={'assignee_ids'})
    todo_data['owner_id'] = people[0]
    todo_data['assignee_ids'] = people
    try:
        return service.create_todo(todo_data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@todo_router.put("/reorder", response_model=None)
def reorder_board_todos(
    data: TodoReorder,
    staff=Depends(get_current_staff),
    service: ClaimTodoService = Depends(_get_todo_service),
):
    """Save one column's order after a drag; todos dragged in from another column move to it"""
    updated = service.reorder_todos(str(staff.id), data.status, [str(i) for i in data.ids])
    return {"updated": updated}


@todo_router.patch("/{todo_id}", response_model=None)
def update_board_todo(
    todo_id: str,
    data: TodoUpdate,
    staff=Depends(get_current_staff),
    db=Depends(get_db),
    service: ClaimTodoService = Depends(_get_todo_service),
):
    """Edit a todo; a new status moves it to the top of that column"""
    _require_board_todo(db, staff, todo_id)
    _check_todo_links(db, staff, data.client_id, data.claim_id)
    result = service.update_todo(todo_id, data.dict(exclude_unset=True))
    if not result:
        raise HTTPException(status_code=404, detail="Todo not found")
    return result


@todo_router.delete("/{todo_id}")
def delete_board_todo(
    todo_id: str,
    staff=Depends(get_current_staff),
    db=Depends(get_db),
    service: ClaimTodoService = Depends(_get_todo_service),
):
    _require_board_todo(db, staff, todo_id)
    if not service.delete_todo(todo_id):
        raise HTTPException(status_code=404, detail="Todo not found")
    return {"message": "Todo deleted"}
