"""
Roofing Estimate service layer
"""

import logging
from typing import Any, Dict, List, Optional

from app.core.interfaces import DatabaseSession

from .calculator import calculate_estimate
from .dumpster import select_dumpsters
from .eagleview_parser import extract_measurements, parse_eagleview
from .job_cost import calculate_job_cost
from .material_cost import calculate_material_costs
from .material_price_book import (
    build_default_catalog,
    build_material_key,
    drop_stale_snapshot_entries,
    price_entry_dict,
    load_price_book,
    seed_material_prices,
    snapshot_for_estimate,
)
from .models import (
    RoofingEstimate,
    RoofingMaterialPrice,
    RoofingPricingSetting,
)
from .pricing_settings import (
    attach_material_costs,
    build_default_catalog as build_pricing_catalog,
    default_for,
    is_valid_setting,
    load_settings as load_pricing_settings,
    setting_groups as pricing_setting_groups,
    validate_value,
)
from .repository import (
    RoofingEstimateRepository,
    RoofingHistoryRepository,
    RoofingLineItemRepository,
)
from .schemas import RoofingEstimateCreate, RoofingEstimateUpdate

logger = logging.getLogger(__name__)


class RoofingEstimateService:
    def __init__(self, session: DatabaseSession):
        self.session = session
        self.estimate_repo = RoofingEstimateRepository(session)
        self.line_item_repo = RoofingLineItemRepository(session)
        self.history_repo = RoofingHistoryRepository(session)

    # ── CRUD ──

    def create_estimate(
        self, data: RoofingEstimateCreate, created_by_id: Optional[str] = None
    ) -> Dict[str, Any]:
        estimate_data = data.dict()
        estimate_data["created_by_id"] = created_by_id
        estimate_data["status"] = "draft"

        # Auto-compute squares
        if estimate_data.get("total_sf") and not estimate_data.get("squares"):
            estimate_data["squares"] = estimate_data["total_sf"] / 100

        result = self.estimate_repo.create(estimate_data)
        estimate_id = result["id"]
        self.session.flush()
        return self._get_full_estimate(estimate_id)

    def get_estimate(self, estimate_id: str) -> Optional[Dict[str, Any]]:
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
                self.line_item_repo._convert_to_dict(li)
                for li in est.line_items
            ]
            self._enrich_claim_info(est, item)
            items.append(item)
        return items, total

    def update_estimate(
        self,
        estimate_id: str,
        data: RoofingEstimateUpdate,
        updated_by_id: Optional[str] = None,
        skip_full_read: bool = False,
    ) -> Optional[Dict[str, Any]]:
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None

        update_dict = data.dict(exclude_unset=True)

        # Auto-compute squares if total_sf changes
        if "total_sf" in update_dict and "squares" not in update_dict:
            update_dict["squares"] = update_dict["total_sf"] / 100

        if update_dict:
            self.estimate_repo.update(estimate_id, update_dict)

        self.session.flush()
        if skip_full_read:
            return {"id": estimate_id}
        return self._get_full_estimate(estimate_id)

    # ── Internal material cost ──

    def _resolve_price_book(self, estimate) -> Dict[str, Any]:
        """The price book in force for this estimate's company.

        Migration rfg20260917pb03 normally ships the default rows; repair
        the table if that insert was skipped, so a missing seed degrades
        to the module constants rather than an empty breakdown.
        """
        book = load_price_book(self.session, company_id=estimate.company_id)
        if not book:
            seed_material_prices(self.session, company_id=None)
            book = load_price_book(
                self.session, company_id=estimate.company_id,
            )
        return book

    def _material_rows_for(self, estimate) -> Optional[List[Dict[str, Any]]]:
        """Supplier cost rows used to split line items into material/labor.

        Never let a cost-side problem block a calculation: the estimate
        still prices correctly on the pricing.py ratios, which is what it
        did before costs fed into the split at all.
        """
        try:
            book = self._resolve_price_book(estimate)
            return calculate_material_costs(
                estimate, price_book=book,
            )["items"]
        except Exception:
            logger.exception(
                "roofing estimate %s: material cost resolution failed; "
                "falling back to category material portions", estimate.id,
            )
            return None

    def get_material_costs(
        self, estimate_id: str,
    ) -> Optional[Dict[str, Any]]:
        """Internal material cost breakdown. Never shown to customers.

        The first time an estimate is costed, the price book in force is
        frozen onto it, so raising a default price later changes what new
        estimates start from without rewriting this one's profit.
        """
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None

        book = self._resolve_price_book(estimate)
        result = calculate_material_costs(estimate, price_book=book)

        # An estimate costed before the price book moved to purchase
        # units holds per-SQ/SF costs that would now be multiplied by
        # bundle counts. Drop those so they re-resolve, then recost.
        cleaned, dropped = drop_stale_snapshot_entries(
            estimate.material_cost_overrides, result["items"],
        )
        if dropped:
            logger.info(
                "roofing estimate %s: dropped %d stale snapshot costs (%s)",
                estimate_id, len(dropped), ", ".join(sorted(dropped)),
            )
            self.estimate_repo.update(
                estimate_id, {"material_cost_overrides": cleaned or None},
            )
            self.session.flush()
            estimate.material_cost_overrides = cleaned or None
            result = calculate_material_costs(estimate, price_book=book)
            result["stale_costs_reset"] = dropped

        if not estimate.material_cost_overrides and result["items"]:
            snapshot = snapshot_for_estimate(book, result["items"])
            self.estimate_repo.update(
                estimate_id, {"material_cost_overrides": snapshot},
            )
            self.session.flush()
            result["snapshot_taken"] = True

        result["price_book"] = sorted(
            book.values(), key=lambda e: (e["category"], e["label"]),
        )

        # Real profit needs labor and disposal, not just material. The
        # dumpster pick is recomputed rather than stored, so the truck
        # option can be costed against the same debris weight.
        line_items = [
            self.line_item_repo._convert_to_dict(li)
            for li in (estimate.line_items or [])
        ]
        result["job_cost"] = calculate_job_cost(
            estimate,
            material_total_with_tax=result.get("total_with_tax") or 0,
            line_items=line_items,
            dumpster=self._dumpster_for(estimate),
        )
        return result

    def _dumpster_for(self, estimate) -> Optional[Dict[str, Any]]:
        """The container pick for this roof, for the disposal costing.

        Recomputed rather than read back: it is cheap, and it keeps the
        debris weight consistent with whatever the sizing rules say
        today rather than what they said when the estimate was saved.
        """
        try:
            squares = float(estimate.squares or 0)
            waste = float(estimate.waste_factor or 0)
            decking = estimate.decking_spec or {}
            sheets = max(
                0,
                (decking.get("estimated_sheets_needed") or 0)
                - (decking.get("free_sheets_included") or 2),
            ) if decking.get("estimated_sheets_needed") else 0
            hidden = estimate.hidden_costs or {}
            return select_dumpsters(
                squares=squares * (1 + waste) if waste else squares,
                material=estimate.existing_material or "asphalt",
                layers=estimate.layer_count or 1,
                decking_sheets=sheets,
                wet=bool(hidden.get("wet_debris")),
            )
        except Exception:
            logger.exception(
                "roofing estimate %s: dumpster recompute failed",
                getattr(estimate, "id", "?"),
            )
            return None

    def update_material_costs(
        self,
        estimate_id: str,
        overrides: Optional[Dict[str, Any]] = None,
        tax_rate: Optional[float] = None,
    ) -> Optional[Dict[str, Any]]:
        """Save per-estimate cost overrides, then recompute the breakdown.

        Overrides are replaced wholesale rather than merged, so clearing a
        material back to its default is just a matter of omitting it.
        """
        estimate = self.estimate_repo.get_by_id(estimate_id)
        if not estimate:
            return None

        update_dict: Dict[str, Any] = {}
        if overrides is not None:
            update_dict["material_cost_overrides"] = overrides or None
        if tax_rate is not None:
            update_dict["material_tax_rate"] = tax_rate

        if update_dict:
            self.estimate_repo.update(estimate_id, update_dict)
            self.session.flush()

        return self.get_material_costs(estimate_id)

    # ── Default material price book ──

    def list_material_prices(
        self,
        company_id: Optional[str] = None,
        include_inactive: bool = False,
    ) -> List[Dict[str, Any]]:
        """Editable default costs for the price-book screen.

        Migration rfg20260917pb03 inserts the shared defaults. This
        repairs the table if that insert was skipped (the migration
        tolerates the app package being off its path), because the screen
        can only edit rows that exist — an empty table means an empty
        screen with no way to enter anything.
        """
        book = load_price_book(
            self.session, company_id=company_id,
            include_inactive=include_inactive,
        )
        if not book:
            seed_material_prices(self.session, company_id=None)
            book = load_price_book(
                self.session, company_id=company_id,
                include_inactive=include_inactive,
            )
        return sorted(
            book.values(), key=lambda e: (e["category"], e["label"]),
        )

    def create_material_price(
        self,
        data: Dict[str, Any],
        company_id: Optional[str] = None,
        created_by_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Add a material the seed catalog does not cover.

        The key is generated rather than taken from the caller so a
        custom row can never collide with a catalog key that a later
        seed run introduces.
        """
        seed_material_prices(self.session, company_id=None)

        payload = dict(data)
        label = (payload.get("label") or "").strip()
        category = (payload.get("category") or "custom").strip()

        material_key = (payload.pop("material_key", None) or "").strip()
        if not material_key:
            material_key = build_material_key(
                self.session, label, category, company_id=company_id,
            )

        row = RoofingMaterialPrice(
            material_key=material_key,
            label=label,
            category=category,
            unit=(payload.get("unit") or "EA").strip(),
            unit_cost=float(payload.get("unit_cost") or 0),
            is_taxable=bool(payload.get("is_taxable", True)),
            is_active=True,
            is_custom=True,
            notes=payload.get("notes") or None,
            manufacturer=payload.get("manufacturer") or None,
            product_name=payload.get("product_name") or None,
            color=payload.get("color") or None,
            size_spec=payload.get("size_spec") or None,
            supplier=payload.get("supplier") or None,
            sku=payload.get("sku") or None,
            qty_formula=payload.get("qty_formula") or None,
            qty_basis=payload.get("qty_basis") or None,
            coverage_per_unit=payload.get("coverage_per_unit"),
            coverage_unit=payload.get("coverage_unit") or None,
            qty_minimum=payload.get("qty_minimum"),
            company_id=company_id,
            updated_by_id=created_by_id,
        )
        self.session.add(row)
        self.session.flush()
        return price_entry_dict(row)

    def update_material_prices(
        self,
        prices: Dict[str, Dict[str, Any]],
        company_id: Optional[str] = None,
        updated_by_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Change default costs, keyed by material_key.

        Only affects estimates created from here on: existing estimates
        already carry their own snapshot of the costs they were built on.
        """
        seed_material_prices(self.session, company_id=None)
        catalog = {e["material_key"]: e for e in build_default_catalog()}

        for material_key, patch in (prices or {}).items():
            row = (
                self.session.query(RoofingMaterialPrice)
                .filter(
                    RoofingMaterialPrice.material_key == material_key,
                    RoofingMaterialPrice.company_id.is_(None)
                    if not company_id
                    else RoofingMaterialPrice.company_id == company_id,
                )
                .first()
            )
            if not row:
                # No row yet for this key. For a company-scoped edit that
                # is the normal case — the company is diverging from the
                # shared default for the first time. Create it from the
                # catalog rather than dropping the edit on the floor.
                template = catalog.get(material_key)
                if not template:
                    logger.warning(
                        "unknown roofing material_key %r ignored",
                        material_key,
                    )
                    continue
                row = RoofingMaterialPrice(
                    material_key=material_key,
                    label=template["label"],
                    category=template["category"],
                    unit=template["unit"],
                    unit_cost=template["unit_cost"],
                    is_taxable=True,
                    is_active=True,
                    company_id=company_id,
                )
                self.session.add(row)
            if patch.get("unit_cost") is not None:
                row.unit_cost = float(patch["unit_cost"])
            if patch.get("is_taxable") is not None:
                row.is_taxable = bool(patch["is_taxable"])
            if patch.get("is_active") is not None:
                # Retiring a material, not deleting it: estimates priced
                # with it keep resolving.
                row.is_active = bool(patch["is_active"])
            if "notes" in patch:
                row.notes = patch["notes"] or None

            # Descriptive fields. Blank clears rather than being ignored,
            # so a wrong colour or SKU can actually be removed.
            for field in (
                "label", "category", "unit", "manufacturer", "product_name",
                "color", "size_spec", "supplier", "sku", "coverage_unit",
                "qty_basis", "qty_formula",
            ):
                if field in patch:
                    value = patch[field]
                    value = value.strip() if isinstance(value, str) else value
                    if field in ("label", "category", "unit"):
                        # These are required; ignore an attempt to blank.
                        if value:
                            setattr(row, field, value)
                    else:
                        setattr(row, field, value or None)
            if "coverage_per_unit" in patch:
                cpu = patch["coverage_per_unit"]
                row.coverage_per_unit = float(cpu) if cpu else None
            if "qty_minimum" in patch:
                qm = patch["qty_minimum"]
                row.qty_minimum = float(qm) if qm not in (None, "") else None

            row.updated_by_id = updated_by_id

        self.session.flush()
        return self.list_material_prices(
            company_id=company_id, include_inactive=True,
        )

    # ── Pricing settings (calculation rates, not material costs) ──

    def list_pricing_settings(
        self, company_id=None,
    ) -> Dict[str, Any]:
        """Every editable rate, with stored overrides merged in.

        The catalog is built from pricing.py rather than the table, so
        settings nobody has touched still appear — at their default and
        flagged as not overridden. That makes the screen a complete list
        of what can be changed rather than a list of past changes.
        """
        catalog = build_pricing_catalog()
        # Show what the material behind each installed rate costs, so the
        # rate can be set against it without leaving the screen. Read
        # only — the price book stays the place a cost is edited.
        try:
            attach_material_costs(
                catalog, load_price_book(self.session, company_id=company_id),
            )
        except Exception:
            logger.exception(
                "roofing pricing settings: material costs unavailable",
            )
        stored = (
            self.session.query(RoofingPricingSetting)
            .filter(
                (RoofingPricingSetting.company_id == company_id)
                | (RoofingPricingSetting.company_id.is_(None))
            )
            .all()
        )

        # Company rows take precedence over global ones for the same key.
        by_key: Dict[str, Any] = {}
        for row in stored:
            key = f"{row.setting_group}:{row.setting_key}"
            if row.company_id is not None or key not in by_key:
                if row.company_id is None and key in by_key:
                    continue
                by_key[key] = row

        overridden = 0
        for entry in catalog:
            key = f"{entry['setting_group']}:{entry['setting_key']}"
            row = by_key.get(key)
            if not row:
                continue
            entry["value"] = float(row.value)
            entry["is_overridden"] = True
            entry["notes"] = row.notes
            entry["id"] = str(row.id)
            entry["company_id"] = (
                str(row.company_id) if row.company_id else None
            )
            overridden += 1

        return {
            "settings": catalog,
            "groups": pricing_setting_groups(),
            "overridden_count": overridden,
        }

    def update_pricing_settings(
        self, patches: List[Dict[str, Any]], company_id=None,
        updated_by_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Apply edits. A null value resets that setting to its default.

        Resetting deletes the row rather than storing the default, so the
        setting goes back to tracking pricing.py — a later change to a
        default then reaches this company instead of being shadowed by a
        stale copy of the old one.
        """
        for patch in patches:
            group = patch["setting_group"]
            key = patch["setting_key"]

            if not is_valid_setting(group, key):
                raise ValueError(f"알 수 없는 설정입니다: {group}:{key}")

            row = (
                self.session.query(RoofingPricingSetting)
                .filter(
                    RoofingPricingSetting.setting_group == group,
                    RoofingPricingSetting.setting_key == key,
                    RoofingPricingSetting.company_id == company_id,
                )
                .one_or_none()
            )

            value = patch.get("value")
            if value is None:
                if row is not None:
                    self.session.delete(row)
                continue

            error = validate_value(group, key, value)
            if error:
                raise ValueError(f"{group}:{key} — {error}")

            value = float(value)
            if row is None:
                self.session.add(RoofingPricingSetting(
                    setting_group=group,
                    setting_key=key,
                    value=value,
                    default_value=default_for(group, key),
                    notes=patch.get("notes") or None,
                    company_id=company_id,
                    updated_by_id=updated_by_id,
                ))
            else:
                row.value = value
                row.default_value = default_for(group, key)
                if "notes" in patch:
                    row.notes = patch.get("notes") or None
                row.updated_by_id = updated_by_id

        self.session.flush()
        return self.list_pricing_settings(company_id=company_id)

    def _rate_overrides_for(self, estimate) -> Optional[Dict[str, float]]:
        """Edited calculation rates in force for this estimate.

        As with material costs, a failure here must not block pricing a
        job: falling back to the pricing.py constants is exactly the
        behaviour that shipped before these were editable.
        """
        try:
            return load_pricing_settings(
                self.session, company_id=estimate.company_id,
            )
        except Exception:
            logger.exception(
                "roofing estimate %s: pricing settings load failed; "
                "using pricing.py defaults", estimate.id,
            )
            return None

    def delete_estimate(self, estimate_id: str) -> bool:
        estimate = self.estimate_repo.get_by_id(estimate_id)
        if not estimate:
            return False
        self.estimate_repo.delete(estimate_id)
        self.session.flush()
        return True

    # ── EagleView Parsing ──

    def parse_eagleview_file(
        self,
        raw_data: dict,
        selected_face_ids: Optional[List[str]] = None,
        selected_structures: Optional[List[int]] = None,
    ) -> Dict[str, Any]:
        """Parse EagleView export and extract measurements."""
        parsed = parse_eagleview(raw_data)
        measurements = extract_measurements(
            parsed, selected_face_ids, selected_structures
        )
        return measurements

    def apply_eagleview_measurement(
        self,
        estimate_id: str,
        raw_data: dict,
        selected_face_ids: Optional[List[str]] = None,
        selected_structures: Optional[List[int]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Parse EagleView data and apply measurements to an estimate."""
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None

        measurements = self.parse_eagleview_file(
            raw_data, selected_face_ids, selected_structures
        )

        update_data = {
            "measurement_source": "eagleview",
            "total_sf": measurements["total_sf"],
            "squares": measurements["squares"],
            "predominant_pitch": measurements["predominant_pitch"],
            "ridge_lf": measurements["ridge_lf"],
            "hip_lf": measurements["hip_lf"],
            "valley_lf": measurements["valley_lf"],
            "eave_lf": measurements["eave_lf"],
            "rake_lf": measurements["rake_lf"],
            "step_flashing_lf": measurements["step_flashing_lf"],
            "penetration_count": measurements["penetration_count"],
            "eagleview_data": {
                "faces": measurements["all_faces"],
                "lines": measurements["lines"],
                "structures": measurements.get("structures", []),
            },
            "selected_faces": selected_face_ids,
        }

        # Auto-set pitch multiplier
        from .pricing import get_pitch_multiplier
        if measurements["predominant_pitch"]:
            update_data["pitch_multiplier"] = get_pitch_multiplier(
                measurements["predominant_pitch"]
            )

        self.estimate_repo.update(estimate_id, update_data)
        self.session.flush()
        return self._get_full_estimate(estimate_id)

    # ── Calculation ──

    def calculate(
        self, estimate_id: str, save_history: bool = True,
        changed_by_id: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        estimate = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None

        if save_history:
            self._save_history(
                estimate_id, changed_by_id,
                "Calculation executed",
            )

        # Price the job off its real material costs, so editing a
        # price-book unit cost moves this estimate's markup and tax.
        result = calculate_estimate(
            estimate,
            material_cost_rows=self._material_rows_for(estimate),
            rate_overrides=self._rate_overrides_for(estimate),
        )

        # Clear existing line items and create new ones
        self.line_item_repo.delete_by_estimate_id(estimate_id)
        for i, li in enumerate(result["line_items"]):
            self.line_item_repo.create({
                "estimate_id": estimate_id,
                "structure_index": li.get("structure_index", 0),
                "phase": li["phase"],
                "description": li["description"],
                "quantity": li["quantity"],
                "unit": li["unit"],
                "unit_price": li["unit_price"],
                "total": li["total"],
                "material_portion": li.get("material_portion"),
                "material_cost": li.get("material_cost"),
                "labor_cost": li.get("labor_cost"),
                "category": li["category"],
                "xactimate_code": li.get("xactimate_code"),
                "notes": li.get("notes"),
                "display_order": i,
            })

        # Update estimate totals + structure results
        update_data = {
            "roofing_subtotal": result["roofing_subtotal"],
            "gutter_subtotal": result["gutter_subtotal"],
            "subtotal": result["subtotal"],
            "material_cost_total": result["material_cost_total"],
            "labor_cost_total": result["labor_cost_total"],
            "markup_amount": result["markup_amount"],
            "overhead_amount": result["overhead_amount"],
            "profit_amount": result["profit_amount"],
            "contingency_amount": result["contingency_amount"],
            "tax_amount": result["tax_amount"],
            "permit_fee": result["permit_fee"],
            "total": result["total"],
            "adjustment_factor": result.get("adjustment_factor"),
            "warning_flags": result.get("warnings", []),
            "structure_results": result.get("structure_results"),
            # Skylight replacements are quoted alongside the estimate but
            # priced separately; without this they were computed on every
            # calculate and then thrown away, leaving the PDF blank.
            "add_ons": result.get("add_ons") or None,
            # Explains the bundle rounding on the quote.
            "square_rounding": result.get("square_rounding"),
            "status": "calculated",
        }
        self.estimate_repo.update(estimate_id, update_data)

        self.session.flush()
        # The line items were deleted and rebuilt above, but the estimate
        # still sitting in the identity map holds the collection it loaded
        # beforehand. Without expiring it the reload below hands back the
        # stale (now empty) list, and the caller — the calculate endpoint,
        # and the PDF export built from its response — sees no line items.
        self.session.expire_all()
        return self._get_full_estimate(estimate_id)

    # ── Clone ──

    def clone_estimate(
        self, estimate_id: str, created_by_id: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        source = self.estimate_repo.find_by_id_with_relations(estimate_id)
        if not source:
            return None

        copy_fields = [
            "claim_id", "company_id", "property_address", "city", "state",
            "zip_code", "building_type", "year_built", "stories", "hoa",
            "roof_access", "measurement_source", "total_sf", "squares",
            "predominant_pitch", "pitch_multiplier", "ridge_lf", "hip_lf",
            "valley_lf", "eave_lf", "rake_lf", "step_flashing_lf",
            "penetration_count", "skylight_count", "chimney_count",
            "waste_factor", "roof_complexity", "eagleview_data",
            "selected_faces", "full_tearoff", "layer_count", "overlay",
            "existing_material", "insurance_job",
            "shingle_spec", "decking_spec", "underlayment_spec",
            "ice_water_spec", "drip_edge_spec", "ventilation_spec",
            "flashing_spec", "ridge_cap_spec", "gutter_spec",
            "hidden_costs", "insurance_info",
            "pricing_method", "material_markup_pct", "labor_markup_pct",
            "include_overhead_profit", "overhead_pct", "profit_pct",
            "contingency_pct", "material_portion_pct", "overview_text",
            # Structure/add-on inputs and the reverse-pricing target.
            "manual_structures", "roof_penetrations",
            "skylight_replacements", "add_ons", "warranty_info",
            "target_total",
        ]

        new_data = {"created_by_id": created_by_id, "status": "draft"}
        for field in copy_fields:
            new_data[field] = getattr(source, field, None)
        new_data["notes"] = "Cloned from estimate"

        result = self.estimate_repo.create(new_data)
        new_id = result["id"]
        self.session.flush()
        return self._get_full_estimate(new_id)

    # ── History ──

    def get_history(self, estimate_id: str) -> List[Dict[str, Any]]:
        history = self.history_repo.find_by_estimate_id(estimate_id)
        return [self.history_repo._convert_to_dict(h) for h in history]

    def _save_history(
        self, estimate_id: str, changed_by_id: Optional[str], description: str
    ):
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

    # ── Helpers ──

    def _get_full_estimate(self, estimate_id: str) -> Optional[Dict[str, Any]]:
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
        self, estimate: RoofingEstimate, result: Dict[str, Any],
    ):
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
        self, estimate: RoofingEstimate, result: Dict[str, Any],
    ):
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
