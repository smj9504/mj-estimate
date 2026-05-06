"""
Material Order service.
Orchestrates calculation, CRUD, and export for material orders.
"""

import logging
from typing import Any, Dict, List, Optional

from app.core.interfaces import DatabaseSession

from .calculator import calculate_roofing, calculate_siding
from .repository import MaterialOrderItemRepository, MaterialOrderRepository
from .schemas import (
    MaterialItem,
    MaterialOrderRequest,
    MaterialOrderResponse,
    ScopeType,
)

logger = logging.getLogger(__name__)


# ── Stateless calculation (no DB) ──

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


# ── DB-backed CRUD service ──

class MaterialOrderService:
    def __init__(self, session: DatabaseSession):
        self.session = session
        self.order_repo = MaterialOrderRepository(session)
        self.item_repo = MaterialOrderItemRepository(session)

    def _to_dict(self, order) -> Dict[str, Any]:
        """Convert ORM object to response dict."""
        d = self.order_repo._convert_to_dict(order)
        items = [self.item_repo._convert_to_dict(item) for item in order.items]
        for item in items:
            if "Pipe Flashing" in (item.get("item") or "") and "verify" in (item.get("item") or ""):
                item["item"] = 'Pipe Flashing 1-3" Aluminum'
                item["note"] = None
            if "FilterVent" in (item.get("item") or ""):
                item["item"] = '4\' Ridge Vent 12" Filtered'
        d["items"] = items
        return d

    def create(self, data: dict, created_by_id: Optional[str] = None) -> Dict[str, Any]:
        items_data = data.pop("items", [])
        data["created_by_id"] = created_by_id
        data["status"] = data.get("status", "draft")
        data["item_count"] = len(items_data)
        data["total_material_cost"] = sum(
            (it.get("qty", 0) * (it.get("unit_price") or 0)) for it in items_data
        )

        result = self.order_repo.create(data)
        order_id = result["id"]

        for idx, item in enumerate(items_data):
            item["order_id"] = order_id
            item["display_order"] = idx
            self.item_repo.create(item)

        self.session.flush()
        order = self.order_repo.find_by_id_with_items(order_id)
        return self._to_dict(order)

    def get(self, order_id: str) -> Optional[Dict[str, Any]]:
        order = self.order_repo.find_by_id_with_items(order_id)
        if not order:
            return None
        return self._to_dict(order)

    def list(
        self,
        scope_type: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple:
        orders, total = self.order_repo.find_by_filters(
            scope_type=scope_type,
            status=status,
            search=search,
            page=page,
            page_size=page_size,
        )
        items = [self._to_dict(o) for o in orders]
        return items, total

    def update(self, order_id: str, data: dict) -> Optional[Dict[str, Any]]:
        order = self.order_repo.find_by_id_with_items(order_id)
        if not order:
            return None

        items_data = data.pop("items", None)

        if items_data is not None:
            # Replace all items
            self.item_repo.delete_by_order_id(order_id)
            for idx, item in enumerate(items_data):
                item["order_id"] = order_id
                item["display_order"] = idx
                self.item_repo.create(item)
            data["item_count"] = len(items_data)
            data["total_material_cost"] = sum(
                (it.get("qty", 0) * (it.get("unit_price") or 0)) for it in items_data
            )

        if data:
            self.order_repo.update(order_id, data)

        self.session.flush()
        order = self.order_repo.find_by_id_with_items(order_id)
        return self._to_dict(order)

    def delete(self, order_id: str) -> bool:
        order = self.order_repo.get_by_id(order_id)
        if not order:
            return False
        self.order_repo.delete(order_id)
        self.session.flush()
        return True
