"""
Labor calculator for packout operations based on industry standards.
"""
import math
from typing import List, Dict, Any
from dataclasses import dataclass

from app.domains.packout.schemas import (
    DetectedItem, ItemSize, FragilityLevel,
    LaborRequirement, XactimateCategory
)


@dataclass
class LaborRate:
    """Labor rate specification"""
    code: str
    description: str
    hourly_rate: float
    category: XactimateCategory


class LaborCalculator:
    """Calculator for labor requirements based on industry standards"""

    # Industry standard labor rates (from Xactimate)
    LABOR_RATES = {
        "CONLAB": LaborRate("CONLAB", "Content Manipulation Labor", 55.74, XactimateCategory.CON),
        "CPSLABS": LaborRate("CPSLABS", "Content Processing Labor - Supervisor", 65.00, XactimateCategory.CPS),
        "CPSLAB": LaborRate("CPSLAB", "Content Processing Labor - Standard", 45.00, XactimateCategory.CPS),
    }

    # Industry standard time estimates (in minutes per item)
    # ADJUSTED: Reduced by ~40% based on real-world professional crew efficiency
    PACKING_TIME = {
        # Base times by size (reduced from previous estimates)
        ItemSize.SMALL: {
            FragilityLevel.FRAGILE: 1.8,   # was 3.0
            FragilityLevel.NORMAL: 0.9,    # was 1.5
            FragilityLevel.DURABLE: 0.6,   # was 1.0
        },
        ItemSize.MEDIUM: {
            FragilityLevel.FRAGILE: 3.0,   # was 5.0
            FragilityLevel.NORMAL: 1.8,    # was 3.0
            FragilityLevel.DURABLE: 1.2,   # was 2.0
        },
        ItemSize.LARGE: {
            FragilityLevel.FRAGILE: 4.8,   # was 8.0
            FragilityLevel.NORMAL: 3.0,    # was 5.0
            FragilityLevel.DURABLE: 1.8,   # was 3.0
        },
        ItemSize.OVERSIZED: {
            FragilityLevel.FRAGILE: 9.0,   # was 15.0
            FragilityLevel.NORMAL: 6.0,    # was 10.0
            FragilityLevel.DURABLE: 4.2,   # was 7.0
        }
    }

    # Inventory/documentation time (minutes per item)
    # ADJUSTED: Reduced by ~50% - documentation is often batched and parallel
    INVENTORY_TIME = {
        ItemSize.SMALL: 0.25,     # was 0.5
        ItemSize.MEDIUM: 0.4,     # was 0.75
        ItemSize.LARGE: 0.5,      # was 1.0
        ItemSize.OVERSIZED: 0.75, # was 1.5
    }

    # Moving/loading time factors
    MOVING_TIME_FACTOR = 0.3  # 30% of packing time for moving items
    LOADING_TIME_PER_BOX = 1.0  # Minutes per box for loading

    # Efficiency factors
    CREW_EFFICIENCY_FACTOR = 0.85  # 85% efficiency for continuous work
    SUPERVISION_RATIO = 0.10  # 10% supervision time of total labor

    def __init__(self):
        self.total_packing_time = 0
        self.total_inventory_time = 0
        self.total_moving_time = 0

    def calculate_labor(
        self,
        items: List[DetectedItem],
        total_boxes: int,
        crew_size: int = 2
    ) -> List[LaborRequirement]:
        """
        Calculate labor requirements for packout operation.

        Args:
            items: List of detected items
            total_boxes: Total number of boxes to be packed
            crew_size: Number of workers (default 2)

        Returns:
            List of labor requirements
        """
        requirements = []

        # Calculate packing time
        packing_minutes = self._calculate_packing_time(items)
        packing_hours = (packing_minutes / 60) / self.CREW_EFFICIENCY_FACTOR

        # Calculate inventory time
        inventory_minutes = self._calculate_inventory_time(items)
        inventory_hours = inventory_minutes / 60

        # Calculate moving time
        moving_minutes = self._calculate_moving_time(items, total_boxes)
        moving_hours = (moving_minutes / 60) / self.CREW_EFFICIENCY_FACTOR

        # Calculate supervision time
        total_labor_hours = packing_hours + inventory_hours + moving_hours
        supervision_hours = total_labor_hours * self.SUPERVISION_RATIO

        # Create labor requirements
        if packing_hours > 0:
            requirements.append(LaborRequirement(
                labor_type="Packing",
                xactimate_code="CONLAB",
                description="Content Manipulation Labor - Packing",
                hours_required=round(packing_hours, 2),
                workers_needed=crew_size,
                notes=f"Packing {sum(item.quantity for item in items)} items into {total_boxes} boxes"
            ))

        if inventory_hours > 0:
            requirements.append(LaborRequirement(
                labor_type="Inventory",
                xactimate_code="CPSLAB",
                description="Content Processing Labor - Inventory",
                hours_required=round(inventory_hours, 2),
                workers_needed=1,
                notes=f"Documenting and photographing {sum(item.quantity for item in items)} items"
            ))

        if moving_hours > 0:
            requirements.append(LaborRequirement(
                labor_type="Moving",
                xactimate_code="CONLAB",
                description="Content Manipulation Labor - Moving/Loading",
                hours_required=round(moving_hours, 2),
                workers_needed=crew_size,
                notes=f"Moving and loading {total_boxes} boxes"
            ))

        if supervision_hours > 0:
            requirements.append(LaborRequirement(
                labor_type="Supervision",
                xactimate_code="CPSLABS",
                description="Content Processing Labor - Supervision",
                hours_required=round(supervision_hours, 2),
                workers_needed=1,
                notes="Project supervision and quality control"
            ))

        return requirements

    def _calculate_packing_time(self, items: List[DetectedItem]) -> float:
        """Calculate total packing time in minutes"""
        total_minutes = 0

        for item in items:
            # Get base time
            base_time = self.PACKING_TIME.get(item.size, {}).get(
                item.fragility, 3.0
            )

            # Apply modifiers
            time_per_item = base_time

            # Special handling modifier
            if item.requires_special_handling:
                time_per_item *= 1.5

            # Category-specific modifiers
            if "electronics" in item.category.lower():
                time_per_item *= 1.3  # Extra care for electronics
            elif "artwork" in item.category.lower() or "antique" in item.category.lower():
                time_per_item *= 1.5  # Extra care for valuables
            elif "books" in item.category.lower():
                time_per_item *= 0.7  # Books pack quickly

            total_minutes += time_per_item * item.quantity

        return total_minutes

    def _calculate_inventory_time(self, items: List[DetectedItem]) -> float:
        """Calculate total inventory/documentation time in minutes"""
        total_minutes = 0

        for item in items:
            base_time = self.INVENTORY_TIME.get(item.size, 0.75)

            # High-value items need more documentation
            if item.fragility == FragilityLevel.FRAGILE or item.requires_special_handling:
                base_time *= 1.5

            total_minutes += base_time * item.quantity

        return total_minutes

    def _calculate_moving_time(
        self,
        items: List[DetectedItem],
        total_boxes: int
    ) -> float:
        """Calculate moving/loading time in minutes"""
        # Time to move items to staging area
        item_moving_time = sum(
            self.PACKING_TIME.get(item.size, {}).get(item.fragility, 3.0) *
            self.MOVING_TIME_FACTOR * item.quantity
            for item in items
        )

        # Time to load boxes
        loading_time = total_boxes * self.LOADING_TIME_PER_BOX

        return item_moving_time + loading_time

    def calculate_labor_summary(
        self,
        requirements: List[LaborRequirement]
    ) -> Dict[str, float]:
        """Create a summary of labor requirements"""
        summary = {
            "total_hours": 0,
            "packing_hours": 0,
            "inventory_hours": 0,
            "moving_hours": 0,
            "supervision_hours": 0,
            "total_workers_needed": 0,
            "estimated_duration_hours": 0
        }

        max_workers = 0
        for req in requirements:
            summary["total_hours"] += req.hours_required

            if req.labor_type == "Packing":
                summary["packing_hours"] = req.hours_required
                max_workers = max(max_workers, req.workers_needed)
            elif req.labor_type == "Inventory":
                summary["inventory_hours"] = req.hours_required
            elif req.labor_type == "Moving":
                summary["moving_hours"] = req.hours_required
                max_workers = max(max_workers, req.workers_needed)
            elif req.labor_type == "Supervision":
                summary["supervision_hours"] = req.hours_required

        summary["total_workers_needed"] = max_workers + 1  # +1 for supervisor
        summary["estimated_duration_hours"] = round(
            summary["total_hours"] / max_workers if max_workers > 0 else summary["total_hours"],
            2
        )

        return summary

    def optimize_crew_size(
        self,
        items: List[DetectedItem],
        target_hours: float = 8.0
    ) -> int:
        """
        Determine optimal crew size to complete job within target hours.

        Args:
            items: List of items to pack
            target_hours: Target completion time (default 8 hours)

        Returns:
            Optimal crew size
        """
        # Calculate base time needed
        total_minutes = self._calculate_packing_time(items) + self._calculate_inventory_time(items)
        total_hours = (total_minutes / 60) / self.CREW_EFFICIENCY_FACTOR

        # Calculate crew size needed
        crew_size = math.ceil(total_hours / target_hours)

        # Apply practical limits
        crew_size = max(1, min(crew_size, 6))  # Between 1 and 6 workers

        return crew_size

    def calculate_complexity_factor(self, items: List[DetectedItem]) -> float:
        """
        Calculate job complexity factor for pricing adjustments.

        Returns:
            Complexity factor (1.0 = normal, >1.0 = complex)
        """
        complexity = 1.0

        # Count special handling items
        special_items = sum(1 for item in items if item.requires_special_handling)
        if special_items > 10:
            complexity *= 1.2

        # Count fragile items
        fragile_items = sum(
            item.quantity for item in items
            if item.fragility == FragilityLevel.FRAGILE
        )
        total_items = sum(item.quantity for item in items)

        if total_items > 0:
            fragile_ratio = fragile_items / total_items
            if fragile_ratio > 0.3:
                complexity *= 1.1
            if fragile_ratio > 0.5:
                complexity *= 1.2

        # Count oversized items
        oversized_items = sum(
            item.quantity for item in items
            if item.size == ItemSize.OVERSIZED
        )
        if oversized_items > 5:
            complexity *= 1.15

        return round(complexity, 2)