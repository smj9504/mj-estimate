"""
Cabinet Estimate service layer
"""

import copy
import json
import logging
import string
import uuid
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
from .selections import SLOT_CATEGORY, SLOT_KEYS, clean_selections
from .sketch_models import CabinetSketch

logger = logging.getLogger(__name__)

# Facts about the job rather than the scope: every estimate of a kitchen job
# shares them, so changing one estimate's changes them all.
GROUP_SHARED_FIELDS = ("claim_id", "company_id", "property_address", "zip_code")

# Columns a copy never takes from its source: its identity, its place in a
# job and its bookkeeping. Everything else is the scope and is copied, so a
# column added later is copied without anyone having to list it.
_NOT_COPIED = {
    "id", "created_at", "updated_at", "created_by_id", "status",
    "group_id", "project_type", "kind", "option_label", "option_order",
}


def _next_option_label(members: List[CabinetEstimate]) -> str:
    taken = {m.option_label for m in members}
    for letter in string.ascii_uppercase:
        if f"Option {letter}" not in taken:
            return f"Option {letter}"
    n = len(string.ascii_uppercase) + 1
    while f"Option {n}" in taken:
        n += 1
    return f"Option {n}"


def _renumber(members: List[CabinetEstimate]):
    """The restoration first, then the options in the order they had."""
    ordered = sorted(members, key=lambda m: (m.kind != "restore", m.option_order))
    for i, m in enumerate(ordered):
        m.option_order = i


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
        """Create a new cabinet estimate with boxes, the first of its own job.

        An insurance job starts with its restoration, a remodel job with
        Option A.
        """
        boxes_data = data.boxes
        estimate_data = data.dict(exclude={"boxes"})
        estimate_id = str(uuid.uuid4())
        remodel = estimate_data.get("project_type") == "remodel"
        estimate_data.update({
            "id": estimate_id,
            "group_id": estimate_id,
            "kind": "option" if remodel else "restore",
            "option_label": "Option A" if remodel else None,
            "option_order": 0,
            "created_by_id": created_by_id,
            "status": "draft",
        })

        self.estimate_repo.create(estimate_data)

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
        kind: Optional[str] = None,
        grouped: bool = False,
        page: int = 1,
        page_size: int = 50,
        scope: Any = None,
    ) -> tuple[List[Dict[str, Any]], int]:
        """List estimates with filters.

        grouped: one row per kitchen job (its first estimate), each with the
        summaries of all its estimates.
        scope: the company-scope condition of the staff member listing them.
        """
        estimates, total = self.estimate_repo.find_by_filters(
            claim_id=claim_id,
            company_id=company_id,
            status=status,
            search=search,
            kind=kind,
            grouped=grouped,
            page=page,
            page_size=page_size,
            scope=scope,
        )
        members_by_group: Dict[str, List[Dict[str, Any]]] = {}
        for row in self.estimate_repo.find_member_summaries(
            [str(est.group_id or est.id) for est in estimates]
        ):
            members_by_group.setdefault(str(row.group_id), []).append(
                self._member_summary(row)
            )
        items = []
        for est in estimates:
            item = self.estimate_repo._convert_to_dict(est)
            item["boxes"] = [self.box_repo._convert_to_dict(b) for b in est.boxes]
            item["line_items"] = [self.line_item_repo._convert_to_dict(li) for li in est.line_items]
            item["group_members"] = members_by_group.get(str(est.group_id or est.id), [])
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
            self._share_with_group(estimate, update_dict)

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

    def _share_with_group(self, estimate: CabinetEstimate, update_dict: Dict[str, Any]):
        """Carry job facts (address, claim, company) to the job's other estimates."""
        shared = {k: update_dict[k] for k in GROUP_SHARED_FIELDS if k in update_dict}
        if not shared:
            return
        for member in self._group_members(estimate):
            if str(member.id) == str(estimate.id):
                continue
            changed = {k: v for k, v in shared.items() if str(getattr(member, k) or "") != str(v or "")}
            if changed:
                self.estimate_repo.update(str(member.id), changed)

    def delete_estimate(self, estimate_id: str, whole_group: bool = False) -> bool:
        """Delete an estimate and all related data (cascaded).

        whole_group deletes every estimate of the job. A restoration that
        still has options can't go on its own: the options were priced as
        upgrades on it.
        """
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return False
        members = self._group_members(estimate)
        if whole_group:
            for member in members:
                self.estimate_repo.delete(str(member.id))
            self.session.flush()
            return True
        if estimate.kind == "restore" and len(members) > 1:
            raise ValueError(
                "This restoration still has upgrade options. Delete the "
                "options first, or delete the whole job from the estimate list."
            )
        self.estimate_repo.delete(estimate_id)
        _renumber([m for m in members if str(m.id) != str(estimate_id)])
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
                range_panel_count=getattr(
                    b, 'range_panel_count', None,
                ),
                qty=b.qty,
            )
            for b in estimate.boxes
        ]

        result = calculate_estimate(
            boxes=box_inputs,
            tier=estimate.tier,
            zip_code=estimate.zip_code or "",
            box_material=getattr(estimate, 'box_material', None),
            finish=getattr(estimate, 'finish', None),
            door_style=getattr(estimate, 'door_style', None),
            overlay_style=getattr(estimate, 'overlay_style', None),
            pricing_basis=getattr(estimate, 'pricing_basis', None),
            include_demo=estimate.include_demo,
            include_install=estimate.include_install,
            include_delivery=estimate.include_delivery,
            include_plumbing=estimate.include_plumbing,
            sink_type=getattr(estimate, 'sink_type', 'single') or 'single',
            include_aav=getattr(estimate, 'include_aav', False) or False,
            include_air_gap=getattr(
                estimate, 'include_air_gap', False,
            ) or False,
            include_soap_dispenser=getattr(
                estimate, 'include_soap_dispenser', False,
            ) or False,
            include_instant_hot=getattr(
                estimate, 'include_instant_hot', False,
            ) or False,
            include_dw_hookup=getattr(
                estimate, 'include_dw_hookup', False,
            ) or False,
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
            filler_count=(
                getattr(estimate, 'filler_count', 0) or 0
            ),
            angled_joint_count=(
                getattr(estimate, 'angled_joint_count', 0) or 0
            ),
            countertop_support_count=(
                getattr(estimate, 'countertop_support_count', 0) or 0
            ),
            island_seating_overhang_in=getattr(
                estimate, 'island_seating_overhang_in', None,
            ),
            end_panel_counts=getattr(
                estimate, 'end_panel_counts', None,
            ),
            dishwasher_return_panel_count=(
                getattr(
                    estimate, 'dishwasher_return_panel_count', 0,
                ) or 0
            ),
            include_light_rail=(
                getattr(estimate, 'include_light_rail', False)
                or False
            ),
            light_rail_lf=getattr(
                estimate, 'light_rail_lf', None,
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
            # The restoration is priced from the rate tables alone
            products=(
                clean_selections(estimate.selections)
                if estimate.kind == "option" else None
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
                "material_unit_price": li.material_unit_price,
                "labor_unit_price": li.labor_unit_price,
                "material_total": li.material_total,
                "labor_total": li.labor_total,
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
        """Clone an existing estimate into a new draft, the first of a new job.

        Every input column is copied so a clone recalculates to the same
        numbers; calculate() regenerates the results.
        """
        source = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not source:
            return None
        new_id = str(uuid.uuid4())
        remodel = source.project_type == "remodel"
        self._copy_estimate(source, {
            "id": new_id,
            "group_id": new_id,
            "project_type": source.project_type,
            "kind": "option" if remodel else "restore",
            "option_label": "Option A" if remodel else None,
            "option_order": 0,
            "created_by_id": created_by_id,
            "status": "draft",
            "notes": "Cloned from estimate",
            # A restoration never carries products
            "selections": source.selections if remodel else None,
            "subtotal": 0, "overhead_amount": 0, "profit_amount": 0,
            "adjustment_factor": None, "total": 0,
            "methodology_notes": None, "warning_flags": [],
        }, with_line_items=False)
        return self._get_full_estimate(new_id)

    def _copy_estimate(
        self,
        source: CabinetEstimate,
        fields: Dict[str, Any],
        with_line_items: bool = True,
    ) -> str:
        """A new estimate with source's whole scope, boxes, sketch and (with
        with_line_items) line items, plus `fields`."""
        new_data = {
            col.name: copy.deepcopy(getattr(source, col.name))
            for col in CabinetEstimate.__table__.columns
            if col.name not in _NOT_COPIED
        }
        new_data.update(fields)
        new_id = new_data.setdefault("id", str(uuid.uuid4()))
        self.estimate_repo.create(new_data)
        self.session.flush()

        for i, box in enumerate(source.boxes):
            self.box_repo.create({
                "estimate_id": new_id,
                "code": box.code,
                "cab_type": box.cab_type,
                "location": box.location or "perimeter",
                "width_inches": box.width_inches,
                "height_inches": box.height_inches,
                "is_specialty": box.is_specialty,
                "specialty_type": box.specialty_type,
                "has_glass_door": box.has_glass_door or False,
                "range_panel_count": box.range_panel_count,
                "qty": box.qty,
                "display_order": i,
            })
        if with_line_items:
            for li in source.line_items:
                self.line_item_repo.create({
                    "estimate_id": new_id,
                    "description": li.description,
                    "quantity": li.quantity,
                    "unit": li.unit,
                    "unit_price": li.unit_price,
                    "total": li.total,
                    "material_unit_price": li.material_unit_price,
                    "labor_unit_price": li.labor_unit_price,
                    "material_total": li.material_total,
                    "labor_total": li.labor_total,
                    "category": li.category,
                    "location": li.location,
                    "notes": li.notes,
                    "display_order": li.display_order,
                })

        # The layout drawing comes along: an option is the same kitchen
        sketch = (
            self.session.query(CabinetSketch)
            .filter(CabinetSketch.estimate_id == source.id)
            .first()
        )
        if sketch is not None:
            self.session.add(CabinetSketch(
                estimate_id=UUID(new_id),
                canvas_width=sketch.canvas_width,
                canvas_height=sketch.canvas_height,
                scale_pixels_per_foot=sketch.scale_pixels_per_foot,
                overlay_data=copy.deepcopy(sketch.overlay_data or {}),
            ))
        self.session.flush()
        return new_id

    # ── Estimate group ──

    def _group_members(self, estimate: CabinetEstimate) -> List[CabinetEstimate]:
        return self.estimate_repo.find_group_members(str(estimate.group_id or estimate.id))

    @staticmethod
    def _member_summary(member) -> Dict[str, Any]:
        return {
            "id": str(member.id),
            "kind": member.kind,
            "option_label": member.option_label,
            "option_order": member.option_order,
            "status": member.status,
            "total": member.total or 0,
            "updated_at": member.updated_at,
        }

    def add_option(
        self, estimate_id: str, created_by_id: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """A new option in the same job, starting as a copy of this estimate.

        It doesn't take the source's target total: that pins the total, so a
        recalculated option would come back at the restoration's figure
        whatever was upgraded.
        """
        source = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not source:
            return None
        members = self._group_members(source)
        new_id = self._copy_estimate(source, {
            "group_id": str(source.group_id or source.id),
            "project_type": source.project_type,
            "kind": "option",
            "option_label": _next_option_label(members),
            "option_order": max((m.option_order for m in members), default=0) + 1,
            "created_by_id": created_by_id,
            "status": "calculated" if source.line_items else "draft",
            "target_total": None,
            "adjustment_factor": None,
        })
        return self._get_full_estimate(new_id)

    def rename_option(self, estimate_id: str, label: str) -> Optional[Dict[str, Any]]:
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None
        if estimate.kind != "option":
            raise ValueError("The restoration estimate has no option name.")
        estimate.option_label = label.strip()
        self.session.flush()
        return self._get_full_estimate(estimate_id)

    def set_project_type(self, estimate_id: str, project_type: str) -> Optional[Dict[str, Any]]:
        """Switch the whole job between insurance and remodel.

        To remodel, the restoration becomes an option like the others. To
        insurance, the estimate this is asked from becomes the restoration,
        and lets go of its products: a restoration is priced from the rate
        tables alone.
        """
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None
        members = self._group_members(estimate)
        reprice = None
        if project_type == "remodel":
            for member in members:
                if member.kind == "restore":
                    member.kind = "option"
                    member.option_label = _next_option_label(members)
        elif not any(m.kind == "restore" for m in members):
            estimate.kind = "restore"
            estimate.option_label = None
            if clean_selections(estimate.selections):
                estimate.selections = None
                reprice = estimate
        for member in members:
            member.project_type = project_type
        _renumber(members)
        self.session.flush()
        if reprice is not None and reprice.status != "draft":
            self._recalculate_quietly(str(reprice.id))
        return self._get_full_estimate(estimate_id)

    def get_group(self, estimate_id: str) -> Optional[Dict[str, Any]]:
        """Every estimate of this one's job, with line items, to compare them."""
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None
        members = [self._get_full_estimate(str(m.id)) for m in self._group_members(estimate)]
        return {
            "group_id": str(estimate.group_id or estimate.id),
            "project_type": estimate.project_type,
            "members": members,
        }

    def ensure_submittable_to_carrier(self, estimate_id: str):
        """Only a restoration goes to the insurance company.

        Options are what the customer pays for on top; sending one to the
        carrier would put the upgrade on the claim.
        """
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if estimate and estimate.kind != "restore":
            raise ValueError(
                f"{estimate.option_label or 'This option'} is an upgrade option. "
                "Only the restoration estimate can go to the insurance company."
            )

    # ── Products (an option's selections) ──

    def set_selection(
        self,
        estimate_id: str,
        slot: str,
        product_id: Optional[str],
        changed_by_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Put a library product in one of an option's slots, or empty it.

        The estimate keeps a copy of the product as it is now. A calculated
        option is repriced at once, so its total follows the choice.
        """
        from app.domains.product_library.service import ProductError, ProductService, snapshot

        if slot not in SLOT_KEYS:
            raise ValueError(f"Unknown product slot: {slot}")
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None
        if estimate.kind != "option":
            raise ValueError(
                "The restoration is priced from the rate tables alone. Add an "
                "upgrade option to choose products."
            )
        selections = dict(clean_selections(estimate.selections))
        if product_id is None:
            selections.pop(slot, None)
        else:
            try:
                product = ProductService(self.session).get(UUID(str(product_id)))
            except ProductError:
                raise LookupError("That product isn't in the library")
            if product.category != SLOT_CATEGORY[slot]:
                raise ValueError(
                    f"That product is a {product.category.replace('_', ' ')}, "
                    f"not a {SLOT_CATEGORY[slot].replace('_', ' ')}."
                )
            selections[slot] = snapshot(product).model_dump(mode="json")
        estimate.selections = selections or None
        self.session.flush()
        if estimate.status != "draft":
            self._recalculate_quietly(estimate_id, changed_by_id, f"Product changed: {slot}")
        return self._get_full_estimate(estimate_id)

    def _recalculate_quietly(
        self, estimate_id: str, changed_by_id: Optional[str] = None,
        description: str = "Recalculated",
    ):
        """Reprice after a change that moves the total; a scope the
        calculator can't price yet (no tier, no boxes) is left as it was."""
        try:
            self.calculate(estimate_id, save_history=True, changed_by_id=changed_by_id)
        except ValueError as e:
            logger.info("Not repricing %s: %s", estimate_id, e)

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
        result["group_members"] = [
            self._member_summary(row)
            for row in self.estimate_repo.find_member_summaries(
                [str(estimate.group_id or estimate.id)]
            )
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
