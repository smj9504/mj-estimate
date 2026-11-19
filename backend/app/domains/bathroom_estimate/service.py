"""
Bathroom Estimate service layer
"""

import copy
import logging
import string
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import selectinload

from app.core.interfaces import DatabaseSession
from app.domains.unit_prices.service import UnitPriceService
from app.domains.unit_prices.tables import use_prices

from .calculator import calculate_estimate
from .job_share import JobShare, bathroom_name, is_job_line
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

# Facts about the house rather than one bathroom: every bathroom of a job
# (job_share) shares them, so changing one bathroom's changes them all.
JOB_SHARED_FIELDS = (
    "claim_id", "company_id", "property_address", "city", "state",
    "zip_code", "building_type", "year_built",
)


def _same_value(a: Any, b: Any) -> bool:
    """A form sends every field each save: only a real change counts"""
    return str(a if a is not None else "").strip() == str(b if b is not None else "").strip()


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

# The price catalog bathroom estimates are priced from (unit_prices)
PRICE_DOMAIN = "bathroom"


def _group_key(estimate: BathroomEstimate) -> str:
    return str(estimate.group_id or estimate.id)


def _alone(estimate: BathroomEstimate) -> bool:
    """Priced on its own: not one of its job's bathrooms (a copy, a second
    try at the same bathroom), as the estimator said"""
    return bool((estimate.hidden_costs or {}).get("price_alone"))


def _line_sig(description, quantity, unit_price, total, notes) -> tuple:
    return (description, round(float(quantity or 0), 2), round(float(unit_price or 0), 2),
            round(float(total or 0), 2), notes or None)

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
        scope: Any = None,
    ) -> tuple:
        """List estimates with filters.

        grouped: one row per bathroom job (its first estimate), each with
        the summaries of all its estimates.
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
        # The house's facts that change: the job's other bathrooms take them too
        job_moved = {k: update_dict[k] for k in JOB_SHARED_FIELDS
                     if k in update_dict and not _same_value(getattr(estimate, k), update_dict[k])}
        other_bathrooms = self._other_bathrooms(estimate) if job_moved and not _alone(estimate) else []
        company_moved = (
            "company_id" in update_dict
            and str(update_dict["company_id"] or "") != str(estimate.company_id or "")
        )
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
            for other in other_bathrooms:
                changed = {k: v for k, v in job_moved.items() if not _same_value(getattr(other, k), v)}
                if changed:
                    self.estimate_repo.update(str(other.id), changed)
                    if "company_id" in changed:
                        other.price_book_id = None
            if company_moved:
                # Its prices were the old company's: the next calculation
                # pins the job to the new company's
                for member in self._group_members(estimate):
                    member.price_book_id = None

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
        job_of = (estimate.claim_id, estimate.property_address, estimate.company_id)
        if whole_group:
            for member in members:
                self.estimate_repo.delete(str(member.id))
            self.session.flush()
            # Another bathroom of the job may carry the job costs now
            self._sync_job(*job_of)
            return True
        if estimate.kind == "restore" and len(members) > 1:
            raise ValueError(
                "This restoration still has upgrade options. Delete the "
                "options first, or delete the whole job from the estimate list."
            )
        self.estimate_repo.delete(estimate_id)
        _renumber([m for m in members if str(m.id) != str(estimate_id)])
        self.session.flush()
        self._sync_job(*job_of)
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
        # Priced with the prices it was first priced with (a price book),
        # pinned now if this is the first time
        book = UnitPriceService(self.session).book_for(
            PRICE_DOMAIN, estimate, self._group_members(estimate),
        )
        # One of several bathrooms on the job: whole-job costs on one of them
        alone = _alone(estimate)
        groups = [] if alone else self._job_groups(
            self._job_estimates(estimate), include_group=_group_key(estimate),
        )
        job = self._job_share(estimate, groups, {})
        with use_prices(book.prices):
            result = calculate_estimate(estimate, layout_changes=changes, job=job)

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
            "price_book_id": str(book.id),
        })

        self.session.flush()
        # The job's other bathrooms: their share of the job costs may have moved
        updated = self._sync_job(
            estimate.claim_id, estimate.property_address, estimate.company_id,
            include_group=None if alone else _group_key(estimate), skip_group=_group_key(estimate),
            changed_by_id=changed_by_id,
        )
        full = self._get_full_estimate(estimate_id)
        if full is not None:
            full["job_updated"] = updated
        return full

    def use_current_prices(
        self, estimate_id: str, changed_by_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Move a whole job onto today's prices (the defaults with its
        company's figures) and reprice every estimate of it that was priced."""
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None
        members = self._group_members(estimate)
        UnitPriceService(self.session).repin_group(PRICE_DOMAIN, members, estimate.company_id)
        for member in members:
            if member.kind == "existing" or not member.line_items:
                continue
            self.calculate(str(member.id), save_history=True, changed_by_id=changed_by_id)
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
            # A new job is priced at today's prices when it is calculated
            "price_book_id": None,
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

    # ── A job of several bathrooms (job_share) ──

    def _job_estimates(self, estimate_or_claim, address: Optional[str] = None,
                       company_id: Any = None) -> List[BathroomEstimate]:
        """Every priced-or-not bathroom estimate of a job: on the claim, or
        with no claim at the same address for the same company. Read fresh:
        lines replaced in this session must show. The current layout isn't
        priced, so it isn't one."""
        if isinstance(estimate_or_claim, BathroomEstimate):
            est = estimate_or_claim
            claim_id, address, company_id = est.claim_id, est.property_address, est.company_id
        else:
            claim_id = estimate_or_claim
        # (pending changes first: the read below replaces what's loaded)
        self.session.flush()
        query = (
            self.session.query(BathroomEstimate)
            .options(selectinload(BathroomEstimate.line_items))
            .filter(BathroomEstimate.kind != "existing")
        )
        if claim_id:
            query = query.filter(BathroomEstimate.claim_id == claim_id)
        else:
            street = " ".join((address or "").split()).lower()
            if not street:
                return []
            query = query.filter(
                BathroomEstimate.claim_id.is_(None),
                func.lower(func.trim(BathroomEstimate.property_address)) == street,
                (BathroomEstimate.company_id == company_id) if company_id
                else BathroomEstimate.company_id.is_(None),
            )
        return query.populate_existing().all()

    @staticmethod
    def _job_groups(estimates: List[BathroomEstimate],
                    include_group: Optional[str] = None) -> List[List[BathroomEstimate]]:
        """The job's bathrooms (estimate groups) that have been priced, plus
        include_group (one being priced now), the first made first"""
        groups: Dict[str, List[BathroomEstimate]] = {}
        for est in estimates:
            groups.setdefault(_group_key(est), []).append(est)
        kept = [g for key, g in groups.items()
                if key == include_group
                or (any(m.line_items for m in g) and not _alone(BathroomEstimateService._job_rep(g)))]
        kept.sort(key=lambda g: (min(m.created_at or datetime.min for m in g), _group_key(g[0])))
        return kept

    @staticmethod
    def _group_names(groups: List[List[BathroomEstimate]]) -> Dict[str, str]:
        """Each bathroom's name by its designation; a second of the same name numbered"""
        names: Dict[str, str] = {}
        seen: Dict[str, int] = {}
        for group in groups:
            rep = BathroomEstimateService._job_rep(group)
            base = bathroom_name(rep.designation)
            seen[base] = seen.get(base, 0) + 1
            names[_group_key(group[0])] = base if seen[base] == 1 else f"{base} {seen[base]}"
        return names

    @staticmethod
    def _job_rep(group: List[BathroomEstimate]) -> BathroomEstimate:
        """What a bathroom brings to the job: its restoration, else its first option"""
        restore = next((m for m in group if m.kind == "restore"), None)
        return restore or min(group, key=lambda m: (m.option_order or 0, m.created_at or datetime.min))

    def _job_inputs(self, estimate: BathroomEstimate) -> Dict[str, Any]:
        baseline = self._layout_baseline(estimate)
        changes = (
            layout_changes(baseline.sketch_data, estimate.sketch_data)
            if baseline is not None else None
        )
        return calculate_estimate(estimate, layout_changes=changes)["job_inputs"]

    def _job_share(self, estimate: BathroomEstimate, groups: List[List[BathroomEstimate]],
                   inputs: Dict[str, Dict[str, Any]],
                   names: Optional[Dict[str, str]] = None) -> Optional[JobShare]:
        """The estimate's place among the job's bathrooms; None with one. The
        first bathroom made carries the job costs. inputs caches each other
        bathroom's debris and flags by its group; names, each bathroom's
        name by its group (else named among `groups`)."""
        if len(groups) < 2 or _alone(estimate):
            return None
        own = _group_key(estimate)
        names = names or self._group_names(groups)
        others = []
        for group in groups:
            key = _group_key(group[0])
            if key == own:
                continue
            if key not in inputs:
                inputs[key] = self._job_inputs(self._job_rep(group))
            others.append({"name": names[key], **inputs[key]})
        carrier = _group_key(groups[0][0])
        return JobShare(carries=carrier == own, carrier_name=names[carrier],
                        bathrooms=len(groups), others=others)

    def _sync_job(self, claim_id: Any, address: Optional[str], company_id: Any,
                  include_group: Optional[str] = None, skip_group: Optional[str] = None,
                  changed_by_id: Optional[str] = None) -> List[str]:
        """Bring each priced estimate of the job in step with the job's
        bathrooms: its job lines (dumpster, permit, trip, lead RRP) replaced
        where they moved, its other lines left as they are (they may be
        edited by hand). Returns the names of those changed."""
        groups = self._job_groups(self._job_estimates(claim_id, address, company_id), include_group)
        names = self._group_names(groups)
        inputs: Dict[str, Dict[str, Any]] = {}
        changed: List[str] = []
        for group in groups:
            key = _group_key(group[0])
            if key == skip_group:
                continue
            for member in group:
                if (member.line_items and not _alone(member)
                        and self._replace_job_lines(member, groups, inputs, changed_by_id)):
                    label = names[key]
                    if member.kind == "option" and member.option_label:
                        label = f"{label} · {member.option_label}"
                    changed.append(label)
        if changed:
            self.session.flush()
        return changed

    def _replace_job_lines(self, member: BathroomEstimate, groups: List[List[BathroomEstimate]],
                           inputs: Dict[str, Dict[str, Any]], changed_by_id: Optional[str]) -> bool:
        """Its job lines as the job is now, if they moved; True when they did"""
        fresh = self._fresh_job_lines(member, groups, inputs)
        stored = sorted(member.line_items, key=lambda li: li.display_order or 0)
        old = [li for li in stored if is_job_line(li.description)]
        if ([_line_sig(li.description, li.quantity, li.unit_price, li.total, li.notes) for li in old]
                == [_line_sig(li["description"], li["quantity"], li["unit_price"], li["total"], li.get("notes"))
                    for li in fresh]):
            return False

        self._save_history(str(member.id), changed_by_id, "Job costs moved: the job's bathrooms changed")
        order = self._with_job_lines(stored, fresh)
        for li in old:
            self.session.delete(li)
        for i, li in enumerate(order):
            if isinstance(li, dict):
                self.session.add(BathroomEstimateLineItem(
                    estimate_id=member.id, phase=li["phase"], description=li["description"],
                    quantity=li["quantity"], unit=li["unit"], unit_price=li["unit_price"],
                    total=li["total"], category=li["category"], notes=li.get("notes"),
                    display_order=i,
                ))
            else:
                li.display_order = i
        subtotal = round(sum(float(li["total"] if isinstance(li, dict) else li.total or 0) for li in order), 2)
        member.subtotal = subtotal
        member.total = subtotal
        return True

    def _fresh_job_lines(self, member: BathroomEstimate, groups: List[List[BathroomEstimate]],
                         inputs: Dict[str, Dict[str, Any]],
                         names: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
        """Its job lines (dumpster, permit, trip, lead RRP) as `groups` make
        them: with one bathroom or none, its own, as if it were the only one"""
        job = self._job_share(member, groups, inputs, names)
        baseline = self._layout_baseline(member)
        changes = (
            layout_changes(baseline.sketch_data, member.sketch_data)
            if baseline is not None else None
        )
        book = UnitPriceService(self.session).book_for(
            PRICE_DOMAIN, member, self._group_members(member),
        )
        with use_prices(book.prices):
            result = calculate_estimate(member, layout_changes=changes, job=job)
        return [li for li in result["line_items"] if is_job_line(li["description"])]

    @staticmethod
    def _with_job_lines(stored: List[Any], fresh: List[Dict[str, Any]]) -> List[Any]:
        """The stored lines with their job lines swapped for `fresh`: the
        others stay as they are, in their order (they may be edited by
        hand), and each new job line goes after the last of them in its phase"""
        order: List[Any] = [li for li in stored if not is_job_line(li.description)]
        for item in fresh:
            at = max((i for i, li in enumerate(order)
                      if (li["phase"] if isinstance(li, dict) else li.phase) <= item["phase"]), default=-1)
            order.insert(at + 1, item)
        return order

    # ── A PDF of the job's bathrooms ──

    def pdf_bathrooms(self, estimate_id: str, estimate_ids: List[str]) -> Optional[Dict[str, Any]]:
        """The estimates a PDF of the job's bathrooms shows, one per bathroom,
        the first made first: {"estimates": each a full estimate with its
        "bathroom_name", "carrier": the bathroom with the job costs, None
        when nothing is shared}. Each also has its "saved_total", with the job.

        With every bathroom of the job they are as stored, what each page
        shows. With fewer, the job costs (dumpster, permit, trip, lead RRP)
        are priced for those bathrooms only: one bathroom on its own pays its
        own, its dumpster sized for its own debris, as if it were the only
        bathroom (owner, 2026-11-19). Nothing is saved."""
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None
        found = {str(e.id): e for e in self._job_estimates(estimate)}
        # A job with no claim or address is its own bathroom
        for m in self._group_members(estimate):
            if m.kind != "existing":
                found.setdefault(str(m.id), m)
        groups: Dict[str, List[BathroomEstimate]] = {}
        for e in found.values():
            groups.setdefault(_group_key(e), []).append(e)
        ordered = sorted(groups.values(),
                         key=lambda g: (min(m.created_at or datetime.min for m in g), _group_key(g[0])))
        names = self._group_names(ordered)

        picked: Dict[str, BathroomEstimate] = {}
        for eid in dict.fromkeys(str(i) for i in estimate_ids):
            e = found.get(eid)
            if e is None:
                raise ValueError("That estimate isn't one of this job's bathrooms.")
            key = _group_key(e)
            if key in picked:
                raise ValueError(f"Pick one estimate of the {names[key]}.")
            if not e.line_items:
                raise ValueError(f"The {names[key]} isn't calculated yet.")
            picked[key] = e
        if not picked:
            raise ValueError("Pick at least one bathroom.")
        order = [_group_key(g[0]) for g in ordered]
        chosen = sorted(picked.values(), key=lambda e: order.index(_group_key(e)))

        # The bathrooms sharing costs, as the PDF has them (one priced on
        # its own keeps its own costs either way)
        shared = [e for e in chosen if not _alone(self._job_rep(groups[_group_key(e)]))]
        job_keys = [_group_key(g[0]) for g in self._job_groups(list(found.values()))]
        whole = sorted(_group_key(e) for e in shared) == sorted(job_keys)

        out: List[Dict[str, Any]] = []
        if whole:
            for e in chosen:
                full = self._get_full_estimate(str(e.id))
                full["bathroom_name"] = names[_group_key(e)]
                full["saved_total"] = full["total"]
                out.append(full)
            carrier = names[job_keys[0]] if len(job_keys) > 1 else None
            return {"estimates": out, "carrier": carrier}

        sub_groups = [groups[_group_key(e)] for e in shared]
        inputs: Dict[str, Dict[str, Any]] = (
            {_group_key(e): self._job_inputs(e) for e in shared} if len(shared) > 1 else {}
        )
        for e in chosen:
            full = self._get_full_estimate(str(e.id))
            full["bathroom_name"] = names[_group_key(e)]
            # As saved, with the job: what its page shows
            full["saved_total"] = full["total"]
            if e in shared:
                stored = sorted(e.line_items, key=lambda li: li.display_order or 0)
                lines = self._with_job_lines(stored, self._fresh_job_lines(e, sub_groups, inputs, names))
                full["line_items"] = [
                    li if isinstance(li, dict) else self.line_item_repo._convert_to_dict(li)
                    for li in lines
                ]
                total = round(sum(float(li.get("total") or 0) for li in full["line_items"]), 2)
                full["subtotal"] = total
                full["total"] = total
            out.append(full)
        carrier = names[_group_key(shared[0])] if len(shared) > 1 else None
        return {"estimates": out, "carrier": carrier}

    def _other_bathrooms(self, estimate: BathroomEstimate) -> List[BathroomEstimate]:
        """Every estimate of the job's other bathrooms (not those priced on their own)"""
        own = _group_key(estimate)
        groups: Dict[str, List[BathroomEstimate]] = {}
        for est in self._job_estimates(estimate):
            groups.setdefault(_group_key(est), []).append(est)
        return [m for key, g in groups.items() if key != own and not _alone(self._job_rep(g)) for m in g]

    def get_job_bathrooms(self, estimate_id: str) -> Optional[List[Dict[str, Any]]]:
        """The bathrooms of the job the estimate is in, the first made first,
        each with the estimate to open for it (its restoration, else its first
        option). A job is its claim, or with no claim its address and company."""
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None
        own = _group_key(estimate)
        groups: Dict[str, List[BathroomEstimate]] = {}
        for est in self._job_estimates(estimate):
            groups.setdefault(_group_key(est), []).append(est)
        if own not in groups:
            groups[own] = [m for m in self._group_members(estimate) if m.kind != "existing"] or [estimate]
        ordered = sorted(groups.values(),
                         key=lambda g: (min(m.created_at or datetime.min for m in g), _group_key(g[0])))
        names = self._group_names(ordered)
        out = []
        for group in ordered:
            key = _group_key(group[0])
            rep = self._job_rep(group)
            out.append({
                "group_id": key, "name": names[key], "estimate_id": str(rep.id),
                "designation": rep.designation, "total": float(rep.total or 0),
                "calculated": bool(rep.line_items), "alone": _alone(rep), "current": key == own,
                # Its restoration and options, for a PDF to pick from
                "estimates": [
                    {"id": str(m.id), "kind": m.kind, "option_label": m.option_label,
                     "total": float(m.total or 0), "calculated": bool(m.line_items)}
                    for m in sorted(group, key=lambda m: (m.kind != "restore", m.option_order or 0))
                ],
            })
        return out

    def add_bathroom(self, estimate_id: str, designation: Optional[str] = None,
                     created_by_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Another bathroom on the estimate's job: a new estimate of its own
        with the house's facts (claim, company, address…) and the job's kind"""
        source = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not source:
            return None
        if not source.claim_id and not (source.property_address or "").strip():
            raise ValueError(
                "Set the claim or the property address first: that's what puts "
                "the job's bathrooms together."
            )
        facts = {k: getattr(source, k) for k in JOB_SHARED_FIELDS}
        if facts.get("claim_id") is not None:
            facts["claim_id"] = str(facts["claim_id"])
        if facts.get("company_id") is not None:
            facts["company_id"] = str(facts["company_id"])
        return self.create_estimate(
            BathroomEstimateCreate(
                project_type=source.project_type or "insurance",
                designation=designation, **facts,
            ),
            created_by_id=created_by_id,
        )

    def _job_summary(self, estimate: BathroomEstimate) -> Optional[Dict[str, Any]]:
        """The job's bathrooms and which has the job costs, for the page;
        None with one bathroom, or one priced on its own"""
        if estimate.kind == "existing" or _alone(estimate):
            return None
        groups = self._job_groups(self._job_estimates(estimate), include_group=_group_key(estimate))
        if len(groups) < 2:
            return None
        names = self._group_names(groups)
        own, carrier = _group_key(estimate), _group_key(groups[0][0])
        return {
            "bathrooms": [names[_group_key(g[0])] for g in groups],
            "this": names[own], "carrier": names[carrier], "carries": own == carrier,
        }

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
        # This method just re-sums from current line items. The total is
        # never rounded, so no line item is ever changed behind the user.
        subtotal = round(sum(li.total for li in estimate.line_items), 2)
        total = subtotal
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
        result["price_book"] = UnitPriceService(self.session).book_summary(PRICE_DOMAIN, estimate)
        result["job"] = self._job_summary(estimate)
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
