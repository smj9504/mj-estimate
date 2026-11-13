"""
Flooring estimate service layer
"""

import copy
import logging
import uuid
from typing import Any, Dict, List, Optional

from sqlalchemy.orm.attributes import flag_modified

from app.core.interfaces import DatabaseSession
from app.domains.unit_prices import catalog as price_catalog
from app.domains.unit_prices.service import UnitPriceService
from app.domains.unit_prices.tables import use_prices

from . import pricing
from .calculator import PRICE_DOMAIN, build_takeoff, calculate_estimate, price_of, takeoff_info
from .geometry import APPLIANCE_TYPES, FIXTURE_TYPES, OPENING_KINDS
from .items import BASES, CATEGORY_ORDER, MAIN_LABELS, catalog_info
from .models import FlooringEstimate
from .repository import FlooringEstimateRepository, FlooringHistoryRepository, FlooringLineItemRepository
from .schemas import FlooringEstimateCreate, FlooringEstimateUpdate, FlooringSketch

logger = logging.getLogger(__name__)

_JSON_FIELDS = ("sketch_data", "room_scopes", "job_scope", "calculated_rooms", "warning_flags")

# Columns a copy never takes from its source: its identity, its place in a
# job and its bookkeeping. Everything else is the scope and is copied.
_NOT_COPIED = {
    "id", "created_at", "updated_at", "created_by_id", "status",
    "group_id", "project_type", "kind", "option_label", "option_order", "price_book_id",
}


def _scopes(data: Any) -> Any:
    """Validated scope models as stored: what wasn't chosen is left out, so it follows the default."""
    if data is None:
        return None
    if isinstance(data, dict):
        return {key: value.model_dump(exclude_none=True) for key, value in data.items()}
    return data.model_dump(exclude_none=True)


def pricing_info() -> Dict[str, Any]:
    """The floors, patterns and items an estimate can use, at the active prices."""
    items = catalog_info()
    for row in items["room_items"] + items["general_items"]:
        row["unit_price"] = round(price_of(str(row["price_key"])), 2)
    return {
        "materials": [
            {
                "key": key, "label": spec["label"], "short": spec["short"], "unit": spec["unit"],
                "material_price": float(pricing.FLOORING_MATERIAL[key]),
                "install_labor": float(pricing.FLOORING_INSTALL_LABOR[key]),
                "patterned": key in pricing.PATTERNED,
                "waste_pct": dict(pricing.WASTE_PCT.get(key, {})),
                "box_coverage_sf": pricing.BOX_COVERAGE_SF.get(key),
                "removal_label": pricing.REMOVAL_LABELS[key],
                "removal_price": float(pricing.REMOVAL_RATES[key]),
            }
            for key, spec in pricing.MATERIALS.items()
        ],
        "finishes": [
            {"key": key, "label": label, "includes": includes, "price": float(pricing.REFINISH_RATES[key])}
            for key, (label, includes) in pricing.REFINISH_FINISHES.items()
        ],
        "patterns": [
            {"key": key, "label": label, "labor_multiplier": pricing.PATTERN_LABOR_MULTIPLIER[key]}
            for key, label in pricing.PATTERNS.items()
        ],
        "pad_price": float(pricing.PAD_PRICES["rebond_7_16"]),
        "main_items": [{"key": key, "label": label} for key, label in MAIN_LABELS.items()],
        "room_items": items["room_items"],
        "general_items": items["general_items"],
        "bases": dict(BASES),
        "categories": list(CATEGORY_ORDER),
        "opening_kinds": sorted(OPENING_KINDS),
        "fixture_types": sorted(FIXTURE_TYPES),
        "appliance_types": sorted(APPLIANCE_TYPES),
        "carpet_roll_width_ft": pricing.CARPET_ROLL_WIDTH_FT,
        # Every flooring price, for a custom line priced from the list
        "price_list": [
            {"key": item.key, "label": item.label, "group": item.group, "unit": item.unit,
             "unit_price": round(price_of(item.key), 2)}
            for item in price_catalog.get_domain(PRICE_DOMAIN).items()
        ],
    }


class FlooringEstimateService:
    def __init__(self, session: DatabaseSession):
        self.session = session
        self.estimate_repo = FlooringEstimateRepository(session)
        self.line_item_repo = FlooringLineItemRepository(session)
        self.history_repo = FlooringHistoryRepository(session)

    # ── CRUD ──

    def create_estimate(self, data: FlooringEstimateCreate, created_by_id: Optional[str] = None) -> Dict[str, Any]:
        """A new estimate, the first of its own job: an insurance job starts
        with its restoration, a remodel with Option A."""
        values = data.model_dump(exclude={"room_scopes", "job_scope", "sketch_data"})
        estimate_id = str(uuid.uuid4())
        remodel = data.project_type == "remodel"
        values.update({
            "id": estimate_id,
            "group_id": estimate_id,
            "kind": "option" if remodel else "restore",
            "option_label": "Option A" if remodel else None,
            "option_order": 0,
            "created_by_id": created_by_id,
            "status": "draft",
            "sketch_data": data.sketch_data.model_dump() if data.sketch_data else None,
            "room_scopes": _scopes(data.room_scopes),
            "job_scope": _scopes(data.job_scope),
        })
        self.estimate_repo.create(values)
        self.session.flush()
        return self._get_full_estimate(estimate_id)

    def get_estimate(self, estimate_id: str) -> Optional[Dict[str, Any]]:
        return self._get_full_estimate(estimate_id)

    def list_estimates(
        self, claim_id: Optional[str] = None, company_id: Optional[str] = None,
        status: Optional[str] = None, search: Optional[str] = None,
        page: int = 1, page_size: int = 50, scope: Any = None,
    ) -> tuple:
        estimates, total = self.estimate_repo.find_by_filters(
            claim_id=claim_id, company_id=company_id, status=status, search=search,
            page=page, page_size=page_size, scope=scope,
        )
        items = []
        for est in estimates:
            item = self.estimate_repo._convert_to_dict(est)
            item["line_items"] = []
            self._enrich_claim_info(est, item)
            items.append(item)
        return items, total

    def update_estimate(
        self, estimate_id: str, data: FlooringEstimateUpdate, skip_full_read: bool = False,
    ) -> Optional[Dict[str, Any]]:
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None
        changes = data.model_dump(exclude_unset=True, exclude={"room_scopes", "job_scope"})
        if "room_scopes" in data.model_fields_set:
            changes["room_scopes"] = _scopes(data.room_scopes)
        if "job_scope" in data.model_fields_set:
            changes["job_scope"] = _scopes(data.job_scope)
        company_moved = (
            "company_id" in changes
            and str(changes["company_id"] or "") != str(estimate.company_id or "")
        )
        if changes:
            self.estimate_repo.update(estimate_id, changes)
            self._flag_json(estimate, changes)
            if company_moved:
                # Priced with the old company's prices: the next calculation
                # pins the new company's
                for member in self._group_members(estimate):
                    member.price_book_id = None
        self.session.flush()
        if skip_full_read:
            return {"id": estimate_id}
        return self._get_full_estimate(estimate_id)

    def save_sketch(self, estimate_id: str, sketch: FlooringSketch) -> Optional[Dict[str, Any]]:
        """Save the drawing on its own (the editor saves as it is drawn)."""
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None
        estimate.sketch_data = sketch.model_dump()
        flag_modified(estimate, "sketch_data")
        self.session.flush()
        return self._get_full_estimate(estimate_id)

    def delete_estimate(self, estimate_id: str) -> bool:
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return False
        self.estimate_repo.delete(estimate_id)
        self.session.flush()
        return True

    # ── Calculation ──

    def calculate(
        self, estimate_id: str, save_history: bool = True, changed_by_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Rebuild the line items from the sketch and the scope, at the
        prices the estimate is pinned to (pinned now if this is the first time)."""
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None
        if save_history:
            self._save_history(estimate_id, changed_by_id, "Calculation executed")

        book = UnitPriceService(self.session).book_for(PRICE_DOMAIN, estimate, self._group_members(estimate))
        with use_prices(book.prices):
            result = calculate_estimate(estimate)

        self.line_item_repo.delete_by_estimate_id(estimate_id)
        for i, li in enumerate(result["line_items"]):
            self.line_item_repo.create({**li, "estimate_id": estimate_id, "display_order": i})

        self.estimate_repo.update(estimate_id, {
            "subtotal": result["subtotal"],
            "overhead_amount": result["overhead_amount"],
            "profit_amount": result["profit_amount"],
            "tax_amount": result["tax_amount"],
            "total": result["total"],
            "calculated_rooms": result["rooms"],
            "methodology_notes": result["methodology_notes"],
            "warning_flags": result["warning_flags"],
            "status": "calculated",
            "price_book_id": str(book.id),
        })
        self._flag_json(estimate, {"calculated_rooms": True, "warning_flags": True})
        self.session.flush()
        return self._get_full_estimate(estimate_id)

    def use_current_prices(self, estimate_id: str, changed_by_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Move the job onto today's prices (the defaults with its company's
        own figures) and reprice what was already priced."""
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None
        members = self._group_members(estimate)
        UnitPriceService(self.session).repin_group(PRICE_DOMAIN, members, estimate.company_id)
        for member in members:
            if member.line_items:
                self.calculate(str(member.id), save_history=True, changed_by_id=changed_by_id)
        self.session.flush()
        return self._get_full_estimate(estimate_id)

    # ── Clone ──

    def clone_estimate(self, estimate_id: str, created_by_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """A copy of the whole estimate as a new draft, the first of a new job,
        priced at today's prices when it is next calculated."""
        source = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not source:
            return None
        new_id = str(uuid.uuid4())
        remodel = source.project_type == "remodel"
        values = {
            col.name: copy.deepcopy(getattr(source, col.name))
            for col in FlooringEstimate.__table__.columns
            if col.name not in _NOT_COPIED
        }
        values.update({
            "id": new_id,
            "group_id": new_id,
            "project_type": source.project_type,
            "kind": "option" if remodel else "restore",
            "option_label": "Option A" if remodel else None,
            "option_order": 0,
            "created_by_id": created_by_id,
            "status": "draft",
            "price_book_id": None,
        })
        self.estimate_repo.create(values)
        self.session.flush()
        for li in source.line_items:
            self.line_item_repo.create({
                "estimate_id": new_id,
                **{
                    col.name: getattr(li, col.name)
                    for col in li.__table__.columns
                    if col.name not in {"id", "estimate_id", "created_at", "updated_at"}
                },
            })
        self.session.flush()
        return self._get_full_estimate(new_id)

    # ── History ──

    def get_history(self, estimate_id: str) -> List[Dict[str, Any]]:
        return [self.history_repo._convert_to_dict(h) for h in self.history_repo.find_by_estimate_id(estimate_id)]

    def _save_history(self, estimate_id: str, changed_by_id: Optional[str], description: str):
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return
        snapshot = self.estimate_repo._convert_to_dict(estimate)
        snapshot["line_items"] = [self.line_item_repo._convert_to_dict(li) for li in estimate.line_items]
        self.history_repo.create({
            "estimate_id": estimate_id,
            "version_number": self.history_repo.get_latest_version(estimate_id) + 1,
            "snapshot_data": snapshot,
            "changed_by_id": changed_by_id,
            "change_description": description,
        })

    # ── Prices ──

    def prices_for(self, estimate: Optional[FlooringEstimate]) -> Optional[Dict[str, Any]]:
        """The prices an estimate is (or would be) priced with; None for the defaults."""
        if estimate is None:
            return None
        return UnitPriceService(self.session).prices_for(PRICE_DOMAIN, estimate)

    # ── Helpers ──

    def _group_members(self, estimate: FlooringEstimate) -> List[FlooringEstimate]:
        return self.estimate_repo.find_group_members(str(estimate.group_id or estimate.id))

    @staticmethod
    def _flag_json(estimate: FlooringEstimate, changes: Dict[str, Any]):
        for name in _JSON_FIELDS:
            if name in changes:
                try:
                    flag_modified(estimate, name)
                except Exception:  # noqa: BLE001 - not loaded on this instance
                    pass

    def _get_full_estimate(self, estimate_id: str) -> Optional[Dict[str, Any]]:
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None
        result = self.estimate_repo._convert_to_dict(estimate)
        result["line_items"] = [self.line_item_repo._convert_to_dict(li) for li in estimate.line_items]
        with use_prices(self.prices_for(estimate)):
            result["takeoff"] = takeoff_info(build_takeoff(estimate))
        self._enrich_claim_info(estimate, result)
        self._enrich_company_info(estimate, result)
        result["price_book"] = UnitPriceService(self.session).book_summary(PRICE_DOMAIN, estimate)
        return result

    @staticmethod
    def _enrich_claim_info(estimate: FlooringEstimate, result: Dict[str, Any]):
        claim = estimate.claim_ref
        result["claim_number"] = claim.claim_number if claim else None
        client = claim.client if claim else None
        result["client_name"] = client.display_name if client else None
        result["client_id"] = str(client.id) if client else None

    def _enrich_company_info(self, estimate: FlooringEstimate, result: Dict[str, Any]):
        result["company_info"] = None
        if not estimate.company_id:
            return
        from app.domains.company.models import Company

        company = self.session.query(Company).filter(Company.id == estimate.company_id).first()
        if company:
            result["company_info"] = {
                "name": company.name, "address": company.address, "city": company.city,
                "state": company.state, "zipcode": company.zipcode, "phone": company.phone,
                "email": company.email, "website": company.website,
                "license_number": company.license_number, "logo": company.logo,
            }
