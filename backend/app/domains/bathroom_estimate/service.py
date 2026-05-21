"""
Bathroom Estimate service layer
"""

import logging
from typing import Any, Dict, List, Optional

from app.core.interfaces import DatabaseSession

from .calculator import calculate_estimate
from .models import (
    BathroomEstimate,
    BathroomEstimateHistory,
    BathroomEstimateLineItem,
)
from .repository import (
    BathroomEstimateRepository,
    BathroomHistoryRepository,
    BathroomLineItemRepository,
)
from .schemas import BathroomEstimateCreate, BathroomEstimateUpdate

logger = logging.getLogger(__name__)


class BathroomEstimateService:
    def __init__(self, session: DatabaseSession):
        self.session = session
        self.estimate_repo = BathroomEstimateRepository(session)
        self.line_item_repo = BathroomLineItemRepository(session)
        self.history_repo = BathroomHistoryRepository(session)

    # ── CRUD ──

    def create_estimate(
        self, data: BathroomEstimateCreate, created_by_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Create a new bathroom estimate."""
        estimate_data = data.dict()
        estimate_data["created_by_id"] = created_by_id
        estimate_data["status"] = "draft"

        result = self.estimate_repo.create(estimate_data)
        estimate_id = result["id"]
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
    ) -> tuple:
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
            item["line_items"] = [
                self.line_item_repo._convert_to_dict(li) for li in est.line_items
            ]
            self._enrich_claim_info(est, item)
            items.append(item)
        return items, total

    def update_estimate(
        self,
        estimate_id: str,
        data: BathroomEstimateUpdate,
        updated_by_id: Optional[str] = None,
        skip_full_read: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """Update estimate fields."""
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None

        update_dict = data.dict(exclude_unset=True)
        if update_dict:
            self.estimate_repo.update(estimate_id, update_dict)

            # Force SQLAlchemy to detect JSONB field changes
            from sqlalchemy.orm.attributes import flag_modified
            jsonb_fields = [
                'sketch_data', 'shower_spec', 'bathtub_spec',
                'vanity_spec', 'toilet_spec', 'floor_spec',
                'walls_spec', 'accessories_spec', 'plumbing_spec',
                'electrical_spec', 'substrate_spec', 'hidden_costs',
            ]
            for field in jsonb_fields:
                if field in update_dict:
                    try:
                        flag_modified(estimate, field)
                    except Exception:
                        pass

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
        self, estimate_id: str, save_history: bool = True,
        changed_by_id: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Run calculation on the estimate and save results."""
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None

        # Save history before updating
        if save_history:
            self._save_history(estimate_id, changed_by_id, "Calculation executed")

        # Auto-detect water damage from claim if not explicitly set
        self._auto_detect_water_damage(estimate)

        result = calculate_estimate(estimate)

        # Clear existing line items and create new ones
        self.line_item_repo.delete_by_estimate_id(estimate_id)
        for i, li in enumerate(result["line_items"]):
            self.line_item_repo.create({
                "estimate_id": estimate_id,
                "phase": li["phase"],
                "description": li["description"],
                "quantity": li["quantity"],
                "unit": li["unit"],
                "unit_price": li["unit_price"],
                "total": li["total"],
                "category": li["category"],
                "notes": li.get("notes"),
                "display_order": i,
            })

        # Update estimate totals
        self.estimate_repo.update(estimate_id, {
            "subtotal": result["subtotal"],
            "overhead_amount": result["overhead_amount"],
            "profit_amount": result["profit_amount"],
            "tax_amount": result["tax_amount"],
            "total": result["total"],
            "adjustment_factor": result.get("adjustment_factor"),
            "methodology_notes": result.get("methodology_notes"),
            "warning_flags": result.get("warning_flags", []),
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

        # Fields to copy
        copy_fields = [
            "claim_id", "company_id", "property_address", "city", "state",
            "zip_code", "building_type", "year_built", "designation",
            "bath_function", "length_ft", "width_ft", "height_ft",
            "floor_sf", "wall_sf", "demo_floor", "demo_walls",
            "demo_ceiling", "replace_shower", "replace_tub", "replace_vanity",
            "replace_toilet", "replace_floor",
            "detach_reset_shower", "detach_reset_tub",
            "detach_reset_vanity", "detach_reset_toilet",
            "replace_mirror", "detach_reset_mirror",
            "replace_vanity_light", "detach_reset_vanity_light",
            "water_damage", "mold_suspected",
            "existing_tub_material", "shower_spec", "bathtub_spec",
            "vanity_spec", "toilet_spec", "floor_spec", "walls_spec",
            "accessories_spec", "plumbing_spec", "electrical_spec",
            "substrate_spec", "hidden_costs", "sketch_data", "overview_text",
            "include_overhead_profit", "overhead_pct", "profit_pct",
        ]

        new_data = {"created_by_id": created_by_id, "status": "draft"}
        for field in copy_fields:
            new_data[field] = getattr(source, field, None)
        new_data["notes"] = "Cloned from estimate"

        result = self.estimate_repo.create(new_data)
        new_id = result["id"]
        self.session.flush()
        return self._get_full_estimate(new_id)

    # ── Line Item CRUD ──

    def update_line_item(
        self, estimate_id: str, item_id: str, data: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Update a single line item and recalculate totals."""
        item = self.line_item_repo.get_by_id(item_id)
        if not item or str(getattr(item, 'estimate_id', '')) != estimate_id:
            return None

        # Auto-calculate total if qty or rate changed
        update = {k: v for k, v in data.items() if v is not None}
        qty = update.get('quantity', item.quantity)
        rate = update.get('unit_price', item.unit_price)
        if 'total' not in update:
            update['total'] = round(qty * rate, 2)

        self.line_item_repo.update(item_id, update)
        self.session.flush()
        self._recalc_estimate_totals(estimate_id)
        return self._get_full_estimate(estimate_id)

    def delete_line_item(
        self, estimate_id: str, item_id: str
    ) -> Optional[Dict[str, Any]]:
        """Delete a single line item and recalculate totals."""
        item = self.line_item_repo.get_by_id(item_id)
        if not item or str(getattr(item, 'estimate_id', '')) != estimate_id:
            return None
        self.line_item_repo.delete(item_id)
        self.session.flush()
        self._recalc_estimate_totals(estimate_id)
        return self._get_full_estimate(estimate_id)

    def add_line_item(
        self, estimate_id: str, data: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Add a new line item to the estimate."""
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None

        # Determine display_order (append to end of phase)
        max_order = max(
            (li.display_order for li in estimate.line_items), default=-1
        )
        qty = data.get('quantity', 1.0)
        rate = data.get('unit_price', 0.0)
        self.line_item_repo.create({
            "estimate_id": estimate_id,
            "phase": data['phase'],
            "description": data['description'],
            "quantity": qty,
            "unit": data.get('unit', 'EA'),
            "unit_price": rate,
            "total": data.get('total') or round(qty * rate, 2),
            "category": data.get('category', 'misc'),
            "notes": data.get('notes'),
            "display_order": max_order + 1,
        })
        self.session.flush()
        self._recalc_estimate_totals(estimate_id)
        return self._get_full_estimate(estimate_id)

    def delete_phase(
        self, estimate_id: str, phase: int
    ) -> Optional[Dict[str, Any]]:
        """Delete all items in a phase and renumber remaining phases."""
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None

        # Delete items in the target phase
        for li in list(estimate.line_items):
            if li.phase == phase:
                self.line_item_repo.delete(str(li.id))

        # Renumber: shift phases above the deleted one down by 1
        for li in estimate.line_items:
            if li.phase > phase:
                self.line_item_repo.update(str(li.id), {"phase": li.phase - 1})

        self.session.flush()
        self._recalc_estimate_totals(estimate_id)
        return self._get_full_estimate(estimate_id)

    def _recalc_estimate_totals(self, estimate_id: str):
        """Recalculate estimate subtotal/total from current line items."""
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return

        subtotal = sum(li.total for li in estimate.line_items)
        include_op = getattr(estimate, 'include_overhead_profit', False) or False
        overhead_pct = estimate.overhead_pct if estimate.overhead_pct is not None else 0.10
        profit_pct = estimate.profit_pct if estimate.profit_pct is not None else 0.10

        if include_op:
            overhead = round(subtotal * overhead_pct, 2)
            profit = round(subtotal * profit_pct, 2)
        else:
            overhead = 0
            profit = 0

        total = subtotal + overhead + profit
        self.estimate_repo.update(estimate_id, {
            "subtotal": subtotal,
            "overhead": overhead,
            "profit": profit,
            "total": total,
        })
        self.session.flush()

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

    # ── Overview Note Generation ──

    def generate_overview(self, estimate_id: str) -> Optional[str]:
        """Generate AI-powered overview note based on estimate specs."""
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None

        from .note_generator import generate_overview_note
        overview = generate_overview_note(estimate)

        self.estimate_repo.update(estimate_id, {"overview_text": overview})
        self.session.flush()
        return overview

    # ── Auto-detection ──

    def _auto_detect_water_damage(self, estimate: BathroomEstimate):
        """Auto-set water_damage flag from claim data if not manually set.

        If the estimate is linked to a claim that has water/mold category
        or loss type, auto-enable water_damage and related flags.
        """
        if estimate.water_damage:
            return  # Already explicitly set

        if not estimate.claim_ref:
            return

        claim = estimate.claim_ref
        # Check claim type/category for water-related keywords
        water_keywords = {
            "water", "flood", "leak", "pipe", "burst",
            "overflow", "moisture", "mold", "mildew",
        }
        claim_text = " ".join(filter(None, [
            getattr(claim, "loss_type", None),
            getattr(claim, "category", None),
            getattr(claim, "description", None),
        ])).lower()

        if any(kw in claim_text for kw in water_keywords):
            estimate.water_damage = True
            logger.info(
                f"Auto-detected water damage for estimate "
                f"{estimate.id} from claim {claim.id}"
            )

    # ── Helpers ──

    def _get_full_estimate(self, estimate_id: str) -> Optional[Dict[str, Any]]:
        """Get estimate dict with line_items and claim info."""
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None

        result = self.estimate_repo._convert_to_dict(estimate)
        result["line_items"] = [
            self.line_item_repo._convert_to_dict(li) for li in estimate.line_items
        ]
        self._enrich_claim_info(estimate, result)
        self._enrich_company_info(estimate, result)
        return result

    def _enrich_claim_info(
        self, estimate: BathroomEstimate, result: Dict[str, Any],
    ):
        """Add claim_number and client_name."""
        if estimate.claim_ref:
            result["claim_number"] = estimate.claim_ref.claim_number
            if estimate.claim_ref.client:
                result["client_name"] = estimate.claim_ref.client.display_name
            else:
                result["client_name"] = None
        else:
            result["claim_number"] = None
            result["client_name"] = None

    def _enrich_company_info(
        self, estimate: BathroomEstimate, result: Dict[str, Any],
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
