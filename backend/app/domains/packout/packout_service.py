"""
Main packout service that orchestrates photo analysis, material calculation, and labor estimation.
"""
import logging
import time
from typing import List, Optional, Dict, Any
from datetime import datetime

from sqlalchemy.orm import Session

from app.domains.packout.schemas import (
    PackoutAnalysisRequest, PackoutAnalysisResponse,
    DetectedItem, PackoutItemSummary, XactimateLineItem
)
from app.domains.packout.models import (
    PhotoAnalysisPackout, XactimateCategory
)
from app.domains.packout.repository import PackoutRepository
from app.domains.packout.xactimate_service import XactimateService
from app.domains.packout.material_calculator import MaterialCalculator
from app.domains.packout.labor_calculator import LaborCalculator

logger = logging.getLogger(__name__)


class PackoutService:
    """Main service for packout analysis and estimation"""

    def __init__(self, db: Session):
        self.db = db
        self.repository = PackoutRepository(db)
        self.xactimate_service = XactimateService(db)
        self.material_calculator = MaterialCalculator()
        self.labor_calculator = LaborCalculator()

    async def analyze_packout(
        self,
        request: PackoutAnalysisRequest,
        company_id: int,
        user_id: Optional[int] = None
    ) -> PackoutAnalysisResponse:
        """
        Perform complete packout analysis from photos or inventory.

        Args:
            request: Packout analysis request
            company_id: Company ID
            user_id: User ID performing analysis

        Returns:
            Complete packout analysis response
        """
        start_time = time.time()

        try:
            # Step 1: Get or create item inventory
            items = await self._get_or_detect_items(request)

            # Step 2: Remove duplicates and merge similar items
            unique_items, duplicates_removed = self._deduplicate_items(items)

            # Step 3: Enrich items with Xactimate mappings
            enriched_items = self._enrich_items_with_mappings(unique_items)

            # Step 4: Calculate materials needed
            material_requirements = self.material_calculator.calculate_materials(
                enriched_items,
                self._get_packing_rules(enriched_items),
                self._get_xactimate_codes()
            )

            # Step 5: Calculate material summary
            material_summary = self.material_calculator.calculate_material_summary(
                material_requirements
            )

            # Step 6: Calculate labor requirements
            total_boxes = material_summary.get("total_boxes", 0)
            labor_requirements = self.labor_calculator.calculate_labor(
                enriched_items,
                total_boxes,
                crew_size=self._determine_crew_size(enriched_items)
            )

            # Step 7: Calculate labor summary
            labor_summary = self.labor_calculator.calculate_labor_summary(
                labor_requirements
            )

            # Step 8: Generate Xactimate line items
            xactimate_line_items = self._generate_xactimate_line_items(
                material_requirements,
                labor_requirements
            )

            # Step 9: Calculate costs (if requested)
            costs = self._calculate_costs(
                xactimate_line_items,
                include_pricing=request.include_pricing
            )

            # Step 10: Save analysis to database
            processing_time = time.time() - start_time
            packout_analysis = self._save_analysis(
                request=request,
                company_id=company_id,
                items=enriched_items,
                material_requirements=material_requirements,
                labor_requirements=labor_requirements,
                xactimate_line_items=xactimate_line_items,
                costs=costs,
                processing_time=processing_time
            )

            # Step 11: Create response
            response = self._create_response(
                packout_analysis=packout_analysis,
                items=enriched_items,
                material_requirements=material_requirements,
                labor_requirements=labor_requirements,
                material_summary=material_summary,
                labor_summary=labor_summary,
                xactimate_line_items=xactimate_line_items,
                costs=costs,
                include_pricing=request.include_pricing,
                processing_time=processing_time
            )

            logger.info(f"Packout analysis completed in {processing_time:.2f} seconds")
            return response

        except Exception as e:
            logger.error(f"Error in packout analysis: {e}", exc_info=True)
            raise

    async def _get_or_detect_items(
        self,
        request: PackoutAnalysisRequest
    ) -> List[DetectedItem]:
        """Get items from request or detect from photos"""
        items = []

        # Use existing inventory if provided
        if request.existing_inventory:
            items.extend(request.existing_inventory)

        # Add custom items if provided
        if request.custom_items:
            items.extend(request.custom_items)

        # Analyze photos if provided
        if request.photo_analysis_id:
            # Get photo analysis results
            from app.domains.photo_analysis.repository import PhotoAnalysisRepository
            photo_repo = PhotoAnalysisRepository(self.db)
            photo_analysis = photo_repo.get_analysis(request.photo_analysis_id)

            if photo_analysis and photo_analysis.analysis_results:
                # Extract items from photo analysis
                detected_items = self._extract_items_from_photo_analysis(
                    photo_analysis.analysis_results
                )
                items.extend(detected_items)

        elif request.photo_urls:
            # Analyze new photos
            from app.domains.photo_analysis.service import PhotoAnalysisService
            photo_service = PhotoAnalysisService(self.db)

            for url in request.photo_urls:
                try:
                    analysis_result = await photo_service.analyze_image(
                        image_url=url,
                        analysis_type="packout",
                        room_name=request.room_name
                    )
                    detected_items = self._extract_items_from_photo_analysis(
                        analysis_result
                    )
                    items.extend(detected_items)
                except Exception as e:
                    logger.error(f"Error analyzing photo {url}: {e}")

        return items

    def _extract_items_from_photo_analysis(
        self,
        analysis_results: Dict[str, Any]
    ) -> List[DetectedItem]:
        """Extract detected items from photo analysis results"""
        items = []

        # Assuming photo analysis returns items in a structured format
        if "items" in analysis_results:
            for item_data in analysis_results["items"]:
                item = DetectedItem(
                    name=item_data.get("name", "Unknown Item"),
                    category=item_data.get("category", "General"),
                    subcategory=item_data.get("subcategory"),
                    quantity=item_data.get("quantity", 1),
                    size=item_data.get("size", "medium"),
                    fragility=item_data.get("fragility", "normal"),
                    room_location=item_data.get("room"),
                    confidence_score=item_data.get("confidence", 0.8),
                    requires_special_handling=item_data.get("special_handling", False),
                    notes=item_data.get("notes"),
                    photo_references=item_data.get("photo_refs", [])
                )
                items.append(item)

        return items

    def _deduplicate_items(
        self,
        items: List[DetectedItem]
    ) -> tuple[List[DetectedItem], int]:
        """Remove duplicate items and merge quantities"""
        unique_items = {}
        duplicates = 0

        for item in items:
            # Create a key for grouping similar items
            key = (
                item.name.lower(),
                item.category.lower(),
                item.size,
                item.fragility
            )

            if key in unique_items:
                # Merge with existing item
                existing = unique_items[key]
                existing.quantity += item.quantity
                existing.photo_references.extend(item.photo_references)
                duplicates += 1
            else:
                # Add as new unique item
                unique_items[key] = item

        return list(unique_items.values()), duplicates

    def _enrich_items_with_mappings(
        self,
        items: List[DetectedItem]
    ) -> List[DetectedItem]:
        """Enrich items with Xactimate mappings and packing rules"""
        for item in items:
            # Find item mapping
            mapping = self.repository.find_item_mapping(
                item.name,
                item.category
            )

            if mapping:
                # Apply default characteristics if not already set
                if not item.size:
                    item.size = mapping.default_size
                if not item.fragility:
                    item.fragility = mapping.default_fragility

                # Store mapping info for later use
                item.xactimate_mapping_id = mapping.id
                item.primary_xactimate_code = mapping.xactimate_code.code

            # Find packing rule
            packing_rule = self.repository.find_packing_rule(
                item.category,
                item.subcategory,
                item.fragility,
                item.size
            )

            if packing_rule:
                item.packing_rule_id = packing_rule.id
                item.special_handling = packing_rule.special_handling
                if packing_rule.handling_notes:
                    item.notes = (item.notes or "") + " " + packing_rule.handling_notes

        return items

    def _get_packing_rules(
        self,
        items: List[DetectedItem]
    ) -> Dict[str, Any]:
        """Get packing rules for items"""
        rules = {}
        for item in items:
            if hasattr(item, 'packing_rule_id'):
                rule = self.repository.get_packing_rule(item.packing_rule_id)
                if rule:
                    key = f"{item.category}_{item.subcategory}_{item.fragility}_{item.size}"
                    rules[key] = rule
        return rules

    def _get_xactimate_codes(self) -> Dict[str, Any]:
        """Get all Xactimate codes as a dictionary"""
        codes = self.xactimate_service.search_codes(limit=1000)
        return {code.code: code for code in codes}

    def _determine_crew_size(self, items: List[DetectedItem]) -> int:
        """Determine optimal crew size for the job"""
        return self.labor_calculator.optimize_crew_size(items, target_hours=8.0)

    def _generate_xactimate_line_items(
        self,
        material_requirements: List,
        labor_requirements: List
    ) -> List[XactimateLineItem]:
        """Generate complete list of Xactimate line items"""
        line_items = []

        # Add material line items
        for material_req in material_requirements:
            line_items.extend(material_req.xactimate_codes)

        # Add labor line items
        for labor_req in labor_requirements:
            line_item = XactimateLineItem(
                code=labor_req.xactimate_code,
                category=XactimateCategory.CON if "CON" in labor_req.xactimate_code else XactimateCategory.CPS,
                description=labor_req.description,
                quantity=labor_req.hours_required,
                unit="HR",
                notes=labor_req.notes
            )
            line_items.append(line_item)

        return line_items

    def _calculate_costs(
        self,
        line_items: List[XactimateLineItem],
        include_pricing: bool
    ) -> Dict[str, Optional[float]]:
        """Calculate costs from line items"""
        if not include_pricing:
            return {
                "material_cost": None,
                "labor_cost": None,
                "total_cost": None
            }

        material_cost = 0.0
        labor_cost = 0.0

        for item in line_items:
            if item.unit_price and item.quantity:
                cost = item.unit_price * item.quantity
                if item.unit == "HR":
                    labor_cost += cost
                else:
                    material_cost += cost

        return {
            "material_cost": round(material_cost, 2),
            "labor_cost": round(labor_cost, 2),
            "total_cost": round(material_cost + labor_cost, 2)
        }

    def _save_analysis(
        self,
        request: PackoutAnalysisRequest,
        company_id: int,
        items: List[DetectedItem],
        material_requirements: List,
        labor_requirements: List,
        xactimate_line_items: List[XactimateLineItem],
        costs: Dict[str, Optional[float]],
        processing_time: float
    ) -> PhotoAnalysisPackout:
        """Save packout analysis to database"""
        # Calculate summary statistics
        total_items = sum(item.quantity for item in items)
        unique_items = len(items)

        # Extract material summary
        material_summary = self.material_calculator.calculate_material_summary(
            material_requirements
        )

        # Extract labor summary
        labor_summary = self.labor_calculator.calculate_labor_summary(
            labor_requirements
        )

        # Create analysis record
        analysis_data = {
            "photo_analysis_id": request.photo_analysis_id,
            "company_id": company_id,
            "job_id": request.job_id,
            "room_name": request.room_name,
            "total_items_detected": total_items,
            "unique_items_count": unique_items,
            "duplicate_items_removed": 0,  # Will be calculated
            "items_inventory": [item.model_dump() for item in items],
            "material_requirements": [req.model_dump() for req in material_requirements],
            "total_boxes_needed": material_summary.get("total_boxes", 0),
            "total_bubble_wrap_rolls": material_summary.get("bubble_wrap_rolls", 0),
            "total_paper_pounds": material_summary.get("paper_pounds", 0),
            "total_tape_rolls": material_summary.get("tape_rolls", 0),
            "labor_requirements": [req.model_dump() for req in labor_requirements],
            "total_packing_hours": labor_summary.get("packing_hours", 0),
            "total_inventory_hours": labor_summary.get("inventory_hours", 0),
            "total_moving_hours": labor_summary.get("moving_hours", 0),
            "total_supervision_hours": labor_summary.get("supervision_hours", 0),
            "xactimate_line_items": [item.model_dump() for item in xactimate_line_items],
            "estimated_material_cost": costs.get("material_cost"),
            "estimated_labor_cost": costs.get("labor_cost"),
            "estimated_total_cost": costs.get("total_cost"),
            "processing_time_seconds": processing_time
        }

        return self.repository.create_packout_analysis(analysis_data)

    def _create_response(
        self,
        packout_analysis: PhotoAnalysisPackout,
        items: List[DetectedItem],
        material_requirements: List,
        labor_requirements: List,
        material_summary: Dict[str, Any],
        labor_summary: Dict[str, float],
        xactimate_line_items: List[XactimateLineItem],
        costs: Dict[str, Optional[float]],
        include_pricing: bool,
        processing_time: float
    ) -> PackoutAnalysisResponse:
        """Create packout analysis response"""
        # Convert items to summary format
        item_summaries = []
        for item in items:
            summary = PackoutItemSummary(
                item_name=item.name,
                quantity=item.quantity,
                category=item.category,
                subcategory=item.subcategory,
                size=item.size,
                fragility=item.fragility,
                box_type_needed=self.material_calculator._select_box_type(item),
                packing_materials={
                    "bubble_wrap_sf": self.material_calculator._calculate_bubble_wrap(item),
                    "paper_sheets": self.material_calculator._calculate_packing_paper(item)
                },
                packing_time_minutes=self.labor_calculator.PACKING_TIME.get(
                    item.size, {}
                ).get(item.fragility, 5.0),
                special_handling_notes=item.notes if item.requires_special_handling else None
            )
            item_summaries.append(summary)

        response = PackoutAnalysisResponse(
            id=packout_analysis.id,
            job_id=packout_analysis.job_id,
            room_name=packout_analysis.room_name,
            analysis_timestamp=packout_analysis.created_at,
            items_detected=item_summaries,
            total_items=packout_analysis.total_items_detected,
            unique_items=packout_analysis.unique_items_count,
            duplicates_removed=packout_analysis.duplicate_items_removed,
            materials=material_requirements,
            material_summary=material_summary,
            labor=labor_requirements,
            labor_summary=labor_summary,
            xactimate_line_items=xactimate_line_items,
            confidence_score=0.85,  # Calculate based on detection confidence
            processing_time_seconds=processing_time
        )

        # Add pricing if requested
        if include_pricing:
            response.estimated_material_cost = costs.get("material_cost")
            response.estimated_labor_cost = costs.get("labor_cost")
            response.estimated_total_cost = costs.get("total_cost")

        return response

    def get_analysis(self, analysis_id: int) -> Optional[PhotoAnalysisPackout]:
        """Get packout analysis by ID"""
        return self.repository.get_packout_analysis(analysis_id)

    def search_analyses(
        self,
        search_request: Any
    ) -> List[PhotoAnalysisPackout]:
        """Search packout analyses"""
        return self.repository.search_packout_analyses(search_request)