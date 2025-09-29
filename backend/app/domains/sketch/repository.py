"""
Sketch domain repository
"""

from typing import List, Optional, Dict, Any, Tuple
import logging
from decimal import Decimal
from uuid import UUID
import json
import math

from app.common.base_repository import SQLAlchemyRepository, SupabaseRepository
from app.core.interfaces import DatabaseSession
from app.core.config import settings
from app.domains.sketch.models import Sketch, Room, Wall, Fixture, Measurement

logger = logging.getLogger(__name__)


class SketchRepository:
    """Repository for sketch operations with database abstraction"""

    def __init__(self, session: DatabaseSession):
        self.session = session

        # Initialize appropriate repository based on database type
        if settings.DATABASE_TYPE == "supabase":
            self.sketch_repo = SupabaseRepository(session, "sketches", Sketch)
            self.room_repo = SupabaseRepository(session, "rooms", Room)
            self.wall_repo = SupabaseRepository(session, "walls", Wall)
            self.fixture_repo = SupabaseRepository(session, "fixtures", Fixture)
            self.measurement_repo = SupabaseRepository(session, "measurements", Measurement)
        else:
            # SQLAlchemy for SQLite/PostgreSQL
            self.sketch_repo = SQLAlchemyRepository(session, Sketch)
            self.room_repo = SQLAlchemyRepository(session, Room)
            self.wall_repo = SQLAlchemyRepository(session, Wall)
            self.fixture_repo = SQLAlchemyRepository(session, Fixture)
            self.measurement_repo = SQLAlchemyRepository(session, Measurement)

    # ===== SKETCH OPERATIONS =====

    def create_sketch(self, sketch_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new sketch"""
        try:
            # Generate sketch number if not provided
            if not sketch_data.get('name'):
                sketch_data['name'] = self._generate_sketch_name(sketch_data.get('company_id'))

            # Set default canvas properties if not provided
            sketch_data.setdefault('canvas_width', 800)
            sketch_data.setdefault('canvas_height', 600)
            sketch_data.setdefault('scale_factor', 1.0)
            sketch_data.setdefault('scale_unit', 'ft')

            # Set default visual properties
            sketch_data.setdefault('grid_enabled', True)
            sketch_data.setdefault('grid_size', 20)
            sketch_data.setdefault('snap_to_grid', True)
            sketch_data.setdefault('background_color', '#FFFFFF')

            return self.sketch_repo.create(sketch_data)

        except Exception as e:
            logger.error(f"Error creating sketch: {e}")
            raise

    def get_sketch_by_id(self, sketch_id: str, include_relations: bool = True) -> Optional[Dict[str, Any]]:
        """Get sketch by ID with optional relations"""
        try:
            sketch = self.sketch_repo.get_by_id(sketch_id)
            if not sketch or not include_relations:
                return sketch

            # Load relations
            sketch['rooms'] = self.get_rooms_by_sketch_id(sketch_id, include_relations=True)
            sketch['measurements'] = self.get_measurements_by_sketch_id(sketch_id)

            return sketch

        except Exception as e:
            logger.error(f"Error getting sketch {sketch_id}: {e}")
            raise

    def get_sketches_by_company_id(
        self,
        company_id: str,
        filters: Optional[Dict[str, Any]] = None,
        order_by: Optional[str] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """Get sketches for a company with filtering"""
        try:
            query_filters = {'company_id': company_id}
            if filters:
                query_filters.update(filters)

            return self.sketch_repo.get_all(
                filters=query_filters,
                order_by=order_by or '-created_at',
                limit=limit,
                offset=offset
            )

        except Exception as e:
            logger.error(f"Error getting sketches for company {company_id}: {e}")
            raise

    def update_sketch(self, sketch_id: str, update_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update sketch with automatic calculation updates"""
        try:
            # If geometry-related updates, recalculate totals
            if any(key in update_data for key in ['canvas_width', 'canvas_height', 'scale_factor']):
                # Trigger recalculation after update
                updated = self.sketch_repo.update(sketch_id, update_data)
                if updated:
                    self._recalculate_sketch_totals(sketch_id)
                    # Get updated sketch with new calculations
                    return self.sketch_repo.get_by_id(sketch_id)
                return updated

            return self.sketch_repo.update(sketch_id, update_data)

        except Exception as e:
            logger.error(f"Error updating sketch {sketch_id}: {e}")
            raise

    def delete_sketch(self, sketch_id: str) -> bool:
        """Delete sketch and all related entities"""
        try:
            # Database cascades should handle deletions, but we can be explicit
            return self.sketch_repo.delete(sketch_id)

        except Exception as e:
            logger.error(f"Error deleting sketch {sketch_id}: {e}")
            raise

    # ===== ROOM OPERATIONS =====

    def create_room(self, room_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new room with automatic calculations"""
        try:
            # Calculate area and perimeter from geometry
            if 'geometry' in room_data:
                area, perimeter = self._calculate_room_metrics(room_data['geometry'])
                room_data['area'] = area
                room_data['perimeter'] = perimeter

            room = self.room_repo.create(room_data)

            # Update sketch totals
            if room_data.get('sketch_id'):
                self._recalculate_sketch_totals(room_data['sketch_id'])

            return room

        except Exception as e:
            logger.error(f"Error creating room: {e}")
            raise

    def get_rooms_by_sketch_id(self, sketch_id: str, include_relations: bool = False) -> List[Dict[str, Any]]:
        """Get all rooms for a sketch"""
        try:
            rooms = self.room_repo.get_all(
                filters={'sketch_id': sketch_id},
                order_by='sort_order'
            )

            if include_relations:
                for room in rooms:
                    room['walls'] = self.get_walls_by_room_id(room['id'], include_relations=True)
                    room['fixtures'] = self.get_fixtures_by_room_id(room['id'])

            return rooms

        except Exception as e:
            logger.error(f"Error getting rooms for sketch {sketch_id}: {e}")
            raise

    def update_room(self, room_id: str, update_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update room with automatic recalculations"""
        try:
            # Recalculate area/perimeter if geometry changed
            if 'geometry' in update_data:
                area, perimeter = self._calculate_room_metrics(update_data['geometry'])
                update_data['area'] = area
                update_data['perimeter'] = perimeter

            room = self.room_repo.update(room_id, update_data)

            # Update sketch totals if room was updated
            if room and room.get('sketch_id'):
                self._recalculate_sketch_totals(room['sketch_id'])

            return room

        except Exception as e:
            logger.error(f"Error updating room {room_id}: {e}")
            raise

    def delete_room(self, room_id: str) -> bool:
        """Delete room and update sketch totals"""
        try:
            # Get room first to know which sketch to update
            room = self.room_repo.get_by_id(room_id)
            sketch_id = room.get('sketch_id') if room else None

            success = self.room_repo.delete(room_id)

            # Update sketch totals
            if success and sketch_id:
                self._recalculate_sketch_totals(sketch_id)

            return success

        except Exception as e:
            logger.error(f"Error deleting room {room_id}: {e}")
            raise

    # ===== WALL OPERATIONS =====

    def create_wall(self, wall_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new wall with automatic calculations"""
        try:
            # Calculate length from start/end points if not provided
            if 'start_point' in wall_data and 'end_point' in wall_data:
                if not wall_data.get('length'):
                    wall_data['length'] = self._calculate_distance(
                        wall_data['start_point'],
                        wall_data['end_point']
                    )

                # Calculate angle
                wall_data['angle'] = self._calculate_angle(
                    wall_data['start_point'],
                    wall_data['end_point']
                )

            # Calculate area (length × height)
            if wall_data.get('length') and wall_data.get('height'):
                wall_data['area'] = wall_data['length'] * wall_data['height']

            # Calculate estimated cost
            if wall_data.get('area') and wall_data.get('cost_per_sq_unit'):
                wall_data['estimated_cost'] = wall_data['area'] * wall_data['cost_per_sq_unit']

            wall = self.wall_repo.create(wall_data)

            # Update sketch totals
            if wall_data.get('room_id'):
                room = self.room_repo.get_by_id(wall_data['room_id'])
                if room and room.get('sketch_id'):
                    self._recalculate_sketch_totals(room['sketch_id'])

            return wall

        except Exception as e:
            logger.error(f"Error creating wall: {e}")
            raise

    def get_walls_by_room_id(self, room_id: str, include_relations: bool = False) -> List[Dict[str, Any]]:
        """Get all walls for a room"""
        try:
            walls = self.wall_repo.get_all(
                filters={'room_id': room_id},
                order_by='sort_order'
            )

            if include_relations:
                for wall in walls:
                    wall['fixtures'] = self.get_fixtures_by_wall_id(wall['id'])

            return walls

        except Exception as e:
            logger.error(f"Error getting walls for room {room_id}: {e}")
            raise

    def update_wall(self, wall_id: str, update_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update wall with automatic recalculations"""
        try:
            # Recalculate metrics if position changed
            if 'start_point' in update_data or 'end_point' in update_data:
                # Get current wall data to merge with updates
                current = self.wall_repo.get_by_id(wall_id)
                if current:
                    start_point = update_data.get('start_point', current.get('start_point'))
                    end_point = update_data.get('end_point', current.get('end_point'))

                    if start_point and end_point:
                        update_data['length'] = self._calculate_distance(start_point, end_point)
                        update_data['angle'] = self._calculate_angle(start_point, end_point)

            # Recalculate area if length or height changed
            if 'length' in update_data or 'height' in update_data:
                current = self.wall_repo.get_by_id(wall_id)
                if current:
                    length = update_data.get('length', current.get('length', 0))
                    height = update_data.get('height', current.get('height', 0))
                    update_data['area'] = length * height

            # Recalculate cost if area or rate changed
            if 'area' in update_data or 'cost_per_sq_unit' in update_data:
                current = self.wall_repo.get_by_id(wall_id)
                if current:
                    area = update_data.get('area', current.get('area', 0))
                    rate = update_data.get('cost_per_sq_unit', current.get('cost_per_sq_unit', 0))
                    update_data['estimated_cost'] = area * rate

            wall = self.wall_repo.update(wall_id, update_data)

            # Update sketch totals
            if wall and wall.get('room_id'):
                room = self.room_repo.get_by_id(wall['room_id'])
                if room and room.get('sketch_id'):
                    self._recalculate_sketch_totals(room['sketch_id'])

            return wall

        except Exception as e:
            logger.error(f"Error updating wall {wall_id}: {e}")
            raise

    def delete_wall(self, wall_id: str) -> bool:
        """Delete wall and update sketch totals"""
        try:
            # Get wall and room info for sketch update
            wall = self.wall_repo.get_by_id(wall_id)
            room_id = wall.get('room_id') if wall else None

            success = self.wall_repo.delete(wall_id)

            if success and room_id:
                room = self.room_repo.get_by_id(room_id)
                if room and room.get('sketch_id'):
                    self._recalculate_sketch_totals(room['sketch_id'])

            return success

        except Exception as e:
            logger.error(f"Error deleting wall {wall_id}: {e}")
            raise

    # ===== FIXTURE OPERATIONS =====

    def create_fixture(self, fixture_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new fixture"""
        try:
            # Calculate total cost if not provided
            if not fixture_data.get('total_cost'):
                unit_cost = fixture_data.get('unit_cost', 0)
                installation_cost = fixture_data.get('installation_cost', 0)
                fixture_data['total_cost'] = unit_cost + installation_cost

            return self.fixture_repo.create(fixture_data)

        except Exception as e:
            logger.error(f"Error creating fixture: {e}")
            raise

    def get_fixtures_by_room_id(self, room_id: str) -> List[Dict[str, Any]]:
        """Get all fixtures for a room"""
        try:
            return self.fixture_repo.get_all(
                filters={'room_id': room_id},
                order_by='sort_order'
            )

        except Exception as e:
            logger.error(f"Error getting fixtures for room {room_id}: {e}")
            raise

    def get_fixtures_by_wall_id(self, wall_id: str) -> List[Dict[str, Any]]:
        """Get all fixtures for a wall"""
        try:
            return self.fixture_repo.get_all(
                filters={'wall_id': wall_id},
                order_by='wall_offset'
            )

        except Exception as e:
            logger.error(f"Error getting fixtures for wall {wall_id}: {e}")
            raise

    def update_fixture(self, fixture_id: str, update_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update fixture with cost recalculation"""
        try:
            # Recalculate total cost if component costs changed
            if 'unit_cost' in update_data or 'installation_cost' in update_data:
                current = self.fixture_repo.get_by_id(fixture_id)
                if current:
                    unit_cost = update_data.get('unit_cost', current.get('unit_cost', 0))
                    installation_cost = update_data.get('installation_cost', current.get('installation_cost', 0))
                    update_data['total_cost'] = unit_cost + installation_cost

            return self.fixture_repo.update(fixture_id, update_data)

        except Exception as e:
            logger.error(f"Error updating fixture {fixture_id}: {e}")
            raise

    def delete_fixture(self, fixture_id: str) -> bool:
        """Delete fixture"""
        try:
            return self.fixture_repo.delete(fixture_id)

        except Exception as e:
            logger.error(f"Error deleting fixture {fixture_id}: {e}")
            raise

    # ===== MEASUREMENT OPERATIONS =====

    def create_measurement(self, measurement_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new measurement"""
        try:
            # Calculate value from points if linear measurement and not provided
            if (measurement_data.get('measurement_type') == 'linear'
                and not measurement_data.get('value')
                and measurement_data.get('start_point')
                and measurement_data.get('end_point')):

                distance = self._calculate_distance(
                    measurement_data['start_point'],
                    measurement_data['end_point']
                )
                measurement_data['value'] = distance

            return self.measurement_repo.create(measurement_data)

        except Exception as e:
            logger.error(f"Error creating measurement: {e}")
            raise

    def get_measurements_by_sketch_id(self, sketch_id: str) -> List[Dict[str, Any]]:
        """Get all measurements for a sketch"""
        try:
            return self.measurement_repo.get_all(
                filters={'sketch_id': sketch_id},
                order_by='sort_order'
            )

        except Exception as e:
            logger.error(f"Error getting measurements for sketch {sketch_id}: {e}")
            raise

    def update_measurement(self, measurement_id: str, update_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update measurement"""
        try:
            # Recalculate value if points changed for linear measurements
            if ('start_point' in update_data or 'end_point' in update_data):
                current = self.measurement_repo.get_by_id(measurement_id)
                if current and current.get('measurement_type') == 'linear':
                    start_point = update_data.get('start_point', current.get('start_point'))
                    end_point = update_data.get('end_point', current.get('end_point'))

                    if start_point and end_point:
                        update_data['value'] = self._calculate_distance(start_point, end_point)

            return self.measurement_repo.update(measurement_id, update_data)

        except Exception as e:
            logger.error(f"Error updating measurement {measurement_id}: {e}")
            raise

    def delete_measurement(self, measurement_id: str) -> bool:
        """Delete measurement"""
        try:
            return self.measurement_repo.delete(measurement_id)

        except Exception as e:
            logger.error(f"Error deleting measurement {measurement_id}: {e}")
            raise

    # ===== BULK OPERATIONS =====

    def bulk_update_sort_order(self, entity_type: str, updates: List[Dict[str, Any]]) -> bool:
        """Bulk update sort order for entities"""
        try:
            repo_map = {
                'room': self.room_repo,
                'wall': self.wall_repo,
                'fixture': self.fixture_repo,
                'measurement': self.measurement_repo
            }

            repo = repo_map.get(entity_type)
            if not repo:
                raise ValueError(f"Unknown entity type: {entity_type}")

            for update in updates:
                entity_id = update.get('id')
                sort_order = update.get('sort_order')
                if entity_id and sort_order is not None:
                    repo.update(entity_id, {'sort_order': sort_order})

            return True

        except Exception as e:
            logger.error(f"Error bulk updating sort order for {entity_type}: {e}")
            raise

    def bulk_delete(self, entity_type: str, entity_ids: List[str]) -> Dict[str, Any]:
        """Bulk delete entities"""
        try:
            repo_map = {
                'room': self.room_repo,
                'wall': self.wall_repo,
                'fixture': self.fixture_repo,
                'measurement': self.measurement_repo
            }

            repo = repo_map.get(entity_type)
            if not repo:
                raise ValueError(f"Unknown entity type: {entity_type}")

            deleted_count = 0
            sketch_ids_to_update = set()

            for entity_id in entity_ids:
                # Get entity to know which sketch to update
                if entity_type == 'room':
                    entity = repo.get_by_id(entity_id)
                    if entity and entity.get('sketch_id'):
                        sketch_ids_to_update.add(entity['sketch_id'])
                elif entity_type == 'wall':
                    entity = repo.get_by_id(entity_id)
                    if entity and entity.get('room_id'):
                        room = self.room_repo.get_by_id(entity['room_id'])
                        if room and room.get('sketch_id'):
                            sketch_ids_to_update.add(room['sketch_id'])

                if repo.delete(entity_id):
                    deleted_count += 1

            # Update sketch totals for affected sketches
            for sketch_id in sketch_ids_to_update:
                self._recalculate_sketch_totals(sketch_id)

            return {
                'deleted_count': deleted_count,
                'total_requested': len(entity_ids),
                'updated_sketches': list(sketch_ids_to_update)
            }

        except Exception as e:
            logger.error(f"Error bulk deleting {entity_type}: {e}")
            raise

    # ===== CALCULATION METHODS =====

    def calculate_sketch_costs(self, sketch_id: str, include_labor: bool = True,
                             include_materials: bool = True, markup_percentage: float = 0) -> Dict[str, Any]:
        """Calculate comprehensive costs for a sketch"""
        try:
            sketch = self.sketch_repo.get_by_id(sketch_id)
            if not sketch:
                return {}

            rooms = self.get_rooms_by_sketch_id(sketch_id, include_relations=True)

            total_material_cost = 0
            total_labor_cost = 0
            room_costs = []
            fixture_costs = []

            for room in rooms:
                room_material_cost = 0
                room_labor_cost = 0

                # Wall costs
                for wall in room.get('walls', []):
                    if include_materials:
                        wall_cost = wall.get('estimated_cost', 0)
                        room_material_cost += wall_cost

                # Fixture costs
                for fixture in room.get('fixtures', []):
                    fixture_unit_cost = fixture.get('unit_cost', 0)
                    fixture_labor_cost = fixture.get('installation_cost', 0)

                    if include_materials:
                        room_material_cost += fixture_unit_cost
                    if include_labor:
                        room_labor_cost += fixture_labor_cost

                    fixture_costs.append({
                        'fixture_id': fixture['id'],
                        'name': fixture['name'],
                        'unit_cost': fixture_unit_cost,
                        'labor_cost': fixture_labor_cost,
                        'total': fixture_unit_cost + fixture_labor_cost
                    })

                # Room-level estimated cost
                room_estimated_cost = room.get('estimated_cost', 0)
                if include_materials:
                    room_material_cost += room_estimated_cost

                total_material_cost += room_material_cost
                total_labor_cost += room_labor_cost

                room_costs.append({
                    'room_id': room['id'],
                    'name': room['name'],
                    'material_cost': room_material_cost,
                    'labor_cost': room_labor_cost,
                    'total': room_material_cost + room_labor_cost
                })

            subtotal = total_material_cost + total_labor_cost
            markup_amount = subtotal * (markup_percentage / 100)
            total_cost = subtotal + markup_amount

            return {
                'sketch_id': sketch_id,
                'total_material_cost': total_material_cost,
                'total_labor_cost': total_labor_cost,
                'markup_percentage': markup_percentage,
                'markup_amount': markup_amount,
                'total_cost': total_cost,
                'room_costs': room_costs,
                'fixture_costs': fixture_costs
            }

        except Exception as e:
            logger.error(f"Error calculating sketch costs for {sketch_id}: {e}")
            raise

    # ===== PRIVATE HELPER METHODS =====

    def _generate_sketch_name(self, company_id: str) -> str:
        """Generate a unique sketch name"""
        try:
            # Get count of existing sketches for company
            existing = self.sketch_repo.count({'company_id': company_id})
            return f"Sketch-{existing + 1:04d}"

        except Exception:
            # Fallback to timestamp-based name
            from datetime import datetime
            return f"Sketch-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

    def _calculate_distance(self, point1: Dict[str, float], point2: Dict[str, float]) -> float:
        """Calculate distance between two points"""
        try:
            x1, y1 = point1['x'], point1['y']
            x2, y2 = point2['x'], point2['y']
            return math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)

        except Exception as e:
            logger.error(f"Error calculating distance: {e}")
            return 0.0

    def _calculate_angle(self, start_point: Dict[str, float], end_point: Dict[str, float]) -> float:
        """Calculate angle between two points in degrees"""
        try:
            x1, y1 = start_point['x'], start_point['y']
            x2, y2 = end_point['x'], end_point['y']

            # Calculate angle in radians, then convert to degrees
            angle_rad = math.atan2(y2 - y1, x2 - x1)
            angle_deg = math.degrees(angle_rad)

            # Normalize to 0-360 degrees
            return angle_deg % 360

        except Exception as e:
            logger.error(f"Error calculating angle: {e}")
            return 0.0

    def _calculate_room_metrics(self, geometry: Dict[str, Any]) -> Tuple[float, float]:
        """Calculate area and perimeter from room geometry"""
        try:
            # This is a simplified implementation
            # In a real application, you'd handle different geometry types (polygon, bezier, etc.)

            if geometry.get('type') == 'polygon' and geometry.get('points'):
                points = geometry['points']
                if len(points) < 3:
                    return 0.0, 0.0

                # Calculate area using shoelace formula
                area = 0.0
                n = len(points)

                for i in range(n):
                    j = (i + 1) % n
                    area += points[i]['x'] * points[j]['y']
                    area -= points[j]['x'] * points[i]['y']

                area = abs(area) / 2.0

                # Calculate perimeter
                perimeter = 0.0
                for i in range(n):
                    j = (i + 1) % n
                    perimeter += self._calculate_distance(points[i], points[j])

                return area, perimeter

            # Default for unknown geometry types
            return 0.0, 0.0

        except Exception as e:
            logger.error(f"Error calculating room metrics: {e}")
            return 0.0, 0.0

    def _recalculate_sketch_totals(self, sketch_id: str):
        """Recalculate and update sketch total metrics"""
        try:
            rooms = self.get_rooms_by_sketch_id(sketch_id, include_relations=True)

            total_area = 0.0
            total_perimeter = 0.0
            total_wall_area = 0.0

            for room in rooms:
                total_area += room.get('area', 0)
                total_perimeter += room.get('perimeter', 0)

                # Sum wall areas
                for wall in room.get('walls', []):
                    total_wall_area += wall.get('area', 0)

            # Update sketch with calculated totals
            self.sketch_repo.update(sketch_id, {
                'total_area': total_area,
                'total_perimeter': total_perimeter,
                'total_wall_area': total_wall_area
            })

        except Exception as e:
            logger.error(f"Error recalculating sketch totals for {sketch_id}: {e}")
            # Don't raise - this is a background calculation