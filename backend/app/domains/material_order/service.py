"""
Material Order service.
Orchestrates calculation and export for material orders.
"""

import logging
from typing import List

from .calculator import calculate_roofing, calculate_siding
from .schemas import (
    MaterialItem,
    MaterialOrderRequest,
    MaterialOrderResponse,
    ScopeType,
)

logger = logging.getLogger(__name__)


def generate_material_order(req: MaterialOrderRequest) -> MaterialOrderResponse:
    """Generate material order list from measurements."""
    materials: List[MaterialItem] = []
    notes: List[str] = []
    measurements_dict = {}

    if req.scope_type == ScopeType.roofing:
        if not req.roofing_measurements:
            raise ValueError("Roofing measurements are required for roofing scope")
        m = req.roofing_measurements
        m.waste_pct = req.waste_pct
        materials = calculate_roofing(m, req.brand, req.product, req.color)
        measurements_dict = m.model_dump()

        # Add notes
        if m.structure_complexity:
            notes.append(f"Structure Complexity: {m.structure_complexity}")
        if m.penetration_count > 0:
            notes.append(f"Penetrations: {m.penetration_count} - verify pipe flashing sizes on-site")
        if m.step_flashing_lf > 0:
            notes.append(f"Step Flashing: {m.step_flashing_lf:.0f} LF - verify on-site")

    elif req.scope_type == ScopeType.siding:
        if not req.siding_measurements:
            raise ValueError("Siding measurements are required for siding scope")
        m = req.siding_measurements
        m.waste_pct = req.waste_pct
        materials = calculate_siding(m, req.brand, req.product, req.color)
        measurements_dict = m.model_dump()

        if m.masonry_sqft > 0:
            notes.append(
                f"Masonry area: {m.masonry_sqft:.0f} ft² excluded from siding qty. "
                "Siding-to-masonry borders require butyl flashing tape + caulk."
            )

    return MaterialOrderResponse(
        scope_type=req.scope_type,
        property_address=req.property_address,
        report_number=req.report_number,
        delivery_date=req.delivery_date,
        brand=req.brand,
        product=req.product,
        color=req.color,
        measurements=measurements_dict,
        materials=materials,
        notes=notes,
    )
