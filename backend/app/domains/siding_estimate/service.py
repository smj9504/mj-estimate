"""
Siding Estimate service - business logic
"""

import logging
from typing import Dict, List, Optional, Tuple
from uuid import uuid4

from app.core.interfaces import DatabaseSession

from .models import SidingEstimate, SidingEstimateLineItem
from .repository import SidingEstimateRepository, SidingEstimateLineItemRepository
from .eagleview_parser import EagleViewSidingReport, parse_eagleview_xml
from .schemas import SIDING_PHASE_LABELS

logger = logging.getLogger(__name__)


class SidingEstimateService:
    def __init__(self, session: DatabaseSession):
        self.session = session
        self.repo = SidingEstimateRepository(session)
        self.li_repo = SidingEstimateLineItemRepository(session)

    # ── CRUD ──

    def get_by_id(self, estimate_id: str) -> Optional[SidingEstimate]:
        return self.repo.find_by_id_with_relations(estimate_id)

    def get_list(
        self,
        claim_id: Optional[str] = None,
        company_id: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        page: int = 1,
        page_size: int = 50,
    ) -> Tuple[List[SidingEstimate], int]:
        return self.repo.find_by_filters(
            claim_id=claim_id,
            company_id=company_id,
            status=status,
            search=search,
            page=page,
            page_size=page_size,
        )

    def create(self, data: dict, created_by_id: Optional[str] = None) -> SidingEstimate:
        estimate = SidingEstimate(**data)
        if created_by_id:
            estimate.created_by_id = created_by_id
        self.session.add(estimate)
        self.session.flush()
        return estimate

    def update(self, estimate_id: str, data: dict) -> Optional[SidingEstimate]:
        estimate = self.repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None

        for key, value in data.items():
            if hasattr(estimate, key) and key not in ("id", "created_at"):
                setattr(estimate, key, value)

        self.session.flush()
        return estimate

    def delete(self, estimate_id: str) -> bool:
        estimate = self.repo.find_by_id(estimate_id)
        if not estimate:
            return False
        self.session.delete(estimate)
        self.session.flush()
        return True

    # ── EagleView Parsing ──

    def parse_eagleview(self, xml_content: str) -> EagleViewSidingReport:
        """Parse EagleView XML and return structured data."""
        return parse_eagleview_xml(xml_content)

    def create_from_eagleview(
        self,
        ev_report: EagleViewSidingReport,
        company_id: Optional[str] = None,
        claim_id: Optional[str] = None,
        created_by_id: Optional[str] = None,
    ) -> SidingEstimate:
        """Create a new siding estimate pre-populated from EagleView data."""
        data = {
            "company_id": company_id,
            "claim_id": claim_id or (ev_report.claim_id if ev_report.claim_id else None),
            "property_address": ev_report.address,
            "city": ev_report.city,
            "state": ev_report.state,
            "zip_code": ev_report.zip_code,
            "eagleview_report_id": ev_report.report_id,
            "eagleview_claim_id": ev_report.claim_id,
            "eagleview_data": ev_report.to_dict(),
            # Measurements
            "total_wall_area": ev_report.total_wall_area,
            "total_wall_area_net": ev_report.total_wall_area_less_penetrations,
            "total_siding_area": ev_report.total_siding_area,
            "total_siding_area_net": ev_report.total_siding_area_less_penetrations,
            "total_masonry_area": ev_report.total_masonry_area,
            "total_masonry_area_net": ev_report.total_masonry_area_less_penetrations,
            "total_wall_facets": ev_report.total_wall_facets,
            "total_windows_doors": ev_report.total_windows_and_doors,
            "total_windows_doors_area": ev_report.total_windows_and_doors_area,
            "total_windows_doors_perimeter": ev_report.total_windows_and_doors_perimeter,
            "fascia_lf": ev_report.fascia_lf,
            "inside_corners_lf": ev_report.inside_corners_lf,
            "outside_corners_lf": ev_report.outside_corners_lf,
            "obtuse_inside_corners_lf": ev_report.obtuse_inside_corners_lf,
            "obtuse_outside_corners_lf": ev_report.obtuse_outside_corners_lf,
            "inside_siding_corners_lf": ev_report.inside_siding_corners_lf,
            "outside_siding_corners_lf": ev_report.outside_siding_corners_lf,
            "top_siding_walls_lf": ev_report.top_siding_walls_lf,
            "bottom_siding_walls_lf": ev_report.bottom_siding_walls_lf,
        }
        return self.create(data, created_by_id=created_by_id)

    # ── Line Item Management ──

    def add_line_item(
        self, estimate_id: str, data: dict
    ) -> Optional[SidingEstimateLineItem]:
        estimate = self.repo.find_by_id(estimate_id)
        if not estimate:
            return None

        item = SidingEstimateLineItem(
            estimate_id=estimate_id,
            **data,
        )
        # Auto-calculate total
        item.total = round(item.quantity * item.unit_price, 2)
        self.session.add(item)
        self.session.flush()

        self._recalculate_totals(estimate_id)
        return item

    def update_line_item(
        self, item_id: str, data: dict
    ) -> Optional[SidingEstimateLineItem]:
        item = self.li_repo.find_by_id(item_id)
        if not item:
            return None

        for key, value in data.items():
            if hasattr(item, key) and key not in ("id", "estimate_id", "created_at"):
                setattr(item, key, value)

        # Recalculate total
        item.total = round(item.quantity * item.unit_price, 2)
        self.session.flush()

        self._recalculate_totals(str(item.estimate_id))
        return item

    def delete_line_item(self, item_id: str) -> bool:
        item = self.li_repo.find_by_id(item_id)
        if not item:
            return False

        estimate_id = str(item.estimate_id)
        self.session.delete(item)
        self.session.flush()

        self._recalculate_totals(estimate_id)
        return True

    def delete_phase(self, estimate_id: str, phase: int) -> int:
        """Delete all line items in a phase. Returns count deleted."""
        count = self.li_repo.delete_by_phase(estimate_id, phase)
        self.session.flush()
        self._recalculate_totals(estimate_id)
        return count

    # ── Totals Calculation ──

    def _recalculate_totals(self, estimate_id: str):
        """Recalculate subtotal, O&P, and total for an estimate."""
        estimate = self.repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return

        subtotal = sum(item.total or 0 for item in estimate.line_items)
        estimate.subtotal = round(subtotal, 2)

        if estimate.include_overhead_profit:
            oh_pct = estimate.overhead_pct or 0
            pr_pct = estimate.profit_pct or 0
            estimate.overhead_amount = round(subtotal * oh_pct / 100, 2)
            estimate.profit_amount = round(subtotal * pr_pct / 100, 2)
        else:
            estimate.overhead_amount = 0
            estimate.profit_amount = 0

        estimate.total = round(
            estimate.subtotal + estimate.overhead_amount + estimate.profit_amount + (estimate.tax_amount or 0),
            2,
        )
        self.session.flush()

    def recalculate(self, estimate_id: str) -> Optional[SidingEstimate]:
        """Public recalculate endpoint."""
        self._recalculate_totals(estimate_id)
        return self.repo.find_by_id_with_relations(estimate_id)

    # ── Line Item Generation ──

    def generate_line_items(self, estimate_id: str) -> Optional[SidingEstimate]:
        """
        Auto-generate line items from measurements + specs.
        Clears existing items and regenerates.
        """
        estimate = self.repo.find_by_id_with_relations(estimate_id)
        if not estimate:
            return None

        # Clear existing items
        self.li_repo.delete_by_estimate_id(estimate_id)
        self.session.flush()

        items = []
        order = 0

        # Shorthand
        siding_sf = estimate.total_siding_area_net or estimate.total_siding_area or 0
        masonry_sf = estimate.total_masonry_area_net or 0
        wd_perim = estimate.total_windows_doors_perimeter or 0
        wd_count = estimate.total_windows_doors or 0
        fascia = estimate.fascia_lf or 0
        outside_corners = estimate.outside_siding_corners_lf or estimate.outside_corners_lf or 0
        inside_corners = estimate.inside_siding_corners_lf or estimate.inside_corners_lf or 0
        top_siding = estimate.top_siding_walls_lf or 0
        bottom_siding = estimate.bottom_siding_walls_lf or 0

        # Get specs
        demo_spec = estimate.demo_spec or {}
        siding_spec = estimate.siding_spec or {}
        trim_spec = estimate.trim_spec or {}
        soffit_spec = estimate.soffit_fascia_spec or {}
        weather_spec = estimate.weather_barrier_spec or {}
        hidden = estimate.hidden_costs or {}

        # ── Phase 1: Demo & Disposal ──
        if demo_spec.get("remove_siding", True):
            order += 1
            items.append(self._make_item(
                estimate_id, 1, "Remove existing siding",
                siding_sf, "SF", 0.85, order,
                category="labor",
            ))

        if demo_spec.get("remove_trim", True):
            trim_lf = wd_perim + outside_corners + inside_corners
            if trim_lf > 0:
                order += 1
                items.append(self._make_item(
                    estimate_id, 1, "Remove existing trim & accessories",
                    trim_lf, "LF", 0.50, order,
                    category="labor",
                ))

        if demo_spec.get("remove_soffit", False):
            order += 1
            items.append(self._make_item(
                estimate_id, 1, "Remove existing soffit",
                fascia, "LF", 1.50, order,
                category="labor",
            ))

        if demo_spec.get("remove_fascia", False):
            order += 1
            items.append(self._make_item(
                estimate_id, 1, "Remove existing fascia",
                fascia, "LF", 1.00, order,
                category="labor",
            ))

        if hidden.get("dumpster", True):
            order += 1
            items.append(self._make_item(
                estimate_id, 1, "Dumpster - construction debris",
                1, "EA", 450.00, order,
                category="equipment",
            ))

        # ── Phase 2: Sheathing & Structural Repair ──
        repair = estimate.repair_spec or {}
        if repair.get("sheathing_repair", False):
            repair_sf = repair.get("sheathing_repair_sf", 0) or 32  # default allowance
            order += 1
            items.append(self._make_item(
                estimate_id, 2, "Sheathing repair/replacement - OSB 7/16\"",
                repair_sf, "SF", 3.50, order,
                category="material",
            ))

        if repair.get("fascia_board_repair", False):
            repair_lf = repair.get("fascia_repair_lf", 0) or 16
            order += 1
            items.append(self._make_item(
                estimate_id, 2, "Fascia board repair - 1x6 pine",
                repair_lf, "LF", 4.50, order,
                category="material",
            ))

        # ── Phase 3: Weather Barrier & Insulation ──
        if weather_spec.get("house_wrap", True):
            order += 1
            wrap_brand = weather_spec.get("house_wrap_brand", "Tyvek")
            items.append(self._make_item(
                estimate_id, 3, f"House wrap - {wrap_brand}",
                siding_sf, "SF", 0.55, order,
                category="material",
            ))

        if weather_spec.get("rigid_insulation", False):
            r_value = weather_spec.get("insulation_r_value", 3)
            order += 1
            items.append(self._make_item(
                estimate_id, 3, f"Rigid foam insulation board - R{r_value}",
                siding_sf, "SF", 1.25, order,
                category="material",
            ))

        # ── Phase 4: Siding Installation ──
        siding_type = siding_spec.get("type", "vinyl")
        siding_profile = siding_spec.get("profile", "lap")

        # Siding material + labor
        siding_price = _get_siding_price(siding_type)
        order += 1
        items.append(self._make_item(
            estimate_id, 4,
            f"Install {siding_type} siding - {siding_profile}",
            siding_sf, "SF", siding_price, order,
            category="material",
        ))

        # J-channel around windows/doors
        if wd_perim > 0:
            order += 1
            items.append(self._make_item(
                estimate_id, 4, "J-channel - around windows & doors",
                wd_perim, "LF", 1.50, order,
                category="material",
            ))

        # Outside corner posts
        if outside_corners > 0:
            order += 1
            items.append(self._make_item(
                estimate_id, 4, "Outside corner posts",
                outside_corners, "LF", 3.50, order,
                category="material",
            ))

        # Inside corner posts
        if inside_corners > 0:
            order += 1
            items.append(self._make_item(
                estimate_id, 4, "Inside corner posts",
                inside_corners, "LF", 2.75, order,
                category="material",
            ))

        # Starter strip
        starter_lf = bottom_siding or top_siding
        if starter_lf > 0:
            order += 1
            items.append(self._make_item(
                estimate_id, 4, "Starter strip",
                starter_lf, "LF", 0.75, order,
                category="material",
            ))

        # Undersill / utility trim (top of siding walls)
        if top_siding > 0:
            order += 1
            items.append(self._make_item(
                estimate_id, 4, "Undersill / utility trim",
                top_siding, "LF", 0.85, order,
                category="material",
            ))

        # ── Phase 5: Trim, Soffit & Fascia ──
        if soffit_spec.get("replace_fascia", True) and fascia > 0:
            fascia_type = soffit_spec.get("fascia_type", "aluminum_wrap")
            order += 1
            items.append(self._make_item(
                estimate_id, 5,
                f"Fascia - {fascia_type.replace('_', ' ')}",
                fascia, "LF", 6.50, order,
                category="material",
            ))

        if soffit_spec.get("replace_soffit", False):
            soffit_type = soffit_spec.get("soffit_type", "vinyl_vented")
            soffit_sf = soffit_spec.get("soffit_sf", 0)
            if soffit_sf <= 0:
                # Estimate: fascia LF * 1.5 ft avg depth
                soffit_sf = round(fascia * 1.5, 0)
            order += 1
            items.append(self._make_item(
                estimate_id, 5,
                f"Soffit - {soffit_type.replace('_', ' ')}",
                soffit_sf, "SF", 5.00, order,
                category="material",
            ))

        if trim_spec.get("window_trim", True) and wd_count > 0:
            order += 1
            items.append(self._make_item(
                estimate_id, 5, "Window/door trim wrap - aluminum coil",
                wd_perim, "LF", 4.50, order,
                category="material",
            ))

        # ── Phase 6: Caulking, Paint & Cleanup ──
        order += 1
        items.append(self._make_item(
            estimate_id, 6, "Caulking - all joints & penetrations",
            1, "LS", 350.00, order,
            category="material",
        ))

        if siding_type == "fiber_cement":
            order += 1
            items.append(self._make_item(
                estimate_id, 6, "Touch-up paint - fiber cement siding",
                siding_sf, "SF", 0.35, order,
                category="material",
            ))

        if hidden.get("final_cleanup", True):
            order += 1
            items.append(self._make_item(
                estimate_id, 6, "Final cleanup & debris removal",
                1, "EA", 250.00, order,
                category="labor",
            ))

        if hidden.get("scaffolding", False):
            order += 1
            items.append(self._make_item(
                estimate_id, 6, "Scaffolding setup & removal",
                1, "LS", 800.00, order,
                category="equipment",
            ))

        if hidden.get("permits", False):
            order += 1
            items.append(self._make_item(
                estimate_id, 6, "Building permit",
                1, "EA", 250.00, order,
                category="other",
            ))

        if hidden.get("gutter_detach_reset", False):
            order += 1
            items.append(self._make_item(
                estimate_id, 6, "Detach & reset gutters/downspouts",
                fascia, "LF", 3.00, order,
                category="labor",
            ))

        # Bulk insert
        for item in items:
            self.session.add(item)
        self.session.flush()

        # Expire cached objects so recalculate sees new items
        self.session.expire_all()

        # Recalculate totals
        self._recalculate_totals(estimate_id)

        return self.repo.find_by_id_with_relations(estimate_id)

    def _make_item(
        self,
        estimate_id: str,
        phase: int,
        description: str,
        quantity: float,
        unit: str,
        unit_price: float,
        display_order: int,
        category: str = "material",
    ) -> SidingEstimateLineItem:
        return SidingEstimateLineItem(
            estimate_id=estimate_id,
            phase=phase,
            description=description,
            quantity=round(quantity, 1),
            unit=unit,
            unit_price=round(unit_price, 2),
            total=round(quantity * unit_price, 2),
            category=category,
            display_order=display_order,
        )


def _get_siding_price(siding_type: str) -> float:
    """Get base installed price per SF by siding type."""
    prices = {
        "vinyl": 4.50,
        "fiber_cement": 8.50,
        "hardie_board": 9.00,
        "wood": 7.50,
        "lp_smartside": 6.50,
        "metal": 7.00,
        "aluminum": 5.50,
    }
    return prices.get(siding_type, 5.00)
