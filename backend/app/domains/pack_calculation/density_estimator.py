"""
Density Estimation Service
AI-powered room content estimation based on density levels
"""

from typing import Dict, List, Optional
from .templates import (
    RoomTemplate,
    RoomType,
    DensityLevel,
    TemplateItem,
    StorageMultiplier,
    DensityModifier,
    template_registry
)


class DensityEstimator:
    """Estimate pack items based on room type and density"""

    # Size multipliers for room size adjustment
    SIZE_MULTIPLIERS = {
        "small": 0.6,
        "medium": 1.0,
        "large": 1.7,
    }

    # Size square footage ranges for documentation
    SIZE_SQFT_RANGES = {
        "small": "100-200 sqft",
        "medium": "200-400 sqft",
        "large": "400-800 sqft",
    }

    def __init__(self):
        self.template_registry = template_registry

    def estimate(
        self,
        room_type: RoomType,
        density_level: DensityLevel,
        room_size: str = "medium",
        custom_adjustments: Optional[Dict] = None
    ) -> Dict:
        """
        Estimate pack items based on room type, size, and density

        Args:
            room_type: Type of room (kitchen, bedroom, etc.)
            density_level: How full the room is (minimal to packed)
            room_size: Size of room (small, medium, large)
            custom_adjustments: Optional custom counts (cabinet_count, closet_count, etc.)

        Returns:
            Dictionary with estimated_items, total_boxes, confidence, breakdown, assumptions
        """
        template = self.template_registry.get(room_type)
        if not template:
            raise ValueError(f"No template found for room type: {room_type}")

        custom_adjustments = custom_adjustments or {}

        # Get size multiplier
        size_multiplier = self.SIZE_MULTIPLIERS.get(room_size, 1.0)

        items = []
        assumptions = []

        # Get density modifier for this level
        density_modifier = next(
            (dm for dm in template.density_modifiers if dm.density_level == density_level),
            None
        )

        if not density_modifier:
            raise ValueError(f"No density modifier for level: {density_level}")

        # 1. Process base items with density and size adjustment
        for template_item in template.base_items:
            adjusted_quantity = self._calculate_adjusted_quantity(
                template_item,
                density_modifier,
                size_multiplier,
                custom_adjustments
            )

            if adjusted_quantity > 0:
                items.append({
                    "category": template_item.category,
                    "subcategory": template_item.subcategory or template_item.category,
                    "quantity": adjusted_quantity,
                    "pack_size": template_item.pack_size,
                    "storage_type": template_item.storage_type
                })

        # 2. Apply storage multipliers (cabinets, closets, drawers)
        for multiplier in template.storage_multipliers:
            storage_items, storage_assumptions = self._estimate_storage_contents(
                multiplier,
                density_level,
                size_multiplier,
                custom_adjustments
            )
            items.extend(storage_items)
            assumptions.extend(storage_assumptions)

        # 3. Add additional categories for higher density
        for category_name in density_modifier.additional_categories:
            additional_item = self._create_additional_category_item(
                category_name,
                density_level,
                size_multiplier
            )
            items.append(additional_item)

        # 4. Calculate breakdown by storage type
        breakdown = self._categorize_by_storage(items, template)

        # 5. Calculate total boxes
        total_boxes = sum(
            max(1, (item["quantity"] + item["pack_size"] - 1) // item["pack_size"])
            for item in items
        )

        # 6. Calculate confidence
        confidence = self._calculate_confidence(
            room_type,
            density_level,
            room_size,
            custom_adjustments
        )

        # 7. Add room size assumptions
        assumptions.insert(0, f"Room size: {room_size.capitalize()} ({size_multiplier}x items)")
        assumptions.insert(1, f"Density level: {density_level.value} ({density_modifier.quantity_multiplier}x density)")
        assumptions.insert(2, f"Combined effect: {size_multiplier * density_modifier.quantity_multiplier:.1f}x baseline")
        assumptions.insert(3, f"Estimated square footage: {self.SIZE_SQFT_RANGES.get(room_size, 'N/A')}")

        return {
            "estimated_items": items,
            "total_boxes": total_boxes,
            "confidence": confidence,
            "breakdown": breakdown,
            "assumptions": assumptions,
            "room_type": room_type.value,
            "density_level": density_level.value,
            "room_size": room_size,
            "size_multiplier": size_multiplier,
            "density_multiplier": density_modifier.quantity_multiplier,
        }

    def _calculate_adjusted_quantity(
        self,
        template_item: TemplateItem,
        density_modifier: DensityModifier,
        size_multiplier: float,
        custom_adjustments: Dict
    ) -> int:
        """Calculate adjusted quantity based on room size, density, and variance"""
        min_qty, max_qty = template_item.variance_range
        base_quantity = template_item.base_quantity

        # Apply size multiplier first
        size_adjusted = base_quantity * size_multiplier

        # Then apply density multiplier
        adjusted = size_adjusted * density_modifier.quantity_multiplier

        # Clamp to variance range (but allow size to extend the range)
        adjusted = max(min_qty * size_multiplier, min(max_qty * size_multiplier, adjusted))

        return round(adjusted)

    def _estimate_storage_contents(
        self,
        multiplier: StorageMultiplier,
        density_level: DensityLevel,
        size_multiplier: float,
        custom_adjustments: Dict
    ) -> tuple[List[Dict], List[str]]:
        """Estimate contents of storage units (cabinets, closets, etc.)"""
        assumptions = []

        # Use custom count if provided, otherwise use base adjusted by size
        storage_count = multiplier.base_count * size_multiplier

        # Check for custom adjustments
        if "cabinet_count" in custom_adjustments and "cabinet" in multiplier.storage_type:
            storage_count = custom_adjustments["cabinet_count"]
            assumptions.append(f"Using {storage_count} cabinets (custom adjustment)")
        elif "closet_count" in custom_adjustments and "closet" in multiplier.storage_type:
            storage_count = custom_adjustments["closet_count"]
            assumptions.append(f"Using {storage_count} closets (custom adjustment)")
        else:
            storage_count = round(storage_count)
            assumptions.append(f"Assuming {storage_count} {multiplier.storage_type} (size-adjusted)")

        density_multiplier_value = multiplier.density_impact[density_level]

        # REDUCED: Apply a very strong reduction factor to prevent overly high quantities
        # Industry feedback: storage estimates were 10-50x too high for kitchens
        # The "quantity" represents packable units, not individual items
        # Kitchen cabinets especially need lower estimates due to efficient packing
        # Example: "30 folded clothes" means 30 items total, which might pack into 3 boxes
        reduction_factor = 0.05  # 95% reduction from original calculation (was 0.12, still too high)

        total_items = round(
            storage_count * multiplier.items_per_unit * density_multiplier_value * reduction_factor
        )

        items = [{
            "category": "Storage Contents",
            "subcategory": f"{multiplier.storage_type.replace('_', ' ').title()} Contents",
            "quantity": max(1, total_items),  # Ensure at least 1 item
            "pack_size": 4,  # default pack size for storage items
            "storage_type": multiplier.storage_type
        }]

        return items, assumptions

    def _create_additional_category_item(
        self,
        category_name: str,
        density_level: DensityLevel,
        size_multiplier: float
    ) -> Dict:
        """Create item for additional category"""
        # Estimate reasonable quantity based on category and density
        base_quantities = {
            "Food Storage Containers": 15,
            "Baking Supplies": 10,
            "Specialty Appliances": 2,
            "Extra Dishes": 12,
            "Collectibles": 20,
            "Books": 30,
            "Electronics": 5,
            "Decorations": 15,
            "Personal Care Items": 12,
            "Storage Bins": 8,
            "Bulk Food Storage": 20,
        }

        density_multipliers = {
            DensityLevel.MINIMAL: 0.3,
            DensityLevel.MODERATE: 1.0,
            DensityLevel.FULL: 1.3,
            DensityLevel.PACKED: 1.7
        }

        base_qty = base_quantities.get(category_name, 10)
        density_multiplier = density_multipliers[density_level]

        # Apply both size and density multipliers
        adjusted_qty = base_qty * size_multiplier * density_multiplier

        return {
            "category": category_name,
            "subcategory": category_name,
            "quantity": round(adjusted_qty),
            "pack_size": 4,
            "storage_type": "additional"
        }

    def _categorize_by_storage(
        self,
        items: List[Dict],
        template: RoomTemplate
    ) -> Dict[str, int]:
        """Categorize items by storage type for breakdown (returns box counts)"""
        breakdown = {
            "visible": 0,
            "cabinet": 0,
            "closet": 0,
            "drawer": 0,
            "additional": 0,
            "shelves": 0
        }

        for item in items:
            storage_type = item.get("storage_type", "visible")

            # Calculate boxes for this item
            boxes = max(1, (item["quantity"] + item["pack_size"] - 1) // item["pack_size"])

            if storage_type in breakdown:
                breakdown[storage_type] += boxes
            else:
                breakdown["visible"] += boxes

        # Remove zero-count entries
        return {k: v for k, v in breakdown.items() if v > 0}

    def _calculate_confidence(
        self,
        room_type: RoomType,
        density_level: DensityLevel,
        room_size: str,
        custom_adjustments: Dict
    ) -> float:
        """Calculate confidence score (0-100) for estimation"""
        confidence = 0.75  # base confidence for templates

        # Higher confidence with custom adjustments
        if custom_adjustments.get("cabinet_count"):
            confidence += 0.1
        if custom_adjustments.get("closet_count"):
            confidence += 0.1

        # Room size confidence factors
        size_confidence_factors = {
            "small": 1.05,   # Small rooms = higher confidence (less variation)
            "medium": 1.0,   # Baseline
            "large": 0.95,   # Large rooms = lower confidence (more variation)
        }
        confidence *= size_confidence_factors.get(room_size, 1.0)

        # Lower confidence for packed density (more variance)
        if density_level == DensityLevel.PACKED:
            confidence -= 0.15
        elif density_level == DensityLevel.MINIMAL:
            confidence -= 0.05

        # Convert to percentage and cap at 95%
        confidence_percentage = min(95, max(50, confidence * 100))

        return confidence_percentage
