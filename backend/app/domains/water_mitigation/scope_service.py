"""
Water Mitigation Scope of Work Service

Business logic layer for scope locations, scope items,
demolition types, and debris calculation.
"""

import re
from decimal import Decimal
from typing import List, Optional, Tuple
from uuid import UUID
from datetime import datetime

from sqlalchemy.orm import Session

from app.domains.water_mitigation.scope_repository import ScopeRepository
from app.domains.water_mitigation.models import (
    WMScopeLocation,
    WMScopeItem,
    WMDemolitionType,
    WMDebrisCalculation,
)
from app.domains.water_mitigation.schemas import (
    ScopeLocationCreate,
    ScopeLocationUpdate,
    ScopeItemCreate,
    ScopeItemUpdate,
    DemolitionTypeCreate,
    DemolitionTypeUpdate,
    STANDARD_SCOPE_ITEMS,
    DebrisItemDetail,
    CategoryBreakdown,
    DumpsterRecommendation,
)


# Moisture multipliers (same as reconstruction_estimate)
MOISTURE_MULTIPLIERS = {
    "dry": Decimal("1.0"),
    "damp": Decimal("1.2"),
    "wet": Decimal("1.5"),
    "saturated": Decimal("2.0"),
}

# Dumpster sizes (weight in tons)
DUMPSTER_SIZES = [
    {"size": "10 yard", "capacity_tons": 2.0},
    {"size": "20 yard", "capacity_tons": 3.0},
    {"size": "30 yard", "capacity_tons": 5.0},
    {"size": "40 yard", "capacity_tons": 7.0},
]


class ScopeService:
    """Service for Scope of Work operations"""

    def __init__(self, db: Session):
        self.db = db
        self.repository = ScopeRepository(db)

    # =========================================================================
    # Demolition Type Operations
    # =========================================================================

    def get_all_demolition_types(
        self,
        active_only: bool = True,
        category: Optional[str] = None
    ) -> List[WMDemolitionType]:
        """Get all demolition types"""
        return self.repository.get_demolition_types(
            active_only=active_only,
            category=category
        )

    def get_demolition_type(
        self, demolition_type_id: UUID
    ) -> Optional[WMDemolitionType]:
        """Get demolition type by ID"""
        return self.repository.get_demolition_type_by_id(demolition_type_id)

    def create_demolition_type(
        self,
        data: DemolitionTypeCreate,
        user_id: Optional[UUID] = None
    ) -> WMDemolitionType:
        """Create a new demolition type"""
        # Check if name already exists
        existing = self.repository.get_demolition_type_by_name(data.name)
        if existing:
            raise ValueError(f"Demolition type '{data.name}' already exists")

        return self.repository.create_demolition_type(
            data.dict(exclude_unset=True),
            user_id
        )

    def update_demolition_type(
        self,
        demolition_type_id: UUID,
        data: DemolitionTypeUpdate,
        user_id: Optional[UUID] = None
    ) -> WMDemolitionType:
        """Update a demolition type"""
        demolition_type = self.repository.get_demolition_type_by_id(
            demolition_type_id
        )
        if not demolition_type:
            raise ValueError("Demolition type not found")

        # Check if new name conflicts with existing
        if data.name and data.name != demolition_type.name:
            existing = self.repository.get_demolition_type_by_name(data.name)
            if existing:
                raise ValueError(f"Demolition type '{data.name}' already exists")

        return self.repository.update_demolition_type(
            demolition_type,
            data.dict(exclude_unset=True),
            user_id
        )

    def delete_demolition_type(
        self, demolition_type_id: UUID
    ) -> bool:
        """Delete (deactivate) a demolition type"""
        demolition_type = self.repository.get_demolition_type_by_id(
            demolition_type_id
        )
        if not demolition_type:
            raise ValueError("Demolition type not found")

        return self.repository.delete_demolition_type(demolition_type)

    # =========================================================================
    # Scope Location Operations
    # =========================================================================

    def get_locations_for_job(
        self,
        job_id: UUID,
        include_items: bool = True
    ) -> List[WMScopeLocation]:
        """Get all scope locations for a job"""
        return self.repository.get_locations_by_job(job_id, include_items)

    def get_location(
        self,
        location_id: UUID,
        include_items: bool = True
    ) -> Optional[WMScopeLocation]:
        """Get scope location by ID"""
        return self.repository.get_location_by_id(location_id, include_items)

    def create_location(
        self, data: ScopeLocationCreate
    ) -> WMScopeLocation:
        """Create a new scope location"""
        # Get next display order if not specified
        if data.display_order == 0:
            data.display_order = self.repository.get_next_location_order(
                data.job_id
            )

        return self.repository.create_location(data.dict())

    def update_location(
        self,
        location_id: UUID,
        data: ScopeLocationUpdate
    ) -> WMScopeLocation:
        """Update a scope location"""
        location = self.repository.get_location_by_id(location_id)
        if not location:
            raise ValueError("Location not found")

        return self.repository.update_location(
            location,
            data.dict(exclude_unset=True)
        )

    def delete_location(self, location_id: UUID) -> bool:
        """Delete a scope location"""
        location = self.repository.get_location_by_id(location_id)
        if not location:
            raise ValueError("Location not found")

        return self.repository.delete_location(location)

    # =========================================================================
    # Scope Item Operations
    # =========================================================================

    def get_items_for_location(
        self, location_id: UUID
    ) -> List[WMScopeItem]:
        """Get all scope items for a location"""
        return self.repository.get_items_by_location(location_id)

    def get_item(self, item_id: UUID) -> Optional[WMScopeItem]:
        """Get scope item by ID"""
        return self.repository.get_item_by_id(item_id)

    def create_item(self, data: ScopeItemCreate) -> WMScopeItem:
        """Create a new scope item"""
        # Validate location exists
        location = self.repository.get_location_by_id(data.location_id)
        if not location:
            raise ValueError("Location not found")

        # Get next display order if not specified
        if data.display_order == 0:
            data.display_order = self.repository.get_next_item_order(
                data.location_id
            )

        # Calculate quantity from formula if provided
        item_data = data.dict()
        if data.quantity_formula:
            calculated = self.calculate_formula(data.quantity_formula)
            if calculated[0]:
                item_data['quantity'] = calculated[1]

        return self.repository.create_item(item_data)

    def update_item(
        self,
        item_id: UUID,
        data: ScopeItemUpdate
    ) -> WMScopeItem:
        """Update a scope item"""
        item = self.repository.get_item_by_id(item_id)
        if not item:
            raise ValueError("Item not found")

        item_data = data.dict(exclude_unset=True)

        # Calculate quantity from formula if provided
        if 'quantity_formula' in item_data and item_data['quantity_formula']:
            calculated = self.calculate_formula(item_data['quantity_formula'])
            if calculated[0]:
                item_data['quantity'] = calculated[1]

        return self.repository.update_item(item, item_data)

    def delete_item(self, item_id: UUID) -> bool:
        """Delete a scope item"""
        item = self.repository.get_item_by_id(item_id)
        if not item:
            raise ValueError("Item not found")

        return self.repository.delete_item(item)

    def add_standard_items_to_location(
        self,
        location_id: UUID,
        include_items: Optional[List[str]] = None
    ) -> List[WMScopeItem]:
        """Add standard scope items to a location"""
        location = self.repository.get_location_by_id(location_id)
        if not location:
            raise ValueError("Location not found")

        items_to_add = STANDARD_SCOPE_ITEMS
        if include_items:
            items_to_add = [
                item for item in STANDARD_SCOPE_ITEMS
                if item['name'] in include_items
            ]

        current_order = self.repository.get_next_item_order(location_id)
        items_data = []

        for i, item in enumerate(items_to_add):
            items_data.append({
                'location_id': location_id,
                'item_type': item['item_type'],
                'name': item['name'],
                'unit': item['unit'],
                'display_order': current_order + i,
                'include_in_debris': False,  # Standard items don't contribute to debris
            })

        return self.repository.create_items_bulk(items_data)

    # =========================================================================
    # Formula Calculation
    # =========================================================================

    def calculate_formula(
        self, formula: str
    ) -> Tuple[bool, Optional[float], Optional[str]]:
        """
        Safely calculate a mathematical formula.

        Supports: +, -, *, /, parentheses, and decimal numbers.
        Returns: (success, result, error_message)
        """
        if not formula or not formula.strip():
            return False, None, "Empty formula"

        # Clean the formula
        formula = formula.strip()

        # Only allow safe characters: digits, operators, parentheses, decimal, spaces
        if not re.match(r'^[\d\s\+\-\*\/\(\)\.]+$', formula):
            return False, None, "Invalid characters in formula"

        try:
            # Evaluate the expression safely
            result = eval(formula, {"__builtins__": {}}, {})

            if not isinstance(result, (int, float)):
                return False, None, "Invalid formula result"

            if result < 0:
                return False, None, "Result cannot be negative"

            return True, float(result), None

        except ZeroDivisionError:
            return False, None, "Division by zero"
        except SyntaxError:
            return False, None, "Invalid formula syntax"
        except Exception as e:
            return False, None, f"Calculation error: {str(e)}"

    # =========================================================================
    # Debris Calculation
    # =========================================================================

    def calculate_debris_for_job(
        self,
        job_id: UUID,
        save_result: bool = True,
        user_id: Optional[UUID] = None
    ) -> Tuple[dict, List[str]]:
        """
        Calculate debris weight for all demolition items in a job.

        Returns: (calculation_data, warnings)
        """
        warnings = []
        item_details = []
        category_totals = {}
        total_weight_lb = Decimal("0")

        # Get all demolition items for the job
        items = self.repository.get_demolition_items_for_job(job_id)

        if not items:
            warnings.append("No demolition items found for debris calculation")

        for item in items:
            if not item.quantity or item.quantity <= 0:
                warnings.append(
                    f"Item '{item.name}' has no quantity, skipped"
                )
                continue

            # Get material weight info
            material = None
            dry_weight = None
            category_name = "Uncategorized"

            if item.demolition_type and item.demolition_type.material_weight_id:
                material = self.repository.get_material_weight_by_id(
                    item.demolition_type.material_weight_id
                )

            if material:
                dry_weight = Decimal(str(material.dry_weight_per_unit))
                if material.category:
                    category_name = material.category.category_name
            else:
                # No material mapping - warn but continue with 0 weight
                warnings.append(
                    f"Item '{item.name}' has no material weight mapping, "
                    "weight set to 0"
                )
                dry_weight = Decimal("0")

            # Calculate weight
            moisture_mult = MOISTURE_MULTIPLIERS.get(
                item.moisture_level, Decimal("1.0")
            )
            quantity = Decimal(str(item.quantity))

            weight_lb = quantity * dry_weight * moisture_mult
            weight_ton = weight_lb / Decimal("2000")

            total_weight_lb += weight_lb

            # Track category totals
            if category_name not in category_totals:
                category_totals[category_name] = {
                    "weight_lb": Decimal("0"),
                    "weight_ton": Decimal("0"),
                    "item_count": 0
                }

            category_totals[category_name]["weight_lb"] += weight_lb
            category_totals[category_name]["weight_ton"] += weight_ton
            category_totals[category_name]["item_count"] += 1

            # Store item detail
            item_details.append({
                "item_id": str(item.id),
                "item_name": item.name,
                "demolition_type_name": (
                    item.demolition_type.name if item.demolition_type else None
                ),
                "material_type": (
                    material.material_type if material else None
                ),
                "quantity": float(item.quantity),
                "unit": item.unit,
                "moisture_level": item.moisture_level,
                "dry_weight_per_unit": float(dry_weight) if dry_weight else None,
                "moisture_multiplier": float(moisture_mult),
                "weight_lb": float(weight_lb),
                "weight_ton": float(weight_ton),
            })

        # Calculate total weight in tons
        total_weight_ton = total_weight_lb / Decimal("2000")

        # Generate dumpster recommendation
        dumpster_rec = self._recommend_dumpster(float(total_weight_ton))

        # Prepare category breakdown
        category_breakdown = [
            CategoryBreakdown(
                category_name=name,
                weight_lb=float(data["weight_lb"]),
                weight_ton=float(data["weight_ton"]),
                item_count=data["item_count"]
            ).dict()
            for name, data in category_totals.items()
        ]

        calculation_data = {
            "total_weight_lb": float(total_weight_lb),
            "total_weight_ton": float(total_weight_ton),
            "category_breakdown": category_breakdown,
            "dumpster_recommendation": dumpster_rec,
            "item_details": item_details,
            "calculated_at": datetime.utcnow(),
        }

        # Save to database if requested
        if save_result:
            self.repository.create_or_update_debris_calculation(
                job_id=job_id,
                data=calculation_data,
                user_id=user_id
            )
            self.db.commit()

        return calculation_data, warnings

    def _recommend_dumpster(self, total_weight_tons: float) -> Optional[dict]:
        """Recommend dumpster size based on total weight"""
        if total_weight_tons <= 0:
            return None

        # Find the best dumpster size
        for dumpster in DUMPSTER_SIZES:
            if total_weight_tons <= dumpster["capacity_tons"]:
                return DumpsterRecommendation(
                    size=dumpster["size"],
                    capacity_tons=dumpster["capacity_tons"],
                    count=1,
                    total_capacity_tons=dumpster["capacity_tons"]
                ).dict()

        # If weight exceeds largest dumpster, calculate multiple loads
        largest = DUMPSTER_SIZES[-1]
        count = int(total_weight_tons / largest["capacity_tons"]) + 1

        return DumpsterRecommendation(
            size=largest["size"],
            capacity_tons=largest["capacity_tons"],
            count=count,
            total_capacity_tons=largest["capacity_tons"] * count
        ).dict()

    def get_debris_calculation(
        self, job_id: UUID
    ) -> Optional[WMDebrisCalculation]:
        """Get saved debris calculation for a job"""
        return self.repository.get_debris_calculation_by_job(job_id)

    # =========================================================================
    # Helper: Seed Default Demolition Types
    # =========================================================================

    def seed_default_demolition_types(
        self, user_id: Optional[UUID] = None
    ) -> List[WMDemolitionType]:
        """Seed default demolition types"""
        default_types = [
            # Flooring
            {"name": "Carpet", "category": "Flooring", "default_unit": "SF"},
            {"name": "Carpet Pad", "category": "Flooring", "default_unit": "SF"},
            {"name": "Laminate Floor", "category": "Flooring", "default_unit": "SF"},
            {"name": "Hardwood Floor", "category": "Flooring", "default_unit": "SF"},
            {
                "name": "Glue-Down Hardwood Floor",
                "category": "Flooring",
                "default_unit": "SF"
            },
            {"name": "Tile", "category": "Flooring", "default_unit": "SF"},
            {"name": "Vinyl Floor", "category": "Flooring", "default_unit": "SF"},
            {"name": "Vinyl Plank", "category": "Flooring", "default_unit": "SF"},
            # Drywall
            {"name": "Drywall", "category": "Wall", "default_unit": "SF"},
            {
                "name": "Drywall 2ft from Floor",
                "category": "Wall",
                "default_unit": "LF"
            },
            {
                "name": "Drywall 4ft from Floor",
                "category": "Wall",
                "default_unit": "LF"
            },
            {"name": "Wood Panel", "category": "Wall", "default_unit": "SF"},
            # Insulation
            {"name": "Insulation", "category": "Insulation", "default_unit": "SF"},
            {
                "name": "Wall Insulation",
                "category": "Insulation",
                "default_unit": "SF"
            },
            # Trim
            {"name": "Baseboard", "category": "Trim", "default_unit": "LF"},
            {"name": "Door Trim", "category": "Trim", "default_unit": "LF"},
            {"name": "Window Trim", "category": "Trim", "default_unit": "LF"},
            {"name": "Crown Molding", "category": "Trim", "default_unit": "LF"},
            # Cabinets/Fixtures
            {"name": "Base Cabinet", "category": "Cabinets", "default_unit": "LF"},
            {"name": "Upper Cabinet", "category": "Cabinets", "default_unit": "LF"},
            {"name": "Vanity", "category": "Cabinets", "default_unit": "EA"},
        ]

        created = []
        for type_data in default_types:
            existing = self.repository.get_demolition_type_by_name(
                type_data["name"]
            )
            if not existing:
                demo_type = self.repository.create_demolition_type(
                    type_data, user_id
                )
                created.append(demo_type)

        if created:
            self.db.commit()

        return created
