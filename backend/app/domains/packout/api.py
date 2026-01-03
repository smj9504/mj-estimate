"""
API endpoints for packout domain.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.orm import Session

from app.core.database_factory import get_db
from app.domains.auth.dependencies import get_current_user
from app.domains.packout.schemas import (
    PackoutAnalysisRequest, PackoutAnalysisResponse,
    XactimateImportRequest, XactimateImportResponse,
    XactimateCodeResponse, PackingRuleCreate, PackingRuleResponse,
    ItemMappingCreate, ItemMappingResponse,
    PackoutSearchRequest, XactimateCategory
)
from app.domains.packout.packout_service import PackoutService
from app.domains.packout.xactimate_service import XactimateService
from app.domains.packout.repository import PackoutRepository

router = APIRouter(prefix="/packout", tags=["packout"])


@router.post("/analyze", response_model=PackoutAnalysisResponse)
async def analyze_packout(
    request: PackoutAnalysisRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Perform complete packout analysis with material and labor calculations.

    This endpoint:
    1. Analyzes photos or uses provided inventory
    2. Identifies and categorizes items
    3. Calculates material requirements (boxes, bubble wrap, etc.)
    4. Calculates labor requirements (packing, inventory, moving)
    5. Generates Xactimate line items
    6. Optionally provides cost estimates
    """
    try:
        service = PackoutService(db)

        # Get company ID from user
        company_id = current_user.get("company_id")
        if not company_id:
            raise HTTPException(status_code=400, detail="User must be associated with a company")

        # Perform analysis
        response = await service.analyze_packout(
            request=request,
            company_id=company_id,
            user_id=current_user.get("id")
        )

        return response

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/analysis/{analysis_id}", response_model=PackoutAnalysisResponse)
def get_packout_analysis(
    analysis_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Retrieve a specific packout analysis by ID.
    """
    service = PackoutService(db)
    analysis = service.get_analysis(analysis_id)

    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")

    # Check if user has access to this analysis
    if analysis.company_id != current_user.get("company_id"):
        raise HTTPException(status_code=403, detail="Access denied")

    # Convert to response format
    # Note: This is a simplified conversion - you might want to reconstruct
    # the full response from the stored data
    return PackoutAnalysisResponse(
        id=analysis.id,
        job_id=analysis.job_id,
        room_name=analysis.room_name,
        analysis_timestamp=analysis.created_at,
        items_detected=[],  # Would need to parse from JSON
        total_items=analysis.total_items_detected,
        unique_items=analysis.unique_items_count,
        duplicates_removed=analysis.duplicate_items_removed,
        materials=analysis.material_requirements or [],
        material_summary={
            "total_boxes": analysis.total_boxes_needed,
            "bubble_wrap_rolls": analysis.total_bubble_wrap_rolls,
            "paper_pounds": analysis.total_paper_pounds,
            "tape_rolls": analysis.total_tape_rolls
        },
        labor=analysis.labor_requirements or [],
        labor_summary={
            "packing_hours": analysis.total_packing_hours,
            "inventory_hours": analysis.total_inventory_hours,
            "moving_hours": analysis.total_moving_hours,
            "supervision_hours": analysis.total_supervision_hours
        },
        xactimate_line_items=analysis.xactimate_line_items or [],
        estimated_material_cost=analysis.estimated_material_cost,
        estimated_labor_cost=analysis.estimated_labor_cost,
        estimated_total_cost=analysis.estimated_total_cost,
        confidence_score=0.85,
        processing_time_seconds=analysis.processing_time_seconds
    )


@router.post("/search", response_model=List[dict])
def search_packout_analyses(
    search_request: PackoutSearchRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Search for packout analyses with filters.
    """
    # Add company filter if not admin
    if not search_request.company_id:
        search_request.company_id = current_user.get("company_id")

    repository = PackoutRepository(db)
    analyses = repository.search_packout_analyses(search_request)

    # Return simplified list for search results
    return [
        {
            "id": a.id,
            "job_id": a.job_id,
            "room_name": a.room_name,
            "total_items": a.total_items_detected,
            "total_boxes": a.total_boxes_needed,
            "total_cost": a.estimated_total_cost,
            "created_at": a.created_at.isoformat()
        }
        for a in analyses
    ]


@router.post("/xactimate/import", response_model=XactimateImportResponse)
async def import_xactimate_codes(
    request: XactimateImportRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Import Xactimate codes from JSON file.

    Requires admin privileges.
    """
    # Check admin privileges
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    service = XactimateService(db)

    # Use default path if not provided
    file_path = request.file_path
    if not file_path:
        category_files = {
            XactimateCategory.CON: "backend/uploads/xactimate_data/CON_.json",
            XactimateCategory.CPS: "backend/uploads/xactimate_data/CPS.json",
            XactimateCategory.TMC: "backend/uploads/xactimate_data/TMC.json"
        }
        file_path = category_files.get(request.category)

    if not file_path:
        raise HTTPException(status_code=400, detail="File path not specified")

    result = service.import_xactimate_file(
        file_path=file_path,
        category=request.category,
        overwrite=request.overwrite_existing
    )

    return result


@router.post("/xactimate/import-all")
async def import_all_xactimate_codes(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Import all default Xactimate JSON files.

    Requires admin privileges.
    """
    # Check admin privileges
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    service = XactimateService(db)

    # Run import in background
    def import_task():
        try:
            results = service.import_all_default_files()
            # Log results
            for category, result in results.items():
                print(f"{category}: Imported {result.codes_imported}, Updated {result.codes_updated}")
        except Exception as e:
            print(f"Error importing Xactimate files: {e}")

    background_tasks.add_task(import_task)

    return {"message": "Import started in background"}


@router.get("/xactimate/codes", response_model=List[XactimateCodeResponse])
def search_xactimate_codes(
    category: Optional[XactimateCategory] = Query(None),
    subcategory: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Search for Xactimate codes.
    """
    service = XactimateService(db)
    codes = service.search_codes(
        category=category,
        subcategory=subcategory,
        search_term=search,
        limit=limit
    )

    return [
        XactimateCodeResponse(
            id=code.id,
            code=code.code,
            category=code.category,
            description=code.description,
            unit=code.unit,
            unit_price=code.unit_price,
            subcategory=code.subcategory,
            size_range=code.size_range,
            material_type=code.material_type,
            created_at=code.created_at,
            updated_at=code.updated_at
        )
        for code in codes
    ]


@router.post("/packing-rules", response_model=PackingRuleResponse)
def create_packing_rule(
    rule: PackingRuleCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Create a new packing rule.

    Requires admin privileges.
    """
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    repository = PackoutRepository(db)

    # Check if rule already exists
    existing = repository.find_packing_rule(
        rule.item_category,
        rule.item_subcategory,
        rule.fragility_level,
        rule.size
    )

    if existing:
        raise HTTPException(status_code=400, detail="Packing rule already exists")

    # Create rule
    new_rule = repository.create_packing_rule(rule)

    return PackingRuleResponse(
        id=new_rule.id,
        item_category=new_rule.item_category,
        item_subcategory=new_rule.item_subcategory,
        fragility_level=new_rule.fragility_level,
        size=new_rule.size,
        box_type_code_id=new_rule.box_type_code_id,
        bubble_wrap_required=new_rule.bubble_wrap_required,
        bubble_wrap_layers=new_rule.bubble_wrap_layers,
        paper_sheets_required=new_rule.paper_sheets_required,
        special_handling=new_rule.special_handling,
        handling_notes=new_rule.handling_notes,
        packing_time_minutes=new_rule.packing_time_minutes,
        inventory_time_minutes=new_rule.inventory_time_minutes,
        created_at=new_rule.created_at
    )


@router.get("/packing-rules", response_model=List[PackingRuleResponse])
def list_packing_rules(
    item_category: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    List packing rules.
    """
    repository = PackoutRepository(db)
    rules = repository.list_packing_rules(
        item_category=item_category,
        limit=limit,
        offset=offset
    )

    return [
        PackingRuleResponse(
            id=rule.id,
            item_category=rule.item_category,
            item_subcategory=rule.item_subcategory,
            fragility_level=rule.fragility_level,
            size=rule.size,
            box_type_code_id=rule.box_type_code_id,
            bubble_wrap_required=rule.bubble_wrap_required,
            bubble_wrap_layers=rule.bubble_wrap_layers,
            paper_sheets_required=rule.paper_sheets_required,
            special_handling=rule.special_handling,
            handling_notes=rule.handling_notes,
            packing_time_minutes=rule.packing_time_minutes,
            inventory_time_minutes=rule.inventory_time_minutes,
            created_at=rule.created_at
        )
        for rule in rules
    ]


@router.post("/item-mappings", response_model=ItemMappingResponse)
def create_item_mapping(
    mapping: ItemMappingCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Create a new item to Xactimate code mapping.

    Requires admin privileges.
    """
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    repository = PackoutRepository(db)

    # Check if mapping already exists
    existing = repository.find_item_mapping(
        mapping.item_name,
        mapping.item_category
    )

    if existing:
        raise HTTPException(status_code=400, detail="Item mapping already exists")

    # Create mapping
    new_mapping = repository.create_item_mapping(mapping)

    return ItemMappingResponse(
        id=new_mapping.id,
        item_name=new_mapping.item_name,
        item_category=new_mapping.item_category,
        item_subcategory=new_mapping.item_subcategory,
        primary_code_id=new_mapping.primary_code_id,
        additional_codes=new_mapping.additional_codes or [],
        default_fragility=new_mapping.default_fragility,
        default_size=new_mapping.default_size,
        items_per_box=new_mapping.items_per_box,
        requires_disassembly=new_mapping.requires_disassembly,
        created_at=new_mapping.created_at
    )


@router.get("/item-mappings", response_model=List[ItemMappingResponse])
def list_item_mappings(
    item_category: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    List item to Xactimate code mappings.
    """
    repository = PackoutRepository(db)
    mappings = repository.list_item_mappings(
        item_category=item_category,
        limit=limit,
        offset=offset
    )

    return [
        ItemMappingResponse(
            id=mapping.id,
            item_name=mapping.item_name,
            item_category=mapping.item_category,
            item_subcategory=mapping.item_subcategory,
            primary_code_id=mapping.primary_code_id,
            additional_codes=mapping.additional_codes or [],
            default_fragility=mapping.default_fragility,
            default_size=mapping.default_size,
            items_per_box=mapping.items_per_box,
            requires_disassembly=mapping.requires_disassembly,
            created_at=mapping.created_at
        )
        for mapping in mappings
    ]


@router.get("/statistics")
def get_packout_statistics(
    company_id: Optional[int] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Get packout statistics.
    """
    # Use user's company if not specified
    if not company_id:
        company_id = current_user.get("company_id")

    repository = PackoutRepository(db)

    # Parse dates if provided
    from datetime import datetime
    date_from_parsed = datetime.fromisoformat(date_from) if date_from else None
    date_to_parsed = datetime.fromisoformat(date_to) if date_to else None

    stats = repository.get_packout_statistics(
        company_id=company_id,
        date_from=date_from_parsed,
        date_to=date_to_parsed
    )

    return stats