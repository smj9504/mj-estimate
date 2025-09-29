"""
Sketch domain API endpoints
"""

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Response
from fastapi.responses import StreamingResponse, JSONResponse
from typing import List, Optional, Dict, Any, Union
import logging
import json
import io
import tempfile
import os
from uuid import UUID

from app.core.database_factory import get_db_session as get_db
from app.domains.sketch.schemas import (
    # Sketch schemas
    SketchCreate, SketchUpdate, SketchResponse, SketchListResponse,
    # Room schemas
    RoomCreate, RoomUpdate, RoomResponse,
    # Wall schemas
    WallCreate, WallUpdate, WallResponse,
    # Fixture schemas
    FixtureCreate, FixtureUpdate, FixtureResponse,
    # Measurement schemas
    MeasurementCreate, MeasurementUpdate, MeasurementResponse,
    # Bulk operations
    BulkRoomCreate, BulkWallCreate, BulkFixtureCreate,
    BulkDeleteRequest, BulkUpdateOrder,
    # Calculations
    AreaCalculationRequest, AreaCalculationResponse,
    CostCalculationRequest, CostCalculationResponse,
    # Export/Import
    SketchExportRequest, SketchImportRequest, SketchImportResponse
)
from app.domains.sketch.service import SketchService

logger = logging.getLogger(__name__)
router = APIRouter()


# ===== SKETCH ENDPOINTS =====

@router.post("/", response_model=SketchResponse)
async def create_sketch(sketch_data: SketchCreate, db=Depends(get_db)):
    """Create a new sketch"""
    try:
        service = SketchService(db)
        return service.create_sketch(sketch_data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating sketch: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{sketch_id}", response_model=SketchResponse)
async def get_sketch(
    sketch_id: str,
    include_relations: bool = True,
    db=Depends(get_db)
):
    """Get sketch by ID with optional relations"""
    try:
        service = SketchService(db)
        sketch = service.get_sketch_by_id(sketch_id, include_relations)
        if not sketch:
            raise HTTPException(status_code=404, detail="Sketch not found")
        return sketch
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting sketch {sketch_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/company/{company_id}", response_model=List[SketchListResponse])
async def get_sketches_by_company(
    company_id: str,
    project_type: Optional[str] = None,
    status: Optional[str] = None,
    is_template: Optional[bool] = None,
    limit: int = 50,
    offset: int = 0,
    db=Depends(get_db)
):
    """Get sketches for a company with filtering"""
    try:
        service = SketchService(db)
        sketches = service.get_sketches_by_company(
            company_id=company_id,
            project_type=project_type,
            status=status,
            is_template=is_template,
            limit=limit,
            offset=offset
        )
        # Convert to list response format (without relations)
        return [SketchListResponse(**sketch.model_dump()) for sketch in sketches]
    except Exception as e:
        logger.error(f"Error getting sketches for company {company_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/{sketch_id}", response_model=SketchResponse)
async def update_sketch(
    sketch_id: str,
    sketch_data: SketchUpdate,
    db=Depends(get_db)
):
    """Update sketch"""
    try:
        service = SketchService(db)
        updated_sketch = service.update_sketch(sketch_id, sketch_data)
        if not updated_sketch:
            raise HTTPException(status_code=404, detail="Sketch not found")
        return updated_sketch
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating sketch {sketch_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/{sketch_id}")
async def delete_sketch(sketch_id: str, db=Depends(get_db)):
    """Delete sketch"""
    try:
        service = SketchService(db)
        success = service.delete_sketch(sketch_id)
        if not success:
            raise HTTPException(status_code=404, detail="Sketch not found")
        return {"message": "Sketch deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting sketch {sketch_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{sketch_id}/duplicate", response_model=SketchResponse)
async def duplicate_sketch(
    sketch_id: str,
    new_name: Optional[str] = None,
    db=Depends(get_db)
):
    """Duplicate an existing sketch"""
    try:
        service = SketchService(db)
        duplicated_sketch = service.duplicate_sketch(sketch_id, new_name)
        if not duplicated_sketch:
            raise HTTPException(status_code=404, detail="Sketch not found")
        return duplicated_sketch
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error duplicating sketch {sketch_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ===== ROOM ENDPOINTS =====

@router.post("/{sketch_id}/rooms", response_model=RoomResponse)
async def create_room(sketch_id: str, room_data: RoomCreate, db=Depends(get_db)):
    """Create a new room"""
    try:
        # Ensure sketch_id matches the URL parameter
        room_data.sketch_id = sketch_id
        service = SketchService(db)
        return service.create_room(room_data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating room: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{sketch_id}/rooms/bulk", response_model=List[RoomResponse])
async def create_rooms_bulk(sketch_id: str, bulk_data: BulkRoomCreate, db=Depends(get_db)):
    """Create multiple rooms at once"""
    try:
        service = SketchService(db)
        created_rooms = []
        for room_data in bulk_data.rooms:
            room_data.sketch_id = sketch_id
            created_room = service.create_room(room_data)
            created_rooms.append(created_room)
        return created_rooms
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating rooms in bulk: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/rooms/{room_id}", response_model=RoomResponse)
async def update_room(room_id: str, room_data: RoomUpdate, db=Depends(get_db)):
    """Update room"""
    try:
        service = SketchService(db)
        updated_room = service.update_room(room_id, room_data)
        if not updated_room:
            raise HTTPException(status_code=404, detail="Room not found")
        return updated_room
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating room {room_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/rooms/{room_id}")
async def delete_room(room_id: str, db=Depends(get_db)):
    """Delete room"""
    try:
        service = SketchService(db)
        success = service.delete_room(room_id)
        if not success:
            raise HTTPException(status_code=404, detail="Room not found")
        return {"message": "Room deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting room {room_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ===== WALL ENDPOINTS =====

@router.post("/rooms/{room_id}/walls", response_model=WallResponse)
async def create_wall(room_id: str, wall_data: WallCreate, db=Depends(get_db)):
    """Create a new wall"""
    try:
        # Ensure room_id matches the URL parameter
        wall_data.room_id = room_id
        service = SketchService(db)
        return service.create_wall(wall_data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating wall: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/rooms/{room_id}/walls/bulk", response_model=List[WallResponse])
async def create_walls_bulk(room_id: str, bulk_data: BulkWallCreate, db=Depends(get_db)):
    """Create multiple walls at once"""
    try:
        service = SketchService(db)
        created_walls = []
        for wall_data in bulk_data.walls:
            wall_data.room_id = room_id
            created_wall = service.create_wall(wall_data)
            created_walls.append(created_wall)
        return created_walls
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating walls in bulk: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/walls/{wall_id}", response_model=WallResponse)
async def update_wall(wall_id: str, wall_data: WallUpdate, db=Depends(get_db)):
    """Update wall"""
    try:
        service = SketchService(db)
        updated_wall = service.update_wall(wall_id, wall_data)
        if not updated_wall:
            raise HTTPException(status_code=404, detail="Wall not found")
        return updated_wall
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating wall {wall_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/walls/{wall_id}")
async def delete_wall(wall_id: str, db=Depends(get_db)):
    """Delete wall"""
    try:
        service = SketchService(db)
        success = service.delete_wall(wall_id)
        if not success:
            raise HTTPException(status_code=404, detail="Wall not found")
        return {"message": "Wall deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting wall {wall_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ===== FIXTURE ENDPOINTS =====

@router.post("/rooms/{room_id}/fixtures", response_model=FixtureResponse)
async def create_fixture(room_id: str, fixture_data: FixtureCreate, db=Depends(get_db)):
    """Create a new fixture"""
    try:
        # Ensure room_id matches the URL parameter
        fixture_data.room_id = room_id
        service = SketchService(db)
        return service.create_fixture(fixture_data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating fixture: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/rooms/{room_id}/fixtures/bulk", response_model=List[FixtureResponse])
async def create_fixtures_bulk(room_id: str, bulk_data: BulkFixtureCreate, db=Depends(get_db)):
    """Create multiple fixtures at once"""
    try:
        service = SketchService(db)
        created_fixtures = []
        for fixture_data in bulk_data.fixtures:
            fixture_data.room_id = room_id
            created_fixture = service.create_fixture(fixture_data)
            created_fixtures.append(created_fixture)
        return created_fixtures
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating fixtures in bulk: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/fixtures/{fixture_id}", response_model=FixtureResponse)
async def update_fixture(fixture_id: str, fixture_data: FixtureUpdate, db=Depends(get_db)):
    """Update fixture"""
    try:
        service = SketchService(db)
        updated_fixture = service.update_fixture(fixture_id, fixture_data)
        if not updated_fixture:
            raise HTTPException(status_code=404, detail="Fixture not found")
        return updated_fixture
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating fixture {fixture_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/fixtures/{fixture_id}")
async def delete_fixture(fixture_id: str, db=Depends(get_db)):
    """Delete fixture"""
    try:
        service = SketchService(db)
        success = service.delete_fixture(fixture_id)
        if not success:
            raise HTTPException(status_code=404, detail="Fixture not found")
        return {"message": "Fixture deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting fixture {fixture_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ===== MEASUREMENT ENDPOINTS =====

@router.post("/{sketch_id}/measurements", response_model=MeasurementResponse)
async def create_measurement(sketch_id: str, measurement_data: MeasurementCreate, db=Depends(get_db)):
    """Create a new measurement"""
    try:
        # Ensure sketch_id matches the URL parameter
        measurement_data.sketch_id = sketch_id
        service = SketchService(db)
        return service.create_measurement(measurement_data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating measurement: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/measurements/{measurement_id}", response_model=MeasurementResponse)
async def update_measurement(measurement_id: str, measurement_data: MeasurementUpdate, db=Depends(get_db)):
    """Update measurement"""
    try:
        service = SketchService(db)
        updated_measurement = service.update_measurement(measurement_id, measurement_data)
        if not updated_measurement:
            raise HTTPException(status_code=404, detail="Measurement not found")
        return updated_measurement
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating measurement {measurement_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/measurements/{measurement_id}")
async def delete_measurement(measurement_id: str, db=Depends(get_db)):
    """Delete measurement"""
    try:
        service = SketchService(db)
        success = service.delete_measurement(measurement_id)
        if not success:
            raise HTTPException(status_code=404, detail="Measurement not found")
        return {"message": "Measurement deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting measurement {measurement_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ===== CALCULATION ENDPOINTS =====

@router.post("/calculate/area", response_model=AreaCalculationResponse)
async def calculate_area(calculation_data: AreaCalculationRequest):
    """Calculate area and perimeter from geometry"""
    try:
        service = SketchService(None)  # No DB needed for this calculation
        return service.calculate_area_from_geometry(
            geometry=calculation_data.geometry,
            scale_factor=calculation_data.scale_factor,
            unit=calculation_data.unit
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error calculating area: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{sketch_id}/calculate/costs", response_model=CostCalculationResponse)
async def calculate_costs(
    sketch_id: str,
    calculation_data: CostCalculationRequest,
    db=Depends(get_db)
):
    """Calculate comprehensive costs for a sketch"""
    try:
        service = SketchService(db)
        return service.calculate_sketch_costs(
            sketch_id=sketch_id,
            include_labor=calculation_data.include_labor,
            include_materials=calculation_data.include_materials,
            markup_percentage=calculation_data.markup_percentage
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error calculating sketch costs: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ===== BULK OPERATIONS =====

@router.post("/bulk/sort-order")
async def bulk_update_sort_order(
    entity_type: str,
    update_data: BulkUpdateOrder,
    db=Depends(get_db)
):
    """Bulk update sort order for entities"""
    try:
        if entity_type not in ['room', 'wall', 'fixture', 'measurement']:
            raise HTTPException(status_code=400, detail="Invalid entity type")

        service = SketchService(db)
        success = service.repository.bulk_update_sort_order(entity_type, update_data.updates)
        if success:
            return {"message": f"Sort order updated for {len(update_data.updates)} {entity_type}s"}
        else:
            raise HTTPException(status_code=500, detail="Failed to update sort order")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error bulk updating sort order: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/bulk/{entity_type}")
async def bulk_delete(
    entity_type: str,
    delete_data: BulkDeleteRequest,
    db=Depends(get_db)
):
    """Bulk delete entities"""
    try:
        if entity_type not in ['room', 'wall', 'fixture', 'measurement']:
            raise HTTPException(status_code=400, detail="Invalid entity type")

        service = SketchService(db)
        result = service.repository.bulk_delete(entity_type, [str(id) for id in delete_data.ids])
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error bulk deleting {entity_type}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ===== INTEGRATION ENDPOINTS =====

@router.post("/{sketch_id}/link/estimate/{estimate_id}")
async def link_to_estimate(sketch_id: str, estimate_id: str, db=Depends(get_db)):
    """Link sketch to an estimate"""
    try:
        service = SketchService(db)
        success = service.link_to_estimate(sketch_id, estimate_id)
        if success:
            return {"message": "Sketch linked to estimate successfully"}
        else:
            raise HTTPException(status_code=404, detail="Sketch or estimate not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error linking sketch to estimate: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{sketch_id}/link/invoice/{invoice_id}")
async def link_to_invoice(sketch_id: str, invoice_id: str, db=Depends(get_db)):
    """Link sketch to an invoice"""
    try:
        service = SketchService(db)
        success = service.link_to_invoice(sketch_id, invoice_id)
        if success:
            return {"message": "Sketch linked to invoice successfully"}
        else:
            raise HTTPException(status_code=404, detail="Sketch or invoice not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error linking sketch to invoice: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{sketch_id}/sync/estimate/{estimate_id}")
async def sync_with_estimate(sketch_id: str, estimate_id: str, db=Depends(get_db)):
    """Sync sketch costs with estimate line items"""
    try:
        service = SketchService(db)
        result = service.sync_with_estimate_items(sketch_id, estimate_id)
        return result
    except Exception as e:
        logger.error(f"Error syncing sketch with estimate: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ===== EXPORT/IMPORT ENDPOINTS =====

@router.post("/{sketch_id}/export")
async def export_sketch(
    sketch_id: str,
    export_data: SketchExportRequest,
    db=Depends(get_db)
):
    """Export sketch in various formats"""
    try:
        service = SketchService(db)
        sketch = service.get_sketch_by_id(sketch_id, include_relations=True)
        if not sketch:
            raise HTTPException(status_code=404, detail="Sketch not found")

        format_type = export_data.format.lower()

        if format_type == 'json':
            # Export as JSON
            export_data_dict = sketch.model_dump()

            # Filter based on export options
            if not export_data.include_measurements:
                export_data_dict.pop('measurements', None)
            if not export_data.include_fixtures:
                for room in export_data_dict.get('rooms', []):
                    room.pop('fixtures', None)
                    for wall in room.get('walls', []):
                        wall.pop('fixtures', None)

            return JSONResponse(content=export_data_dict)

        elif format_type in ['svg', 'png', 'jpg', 'pdf']:
            # For image/vector exports, you would implement rendering logic here
            # This is a placeholder implementation
            raise HTTPException(status_code=501, detail=f"{format_type} export not yet implemented")

        else:
            raise HTTPException(status_code=400, detail="Unsupported export format")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error exporting sketch: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/import", response_model=SketchImportResponse)
async def import_sketch(
    import_data: SketchImportRequest,
    db=Depends(get_db)
):
    """Import sketch from various formats"""
    try:
        # This is a placeholder implementation
        # In a full implementation, you would parse different file formats
        # and create sketch entities accordingly

        if import_data.format.lower() not in ['json', 'dxf', 'dwg']:
            raise HTTPException(status_code=400, detail="Unsupported import format")

        # For now, just return a placeholder response
        return SketchImportResponse(
            sketch_id=str(UUID('00000000-0000-0000-0000-000000000000')),
            imported_rooms=0,
            imported_walls=0,
            imported_fixtures=0,
            imported_measurements=0,
            warnings=["Import functionality not yet fully implemented"],
            errors=[]
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error importing sketch: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/upload")
async def upload_sketch_file(
    company_id: str = Form(...),
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    merge_with_existing: bool = Form(False),
    existing_sketch_id: Optional[str] = Form(None),
    db=Depends(get_db)
):
    """Upload and import sketch file"""
    try:
        # Validate file type
        allowed_extensions = {'.json', '.dxf', '.dwg', '.svg'}
        file_extension = os.path.splitext(file.filename)[1].lower()

        if file_extension not in allowed_extensions:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type. Allowed: {', '.join(allowed_extensions)}"
            )

        # Read file content
        content = await file.read()

        # Determine format from file extension
        format_map = {
            '.json': 'json',
            '.dxf': 'dxf',
            '.dwg': 'dwg',
            '.svg': 'svg'
        }
        format_type = format_map.get(file_extension, 'json')

        # Create import request
        import_request = SketchImportRequest(
            company_id=company_id,
            format=format_type,
            data=content.decode('utf-8') if format_type == 'json' else content,
            name=name or file.filename,
            merge_with_existing=merge_with_existing,
            existing_sketch_id=existing_sketch_id
        )

        # Process import
        result = await import_sketch(import_request, db)
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading sketch file: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ===== UTILITY ENDPOINTS =====

@router.post("/validate/geometry")
async def validate_geometry(geometry: Dict[str, Any]):
    """Validate geometry data structure"""
    try:
        service = SketchService(None)  # No DB needed for validation
        is_valid, errors = service.validate_geometry(geometry)
        return {
            "is_valid": is_valid,
            "errors": errors
        }
    except Exception as e:
        logger.error(f"Error validating geometry: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/convert/units")
async def convert_units(
    value: float,
    from_unit: str,
    to_unit: str
):
    """Convert measurements between units"""
    try:
        service = SketchService(None)  # No DB needed for conversion
        converted_value = service.convert_units(value, from_unit, to_unit)
        return {
            "original_value": value,
            "original_unit": from_unit,
            "converted_value": converted_value,
            "converted_unit": to_unit
        }
    except Exception as e:
        logger.error(f"Error converting units: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")