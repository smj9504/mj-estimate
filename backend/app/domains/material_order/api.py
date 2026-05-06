"""
Material Order API endpoints.
"""

import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from .export_service import generate_pdf
from .schemas import (
    MaterialOrderExportRequest,
    MaterialOrderRequest,
    MaterialOrderResponse,
    OutputType,
)
from .service import generate_material_order
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
