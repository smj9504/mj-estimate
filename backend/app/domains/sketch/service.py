"""
Sketch domain service layer
"""

from typing import List, Optional, Dict, Any, Tuple, Union
import logging
import json
import math
from decimal import Decimal
from uuid import UUID, uuid4

from app.core.interfaces import DatabaseSession
from app.domains.sketch.repository import SketchRepository
from app.domains.sketch.schemas import (
    SketchCreate, SketchUpdate, SketchResponse,
    RoomCreate, RoomUpdate, RoomResponse,
    WallCreate, WallUpdate, WallResponse,
    FixtureCreate, FixtureUpdate, FixtureResponse,
    MeasurementCreate, MeasurementUpdate, MeasurementResponse,
    CostCalculationResponse, AreaCalculationResponse
)

logger = logging.getLogger(__name__)


class SketchService:
    """Service layer for sketch business logic"""

    def __init__(self, db_session: DatabaseSession):
        self.db = db_session
        self.repository = SketchRepository(db_session)

    # ===== SKETCH OPERATIONS =====

    def create_sketch(self, sketch_data: SketchCreate) -> SketchResponse:
        """Create a new sketch with validation"""
        try:
            # Validate company exists (if needed)
            # This could be enhanced to check company permissions

            sketch_dict = sketch_data.model_dump(exclude_none=True)

            # Generate unique name if default
            if not sketch_dict.get('name') or sketch_dict['name'].startswith('New Sketch'):
                sketch_dict['name'] = self._generate_unique_sketch_name(
                    sketch_dict['company_id'],
                    sketch_dict.get('name', 'New Sketch')
                )

            # Set created_by_user_id if provided in context (could be enhanced)
            # sketch_dict['created_by_user_id'] = get_current_user_id()

            created_sketch = self.repository.create_sketch(sketch_dict)
            return SketchResponse(**created_sketch)

        except Exception as e:
            logger.error(f"Error in create_sketch: {e}")
            self.db.rollback()
            raise

    def get_sketch_by_id(self, sketch_id: str, include_relations: bool = True) -> Optional[SketchResponse]:
        """Get sketch by ID with optional relations"""
        try:
            sketch_data = self.repository.get_sketch_by_id(sketch_id, include_relations)
            return SketchResponse(**sketch_data) if sketch_data else None

        except Exception as e:
            logger.error(f"Error in get_sketch_by_id: {e}")
            raise

    def get_sketches_by_company(
        self,
        company_id: str,
        project_type: Optional[str] = None,
        status: Optional[str] = None,
        is_template: Optional[bool] = None,
        limit: Optional[int] = 50,
        offset: Optional[int] = 0
    ) -> List[SketchResponse]:
        """Get sketches for a company with filtering"""
        try:
            filters = {}
            if project_type:
                filters['project_type'] = project_type
            if status:
                filters['status'] = status
            if is_template is not None:
                filters['is_template'] = is_template

            sketches_data = self.repository.get_sketches_by_company_id(
                company_id,
                filters=filters,
                order_by='-updated_at',
                limit=limit,
                offset=offset
            )

            return [SketchResponse(**sketch) for sketch in sketches_data]

        except Exception as e:
            logger.error(f"Error in get_sketches_by_company: {e}")
            raise

    def update_sketch(self, sketch_id: str, update_data: SketchUpdate) -> Optional[SketchResponse]:
        """Update sketch with validation"""
        try:
            # Validate sketch exists and user has permissions
            existing = self.repository.get_sketch_by_id(sketch_id, include_relations=False)
            if not existing:
                return None

            update_dict = update_data.model_dump(exclude_none=True)

            # Handle version increment for significant changes
            if any(key in update_dict for key in ['canvas_width', 'canvas_height', 'scale_factor']):
                current_version = existing.get('version', 1)
                update_dict['version'] = current_version + 1

            updated_sketch = self.repository.update_sketch(sketch_id, update_dict)
            return SketchResponse(**updated_sketch) if updated_sketch else None

        except Exception as e:
            logger.error(f"Error in update_sketch: {e}")
            self.db.rollback()
            raise

    def delete_sketch(self, sketch_id: str) -> bool:
        """Delete sketch with authorization check"""
        try:
            # Validate sketch exists and user has permissions
            existing = self.repository.get_sketch_by_id(sketch_id, include_relations=False)
            if not existing:
                return False

            # Archive instead of delete if it has related estimates/invoices
            if existing.get('estimate_id') or existing.get('invoice_id'):
                # Archive instead of delete
                result = self.repository.update_sketch(sketch_id, {'status': 'archived'})
                return result is not None
            else:
                return self.repository.delete_sketch(sketch_id)

        except Exception as e:
            logger.error(f"Error in delete_sketch: {e}")
            self.db.rollback()
            raise

    def duplicate_sketch(self, sketch_id: str, new_name: Optional[str] = None) -> Optional[SketchResponse]:
        """Duplicate an existing sketch with all its components"""
        try:
            original = self.repository.get_sketch_by_id(sketch_id, include_relations=True)
            if not original:
                return None

            # Prepare new sketch data
            new_sketch_data = {
                key: value for key, value in original.items()
                if key not in ['id', 'created_at', 'updated_at']
            }

            # Update metadata
            new_sketch_data['name'] = new_name or f"{original['name']} (Copy)"
            new_sketch_data['status'] = 'draft'
            new_sketch_data['version'] = 1
            new_sketch_data['estimate_id'] = None
            new_sketch_data['invoice_id'] = None
            new_sketch_data['work_order_id'] = None

            # Create new sketch
            new_sketch = self.repository.create_sketch(new_sketch_data)
            new_sketch_id = new_sketch['id']

            # Duplicate rooms and their components
            for room in original.get('rooms', []):
                new_room_data = {
                    key: value for key, value in room.items()
                    if key not in ['id', 'sketch_id', 'created_at', 'updated_at', 'walls', 'fixtures']
                }
                new_room_data['sketch_id'] = new_sketch_id

                new_room = self.repository.create_room(new_room_data)
                new_room_id = new_room['id']

                # Duplicate walls
                for wall in room.get('walls', []):
                    new_wall_data = {
                        key: value for key, value in wall.items()
                        if key not in ['id', 'room_id', 'created_at', 'updated_at', 'fixtures']
                    }
                    new_wall_data['room_id'] = new_room_id

                    new_wall = self.repository.create_wall(new_wall_data)
                    new_wall_id = new_wall['id']

                    # Duplicate wall fixtures
                    for fixture in wall.get('fixtures', []):
                        if fixture.get('wall_id') == wall['id']:
                            new_fixture_data = {
                                key: value for key, value in fixture.items()
                                if key not in ['id', 'room_id', 'wall_id', 'created_at', 'updated_at']
                            }
                            new_fixture_data['room_id'] = new_room_id
                            new_fixture_data['wall_id'] = new_wall_id
                            self.repository.create_fixture(new_fixture_data)

                # Duplicate room-level fixtures (not attached to walls)
                for fixture in room.get('fixtures', []):
                    if not fixture.get('wall_id'):
                        new_fixture_data = {
                            key: value for key, value in fixture.items()
                            if key not in ['id', 'room_id', 'created_at', 'updated_at']
                        }
                        new_fixture_data['room_id'] = new_room_id
                        self.repository.create_fixture(new_fixture_data)

            # Duplicate measurements
            for measurement in original.get('measurements', []):
                new_measurement_data = {
                    key: value for key, value in measurement.items()
                    if key not in ['id', 'sketch_id', 'created_at', 'updated_at']
                }
                new_measurement_data['sketch_id'] = new_sketch_id
                self.repository.create_measurement(new_measurement_data)

            # Return complete new sketch
            return self.get_sketch_by_id(new_sketch_id, include_relations=True)

        except Exception as e:
            logger.error(f"Error in duplicate_sketch: {e}")
            self.db.rollback()
            raise

    # ===== ROOM OPERATIONS =====

    def create_room(self, room_data: RoomCreate) -> RoomResponse:
        """Create a new room with validation"""
        try:
            # Validate sketch exists
            sketch = self.repository.get_sketch_by_id(room_data.sketch_id, include_relations=False)
            if not sketch:
                raise ValueError(f"Sketch {room_data.sketch_id} not found")

            room_dict = room_data.model_dump(exclude_none=True)

            # Set default sort order
            if 'sort_order' not in room_dict:
                existing_rooms = self.repository.get_rooms_by_sketch_id(room_data.sketch_id)
                room_dict['sort_order'] = len(existing_rooms)

            created_room = self.repository.create_room(room_dict)
            return RoomResponse(**created_room)

        except Exception as e:
            logger.error(f"Error in create_room: {e}")
            self.db.rollback()
            raise

    def update_room(self, room_id: str, update_data: RoomUpdate) -> Optional[RoomResponse]:
        """Update room with validation"""
        try:
            update_dict = update_data.model_dump(exclude_none=True)
            updated_room = self.repository.update_room(room_id, update_dict)
            return RoomResponse(**updated_room) if updated_room else None

        except Exception as e:
            logger.error(f"Error in update_room: {e}")
            self.db.rollback()
            raise

    def delete_room(self, room_id: str) -> bool:
        """Delete room and all its components"""
        try:
            return self.repository.delete_room(room_id)

        except Exception as e:
            logger.error(f"Error in delete_room: {e}")
            self.db.rollback()
            raise

    # ===== WALL OPERATIONS =====

    def create_wall(self, wall_data: WallCreate) -> WallResponse:
        """Create a new wall with validation"""
        try:
            # Validate room exists
            room = self.repository.room_repo.get_by_id(wall_data.room_id)
            if not room:
                raise ValueError(f"Room {wall_data.room_id} not found")

            wall_dict = wall_data.model_dump(exclude_none=True)

            # Set default sort order
            if 'sort_order' not in wall_dict:
                existing_walls = self.repository.get_walls_by_room_id(wall_data.room_id)
                wall_dict['sort_order'] = len(existing_walls)

            created_wall = self.repository.create_wall(wall_dict)
            return WallResponse(**created_wall)

        except Exception as e:
            logger.error(f"Error in create_wall: {e}")
            self.db.rollback()
            raise

    def update_wall(self, wall_id: str, update_data: WallUpdate) -> Optional[WallResponse]:
        """Update wall with validation"""
        try:
            update_dict = update_data.model_dump(exclude_none=True)
            updated_wall = self.repository.update_wall(wall_id, update_dict)
            return WallResponse(**updated_wall) if updated_wall else None

        except Exception as e:
            logger.error(f"Error in update_wall: {e}")
            self.db.rollback()
            raise

    def delete_wall(self, wall_id: str) -> bool:
        """Delete wall and all its fixtures"""
        try:
            return self.repository.delete_wall(wall_id)

        except Exception as e:
            logger.error(f"Error in delete_wall: {e}")
            self.db.rollback()
            raise

    # ===== FIXTURE OPERATIONS =====

    def create_fixture(self, fixture_data: FixtureCreate) -> FixtureResponse:
        """Create a new fixture with validation"""
        try:
            # Validate room exists
            room = self.repository.room_repo.get_by_id(fixture_data.room_id)
            if not room:
                raise ValueError(f"Room {fixture_data.room_id} not found")

            # Validate wall if specified
            if fixture_data.wall_id:
                wall = self.repository.wall_repo.get_by_id(fixture_data.wall_id)
                if not wall or wall.get('room_id') != fixture_data.room_id:
                    raise ValueError(f"Wall {fixture_data.wall_id} not found or not in room {fixture_data.room_id}")

            fixture_dict = fixture_data.model_dump(exclude_none=True)

            # Set default sort order
            if 'sort_order' not in fixture_dict:
                existing_fixtures = self.repository.get_fixtures_by_room_id(fixture_data.room_id)
                fixture_dict['sort_order'] = len(existing_fixtures)

            created_fixture = self.repository.create_fixture(fixture_dict)
            return FixtureResponse(**created_fixture)

        except Exception as e:
            logger.error(f"Error in create_fixture: {e}")
            self.db.rollback()
            raise

    def update_fixture(self, fixture_id: str, update_data: FixtureUpdate) -> Optional[FixtureResponse]:
        """Update fixture with validation"""
        try:
            # Validate wall if being changed
            if update_data.wall_id:
                wall = self.repository.wall_repo.get_by_id(update_data.wall_id)
                if not wall:
                    raise ValueError(f"Wall {update_data.wall_id} not found")

            update_dict = update_data.model_dump(exclude_none=True)
            updated_fixture = self.repository.update_fixture(fixture_id, update_dict)
            return FixtureResponse(**updated_fixture) if updated_fixture else None

        except Exception as e:
            logger.error(f"Error in update_fixture: {e}")
            self.db.rollback()
            raise

    def delete_fixture(self, fixture_id: str) -> bool:
        """Delete fixture"""
        try:
            return self.repository.delete_fixture(fixture_id)

        except Exception as e:
            logger.error(f"Error in delete_fixture: {e}")
            self.db.rollback()
            raise

    # ===== MEASUREMENT OPERATIONS =====

    def create_measurement(self, measurement_data: MeasurementCreate) -> MeasurementResponse:
        """Create a new measurement with validation"""
        try:
            # Validate sketch exists
            sketch = self.repository.get_sketch_by_id(measurement_data.sketch_id, include_relations=False)
            if not sketch:
                raise ValueError(f"Sketch {measurement_data.sketch_id} not found")

            measurement_dict = measurement_data.model_dump(exclude_none=True)

            # Set default sort order
            if 'sort_order' not in measurement_dict:
                existing_measurements = self.repository.get_measurements_by_sketch_id(measurement_data.sketch_id)
                measurement_dict['sort_order'] = len(existing_measurements)

            # Generate label text if not provided
            if not measurement_dict.get('label_text'):
                value = measurement_dict.get('value', 0)
                unit = measurement_dict.get('unit', 'ft')
                precision = measurement_dict.get('precision', 2)
                measurement_dict['label_text'] = f"{value:.{precision}f} {unit}"

            created_measurement = self.repository.create_measurement(measurement_dict)
            return MeasurementResponse(**created_measurement)

        except Exception as e:
            logger.error(f"Error in create_measurement: {e}")
            self.db.rollback()
            raise

    def update_measurement(self, measurement_id: str, update_data: MeasurementUpdate) -> Optional[MeasurementResponse]:
        """Update measurement with validation"""
        try:
            update_dict = update_data.model_dump(exclude_none=True)

            # Update label text if value or unit changed
            if 'value' in update_dict or 'unit' in update_dict or 'precision' in update_dict:
                current = self.repository.measurement_repo.get_by_id(measurement_id)
                if current:
                    value = update_dict.get('value', current.get('value', 0))
                    unit = update_dict.get('unit', current.get('unit', 'ft'))
                    precision = update_dict.get('precision', current.get('precision', 2))
                    update_dict['label_text'] = f"{value:.{precision}f} {unit}"

            updated_measurement = self.repository.update_measurement(measurement_id, update_dict)
            return MeasurementResponse(**updated_measurement) if updated_measurement else None

        except Exception as e:
            logger.error(f"Error in update_measurement: {e}")
            self.db.rollback()
            raise

    def delete_measurement(self, measurement_id: str) -> bool:
        """Delete measurement"""
        try:
            return self.repository.delete_measurement(measurement_id)

        except Exception as e:
            logger.error(f"Error in delete_measurement: {e}")
            self.db.rollback()
            raise

    # ===== CALCULATION SERVICES =====

    def calculate_area_from_geometry(self, geometry: Dict[str, Any], scale_factor: float = 1.0,
                                   unit: str = "ft") -> AreaCalculationResponse:
        """Calculate area and perimeter from geometry data"""
        try:
            if geometry.get('type') == 'polygon' and geometry.get('points'):
                points = geometry['points']
                if len(points) < 3:
                    return AreaCalculationResponse(
                        area=0.0,
                        perimeter=0.0,
                        unit=unit,
                        scale_factor=scale_factor
                    )

                # Calculate area using shoelace formula
                area_pixels = 0.0
                n = len(points)

                for i in range(n):
                    j = (i + 1) % n
                    area_pixels += points[i]['x'] * points[j]['y']
                    area_pixels -= points[j]['x'] * points[i]['y']

                area_pixels = abs(area_pixels) / 2.0

                # Calculate perimeter
                perimeter_pixels = 0.0
                for i in range(n):
                    j = (i + 1) % n
                    dx = points[j]['x'] - points[i]['x']
                    dy = points[j]['y'] - points[i]['y']
                    perimeter_pixels += math.sqrt(dx * dx + dy * dy)

                # Convert from pixels to real units using scale factor
                # scale_factor is pixels per unit (e.g., pixels per foot)
                area_real = area_pixels / (scale_factor * scale_factor)
                perimeter_real = perimeter_pixels / scale_factor

                return AreaCalculationResponse(
                    area=round(area_real, 2),
                    perimeter=round(perimeter_real, 2),
                    unit=unit,
                    scale_factor=scale_factor
                )

            # Handle other geometry types (circles, rectangles, etc.)
            elif geometry.get('type') == 'rectangle':
                width = geometry.get('width', 0) / scale_factor
                height = geometry.get('height', 0) / scale_factor
                area = width * height
                perimeter = 2 * (width + height)

                return AreaCalculationResponse(
                    area=round(area, 2),
                    perimeter=round(perimeter, 2),
                    unit=unit,
                    scale_factor=scale_factor
                )

            elif geometry.get('type') == 'circle':
                radius = geometry.get('radius', 0) / scale_factor
                area = math.pi * radius * radius
                perimeter = 2 * math.pi * radius

                return AreaCalculationResponse(
                    area=round(area, 2),
                    perimeter=round(perimeter, 2),
                    unit=unit,
                    scale_factor=scale_factor
                )

            # Default for unknown geometry types
            return AreaCalculationResponse(
                area=0.0,
                perimeter=0.0,
                unit=unit,
                scale_factor=scale_factor
            )

        except Exception as e:
            logger.error(f"Error calculating area from geometry: {e}")
            raise

    def calculate_sketch_costs(self, sketch_id: str, include_labor: bool = True,
                             include_materials: bool = True, markup_percentage: float = 0) -> CostCalculationResponse:
        """Calculate comprehensive costs for a sketch"""
        try:
            cost_data = self.repository.calculate_sketch_costs(
                sketch_id,
                include_labor=include_labor,
                include_materials=include_materials,
                markup_percentage=markup_percentage
            )

            return CostCalculationResponse(**cost_data)

        except Exception as e:
            logger.error(f"Error calculating sketch costs: {e}")
            raise

    # ===== INTEGRATION SERVICES =====

    def link_to_estimate(self, sketch_id: str, estimate_id: str) -> bool:
        """Link sketch to an estimate"""
        try:
            # Validate both exist
            sketch = self.repository.get_sketch_by_id(sketch_id, include_relations=False)
            if not sketch:
                return False

            # Update sketch with estimate reference
            result = self.repository.update_sketch(sketch_id, {'estimate_id': estimate_id})
            return result is not None

        except Exception as e:
            logger.error(f"Error linking sketch to estimate: {e}")
            self.db.rollback()
            raise

    def link_to_invoice(self, sketch_id: str, invoice_id: str) -> bool:
        """Link sketch to an invoice"""
        try:
            # Validate sketch exists
            sketch = self.repository.get_sketch_by_id(sketch_id, include_relations=False)
            if not sketch:
                return False

            # Update sketch with invoice reference
            result = self.repository.update_sketch(sketch_id, {'invoice_id': invoice_id})
            return result is not None

        except Exception as e:
            logger.error(f"Error linking sketch to invoice: {e}")
            self.db.rollback()
            raise

    def sync_with_estimate_items(self, sketch_id: str, estimate_id: str) -> Dict[str, Any]:
        """Sync sketch room/fixture costs with estimate line items"""
        try:
            # This would integrate with the estimate domain
            # For now, return a basic structure
            sketch = self.repository.get_sketch_by_id(sketch_id, include_relations=True)
            if not sketch:
                return {}

            sync_results = {
                'sketch_id': sketch_id,
                'estimate_id': estimate_id,
                'synced_rooms': [],
                'synced_fixtures': [],
                'total_synced_cost': 0.0
            }

            # Implementation would sync room costs to estimate items
            # This is a placeholder for the actual integration logic

            return sync_results

        except Exception as e:
            logger.error(f"Error syncing sketch with estimate: {e}")
            raise

    # ===== UTILITY METHODS =====

    def convert_units(self, value: float, from_unit: str, to_unit: str) -> float:
        """Convert measurements between different units"""
        try:
            # Conversion factors to feet
            to_feet = {
                'ft': 1.0,
                'in': 1/12,
                'm': 3.28084,
                'cm': 0.0328084,
                'sq_ft': 1.0,
                'sq_m': 10.7639
            }

            # Convert to feet first, then to target unit
            feet_value = value * to_feet.get(from_unit, 1.0)
            result = feet_value / to_feet.get(to_unit, 1.0)

            return round(result, 4)

        except Exception as e:
            logger.error(f"Error converting units: {e}")
            return value

    def validate_geometry(self, geometry: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """Validate geometry data structure"""
        try:
            errors = []

            if not isinstance(geometry, dict):
                errors.append("Geometry must be a dictionary")
                return False, errors

            geometry_type = geometry.get('type')
            if not geometry_type:
                errors.append("Geometry type is required")
                return False, errors

            # Validate based on geometry type
            if geometry_type == 'polygon':
                points = geometry.get('points', [])
                if not points or len(points) < 3:
                    errors.append("Polygon must have at least 3 points")

                for i, point in enumerate(points):
                    if not isinstance(point, dict) or 'x' not in point or 'y' not in point:
                        errors.append(f"Point {i} must have 'x' and 'y' coordinates")
                    elif not isinstance(point['x'], (int, float)) or not isinstance(point['y'], (int, float)):
                        errors.append(f"Point {i} coordinates must be numbers")

            elif geometry_type == 'rectangle':
                required = ['width', 'height', 'x', 'y']
                for field in required:
                    if field not in geometry:
                        errors.append(f"Rectangle geometry missing required field: {field}")
                    elif not isinstance(geometry[field], (int, float)):
                        errors.append(f"Rectangle {field} must be a number")

            elif geometry_type == 'circle':
                required = ['radius', 'x', 'y']
                for field in required:
                    if field not in geometry:
                        errors.append(f"Circle geometry missing required field: {field}")
                    elif not isinstance(geometry[field], (int, float)):
                        errors.append(f"Circle {field} must be a number")

            return len(errors) == 0, errors

        except Exception as e:
            logger.error(f"Error validating geometry: {e}")
            return False, [f"Validation error: {str(e)}"]

    # ===== PRIVATE HELPER METHODS =====

    def _generate_unique_sketch_name(self, company_id: str, base_name: str) -> str:
        """Generate a unique sketch name for the company"""
        try:
            existing_sketches = self.repository.get_sketches_by_company_id(company_id)
            existing_names = {sketch.get('name', '').lower() for sketch in existing_sketches}

            # If base name is unique, use it
            if base_name.lower() not in existing_names:
                return base_name

            # Otherwise, append number
            counter = 1
            while True:
                candidate = f"{base_name} ({counter})"
                if candidate.lower() not in existing_names:
                    return candidate
                counter += 1

        except Exception as e:
            logger.error(f"Error generating unique sketch name: {e}")
            # Fallback to timestamp-based name
            from datetime import datetime
            return f"{base_name} {datetime.now().strftime('%Y%m%d-%H%M%S')}"