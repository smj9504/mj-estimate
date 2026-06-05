"""
Supplement domain API endpoints.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from app.domains.supplement.schemas import (
    BidItemEstimateCreate,
    BidItemEstimateResponse,
    BidItemEstimateUpdate,
    SupplementDashboardStats,
    SupplementFollowUpCreate,
    SupplementFollowUpResponse,
    SupplementFollowUpUpdate,
    SupplementRequestCreate,
    SupplementRequestResponse,
    SupplementRequestUpdate,
)
from app.core.database_factory import get_database

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_service():
    from app.domains.supplement.service import SupplementService
    return SupplementService()


# ============================================================
# Supplement Requests
# ============================================================

@router.get("/supplements", response_model=List[SupplementRequestResponse])
async def list_supplements(
    status: Optional[str] = Query(None),
    claim_id: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    request_type: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    service = _get_service()
    items, total = service.get_requests({
        "status": status,
        "claim_id": claim_id,
        "priority": priority,
        "request_type": request_type,
        "page": page,
        "page_size": page_size,
    })
    return items


@router.get("/supplements/stats", response_model=SupplementDashboardStats)
async def get_supplement_stats():
    service = _get_service()
    return service.get_dashboard_stats()


@router.get("/supplements/pending-review")
async def get_pending_review_supplements():
    """Get supplements that need review (status=identified)"""
    service = _get_service()
    items = service.get_requests({'status': 'identified', 'page_size': 50})
    if isinstance(items, tuple):
        return items[0]
    return items


@router.get("/supplements/by-claim/{claim_id}", response_model=List[SupplementRequestResponse])
async def get_supplements_by_claim(claim_id: str):
    service = _get_service()
    return service.get_by_claim(claim_id)


@router.get("/supplements/insurance-estimate/{claim_id}")
async def get_latest_insurance_estimate(claim_id: str):
    """Get the latest insurance company estimate (ClaimNegotiation) for a claim.
    Also resolves a valid file_download_id for the PDF document.
    """
    try:
        from app.domains.client.models import ClaimNegotiation
        from app.domains.file.models import File
        database = get_database()
        session = database.get_session()
        try:
            negotiation = (
                session.query(ClaimNegotiation)
                .filter(ClaimNegotiation.claim_id == claim_id)
                .order_by(ClaimNegotiation.revision_number.desc())
                .first()
            )
            if not negotiation:
                return None

            from decimal import Decimal
            result = {}
            for col in ClaimNegotiation.__table__.columns:
                val = getattr(negotiation, col.name)
                if hasattr(val, 'hex'):
                    val = str(val)
                elif isinstance(val, Decimal):
                    val = float(val)
                elif hasattr(val, 'isoformat'):
                    val = val.isoformat()
                elif isinstance(val, (int, float, str, bool, list, dict)) or val is None:
                    pass
                else:
                    val = str(val)
                result[col.name] = val

            # Resolve a valid file ID for download
            result['file_download_id'] = None
            doc_url = negotiation.document_url
            if doc_url:
                # 1) Try direct file ID lookup
                file_rec = session.query(File).filter(
                    File.id == doc_url, File.is_active == True
                ).first()
                if file_rec:
                    result['file_download_id'] = str(file_rec.id)
                else:
                    # 2) Fallback: find by context=negotiation + context_id=claim_id
                    file_rec = (
                        session.query(File)
                        .filter(
                            File.context == 'negotiation',
                            File.context_id == claim_id,
                            File.is_active == True,
                        )
                        .order_by(File.created_at.desc())
                        .first()
                    )
                    if file_rec:
                        result['file_download_id'] = str(file_rec.id)

            return result
        finally:
            session.close()
    except Exception as e:
        logger.error(f"Error fetching insurance estimate: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/supplements/insurance-estimates/{claim_id}")
async def list_insurance_estimates(claim_id: str):
    """Get ALL insurance estimate versions (ClaimNegotiation) for a claim, ordered by revision_number desc."""
    try:
        from app.domains.client.models import Claim, ClaimNegotiation
        from app.domains.file.models import File
        from decimal import Decimal
        database = get_database()
        session = database.get_session()
        try:
            # Fetch claim-level WM fields
            claim_wm = {}
            claim_obj = session.query(Claim).filter(
                Claim.id == claim_id
            ).first()
            if claim_obj:
                claim_wm = {
                    'claim_wm_cost_status': claim_obj.wm_cost_status,
                    'claim_wm_estimate_amount': float(
                        claim_obj.wm_estimate_amount or 0
                    ),
                }

            negotiations = (
                session.query(ClaimNegotiation)
                .filter(ClaimNegotiation.claim_id == claim_id)
                .order_by(ClaimNegotiation.revision_number.desc())
                .all()
            )

            results = []
            for neg in negotiations:
                item = {}
                for col in ClaimNegotiation.__table__.columns:
                    val = getattr(neg, col.name)
                    if hasattr(val, 'hex'):
                        val = str(val)
                    elif isinstance(val, Decimal):
                        val = float(val)
                    elif hasattr(val, 'isoformat'):
                        val = val.isoformat()
                    elif isinstance(val, (int, float, str, bool, list, dict)) or val is None:
                        pass
                    else:
                        val = str(val)
                    item[col.name] = val

                # Resolve file download ID
                item['file_download_id'] = None
                doc_url = neg.document_url
                if doc_url:
                    file_rec = session.query(File).filter(
                        File.id == doc_url, File.is_active == True
                    ).first()
                    if file_rec:
                        item['file_download_id'] = str(file_rec.id)

                # Fallback: if document_url is empty/null but a file was
                # previously uploaded for this negotiation, recover the link.
                if not item['file_download_id']:
                    fallback = (
                        session.query(File)
                        .filter(
                            File.context == 'negotiation',
                            File.context_id == claim_id,
                            File.category == 'insurance_estimate',
                            File.is_active == True,
                        )
                        .order_by(File.created_at.desc())
                        .first()
                    )
                    if fallback:
                        item['file_download_id'] = str(fallback.id)
                        # Auto-heal: restore the broken link
                        if not doc_url:
                            neg.document_url = str(fallback.id)
                            neg.document_name = fallback.original_name

                results.append(item)

            # Persist any auto-healed document links
            try:
                session.commit()
            except Exception:
                session.rollback()

            # Attach claim-level WM info to each result
            for r in results:
                r.update(claim_wm)

            return results
        finally:
            session.close()
    except Exception as e:
        logger.error(f"Error listing insurance estimates: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/supplements/insurance-estimates/{claim_id}")
async def upload_insurance_estimate(claim_id: str, data: dict):
    """Upload a new insurance estimate version for a claim.

    Request body:
    - revision_type: str (initial | supplement | re_inspection | appraisal | final)
    - acv_amount: float (optional)
    - rcv_amount: float (optional)
    - depreciation_amount: float (optional)
    - deductible: float (optional)
    - date_received: str (optional, ISO date)
    - received_from: str (optional)
    - notes: str (optional)
    - file_id: str (optional, pre-uploaded file ID)
    """
    try:
        from app.domains.client.service import ClaimNegotiationService
        service = ClaimNegotiationService()

        neg_data = {
            'claim_id': claim_id,
            'revision_type': data.get('revision_type', 'supplement'),
            'estimate_category': data.get('estimate_category'),
            'acv_amount': data.get('acv_amount', 0),
            'rcv_amount': data.get('rcv_amount', 0),
            'depreciation_amount': data.get('depreciation_amount', 0),
            'deductible': data.get('deductible', 0),
            'date_received': data.get('date_received'),
            'received_from': data.get('received_from'),
            'notes': data.get('notes'),
        }

        # Pass file_id if provided
        if data.get('file_id'):
            neg_data['file_id'] = data['file_id']

        # Pass sections_data from PDF extraction
        if data.get('sections_data'):
            neg_data['sections_data'] = data['sections_data']

        result = service.add_negotiation(neg_data)

        # Update claim's supplement-related info + auto-create follow-up
        try:
            database = get_database()
            session = database.get_session()
            try:
                from app.domains.client.models import Claim, ClaimActivity
                from datetime import datetime, timezone
                claim = session.query(Claim).filter(Claim.id == claim_id).first()
                if claim:
                    claim.insurance_estimate_received = True
                    if not claim.insurance_estimate_received_date:
                        claim.insurance_estimate_received_date = datetime.now(timezone.utc)

                    # Amounts for activity log and follow-up summary
                    # (claim.current_* already updated by ClaimNegotiationService.add_negotiation)
                    rcv = float(neg_data.get('rcv_amount', 0))
                    acv = float(neg_data.get('acv_amount', 0))
                    depreciation = float(neg_data.get('depreciation_amount', 0))

                    # Log activity
                    session.add(ClaimActivity(
                        claim_id=claim_id,
                        activity_type="estimate_uploaded",
                        title=f"Insurance estimate uploaded (Rev #{result.get('revision_number', '?')} - {neg_data['revision_type']})",
                        description=(
                            f"RCV: ${rcv:,.2f}, "
                            f"ACV: ${acv:,.2f}"
                        ),
                        related_entity_type="negotiation",
                        related_entity_id=result.get('id'),
                    ))

                    # Auto-create SupplementFollowUp for all supplements on this claim
                    from app.domains.supplement.models import SupplementRequest, SupplementFollowUp
                    supplements = (
                        session.query(SupplementRequest)
                        .filter(
                            SupplementRequest.claim_id == claim_id,
                            SupplementRequest.status.notin_(['approved', 'denied', 'withdrawn']),
                        )
                        .all()
                    )
                    rev_num = result.get('revision_number', '?')
                    rev_type = neg_data['revision_type'].replace('_', ' ').title()
                    for sup in supplements:
                        followup = SupplementFollowUp(
                            supplement_id=sup.id,
                            contact_method="email",
                            contact_name=neg_data.get('received_from', 'Insurance Company'),
                            summary=(
                                f"Updated insurance estimate received (Rev #{rev_num} - {rev_type}). "
                                f"RCV: ${rcv:,.2f}, ACV: ${acv:,.2f}"
                            ),
                            response_received=True,
                            response_date=datetime.now(timezone.utc),
                            response_summary=(
                                f"Insurance company issued updated estimate. "
                                f"RCV: ${rcv:,.2f}, ACV: ${acv:,.2f}, "
                                f"Depreciation: ${depreciation:,.2f}"
                            ),
                        )
                        session.add(followup)

                    session.commit()
            finally:
                session.close()
        except Exception as e:
            logger.warning(f"Error updating claim after estimate upload: {e}")

        return result
    except Exception as e:
        logger.error(f"Error uploading insurance estimate: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/supplements/insurance-estimates/{claim_id}/{negotiation_id}")
async def update_insurance_estimate(claim_id: str, negotiation_id: str, data: dict):
    """Update an existing insurance estimate negotiation.

    Request body (all optional):
    - acv_amount, rcv_amount, depreciation_amount, deductible: float
    - revision_type: str
    - date_received, received_from, notes: str
    - sections_data: list of section objects
    """
    try:
        from app.domains.client.models import ClaimNegotiation
        database = get_database()
        session = database.get_session()
        try:
            neg = session.query(ClaimNegotiation).filter(
                ClaimNegotiation.id == negotiation_id,
                ClaimNegotiation.claim_id == claim_id,
            ).first()
            if not neg:
                raise HTTPException(status_code=404, detail="Negotiation not found")

            updatable_fields = [
                'acv_amount', 'rcv_amount', 'depreciation_amount', 'deductible',
                'revision_type', 'estimate_category', 'date_received', 'received_from', 'notes',
                'sections_data',
            ]
            for field in updatable_fields:
                if field in data:
                    setattr(neg, field, data[field])

            session.commit()

            # Return updated record
            from decimal import Decimal
            result = {}
            for col in neg.__table__.columns:
                val = getattr(neg, col.name)
                if isinstance(val, Decimal):
                    val = float(val)
                elif hasattr(val, 'isoformat'):
                    val = val.isoformat()
                elif isinstance(val, (int, float, str, bool, list, dict)) or val is None:
                    pass
                else:
                    val = str(val)
                result[col.name] = val

            return result
        finally:
            session.close()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating insurance estimate: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/supplements/insurance-estimates/{claim_id}/{negotiation_id}/replace-pdf")
async def replace_insurance_estimate_pdf(claim_id: str, negotiation_id: str, data: dict):
    """Replace PDF for an existing insurance estimate negotiation.

    Request body:
    - file_id: str (pre-uploaded file ID)
    """
    try:
        file_id = data.get('file_id')
        if not file_id:
            raise HTTPException(status_code=400, detail="file_id is required")

        from app.domains.file.models import File
        from app.domains.client.models import ClaimNegotiation
        database = get_database()
        session = database.get_session()
        try:
            # Resolve file record
            file_rec = session.query(File).filter(
                File.id == file_id, File.is_active == True
            ).first()
            if not file_rec:
                raise HTTPException(status_code=404, detail="File not found")

            # Update negotiation
            neg = session.query(ClaimNegotiation).filter(
                ClaimNegotiation.id == negotiation_id,
                ClaimNegotiation.claim_id == claim_id,
            ).first()
            if not neg:
                raise HTTPException(status_code=404, detail="Negotiation not found")

            neg.document_url = str(file_rec.id)
            neg.document_name = file_rec.original_name
            session.commit()

            return {"success": True, "document_url": str(file_rec.id), "document_name": file_rec.original_name}
        finally:
            session.close()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error replacing estimate PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/supplements/insurance-estimates/extract-pdf/{file_id}")
async def extract_insurance_estimate_pdf(file_id: str):
    """Extract summary amounts (RCV, ACV, depreciation, deductible) from an uploaded PDF.

    Returns parsed totals and per-section breakdown for auto-filling the upload form.
    """
    try:
        from app.domains.file.models import File
        database = get_database()
        session = database.get_session()
        try:
            file_rec = session.query(File).filter(
                File.id == file_id, File.is_active == True
            ).first()
            if not file_rec:
                raise HTTPException(status_code=404, detail="File not found")

            # Resolve PDF path using the extraction service helper
            from app.domains.insurance_extraction.service import InsuranceExtractionService
            ext_svc = InsuranceExtractionService(session)
            pdf_path, tmp_path = ext_svc._resolve_pdf_path(file_rec.url)

            try:
                from app.domains.insurance_extraction.parsers.xactimate_reference_parser import (
                    parse_estimate,
                )
                result = parse_estimate(pdf_path)
            finally:
                if tmp_path:
                    import os
                    try:
                        os.unlink(tmp_path)
                    except OSError:
                        pass

            summary = result.get("summary", {})
            header = {
                k: result.get(k)
                for k in ("carrier", "claim_number", "insured", "date_of_loss",
                           "deductible", "estimate_id")
                if result.get(k) is not None
            }

            # Build per-section breakdown (field names match NegotiationSectionData schema)
            sections = []
            def _build_section(name, totals):
                dep_raw = totals.get("depreciation", 0) or 0
                rcv_val = totals.get("rcv") or totals.get("grand_total_rcv") or 0
                acv_val = totals.get("acv") or 0
                return {
                    "section_name": name,
                    "line_item_total": totals.get("line_item_total") or 0,
                    "material_sales_tax": totals.get("material_sales_tax") or 0,
                    "subtotal": totals.get("subtotal") or 0,
                    "overhead_amount": totals.get("gc_overhead") or 0,
                    "profit_amount": totals.get("gc_profit") or 0,
                    "rcv": rcv_val,
                    "depreciation": abs(dep_raw),
                    "deductible": totals.get("deductible") or 0,
                    "net_acv": acv_val,
                }
            for sec_group_key in ("standalone_sections", "levels"):
                group = result.get(sec_group_key, [])
                if sec_group_key == "levels":
                    for lv in group:
                        for rm in lv.get("rooms", []):
                            totals = rm.get("room_totals", {})
                            if totals:
                                sections.append(_build_section(rm.get("name", "Unknown"), totals))
                else:
                    for sec in group:
                        totals = sec.get("section_totals", {})
                        if totals:
                            sections.append(_build_section(sec.get("name", "Unknown"), totals))

            # Build totals from summary
            rcv_amount = summary.get("grand_total_rcv") or summary.get("rcv") or 0
            depreciation_raw = summary.get("depreciation") or 0
            depreciation_amount = abs(depreciation_raw)
            acv_amount = summary.get("acv") or 0
            deductible = summary.get("deductible") or 0

            return {
                "success": True,
                "totals": {
                    "rcv_amount": rcv_amount,
                    "acv_amount": acv_amount,
                    "depreciation_amount": depreciation_amount,
                    "deductible": deductible,
                    "net_claim": summary.get("net_claim") or 0,
                },
                "sections": sections,
                "header": header,
            }
        finally:
            session.close()
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"PDF extraction failed (non-critical): {e}")
        return {
            "success": False,
            "totals": None,
            "sections": [],
            "header": {},
            "error": str(e),
        }


@router.delete("/supplements/insurance-estimates/{claim_id}/{negotiation_id}")
async def delete_insurance_estimate(claim_id: str, negotiation_id: str):
    """Delete an insurance estimate negotiation record."""
    try:
        from app.domains.client.models import ClaimNegotiation
        database = get_database()
        session = database.get_session()
        try:
            neg = session.query(ClaimNegotiation).filter(
                ClaimNegotiation.id == negotiation_id,
                ClaimNegotiation.claim_id == claim_id,
            ).first()
            if not neg:
                raise HTTPException(status_code=404, detail="Negotiation not found")
            session.delete(neg)
            session.commit()
            return {"message": "Estimate deleted successfully"}
        finally:
            session.close()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting insurance estimate: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/supplements/{supplement_id}", response_model=SupplementRequestResponse)
async def get_supplement(supplement_id: str):
    service = _get_service()
    result = service.get_request(supplement_id)
    if not result:
        raise HTTPException(status_code=404, detail="Supplement request not found")
    return result


@router.post("/supplements", response_model=SupplementRequestResponse)
async def create_supplement(data: SupplementRequestCreate):
    service = _get_service()
    try:
        return service.create_request(data.dict())
    except Exception as e:
        logger.error(f"Error creating supplement: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/supplements/{supplement_id}", response_model=SupplementRequestResponse)
async def update_supplement(supplement_id: str, data: SupplementRequestUpdate):
    service = _get_service()
    update_data = data.dict(exclude_unset=True)
    result = service.update_request(supplement_id, update_data)
    if not result:
        raise HTTPException(status_code=404, detail="Supplement request not found")
    return result


@router.delete("/supplements/{supplement_id}")
async def delete_supplement(supplement_id: str):
    service = _get_service()
    if not service.delete_request(supplement_id):
        raise HTTPException(status_code=404, detail="Supplement request not found")
    return {"success": True}


# ============================================================
# Bid Item Estimates
# ============================================================

@router.get("/supplements/{supplement_id}/bid-items", response_model=List[BidItemEstimateResponse])
async def list_bid_items(supplement_id: str):
    service = _get_service()
    return service.get_bid_items_by_supplement(supplement_id)


@router.post("/supplements/{supplement_id}/bid-items", response_model=BidItemEstimateResponse)
async def create_bid_item(supplement_id: str, data: BidItemEstimateCreate):
    service = _get_service()
    item_data = data.dict()
    item_data['supplement_id'] = supplement_id
    try:
        return service.create_bid_item(item_data)
    except Exception as e:
        logger.error(f"Error creating bid item: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/supplements/{supplement_id}/bid-items/{item_id}", response_model=BidItemEstimateResponse)
async def update_bid_item(supplement_id: str, item_id: str, data: BidItemEstimateUpdate):
    service = _get_service()
    update_data = data.dict(exclude_unset=True)
    result = service.update_bid_item(item_id, update_data)
    if not result:
        raise HTTPException(status_code=404, detail="Bid item not found")
    return result


@router.delete("/supplements/{supplement_id}/bid-items/{item_id}")
async def delete_bid_item(supplement_id: str, item_id: str):
    service = _get_service()
    if not service.delete_bid_item(item_id):
        raise HTTPException(status_code=404, detail="Bid item not found")
    return {"success": True}


# ============================================================
# Supplement Follow-ups
# ============================================================

@router.get("/supplements/{supplement_id}/followups", response_model=List[SupplementFollowUpResponse])
async def list_followups(supplement_id: str):
    service = _get_service()
    return service.get_followups(supplement_id)


@router.post("/supplements/{supplement_id}/followups", response_model=SupplementFollowUpResponse)
async def create_followup(supplement_id: str, data: SupplementFollowUpCreate):
    service = _get_service()
    followup_data = data.dict()
    followup_data['supplement_id'] = supplement_id
    try:
        return service.create_followup(followup_data)
    except Exception as e:
        logger.error(f"Error creating followup: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/supplements/{supplement_id}/followups/{followup_id}", response_model=SupplementFollowUpResponse)
async def update_followup(supplement_id: str, followup_id: str, data: SupplementFollowUpUpdate):
    service = _get_service()
    update_data = data.dict(exclude_unset=True)
    result = service.update_followup(followup_id, update_data)
    if not result:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    return result


@router.post("/supplements/{supplement_id}/send-info-request")
async def send_info_request(supplement_id: str, data: dict):
    """Send an info request email to PA or contractor and create a followup record.

    Request body:
    - to_email: str
    - to_name: str
    - request_to_type: str (public_adjuster | contractor)
    - items_needed: list[{description: str}]
    - subject: str (optional, auto-generated if not provided)
    - body_html: str (optional, auto-generated if not provided)
    - email_account_id: str (optional)
    """
    service = _get_service()
    try:
        result = service.send_info_request(supplement_id, data)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error sending info request: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to send: {str(e)}")


@router.post("/supplements/{supplement_id}/followups/{followup_id}/resend")
async def resend_info_request(supplement_id: str, followup_id: str, data: dict = {}):
    """Resend/follow-up on an existing info request.

    Request body (optional):
    - additional_message: str
    - email_account_id: str
    """
    service = _get_service()
    try:
        result = service.resend_info_request(supplement_id, followup_id, data)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error resending info request: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to resend: {str(e)}")


# ============================================================
# Rebuild Company Assignment
# ============================================================

@router.put("/supplements/claim/{claim_id}/rebuild-company")
async def assign_rebuild_company(claim_id: str, data: dict):
    """Assign or update the reconstruction company for a claim.

    Request body:
    - company_id: str (UUID of the company)
    """
    service = _get_service()
    company_id = data.get("company_id")
    if not company_id:
        raise HTTPException(status_code=400, detail="company_id is required")
    try:
        return service.assign_rebuild_company(claim_id, company_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error assigning rebuild company: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Send to PA
# ============================================================

@router.get("/supplements/claim-pa/{claim_id}")
async def get_claim_pa_info(claim_id: str):
    """Get PA contact info for a claim (used when creating a supplement)."""
    service = _get_service()
    result = service.get_claim_pa_info(claim_id)
    return result or {}


@router.get("/supplements/{supplement_id}/pa-info")
async def get_pa_info(supplement_id: str):
    """Get PA contact info + CC candidates for a supplement."""
    service = _get_service()
    result = service.get_pa_info(supplement_id)
    if not result:
        raise HTTPException(status_code=404, detail="Supplement not found")
    return result


@router.post("/supplements/{supplement_id}/generate-pa-email")
async def generate_pa_email(
    supplement_id: str,
    custom_notes: str = Query("", description="Additional notes to include"),
):
    """Generate preset email content for sending supplement to PA."""
    service = _get_service()
    result = service.generate_pa_email_content(supplement_id, custom_notes)
    if not result.get("subject"):
        raise HTTPException(status_code=404, detail="Supplement not found")
    return result


@router.post("/supplements/{supplement_id}/send-to-pa")
async def send_to_pa(supplement_id: str, data: dict):
    """Send supplement bid items to PA via email with PDF attachments.

    Request body:
    - to_addresses: list of PA email addresses
    - cc_addresses: list of CC email addresses
    - subject: email subject
    - body_html: email body HTML
    - pa_name: PA name (for tracking)
    - email_account_id: optional sending account
    """
    service = _get_service()
    try:
        result = service.send_to_pa(supplement_id, data)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error sending to PA: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to send: {str(e)}",
        )


@router.post("/supplements/polish-scope-notes")
async def polish_scope_notes(data: dict):
    """Use AI to polish rough scope notes into professional language for PA communication.

    Request body:
    - notes: str (raw scope notes to polish)
    - estimate_type: str (optional, e.g. 'xactimate', 'bathroom')
    """
    notes = (data.get("notes") or "").strip()
    if not notes:
        raise HTTPException(status_code=400, detail="notes is required")

    estimate_type = data.get("estimate_type", "")

    system_prompt = (
        "You are a professional insurance supplement writer. "
        "Polish the user's rough scope notes into clear, grammatically correct, professional language "
        "suitable for emailing a Public Adjuster (PA).\n\n"
        "STRICT RULES:\n"
        "- ONLY fix grammar, spelling, and sentence structure. Do NOT change the meaning.\n"
        "- Do NOT add scope items, details, quantities, or technical claims that are not in the original.\n"
        "- Do NOT remove or omit any scope items from the original.\n"
        "- You MAY interpret the user's intent from rough notes, but do NOT fabricate details that were not implied.\n"
        "- Keep all specific details exactly: room names, floor numbers, measurements, "
        "Xactimate codes (FCCAV, FCCPAD, etc.), item names.\n"
        "- Use construction/restoration industry terminology where the user already implies it.\n"
        "- Use bullet points (one per line starting with '• ') if there are multiple items.\n"
        "- Output ONLY the polished text. No explanations, no quotes, no preamble."
    )
    user_msg = f"Estimate type: {estimate_type}\nRough notes:\n{notes}"

    try:
        from app.core.config import settings
        import anthropic

        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            system=system_prompt,
            messages=[{"role": "user", "content": user_msg}],
        )
        polished = response.content[0].text.strip()
        return {"polished": polished}
    except Exception as e:
        logger.error(f"Error polishing scope notes: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/supplements/polish-description-for-email")
async def polish_description_for_email(data: dict):
    """Use AI to organize rough bid item descriptions into professional HTML
    suitable for embedding in a PA email body.

    Request body:
    - descriptions: str (raw description text with scope changes)
    """
    descriptions = (data.get("descriptions") or "").strip()
    if not descriptions:
        raise HTTPException(status_code=400, detail="descriptions is required")

    system_prompt = (
        "You are a professional insurance supplement writer. "
        "Polish the user's rough scope notes into clear, professional language for an email to a Public Adjuster (PA). "
        "\n\nRules:"
        "\n- Group related items under short category headings."
        "\n- Format as HTML: use <p><strong> for headings, then lines separated by <br/>."
        "\n- Each item on its own line, starting with a bullet or dash is optional."
        "\n- Combine related items (e.g. multiple carpet items together)."
        "\n- Keep it concise and factual. Use construction/restoration terminology."
        "\n- Preserve ALL original scope items — do not add or remove any."
        "\n- Keep Xactimate line item codes (FCCAV, FCCPAD, etc.) when mentioned."
        "\n- Output ONLY the HTML. No explanations, no markdown, no ```."
        "\n- NO <h1>-<h4>, <ul>, <li>, <table> tags. Keep it simple: <p>, <strong>, <br/> only."
        "\n\nExample output:"
        "\n<p><strong>Flooring & Material Adjustments</strong><br/>"
        "\nAdded 1st-floor baseboard replacement (hardwood floor).<br/>"
        "\nAdded carpet replacement for 2nd-floor bedrooms (1, 2, and 3).<br/>"
        "\nAdjusted carpet and pad pricing per independent analysis; applied Xactimate line items FCCAV and FCCPAD.<br/>"
        "\nIncluded carpet disposal/waste fees.</p>"
        "\n<p><strong>Bid Items</strong><br/>"
        "\nIncluded Bathroom bid item.<br/>"
        "\nIncluded Pack-in/out bid item.</p>"
    )
    user_msg = f"Rough scope change notes:\n{descriptions}"

    try:
        from app.core.config import settings
        import anthropic

        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=800,
            system=system_prompt,
            messages=[{"role": "user", "content": user_msg}],
        )
        polished_html = response.content[0].text.strip()
        return {"polished_html": polished_html}
    except Exception as e:
        logger.error(f"Error polishing description for email: {e}")
        raise HTTPException(status_code=500, detail=str(e))
