"""
Roofing Estimate service layer
"""

import logging
from typing import Any, Dict, List, Optional

from app.core.interfaces import DatabaseSession

from .calculator import calculate_estimate
from .eagleview_parser import extract_measurements, parse_eagleview
from .models import RoofingEstimate
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

        result = calculate_estimate(estimate)

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
                "category": li["category"],
                "xactimate_code": li.get("xactimate_code"),
                "notes": li.get("notes"),
                "display_order": i,
            })

        # Update estimate totals + structure results
        update_data = {
            "subtotal": result["subtotal"],
            "markup_amount": result["markup_amount"],
            "overhead_amount": result["overhead_amount"],
            "profit_amount": result["profit_amount"],
            "tax_amount": result["tax_amount"],
            "permit_fee": result["permit_fee"],
            "total": result["total"],
            "adjustment_factor": result.get("adjustment_factor"),
            "warning_flags": result.get("warnings", []),
            "structure_results": result.get("structure_results"),
            "status": "calculated",
        }
        self.estimate_repo.update(estimate_id, update_data)

        self.session.flush()
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
            "contingency_pct", "overview_text",
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
