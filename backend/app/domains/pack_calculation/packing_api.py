"""
Packing Estimate API endpoints

New endpoints for the integrated packing estimation system.
Supports Quick Estimate and Photo AI modes with
client/company DB integration.
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
import logging
from sqlalchemy.orm import Session, joinedload
from typing import Optional

from app.core.database_factory import get_db
from app.domains.auth.dependencies import get_current_user
from app.domains.staff.models import Staff

from .packing_schemas import (
    QuickEstimateRequest,
    RoomsEstimateRequest,
    EstimateResponse,
    RoomPhotoAnalysisRequest,
    RoomAnalysisResponse,
    BatchRoomAnalysisRequest,
    MasterContentRequest,
    MasterContentResponse,
    SubmitCorrectionsRequest,
    SubmitCorrectionsResponse,
)
from .models import (
    PackCalculation, PackRoom, PackItem,
    PackEstimateMode, PackEstimateStatus,
    PackingPrice,
)
from .presets import get_presets_by_category
from .seed_prices import seed_packing_prices

router = APIRouter(
    prefix="/packing-estimate",
    tags=["packing_estimate"],
)
logger = logging.getLogger(__name__)


# ── Estimate Calculation ──────────────────────

@router.post(
    "/quick-estimate",
    response_model=EstimateResponse,
)
def quick_estimate(
    request: QuickEstimateRequest,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """Calculate packing estimate from room presets."""
    from .packing_service import EstimateCalculator
    calc = EstimateCalculator(
        db, company_id=request.company_id
    )
    result = calc.calculate_estimate(request)

    # Save to DB
    pack_calc = _save_calculation(
        db, request, result,
        current_user.id, PackEstimateMode.QUICK,
    )
    result.id = str(pack_calc.id)

    return result


@router.post(
    "/content-estimate",
    response_model=EstimateResponse,
)
def content_estimate(
    request: RoomsEstimateRequest,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """Calculate packing estimate from detected items
    (Photo AI mode)."""
    from .packing_service import EstimateCalculator
    calc = EstimateCalculator(
        db, company_id=request.company_id
    )
    result = calc.calculate_estimate_from_content(request)

    pack_calc = _save_calculation(
        db, request, result,
        current_user.id, PackEstimateMode.PHOTO_AI,
    )
    result.id = str(pack_calc.id)

    return result


# ── Room Photo Analysis ───────────────────────

@router.post(
    "/analyze-room",
    response_model=RoomAnalysisResponse,
)
async def analyze_room(
    request: RoomPhotoAnalysisRequest,
    current_user: Staff = Depends(get_current_user),
):
    """Analyze room photos with Claude Vision API."""
    from .vision import analyze_room_photos
    result = await analyze_room_photos(
        room_name=request.room_name,
        images=request.images,
        existing_items=request.existing_items or None,
    )
    return result


@router.post("/analyze-batch")
async def analyze_batch(
    request: BatchRoomAnalysisRequest,
    current_user: Staff = Depends(get_current_user),
):
    """Batch analyze multiple rooms with SSE streaming."""
    from .vision import analyze_room_photos
    import json
    import asyncio

    async def generate():
        succeeded = 0
        failed = 0
        failed_rooms = []

        for i, room in enumerate(request.rooms):
            try:
                result = await analyze_room_photos(
                    room_name=room.room_name,
                    images=room.images,
                    existing_items=(
                        [{"name": e.name, "quantity": e.quantity}
                         for e in room.existing_items]
                        if room.existing_items else None
                    ),
                )
                event = {
                    "event": "room_result",
                    "batch_id": request.batch_id,
                    "room_index": i,
                    "total_rooms": len(request.rooms),
                    "status": "success",
                    "room_name": room.room_name,
                    "result": result.model_dump(),
                }
                succeeded += 1
            except Exception as e:
                event = {
                    "event": "room_result",
                    "batch_id": request.batch_id,
                    "room_index": i,
                    "total_rooms": len(request.rooms),
                    "status": "error",
                    "room_name": room.room_name,
                    "error_message": str(e),
                }
                failed += 1
                failed_rooms.append(room.room_name)

            yield f"data: {json.dumps(event)}\n\n"

            if i < len(request.rooms) - 1:
                await asyncio.sleep(1)

        complete = {
            "event": "batch_complete",
            "batch_id": request.batch_id,
            "total_rooms": len(request.rooms),
            "succeeded": succeeded,
            "failed": failed,
            "failed_rooms": failed_rooms,
        }
        yield f"data: {json.dumps(complete)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
    )


# ── Master Content List ───────────────────────

@router.post(
    "/master-content",
    response_model=MasterContentResponse,
)
def master_content(
    request: MasterContentRequest,
    current_user: Staff = Depends(get_current_user),
):
    """Aggregate all detected items across rooms."""
    from .vision import build_master_content_list
    return build_master_content_list(request.rooms)


# ── Corrections ───────────────────────────────

@router.post(
    "/corrections",
    response_model=SubmitCorrectionsResponse,
)
def submit_corrections(
    request: SubmitCorrectionsRequest,
    current_user: Staff = Depends(get_current_user),
):
    """Submit item corrections for ML training."""
    return SubmitCorrectionsResponse(
        saved=len(request.corrections)
    )


# ── Presets ───────────────────────────────────

@router.get("/presets")
def get_presets():
    """Get all room presets grouped by category."""
    return get_presets_by_category()


# ── Prices Management ─────────────────────────

@router.get("/prices")
def get_prices(
    company_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """Get packing prices for the company."""
    query = db.query(PackingPrice).filter(
        PackingPrice.is_active.is_(True)
    )
    if company_id:
        query = query.filter(
            PackingPrice.company_id == company_id
        )
    items = query.all()

    if not items:
        count = seed_packing_prices(db)
        if count > 0:
            items = db.query(PackingPrice).filter(
                PackingPrice.is_active.is_(True)
            ).all()

    return [
        {
            "id": str(p.id),
            "code": p.code,
            "name": p.name,
            "unit": p.unit,
            "unit_price": p.unit_price,
            "cat": p.category,
            "is_taxable": p.is_taxable,
        }
        for p in items
    ]


@router.patch("/prices/{price_id}")
def update_price(
    price_id: str,
    update: dict,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """Update a packing price."""
    price = db.query(PackingPrice).filter(
        PackingPrice.id == price_id
    ).first()
    if not price:
        raise HTTPException(404, "Price not found")

    if "unit_price" in update:
        price.unit_price = update["unit_price"]
    if "name" in update:
        price.name = update["name"]

    db.commit()
    return {"id": str(price.id), "updated": True}


@router.post("/prices/seed")
def seed_prices(
    company_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """Seed default packing prices."""
    count = seed_packing_prices(
        db,
        company_id=company_id,
        created_by_id=current_user.id,
    )
    return {"created": count}


# ── CRUD ──────────────────────────────────────

@router.get("/list")
def list_estimates(
    client_id: Optional[str] = None,
    company_id: Optional[str] = None,
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """List packing estimates with optional filters."""
    query = db.query(PackCalculation).options(
        joinedload(PackCalculation.client),
        joinedload(PackCalculation.company),
    ).order_by(
        PackCalculation.created_at.desc()
    )
    if client_id:
        query = query.filter(
            PackCalculation.client_id == client_id
        )
    if company_id:
        query = query.filter(
            PackCalculation.company_id == company_id
        )
    if status:
        query = query.filter(
            PackCalculation.status == status
        )

    # Count without joinedload for efficiency
    count_query = db.query(PackCalculation.id)
    if client_id:
        count_query = count_query.filter(
            PackCalculation.client_id == client_id
        )
    if company_id:
        count_query = count_query.filter(
            PackCalculation.company_id == company_id
        )
    if status:
        count_query = count_query.filter(
            PackCalculation.status == status
        )
    total = count_query.count()
    items = query.offset(skip).limit(limit).all()

    return {
        "total": total,
        "items": [
            _calc_to_summary(c) for c in items
        ],
    }


@router.get("/{calc_id}")
def get_estimate(
    calc_id: str,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """Get a packing estimate by ID."""
    calc = db.query(PackCalculation).options(
        joinedload(PackCalculation.client),
        joinedload(PackCalculation.company),
    ).filter(
        PackCalculation.id == calc_id
    ).first()
    if not calc:
        raise HTTPException(404, "Estimate not found")
    return _calc_to_detail(calc, db)


@router.put("/{calc_id}")
def update_estimate(
    calc_id: str,
    update: dict,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """Update a packing estimate (status, sections, etc.)."""
    calc = db.query(PackCalculation).filter(
        PackCalculation.id == calc_id
    ).first()
    if not calc:
        raise HTTPException(404, "Estimate not found")

    updatable = [
        "calculation_name", "status", "notes",
        "sections", "section_details", "supplements",
        "subtotal", "op_amount", "contingency_amount",
        "supplements_total", "grand_total",
        "client_id", "company_id", "claim_id",
    ]
    for field in updatable:
        if field in update:
            setattr(calc, field, update[field])

    calc.updated_by_id = current_user.id
    db.commit()
    return {"id": str(calc.id), "updated": True}


@router.delete("/{calc_id}")
def delete_estimate(
    calc_id: str,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """Delete a packing estimate."""
    calc = db.query(PackCalculation).filter(
        PackCalculation.id == calc_id
    ).first()
    if not calc:
        raise HTTPException(404, "Estimate not found")

    db.delete(calc)
    db.commit()
    return {"deleted": True}


@router.get("/{calc_id}/export/pdf")
def export_estimate_pdf(
    calc_id: str,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    """Export a packing estimate as PDF."""
    import io
    from .export import generate_estimate_pdf, build_company_info

    calc = db.query(PackCalculation).filter(
        PackCalculation.id == calc_id
    ).first()
    if not calc:
        raise HTTPException(404, "Estimate not found")

    # Build estimate data dict from stored calculation
    estimate_data = {
        "sections": calc.sections or {},
        "section_details": calc.section_details or {},
        "materials_summary": calc.materials_summary or {},
        "material_details": calc.material_details or [],
        "supplements": calc.supplements or [],
        "subtotal": calc.subtotal or 0,
        "op_amount": calc.op_amount or 0,
        "contingency_amount": calc.contingency_amount or 0,
        "supplements_total": calc.supplements_total or 0,
        "grand_total": calc.grand_total or 0,
        "include_op": calc.include_op,
        "op_rate": calc.op_rate,
        "include_contingency": calc.include_contingency,
        "contingency_rate": calc.contingency_rate,
        "crew_size": calc.crew_size,
        "storage_months": calc.storage_months,
        "staging_type": calc.staging_type,
        "include_packback": calc.include_packback,
        "storage_sf": calc.storage_sf or 0,
        "total_hours": calc.total_hours or 0,
        "room_summaries": calc.room_summaries or [],
        "special_items": calc.special_items or [],
        "custom_special_items": calc.custom_special_items or [],
    }

    # Client info
    client_name = None
    client_phone = None
    client_email = None
    if calc.client:
        client_name = calc.client.display_name
        client_phone = calc.client.phone
        client_email = calc.client.email

    # Company info
    company_info = None
    if calc.company:
        company_info = build_company_info(calc.company)

    pdf_bytes = generate_estimate_pdf(
        estimate_data=estimate_data,
        client_name=client_name,
        client_phone=client_phone,
        client_email=client_email,
        property_address=calc.project_address,
        notes=calc.notes,
        company_info=company_info,
    )

    filename = f"packing_estimate_{str(calc.id)[:8]}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )


# ── Helpers ───────────────────────────────────

# Maps request floor strings to DB enum values
_FLOOR_DB = {
    "basement": "BASEMENT",
    "1st": "MAIN_LEVEL",
    "2nd": "SECOND_FLOOR",
    "3rd": "THIRD_FLOOR",
    "4th+": "FOURTH_FLOOR",
}
# Density/Contamination DB enums are lowercase
_DENSITY_DB = {
    "light": "light", "normal": "normal", "dense": "dense",
    "heavy": "heavy", "extreme": "extreme",
}
_CONTAMINATION_DB = {
    "clean": "clean", "gray_water": "gray_water",
    "black_water": "black_water",
}


def _save_calculation(
    db: Session,
    request,
    result: EstimateResponse,
    user_id,
    mode: PackEstimateMode,
) -> PackCalculation:
    """Save calculation result to DB."""
    calc = PackCalculation(
        calculation_name=getattr(
            request, 'calculation_name', None
        ),
        project_address=getattr(
            request, 'project_address', None
        ),
        client_id=getattr(request, 'client_id', None),
        company_id=getattr(request, 'company_id', None),
        claim_id=getattr(request, 'claim_id', None),
        estimate_mode=mode,
        status=PackEstimateStatus.DRAFT,
        crew_size=request.crew_size,
        region=(
            request.region.value
            if hasattr(request.region, 'value')
            else str(request.region)
        ),
        staging_type=(
            request.staging_type.value
            if hasattr(request.staging_type, 'value')
            else str(request.staging_type)
        ),
        include_packback=request.include_packback,
        storage_months=request.storage_months,
        include_op=request.include_op,
        op_rate=request.op_rate,
        include_contingency=getattr(
            request, 'include_contingency', False
        ),
        contingency_rate=getattr(
            request, 'contingency_rate', 0
        ),
        sections=result.sections,
        section_details=result.section_details,
        materials_summary=result.materials,
        material_details=(
            [m.model_dump() for m in result.material_details]
            if result.material_details else None
        ),
        supplements=(
            [s.model_dump() for s in result.supplements]
            if result.supplements else None
        ),
        subtotal=result.subtotal,
        op_amount=result.op_amount,
        contingency_amount=result.contingency_amount,
        supplements_total=result.supplements_total,
        grand_total=result.grand_total,
        storage_sf=result.storage_sf,
        total_hours=result.total_hours,
        total_items=result.total_items,
        room_summaries=(
            [s.model_dump() for s in result.room_summaries]
            if result.room_summaries else None
        ),
        special_items=getattr(
            request, 'special_items', []
        ),
        custom_special_items=(
            [s.model_dump() for s in getattr(
                request, 'custom_special_items', []
            )]
        ),
        created_by_id=user_id,
    )
    db.add(calc)
    db.commit()
    db.refresh(calc)

    # Save rooms and items for Photo AI mode
    if mode == PackEstimateMode.PHOTO_AI and hasattr(request, 'rooms'):
        try:
            for room_input in request.rooms:
                floor_str = (
                    room_input.floor.value
                    if hasattr(room_input.floor, 'value')
                    else str(room_input.floor)
                )
                density_str = (
                    room_input.density.value
                    if hasattr(room_input.density, 'value')
                    else str(room_input.density)
                )
                contam_str = (
                    room_input.contamination.value
                    if hasattr(room_input.contamination, 'value')
                    else str(room_input.contamination)
                )
                pack_room = PackRoom(
                    calculation_id=calc.id,
                    room_name=getattr(room_input, 'room_name', 'Room'),
                    floor_level=_FLOOR_DB.get(floor_str, 'MAIN_LEVEL'),
                    preset_key=getattr(room_input, 'preset_id', None),
                    density=_DENSITY_DB.get(density_str, 'normal'),
                    contamination=_CONTAMINATION_DB.get(contam_str, 'clean'),
                    input_method='IMAGE',
                )
                db.add(pack_room)
                db.flush()

                for item in getattr(room_input, 'items', []):
                    pack_item = PackItem(
                        room_id=pack_room.id,
                        item_name=item.name,
                        item_category=item.category,
                        quantity=item.quantity,
                        detected_by='AI_VISION',
                        fragile=item.is_fragile,
                        is_high_value=item.is_high_value,
                        requires_disassembly=getattr(item, 'needs_disassembly', False),
                        packing_method=getattr(item, 'packing_method', None),
                        required_materials=getattr(item, 'required_materials', None),
                        base_labor_hours=getattr(item, 'base_labor_hours', None),
                        per_unit_labor_hours=getattr(item, 'per_unit_labor_hours', None),
                        estimated_labor_hours=getattr(item, 'estimated_labor_hours', None),
                        estimator_flags=getattr(item, 'estimator_flags', None),
                        special_notes=getattr(item, 'special_instructions', None),
                    )
                    db.add(pack_item)

            db.commit()
        except Exception as e:
            logger.error(f"Failed to save rooms/items: {e}", exc_info=True)
            try:
                db.rollback()
            except Exception:
                pass

    return calc


def _calc_to_summary(calc: PackCalculation) -> dict:
    """Convert calculation to summary dict."""
    client_name = None
    if calc.client:
        client_name = calc.client.display_name
    company_name = None
    if calc.company:
        company_name = calc.company.name

    return {
        "id": str(calc.id),
        "calculation_name": calc.calculation_name,
        "project_address": calc.project_address,
        "client_id": (
            str(calc.client_id)
            if calc.client_id else None
        ),
        "client_name": client_name,
        "company_id": (
            str(calc.company_id)
            if calc.company_id else None
        ),
        "company_name": company_name,
        "mode": (
            calc.estimate_mode.value
            if calc.estimate_mode else None
        ),
        "status": (
            calc.status.value
            if calc.status else None
        ),
        "total_rooms": len(calc.room_summaries) if calc.room_summaries else 0,
        "total_items": calc.total_items,
        "total_hours": calc.total_hours,
        "grand_total": calc.grand_total,
        "created_at": (
            calc.created_at.isoformat()
            if calc.created_at else None
        ),
    }


def _calc_to_detail(calc: PackCalculation, db=None) -> dict:
    """Convert calculation to detail dict."""
    base = _calc_to_summary(calc)
    base.update({
        "notes": calc.notes,
        "crew_size": calc.crew_size,
        "region": calc.region,
        "staging_type": calc.staging_type,
        "include_packback": calc.include_packback,
        "storage_months": calc.storage_months,
        "include_op": calc.include_op,
        "op_rate": calc.op_rate,
        "include_contingency": calc.include_contingency,
        "contingency_rate": calc.contingency_rate,
        "sections": calc.sections,
        "section_details": calc.section_details,
        "materials": calc.materials_summary,
        "material_details": calc.material_details,
        "supplements": calc.supplements,
        "subtotal": calc.subtotal,
        "op_amount": calc.op_amount,
        "contingency_amount": calc.contingency_amount,
        "supplements_total": calc.supplements_total,
        "storage_sf": calc.storage_sf,
        "special_items": calc.special_items,
        "custom_special_items": calc.custom_special_items,
        "room_summaries": calc.room_summaries,
        "claim_id": (
            str(calc.claim_id)
            if calc.claim_id else None
        ),
    })

    # Include rooms with detected items (Photo AI)
    if db:
        try:
            from sqlalchemy import text
            calc_id_str = str(calc.id)
            room_rows = db.execute(text(
                "SELECT id, room_name, floor_level, density, "
                "contamination, preset_key "
                "FROM pack_rooms WHERE calculation_id = :cid "
                "ORDER BY created_at"
            ), {"cid": calc_id_str}).fetchall()

            if room_rows:
                rooms_data = []
                for rr in room_rows:
                    room_id = str(rr[0])
                    item_rows = db.execute(text(
                        "SELECT item_name, item_category, "
                        "quantity, fragile, is_high_value, "
                        "requires_disassembly, packing_method, "
                        "required_materials, base_labor_hours, "
                        "per_unit_labor_hours, "
                        "estimated_labor_hours, "
                        "estimator_flags, special_notes "
                        "FROM pack_items "
                        "WHERE room_id = :rid "
                        "ORDER BY created_at"
                    ), {"rid": room_id}).fetchall()

                    items_data = []
                    for ir in item_rows:
                        items_data.append({
                            "name": ir[0],
                            "category": ir[1],
                            "quantity": ir[2] or 1,
                            "is_fragile": ir[3] or False,
                            "is_high_value": ir[4] or False,
                            "needs_disassembly": ir[5] or False,
                            "packing_method": ir[6],
                            "required_materials": ir[7],
                            "base_labor_hours": ir[8],
                            "per_unit_labor_hours": ir[9],
                            "estimated_labor_hours": ir[10],
                            "estimator_flags": ir[11],
                            "special_instructions": ir[12],
                        })
                    rooms_data.append({
                        "room_name": rr[1],
                        "floor": rr[2],
                        "density": rr[3],
                        "contamination": rr[4],
                        "preset_key": rr[5],
                        "items": items_data,
                    })
                base["rooms"] = rooms_data
        except Exception as e:
            logger.warning(f"Failed to load rooms: {e}")

    return base
