"""
Xactimate Helper Tool - REST API Endpoints

Mounted at /api/xactimate prefix (alongside existing xactimate routes).
New paths: /rooms, /assemblies, /descriptions, /embed, /helper
"""

import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from .schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    CorrectionCreate,
    CorrectionResponse,
    DescriptionCreate,
    DescriptionResponse,
    DescriptionUpdate,
    EmbeddingSyncRequest,
    EmbeddingSyncResponse,
    XactAssemblyCreate,
    XactAssemblyResponse,
    XactLineItemResponse,
    XactLineItemSearchRequest,
    XactRoomCreate,
    XactRoomResponse,
    XactRoomUpdate,
)
from .service import (
    XactAssemblyService,
    XactCorrectionService,
    XactDescriptionService,
    XactEmbeddingService,
    XactLineItemService,
    XactRecommendationService,
    XactRoomService,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# Service instances (lazy singletons)
_line_item_svc = None
_assembly_svc = None
_room_svc = None
_recommendation_svc = None
_correction_svc = None
_description_svc = None
_embedding_svc = None


def get_line_item_service() -> XactLineItemService:
    global _line_item_svc
    if _line_item_svc is None:
        _line_item_svc = XactLineItemService()
    return _line_item_svc


def get_assembly_service() -> XactAssemblyService:
    global _assembly_svc
    if _assembly_svc is None:
        _assembly_svc = XactAssemblyService()
    return _assembly_svc


def get_room_service() -> XactRoomService:
    global _room_svc
    if _room_svc is None:
        _room_svc = XactRoomService()
    return _room_svc


def get_recommendation_service() -> XactRecommendationService:
    global _recommendation_svc
    if _recommendation_svc is None:
        _recommendation_svc = XactRecommendationService()
    return _recommendation_svc


def get_correction_service() -> XactCorrectionService:
    global _correction_svc
    if _correction_svc is None:
        _correction_svc = XactCorrectionService()
    return _correction_svc


def get_description_service() -> XactDescriptionService:
    global _description_svc
    if _description_svc is None:
        _description_svc = XactDescriptionService()
    return _description_svc


def get_embedding_service() -> XactEmbeddingService:
    global _embedding_svc
    if _embedding_svc is None:
        _embedding_svc = XactEmbeddingService()
    return _embedding_svc


# ═══════════════════════════════════════════════════════════════════════════════
# Room CRUD
# ═══════════════════════════════════════════════════════════════════════════════


@router.post("/rooms", response_model=XactRoomResponse, tags=["Xactimate Helper"])
async def create_room(data: XactRoomCreate):
    """Create a new room for AI analysis."""
    svc = get_room_service()
    room = svc.create(data.model_dump(exclude_none=True))
    return room


@router.get("/rooms/{room_id}", response_model=XactRoomResponse, tags=["Xactimate Helper"])
async def get_room(room_id: UUID):
    """Get room details."""
    svc = get_room_service()
    room = svc.get_by_id(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room


@router.patch("/rooms/{room_id}", response_model=XactRoomResponse, tags=["Xactimate Helper"])
async def update_room(room_id: UUID, data: XactRoomUpdate):
    """Update room details."""
    svc = get_room_service()
    room = svc.update(room_id, data.model_dump(exclude_none=True))
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room


# ═══════════════════════════════════════════════════════════════════════════════
# AI Analysis
# ═══════════════════════════════════════════════════════════════════════════════


@router.post("/rooms/{room_id}/analyze", tags=["Xactimate Helper"])
async def analyze_room(room_id: UUID, data: AnalyzeRequest):
    """
    Trigger AI analysis for a room.
    Upload photos or provide manual keywords → AI recommendation pipeline.
    """
    svc = get_recommendation_service()
    try:
        result = await svc.analyze_room(
            room_id=room_id,
            photos=data.photos,
            manual_keywords=data.manual_keywords,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Analysis failed for room {room_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@router.get("/rooms/{room_id}/recommendations", tags=["Xactimate Helper"])
async def get_recommendations(room_id: UUID):
    """
    Get the latest AI recommendations for a room.
    (Returns stored recommendations from the last analysis.)
    """
    svc = get_room_service()
    room = svc.get_by_id(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return {
        "room_id": str(room_id),
        "selected_assemblies": room.get("selected_assemblies", []),
        "final_line_items": room.get("final_line_items", []),
        "status": room.get("status", "draft"),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Correction Feedback
# ═══════════════════════════════════════════════════════════════════════════════


@router.post(
    "/rooms/{room_id}/corrections",
    response_model=CorrectionResponse,
    tags=["Xactimate Helper"],
)
async def save_correction(room_id: UUID, data: CorrectionCreate):
    """Save user correction feedback for AI improvement."""
    svc = get_correction_service()
    try:
        result = await svc.save_correction(
            room_id=room_id,
            ai_suggested=data.ai_suggested,
            user_corrected=data.user_corrected,
            situation_summary=data.situation_summary,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/rooms/{room_id}/corrections", tags=["Xactimate Helper"])
async def get_corrections(room_id: UUID):
    """Get correction history for a room."""
    svc = get_correction_service()
    return svc.get_by_room(room_id)


# ═══════════════════════════════════════════════════════════════════════════════
# Confirmed Line Items
# ═══════════════════════════════════════════════════════════════════════════════


@router.get("/rooms/{room_id}/line-items", tags=["Xactimate Helper"])
async def get_room_line_items(room_id: UUID):
    """Get confirmed line items for a room."""
    svc = get_room_service()
    items = svc.get_line_items(room_id)
    if items is None:
        raise HTTPException(status_code=404, detail="Room not found")
    return items


# ═══════════════════════════════════════════════════════════════════════════════
# Descriptions
# ═══════════════════════════════════════════════════════════════════════════════


@router.get(
    "/helper/line-items/{item_code}/descriptions",
    response_model=list[DescriptionResponse],
    tags=["Xactimate Helper"],
)
async def get_item_descriptions(
    item_code: str,
    description_type: Optional[str] = Query(None),
    approved_only: bool = Query(False),
):
    """Get justification descriptions for a line item."""
    svc = get_description_service()
    return svc.get_for_item(item_code, description_type, approved_only)


@router.post(
    "/descriptions",
    response_model=DescriptionResponse,
    tags=["Xactimate Helper"],
)
async def create_description(data: DescriptionCreate):
    """Create a new justification description."""
    svc = get_description_service()
    return svc.create(data.model_dump())


@router.patch(
    "/descriptions/{desc_id}",
    response_model=DescriptionResponse,
    tags=["Xactimate Helper"],
)
async def update_description(desc_id: UUID, data: DescriptionUpdate):
    """Update a justification description."""
    svc = get_description_service()
    result = svc.update(desc_id, data.model_dump(exclude_none=True))
    if not result:
        raise HTTPException(status_code=404, detail="Description not found")
    return result


@router.patch(
    "/descriptions/{desc_id}/approve",
    response_model=DescriptionResponse,
    tags=["Xactimate Helper"],
)
async def approve_description(desc_id: UUID):
    """Approve an AI-generated description."""
    svc = get_description_service()
    result = svc.approve(desc_id)
    if not result:
        raise HTTPException(status_code=404, detail="Description not found")
    return result


@router.post("/descriptions/{desc_id}/copy", tags=["Xactimate Helper"])
async def record_copy(desc_id: UUID):
    """Record a copy event (increment usage_count)."""
    svc = get_description_service()
    return svc.record_copy(desc_id)


# ═══════════════════════════════════════════════════════════════════════════════
# Assemblies
# ═══════════════════════════════════════════════════════════════════════════════


@router.get(
    "/helper/assemblies",
    response_model=list[XactAssemblyResponse],
    tags=["Xactimate Helper"],
)
async def list_assemblies(
    damage_type: Optional[str] = Query(None),
    room_type: Optional[str] = Query(None),
):
    """Get assembly templates."""
    svc = get_assembly_service()
    return svc.get_all(damage_type, room_type)


@router.post(
    "/helper/assemblies",
    response_model=XactAssemblyResponse,
    tags=["Xactimate Helper"],
)
async def create_assembly(data: XactAssemblyCreate):
    """Create a new assembly template (admin)."""
    svc = get_assembly_service()
    return svc.create(data.model_dump())


@router.get(
    "/helper/assemblies/{assembly_id}",
    response_model=XactAssemblyResponse,
    tags=["Xactimate Helper"],
)
async def get_assembly(assembly_id: UUID):
    """Get assembly template details."""
    svc = get_assembly_service()
    result = svc.get_by_id(assembly_id)
    if not result:
        raise HTTPException(status_code=404, detail="Assembly not found")
    return result


# ═══════════════════════════════════════════════════════════════════════════════
# Helper Line Items (search within xact_ tables)
# ═══════════════════════════════════════════════════════════════════════════════


@router.get("/helper/line-items", tags=["Xactimate Helper"])
async def search_helper_line_items(
    query: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    is_active: bool = Query(True),
    limit: int = Query(20, le=100),
    offset: int = Query(0),
):
    """Search line items in the xact_line_items table."""
    svc = get_line_item_service()
    return svc.search(query, category, is_active, limit, offset)


@router.get("/helper/line-items/categories", tags=["Xactimate Helper"])
async def get_helper_categories():
    """Get all unique categories from xact_line_items."""
    svc = get_line_item_service()
    return svc.get_categories()


@router.get("/helper/line-items/{item_code}", tags=["Xactimate Helper"])
async def get_helper_line_item(item_code: str):
    """Get a specific line item from xact_line_items."""
    svc = get_line_item_service()
    item = svc.get_by_code(item_code)
    if not item:
        raise HTTPException(status_code=404, detail="Line item not found")
    return item


# ═══════════════════════════════════════════════════════════════════════════════
# Embedding Sync (Admin)
# ═══════════════════════════════════════════════════════════════════════════════


@router.post(
    "/embed/sync",
    response_model=EmbeddingSyncResponse,
    tags=["Xactimate Helper Admin"],
)
async def sync_embeddings(data: EmbeddingSyncRequest):
    """
    Batch generate/update embeddings for line items.
    Admin-only endpoint for initial setup and periodic refresh.
    """
    svc = get_embedding_service()
    result = await svc.sync_embeddings(
        category=data.category,
        force_regenerate=data.force_regenerate,
    )
    return result


# ═══════════════════════════════════════════════════════════════════════════════
# Description AI Generation
# ═══════════════════════════════════════════════════════════════════════════════


@router.post("/helper/line-items/{item_code}/generate-descriptions", tags=["Xactimate Helper"])
async def generate_descriptions(
    item_code: str,
    damage_type: str = Query("general"),
    room_type: str = Query("any"),
):
    """
    Generate AI descriptions for a line item if none exist.
    Generated descriptions are saved with is_ai_generated=True, approved=False.
    """
    svc = get_description_service()
    try:
        generated = await svc.generate_if_missing(
            item_code=item_code,
            damage_type=damage_type,
            room_type=room_type,
        )
        return {
            "item_code": item_code,
            "generated_count": len(generated),
            "descriptions": generated,
        }
    except Exception as e:
        logger.error(f"Description generation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Generation failed: {str(e)}")
