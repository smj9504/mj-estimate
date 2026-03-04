"""
Pack Estimate Service

Orchestrates Phase 1 (Photo Analysis) → Phase 2 (Estimate Generation) workflow.
Converts AI output to EstimateLineItem format for import into Estimate Editor.
"""

import json
import logging
from typing import List, Optional, Dict, Any
from decimal import Decimal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from app.domains.photo_analysis.prompts.pack_estimate_prompts import (
    get_phase1_prompt,
    get_phase2_prompt,
    DEFAULT_PACK_PRICING_DATA,
    PHASE1_OUTPUT_SCHEMA,
    PHASE2_OUTPUT_SCHEMA
)
from app.domains.photo_analysis.providers import OpenAIVisionProvider
from app.core.config import settings

logger = logging.getLogger(__name__)


# ============================================================
# Schemas for Pack Estimate
# ============================================================

class PackInventoryItem(BaseModel):
    """Item detected in Phase 1 analysis - Enhanced with packing details"""
    item_id: Optional[str] = None  # e.g., LR-001 for Living Room item 1
    category: str  # Furniture, Electronics, Decorative, etc.
    description: str
    quantity: int = 1
    size_type: str = "Medium"  # Small, Medium, Large
    condition: str = "good"  # good, fair, poor
    packing_method: Optional[str] = None  # Detailed packing instructions
    box_type: Optional[str] = None  # SMALL_BOX, PICTURE_BOX, N/A, etc.
    special_handling: List[str] = Field(default_factory=list)
    packing_materials_needed: List[str] = Field(default_factory=list)
    estimated_pack_time_minutes: int = 10
    notes: Optional[str] = None

    # Legacy fields for backward compatibility
    size_category: Optional[str] = None  # SM, MD, LG, OV (deprecated)
    estimated_boxes: int = 0  # (deprecated - use box_type instead)


class PackingSupplyItem(BaseModel):
    """Supply item needed for packing"""
    code: str  # e.g., PPRBND, BBWRRL
    name: str
    quantity: int = 1


class BoxRequirements(BaseModel):
    """Box requirements by type"""
    SMALL_BOX: int = 0
    MEDIUM_BOX: int = 0
    LARGE_BOX: int = 0
    EXTRA_LARGE_BOX: int = 0
    WARDROBE_BOX: int = 0
    DISH_PACK_BOX: int = 0
    PICTURE_BOX: int = 0
    LONG_BOX: int = 0
    LAMP_BOX: int = 0
    TV_BOX: int = 0
    TUBE_BOX: int = 0
    OTHER: int = 0


class PackRoomCharacteristics(BaseModel):
    """Room characteristics from Phase 1"""
    approximate_size: str = "medium"  # small, medium, large
    density_level: str = "MODERATE"  # MINIMAL, MODERATE, FULL, PACKED
    access_notes: Optional[str] = None


class PackingSummary(BaseModel):
    """Enhanced packing summary with detailed material breakdown"""
    box_requirements: BoxRequirements = Field(default_factory=BoxRequirements)
    supplies_needed: List[PackingSupplyItem] = Field(default_factory=list)
    fragile_item_count: int = 0
    heavy_item_count: int = 0
    estimated_total_pack_time_hours: float = 0.0
    crew_size_recommended: int = 2
    special_equipment_needed: List[str] = Field(default_factory=list)

    # Legacy fields
    estimated_total_boxes: int = 0
    special_supplies_needed: List[str] = Field(default_factory=list)


class Phase1Result(BaseModel):
    """Result from Phase 1 photo analysis - Enhanced"""
    room_name: str
    items: List[PackInventoryItem]
    room_characteristics: PackRoomCharacteristics
    packing_summary: Optional[PackingSummary] = None

    # Legacy field for backward compatibility
    packing_recommendations: Optional[PackingSummary] = None

    def get_summary(self) -> PackingSummary:
        """Get packing summary (handles both old and new field names)"""
        return self.packing_summary or self.packing_recommendations or PackingSummary()


class PackEstimateLineItem(BaseModel):
    """Line item for pack estimate (compatible with EstimateLineItem)"""
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    description: Optional[str] = None
    quantity: float
    unit: str  # HR, EA, BX, SF, LF, LD
    unit_price: float = 0.0  # Default 0, filled from pricing data
    total: float = 0.0
    category: str = "LABOR"  # LABOR, MATERIALS, EQUIPMENT, SPECIAL
    primary_group: str = "Moving/Packing"
    secondary_group: Optional[str] = None
    notes: Optional[str] = None
    taxable: bool = False
    sort_order: int = 0


class PackEstimateSummary(BaseModel):
    """Summary of pack estimate"""
    subtotal: float = 0.0
    tax_rate: float = 0.0
    tax_amount: float = 0.0
    total: float = 0.0
    estimated_duration_hours: float = 0.0


class Phase2Result(BaseModel):
    """Result from Phase 2 estimate generation"""
    line_items: List[PackEstimateLineItem]
    summary: PackEstimateSummary


class PackEstimateResult(BaseModel):
    """Complete pack estimate result"""
    phase1_inventory: Optional[Phase1Result] = None
    line_items: List[PackEstimateLineItem]
    summary: PackEstimateSummary
    processing_info: Dict[str, Any] = Field(default_factory=dict)


# ============================================================
# Pack Estimate Service
# ============================================================

class PackEstimateService:
    """
    Service for generating pack-out estimates from photos.

    Workflow:
    1. Phase 1: Analyze photos to create inventory
    2. Phase 2: Generate line items with pricing
    3. Convert to EstimateLineItem format
    """

    def __init__(self):
        """Initialize the service."""
        self.provider = OpenAIVisionProvider()
        self.pricing_data: Optional[str] = None
        logger.info("PackEstimateService initialized")

    def set_pricing_data(self, pricing_json: str) -> None:
        """
        Set custom pricing data for estimate generation.

        Args:
            pricing_json: JSON string of pricing data
        """
        self.pricing_data = pricing_json
        logger.info("Custom pricing data loaded")

    def get_pricing_data(self) -> str:
        """Get pricing data (custom or default)."""
        return self.pricing_data or DEFAULT_PACK_PRICING_DATA

    async def analyze_photos_phase1(
        self,
        photo_urls: List[str],
        room_name: str = "Unknown Room"
    ) -> Phase1Result:
        """
        Phase 1: Analyze photos to create content inventory.

        Args:
            photo_urls: List of photo URLs to analyze
            room_name: Name/identifier for the room

        Returns:
            Phase1Result with inventory data
        """
        if not self.provider.is_available():
            logger.warning("OpenAI provider not available, using mock data")
            return self._get_mock_phase1_result(room_name)

        prompt = get_phase1_prompt()

        try:
            # Analyze photos with OpenAI Vision
            if len(photo_urls) == 1:
                raw_result = await self.provider.analyze_photo_raw(
                    photo_urls[0],
                    prompt
                )
            else:
                # For multiple photos, analyze each and aggregate
                results = []
                for url in photo_urls:
                    result = await self.provider.analyze_photo_raw(url, prompt)
                    results.append(result)
                raw_result = self._aggregate_phase1_results(results)

            # Parse and validate result
            parsed = json.loads(raw_result)

            # Parse items with new enhanced structure
            items = []
            for item_data in parsed.get("items", []):
                items.append(PackInventoryItem(**item_data))

            # Parse packing summary (new structure) or recommendations (legacy)
            packing_summary = None
            if "packing_summary" in parsed:
                summary_data = parsed["packing_summary"]
                box_req = summary_data.get("box_requirements", {})
                supplies = [
                    PackingSupplyItem(**s)
                    for s in summary_data.get("supplies_needed", [])
                ]
                packing_summary = PackingSummary(
                    box_requirements=BoxRequirements(**box_req),
                    supplies_needed=supplies,
                    fragile_item_count=summary_data.get("fragile_item_count", 0),
                    heavy_item_count=summary_data.get("heavy_item_count", 0),
                    estimated_total_pack_time_hours=summary_data.get(
                        "estimated_total_pack_time_hours", 4.0
                    ),
                    crew_size_recommended=summary_data.get(
                        "crew_size_recommended", 2
                    ),
                    special_equipment_needed=summary_data.get(
                        "special_equipment_needed", []
                    )
                )
            elif "packing_recommendations" in parsed:
                # Legacy format support
                rec_data = parsed["packing_recommendations"]
                packing_summary = PackingSummary(
                    estimated_total_boxes=rec_data.get("estimated_total_boxes", 0),
                    special_supplies_needed=rec_data.get(
                        "special_supplies_needed", []
                    ),
                    estimated_total_pack_time_hours=rec_data.get(
                        "estimated_pack_time_hours", 4.0
                    )
                )

            result = Phase1Result(
                room_name=parsed.get("room_name", room_name),
                items=items,
                room_characteristics=PackRoomCharacteristics(
                    **parsed.get("room_characteristics", {})
                ),
                packing_summary=packing_summary
            )

            summary = result.get_summary()
            logger.info(
                f"Phase 1 complete: {len(result.items)} items found, "
                f"estimated {summary.estimated_total_pack_time_hours}h pack time"
            )
            return result

        except Exception as e:
            logger.error(f"Phase 1 analysis failed: {e}")
            return self._get_mock_phase1_result(room_name)

    async def generate_estimate_phase2(
        self,
        inventory: Phase1Result,
        custom_pricing: Optional[str] = None
    ) -> Phase2Result:
        """
        Phase 2: Generate estimate line items from inventory.

        Args:
            inventory: Phase1Result with inventory data
            custom_pricing: Optional custom pricing data JSON

        Returns:
            Phase2Result with line items and summary
        """
        pricing_data = custom_pricing or self.get_pricing_data()
        inventory_json = inventory.model_dump_json()

        if not self.provider.is_available():
            logger.warning("OpenAI provider not available, using rule-based generation")
            return self._generate_estimate_rule_based(inventory)

        prompt = get_phase2_prompt(pricing_data, inventory_json)

        try:
            raw_result = await self.provider.generate_text(prompt)
            parsed = json.loads(raw_result)

            line_items = []
            for idx, item in enumerate(parsed.get("line_items", [])):
                line_items.append(PackEstimateLineItem(
                    name=item.get("name", ""),
                    description=item.get("description", ""),
                    quantity=float(item.get("quantity", 0)),
                    unit=item.get("unit", "EA"),
                    unit_price=float(item.get("unit_price", 0)),
                    total=float(item.get("total", 0)),
                    category=item.get("category", "LABOR"),
                    secondary_group=item.get("category", "LABOR"),
                    notes=item.get("notes"),
                    sort_order=idx
                ))

            summary_data = parsed.get("summary", {})
            summary = PackEstimateSummary(
                subtotal=float(summary_data.get("subtotal", 0)),
                tax_rate=float(summary_data.get("tax_rate", 0)),
                tax_amount=float(summary_data.get("tax_amount", 0)),
                total=float(summary_data.get("total", 0)),
                estimated_duration_hours=float(
                    summary_data.get("estimated_duration_hours", 0)
                )
            )

            logger.info(
                f"Phase 2 complete: {len(line_items)} line items, "
                f"total ${summary.total:.2f}"
            )
            return Phase2Result(line_items=line_items, summary=summary)

        except Exception as e:
            logger.error(f"Phase 2 generation failed: {e}")
            return self._generate_estimate_rule_based(inventory)

    async def generate_pack_estimate(
        self,
        photo_urls: List[str],
        room_name: str = "Pack-Out Estimate",
        custom_pricing: Optional[str] = None,
        skip_phase2_ai: bool = False
    ) -> PackEstimateResult:
        """
        Generate complete pack estimate from photos.

        Workflow:
        1. Phase 1: Analyze photos for inventory
        2. Phase 2: Generate line items (AI or rule-based)
        3. Return combined result

        Args:
            photo_urls: List of photo URLs
            room_name: Name for the room/project
            custom_pricing: Optional pricing data JSON
            skip_phase2_ai: If True, use rule-based generation for Phase 2

        Returns:
            PackEstimateResult with line items ready for Estimate Editor
        """
        processing_info = {
            "photo_count": len(photo_urls),
            "room_name": room_name,
            "phase1_method": "ai",
            "phase2_method": "ai" if not skip_phase2_ai else "rule_based"
        }

        # Phase 1: Photo Analysis
        logger.info(f"Starting Phase 1 analysis for {len(photo_urls)} photos")
        phase1_result = await self.analyze_photos_phase1(photo_urls, room_name)
        summary = phase1_result.get_summary()
        processing_info["items_detected"] = len(phase1_result.items)
        processing_info["estimated_pack_hours"] = summary.estimated_total_pack_time_hours
        processing_info["box_requirements"] = (
            summary.box_requirements.model_dump()
            if summary.box_requirements else {}
        )

        # Phase 2: Estimate Generation
        logger.info("Starting Phase 2 estimate generation")
        if skip_phase2_ai:
            phase2_result = self._generate_estimate_rule_based(phase1_result)
        else:
            phase2_result = await self.generate_estimate_phase2(
                phase1_result,
                custom_pricing
            )

        processing_info["line_items_generated"] = len(phase2_result.line_items)
        processing_info["estimated_total"] = phase2_result.summary.total

        return PackEstimateResult(
            phase1_inventory=phase1_result,
            line_items=phase2_result.line_items,
            summary=phase2_result.summary,
            processing_info=processing_info
        )

    def convert_to_estimate_items(
        self,
        pack_result: PackEstimateResult
    ) -> List[Dict[str, Any]]:
        """
        Convert PackEstimateResult to EstimateLineItem format.

        This format is compatible with the frontend Estimate Editor.

        Args:
            pack_result: PackEstimateResult from generate_pack_estimate

        Returns:
            List of dictionaries matching EstimateLineItem interface
        """
        estimate_items = []

        for idx, item in enumerate(pack_result.line_items):
            estimate_items.append({
                "id": item.id,
                "line_item_id": None,  # No linked line item yet
                "name": item.name,
                "description": item.description,
                "note": item.notes,
                "quantity": item.quantity,
                "unit": item.unit,
                "unit_price": item.unit_price,
                "total": item.total,
                "taxable": item.taxable,
                "primary_group": item.primary_group,
                "secondary_group": item.secondary_group,
                "sort_order": idx
            })

        return estimate_items

    # ============================================================
    # Private Helper Methods
    # ============================================================

    def _get_mock_phase1_result(self, room_name: str) -> Phase1Result:
        """Generate mock Phase 1 result for testing."""
        return Phase1Result(
            room_name=room_name,
            items=[
                PackInventoryItem(
                    category="Furniture",
                    description="Living room sofa, 3-seater",
                    quantity=1,
                    condition="good",
                    size_category="LG",
                    special_handling=["heavy"],
                    estimated_boxes=0
                ),
                PackInventoryItem(
                    category="Electronics",
                    description="55-inch TV with stand",
                    quantity=1,
                    condition="good",
                    size_category="LG",
                    special_handling=["fragile", "valuable"],
                    estimated_boxes=1
                ),
                PackInventoryItem(
                    category="Decorative",
                    description="Framed artwork and photos",
                    quantity=5,
                    condition="good",
                    size_category="MD",
                    special_handling=["fragile"],
                    estimated_boxes=2
                ),
                PackInventoryItem(
                    category="Books/Media",
                    description="Books and magazines",
                    quantity=50,
                    condition="good",
                    size_category="SM",
                    estimated_boxes=3
                )
            ],
            room_characteristics=PackRoomCharacteristics(
                approximate_size="medium",
                density_level="MODERATE",
                access_notes=None
            ),
            packing_summary=PackingSummary(
                estimated_total_boxes=10,
                special_supplies_needed=["Picture boxes", "Bubble wrap"],
                estimated_total_pack_time_hours=4.0
            )
        )

    def _generate_estimate_rule_based(
        self,
        inventory: Phase1Result
    ) -> Phase2Result:
        """
        Generate estimate using rule-based logic (no AI).

        Used as fallback when AI is unavailable or for testing.
        Prices are set to 0 - will be filled from pricing database later.
        """
        line_items = []
        sort_order = 0

        # Calculate labor hours based on recommendations
        pack_hours = inventory.get_summary().estimated_total_pack_time_hours or 4.0

        # Packing Labor
        line_items.append(PackEstimateLineItem(
            name="Pack-Out Labor",
            description=f"Professional packing for {inventory.room_name}",
            quantity=pack_hours,
            unit="HR",
            unit_price=0.0,  # Will be filled from pricing
            total=0.0,
            category="LABOR",
            secondary_group="LABOR",
            sort_order=sort_order
        ))
        sort_order += 1

        # Boxes based on inventory
        box_counts = {"SM": 0, "MD": 0, "LG": 0}
        for item in inventory.items:
            boxes = item.estimated_boxes or 1
            size = item.size_category
            if size in box_counts:
                box_counts[size] += boxes
            else:
                box_counts["MD"] += boxes

        # Small boxes
        if box_counts["SM"] > 0:
            line_items.append(PackEstimateLineItem(
                name="Small Box (1.5 cu ft)",
                description="For books, small items",
                quantity=float(box_counts["SM"]),
                unit="EA",
                unit_price=0.0,
                total=0.0,
                category="MATERIALS",
                secondary_group="MATERIALS",
                sort_order=sort_order
            ))
            sort_order += 1

        # Medium boxes
        if box_counts["MD"] > 0:
            line_items.append(PackEstimateLineItem(
                name="Medium Box (3.0 cu ft)",
                description="For general household items",
                quantity=float(box_counts["MD"]),
                unit="EA",
                unit_price=0.0,
                total=0.0,
                category="MATERIALS",
                secondary_group="MATERIALS",
                sort_order=sort_order
            ))
            sort_order += 1

        # Large boxes
        if box_counts["LG"] > 0:
            line_items.append(PackEstimateLineItem(
                name="Large Box (4.5 cu ft)",
                description="For bulky, lightweight items",
                quantity=float(box_counts["LG"]),
                unit="EA",
                unit_price=0.0,
                total=0.0,
                category="MATERIALS",
                secondary_group="MATERIALS",
                sort_order=sort_order
            ))
            sort_order += 1

        # Packing supplies
        total_boxes = sum(box_counts.values())
        if total_boxes > 0:
            # Packing paper (1 bundle per 10 boxes)
            paper_bundles = max(1, total_boxes // 10)
            line_items.append(PackEstimateLineItem(
                name="Packing Paper Bundle",
                description="25 lbs packing paper",
                quantity=float(paper_bundles),
                unit="EA",
                unit_price=0.0,
                total=0.0,
                category="MATERIALS",
                secondary_group="MATERIALS",
                sort_order=sort_order
            ))
            sort_order += 1

            # Tape (1 roll per 5 boxes)
            tape_rolls = max(1, total_boxes // 5)
            line_items.append(PackEstimateLineItem(
                name="Packing Tape Roll",
                description="Standard packing tape",
                quantity=float(tape_rolls),
                unit="EA",
                unit_price=0.0,
                total=0.0,
                category="MATERIALS",
                secondary_group="MATERIALS",
                sort_order=sort_order
            ))
            sort_order += 1

        # Special handling items
        fragile_count = sum(
            1 for item in inventory.items
            if "fragile" in (item.special_handling or [])
        )
        if fragile_count > 0:
            line_items.append(PackEstimateLineItem(
                name="Bubble Wrap Roll",
                description="For fragile item protection",
                quantity=float(max(1, fragile_count // 3)),
                unit="EA",
                unit_price=0.0,
                total=0.0,
                category="MATERIALS",
                secondary_group="MATERIALS",
                sort_order=sort_order
            ))
            sort_order += 1

        # Specialty packing for valuable/electronics
        electronics = [
            item for item in inventory.items
            if item.category == "Electronics"
        ]
        if electronics:
            line_items.append(PackEstimateLineItem(
                name="Electronics Pack",
                description="Special packing for electronics",
                quantity=float(len(electronics)),
                unit="EA",
                unit_price=0.0,
                total=0.0,
                category="SPECIAL",
                secondary_group="SPECIAL",
                sort_order=sort_order
            ))
            sort_order += 1

        # Summary (totals are 0 since prices are not set)
        summary = PackEstimateSummary(
            subtotal=0.0,
            tax_rate=0.0,
            tax_amount=0.0,
            total=0.0,
            estimated_duration_hours=pack_hours
        )

        return Phase2Result(line_items=line_items, summary=summary)

    def _aggregate_phase1_results(self, results: List[str]) -> str:
        """Aggregate multiple Phase 1 results into one."""
        all_items = []
        total_boxes = 0
        total_hours = 0.0

        for result_str in results:
            try:
                result = json.loads(result_str)
                all_items.extend(result.get("items", []))

                recs = result.get("packing_recommendations", {})
                total_boxes += recs.get("estimated_total_boxes", 0)
                total_hours += recs.get("estimated_pack_time_hours", 0)
            except json.JSONDecodeError:
                continue

        aggregated = {
            "room_name": "Multiple Rooms",
            "items": all_items,
            "room_characteristics": {
                "approximate_size": "large",
                "density_level": "MODERATE",
                "access_notes": "Multiple rooms analyzed"
            },
            "packing_recommendations": {
                "estimated_total_boxes": total_boxes,
                "special_supplies_needed": [],
                "estimated_pack_time_hours": total_hours
            }
        }

        return json.dumps(aggregated)
