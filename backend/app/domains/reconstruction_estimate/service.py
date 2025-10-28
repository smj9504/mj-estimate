"""
Reconstruction Estimate service layer
"""

from typing import List, Optional, Dict, Tuple
from decimal import Decimal
from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from .models import MaterialCategory, MaterialWeight, DebrisCalculation, DebrisItem, MoistureLevel, UnitType
from .repository import (
    MaterialCategoryRepository,
    MaterialWeightRepository,
    DebrisCalculationRepository,
    DebrisItemRepository
)
from .schemas import (
    MaterialCategoryCreate, MaterialCategoryUpdate,
    MaterialWeightCreate, MaterialWeightUpdate,
    DebrisCalculationInput, DebrisCalculationCreate, DebrisCalculationUpdate,
    DebrisItemInput, DebrisItemResponse,
    DebrisCalculationResult, DumpsterRecommendation, CategoryBreakdown
)


# Constants
LBS_PER_TON = Decimal('2000')


class MaterialCategoryService:
    """Service for material category management"""

    def __init__(self, db: Session):
        self.db = db
        self.repo = MaterialCategoryRepository(db)

    def get_all_active(self) -> List[MaterialCategory]:
        """Get all active categories"""
        return self.repo.get_active_categories()

    def get_by_id(self, category_id: str) -> MaterialCategory:
        """Get category by ID"""
        category = self.repo.get(category_id)
        if not category:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Category not found"
            )
        return category

    def create(self, data: MaterialCategoryCreate, user_id: str) -> MaterialCategory:
        """Create new category"""
        # Check for duplicate name
        existing = self.repo.get_by_name(data.category_name)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Category with this name already exists"
            )

        category = MaterialCategory(**data.model_dump())
        return self.repo.create(category)

    def update(self, category_id: str, data: MaterialCategoryUpdate, user_id: str) -> MaterialCategory:
        """Update category"""
        category = self.get_by_id(category_id)

        # Check for name conflicts if name is being changed
        if data.category_name and data.category_name != category.category_name:
            existing = self.repo.get_by_name(data.category_name)
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Category with this name already exists"
                )

        update_data = data.model_dump(exclude_unset=True)
        return self.repo.update(category_id, update_data)

    def delete(self, category_id: str) -> bool:
        """Delete category (soft delete by setting active=False)"""
        category = self.get_by_id(category_id)
        return self.repo.update(category_id, {"active": False})


class MaterialWeightService:
    """Service for material weight management"""

    def __init__(self, db: Session):
        self.db = db
        self.repo = MaterialWeightRepository(db)
        self.category_repo = MaterialCategoryRepository(db)

    def get_all(
        self,
        category_id: Optional[str] = None,
        active_only: bool = True,
        search: Optional[str] = None
    ) -> List[MaterialWeight]:
        """Get all materials with filters"""
        return self.repo.get_all_with_category(category_id, active_only, search)

    def get_by_id(self, material_id: str) -> MaterialWeight:
        """Get material by ID"""
        material = self.repo.get(material_id)
        if not material:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Material not found"
            )
        return material

    def create(self, data: MaterialWeightCreate, user_id: str) -> MaterialWeight:
        """Create new material"""
        # Verify category exists
        category = self.category_repo.get(data.category_id)
        if not category:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Category not found"
            )

        # Check for duplicate material type
        existing = self.repo.get_by_material_type(data.material_type)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Material with this type already exists"
            )

        material = MaterialWeight(**data.model_dump(), created_by_id=user_id)
        return self.repo.create(material)

    def update(self, material_id: str, data: MaterialWeightUpdate, user_id: str) -> MaterialWeight:
        """Update material"""
        material = self.get_by_id(material_id)

        # Check for name conflicts if material_type is being changed
        if data.material_type and data.material_type != material.material_type:
            existing = self.repo.get_by_material_type(data.material_type)
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Material with this type already exists"
                )

        # Verify category if being changed
        if data.category_id:
            category = self.category_repo.get(data.category_id)
            if not category:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Category not found"
                )

        update_data = data.model_dump(exclude_unset=True)
        update_data['updated_by_id'] = user_id
        return self.repo.update(material_id, update_data)

    def delete(self, material_id: str, user_id: str) -> bool:
        """Delete material (soft delete by setting active=False)"""
        material = self.get_by_id(material_id)
        return self.repo.update(material_id, {"active": False, "updated_by_id": user_id})

    def bulk_import(self, materials: List[MaterialWeightCreate], user_id: str) -> List[MaterialWeight]:
        """Bulk import materials"""
        material_objects = []
        for material_data in materials:
            # Verify category exists
            category = self.category_repo.get(material_data.category_id)
            if not category:
                continue  # Skip invalid categories

            # Skip duplicates
            existing = self.repo.get_by_material_type(material_data.material_type)
            if existing:
                continue

            material = MaterialWeight(**material_data.model_dump(), created_by_id=user_id)
            material_objects.append(material)

        return self.repo.bulk_create(material_objects)


class DebrisCalculationService:
    """Service for debris calculation"""

    def __init__(self, db: Session):
        self.db = db
        self.calc_repo = DebrisCalculationRepository(db)
        self.item_repo = DebrisItemRepository(db)
        self.material_repo = MaterialWeightRepository(db)

    def calculate_quick(self, items: List[DebrisItemInput]) -> DebrisCalculationResult:
        """Quick calculation without saving"""
        calculated_items = []
        category_totals = {}  # {category_name: weight_in_tons}
        total_weight_lb = Decimal('0')

        for item_input in items:
            # Get material
            material = self.material_repo.get(item_input.material_id)
            if not material:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Material not found: {item_input.material_id}"
                )

            # Calculate item
            item_result = self._calculate_item(item_input, material)
            calculated_items.append(item_result)

            # Add to totals
            total_weight_lb += item_result.total_weight_lb

            # Category breakdown
            category_name = material.category.category_name
            if category_name not in category_totals:
                category_totals[category_name] = {
                    'weight_ton': Decimal('0'),
                    'weight_lb': Decimal('0'),
                    'count': 0
                }
            category_totals[category_name]['weight_ton'] += item_result.total_weight_ton
            category_totals[category_name]['weight_lb'] += item_result.total_weight_lb
            category_totals[category_name]['count'] += 1

        total_weight_ton = total_weight_lb / LBS_PER_TON

        # Build category breakdown
        category_breakdown = []
        for cat_name, cat_data in category_totals.items():
            percentage = (cat_data['weight_ton'] / total_weight_ton * 100) if total_weight_ton > 0 else Decimal('0')
            category_breakdown.append(CategoryBreakdown(
                category_name=cat_name,
                weight_lb=cat_data['weight_lb'],
                weight_ton=cat_data['weight_ton'],
                item_count=cat_data['count'],
                percentage=percentage.quantize(Decimal('0.01'))
            ))

        # Sort by weight descending
        category_breakdown.sort(key=lambda x: x.weight_ton, reverse=True)

        # Dumpster recommendation
        dumpster = self._estimate_dumpster_size(total_weight_ton)

        return DebrisCalculationResult(
            items=calculated_items,
            total_weight_lb=total_weight_lb,
            total_weight_ton=total_weight_ton,
            category_breakdown=category_breakdown,
            dumpster_recommendation=dumpster
        )

    def create_calculation(
        self,
        data: DebrisCalculationCreate,
        user_id: str
    ) -> DebrisCalculation:
        """Save a debris calculation"""
        # Calculate first
        result = self.calculate_quick(data.items)

        # Create calculation record
        calc_data = {
            'calculation_name': data.calculation_name,
            'project_address': data.project_address,
            'notes': data.notes,
            'total_weight_lb': result.total_weight_lb,
            'total_weight_ton': result.total_weight_ton,
            'category_breakdown': {cb.category_name: float(cb.weight_ton) for cb in result.category_breakdown},
            'dumpster_recommendation': result.dumpster_recommendation.model_dump(),
            'created_by_id': user_id
        }

        calculation = DebrisCalculation(**calc_data)
        calculation = self.calc_repo.create(calculation)

        # Create debris items
        item_objects = []
        for item_result in result.items:
            item = DebrisItem(
                calculation_id=calculation.id,
                material_id=item_result.material_id,
                material_type=item_result.material_type,
                quantity=item_result.quantity,
                unit=UnitType[item_result.unit.value],
                moisture_level=MoistureLevel[item_result.moisture_level.value.upper()],
                unit_weight_lb=item_result.unit_weight_lb,
                moisture_multiplier=item_result.moisture_multiplier,
                total_weight_lb=item_result.total_weight_lb,
                total_weight_ton=item_result.total_weight_ton,
                description=item_result.description
            )
            item_objects.append(item)

        self.item_repo.bulk_create(item_objects)

        # Reload with items
        return self.calc_repo.get_with_items(calculation.id)

    def get_user_calculations(
        self,
        user_id: str,
        limit: int = 50,
        offset: int = 0
    ) -> Tuple[List[DebrisCalculation], int]:
        """Get user's saved calculations"""
        return self.calc_repo.get_by_user(user_id, limit, offset)

    def get_calculation(self, calculation_id: str, user_id: str) -> DebrisCalculation:
        """Get calculation by ID"""
        calculation = self.calc_repo.get_with_items(calculation_id)
        if not calculation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Calculation not found"
            )

        # Verify ownership
        if calculation.created_by_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to access this calculation"
            )

        return calculation

    def update_calculation(
        self,
        calculation_id: str,
        data: DebrisCalculationUpdate,
        user_id: str
    ) -> DebrisCalculation:
        """Update a saved calculation"""
        calculation = self.get_calculation(calculation_id, user_id)

        # If items are being updated, recalculate
        if data.items:
            result = self.calculate_quick(data.items)

            # Delete old items
            self.item_repo.delete_by_calculation(calculation_id)

            # Create new items
            item_objects = []
            for item_result in result.items:
                item = DebrisItem(
                    calculation_id=calculation.id,
                    material_id=item_result.material_id,
                    material_type=item_result.material_type,
                    quantity=item_result.quantity,
                    unit=UnitType[item_result.unit.value],
                    moisture_level=MoistureLevel[item_result.moisture_level.value.upper()],
                    unit_weight_lb=item_result.unit_weight_lb,
                    moisture_multiplier=item_result.moisture_multiplier,
                    total_weight_lb=item_result.total_weight_lb,
                    total_weight_ton=item_result.total_weight_ton,
                    description=item_result.description
                )
                item_objects.append(item)

            self.item_repo.bulk_create(item_objects)

            # Update calculation totals
            update_data = {
                'total_weight_lb': result.total_weight_lb,
                'total_weight_ton': result.total_weight_ton,
                'category_breakdown': {cb.category_name: float(cb.weight_ton) for cb in result.category_breakdown},
                'dumpster_recommendation': result.dumpster_recommendation.model_dump(),
                'updated_by_id': user_id
            }
        else:
            update_data = {'updated_by_id': user_id}

        # Update metadata if provided
        if data.calculation_name is not None:
            update_data['calculation_name'] = data.calculation_name
        if data.project_address is not None:
            update_data['project_address'] = data.project_address
        if data.notes is not None:
            update_data['notes'] = data.notes

        self.calc_repo.update(calculation_id, update_data)
        return self.calc_repo.get_with_items(calculation_id)

    def delete_calculation(self, calculation_id: str, user_id: str) -> bool:
        """Delete a calculation"""
        calculation = self.get_calculation(calculation_id, user_id)
        return self.calc_repo.delete(calculation_id)

    def _calculate_item(self, item_input: DebrisItemInput, material: MaterialWeight) -> DebrisItemResponse:
        """Calculate a single debris item"""
        # Get moisture multiplier
        moisture_multipliers = {
            'dry': Decimal('1.0'),
            'damp': material.damp_multiplier,
            'wet': material.wet_multiplier,
            'saturated': material.saturated_multiplier
        }
        moisture_multiplier = moisture_multipliers[item_input.moisture_level.value]

        # Calculate weights
        unit_weight_lb = material.dry_weight_per_unit
        total_weight_lb = item_input.quantity * unit_weight_lb * moisture_multiplier
        total_weight_ton = total_weight_lb / LBS_PER_TON

        return DebrisItemResponse(
            material_id=str(material.id),
            material_type=material.material_type,
            quantity=item_input.quantity,
            unit=material.unit,
            moisture_level=item_input.moisture_level,
            unit_weight_lb=unit_weight_lb,
            moisture_multiplier=moisture_multiplier,
            total_weight_lb=total_weight_lb,
            total_weight_ton=total_weight_ton,
            description=item_input.description
        )

    def _estimate_dumpster_size(self, total_weight_ton: Decimal) -> DumpsterRecommendation:
        """Estimate required dumpster size"""
        # Common dumpster sizes and capacities
        dumpster_sizes = [
            {'size': '10 yard', 'capacity_ton': Decimal('2'), 'capacity_lb': Decimal('4000')},
            {'size': '20 yard', 'capacity_ton': Decimal('3'), 'capacity_lb': Decimal('6000')},
            {'size': '30 yard', 'capacity_ton': Decimal('5'), 'capacity_lb': Decimal('10000')},
            {'size': '40 yard', 'capacity_ton': Decimal('7'), 'capacity_lb': Decimal('14000')},
        ]

        # Find suitable dumpster
        for dumpster in dumpster_sizes:
            if total_weight_ton <= dumpster['capacity_ton']:
                return DumpsterRecommendation(
                    size=dumpster['size'],
                    capacity_ton=dumpster['capacity_ton'],
                    capacity_lb=dumpster['capacity_lb'],
                    multiple_loads=False,
                    load_count=1
                )

        # Need multiple dumpsters
        count = int((total_weight_ton / Decimal('7')).to_integral_value()) + 1
        return DumpsterRecommendation(
            size=f"{count} x 40 yard",
            capacity_ton=Decimal('7') * count,
            capacity_lb=Decimal('14000') * count,
            multiple_loads=True,
            load_count=count
        )
