"""
Bathroom Estimate service layer
"""

import copy
import logging
import string
import uuid
from typing import Any, Dict, List, Optional

from app.core.interfaces import DatabaseSession

from .calculator import calculate_estimate
from .layout_changes import layout_changes
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
from .selections import SLOTS, sold_with_top

logger = logging.getLogger(__name__)

# Facts about the job rather than the scope: every estimate of a bathroom
# job shares them, so changing one estimate's changes them all.
GROUP_SHARED_FIELDS = (
    "claim_id", "company_id", "property_address", "city", "state",
    "zip_code", "building_type", "year_built", "designation",
)

# Columns a copy never takes from its source: its identity, its place in a
# job and its bookkeeping. Everything else is the scope and is copied, so a
# column added later is copied without anyone having to list it.
_NOT_COPIED = {
    "id", "created_at", "updated_at", "created_by_id", "status",
    "group_id", "project_type", "kind", "option_label", "option_order",
}


def _next_option_label(members: List[BathroomEstimate]) -> str:
    taken = {m.option_label for m in members}
    for letter in string.ascii_uppercase:
        if f"Option {letter}" not in taken:
            return f"Option {letter}"
    n = len(string.ascii_uppercase) + 1
    while f"Option {n}" in taken:
        n += 1
    return f"Option {n}"


def _renumber(members: List[BathroomEstimate]):
    """The restoration first, then the options in the order they had, and a
    remodel's current layout last (so the job's list row is an option)."""
    ordered = sorted(members, key=lambda m: (m.kind == "existing", m.kind != "restore", m.option_order))
    for i, m in enumerate(ordered):
        m.option_order = i

# What an existing (current-layout) member is called
CURRENT_LAYOUT_LABEL = "Current layout"


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
        """Create a new bathroom estimate, the first of its own job.

        An insurance job starts with its restoration, a remodel job with
        Option A.
        """
        estimate_data = data.dict()
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
    ) -> tuple:
        """List estimates with filters.

        grouped: one row per bathroom job (its first estimate), each with
        the summaries of all its estimates.
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
            item["line_items"] = [
                self.line_item_repo._convert_to_dict(li) for li in est.line_items
            ]
            item["group_members"] = members_by_group.get(str(est.group_id or est.id), [])
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

            self._share_with_group(estimate, update_dict)

        self.session.flush()
        if skip_full_read:
            return {"id": estimate_id}
        return self._get_full_estimate(estimate_id)

    def _share_with_group(self, estimate: BathroomEstimate, update_dict: Dict[str, Any]):
        """Carry job facts (address, claim, company…) to the job's other estimates."""
        shared = {k: update_dict[k] for k in GROUP_SHARED_FIELDS if k in update_dict}
        if not shared:
            return
        for member in self._group_members(estimate):
            if str(member.id) == str(estimate.id):
                continue
            changed = {k: v for k, v in shared.items() if getattr(member, k) != v}
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
        self, estimate_id: str, save_history: bool = True,
        changed_by_id: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Run calculation on the estimate and save results."""
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None
        if estimate.kind == "existing":
            raise ValueError(
                "The current layout is the bathroom as it is today; it isn't "
                "priced. Calculate its options instead."
            )

        # Save history before updating
        if save_history:
            self._save_history(estimate_id, changed_by_id, "Calculation executed")

        # Auto-detect water damage from claim if not explicitly set
        self._auto_detect_water_damage(estimate)

        baseline = self._layout_baseline(estimate)
        changes = (
            layout_changes(baseline.sketch_data, estimate.sketch_data)
            if baseline is not None else None
        )
        result = calculate_estimate(estimate, layout_changes=changes)

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
        """Clone an existing estimate into a new draft, the first of a new job."""
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
            # A clone that starts an insurance job is its restoration: no products
            "selections": copy.deepcopy(source.selections) if remodel else None,
        })

        # Recalculate totals for cloned estimate
        self._recalc_estimate_totals(new_id)
        return self._get_full_estimate(new_id)

    def _copy_estimate(self, source: BathroomEstimate, fields: Dict[str, Any]) -> str:
        """A new estimate with source's whole scope and line items, plus `fields`."""
        new_data = {
            col.name: copy.deepcopy(getattr(source, col.name))
            for col in BathroomEstimate.__table__.columns
            if col.name not in _NOT_COPIED
        }
        new_data.update(fields)
        new_id = new_data.setdefault("id", str(uuid.uuid4()))

        self.estimate_repo.create(new_data)
        self.session.flush()

        for li in source.line_items:
            self.line_item_repo.create({
                "estimate_id": new_id,
                "phase": li.phase,
                "description": li.description,
                "quantity": li.quantity,
                "unit": li.unit,
                "unit_price": li.unit_price,
                "total": li.total,
                "category": li.category,
                "notes": li.notes,
                "display_order": li.display_order,
            })
        self.session.flush()
        return new_id

    # ── Estimate group ──

    def _group_members(self, estimate: BathroomEstimate) -> List[BathroomEstimate]:
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
        insurance, the estimate this is asked from becomes the restoration.
        """
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None
        members = self._group_members(estimate)
        if project_type == "remodel":
            for member in members:
                if member.kind == "restore":
                    member.kind = "option"
                    member.option_label = _next_option_label(members)
        elif not any(m.kind == "restore" for m in members):
            # The bathroom as it is today is what a restoration puts back;
            # without one drawn, the estimate this is asked from becomes it
            current = next((m for m in members if m.kind == "existing"), None)
            restore = current or estimate
            restore.kind = "restore"
            restore.option_label = None
            # Priced from the rate tables, never from products
            restore.selections = None
        for member in members:
            member.project_type = project_type
        _renumber(members)
        self.session.flush()
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

    def _layout_baseline(self, estimate: BathroomEstimate) -> Optional[BathroomEstimate]:
        """The bathroom as it is, for an option to price its layout changes
        against: the restoration of an insurance job, the current layout of a
        remodel. None for anything but an option, or a remodel without one."""
        if estimate.kind != "option":
            return None
        members = self._group_members(estimate)
        for kind in ("restore", "existing"):
            found = next((m for m in members if m.kind == kind and str(m.id) != str(estimate.id)), None)
            if found is not None:
                return found
        return None

    def get_layout_changes(self, estimate_id: str) -> Optional[Dict[str, Any]]:
        """How this option's saved sketch differs from its baseline's, and which changes are left out."""
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None
        baseline = self._layout_baseline(estimate)
        if baseline is None:
            return {"baseline": None, "changes": [], "skips": []}
        return {
            "baseline": {
                "id": str(baseline.id),
                "kind": baseline.kind,
                "name": "Restoration" if baseline.kind == "restore" else CURRENT_LAYOUT_LABEL,
            },
            "changes": [c.to_dict() for c in layout_changes(baseline.sketch_data, estimate.sketch_data)],
            "skips": list((estimate.plumbing_spec or {}).get("layout_change_skips") or []),
        }

    def add_current_layout(
        self, estimate_id: str, created_by_id: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """A remodel's bathroom as it is today, unpriced, for its options to
        price moved plumbing and walls against. It starts as a copy of this
        estimate, to be drawn back to how the room is now."""
        source = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not source:
            return None
        if source.project_type != "remodel":
            raise ValueError("An insurance job's restoration is already the bathroom as it is.")
        members = self._group_members(source)
        if any(m.kind == "existing" for m in members):
            raise ValueError("This job already has its current layout.")
        new_id = self._copy_estimate(source, {
            "group_id": str(source.group_id or source.id),
            "project_type": "remodel",
            "kind": "existing",
            "option_label": CURRENT_LAYOUT_LABEL,
            "option_order": max((m.option_order for m in members), default=0) + 1,
            "created_by_id": created_by_id,
            "status": "draft",
            "target_total": None,
            # The bathroom as it is has none of the option's new products
            "selections": None,
        })
        # It isn't priced: no line items, no totals
        self.line_item_repo.delete_by_estimate_id(new_id)
        self.estimate_repo.update(new_id, {
            "subtotal": 0, "overhead_amount": 0, "profit_amount": 0, "tax_amount": 0, "total": 0,
            "adjustment_factor": None, "methodology_notes": None, "warning_flags": [],
        })
        self.session.flush()
        return self._get_full_estimate(new_id)

    # ── Selections: the products an option is built from ──

    def set_selection(
        self, estimate_id: str, slot: str, product_id, includes_top: Optional[bool] = None
    ) -> Optional[Dict[str, Any]]:
        """Pick a library product for one of an option's slots. The estimate
        keeps a copy of it, so changing the library later doesn't move it."""
        from app.domains.product_library.service import ProductService, snapshot

        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None
        if estimate.kind != "option":
            raise ValueError(
                "Only an option is built from products; the restoration stays "
                "priced from the rate tables."
            )
        if slot not in SLOTS:
            raise ValueError(f"Unknown product slot {slot!r}")
        product = ProductService(self.session).get(product_id)
        if product.category not in SLOTS[slot]["categories"]:
            raise ValueError(f"That product isn't a {SLOTS[slot]['label'].lower()}.")
        entry = snapshot(product).model_dump(mode="json")
        if slot == "vanity":
            entry["includes_top"] = sold_with_top(product.title) if includes_top is None else includes_top
        self._write_selections(estimate, {**(estimate.selections or {}), slot: entry})
        return self._get_full_estimate(estimate_id)

    def clear_selection(self, estimate_id: str, slot: str) -> Optional[Dict[str, Any]]:
        """Take a slot's product off an option; it goes back to the rate table's allowance."""
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None
        remaining = {k: v for k, v in (estimate.selections or {}).items() if k != slot}
        self._write_selections(estimate, remaining or None)
        return self._get_full_estimate(estimate_id)

    def product_pictures(self, estimates: List[Dict[str, Any]], max_bytes: int = 4 * 1024 * 1024) -> Dict[str, bytes]:
        """The main picture of each product the options among `estimates`
        picked, by file id, for their PDFs. One that can't be had is left
        out; the PDF goes without it."""
        from pathlib import Path

        from app.common.utils.storage_helpers import download_from_storage, is_cloud_ref
        from app.domains.file.models import File

        wanted = {
            sel["image_file_ids"][0]
            for e in estimates if e.get("kind") == "option"
            for sel in (e.get("selections") or {}).values()
            if isinstance(sel, dict) and sel.get("image_file_ids")
        }
        pictures: Dict[str, bytes] = {}
        for file_id in wanted:
            record = self.session.query(File).filter(File.id == str(file_id)).first()
            if not record or record.is_active is False:
                continue
            # The thumbnail first: it's plenty for a PDF and much smaller
            for ref in (record.thumbnail_url, record.url):
                if not ref:
                    continue
                try:
                    cloud = (record.storage_provider or "local") != "local" or is_cloud_ref(ref)
                    data = (
                        download_from_storage(ref, record.storage_provider, max_bytes=max_bytes) if cloud
                        else Path(ref).read_bytes() if Path(ref).is_file() else None
                    )
                except Exception as e:  # noqa: BLE001
                    logger.warning(f"Product picture {file_id} not available for the PDF: {e}")
                    data = None
                if data:
                    pictures[str(file_id)] = data
                    break
        return pictures

    def _write_selections(self, estimate: BathroomEstimate, selections: Optional[Dict[str, Any]]):
        from sqlalchemy.orm.attributes import flag_modified

        estimate.selections = selections
        flag_modified(estimate, "selections")
        self.session.flush()

    def ensure_submittable_to_carrier(self, estimate_id: str):
        """Only a restoration goes to the insurance company.

        Options are what the customer pays for on top; sending one to the
        carrier would put the upgrade on the claim.
        """
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if estimate and estimate.kind == "existing":
            raise ValueError("The current layout isn't priced. Only the restoration estimate can go to the insurance company.")
        if estimate and estimate.kind != "restore":
            raise ValueError(
                f"{estimate.option_label or 'This option'} is an upgrade option. "
                "Only the restoration estimate can go to the insurance company."
            )

    # ── Line Item CRUD ──

    def update_line_item(
        self, estimate_id: str, item_id: str, data: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Update a single line item and recalculate totals."""
        item = self.line_item_repo.get_by_id(item_id)
        if not item:
            return None

        def current(field):
            return item.get(field) if isinstance(item, dict) else getattr(item, field, None)

        if str(current('estimate_id') or '') != estimate_id:
            return None

        # Auto-calculate total if qty or rate changed
        update = {k: v for k, v in data.items() if v is not None}
        qty = update.get('quantity', current('quantity'))
        rate = update.get('unit_price', current('unit_price'))
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
        if not item:
            return None
        item_est_id = item.get('estimate_id', '') if isinstance(item, dict) else getattr(item, 'estimate_id', '')
        if str(item_est_id) != estimate_id:
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

        # O&P is already absorbed into line item pricing by the calculator.
        # This method just re-sums from current line items.
        subtotal = sum(li.total for li in estimate.line_items)

        total = round(subtotal / 10) * 10
        # Absorb rounding difference into largest line item
        _diff = round(total - subtotal, 2)
        if _diff != 0 and estimate.line_items:
            _lg = max(estimate.line_items, key=lambda x: x.total)
            _lg.total = round(_lg.total + _diff, 2)
            if _lg.quantity:
                _lg.unit_price = round(_lg.total / _lg.quantity, 2)
            subtotal = sum(li.total for li in estimate.line_items)
            total = round(subtotal, 2)
        self.estimate_repo.update(estimate_id, {
            "subtotal": subtotal,
            "overhead_amount": 0,
            "profit_amount": 0,
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
        self, estimate: BathroomEstimate, result: Dict[str, Any],
    ):
        """Add claim_number, client_name, and client_id."""
        if estimate.claim_ref:
            result["claim_number"] = estimate.claim_ref.claim_number
            if estimate.claim_ref.client:
                result["client_name"] = estimate.claim_ref.client.display_name
                result["client_id"] = str(estimate.claim_ref.client.id)
            else:
                result["client_name"] = None
                result["client_id"] = None
        else:
            result["claim_number"] = None
            result["client_name"] = None
            result["client_id"] = None

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
