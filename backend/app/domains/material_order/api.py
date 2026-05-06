"""
Material Order API endpoints.
"""

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response

from app.core.database_factory import get_db_session
from app.core.interfaces import DatabaseSession
from app.domains.auth.dependencies import get_current_user

from .export_service import generate_pdf
from .schemas import (
    MaterialOrderExportRequest,
    MaterialOrderRequest,
    MaterialOrderResponse,
    MaterialOrderSave,
    OutputType,
)
from .service import MaterialOrderService, generate_material_order
from .calculator import BRAND_SPECS

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/material-orders/brands")
def get_brands():
    """Return available brands and their scope support."""
    result = {}
    for brand_name, scopes in BRAND_SPECS.items():
        result[brand_name] = {
            "roofing": "roofing" in scopes,
            "siding": "siding" in scopes,
        }
    return result


@router.post("/material-orders/calculate", response_model=MaterialOrderResponse)
def calculate_material_order(req: MaterialOrderRequest):
    """Calculate material quantities from measurements."""
    try:
        return generate_material_order(req)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Material order calculation failed")
        raise HTTPException(status_code=500, detail=f"Calculation error: {str(e)}")


@router.post("/material-orders/export/pdf")
def export_material_order_pdf(req: MaterialOrderExportRequest):
    """Generate PDF document (Supply Order or Internal Estimate)."""
    try:
        pdf_bytes = generate_pdf(
            output_type=req.output_type,
            scope_type=req.scope_type.value,
            property_address=req.property_address,
            report_number=req.report_number,
            delivery_date=req.delivery_date,
            brand=req.brand,
            product=req.product,
            color=req.color,
            measurements=req.measurements,
            materials=[m.model_dump() for m in req.materials],
            notes=req.notes,
        )

        filename_prefix = "supply_order" if req.output_type == OutputType.supply_order else "internal_estimate"
        scope = req.scope_type.value
        filename = f"{filename_prefix}_{scope}.pdf"

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        logger.exception("PDF export failed")
        raise HTTPException(status_code=500, detail=f"PDF generation error: {str(e)}")


# ── CRUD (DB-backed) ──

@router.post("/material-orders/save")
def save_material_order(
    data: MaterialOrderSave,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Create a new material order in DB."""
    service = MaterialOrderService(session)
    payload = data.model_dump()
    user_id = current_user.get("id") if isinstance(current_user, dict) else getattr(current_user, "id", None)
    return service.create(payload, created_by_id=str(user_id) if user_id else None)


@router.get("/material-orders/list")
def list_material_orders(
    scope_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """List material orders with filters."""
    service = MaterialOrderService(session)
    items, total = service.list(
        scope_type=scope_type,
        status=status,
        search=search,
        page=page,
        page_size=page_size,
    )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/material-orders/{order_id}")
def get_material_order(
    order_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Get a single material order by ID."""
    service = MaterialOrderService(session)
    result = service.get(order_id)
    if not result:
        raise HTTPException(status_code=404, detail="Material order not found")
    return result


@router.put("/material-orders/{order_id}")
def update_material_order(
    order_id: str,
    data: MaterialOrderSave,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Update an existing material order."""
    service = MaterialOrderService(session)
    result = service.update(order_id, data.model_dump())
    if not result:
        raise HTTPException(status_code=404, detail="Material order not found")
    return result


@router.delete("/material-orders/{order_id}")
def delete_material_order(
    order_id: str,
    session: DatabaseSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    """Delete a material order."""
    service = MaterialOrderService(session)
    if not service.delete(order_id):
        raise HTTPException(status_code=404, detail="Material order not found")
    return {"message": "Material order deleted"}


@router.post("/material-orders/parse-eagleview")
def parse_eagleview_for_material_order(
    file: UploadFile = File(...),
):
    """Parse EagleView JSON and return roofing measurements for material order."""
    from app.domains.roofing_estimate.eagleview_parser import (
        parse_eagleview,
        extract_measurements,
    )

    try:
        content = file.file.read()
        raw_data = json.loads(content)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON file: {str(e)}")

    try:
        parsed = parse_eagleview(raw_data)
        measurements = extract_measurements(parsed)
    except (ValueError, KeyError) as e:
        raise HTTPException(status_code=400, detail=f"EagleView parse error: {str(e)}")

    # Extract report/location metadata from raw JSON
    ev_root = raw_data.get("EAGLEVIEW_EXPORT", raw_data)
    report_node = ev_root.get("REPORT", {})
    location_node = ev_root.get("LOCATION", {})

    report_id = report_node.get("@reportId", report_node.get("reportId", ""))
    address = location_node.get("@address", location_node.get("address", ""))
    city = location_node.get("@city", location_node.get("city", ""))
    state = location_node.get("@state", location_node.get("state", ""))
    postal = location_node.get("@postal", location_node.get("postal", ""))
    property_address = f"{address}, {city}, {state} {postal}".strip(", ") if address else ""

    # Map to material order roofing fields
    eaves = measurements.get("eave_lf", 0)
    rakes = measurements.get("rake_lf", 0)
    squares = measurements.get("squares", 0)
    waste_pct = 12.0
    complexity = None
    structs = measurements.get("structures", [])
    if structs:
        c = structs[0].get("complexity", "")
        if c == "simple":
            waste_pct = 8.0
            complexity = "Simple"
        elif c == "complex":
            waste_pct = 18.0
            complexity = "Complex"
        else:
            waste_pct = 13.0
            complexity = "Normal"

    return {
        "property_address": property_address,
        "report_number": str(report_id),
        "total_area_sf": measurements.get("total_sf", 0),
        "squares": squares,
        "squares_with_waste": round(squares * (1 + waste_pct / 100), 2),
        "eaves_lf": eaves,
        "rakes_lf": rakes,
        "ridges_lf": measurements.get("ridge_lf", 0),
        "hips_lf": measurements.get("hip_lf", 0),
        "valleys_lf": measurements.get("valley_lf", 0),
        "step_flashing_lf": measurements.get("step_flashing_lf", 0),
        "drip_edge_lf": round(eaves + rakes, 1),
        "penetration_count": measurements.get("penetration_count", 0),
        "waste_pct": waste_pct,
        "structure_complexity": complexity,
        "predominant_pitch": measurements.get("predominant_pitch"),
        "structures": structs,
    }
