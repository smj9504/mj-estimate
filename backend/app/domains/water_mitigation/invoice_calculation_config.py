"""
Water Mitigation Invoice Calculation Configuration

Configurable calculation formulas for auto-generating invoice line item quantities.
This module provides easy-to-modify calculation logic for:
- Debris disposal hours based on weight and location factors
- Equipment monitoring hours based on equipment count and complexity
"""

from decimal import Decimal
from typing import Dict, List, Optional, Tuple
from uuid import UUID


# =============================================================================
# General Conditions Template Configuration
# =============================================================================

# Template ID for General Conditions (line items that appear once per invoice)
GENERAL_CONDITIONS_TEMPLATE_ID = "55c11d41-6ee1-4b26-a181-c5f8b7317ce2"

# Line items from General Conditions that need auto-calculation
GENERAL_CONDITIONS_CALCULABLE_ITEMS = {
    # Matches by line item description (case-insensitive partial match)
    "hand loading disposal": "calculate_debris_disposal_hours",
    "equipment setup": "calculate_equipment_monitoring_hours",
}


# =============================================================================
# Debris Disposal Hours Calculation
# =============================================================================

class DebrisCalculationConfig:
    """Configuration for debris disposal hours calculation"""

    # Crew count - number of workers doing the debris disposal
    # Final hours = calculated_hours × CREW_COUNT (total billable man-hours)
    CREW_COUNT = 3

    # Base time per ton of debris (hours per person)
    BASE_HOURS_PER_TON = 2.0

    # Stairs multiplier (additional time if stairs are involved)
    STAIRS_MULTIPLIER = 1.5  # 50% more time if stairs

    # Minimum hours (even for small debris amounts) - per person
    MIN_HOURS = 0.5

    # Maximum hours cap (to prevent unrealistic values) - total after crew multiplier
    MAX_HOURS = 120.0  # 40 hours × 3 crew

    # Weight thresholds for different hauling complexity
    LIGHT_DEBRIS_TON = 0.5  # Under this is light debris
    HEAVY_DEBRIS_TON = 3.0  # Over this is heavy debris

    # Time adjustments by debris weight category (hours per person per ton)
    LIGHT_DEBRIS_HOURS_PER_TON = 1.5  # Faster for light debris
    HEAVY_DEBRIS_HOURS_PER_TON = 2.5  # Slower for heavy debris


def calculate_debris_disposal_hours(
    total_weight_ton: Decimal,
    location_has_stairs: bool = False,
    location_name: str = "the property"
) -> Tuple[Decimal, str]:
    """
    Calculate debris disposal hours based on weight and location factors.

    Args:
        total_weight_ton: Total debris weight in tons
        location_has_stairs: Whether stairs are involved in hauling
        location_name: Name of the location for note generation

    Returns:
        Tuple of (calculated_hours, note)
    """
    if total_weight_ton <= 0:
        return Decimal("0"), "No debris calculated"

    config = DebrisCalculationConfig

    # Determine hours per ton based on debris weight
    if float(total_weight_ton) < config.LIGHT_DEBRIS_TON:
        hours_per_ton = config.LIGHT_DEBRIS_HOURS_PER_TON
        debris_category = "light"
    elif float(total_weight_ton) > config.HEAVY_DEBRIS_TON:
        hours_per_ton = config.HEAVY_DEBRIS_HOURS_PER_TON
        debris_category = "heavy"
    else:
        hours_per_ton = config.BASE_HOURS_PER_TON
        debris_category = "moderate"

    # Base calculation (per person)
    hours_per_person = float(total_weight_ton) * hours_per_ton

    # Apply stairs multiplier
    stairs_note = ""
    if location_has_stairs:
        hours_per_person *= config.STAIRS_MULTIPLIER
        stairs_note = " (including stairs)"

    # Apply minimum per person
    hours_per_person = max(config.MIN_HOURS, hours_per_person)

    # Multiply by crew count for total billable hours
    crew_count = config.CREW_COUNT
    total_hours = hours_per_person * crew_count

    # Apply max constraint
    total_hours = min(total_hours, config.MAX_HOURS)

    # Round to nearest 0.5 hour for cleaner values
    total_hours = round(total_hours * 2) / 2

    # Generate note
    note = (
        f"Debris hand-loaded & hauled from {location_name} to the driveway"
        f"{stairs_note}. "
        f"Calculated: {float(total_weight_ton):.2f} tons × {hours_per_ton} hrs/ton"
    )
    if location_has_stairs:
        note += f" × {config.STAIRS_MULTIPLIER} (stairs)"
    note += f" × {crew_count} crew = {total_hours:.1f}h"

    return Decimal(str(total_hours)), note


# =============================================================================
# Equipment Monitoring Hours Calculation
# =============================================================================

class EquipmentMonitoringConfig:
    """Configuration for equipment setup/monitoring hours calculation"""

    # Time per equipment item (hours)
    SETUP_TIME_PER_EQUIPMENT = 0.167  # 10 minutes per equipment piece
    TAKEDOWN_TIME_PER_EQUIPMENT = 0.167  # 10 minutes per equipment piece

    # Daily monitoring time
    DAILY_MONITORING_BASE = 0.5  # 30 minutes base daily monitoring
    DAILY_MONITORING_PER_EQUIPMENT = 0.05  # 3 minutes per equipment piece

    # Floor/level multiplier (multi-level jobs take more time)
    MULTI_LEVEL_MULTIPLIER = 1.3  # 30% more time for multi-level jobs

    # Minimum and maximum hours
    MIN_HOURS = 1.0  # Minimum 1 hour even for small jobs
    MAX_HOURS = 80.0  # Maximum cap

    # Equipment type weights (some equipment needs more monitoring)
    EQUIPMENT_WEIGHTS = {
        "air scrubber": 1.5,  # Air scrubbers need more frequent checks
        "dehumidifier": 1.3,  # Dehumidifiers need regular emptying/monitoring
        "air mover": 1.0,  # Standard monitoring
        "fan": 1.0,  # Standard monitoring
    }


def calculate_equipment_monitoring_hours(
    equipment_items: List[Dict],
    mitigation_days: int,
    floor_count: int = 1
) -> Tuple[Decimal, str]:
    """
    Calculate equipment setup, takedown, and monitoring hours.

    Args:
        equipment_items: List of equipment items with 'name' and 'quantity'
        mitigation_days: Number of mitigation days
        floor_count: Number of floors/levels

    Returns:
        Tuple of (calculated_hours, note)
    """
    if not equipment_items or mitigation_days <= 0:
        return Decimal("0"), "No equipment monitoring required"

    config = EquipmentMonitoringConfig

    # Count total equipment with weights
    total_equipment = 0
    weighted_equipment = 0.0
    equipment_breakdown = []

    for item in equipment_items:
        name = item.get("name", "").lower()
        quantity = float(item.get("quantity", 0))

        if quantity > 0:
            # Find equipment weight
            weight = 1.0
            for keyword, eq_weight in config.EQUIPMENT_WEIGHTS.items():
                if keyword in name:
                    weight = eq_weight
                    break

            total_equipment += int(quantity)
            weighted_equipment += quantity * weight
            equipment_breakdown.append(f"{int(quantity)} {item.get('name')}")

    if total_equipment == 0:
        return Decimal("0"), "No equipment found"

    # Calculate setup time
    setup_hours = total_equipment * config.SETUP_TIME_PER_EQUIPMENT

    # Calculate takedown time
    takedown_hours = total_equipment * config.TAKEDOWN_TIME_PER_EQUIPMENT

    # Calculate daily monitoring time
    daily_monitoring = (
        config.DAILY_MONITORING_BASE +
        (weighted_equipment * config.DAILY_MONITORING_PER_EQUIPMENT)
    )
    total_monitoring = daily_monitoring * mitigation_days

    # Total hours
    hours = setup_hours + takedown_hours + total_monitoring

    # Apply multi-level multiplier
    level_multiplier_applied = False
    if floor_count > 1:
        hours *= config.MULTI_LEVEL_MULTIPLIER
        level_multiplier_applied = True

    # Apply min/max constraints
    hours = max(config.MIN_HOURS, min(hours, config.MAX_HOURS))

    # Round to nearest 0.5 hour
    hours = round(hours * 2) / 2

    # Generate concise note (without repeating line item description)
    # Format: "{days} days, {levels} levels. Setup {x}h + Takedown {x}h + Monitoring {x}h (×1.3 multi-level) = {total}h"
    level_info = f", {floor_count} levels" if floor_count > 1 else ""
    multiplier_info = f" (×{config.MULTI_LEVEL_MULTIPLIER} multi-level)" if level_multiplier_applied else ""

    note = (
        f"{mitigation_days} days{level_info}. "
        f"Setup {setup_hours:.1f}h + Takedown {takedown_hours:.1f}h + "
        f"Monitoring {total_monitoring:.1f}h{multiplier_info} = {hours:.1f}h"
    )

    return Decimal(str(hours)), note


# =============================================================================
# Helper Functions
# =============================================================================

def get_calculation_function(line_item_description: str):
    """
    Get the appropriate calculation function for a line item.

    Args:
        line_item_description: Line item description to match

    Returns:
        Calculation function name or None if no match
    """
    description_lower = line_item_description.lower()

    for keyword, func_name in GENERAL_CONDITIONS_CALCULABLE_ITEMS.items():
        if keyword in description_lower:
            return func_name

    return None


def should_include_general_conditions_item(line_item_description: str) -> bool:
    """
    Determine if a General Conditions line item should be included.

    Args:
        line_item_description: Line item description

    Returns:
        True if the item should be included
    """
    # For now, include all items from General Conditions template
    # You can add filtering logic here if needed
    return True


def calculate_general_conditions_quantity(
    line_item_description: str,
    job_data: Dict,
    scope_data: Dict
) -> Tuple[Optional[Decimal], Optional[str]]:
    """
    Calculate quantity for a General Conditions line item.

    Args:
        line_item_description: Line item description
        job_data: Dictionary with job information (mitigation_days, etc.)
        scope_data: Dictionary with scope information (debris, equipment, etc.)

    Returns:
        Tuple of (quantity, note) or (None, None) if no auto-calculation
    """
    func_name = get_calculation_function(line_item_description)

    if not func_name:
        return None, None

    if func_name == "calculate_debris_disposal_hours":
        total_weight_ton = scope_data.get("total_debris_ton", Decimal("0"))
        location_has_stairs = scope_data.get("has_stairs", False)
        location_name = scope_data.get("primary_location", "the property")

        return calculate_debris_disposal_hours(
            total_weight_ton,
            location_has_stairs,
            location_name
        )

    elif func_name == "calculate_equipment_monitoring_hours":
        equipment_items = scope_data.get("equipment_items", [])
        mitigation_days = job_data.get("mitigation_days", 1)
        floor_count = scope_data.get("floor_count", 1)

        return calculate_equipment_monitoring_hours(
            equipment_items,
            mitigation_days,
            floor_count
        )

    return None, None
