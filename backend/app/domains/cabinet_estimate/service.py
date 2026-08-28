"""
Cabinet Estimate service layer
"""

import json
import logging
from typing import Any, Dict, List, Optional
from uuid import UUID

from app.core.interfaces import DatabaseSession

from .calculator import BoxInput, calculate_estimate
from .models import (
    CabinetBox,
    CabinetEstimate,
    CabinetEstimateHistory,
    CabinetEstimateLineItem,
)
from .repository import (
    CabinetBoxRepository,
    CabinetEstimateRepository,
    CabinetHistoryRepository,
    CabinetLineItemRepository,
)
from .schemas import CabinetEstimateCreate, CabinetEstimateUpdate

logger = logging.getLogger(__name__)


class CabinetEstimateService:
    def __init__(self, session: DatabaseSession):
        self.session = session
        self.estimate_repo = CabinetEstimateRepository(session)
        self.box_repo = CabinetBoxRepository(session)
        self.line_item_repo = CabinetLineItemRepository(session)
        self.history_repo = CabinetHistoryRepository(session)

    # ── CRUD ──

    def create_estimate(
        self, data: CabinetEstimateCreate, created_by_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Create a new cabinet estimate with boxes."""
        boxes_data = data.boxes
        estimate_data = data.dict(exclude={"boxes"})
        estimate_data["created_by_id"] = created_by_id
        estimate_data["status"] = "draft"

        result = self.estimate_repo.create(estimate_data)
        estimate_id = result["id"]

        # Create boxes
        for i, box in enumerate(boxes_data):
            box_dict = box.dict()
            box_dict["estimate_id"] = estimate_id
            box_dict["display_order"] = i
            self.box_repo.create(box_dict)

        self.session.flush()
        return self._get_full_estimate(estimate_id)

    def get_estimate(self, estimate_id: str) -> Optional[Dict[str, Any]]:
        """Get estimate with all relations."""
        return self._get_full_estimate(estimate_id)

    def list_estimates(
        self,
        claim_id: Optional[str] = None,
        company_id: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[List[Dict[str, Any]], int]:
        """List estimates with filters."""
        estimates, total = self.estimate_repo.find_by_filters(
            claim_id=claim_id,
            company_id=company_id,
            status=status,
            search=search,
            page=page,
            page_size=page_size,
        )
        items = []
        for est in estimates:
            item = self.estimate_repo._convert_to_dict(est)
            item["boxes"] = [self.box_repo._convert_to_dict(b) for b in est.boxes]
            item["line_items"] = [self.line_item_repo._convert_to_dict(li) for li in est.line_items]
            self._enrich_claim_info(est, item)
            items.append(item)
        return items, total

    def update_estimate(
        self,
        estimate_id: str,
        data: CabinetEstimateUpdate,
        updated_by_id: Optional[str] = None,
        skip_full_read: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """Update estimate fields and optionally replace boxes."""
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None

        update_dict = data.dict(exclude_unset=True, exclude={"boxes"})
        if update_dict:
            self.estimate_repo.update(estimate_id, update_dict)

        # Replace boxes if provided
        if data.boxes is not None:
            self.box_repo.delete_by_estimate_id(estimate_id)
            for i, box in enumerate(data.boxes):
                box_dict = box.dict()
                box_dict["estimate_id"] = estimate_id
                box_dict["display_order"] = i
                self.box_repo.create(box_dict)

        self.session.flush()
        if skip_full_read:
            return {"id": estimate_id}
        return self._get_full_estimate(estimate_id)

    def delete_estimate(self, estimate_id: str) -> bool:
        """Delete an estimate and all related data (cascaded)."""
        estimate = self.estimate_repo.get_by_id(estimate_id)
        if not estimate:
            return False
        self.estimate_repo.delete(estimate_id)
        self.session.flush()
        return True

    # ── Calculation ──

    def calculate(
        self, estimate_id: str, save_history: bool = True, changed_by_id: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Run calculation on an estimate's boxes and save results."""
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None

        if not estimate.tier:
            raise ValueError("Tier is required to calculate")

        if not estimate.boxes:
            raise ValueError("At least one cabinet box is required")

        # Convert DB boxes to calculator inputs
        box_inputs = [
            BoxInput(
                code=b.code,
                cab_type=b.cab_type,
                location=getattr(
                    b, 'location', 'perimeter',
                ) or 'perimeter',
                width_inches=b.width_inches,
                height_inches=b.height_inches,
                is_specialty=b.is_specialty,
                specialty_type=b.specialty_type,
                has_glass_door=getattr(
                    b, 'has_glass_door', False,
                ) or False,
                qty=b.qty,
            )
            for b in estimate.boxes
        ]

        result = calculate_estimate(
            boxes=box_inputs,
            tier=estimate.tier,
            zip_code=estimate.zip_code or "",
            include_demo=estimate.include_demo,
            include_install=estimate.include_install,
            include_delivery=estimate.include_delivery,
            include_plumbing=estimate.include_plumbing,
            sink_type=getattr(estimate, 'sink_type', 'single') or 'single',
            include_countertop_reset=estimate.include_countertop_reset,
            include_hardware=(
                estimate.include_hardware
                if estimate.include_hardware is not None
                else True
            ),
            include_crown_molding=(
                getattr(estimate, 'include_crown_molding', False)
                or False
            ),
            include_backsplash=(
                getattr(estimate, 'include_backsplash', False)
                or False
            ),
            backsplash_type=getattr(
                estimate, 'backsplash_type', None
            ),
            backsplash_sqft=getattr(
                estimate, 'backsplash_sqft', None
            ),
            include_toe_kick=(
                getattr(estimate, 'include_toe_kick', True)
                if getattr(estimate, 'include_toe_kick', None)
                is not None else True
            ),
            include_countertop=(
                getattr(estimate, 'include_countertop', False)
                or False
            ),
            countertop_material=getattr(
                estimate, 'countertop_material', None
            ),
            countertop_sqft=getattr(
                estimate, 'countertop_sqft', None
            ),
            include_countertop_backsplash=(
                getattr(
                    estimate,
                    'include_countertop_backsplash',
                    False,
                ) or False
            ),
            countertop_backsplash_lf=getattr(
                estimate,
                'countertop_backsplash_lf',
                None,
            ),
            island_countertop_material=getattr(
                estimate, 'island_countertop_material',
                None,
            ),
            island_countertop_sqft=getattr(
                estimate, 'island_countertop_sqft',
                None,
            ),
            include_drywall_repair=(
                getattr(estimate, 'include_drywall_repair', False)
                or False
            ),
            drywall_repair_type=getattr(
                estimate, 'drywall_repair_type', 'patch',
            ) or 'patch',
            drywall_repair_sqft=getattr(
                estimate, 'drywall_repair_sqft', None
            ),
            include_painting=(
                getattr(estimate, 'include_painting', False)
                or False
            ),
            painting_sqft=getattr(
                estimate, 'painting_sqft', None
            ),
            include_appliance_rr=(
                getattr(estimate, 'include_appliance_rr', False)
                or False
            ),
            appliance_list=(
                getattr(estimate, 'appliance_list', None)
            ),
            include_dumpster=(
                getattr(estimate, 'include_dumpster', True)
                if getattr(estimate, 'include_dumpster', None)
                is not None else True
            ),
            include_electrical=(
                getattr(estimate, 'include_electrical', False)
                or False
            ),
            include_permit=(
                getattr(estimate, 'include_permit', False)
                or False
            ),
            outlet_relocation_count=(
                getattr(estimate, 'outlet_relocation_count', 0)
                or 0
            ),
            delivery_floor=getattr(
                estimate, 'delivery_floor', 1,
            ) or 1,
            island_type=getattr(
                estimate, 'island_type', 'custom',
            ) or 'custom',
            island_prefab_size=getattr(
                estimate, 'island_prefab_size', None,
            ),
            island_prefab_price=getattr(
                estimate, 'island_prefab_price', None,
            ),
            island_end_panel_sqft=getattr(
                estimate, 'island_end_panel_sqft', 0
            ) or 0,
            island_back_panel_sqft=getattr(
                estimate, 'island_back_panel_sqft', 0
            ) or 0,
            overhead_pct=(
                estimate.overhead_pct
                if estimate.overhead_pct is not None
                else 0.15
            ),
            profit_pct=(
                estimate.profit_pct
                if estimate.profit_pct is not None
                else 0.15
            ),
            target_total=(
                getattr(estimate, 'target_total', None)
            ),
        )

        # Save history before updating
        if save_history:
            self._save_history(estimate_id, changed_by_id, "Calculation executed")

        # Clear existing line items and create new ones
        self.line_item_repo.delete_by_estimate_id(
            estimate_id,
        )
        for i, li in enumerate(result.line_items):
            self.line_item_repo.create({
                "estimate_id": estimate_id,
                "description": li.description,
                "quantity": li.quantity,
                "unit": li.unit,
                "unit_price": li.unit_price,
                "total": li.total,
                "category": li.category,
                "location": li.location,
                "notes": li.notes,
                "display_order": i,
            })

        # Update estimate totals
        self.estimate_repo.update(estimate_id, {
            "subtotal": result.subtotal,
            "overhead_pct": result.overhead_pct,
            "overhead_amount": result.overhead_amount,
            "profit_pct": result.profit_pct,
            "profit_amount": result.profit_amount,
            "adjustment_factor": result.adjustment_factor,
            "total": result.total,
            "methodology_notes": result.methodology_notes,
            "warning_flags": result.warning_flags,
            "status": "calculated",
        })

        self.session.flush()
        return self._get_full_estimate(estimate_id)

    # ── Clone ──

    def clone_estimate(
        self, estimate_id: str, created_by_id: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Clone an existing estimate into a new draft."""
        source = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not source:
            return None

        # Every input column is copied so a clone recalculates to the
        # same numbers; only the calculated results (subtotal/total/O&P
        # amounts, adjustment_factor, methodology_notes, warning_flags)
        # are left out - calculate() regenerates them.
        copy_fields = [
            "claim_id", "company_id", "property_address", "zip_code",
            "layout_type", "kitchen_size_sqft", "ceiling_height",
            "has_soffit", "tier", "box_material", "finish", "door_style",
            "include_demo", "include_install", "include_delivery",
            "include_plumbing", "sink_type", "include_countertop_reset",
            "include_hardware", "include_crown_molding",
            "include_backsplash", "backsplash_type", "backsplash_sqft",
            "include_toe_kick", "include_countertop",
            "include_drywall_repair", "drywall_repair_type",
            "drywall_repair_sqft", "include_painting", "painting_sqft",
            "include_appliance_rr", "appliance_list", "include_dumpster",
            "include_electrical", "include_permit",
            "outlet_relocation_count", "delivery_floor", "island_type",
            "island_prefab_size", "island_prefab_price",
            "island_end_panel_sqft", "island_back_panel_sqft",
            "countertop_material", "countertop_sqft",
            "include_countertop_backsplash", "countertop_backsplash_lf",
            "island_countertop_material", "island_countertop_sqft",
            "overview_text", "target_total", "overhead_pct", "profit_pct",
        ]

        new_data = {
            "created_by_id": created_by_id,
            "status": "draft",
            "notes": "Cloned from estimate",
        }
        for field in copy_fields:
            new_data[field] = getattr(source, field, None)

        result = self.estimate_repo.create(new_data)
        new_id = result["id"]

        # Copy boxes
        for i, box in enumerate(source.boxes):
            self.box_repo.create({
                "estimate_id": new_id,
                "code": box.code,
                "cab_type": box.cab_type,
                "location": getattr(
                    box, 'location', 'perimeter',
                ) or 'perimeter',
                "width_inches": box.width_inches,
                "height_inches": box.height_inches,
                "is_specialty": box.is_specialty,
                "specialty_type": box.specialty_type,
                "has_glass_door": getattr(
                    box, 'has_glass_door', False,
                ) or False,
                "qty": box.qty,
                "display_order": i,
            })

        self.session.flush()
        return self._get_full_estimate(new_id)

    # ── History ──

    def get_history(self, estimate_id: str) -> List[Dict[str, Any]]:
        history = self.history_repo.find_by_estimate_id(estimate_id)
        return [self.history_repo._convert_to_dict(h) for h in history]

    def _save_history(
        self, estimate_id: str, changed_by_id: Optional[str], description: str
    ):
        """Save a snapshot of the current estimate state."""
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return

        version = self.history_repo.get_latest_version(estimate_id) + 1
        snapshot = self.estimate_repo._convert_to_dict(estimate)
        snapshot["boxes"] = [self.box_repo._convert_to_dict(b) for b in estimate.boxes]
        snapshot["line_items"] = [
            self.line_item_repo._convert_to_dict(li) for li in estimate.line_items
        ]

        self.history_repo.create({
            "estimate_id": estimate_id,
            "version_number": version,
            "snapshot_data": snapshot,
            "changed_by_id": changed_by_id,
            "change_description": description,
        })

    # ── Purchase Order ──

    def get_purchase_order(self, estimate_id: str) -> Optional[Dict[str, Any]]:
        """Get grouped box list for supplier ordering."""
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None

        # Group boxes by code + location
        box_groups: Dict[str, Dict] = {}
        for box in estimate.boxes:
            loc = getattr(
                box, 'location', 'perimeter',
            ) or 'perimeter'
            key = f"{box.code}_{loc}"
            if key in box_groups:
                box_groups[key]["qty"] += box.qty
            else:
                loc_label = (
                    " (Island)"
                    if loc == "island" else ""
                )
                box_groups[key] = {
                    "code": box.code,
                    "description": (
                        f"{box.cab_type.title()} "
                        f"Cabinet {box.code} "
                        f"({box.width_inches}\"W x "
                        f"{box.height_inches}\"H)"
                        f"{loc_label}"
                    ),
                    "cab_type": box.cab_type,
                    "width_inches": box.width_inches,
                    "height_inches": box.height_inches,
                    "qty": box.qty,
                }

        items = sorted(box_groups.values(), key=lambda x: (x["cab_type"], x["code"]))
        total_boxes = sum(i["qty"] for i in items)

        return {
            "estimate_id": estimate_id,
            "property_address": estimate.property_address,
            "items": items,
            "total_boxes": total_boxes,
        }

    # ── Helpers ──

    def _get_full_estimate(self, estimate_id: str) -> Optional[Dict[str, Any]]:
        """Get estimate dict with boxes, line_items, and claim info."""
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None

        result = self.estimate_repo._convert_to_dict(estimate)
        result["boxes"] = [self.box_repo._convert_to_dict(b) for b in estimate.boxes]
        result["line_items"] = [
            self.line_item_repo._convert_to_dict(li) for li in estimate.line_items
        ]
        self._enrich_claim_info(estimate, result)
        self._enrich_company_info(estimate, result)
        return result

    def _enrich_claim_info(
        self,
        estimate: CabinetEstimate,
        result: Dict[str, Any],
    ):
        """Add claim_number and client_name."""
        if estimate.claim_ref:
            result["claim_number"] = (
                estimate.claim_ref.claim_number
            )
            if estimate.claim_ref.client:
                result["client_name"] = (
                    estimate.claim_ref.client.display_name
                )
            else:
                result["client_name"] = None
        else:
            result["claim_number"] = None
            result["client_name"] = None

    def _enrich_company_info(
        self,
        estimate: CabinetEstimate,
        result: Dict[str, Any],
    ):
        """Add company details for PDF header."""
        if not estimate.company_id:
            result["company_info"] = None
            return
        from app.domains.company.models import Company
        company = (
            self.session.query(Company)
            .filter(Company.id == estimate.company_id)
            .first()
        )
        if company:
            result["company_info"] = {
                "name": company.name,
                "address": company.address,
                "city": company.city,
                "state": company.state,
                "zipcode": company.zipcode,
                "phone": company.phone,
                "email": company.email,
                "website": company.website,
                "license_number": company.license_number,
                "logo": company.logo,
            }
        else:
            result["company_info"] = None
