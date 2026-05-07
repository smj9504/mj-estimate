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
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    service = _get_service()
    items, total = service.get_requests({
        "status": status,
        "claim_id": claim_id,
        "priority": priority,
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
