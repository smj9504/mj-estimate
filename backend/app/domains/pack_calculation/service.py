"""
Pack Calculation Service
Main business logic orchestration
"""

from sqlalchemy.orm import Session
import math
import logging
from typing import Dict, List, Optional, Any
from uuid import UUID
from datetime import datetime
import csv
import os
from pathlib import Path
from difflib import SequenceMatcher

from .models import PackCalculation, PackRoom, PackItem
from .intelligent_matcher import IntelligentItemMatcher
from .contents_estimator import ContentsEstimator
from .schemas import (
    PackCalculationRequest,
    PackCalculationResult,
    PackCalculationDetailResponse,
    CorrectionInput,
    XactimateLineItem,
    DebrisBreakdown,
    StrategiesUsed,
    PackRoomResponse,
    PackItemResponse,
    RoomBreakdown,
)
from .repository import (
    PackCalculationRepository,
    PackRoomRepository,
    PackItemRepository,
    ItemMaterialMappingRepository,
)
from .seed_item_mappings import (
    ITEM_MAPPINGS,
    FLOOR_MULTIPLIERS,
    PROTECTION_FACTORS,
    DEBRIS_FACTORS,
    XACTIMATE_LINE_ITEMS  # Import comprehensive line items from seed data
)


class PackCalculationService:
    """Service for pack-in/out calculations"""

    def __init__(self, db: Session):
        self.logger = logging.getLogger(__name__)
        self.db = db
        self.calc_repo = PackCalculationRepository(db)
        self.room_repo = PackRoomRepository(db)
        self.item_repo = PackItemRepository(db)
        self.mapping_repo = ItemMaterialMappingRepository(db)
        self.fuzzy_matching_used = False  # Track if fuzzy matching was used
        self.fuzzy_matches = []  # Track fuzzy match details: [{original, matched, materials}]
        self.contents_estimations = []  # Track contents estimation details

        # Initialize intelligent matcher
        self.intelligent_matcher = IntelligentItemMatcher(ITEM_MAPPINGS)

    def calculate(
        self,
        request: PackCalculationRequest,
        user_id: UUID
    ) -> PackCalculationResult:
        """
        Main calculation flow
        1. Parse input (text/image/structured)
        2. Auto-select strategies or use overrides
        3. Calculate materials and labor
        4. Calculate protection and debris
        5. Save calculation
        6. Return result
        """

        # Reset tracking for new calculation
        self.fuzzy_matching_used = False
        self.fuzzy_matches = []
        self.contents_estimations = []

        # For now, implement basic rule-based calculation
        # TODO: Add strategy selection and AI integration

        # Calculate total_floors from room floor_levels automatically
        floor_levels = set()
        for room_input in request.rooms:
            floor_levels.add(room_input.floor_level)
        
        # Determine total_floors based on highest floor present
        # MAIN_LEVEL = 1, SECOND_FLOOR = 2, THIRD_FLOOR = 3, etc.
        total_floors = 1  # Default to 1 floor (main level only)
        if "FIFTH_FLOOR_PLUS" in floor_levels:
            total_floors = 5
        elif "FOURTH_FLOOR" in floor_levels:
            total_floors = 4
        elif "THIRD_FLOOR" in floor_levels:
            total_floors = 3
        elif "SECOND_FLOOR" in floor_levels:
            total_floors = 2
        
        self.logger.debug(
            f"[PackCalc] Auto-calculated total_floors: {total_floors} from floor_levels: {floor_levels}"
        )

        # Create calculation record as dictionary
        calculation_data = {
            "calculation_name": request.calculation_name,
            "project_address": request.project_address,
            "notes": request.notes,
            "building_type": request.building_info.building_type,
            "total_floors": total_floors,  # Auto-calculated from rooms
            "has_elevator": request.building_info.has_elevator,
            "created_by_id": str(user_id),
            "ml_used": False,  # Basic version doesn't use ML yet
            "ml_confidence": 0.8,  # Default confidence
            "needs_review": False,
            "strategies_used": {
                "material": "rule_based",
                "labor": "item_based",
                "protection": "estimated",
                "debris": "material_based",
            },
        }

        # Save calculation first to get ID
        calculation = self.calc_repo.create(calculation_data)

        # Process each room
        all_materials = {}
        all_labor = {}
        total_packing_hours = 0.0
        total_moving_hours = 0.0
        rooms_data = []  # Store room breakdown data

        for room_input in request.rooms:
            # Create room record as dictionary
            room_data = {
                "calculation_id": calculation["id"],
                "room_name": room_input.room_name,
                "floor_level": room_input.floor_level,
                "input_method": room_input.input_method,
                "raw_input": room_input.raw_input,
                "image_url": room_input.image_url,
                "ai_confidence": 0.8,
            }
            room = self.room_repo.create(room_data)

            # Process each item in room
            room_materials = {}
            room_packing_hours = 0.0
            room_moving_hours = 0.0

            # If no items provided, estimate default boxes for the room
            if not room_input.items or len(room_input.items) == 0:
                default_boxes = self._estimate_default_room_boxes(room_input.room_name)
                if default_boxes:
                    # Adjust by room size hint and floor multipliers
                    default_boxes = self._adjust_room_boxes_by_size(default_boxes, room_input.room_name)
                    for code, qty in default_boxes.items():
                        room_materials[code] = room_materials.get(code, 0) + qty
                        all_materials[code] = all_materials.get(code, 0) + qty
                    # Approximate labor for boxes
                    default_box_count = sum(default_boxes.values())
                    packing_mult = FLOOR_MULTIPLIERS.get(
                        room_input.floor_level,
                        FLOOR_MULTIPLIERS["MAIN_LEVEL"]
                    ).get("packing", 1.0)
                    moving_mult = FLOOR_MULTIPLIERS.get(
                        room_input.floor_level,
                        FLOOR_MULTIPLIERS["MAIN_LEVEL"]
                    ).get("moving_down", FLOOR_MULTIPLIERS["MAIN_LEVEL"].get("moving", 1.0))
                    room_packing_hours += default_box_count * 0.15 * packing_mult
                    room_moving_hours += default_box_count * 0.10 * moving_mult

            for item_input in room_input.items:
                # Get material mapping
                item_materials = self._get_materials_for_item(item_input)
                
                # Check if this is contents-only (no furniture wrapping needed)
                item_name_lower = item_input.item_name.lower()
                is_contents_only = any(keyword in item_name_lower for keyword in [
                    '+ contents', '+contents', 'with contents', '& contents', 'and contents', ' contents'
                ])
                
                # Only add wrapping consumables for furniture (not contents-only items)
                if not is_contents_only:
                    # Add wrapping consumables based on item type/fragility
                    wrap_consumables = self._estimate_wrapping_consumables(item_input, item_materials)
                    if wrap_consumables:
                        for code, qty in wrap_consumables.items():
                            item_materials[code] = item_materials.get(code, 0) + qty
                else:
                    print(f"🚫 Skipping wrapping consumables for contents-only item: '{item_input.item_name}'")

                # Calculate labor for this item
                packing_hours, moving_hours = self._calculate_item_labor(
                    item_input,
                    is_pack_out=True
                )

                # Apply floor multiplier
                floor_mult = FLOOR_MULTIPLIERS.get(
                    item_input.floor_level,
                    FLOOR_MULTIPLIERS["MAIN_LEVEL"]
                )
                packing_hours *= floor_mult["packing"]
                moving_hours *= floor_mult.get("moving_down", floor_mult.get("moving", 1.0))

                room_packing_hours += packing_hours * item_input.quantity
                room_moving_hours += moving_hours * item_input.quantity

                # Aggregate materials
                for code, qty in item_materials.items():
                    room_materials[code] = room_materials.get(code, 0) + (qty * item_input.quantity)
                    all_materials[code] = all_materials.get(code, 0) + (qty * item_input.quantity)

                # Create item record as dictionary
                item_data = {
                    "room_id": room["id"],
                    "item_name": item_input.item_name,
                    "item_category": item_input.item_category,
                    "quantity": item_input.quantity,
                    "size_category": item_input.size_category,
                    "floor_level": item_input.floor_level,
                    "fragile": item_input.fragile,
                    "requires_disassembly": item_input.requires_disassembly,
                    "special_notes": item_input.special_notes,
                    "detected_by": "MANUAL",
                    "confidence_score": 1.0,
                    "xactimate_materials": item_materials,
                }
                self.item_repo.create(item_data)

            # Update room totals
            room_update_data = {
                "xactimate_materials": room_materials,
                "packing_hours": room_packing_hours,
                "moving_hours": room_moving_hours,
                "floor_multiplier": floor_mult.get("moving_down", 1.0),
            }
            room = self.room_repo.update(room["id"], room_update_data)

            # Store room data for breakdown
            # Build brief explanations per room
            # Note: crew_size will be calculated later based on job size
            # For now, use placeholder (will be updated after calculation)
            building_info_dict = None
            if request and request.building_info:
                building_info_dict = {
                    "building_type": request.building_info.building_type,
                    "total_floors": total_floors,  # Use auto-calculated total_floors
                    "has_elevator": request.building_info.has_elevator,
                }
            # Use placeholder crew_size=2 (minimum) - will be updated after full calculation
            expl_out, expl_prot, expl_in = self._build_room_explanations(
                room_input.room_name,
                room_input.floor_level,
                len(room_input.items),
                room_materials,
                room_packing_hours,
                room_moving_hours,
                request.building_info.building_type if request and request.building_info else None,
                building_info=building_info_dict,
                crew_size=2,  # Placeholder - will be recalculated with actual crew_size
            )

            rooms_data.append({
                "room_id": room["id"],
                "room_name": room_input.room_name,
                "floor_level": room_input.floor_level,
                "materials": room_materials,
                "pack_out_labor_hours": room_packing_hours + room_moving_hours,
                "item_count": len(room_input.items),
                "explanation_pack_out": expl_out,
                "explanation_protection": None,  # Protection is shared across all rooms
                "explanation_pack_in": expl_in,
            })

            total_packing_hours += room_packing_hours
            total_moving_hours += room_moving_hours

        # Calculate logistics labor (to truck/storage and back) and total pack-out labor
        logistics_out_hours, logistics_in_hours = self._calculate_logistics_labor(rooms_data, all_materials)
        
        # Calculate crew_size based on job size if not provided
        total_items = sum(len(room_input.items) for room_input in request.rooms)
        total_boxes_estimated = sum(
            sum(1 for code in (room_data.get("materials", {}) or {}).keys() 
                if isinstance(code, str) and code.startswith(("CPS BX", "CPS BXDISH", "CPS BXWDR")))
            for room_data in rooms_data
        )
        # Also count boxes from all_materials
        total_boxes_from_materials = sum(
            qty for code, qty in all_materials.items()
            if isinstance(code, str) and code.startswith(("CPS BX", "CPS BXDISH", "CPS BXWDR"))
        )
        total_boxes = max(total_boxes_estimated, int(total_boxes_from_materials))
        
        total_pack_out_hours_base = total_packing_hours + total_moving_hours + logistics_out_hours
        crew_size = self._calculate_crew_size(
            job_size={
                "total_items": total_items,
                "total_boxes": total_boxes,
                "total_hours_base": total_pack_out_hours_base,
                "num_rooms": len(request.rooms),
                "total_floors": total_floors,
            },
            user_provided_crew_size=request.building_info.crew_size if request.building_info else None
        )
        
        total_pack_out_hours_with_crew = total_pack_out_hours_base * crew_size
        
        pack_out_labor = {
            "CPS LAB": total_pack_out_hours_with_crew
        }

        # Calculate protection - use auto-calculated total_floors
        from types import SimpleNamespace
        protection_building_info = SimpleNamespace(
            building_type=request.building_info.building_type,
            total_floors=total_floors,  # Use auto-calculated total_floors
            has_elevator=request.building_info.has_elevator
        )
        
        self.logger.debug(
            f"[PackCalc] Calculating protection: building_type={protection_building_info.building_type}, "
            f"total_floors={protection_building_info.total_floors}, "
            f"has_elevator={protection_building_info.has_elevator}"
        )
        protection = self._calculate_protection(protection_building_info)
        self.logger.debug(
            f"[PackCalc] Protection calculated: {protection}"
        )

        # Calculate debris
        debris = self._calculate_debris(all_materials, protection)

        # Calculate pack-in labor (typically 70-80% more due to moving UP)
        pack_in_labor_hours = 0.0
        for room_input in request.rooms:
            for item_input in room_input.items:
                # Unpacking is faster (60% of packing time)
                unpacking_hours = 0.0  # Assuming items are already packed

                # Moving up is harder
                _, moving_hours = self._calculate_item_labor(item_input, is_pack_out=False)
                floor_mult = FLOOR_MULTIPLIERS.get(
                    item_input.floor_level,
                    FLOOR_MULTIPLIERS["MAIN_LEVEL"]
                )
                moving_hours *= floor_mult.get("moving_up", floor_mult.get("moving", 1.0))

                pack_in_labor_hours += (unpacking_hours + moving_hours) * item_input.quantity

        pack_in_labor = {
            "CPS LAB": pack_in_labor_hours + logistics_in_hours
        }

        # Update calculation with results
        calculation_update_data = {
            "xactimate_pack_out_materials": all_materials,
            "xactimate_pack_out_labor": pack_out_labor,
            "xactimate_protection": protection,
            "xactimate_debris": debris,
            "xactimate_pack_in_labor": pack_in_labor,
            "total_pack_out_hours": total_pack_out_hours_with_crew,
            "total_pack_in_hours": pack_in_labor_hours,
            "total_protection_sf": sum(protection.values()),
            "total_debris_lb": debris.get("total_debris_lb", 0),
            "strategies_used": {
                "material_estimation": "seed_data" if not self.fuzzy_matching_used else "fuzzy_matched_seed_data",
                "labor_calculation": "item_based",
                "protection_estimate": "building_based",
                "debris_calculation": "material_based",
                "fuzzy_matching_used": self.fuzzy_matching_used or len(self.contents_estimations) > 0,
                "fuzzy_matches": (self.fuzzy_matches + self.contents_estimations) if (self.fuzzy_matching_used or len(self.contents_estimations) > 0) else [],
            },
            "original_calculation": {
                "pack_out_materials": all_materials,
                "pack_out_labor": pack_out_labor,
                "protection": protection,
                "debris": debris,
                "pack_in_labor": pack_in_labor,
            },
        }
        calculation = self.calc_repo.update(calculation["id"], calculation_update_data)

        # Format response with room breakdown
        return self.format_calculation_response(calculation, rooms_data)

    def _calculate_total_floors_from_rooms(self, rooms: List) -> int:
        """Calculate total_floors automatically from room floor_levels"""
        floor_levels = set()
        for room_input in rooms:
            floor_levels.add(room_input.floor_level)
        
        # Determine total_floors based on highest floor present
        total_floors = 1  # Default to 1 floor (main level only)
        if "FIFTH_FLOOR_PLUS" in floor_levels:
            total_floors = 5
        elif "FOURTH_FLOOR" in floor_levels:
            total_floors = 4
        elif "THIRD_FLOOR" in floor_levels:
            total_floors = 3
        elif "SECOND_FLOOR" in floor_levels:
            total_floors = 2
        
        return total_floors

    def update(
        self,
        calculation_id: UUID,
        request: PackCalculationRequest,
        user_id: UUID
    ) -> PackCalculationResult:
        """
        Update existing calculation with new inputs
        Preserves calculation_id and metadata, only updates calculation results
        """
        # Reset tracking for update calculation
        self.fuzzy_matching_used = False
        self.fuzzy_matches = []
        self.contents_estimations = []
        
        # Get existing calculation
        self.logger.info(
            f"[PackCalc] Service.update start id={calculation_id}"
        )
        existing_calc = self.calc_repo.get_by_id(calculation_id)
        if not existing_calc:
            self.logger.warning(
                f"[PackCalc] Service.update not found id={calculation_id}"
            )
            raise ValueError(f"Calculation {calculation_id} not found")

        # Calculate total_floors from room floor_levels automatically
        total_floors = self._calculate_total_floors_from_rooms(request.rooms)
        self.logger.debug(
            f"[PackCalc] Update: Auto-calculated total_floors: {total_floors} from rooms"
        )

        # Delete old rooms and items
        self.logger.debug(
            f"[PackCalc] Deleting rooms/items for id={calculation_id}"
        )
        self.room_repo.delete_by_calculation_id(calculation_id)

        # Reset fuzzy matching tracking
        self.fuzzy_matching_used = False
        self.fuzzy_matches = []

        # Process rooms and items (same as calculate)
        rooms_data = []
        all_materials = {}
        total_packing_hours = 0.0
        total_moving_hours = 0.0

        for room_input in request.rooms:
            room_data = {
                "room_name": room_input.room_name,
                "floor_level": room_input.floor_level,
                "calculation_id": calculation_id,
            }
            room = self.room_repo.create(room_data)

            # Track room-level materials and labor
            room_materials = {}
            room_packing_hours = 0.0
            room_moving_hours = 0.0

            # If no items provided, estimate default boxes for the room
            if not room_input.items or len(room_input.items) == 0:
                default_boxes = self._estimate_default_room_boxes(room_input.room_name)
                if default_boxes:
                    default_boxes = self._adjust_room_boxes_by_size(default_boxes, room_input.room_name)
                    for code, qty in default_boxes.items():
                        room_materials[code] = room_materials.get(code, 0) + qty
                        all_materials[code] = all_materials.get(code, 0) + qty
                    default_box_count = sum(default_boxes.values())
                    packing_mult = FLOOR_MULTIPLIERS.get(
                        room_input.floor_level,
                        FLOOR_MULTIPLIERS["MAIN_LEVEL"]
                    ).get("packing", 1.0)
                    moving_mult = FLOOR_MULTIPLIERS.get(
                        room_input.floor_level,
                        FLOOR_MULTIPLIERS["MAIN_LEVEL"]
                    ).get("moving_down", FLOOR_MULTIPLIERS["MAIN_LEVEL"].get("moving", 1.0))
                    room_packing_hours += default_box_count * 0.15 * packing_mult
                    room_moving_hours += default_box_count * 0.10 * moving_mult

            # Create items and calculate
            for item_input in room_input.items:
                # Get materials
                item_materials = self._get_materials_for_item(item_input)
                # Add wrapping consumables based on item type/fragility
                wrap_consumables = self._estimate_wrapping_consumables(item_input, item_materials)
                if wrap_consumables:
                    for code, qty in wrap_consumables.items():
                        item_materials[code] = item_materials.get(code, 0) + qty

                # Calculate labor
                packing_hours, moving_hours = self._calculate_item_labor(item_input, is_pack_out=True)
                floor_mult = FLOOR_MULTIPLIERS.get(
                    item_input.floor_level,
                    FLOOR_MULTIPLIERS["MAIN_LEVEL"]
                )
                moving_hours *= floor_mult.get("moving", 1.0)

                # Accumulate room totals
                room_packing_hours += packing_hours * item_input.quantity
                room_moving_hours += moving_hours * item_input.quantity

                # Aggregate materials
                for code, qty in item_materials.items():
                    room_materials[code] = room_materials.get(code, 0) + (qty * item_input.quantity)
                    all_materials[code] = all_materials.get(code, 0) + (qty * item_input.quantity)

                # Create item record
                item_data = {
                    "item_name": item_input.item_name,
                    "quantity": item_input.quantity,
                    "floor_level": item_input.floor_level or room_input.floor_level,
                    "requires_disassembly": item_input.requires_disassembly,
                    "fragile": item_input.fragile,
                    "room_id": room["id"],
                }
                self.item_repo.create(item_data)

            # Store room data for breakdown (same structure as calculate)
            building_info_dict = None
            crew_size = 1
            if request and request.building_info:
                crew_size = request.building_info.crew_size if request.building_info.crew_size else 1
                building_info_dict = {
                    "building_type": request.building_info.building_type,
                    "total_floors": total_floors,  # Use auto-calculated total_floors
                    "has_elevator": request.building_info.has_elevator,
                    "crew_size": crew_size,
                }
            expl_out, expl_prot, expl_in = self._build_room_explanations(
                room_input.room_name,
                room_input.floor_level,
                len(room_input.items),
                room_materials,
                room_packing_hours,
                room_moving_hours,
                request.building_info.building_type if request and request.building_info else None,
                building_info=building_info_dict,
                crew_size=crew_size,
            )

            rooms_data.append({
                "room_id": room["id"],
                "room_name": room_input.room_name,
                "floor_level": room_input.floor_level,
                "materials": room_materials,
                "pack_out_labor_hours": room_packing_hours + room_moving_hours,
                "item_count": len(room_input.items),
                "explanation_pack_out": expl_out,
                "explanation_protection": None,  # Protection is shared across all rooms
                "explanation_pack_in": expl_in,
            })

            total_packing_hours += room_packing_hours
            total_moving_hours += room_moving_hours

        logistics_out_hours, logistics_in_hours = self._calculate_logistics_labor(rooms_data, all_materials)
        
        # Calculate crew_size based on job size if not provided
        total_items = sum(len(room_input.items) for room_input in request.rooms)
        total_boxes_estimated = sum(
            sum(1 for code in (room_data.get("materials", {}) or {}).keys() 
                if isinstance(code, str) and code.startswith(("CPS BX", "CPS BXDISH", "CPS BXWDR")))
            for room_data in rooms_data
        )
        total_boxes_from_materials = sum(
            qty for code, qty in all_materials.items()
            if isinstance(code, str) and code.startswith(("CPS BX", "CPS BXDISH", "CPS BXWDR"))
        )
        total_boxes = max(total_boxes_estimated, int(total_boxes_from_materials))
        
        total_pack_out_hours_base = total_packing_hours + total_moving_hours + logistics_out_hours
        crew_size = self._calculate_crew_size(
            job_size={
                "total_items": total_items,
                "total_boxes": total_boxes,
                "total_hours_base": total_pack_out_hours_base,
                "num_rooms": len(request.rooms),
                "total_floors": total_floors,
            },
            user_provided_crew_size=request.building_info.crew_size if request.building_info else None
        )
        
        pack_out_labor = {
            "CPS LAB": total_pack_out_hours_base * crew_size
        }

        # Calculate protection - use auto-calculated total_floors
        from types import SimpleNamespace
        protection_building_info = SimpleNamespace(
            building_type=request.building_info.building_type,
            total_floors=total_floors,  # Use auto-calculated total_floors
            has_elevator=request.building_info.has_elevator
        )
        
        self.logger.debug(
            f"[PackCalc] Update protection calculation: building_type={protection_building_info.building_type}, "
            f"total_floors={protection_building_info.total_floors}, "
            f"has_elevator={protection_building_info.has_elevator}"
        )
        protection = self._calculate_protection(protection_building_info)
        self.logger.debug(
            f"[PackCalc] Update: Protection calculated: {protection}"
        )

        # Calculate debris (use helper method like calculate())
        debris = self._calculate_debris(all_materials, protection)

        # Calculate pack-in labor
        pack_in_labor_hours = 0.0
        for room_input in request.rooms:
            for item_input in room_input.items:
                unpacking_hours = 0.0
                _, moving_hours = self._calculate_item_labor(item_input, is_pack_out=False)
                floor_mult = FLOOR_MULTIPLIERS.get(
                    item_input.floor_level,
                    FLOOR_MULTIPLIERS["MAIN_LEVEL"]
                )
                moving_hours *= floor_mult.get("moving_up", floor_mult.get("moving", 1.0))
                pack_in_labor_hours += (unpacking_hours + moving_hours) * item_input.quantity

        # Calculate crew_size based on job size (same as calculate method)
        total_items = sum(len(room_input.items) for room_input in request.rooms)
        total_boxes_estimated = sum(
            sum(1 for code in (room_data.get("materials", {}) or {}).keys() 
                if isinstance(code, str) and code.startswith(("CPS BX", "CPS BXDISH", "CPS BXWDR")))
            for room_data in rooms_data
        )
        total_boxes_from_materials = sum(
            qty for code, qty in all_materials.items()
            if isinstance(code, str) and code.startswith(("CPS BX", "CPS BXDISH", "CPS BXWDR"))
        )
        total_boxes = max(total_boxes_estimated, int(total_boxes_from_materials))
        
        total_pack_out_hours_base = total_packing_hours + total_moving_hours + logistics_out_hours
        crew_size = self._calculate_crew_size(
            job_size={
                "total_items": total_items,
                "total_boxes": total_boxes,
                "total_hours_base": total_pack_out_hours_base,
                "num_rooms": len(request.rooms),
                "total_floors": total_floors,
            },
            user_provided_crew_size=request.building_info.crew_size if request.building_info else None
        )
        
        # Apply crew size multiplier for pack-in labor
        total_pack_in_hours_base = pack_in_labor_hours + logistics_in_hours
        total_pack_in_hours_with_crew = total_pack_in_hours_base * crew_size

        pack_in_labor = {
            "CPS LAB": total_pack_in_hours_with_crew
        }

        # Update calculation with new results
        calculation_update_data = {
            "calculation_name": request.calculation_name,
            "project_address": request.project_address,
            "building_type": request.building_info.building_type if request.building_info else None,
            "total_floors": total_floors,  # Use auto-calculated total_floors
            "has_elevator": request.building_info.has_elevator if request.building_info else False,
            "xactimate_pack_out_materials": all_materials,
            "xactimate_pack_out_labor": pack_out_labor,
            "xactimate_protection": protection,
            "xactimate_debris": debris,
            "xactimate_pack_in_labor": pack_in_labor,
            "total_pack_out_hours": total_packing_hours + total_moving_hours,
            "total_pack_in_hours": pack_in_labor_hours,
            "total_protection_sf": sum(protection.values()),
            "total_debris_lb": debris.get("total_debris_lb", 0),
            "strategies_used": {
                "material_estimation": "seed_data" if not self.fuzzy_matching_used else "fuzzy_matched_seed_data",
                "labor_calculation": "item_based",
                "protection_estimate": "building_based",
                "debris_calculation": "material_based",
                "fuzzy_matching_used": self.fuzzy_matching_used or len(self.contents_estimations) > 0,
                "fuzzy_matches": (self.fuzzy_matches + self.contents_estimations) if (self.fuzzy_matching_used or len(self.contents_estimations) > 0) else [],
            },
            "original_calculation": {
                "pack_out_materials": all_materials,
                "pack_out_labor": pack_out_labor,
                "protection": protection,
                "debris": debris,
                "pack_in_labor": pack_in_labor,
            },
        }

        self.logger.info(
            f"[PackCalc] Persisting updated aggregates for id={calculation_id}"
        )
        # Perform update; even if the ORM doesn't return the entity, fetch it after
        _ = self.calc_repo.update(calculation_id, calculation_update_data)

        # Fetch latest calculation snapshot to ensure consistency
        calculation = self.calc_repo.get_by_id(calculation_id)
        if not calculation:
            self.logger.error(
                f"[PackCalc] Updated calculation not found after update "
                f"id={calculation_id}"
            )
            # Fall back to basic dict with id to avoid 404s
            calculation = {"id": calculation_id, "calculation_name": request.calculation_name}

        # Format response with room breakdown
        self.logger.debug(
            f"[PackCalc] Formatting response rooms_count={len(rooms_data)} "
            f"id={calculation_id}"
        )
        return self.format_calculation_response(calculation, rooms_data)

    def _build_room_explanations(
        self,
        room_name: str,
        floor_level: str,
        item_count: int,
        room_materials: Dict[str, float],
        room_packing_hours: float,
        room_moving_hours: float,
        building_type: str | None = None,
        pack_in_hours: float | None = None,
        building_info: Dict[str, Any] | None = None,
        item_moving_hours: float = 0.0,
        logistics_hours: float = 0.0,
        room_box_count: int = 0,
        has_storage: bool = False,
        items: List[Dict[str, Any]] | None = None,
        crew_size: int = 1,
    ) -> tuple[str, str, str]:
        """
        Create short natural-language explanations for:
          - pack-out materials/labor
          - protection
          - pack-in labor
        """
        # Convert floor_level to string if it's an enum
        if hasattr(floor_level, 'value'):
            # It's an enum, get its value
            floor_level_str = floor_level.value
        elif isinstance(floor_level, str):
            floor_level_str = floor_level
        else:
            # Fallback: convert to string
            floor_level_str = str(floor_level)
        
        # Format floor level for display
        floor_display = floor_level_str.replace('_', ' ').title()
        is_main_level = floor_level_str == 'MAIN_LEVEL'
        
        # Pack-out explanation - detailed per item (but avoid exact item counts)
        # Calculate base hours (1 person) and total hours (with crew)
        # Note: room_packing_hours and room_moving_hours are already base hours per person
        # Ensure crew_size is at least 2 (minimum requirement)
        crew_size = max(2, crew_size)
        out_hours_base = room_packing_hours + room_moving_hours
        out_hours_total = out_hours_base * crew_size
        
        if items and len(items) > 0:
            # Build detailed explanation per item (without exact quantities)
            item_explanations = []
            for item in items:
                item_name = item.get("item_name", "Unknown item")
                fragile = item.get("fragile", False)
                requires_disassembly = item.get("requires_disassembly", False)
                size_category = item.get("size_category", "")
                item_materials = item.get("xactimate_materials", {})
                
                # Build item-specific explanation (without quantity)
                item_parts = [item_name]
                
                # Add item characteristics
                characteristics = []
                if fragile:
                    characteristics.append("fragile")
                if requires_disassembly:
                    characteristics.append("requires disassembly")
                if size_category:
                    characteristics.append(f"{size_category} size")
                if characteristics:
                    item_parts.append(f"({', '.join(characteristics)})")
                
                # List materials needed for this item (show code with approximate quantity)
                material_descriptions = []
                for code, qty in item_materials.items():
                    if qty > 0:
                        # Show code and approximate quantity (round to nearest reasonable number)
                        if qty >= 10:
                            qty_str = f"~{int(qty)}"
                        elif qty >= 1:
                            qty_str = f"~{int(qty)}"
                        else:
                            qty_str = "some"
                        material_descriptions.append(f"{code} {qty_str}")
                
                if material_descriptions:
                    # Explain why materials are needed
                    reason_parts = []
                    if fragile:
                        reason_parts.append("bubble wrap and padding for protection")
                    if requires_disassembly:
                        reason_parts.append("boxes for parts")
                    if not fragile and not requires_disassembly:
                        # Check if has boxes
                        has_boxes = any(code.startswith(("CPS BX", "CPS BXDISH", "CPS BXWDR")) 
                                      for code in item_materials.keys())
                        if has_boxes:
                            reason_parts.append("boxes for packing")
                    
                    reason_text = " (" + ", ".join(reason_parts) + ")" if reason_parts else ""
                    item_expl = " ".join(item_parts) + f": {', '.join(material_descriptions)}{reason_text}"
                    item_explanations.append(item_expl)
            
            # Combine all item explanations
            if item_explanations:
                items_text = "; ".join(item_explanations)
                if crew_size > 2:
                    if is_main_level:
                        expl_out = (
                            f"Materials based on items: {items_text}. "
                            f"Pack-out labor {out_hours_total:.1f}h total ({out_hours_base:.1f}h × {crew_size} crew) includes packing and moving."
                        )
                    else:
                        expl_out = (
                            f"Materials based on items on {floor_display}: {items_text}. "
                            f"Pack-out labor {out_hours_total:.1f}h total ({out_hours_base:.1f}h × {crew_size} crew) includes packing and moving for this level."
                        )
                else:
                    # crew_size is 2 (minimum)
                    if is_main_level:
                        expl_out = (
                            f"Materials based on items: {items_text}. "
                            f"Pack-out labor {out_hours_total:.1f}h ({crew_size} crew) includes packing and moving."
                        )
                    else:
                        expl_out = (
                            f"Materials based on items on {floor_display}: {items_text}. "
                            f"Pack-out labor {out_hours_total:.1f}h ({crew_size} crew) includes packing and moving for this level."
                        )
            else:
                # Fallback if no items provided
                total_material_lines = len(room_materials)
                boxes = sum(qty for code, qty in room_materials.items() 
                          if isinstance(code, str) and code.startswith(("CPS BX", "CPS BXDISH", "CPS BXWDR")))
                wraps = sum(qty for code, qty in room_materials.items() 
                          if code in ("CPS BWRAP", "CPS WRAP"))
                if crew_size > 2:
                    if is_main_level:
                        expl_out = (
                            f"Materials estimated from room contents, "
                            f"using {total_material_lines} material types (boxes≈{int(boxes)}, wrap≈{int(wraps)}). "
                            f"Pack-out labor {out_hours_total:.1f}h total ({out_hours_base:.1f}h × {crew_size} crew) reflects packing and moving effort."
                        )
                    else:
                        expl_out = (
                            f"Materials estimated from room contents on {floor_display}, "
                            f"using {total_material_lines} material types (boxes≈{int(boxes)}, wrap≈{int(wraps)}). "
                            f"Pack-out labor {out_hours_total:.1f}h total ({out_hours_base:.1f}h × {crew_size} crew) reflects packing and moving effort for this level."
                        )
                else:
                    # crew_size is 2 (minimum)
                    if is_main_level:
                        expl_out = (
                            f"Materials estimated from room contents, "
                            f"using {total_material_lines} material types (boxes≈{int(boxes)}, wrap≈{int(wraps)}). "
                            f"Pack-out labor {out_hours_total:.1f}h ({crew_size} crew) reflects packing and moving effort."
                        )
                    else:
                        expl_out = (
                            f"Materials estimated from room contents on {floor_display}, "
                            f"using {total_material_lines} material types (boxes≈{int(boxes)}, wrap≈{int(wraps)}). "
                            f"Pack-out labor {out_hours_total:.1f}h ({crew_size} crew) reflects packing and moving effort for this level."
                        )
        else:
            # Fallback if no items provided
            total_material_lines = len(room_materials)
            boxes = sum(qty for code, qty in room_materials.items() 
                      if isinstance(code, str) and code.startswith(("CPS BX", "CPS BXDISH", "CPS BXWDR")))
            wraps = sum(qty for code, qty in room_materials.items() 
                      if code in ("CPS BWRAP", "CPS WRAP"))
            if crew_size > 2:
                if is_main_level:
                    expl_out = (
                        f"Materials estimated from room contents, "
                        f"using {total_material_lines} material types (boxes≈{int(boxes)}, wrap≈{int(wraps)}). "
                        f"Pack-out labor {out_hours_total:.1f}h total ({out_hours_base:.1f}h × {crew_size} crew) reflects packing and moving effort."
                    )
                else:
                    expl_out = (
                        f"Materials estimated from room contents on {floor_display}, "
                        f"using {total_material_lines} material types (boxes≈{int(boxes)}, wrap≈{int(wraps)}). "
                        f"Pack-out labor {out_hours_total:.1f}h total ({out_hours_base:.1f}h × {crew_size} crew) reflects packing and moving effort for this level."
                    )
            else:
                # crew_size is 2 (minimum)
                if is_main_level:
                    expl_out = (
                        f"Materials estimated from room contents, "
                        f"using {total_material_lines} material types (boxes≈{int(boxes)}, wrap≈{int(wraps)}). "
                        f"Pack-out labor {out_hours_total:.1f}h ({crew_size} crew) reflects packing and moving effort."
                    )
                else:
                    expl_out = (
                        f"Materials estimated from room contents on {floor_display}, "
                        f"using {total_material_lines} material types (boxes≈{int(boxes)}, wrap≈{int(wraps)}). "
                        f"Pack-out labor {out_hours_total:.1f}h ({crew_size} crew) reflects packing and moving effort for this level."
                    )

        # Protection explanation - room-specific based on floor level
        # Protection is calculated at building level, but explanation varies by room floor
        if building_info:
            bt_raw = building_info.get("building_type", building_type or "house")
            # Convert enum to string if needed
            if hasattr(bt_raw, 'value'):
                bt_str = bt_raw.value
            elif isinstance(bt_raw, str):
                bt_str = bt_raw
            else:
                bt_str = str(bt_raw)
            total_floors = building_info.get("total_floors", 1)
            has_elevator = building_info.get("has_elevator", False)
            
            factors = PROTECTION_FACTORS.get(bt_str.lower(), PROTECTION_FACTORS["house"])
            base_sf = factors["base_sf"]
            per_floor_sf = factors["per_floor_sf"]
            
            # Room-specific protection explanation based on floor level
            if is_main_level:
                # Main level rooms: protection covers entry/hallway access
                if total_floors == 1:
                    expl_prot = (
                        f"Protection covers entry and hallway areas ({int(base_sf)} SF) "
                        f"to access {room_name}."
                    )
                else:
                    expl_prot = (
                        f"Protection covers entry/hallway ({int(base_sf)} SF) "
                        f"and stair access ({int((total_floors - 1) * per_floor_sf)} SF) "
                        f"to reach {room_name} on main level."
                    )
            else:
                # Upper/lower floors: protection includes stair coverage for this floor
                floor_num = 1
                if floor_level_str == "SECOND_FLOOR":
                    floor_num = 2
                elif floor_level_str == "THIRD_FLOOR":
                    floor_num = 3
                elif floor_level_str == "FOURTH_FLOOR":
                    floor_num = 4
                elif floor_level_str == "FIFTH_FLOOR_PLUS":
                    floor_num = 5
                elif floor_level_str == "BASEMENT":
                    floor_num = 0
                
                if not has_elevator and total_floors > 1:
                    if floor_level_str == "BASEMENT":
                        expl_prot = (
                            f"Protection includes stair access from main level to basement "
                            f"({int(base_sf)} SF entry + stair coverage) to reach {room_name}."
                        )
                    elif floor_num > 1:
                        stairs_to_floor = floor_num * 40
                        expl_prot = (
                            f"Protection includes entry ({int(base_sf)} SF) and "
                            f"stair coverage up to floor {floor_num} ({int(stairs_to_floor)} SF) "
                            f"to access {room_name}."
                        )
                    else:
                        expl_prot = (
                            f"Protection covers entry ({int(base_sf)} SF) and stair access "
                            f"to reach {room_name} on {floor_display}."
                        )
                else:
                    if has_elevator:
                        expl_prot = (
                            f"Protection covers entry/hallway ({int(base_sf)} SF) "
                            f"and elevator access areas to reach {room_name} on {floor_display}."
                        )
                    else:
                        expl_prot = (
                            f"Protection covers entry/hallway ({int(base_sf)} SF) "
                            f"to access {room_name} on {floor_display}."
                        )
        else:
            # Fallback if building_info not provided
            if is_main_level:
                expl_prot = (
                    f"Protection covers entry and hallway areas to access {room_name}."
                )
            else:
                expl_prot = (
                    f"Protection includes stair/elevator access to reach {room_name} "
                    f"on {floor_display}."
                )

        # Pack-in explanation - show calculation breakdown (without exact counts)
        # pack_in_hours is already total hours (with crew multiplier applied)
        # Ensure crew_size is at least 2 (minimum requirement)
        crew_size = max(2, crew_size)
        if pack_in_hours is not None and pack_in_hours > 0:
            # Calculate base hours (1 person) from total hours
            pack_in_hours_base = pack_in_hours / crew_size if crew_size > 0 else pack_in_hours
            pack_in_hours_total = pack_in_hours  # Already includes crew multiplier
            
            # Calculate components (base hours per person)
            item_mov_h_base = (item_moving_hours or 0.0)  # Already base hours
            log_h_base = (logistics_hours or 0.0)  # Already base hours
            
            # Get floor multiplier info (only mention if significant)
            floor_mult_str = ""
            if not is_main_level:
                floor_mult = FLOOR_MULTIPLIERS.get(
                    floor_level_str,
                    FLOOR_MULTIPLIERS["MAIN_LEVEL"]
                ).get("moving_up", 1.0)
                if floor_mult > 1.1:  # Only mention if significantly more than 1.0
                    floor_mult_str = f" (floor level multiplier applied)"
            
            # Build explanation with calculation details (vague about counts)
            parts = []
            if item_mov_h_base > 0:
                parts.append(f"{item_mov_h_base:.1f}h for moving items back{floor_mult_str}")
            if log_h_base > 0:
                storage_str = " (including storage transfer)" if has_storage else ""
                # Don't mention exact box/item counts
                parts.append(f"{log_h_base:.1f}h logistics{storage_str}")
            
            if parts:
                if crew_size > 2:
                    expl_in = (
                        f"Pack-in labor {pack_in_hours_total:.1f}h total ({pack_in_hours_base:.1f}h × {crew_size} crew) calculated as: {', '.join(parts)}."
                    )
                else:
                    # crew_size is 2 (minimum)
                    expl_in = (
                        f"Pack-in labor {pack_in_hours_total:.1f}h ({crew_size} crew) calculated as: {', '.join(parts)}."
                    )
            else:
                # Fallback if components not provided
                if crew_size > 2:
                    expl_in = (
                        f"Pack-in labor {pack_in_hours_total:.1f}h total ({pack_in_hours_base:.1f}h × {crew_size} crew) accounts for moving items back "
                        f"to {room_name}."
                    )
                else:
                    # crew_size is 2 (minimum)
                    expl_in = (
                        f"Pack-in labor {pack_in_hours_total:.1f}h ({crew_size} crew) accounts for moving items back "
                        f"to {room_name}."
                    )
        else:
            expl_in = (
                f"Pack-in labor accounts for moving items back to {room_name}."
            )

        return expl_out, expl_prot, expl_in

    def _calculate_crew_size(
        self,
        job_size: Dict[str, Any],
        user_provided_crew_size: Optional[int] = None
    ) -> int:
        """
        Calculate crew size based on job size.
        
        Rules:
        - Minimum crew_size = 2 (safety requirement)
        - Scale up based on:
          - Total items: +1 crew per 20 items above 30
          - Total boxes: +1 crew per 15 boxes above 25
          - Total hours: +1 crew per 8 hours above 12
          - Number of rooms: +1 crew per 5 rooms above 5
          - Total floors: +1 crew if 3+ floors
        
        Args:
            job_size: Dict with keys: total_items, total_boxes, total_hours_base, num_rooms, total_floors
            user_provided_crew_size: User-specified crew size (if provided, use as minimum)
        
        Returns:
            Recommended crew size (minimum 2)
        """
        # If user provided crew_size, use it as minimum
        min_crew = 2
        if user_provided_crew_size is not None and user_provided_crew_size > 0:
            min_crew = max(2, user_provided_crew_size)
        
        total_items = job_size.get("total_items", 0)
        total_boxes = job_size.get("total_boxes", 0)
        total_hours_base = job_size.get("total_hours_base", 0.0)
        num_rooms = job_size.get("num_rooms", 0)
        total_floors = job_size.get("total_floors", 1)
        
        # Start with minimum crew size
        crew_size = min_crew
        
        # Add crew based on total items
        if total_items > 30:
            extra_items = total_items - 30
            crew_size += max(0, extra_items // 20)
        
        # Add crew based on total boxes
        if total_boxes > 25:
            extra_boxes = total_boxes - 25
            crew_size += max(0, extra_boxes // 15)
        
        # Add crew based on total hours (base hours)
        if total_hours_base > 12:
            extra_hours = total_hours_base - 12
            crew_size += max(0, int(extra_hours // 8))
        
        # Add crew based on number of rooms
        if num_rooms > 5:
            extra_rooms = num_rooms - 5
            crew_size += max(0, extra_rooms // 5)
        
        # Add crew for multi-floor jobs (stairs make it slower)
        if total_floors >= 3:
            crew_size += 1
        
        # Ensure minimum of 2
        return max(2, crew_size)

    def _calculate_logistics_labor(self, rooms_data: List[Dict[str, Any]], all_materials: Dict[str, float]) -> tuple[float, float]:
        """
        Estimate additional logistics labor to move packed contents between unit ↔ truck ↔ storage.

        - Outbound (pack-out): unit → truck/storage using moving_down multiplier by room floor.
        - Inbound (pack-in): truck/storage → unit using moving_up multiplier by room floor.

        Heuristics per unit:
          - Box handling: 0.05 hr per box each direction
          - Non-box item handling: 0.10 hr per item each direction
          - Storage involvement adds +20% to both directions if any storage codes present
        Boxes recognized as CPS BX*, CPS BXDISH, CPS BXWDR* and aliases.
        """
        # Count total boxes from materials
        box_prefixes = ("CPS BX", "CPS BXDISH", "CPS BXWDR")
        total_boxes = 0.0
        for code, qty in (all_materials or {}).items():
            if code.startswith(box_prefixes):
                total_boxes += float(qty or 0)

        # Distribute boxes across rooms by share of room materials boxes, fallback equal
        room_shares: List[float] = []
        room_box_counts: List[float] = []
        for rd in rooms_data:
            mats = rd.get("materials", {}) or {}
            room_boxes = sum(q for c, q in mats.items() if isinstance(c, str) and (c.startswith(box_prefixes)))
            room_shares.append(room_boxes)
        total_share = sum(room_shares) or len(rooms_data) or 1
        for idx, rd in enumerate(rooms_data):
            share = room_shares[idx] if room_shares[idx] else (1 if total_share == (len(rooms_data) or 1) else 0)
            proportional = (share / total_share) * total_boxes if total_share else 0
            room_box_counts.append(proportional)

        # Count non-box items per room (from room item_count)
        room_item_counts = [int(rd.get("item_count", 0) or 0) for rd in rooms_data]

        # Storage detection (any storage codes present)
        has_storage = any(code.startswith(("CPS STOR", "CPS STOP")) for code in (all_materials or {}).keys())
        storage_factor = 1.2 if has_storage else 1.0

        out_hours = 0.0
        in_hours = 0.0
        for idx, rd in enumerate(rooms_data):
            floor_level = rd.get("floor_level", "MAIN_LEVEL")
            mult_out = FLOOR_MULTIPLIERS.get(floor_level, FLOOR_MULTIPLIERS["MAIN_LEVEL"]).get("moving_down", FLOOR_MULTIPLIERS["MAIN_LEVEL"].get("moving", 1.0))
            mult_in = FLOOR_MULTIPLIERS.get(floor_level, FLOOR_MULTIPLIERS["MAIN_LEVEL"]).get("moving_up", FLOOR_MULTIPLIERS["MAIN_LEVEL"].get("moving", 1.0))

            boxes = room_box_counts[idx]
            items = room_item_counts[idx]

            out_hours += ((boxes * 0.05) + (items * 0.10)) * mult_out
            in_hours += ((boxes * 0.05) + (items * 0.10)) * mult_in

        return out_hours * storage_factor, in_hours * storage_factor

    def _estimate_wrapping_consumables(self, item_input, current_materials: Dict[str, float]) -> Dict[str, float]:
        """
        Estimate bubble wrap (LF), stretch wrap (LF), and packing paper (LB)
        consumption for content packing of fragile/glass items.

        Size-aware heuristics (per item):
          Picture frame / mirror (by size):
            - small:   BWRAP 8 LF,  WRAP 4 LF,  PKPPR 0.25 LB
            - medium:  BWRAP 12 LF, WRAP 6 LF,  PKPPR 0.50 LB
            - large:   BWRAP 18 LF, WRAP 9 LF,  PKPPR 0.75 LB
            - xl:      BWRAP 24 LF, WRAP 12 LF, PKPPR 1.00 LB
          Generic fragile decor (by size):
            - small:   BWRAP 4 LF,  WRAP 2 LF,  PKPPR 0.20 LB
            - medium:  BWRAP 6 LF,  WRAP 3 LF,  PKPPR 0.30 LB
            - large:   BWRAP 9 LF,  WRAP 4.5 LF,PKPPR 0.50 LB
            - xl:      BWRAP 12 LF, WRAP 6 LF,  PKPPR 0.75 LB
        Skips if item is already covered by specific labor/box-with-labor codes (BX..E variants).
        """
        name_lower = (getattr(item_input, 'item_name', '') or '').lower()
        quantity = max(1, int(getattr(item_input, 'quantity', 1) or 1))

        # If materials already include "with labor" packed box codes, skip extra wrap
        packed_box_with_labor_prefixes = ('CPS BX',)
        packed_box_with_labor_suffix = 'E'  # e.g., BXMLE, BXBKE etc.
        for code in (current_materials or {}).keys():
            if code.startswith(packed_box_with_labor_prefixes) and code.endswith(packed_box_with_labor_suffix):
                return {}

        # Detect categories by name
        is_picture = any(k in name_lower for k in ['picture', 'frame'])
        is_mirror = 'mirror' in name_lower
        is_glass = any(k in name_lower for k in ['glass'])
        is_fragile = bool(getattr(item_input, 'fragile', False)) or is_picture or is_mirror or is_glass

        extras: Dict[str, float] = {}

        size_hint = self._detect_item_size_hint(item_input)

        def add_by_size(small_tuple, medium_tuple, large_tuple, xl_tuple):
            if size_hint == 'small':
                b, w, p = small_tuple
            elif size_hint == 'large':
                b, w, p = large_tuple
            elif size_hint == 'xl':
                b, w, p = xl_tuple
            else:
                b, w, p = medium_tuple
            extras['CPS BWRAP'] = extras.get('CPS BWRAP', 0) + b * quantity
            extras['CPS WRAP'] = extras.get('CPS WRAP', 0) + w * quantity
            extras['CPS PKPPR'] = extras.get('CPS PKPPR', 0) + p * quantity

        if is_picture or is_mirror:
            add_by_size(
                small_tuple=(8.0, 4.0, 0.25),
                medium_tuple=(12.0, 6.0, 0.50),
                large_tuple=(18.0, 9.0, 0.75),
                xl_tuple=(24.0, 12.0, 1.0),
            )
        elif is_fragile:
            add_by_size(
                small_tuple=(4.0, 2.0, 0.20),
                medium_tuple=(6.0, 3.0, 0.30),
                large_tuple=(9.0, 4.5, 0.50),
                xl_tuple=(12.0, 6.0, 0.75),
            )

        return extras

    def _detect_item_size_hint(self, item_input) -> str:
        """Infer size hint from explicit size_category or name keywords."""
        explicit = (getattr(item_input, 'size_category', None) or '').lower()
        if explicit in ('small', 'medium', 'large', 'xl'):
            return explicit
        name = (getattr(item_input, 'item_name', '') or '').lower()
        if any(k in name for k in ['small', 'mini', 'tiny']):
            return 'small'
        if any(k in name for k in ['xl', 'extra large', 'oversized', 'over-sized', 'huge']):
            return 'xl'
        if any(k in name for k in ['large', 'big']):
            return 'large'
        if any(k in name for k in ['medium', 'standard', 'regular']):
            return 'medium'
        # Fallback
        return 'medium'

    def _estimate_default_room_boxes(self, room_name: str) -> Dict[str, float]:
        """
        Heuristic default box estimation per room when contents are unspecified.
        Returns mapping of Xactimate codes to quantities.
        """
        if not room_name:
            return {}
        name = (room_name or "").lower()

        # Base heuristics
        if any(k in name for k in ["kitchen", "pantry"]):
            # Dish-heavy
            return {
                "CPS BXDISH": 4,
                "CPS BX MED": 4,
            }
        if any(k in name for k in ["living", "family", "lounge"]):
            return {
                "CPS BX LRG": 4,
                "CPS BX MED": 2,
            }
        if any(k in name for k in ["bath", "bathroom", "powder"]):
            return {
                "CPS BX MED": 2,
            }
        if any(k in name for k in ["bedroom", "master", "guest room"]):
            return {
                "CPS BX MED": 4,
                "CPS BX LRG": 2,
                "CPS BXWDR": 2,  # clothing on hangers
            }
        if any(k in name for k in ["dining"]):
            return {
                "CPS BX LRG": 3,
                "CPS BX MED": 2,
            }
        if any(k in name for k in ["office", "study", "den"]):
            return {
                "CPS BX MED": 3,
                "CPS BX LRG": 2,
            }

        # Default small estimate
        return {
            "CPS BX MED": 2,
        }

    def _adjust_room_boxes_by_size(self, boxes: Dict[str, float], room_name: str) -> Dict[str, float]:
        """
        Scale default box counts by detected room size hints in the room name.
        small: 0.7x, large: 1.3x, xl: 1.6x. Medium/default: 1.0x.
        """
        if not room_name or not boxes:
            return boxes
        name = room_name.lower()
        scale = 1.0
        if any(k in name for k in ["small", "sm", "compact"]):
            scale = 0.7
        elif any(k in name for k in ["xl", "extra large", "grand"]):
            scale = 1.6
        elif any(k in name for k in ["large", "lg", "big"]):
            scale = 1.3
        else:
            scale = 1.0

        if scale == 1.0:
            return boxes

        adjusted: Dict[str, float] = {}
        for code, qty in boxes.items():
            new_qty = max(1, int(math.ceil(qty * scale)))
            adjusted[code] = new_qty
        return adjusted

    def _normalize_item_name(self, item_name: str) -> Optional[str]:
        """
        Normalize item name to match seed mapping keys using intelligent matching

        Uses IntelligentItemMatcher for scalable matching without hardcoded rules
        """
        # Normalize input
        normalized_input = item_name.lower().strip()
        
        # Skip matching if item has "contents" - contents should not match furniture
        has_contents = any(keyword in normalized_input for keyword in [
            '+ contents', '+contents', 'with contents', '& contents', 'and contents', ' contents'
        ])
        if has_contents:
            print(f"🚫 Skipping furniture matching for contents-only item: '{item_name}'")
            return None

        # Direct match first
        if normalized_input in ITEM_MAPPINGS:
            return normalized_input

        # Use intelligent matcher (semantic + similarity)
        matched_key = self.intelligent_matcher.match(item_name)
        if matched_key:
            return matched_key

        # Fallback: Keep only truly edge-case fuzzy rules
        # Most matching is now handled by IntelligentItemMatcher
        essential_fuzzy_rules = {
            # Minimal rules - IntelligentItemMatcher handles most cases
            'pc': 'computer',
            'laptop': 'computer',
        }

        # Check essential fuzzy rules (fallback)
        for key_phrase, mapping_key in essential_fuzzy_rules.items():
            if key_phrase in normalized_input:
                print(f"📋 Essential fuzzy rule match: '{item_name}' → '{mapping_key}'")
                return mapping_key

        # No match found
        return None

    def _old_partial_matching(self, normalized_input: str) -> Optional[str]:
        """
        Legacy partial matching logic (kept for reference, not used)
        IntelligentItemMatcher handles this better
        """
        # Try partial matching - find seed keys that contain input words
        input_words = normalized_input.replace('+', ' ').split()
        for seed_key in ITEM_MAPPINGS.keys():
            seed_words = seed_key.replace('_', ' ').split()
            # Check if any significant word matches (length > 3)
            matches = [w for w in input_words if len(w) > 3 and any(w in sw for sw in seed_words)]
            if len(matches) >= 1:
                return seed_key

        # Similarity-based matching (fuzzy string matching)
        # Calculate similarity scores for all seed keys
        best_match = None
        best_score = 0.0
        threshold = 0.6  # Minimum similarity score (60%)

        for seed_key in ITEM_MAPPINGS.keys():
            # Convert seed key to readable format for comparison
            seed_readable = seed_key.replace('_', ' ')

            # Calculate similarity score
            score = SequenceMatcher(None, normalized_input, seed_readable).ratio()

            # Also check individual word similarities
            input_words_list = normalized_input.split()
            seed_words_list = seed_readable.split()

            # Boost score if key words match
            for input_word in input_words_list:
                if len(input_word) > 3:  # Only check significant words
                    for seed_word in seed_words_list:
                        word_sim = SequenceMatcher(None, input_word, seed_word).ratio()
                        if word_sim > 0.8:  # Strong word match
                            score += 0.2  # Bonus points

            if score > best_score and score >= threshold:
                best_score = score
                best_match = seed_key

        if best_match:
            print(f"🔍 Similarity match: '{normalized_input}' → '{best_match}' (score: {best_score:.2f})")
            return best_match

        return None

    def _get_materials_for_item(self, item_input) -> Dict[str, float]:
        """Get Xactimate materials for an item"""
        # Check if item has "+ contents" or "with contents" (check at end or anywhere)
        item_name_lower = item_input.item_name.lower()
        has_contents = any(keyword in item_name_lower for keyword in [
            '+ contents', '+contents', 'with contents', '& contents', 'and contents', ' contents'
        ])
        
        # Debug log
        if has_contents:
            print(f"🔍 Contents detected in: '{item_input.item_name}'")

        # Remove contents suffix for matching
        base_item_name = item_input.item_name
        if has_contents:
            for suffix in [' + contents', ' +contents', ' with contents', ' & contents', ' and contents']:
                if suffix in item_name_lower:
                    # Remove suffix but preserve original capitalization where possible
                    idx = item_name_lower.index(suffix)
                    base_item_name = item_input.item_name[:idx].strip()
                    break
            print(f"📦 Detected contents: '{item_input.item_name}' → base item: '{base_item_name}'")

        # If contents detected, ONLY use contents materials (no furniture materials)
        if has_contents:
            # Use intelligent contents estimator - ONLY for contents, not furniture
            furniture_type = ContentsEstimator._detect_furniture_type(base_item_name.lower())
            contents_estimate = ContentsEstimator.estimate_contents(
                item_input.item_name,
                furniture_type=furniture_type
            )

            print(f"📦 Contents-only estimation: '{item_input.item_name}' → furniture: {furniture_type}")
            print(f"   Contents estimation: {contents_estimate.get('reasoning', 'N/A')}")
            print(f"   Boxes: {contents_estimate['boxes_needed']}, "
                  f"Packing hours: {contents_estimate['packing_hours']}, "
                  f"Confidence: {contents_estimate['confidence']:.0%}")

            # Use ONLY contents materials (no furniture PAD, WRAP, etc.)
            materials = dict(contents_estimate['line_items'])
            
            print(f"📦 Contents materials (NO furniture materials): {materials}")
            print(f"   Expected box type: {contents_estimate.get('line_items', {}).keys()}")

            # Track contents estimation for display in Fuzzy Matching Details
            self.contents_estimations.append({
                "original_name": item_input.item_name,
                "matched_key": f"{furniture_type}_contents" if furniture_type else "contents",
                "matched_materials": materials,
                "quantity": item_input.quantity,
                "estimation_type": "contents",
                "reasoning": contents_estimate.get('reasoning', ''),
                "boxes_needed": contents_estimate.get('boxes_needed', 0),
                "confidence": contents_estimate.get('confidence', 0.0),
            })

            # Store packing hours for later use in labor calculation
            if not hasattr(item_input, '_contents_packing_hours'):
                item_input._contents_packing_hours = contents_estimate['packing_hours']
            
            return materials

        # If NO contents, proceed with furniture matching
        # Try database mapping first
        mapping = self.mapping_repo.get_by_item_name(base_item_name)

        if mapping:
            # Increment usage count
            self.mapping_repo.increment_usage(mapping["id"])
            materials = dict(mapping["xactimate_materials"])
            print(f"✅ Found DB mapping for '{base_item_name}': {materials}")
        elif base_item_name in ITEM_MAPPINGS:
            # Try exact match in seed data
            materials = dict(ITEM_MAPPINGS[base_item_name]["materials"])
            print(f"✅ Found exact seed mapping for '{base_item_name}': {materials}")
        else:
            # Try fuzzy matching
            normalized_key = self._normalize_item_name(base_item_name)
            if normalized_key and normalized_key in ITEM_MAPPINGS:
                materials = dict(ITEM_MAPPINGS[normalized_key]["materials"])
                self.fuzzy_matching_used = True  # Track fuzzy matching usage

                # Store fuzzy match details for AI insights
                self.fuzzy_matches.append({
                    "original_name": item_input.item_name,
                    "matched_key": normalized_key,
                    "matched_materials": materials,
                    "quantity": item_input.quantity
                })

                print(f"✅ Found fuzzy seed mapping: '{base_item_name}' → '{normalized_key}': {materials}")
            else:
                # Debug: show what we're looking for
                print(f"⚠️ No mapping found for item: '{base_item_name}'")
                print(f"   Available seed mappings (first 10): {list(ITEM_MAPPINGS.keys())[:10]}")

                # Default fallback - medium box
                materials = {"CPS BX": 1, "CPS BWRAP": 10}

        return materials

    

    def _estimate_contents_boxes(self, base_item_name: str) -> int:
        """
        Estimate number of boxes needed for contents based on furniture type
        Returns number of additional boxes needed
        """
        item_lower = base_item_name.lower()

        # Large storage furniture (lots of contents)
        if any(keyword in item_lower for keyword in [
            'bookshelf', 'bookcase', 'shelf', 'shelving',
            'dresser', 'chest', 'cabinet', 'wardrobe', 'armoire', 'closet'
        ]):
            # Size-based estimation
            if any(size in item_lower for size in ['small', 'compact', 'short', '3 drawer', '4 drawer']):
                return 2  # 2 boxes for small storage furniture
            elif any(size in item_lower for size in ['medium', 'standard', '5 drawer', '6 drawer']):
                return 3  # 3 boxes for medium storage furniture
            elif any(size in item_lower for size in ['large', 'tall', 'big', '7 drawer', '8 drawer']):
                return 4  # 4 boxes for large storage furniture
            else:
                return 3  # Default for unspecified storage furniture

        # Desks (moderate contents)
        elif any(keyword in item_lower for keyword in ['desk', 'table']):
            if 'coffee' in item_lower or 'side' in item_lower or 'end' in item_lower:
                return 1  # Small tables
            elif 'dining' in item_lower or 'kitchen' in item_lower:
                return 2  # Dining tables
            else:
                return 2  # Desks typically have drawers

        # Entertainment centers (moderate contents)
        elif any(keyword in item_lower for keyword in ['entertainment', 'tv stand', 'media']):
            return 2

        # Default: 1 box for items with unspecified contents
        else:
            return 1

    def _calculate_item_labor(
        self,
        item_input,
        is_pack_out: bool = True
    ) -> tuple[float, float]:
        """Calculate packing and moving hours for an item"""
        item_name_lower = item_input.item_name.lower()
        
        # Check if item has "contents" - if so, use ONLY contents labor, no furniture labor
        has_contents = any(keyword in item_name_lower for keyword in [
            '+ contents', '+contents', 'with contents', '& contents', 'and contents', ' contents'
        ])
        
        if has_contents:
            # Contents-only: use contents packing hours only (no furniture moving hours)
            if hasattr(item_input, '_contents_packing_hours'):
                packing_hours = item_input._contents_packing_hours
                print(f"📦 Contents-only labor: '{item_input.item_name}' → {packing_hours:.2f}h (contents only, no furniture)")
            else:
                # Fallback: estimate contents packing (should have been set by _get_materials_for_item)
                # Use ContentsEstimator to get packing hours
                furniture_type = ContentsEstimator._detect_furniture_type(item_name_lower)
                contents_estimate = ContentsEstimator.estimate_contents(
                    item_input.item_name,
                    furniture_type=furniture_type
                )
                packing_hours = contents_estimate['packing_hours']
                print(f"📦 Contents-only labor (fallback): '{item_input.item_name}' → {packing_hours:.2f}h")
            # Contents don't need furniture moving - just boxes moving
            moving_hours = 0.1  # Minimal moving for boxes only
            return (packing_hours, moving_hours)
        
        # For furniture (no contents): try database mapping
        mapping = self.mapping_repo.get_by_item_name(item_input.item_name)

        if mapping:
            packing_hours = mapping.get("packing_hours_base") or 0.3
            moving_hours = mapping.get("moving_hours_base") or 0.2
        elif item_input.item_name in ITEM_MAPPINGS:
            # Try exact match in seed data
            item_data = ITEM_MAPPINGS[item_input.item_name]
            packing_hours = item_data.get("packing_hours", 0.3)
            moving_hours = item_data.get("moving_hours", 0.2)
        else:
            # Try fuzzy matching
            normalized_key = self._normalize_item_name(item_input.item_name)
            if normalized_key and normalized_key in ITEM_MAPPINGS:
                item_data = ITEM_MAPPINGS[normalized_key]
                print(f"✅ Found fuzzy labor mapping: '{item_input.item_name}' → '{normalized_key}'")
                packing_hours = item_data.get("packing_hours", 0.3)
                moving_hours = item_data.get("moving_hours", 0.2)
            else:
                # Default fallback
                packing_hours = 0.3
                moving_hours = 0.2

        # Add contents packing hours if available (from contents estimator)
        # This handles cases where furniture AND contents are both packed
        if hasattr(item_input, '_contents_packing_hours'):
            print(f"   Adding contents packing hours: {item_input._contents_packing_hours:.2f}h")
            packing_hours += item_input._contents_packing_hours

        return (packing_hours, moving_hours)

    def _calculate_protection(self, building_info) -> Dict[str, float]:
        """Calculate protection materials needed"""
        building_type = building_info.building_type
        total_floors = building_info.total_floors
        has_elevator = building_info.has_elevator
        
        self.logger.debug(
            f"[PackCalc] _calculate_protection: building_type={building_type}, "
            f"total_floors={total_floors}, has_elevator={has_elevator}"
        )
        
        factors = PROTECTION_FACTORS.get(building_type, PROTECTION_FACTORS["house"])

        # Calculate common area SF
        common_area_sf = factors["base_sf"]
        if total_floors > 1:
            additional_sf = (total_floors - 1) * factors["per_floor_sf"]
            common_area_sf += additional_sf
            self.logger.debug(
                f"[PackCalc] Multi-floor: base={factors['base_sf']}, "
                f"additional={additional_sf}, total={common_area_sf}"
            )

        protection = {
            "CON RAMBD": common_area_sf,  # Ramboard floor protection (SF unit)
        }

        # Add stair protection if no elevator
        if not has_elevator and total_floors > 1:
            stairs_sf = total_floors * 40
            protection["HMR BARR"] = stairs_sf
            self.logger.debug(f"[PackCalc] Added stair protection: {stairs_sf} SF")

        # Add corner/door protection
        protection["TMC CCC"] = max(1, total_floors)  # Corner protection rolls

        self.logger.debug(f"[PackCalc] Final protection: {protection}")
        return protection

    def _build_protection_explanation(
        self,
        building_info: Dict[str, Any] | None = None,
        building_type: str | None = None,
        protection_dict: Dict[str, float] | None = None
    ) -> str:
        """
        Generate protection explanation at calculation level.
        Protection is shared across all rooms.
        Uses actual calculated values from protection_dict if provided.
        """
        # Use actual calculated values if available, but also show calculation formula
        if protection_dict:
            # Get actual values from protection_dict
            floor_prot = protection_dict.get("CON RAMBD") or protection_dict.get("CON PROT") or protection_dict.get("CON PLSTC")
            stairs_prot = protection_dict.get("HMR BARR")
            corner_prot = protection_dict.get("TMC CCC")
            
            # If we have building_info, show calculation formula with actual values
            if building_info:
                bt_raw = building_info.get("building_type", building_type or "house")
                if hasattr(bt_raw, 'value'):
                    bt_str = bt_raw.value
                elif isinstance(bt_raw, str):
                    bt_str = bt_raw
                else:
                    bt_str = str(bt_raw)
                total_floors = building_info.get("total_floors", 1)
                has_elevator = building_info.get("has_elevator", False)
                
                factors = PROTECTION_FACTORS.get(bt_str.lower(), PROTECTION_FACTORS["house"])
                base_sf = factors["base_sf"]
                per_floor_sf = factors["per_floor_sf"]
                
                parts = []
                if floor_prot:
                    # Show calculation formula for floor protection with area descriptions
                    if total_floors == 1:
                        parts.append(
                            f"floor protection: {int(floor_prot)} SF covering entry, hallway, and foyer areas"
                        )
                    else:
                        calculated_sf = base_sf + (total_floors - 1) * per_floor_sf
                        parts.append(
                            f"floor protection: {int(floor_prot)} SF = entry/hallway/foyer ({base_sf} SF) + stair landings ({total_floors - 1} floors × {per_floor_sf} SF/floor)"
                        )
                
                if stairs_prot:
                    parts.append(f"stair protection: {int(stairs_prot)} SF covering all stairways ({total_floors} floors × 40 SF)")
                
                if corner_prot:
                    parts.append(f"corner protection: {int(corner_prot)} roll(s) for doorways and corners")
                
                if parts:
                    return f"Protection calculated as: {', '.join(parts)}."
            
            # If no building_info but we have protection_dict values, show them
            parts = []
            if floor_prot:
                parts.append(f"floor protection: {int(floor_prot)} SF")
            if stairs_prot:
                parts.append(f"stair protection: {int(stairs_prot)} SF")
            if corner_prot:
                parts.append(f"corner protection: {int(corner_prot)} roll(s)")
            
            if parts:
                return f"Protection calculated as: {', '.join(parts)}."
        
        # Fallback: calculate from building info if protection_dict not available
        if building_info:
            bt_raw = building_info.get("building_type", building_type or "house")
            # Convert enum to string if needed
            if hasattr(bt_raw, 'value'):
                bt_str = bt_raw.value
            elif isinstance(bt_raw, str):
                bt_str = bt_raw
            else:
                bt_str = str(bt_raw)
            total_floors = building_info.get("total_floors", 1)
            has_elevator = building_info.get("has_elevator", False)
            
            factors = PROTECTION_FACTORS.get(bt_str.lower(), PROTECTION_FACTORS["house"])
            base_sf = factors["base_sf"]
            per_floor_sf = factors["per_floor_sf"]
            
            # Calculate common area SF
            common_area_sf = base_sf
            if total_floors > 1:
                common_area_sf += (total_floors - 1) * per_floor_sf
            
            # Build explanation with actual area names
            parts = []
            if total_floors == 1:
                parts.append(
                    f"floor protection: {int(common_area_sf)} SF covering entry, hallway, and foyer areas"
                )
            else:
                parts.append(
                    f"floor protection: {int(common_area_sf)} SF = entry/hallway/foyer ({base_sf} SF) + stair landings ({total_floors - 1} floors × {per_floor_sf} SF/floor)"
                )
            
            if not has_elevator and total_floors > 1:
                stairs_sf = total_floors * 40
                parts.append(f"stair protection: {int(stairs_sf)} SF covering all stairways ({total_floors} floors × 40 SF)")
            
            parts.append(f"corner protection: {max(1, total_floors)} roll(s) for doorways and corners")
            
            return f"Protection calculated as: {', '.join(parts)}."
        else:
            # Fallback
            bt = (building_type or 'building').lower()
            return f"Protection estimated for {bt} (shared common areas and access routes)."

    def _calculate_debris(
        self,
        materials: Dict[str, float],
        protection: Dict[str, float]
    ) -> Dict[str, float]:
        """Calculate debris from packing materials"""
        # Cardboard from boxes (include all box types)
        total_boxes = sum([
            materials.get("CPS BX<", 0),
            materials.get("CPS BX", 0),
            materials.get("CPS BX>", 0),
            materials.get("CPS BX>>", 0),
            materials.get("CPS BXDISH", 0),
            materials.get("CPS BXWDR", 0),
            materials.get("CPS BXBK", 0),  # Book box
            materials.get("CPS BX SML", 0),  # Alias
            materials.get("CPS BX MED", 0),  # Alias
            materials.get("CPS BX LRG", 0),  # Alias
            materials.get("CPS BX XL", 0),  # Alias
            materials.get("TMC BX", 0),
            materials.get("TMC BX<", 0),
            materials.get("TMC BX>", 0),
            materials.get("TMC BX>>", 0),
            materials.get("TMC BXBK", 0),
            materials.get("TMC BXDISH", 0),
            materials.get("TMC BXGL", 0),
        ])
        cardboard_lb = total_boxes * DEBRIS_FACTORS["cardboard_lb_per_box"]

        # Plastic from bubble wrap
        bubble_wrap_ft = materials.get("CPS BWRAP", 0) + materials.get("CPS BWRAP>", 0) * 2
        plastic_wrap_lb = bubble_wrap_ft * DEBRIS_FACTORS["plastic_lb_per_ft_wrap"]

        # Plastic from stretch film
        stretch_rolls = materials.get("CPS WRAP", 0)
        plastic_stretch_lb = stretch_rolls * DEBRIS_FACTORS["plastic_lb_per_roll_stretch"]

        # Paper - check for actual packing paper in materials first
        # CPS PKPPR is in LB (pounds), so use directly
        paper_lb_from_materials = materials.get("CPS PKPPR", 0)
        
        # TMC PPB is in EA (bundles), convert to LB
        # Each bundle is ~625 sheets of 24"x36" paper, approximately 50 lbs per bundle
        paper_bundles = materials.get("TMC PPB", 0)
        paper_lb_from_bundles = paper_bundles * 50.0  # ~50 lbs per bundle
        
        # If explicit paper materials found, use them; otherwise estimate from boxes
        if paper_lb_from_materials > 0 or paper_lb_from_bundles > 0:
            paper_lb = paper_lb_from_materials + paper_lb_from_bundles
        else:
            # Fallback: estimate based on boxes (legacy behavior)
            paper_lb = total_boxes * DEBRIS_FACTORS["paper_lb_per_box"]

        # Total
        total_debris_lb = cardboard_lb + plastic_wrap_lb + plastic_stretch_lb + paper_lb

        return {
            "cardboard_recyclable_lb": cardboard_lb,
            "cardboard_recyclable_ton": cardboard_lb / 2000,
            "plastic_waste_lb": plastic_wrap_lb + plastic_stretch_lb,
            "paper_waste_lb": paper_lb,
            "total_debris_lb": total_debris_lb,
            "total_debris_ton": total_debris_lb / 2000,
        }

    def format_calculation_response(
        self,
        calculation: Dict[str, Any],
        rooms_data: List[Dict[str, Any]] = []
    ) -> PackCalculationResult:
        """Format calculation for API response"""
        import json

        # Helper to parse JSON fields that might be strings
        def parse_json_field(field_value):
            if isinstance(field_value, str):
                try:
                    return json.loads(field_value)
                except (json.JSONDecodeError, TypeError):
                    return {}
            return field_value or {}

        # Helper to create XactimateLineItem with description and unit
        def create_line_item(code: str, quantity: float, category: str, ml_used: bool = False, confidence: float = None):
            item_info = XACTIMATE_LINE_ITEMS.get(code, {})
            unit = item_info.get("unit", "EA")
            description = item_info.get("description", "")

            # Debug log for unit mapping
            if not item_info:
                print(f"⚠️ Code '{code}' not found in XACTIMATE_LINE_ITEMS")

            return XactimateLineItem(
                code=code,
                description=description,
                unit=unit,
                quantity=quantity,
                category=category,
                ml_used=ml_used,
                confidence=confidence,
            )

        # Convert materials dict to XactimateLineItem list with descriptions
        pack_out_materials_dict = parse_json_field(calculation.get("xactimate_pack_out_materials"))
        print(f"🔍 Pack out materials codes: {list(pack_out_materials_dict.keys())}")
        pack_out_materials = [
            create_line_item(
                code=code,
                quantity=qty,
                category="CPS",
                ml_used=calculation.get("ml_used", False),
                confidence=calculation.get("ml_confidence"),
            )
            for code, qty in pack_out_materials_dict.items()
        ]

        pack_out_labor_dict = parse_json_field(calculation.get("xactimate_pack_out_labor"))
        pack_out_labor = [
            create_line_item(code=code, quantity=qty, category="CPS")
            for code, qty in pack_out_labor_dict.items()
        ]

        protection_dict = parse_json_field(calculation.get("xactimate_protection"))
        protection = [
            create_line_item(
                code=code,
                quantity=qty,
                category="CON" if "CON" in code else "HMR",
            )
            for code, qty in protection_dict.items()
        ]
        
        # Build protection explanation at calculation level using actual calculated values
        # Always use building info from calculation fields to ensure accuracy
        building_info_for_prot = {
            "building_type": calculation.get("building_type"),
            "total_floors": calculation.get("total_floors", 1),
            "has_elevator": calculation.get("has_elevator", False),
        }
        # If building_info JSON exists, use it (might have more details)
        if calculation.get("building_info"):
            parsed_building_info = parse_json_field(calculation.get("building_info"))
            if parsed_building_info:
                building_info_for_prot.update(parsed_building_info)
        
        # Debug: log building info for protection calculation
        self.logger.debug(
            f"[PackCalc] Protection explanation: building_type={building_info_for_prot.get('building_type')}, "
            f"total_floors={building_info_for_prot.get('total_floors')}, "
            f"has_elevator={building_info_for_prot.get('has_elevator')}, "
            f"protection_dict={protection_dict}"
        )
        
        protection_explanation = self._build_protection_explanation(
            building_info=building_info_for_prot,
            building_type=calculation.get("building_type"),
            protection_dict=protection_dict  # Pass actual calculated values
        )

        pack_in_labor_dict = parse_json_field(calculation.get("xactimate_pack_in_labor"))
        pack_in_labor = [
            create_line_item(code=code, quantity=qty, category="CPS")
            for code, qty in pack_in_labor_dict.items()
        ]

        debris_data = parse_json_field(calculation.get("xactimate_debris"))
        if not debris_data:
            debris_data = {
                "cardboard_recyclable_lb": 0,
                "cardboard_recyclable_ton": 0,
                "plastic_waste_lb": 0,
                "paper_waste_lb": 0,
                "total_debris_lb": 0,
                "total_debris_ton": 0,
            }
        debris = DebrisBreakdown(**debris_data)

        strategies_data = parse_json_field(calculation.get("strategies_used"))
        if not strategies_data:
            strategies_data = {
                "material_estimation": "rule_based",
                "labor_calculation": "item_based",
                "protection_estimate": "estimated",
                "debris_calculation": "material_based",
                "fuzzy_matching_used": False,
                "fuzzy_matches": [],
            }

        # Fix old data format: {'material': 'rule_based', ...} → {'material_estimation': 'rule_based', ...}
        if 'material' in strategies_data and 'material_estimation' not in strategies_data:
            strategies_data['material_estimation'] = strategies_data.pop('material')
        if 'labor' in strategies_data and 'labor_calculation' not in strategies_data:
            strategies_data['labor_calculation'] = strategies_data.pop('labor')
        if 'protection' in strategies_data and 'protection_estimate' not in strategies_data:
            strategies_data['protection_estimate'] = strategies_data.pop('protection')
        if 'debris' in strategies_data and 'debris_calculation' not in strategies_data:
            strategies_data['debris_calculation'] = strategies_data.pop('debris')

        # Ensure all required fields exist
        strategies_data.setdefault('material_estimation', 'rule_based')
        strategies_data.setdefault('labor_calculation', 'item_based')
        strategies_data.setdefault('protection_estimate', 'estimated')
        strategies_data.setdefault('debris_calculation', 'material_based')
        strategies_data.setdefault('fuzzy_matching_used', False)
        strategies_data.setdefault('fuzzy_matches', [])

        strategies = StrategiesUsed(**strategies_data)

        # Format room breakdown
        room_breakdowns = []
        for room_data in rooms_data:
            materials_dict = room_data.get("materials", {})
            # Ensure materials_dict is a dict and not None
            if not isinstance(materials_dict, dict):
                materials_dict = {}
            
            print(f"🔍 Formatting room {room_data.get('room_name')}: materials_dict={materials_dict}, type={type(materials_dict)}")
            
            room_materials = [
                create_line_item(code=code, quantity=qty, category="CPS")
                for code, qty in materials_dict.items()
                if isinstance(code, str) and isinstance(qty, (int, float)) and qty > 0
            ]
            
            print(f"🔍 Converted to {len(room_materials)} line items")
            
            # Create pack-out labor line item for this room
            pack_out_hours = room_data.get("pack_out_labor_hours", 0)
            pack_out_labor = []
            if pack_out_hours > 0:
                pack_out_labor = [
                    create_line_item(code="CPS LAB", quantity=pack_out_hours, category="CPS")
                ]
            
            room_breakdowns.append(RoomBreakdown(
                room_id=room_data["room_id"],
                room_name=room_data["room_name"],
                floor_level=room_data["floor_level"],
                materials=room_materials,
                pack_out_labor=pack_out_labor,
                pack_out_labor_hours=pack_out_hours,
                pack_in_labor_hours=room_data.get("pack_in_labor_hours", 0),
                item_count=room_data.get("item_count", 0),
                explanation_pack_out=room_data.get("explanation_pack_out"),
                explanation_protection=room_data.get("explanation_protection"),
                explanation_pack_in=room_data.get("explanation_pack_in"),
            ))

        # Parse created_at to ensure it's a datetime object
        from datetime import datetime
        created_at = calculation["created_at"]
        if isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00'))

        # Get crew_size from calculation or building_info
        crew_size = calculation.get("crew_size", 1)
        if not crew_size and building_info_for_prot:
            crew_size = building_info_for_prot.get("crew_size", 1)

        return PackCalculationResult(
            id=calculation["id"],
            calculation_name=calculation["calculation_name"],
            pack_out_materials=pack_out_materials,
            pack_out_labor=pack_out_labor,
            protection=protection,
            pack_in_labor=pack_in_labor,
            rooms=room_breakdowns,
            debris=debris,
            total_pack_out_hours=calculation.get("total_pack_out_hours") or 0,
            total_pack_in_hours=calculation.get("total_pack_in_hours") or 0,
            total_protection_sf=calculation.get("total_protection_sf") or 0,
            crew_size=crew_size,
            explanation_protection=protection_explanation,
            ml_confidence=calculation.get("ml_confidence") or 0.8,
            needs_review=calculation.get("needs_review") or False,
            strategies_used=strategies,
            auto_selected=True,
            created_at=created_at,
            created_by_id=calculation["created_by_id"],
        )

    def format_detail_response(
        self,
        calculation
    ):
        """Format calculation with full details including rooms and items for editing"""
        import json
        from app.domains.pack_calculation.schemas import (
            PackCalculationDetailResponse,
            PackRoomResponse,
            PackItemResponse,
            BuildingInfo,
        )
        
        print(f"🔍 format_detail_response START: calculation type={type(calculation)}")

        # Helper to parse JSON fields
        def parse_json_field(field_value):
            if isinstance(field_value, str):
                try:
                    return json.loads(field_value)
                except (json.JSONDecodeError, TypeError):
                    return {}
            return field_value or {}

        # Keep original calculation object if it's SQLAlchemy, we'll need to access relationships directly
        original_calculation = calculation
        calculation_dict = None
        
        # Convert SQLAlchemy model to dict if needed, but keep original for direct relationship access
        if not isinstance(calculation, dict):
            print(f"🔍 Converting calculation from {type(calculation)} to dict")
            calculation_dict = self.calc_repo._convert_to_dict(calculation)
            print(f"🔍 After conversion: type={type(calculation_dict)}, has rooms={calculation_dict.get('rooms') is not None}")
            if calculation_dict.get("rooms"):
                print(f"🔍 Rooms count: {len(calculation_dict.get('rooms'))}, first room type={type(calculation_dict['rooms'][0]) if calculation_dict['rooms'] else 'N/A'}")
        else:
            calculation_dict = calculation
            
        # Use calculation_dict for most operations, but original_calculation for direct SQLAlchemy relationship access
        calculation = calculation_dict

        # Prepare room breakdown data for basic response
        rooms_breakdown_data = []
        print(f"🔍 format_detail_response: calculation type={type(calculation)}, has rooms={calculation.get('rooms') is not None}")
        if calculation.get("rooms"):
            print(f"🔍 Found {len(calculation.get('rooms'))} rooms in calculation")
            
            # Try to get rooms from original SQLAlchemy object if available
            sqlalchemy_rooms = None
            if hasattr(original_calculation, 'rooms'):
                sqlalchemy_rooms = list(original_calculation.rooms)
                print(f"🔍 Got {len(sqlalchemy_rooms)} rooms from SQLAlchemy object")
            
            for idx, room_obj in enumerate(calculation["rooms"]):
                print(f"🔍 Processing room {idx}: type={type(room_obj)}")
                room = room_obj if isinstance(room_obj, dict) else self.calc_repo._convert_to_dict(room_obj)
                
                # Get corresponding SQLAlchemy room object if available
                sqlalchemy_room = None
                if sqlalchemy_rooms and idx < len(sqlalchemy_rooms):
                    sqlalchemy_room = sqlalchemy_rooms[idx]
                    print(f"🔍 Got SQLAlchemy room object for room {idx}")
                
                print(f"🔍 Room after conversion: type={type(room)}, keys={list(room.keys()) if isinstance(room, dict) else 'not dict'}, has items={room.get('items') is not None}")

                # Aggregate materials from all items in the room
                room_materials = {}
                item_count = 0
                room_pack_out_hours = 0.0
                room_pack_in_hours = 0.0
                # Track pack-in labor components for explanation
                total_item_moving_hours = 0.0
                logistics_in_hours_for_room = 0.0
                
                # First, get materials directly from room if they exist
                room_level_materials = parse_json_field(room.get("xactimate_materials"))
                print(f"🔍 Room {room.get('room_name')}: room_level_materials={room_level_materials}")
                if room_level_materials:
                    for code, qty in room_level_materials.items():
                        if isinstance(code, str) and isinstance(qty, (int, float)):
                            room_materials[code] = room_materials.get(code, 0) + float(qty)
                
                # Check if items are loaded - prioritize SQLAlchemy object for direct relationship access
                items = None
                if sqlalchemy_room and hasattr(sqlalchemy_room, 'items'):
                    # Use SQLAlchemy object's items relationship directly
                    try:
                        items_list = list(sqlalchemy_room.items) if sqlalchemy_room.items else []
                        print(f"🔍 SQLAlchemy room has {len(items_list)} items")
                        if items_list:
                            items = [self.calc_repo._convert_to_dict(item) for item in items_list]
                            print(f"🔍 Converted {len(items)} items from SQLAlchemy")
                    except Exception as e:
                        print(f"🔍 Error accessing items from SQLAlchemy object: {e}")
                        import traceback
                        traceback.print_exc()
                        items = None
                
                # Fallback to dict items if SQLAlchemy didn't work
                if not items and isinstance(room, dict):
                    items = room.get("items")
                    print(f"🔍 Fallback: Got {len(items) if items else 0} items from dict")
                elif not items and hasattr(room, 'items'):
                    # If room is still a SQLAlchemy object, try to access items directly
                    try:
                        items_list = list(room.items) if room.items else []
                        if items_list:
                            items = [self.calc_repo._convert_to_dict(item) for item in items_list]
                    except Exception as e:
                        print(f"🔍 Error accessing items from room object: {e}")
                        items = None
                
                print(f"🔍 Room {room.get('room_name') if isinstance(room, dict) else getattr(room, 'room_name', 'Unknown')}: items={items}, type={type(items)}, items_len={len(items) if items else 0}")
                if items and len(items) > 0:
                    item_count = len(items)
                    print(f"🔍 Room {room.get('room_name')}: Processing {item_count} items")
                    for item_obj in items:
                        item = item_obj if isinstance(item_obj, dict) else self.calc_repo._convert_to_dict(item_obj)
                        print(f"🔍 Item: {item.get('item_name')}, xactimate_materials_raw={item.get('xactimate_materials')}, type={type(item.get('xactimate_materials'))}, item_keys={list(item.keys()) if isinstance(item, dict) else 'N/A'}")
                        
                        # Try to get materials from SQLAlchemy object directly if item_obj is not dict
                        if item.get("xactimate_materials") is None and not isinstance(item_obj, dict) and hasattr(item_obj, 'xactimate_materials'):
                            print(f"🔍 Trying to get xactimate_materials from SQLAlchemy object directly")
                            try:
                                sqlalchemy_materials = item_obj.xactimate_materials
                                print(f"🔍 SQLAlchemy xactimate_materials: {sqlalchemy_materials}, type={type(sqlalchemy_materials)}")
                                if sqlalchemy_materials is not None:
                                    if isinstance(sqlalchemy_materials, dict):
                                        item["xactimate_materials"] = sqlalchemy_materials
                                    else:
                                        # Try to convert if it's a JSONB wrapper
                                        import json
                                        if hasattr(sqlalchemy_materials, 'astext'):
                                            item["xactimate_materials"] = json.loads(sqlalchemy_materials.astext) if sqlalchemy_materials.astext else {}
                                        elif hasattr(sqlalchemy_materials, 'data'):
                                            item["xactimate_materials"] = sqlalchemy_materials.data
                                        else:
                                            item["xactimate_materials"] = dict(sqlalchemy_materials) if sqlalchemy_materials else {}
                                    print(f"🔍 Extracted materials from SQLAlchemy: {item.get('xactimate_materials')}")
                            except Exception as e:
                                print(f"🔍 Error getting materials from SQLAlchemy: {e}")
                                import traceback
                                traceback.print_exc()
                        
                        item_materials = parse_json_field(item.get("xactimate_materials"))
                        print(f"🔍 Item {item.get('item_name')}: parsed materials={item_materials}, len={len(item_materials) if item_materials else 0}")
                        
                        # If materials are empty or None, try to recalculate them
                        if not item_materials or len(item_materials) == 0:
                            print(f"🔍 Item {item.get('item_name')}: materials empty, attempting to recalculate")
                            try:
                                # Reconstruct item input to recalculate materials
                                from types import SimpleNamespace
                                item_input_recalc = SimpleNamespace(
                                    item_name=item.get("item_name", ""),
                                    item_category=item.get("item_category"),
                                    quantity=item.get("quantity", 1),
                                    size_category=item.get("size_category"),
                                    floor_level=item.get("floor_level"),
                                    fragile=item.get("fragile", False),
                                    requires_disassembly=item.get("requires_disassembly", False),
                                    special_notes=item.get("special_notes"),
                                )
                                recalc_materials = self._get_materials_for_item(item_input_recalc)
                                # Add wrapping consumables
                                wrap_consumables = self._estimate_wrapping_consumables(item_input_recalc, recalc_materials)
                                if wrap_consumables:
                                    for code, qty in wrap_consumables.items():
                                        recalc_materials[code] = recalc_materials.get(code, 0) + qty
                                item_materials = recalc_materials
                                print(f"🔍 Item {item.get('item_name')}: recalculated materials={item_materials}, len={len(item_materials)}")
                            except Exception as e:
                                print(f"🔍 Error recalculating materials: {e}")
                                import traceback
                                traceback.print_exc()
                        
                        if item_materials:
                            for code, qty in item_materials.items():
                                if isinstance(code, str) and isinstance(qty, (int, float)):
                                    room_materials[code] = room_materials.get(code, 0) + float(qty)
                                    print(f"🔍 Added {code}: {qty} to room_materials")

                        # Calculate pack-out and pack-in labor for this item
                        item_floor = item.get("floor_level") or room.get("floor_level", "MAIN_LEVEL")
                        quantity = item.get("quantity", 1)
                        # Reconstruct item-like object for labor calculation
                        from types import SimpleNamespace
                        item_for_labor = SimpleNamespace(
                            item_name=item.get("item_name", ""),
                            quantity=quantity,
                            floor_level=item_floor,
                            fragile=item.get("fragile", False),
                            requires_disassembly=item.get("requires_disassembly", False),
                        )
                        # Pack-out labor
                        packing_hours, moving_hours = self._calculate_item_labor(item_for_labor, is_pack_out=True)
                        floor_mult_out = FLOOR_MULTIPLIERS.get(
                            item_floor,
                            FLOOR_MULTIPLIERS["MAIN_LEVEL"]
                        )
                        moving_hours_out = moving_hours * floor_mult_out.get("moving_down", floor_mult_out.get("moving", 1.0))
                        room_pack_out_hours += (packing_hours + moving_hours_out) * quantity
                        
                        # Pack-in labor
                        unpacking_hours = 0.0
                        _, moving_hours_base = self._calculate_item_labor(item_for_labor, is_pack_out=False)
                        floor_mult_in = FLOOR_MULTIPLIERS.get(
                            item_floor,
                            FLOOR_MULTIPLIERS["MAIN_LEVEL"]
                        )
                        moving_mult = floor_mult_in.get("moving_up", floor_mult_in.get("moving", 1.0))
                        moving_hours_in = moving_hours_base * moving_mult
                        item_pack_in_hours = (unpacking_hours + moving_hours_in) * quantity
                        room_pack_in_hours += item_pack_in_hours
                        total_item_moving_hours += item_pack_in_hours

                # Calculate logistics labor for this room (truck/storage movement)
                room_floor = room.get("floor_level", "MAIN_LEVEL")
                box_prefixes = ("CPS BX", "CPS BXDISH", "CPS BXWDR")
                room_box_count = sum(
                    qty for code, qty in room_materials.items()
                    if isinstance(code, str) and code.startswith(box_prefixes)
                )
                
                # Check if storage is involved (from calculation-level materials)
                calculation_materials = parse_json_field(calculation.get("xactimate_pack_out_materials") or {})
                has_storage = any(
                    code.startswith(("CPS STOR", "CPS STOP"))
                    for code in (calculation_materials or {}).keys()
                )
                storage_factor = 1.2 if has_storage else 1.0

                # Logistics labor calculation (outbound and inbound)
                mult_out = FLOOR_MULTIPLIERS.get(
                    room_floor,
                    FLOOR_MULTIPLIERS["MAIN_LEVEL"]
                ).get("moving_down", FLOOR_MULTIPLIERS["MAIN_LEVEL"].get("moving", 1.0))
                mult_in = FLOOR_MULTIPLIERS.get(
                    room_floor,
                    FLOOR_MULTIPLIERS["MAIN_LEVEL"]
                ).get("moving_up", FLOOR_MULTIPLIERS["MAIN_LEVEL"].get("moving", 1.0))
                
                logistics_out_hours = ((room_box_count * 0.05) + (item_count * 0.10)) * mult_out * storage_factor
                logistics_in_hours = ((room_box_count * 0.05) + (item_count * 0.10)) * mult_in * storage_factor
                room_pack_out_hours += logistics_out_hours
                room_pack_in_hours += logistics_in_hours
                logistics_in_hours_for_room = logistics_in_hours

                # Generate explanations for this room
                building_type = None
                building_info_dict = None
                crew_size_from_calc = 2  # Default minimum crew size
                if calculation.get("building_info"):
                    building_info_dict = parse_json_field(calculation.get("building_info"))
                    building_type = building_info_dict.get("building_type")
                    crew_size_from_calc = building_info_dict.get("crew_size", 2)
                elif calculation.get("crew_size"):
                    crew_size_from_calc = calculation.get("crew_size", 2)
                elif calculation.get("building_type"):
                    # Fallback: build building_info from calculation fields
                    building_info_dict = {
                        "building_type": calculation.get("building_type"),
                        "total_floors": calculation.get("total_floors", 1),
                        "has_elevator": calculation.get("has_elevator", False),
                        "crew_size": crew_size_from_calc,
                    }
                    building_type = calculation.get("building_type")
                
                # Apply crew_size to room hours (for display)
                room_pack_out_hours_base = room_pack_out_hours
                room_pack_in_hours_base = room_pack_in_hours
                room_pack_out_hours_total = room_pack_out_hours_base * crew_size_from_calc
                room_pack_in_hours_total = room_pack_in_hours_base * crew_size_from_calc
                
                # Calculate pack-out hours breakdown for explanation
                # Separate packing hours from logistics (base hours, before crew multiplier)
                packing_base_hours = room_pack_out_hours_base - logistics_out_hours
                # For explanation, use total pack-out hours
                # Collect items list for detailed explanation
                items_for_explanation = []
                if items:
                    for item_obj in items:
                        item = item_obj if isinstance(item_obj, dict) else self.calc_repo._convert_to_dict(item_obj)
                        # Get item materials for explanation
                        item_mats = parse_json_field(item.get("xactimate_materials"))
                        items_for_explanation.append({
                            "item_name": item.get("item_name", ""),
                            "quantity": item.get("quantity", 1),
                            "fragile": item.get("fragile", False),
                            "requires_disassembly": item.get("requires_disassembly", False),
                            "size_category": item.get("size_category"),
                            "item_category": item.get("item_category"),
                            "xactimate_materials": item_mats or {},
                        })
                
                expl_out, expl_prot, expl_in = self._build_room_explanations(
                    room.get("room_name", ""),
                    room.get("floor_level", "MAIN_LEVEL"),
                    item_count,
                    room_materials,
                    packing_base_hours,  # Packing hours (without logistics, base)
                    logistics_out_hours,  # Moving/logistics hours (base)
                    building_type,
                    pack_in_hours=room_pack_in_hours_total,  # Pack-in hours total (with crew)
                    building_info=building_info_dict,  # Full building info for calculation formula
                    item_moving_hours=total_item_moving_hours,  # Item moving hours component (base)
                    logistics_hours=logistics_in_hours_for_room,  # Logistics hours component (base)
                    room_box_count=room_box_count,
                    crew_size=crew_size_from_calc,
                    has_storage=has_storage,
                    items=items_for_explanation,
                )

                room_breakdown = {
                    "room_id": room["id"],
                    "room_name": room["room_name"],
                    "floor_level": room["floor_level"],
                    "materials": room_materials,
                    "pack_out_labor_hours": room_pack_out_hours_total,  # Total hours with crew
                    "pack_in_labor_hours": room_pack_in_hours_total,  # Total hours with crew
                    "item_count": item_count,
                    "explanation_pack_out": expl_out,
                    "explanation_protection": None,  # Protection is shared across all rooms, shown at calculation level
                    "explanation_pack_in": expl_in,
                }

                print(f"🔍 Room breakdown for {room['room_name']}: items={item_count}, materials_dict={room_materials}, materials_count={len(room_materials)}, pack_out={room_pack_out_hours:.1f}h, pack_in={room_pack_in_hours:.1f}h")

                rooms_breakdown_data.append(room_breakdown)

        # Get basic calculation response with room breakdowns
        basic_response = self.format_calculation_response(calculation, rooms_breakdown_data)

        # Get rooms with items
        rooms_list = []
        if calculation.get("rooms"):
            for room_obj in calculation["rooms"]:
                # Convert room to dict if needed
                room = room_obj if isinstance(room_obj, dict) else self.calc_repo._convert_to_dict(room_obj)

                # Get room items
                items_list = []
                if room.get("items"):
                    for item_obj in room["items"]:
                        # Convert item to dict if needed
                        item = item_obj if isinstance(item_obj, dict) else self.calc_repo._convert_to_dict(item_obj)

                        # Parse JSONB field to dict
                        xactimate_materials = parse_json_field(item.get("xactimate_materials"))

                        items_list.append(PackItemResponse(
                            id=item["id"],
                            item_name=item["item_name"],
                            item_category=item.get("item_category"),
                            quantity=item["quantity"],
                            floor_level=item["floor_level"],
                            detected_by=item.get("detected_by", "manual"),
                            confidence_score=item.get("confidence_score"),
                            xactimate_materials=xactimate_materials,
                            fragile=item.get("fragile", False),
                            requires_disassembly=item.get("requires_disassembly", False),
                            special_notes=item.get("special_notes"),
                        ))

                # Parse JSONB fields to dicts
                xactimate_materials = parse_json_field(room.get("xactimate_materials"))
                xactimate_labor = parse_json_field(room.get("xactimate_labor"))

                rooms_list.append(PackRoomResponse(
                    id=room["id"],
                    room_name=room["room_name"],
                    floor_level=room["floor_level"],
                    input_method=room.get("input_method", "STRUCTURED"),
                    ai_confidence=room.get("ai_confidence"),
                    items=items_list,
                    xactimate_materials=xactimate_materials,
                    xactimate_labor=xactimate_labor,
                    packing_hours=room.get("packing_hours") or 0,
                    moving_hours=room.get("moving_hours") or 0,
                ))

        # Build building_info from calculation
        building_info = None
        if calculation.get("building_type"):
            building_info = BuildingInfo(
                building_type=calculation["building_type"],
                total_floors=calculation.get("total_floors", 1),
                has_elevator=calculation.get("has_elevator", False),
            )

        # Don't exclude 'rooms' - it contains RoomBreakdown data
        basic_response_dict = basic_response.model_dump()

        return PackCalculationDetailResponse(
            **basic_response_dict,
            building_info=building_info,
            project_address=calculation.get("project_address"),
            notes=calculation.get("notes"),
            detail_rooms=rooms_list,  # Separate field for detailed room data with items
        )

    def save_correction(
        self,
        calculation_id: UUID,
        correction: CorrectionInput,
        user_id: UUID
    ) -> dict:
        """Save human correction and update for ML training"""
        calculation = self.calc_repo.get_by_id(calculation_id)

        if not calculation:
            raise ValueError("Calculation not found")

        # Calculate correction magnitude
        original = calculation.get("original_calculation") or {}
        corrected = {
            "materials": correction.corrected_materials,
            "labor": correction.corrected_labor,
        }

        # Simple magnitude calculation (average % difference)
        magnitude = 0.0
        count = 0
        for code, orig_qty in original.get("pack_out_materials", {}).items():
            corr_qty = correction.corrected_materials.get(code, orig_qty)
            if orig_qty > 0:
                magnitude += abs(corr_qty - orig_qty) / orig_qty
                count += 1

        if count > 0:
            magnitude = (magnitude / count) * 100

        # Update calculation with correction data
        correction_update = {
            "was_corrected": True,
            "corrected_at": datetime.now(),
            "corrected_by_user_id": str(user_id),
            "correction_notes": correction.correction_notes,
            "corrected_calculation": corrected,
            "correction_magnitude": magnitude,
        }
        self.calc_repo.update(calculation_id, correction_update)

        # Check if retraining needed
        new_corrections = self.calc_repo.count_new_corrections_since_last_training()
        should_retrain = new_corrections >= 50

        return {
            "message": "Correction saved successfully",
            "magnitude": magnitude,
            "should_retrain": should_retrain,
            "corrections_count": new_corrections,
        }
