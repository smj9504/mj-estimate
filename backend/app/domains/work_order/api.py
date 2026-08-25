"""
Work Order API endpoints
"""

from fastapi import APIRouter, HTTPException, Depends, Query, Body
from typing import List, Optional
from uuid import UUID
from datetime import datetime
import logging

from .schemas import (
    WorkOrder, WorkOrderCreate, WorkOrderUpdate, WorkOrderResponse,
    WorkOrdersResponse, WorkOrderFilter, CompletionReportRequest
)
from .service import WorkOrderService
from .models import WorkOrderStatus
from app.core.database_factory import get_database
from app.domains.auth.dependencies import get_current_staff
from app.domains.staff.models import Staff
from app.domains.staff.service import StaffService

router = APIRouter()
logger = logging.getLogger(__name__)


def get_work_order_service():
    """Dependency to get work order service"""
    return WorkOrderService(get_database())


def get_staff_service():
    """Dependency to get staff service"""
    return StaffService(get_database())


def populate_staff_names(work_orders: List[dict], staff_service: StaffService) -> List[dict]:
    """Populate staff names in work orders"""
    import logging
    
    logger = logging.getLogger(__name__)
    
    # Get unique staff IDs (they're already strings from UUIDType)
    staff_ids = set()
    for wo in work_orders:
        if wo.get('created_by_staff_id'):
            staff_ids.add(wo['created_by_staff_id'])
        if wo.get('assigned_to_staff_id'):
            staff_ids.add(wo['assigned_to_staff_id'])
    
    logger.info(f"Found {len(staff_ids)} unique staff IDs to fetch: {staff_ids}")

    # Fetch all staff in one batched query instead of one query per staff ID
    staff_map = {}
    if staff_ids:
        try:
            staff_list = staff_service.get_all(filters={'id': list(staff_ids)})
            for staff in staff_list:
                staff_id = staff.get('id')
                name = staff.get('name')
                if not name:
                    first = staff.get('first_name', '')
                    last = staff.get('last_name', '')
                    name = f"{first} {last}".strip() if first or last else staff.get('username', 'Unknown')
                staff_map[staff_id] = name
            logger.info(f"Fetched {len(staff_map)} staff records in one batched query")
        except Exception as e:
            logger.error(f"Error fetching staff for IDs {staff_ids}: {e}")
    
    # Populate names in work orders
    for wo in work_orders:
        created_by = wo.get('created_by_staff_id')
        assigned_to = wo.get('assigned_to_staff_id')
        
        wo['created_by_staff_name'] = staff_map.get(created_by) if created_by else None
        wo['assigned_to_staff_name'] = staff_map.get(assigned_to) if assigned_to else None
    
    logger.info(f"Populated staff names for {len(work_orders)} work orders")
    
    return work_orders


@router.get("/", response_model=WorkOrdersResponse)
async def get_work_orders(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(10, ge=1, le=100, description="Page size"),
    search: Optional[str] = Query(None, description="Search term for work order number, client name, email, phone, or description"),
    status: Optional[WorkOrderStatus] = Query(None, description="Filter by status"),
    company_id: Optional[UUID] = Query(None, description="Filter by company ID"),
    assigned_to_staff_id: Optional[UUID] = Query(None, description="Filter by assigned staff ID"),
    created_by_staff_id: Optional[UUID] = Query(None, description="Filter by creator staff ID"),
    document_type: Optional[str] = Query(None, description="Filter by document type code"),
    priority: Optional[str] = Query(None, description="Filter by priority (low, medium, high, urgent)"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    date_from: Optional[datetime] = Query(None, description="Filter from date"),
    date_to: Optional[datetime] = Query(None, description="Filter to date"),
    service: WorkOrderService = Depends(get_work_order_service),
    staff_service: StaffService = Depends(get_staff_service)
):
    """Get all work orders with optional filters"""
    try:
        # Build filter dictionary from query parameters
        filters = {}
        
        if status:
            filters['status'] = status
        if company_id:
            filters['company_id'] = company_id
        if assigned_to_staff_id:
            filters['assigned_to_staff_id'] = assigned_to_staff_id
        if created_by_staff_id:
            filters['created_by_staff_id'] = created_by_staff_id
        if document_type:
            filters['document_type'] = document_type
        if priority:
            filters['priority'] = priority
        if is_active is not None:
            filters['is_active'] = is_active
            
        # Handle date filters separately (not supported by base repository yet)
        # TODO: Add date range filtering support
        
        # Calculate pagination
        offset = (page - 1) * page_size
        
        # Get work orders from service with pagination
        if search:
            # Use search method if search term provided
            work_orders = service.search_work_orders(search)
            total = len(work_orders)
            # Apply pagination to search results
            work_orders = work_orders[offset:offset + page_size]
        else:
            # Regular filtering
            work_orders = service.get_all(
                filters=filters,
                order_by='-created_at',
                limit=page_size,
                offset=offset
            )
            
            # Get total count without pagination
            all_work_orders = service.get_all(filters=filters)
            total = len(all_work_orders)
        
        # Populate staff names
        work_orders = populate_staff_names(work_orders, staff_service)
        
        # Ensure cost fields are calculated for each work order
        for wo in work_orders:
            service.ensure_cost_fields(wo)
            
            # Ensure cost fields are numeric for serialization
            cost_fields = ['base_fee', 'final_cost', 'tax_amount', 'discount_amount', 'credits_applied']
            for field in cost_fields:
                if field not in wo or wo[field] is None:
                    wo[field] = 0.0
                elif isinstance(wo[field], str):
                    try:
                        wo[field] = float(wo[field])
                    except (ValueError, TypeError):
                        wo[field] = 0.0
        
        return WorkOrdersResponse(data=work_orders, total=total)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving work orders: {str(e)}")


@router.get("/{work_order_id}", response_model=WorkOrderResponse)
async def get_work_order(
    work_order_id: UUID, 
    service: WorkOrderService = Depends(get_work_order_service),
    staff_service: StaffService = Depends(get_staff_service)
):
    """Get single work order by ID"""
    try:
        # get_by_id now automatically calls ensure_cost_fields
        work_order = service.get_by_id(work_order_id)
        if not work_order:
            raise HTTPException(status_code=404, detail="Work order not found")
        
        logger.info(f"API: Work order {work_order_id} - base_fee: {work_order.get('base_fee')} (type: {type(work_order.get('base_fee'))})")
        logger.info(f"API: Work order {work_order_id} - final_cost: {work_order.get('final_cost')} (type: {type(work_order.get('final_cost'))})")
        logger.info(f"API: Work order {work_order_id} - trades: {work_order.get('trades')}")
        logger.info(f"API: Work order {work_order_id} - additional_costs: {work_order.get('additional_costs')}")
        
        # Store cost fields before populate_staff_names
        original_base_fee = work_order.get('base_fee')
        original_final_cost = work_order.get('final_cost')
        original_tax_amount = work_order.get('tax_amount')
        original_discount_amount = work_order.get('discount_amount')
        
        logger.info(f"API: Before populate_staff_names - base_fee: {original_base_fee}, final_cost: {original_final_cost}")
        
        # Populate staff names for single work order
        work_orders = populate_staff_names([work_order], staff_service)
        
        # Restore cost fields after populate_staff_names
        if work_orders and work_orders[0]:
            wo = work_orders[0]
            
            logger.info(f"API: After populate_staff_names - base_fee: {wo.get('base_fee')}, final_cost: {wo.get('final_cost')}")
            
            # Restore original cost values if they were lost
            if original_base_fee is not None:
                wo['base_fee'] = original_base_fee
            if original_final_cost is not None:
                wo['final_cost'] = original_final_cost
            if original_tax_amount is not None:
                wo['tax_amount'] = original_tax_amount
            if original_discount_amount is not None:
                wo['discount_amount'] = original_discount_amount
            
            # Ensure cost fields exist and are numeric
            cost_fields = ['base_fee', 'final_cost', 'tax_amount', 'discount_amount', 'credits_applied']
            for field in cost_fields:
                if field not in wo or wo[field] is None:
                    wo[field] = 0.0
                elif isinstance(wo[field], str):
                    try:
                        wo[field] = float(wo[field])
                    except (ValueError, TypeError):
                        wo[field] = 0.0
                else:
                    # Ensure it's a float
                    try:
                        wo[field] = float(wo[field])
                    except (ValueError, TypeError):
                        wo[field] = 0.0
            
            logger.info(f"API: Final values - base_fee: {wo.get('base_fee')} (type: {type(wo.get('base_fee'))})")
            logger.info(f"API: Final values - final_cost: {wo.get('final_cost')} (type: {type(wo.get('final_cost'))})")
        
        return WorkOrderResponse(data=work_orders[0])
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving work order: {str(e)}")


@router.post("/", response_model=WorkOrderResponse)
async def create_work_order(
    work_order: WorkOrderCreate, 
    service: WorkOrderService = Depends(get_work_order_service),
    current_staff: Staff = Depends(get_current_staff),
    staff_service: StaffService = Depends(get_staff_service)
):
    """Create new work order"""
    try:
        # Set the created_by_staff_id to the current authenticated staff
        work_order.created_by_staff_id = str(current_staff.id)
        new_work_order = service.create_work_order(work_order)
        
        # Populate staff names for the newly created work order
        work_orders = populate_staff_names([new_work_order], staff_service)
        
        return WorkOrderResponse(
            data=work_orders[0], 
            message="Work order created successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error creating work order: {str(e)}")


@router.put("/{work_order_id}", response_model=WorkOrderResponse)
async def update_work_order(
    work_order_id: UUID, 
    work_order: WorkOrderUpdate, 
    service: WorkOrderService = Depends(get_work_order_service),
    current_staff: Staff = Depends(get_current_staff),
    staff_service: StaffService = Depends(get_staff_service)
):
    """Update work order"""
    try:
        update_data = work_order.dict(exclude_none=True)
        
        # Remove protected fields
        protected_fields = ['id', 'created_at', 'created_by_staff_id']
        for field in protected_fields:
            update_data.pop(field, None)
        
        # Calculate costs if trades are being updated
        if 'trades' in update_data or 'additional_costs' in update_data:
            # Get current work order to get company_id and document_type
            current_wo = service.get_by_id(work_order_id)
            if current_wo:
                cost_breakdown = service.calculate_cost(
                    update_data.get('document_type', current_wo.get('document_type')),
                    update_data.get('trades', current_wo.get('trades', [])),
                    current_wo['company_id'],
                    update_data.get('additional_costs', current_wo.get('additional_costs', []))
                )
                
                # Update cost fields
                update_data['base_fee'] = str(cost_breakdown['base_fee'])
                update_data['final_cost'] = str(cost_breakdown['final_cost'])
                update_data['tax_amount'] = str(cost_breakdown['tax_amount'])
                update_data['discount_amount'] = str(cost_breakdown['discount_amount'])
        
        updated_work_order = service.update(work_order_id, update_data)
        if not updated_work_order:
            raise HTTPException(status_code=404, detail="Work order not found or update failed")
        
        # Populate staff names for the updated work order
        work_orders = populate_staff_names([updated_work_order], staff_service)
            
        return WorkOrderResponse(
            data=work_orders[0], 
            message="Work order updated successfully"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Update failed: {str(e)}")


@router.delete("/{work_order_id}")
async def delete_work_order(
    work_order_id: UUID, 
    service: WorkOrderService = Depends(get_work_order_service),
    current_staff: Staff = Depends(get_current_staff)
):
    """Delete work order"""
    try:
        success = service.delete(work_order_id)
        if not success:
            raise HTTPException(status_code=404, detail="Work order not found")
        return {"message": "Work order deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error deleting work order: {str(e)}")


@router.patch("/{work_order_id}/status", response_model=WorkOrderResponse)
async def update_work_order_status(
    work_order_id: UUID,
    status: WorkOrderStatus = Body(..., description="New status for the work order"),
    notes: Optional[str] = Query(None, description="Optional notes about the status change"),
    service: WorkOrderService = Depends(get_work_order_service),
    current_staff: Staff = Depends(get_current_staff)
):
    """Update work order status with timestamp tracking"""
    try:
        updated_work_order = service.update_work_order_status(
            work_order_id, status, str(current_staff.id), notes
        )
        
        if not updated_work_order:
            raise HTTPException(status_code=404, detail="Work order not found")
            
        return WorkOrderResponse(
            data=updated_work_order,
            message=f"Work order status updated to {status.value}"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error updating status: {str(e)}")


@router.get("/company/{company_id}", response_model=WorkOrdersResponse)
async def get_work_orders_by_company(
    company_id: UUID,
    status: Optional[WorkOrderStatus] = Query(None, description="Filter by status"),
    service: WorkOrderService = Depends(get_work_order_service)
):
    """Get all work orders for a specific company"""
    try:
        work_orders = service.get_work_orders_by_company(company_id, status)
        return WorkOrdersResponse(data=work_orders, total=len(work_orders))
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving work orders: {str(e)}")


@router.get("/staff/{staff_id}", response_model=WorkOrdersResponse)
async def get_work_orders_by_staff(
    staff_id: UUID,
    assigned_only: bool = Query(False, description="Only return assigned work orders"),
    service: WorkOrderService = Depends(get_work_order_service)
):
    """Get work orders associated with a staff member"""
    try:
        work_orders = service.get_work_orders_by_staff(staff_id, assigned_only)
        return WorkOrdersResponse(data=work_orders, total=len(work_orders))
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving work orders: {str(e)}")


@router.get("/dashboard/stats")
async def get_dashboard_stats(
    company_id: Optional[UUID] = Query(None, description="Filter by company ID"),
    service: WorkOrderService = Depends(get_work_order_service)
):
    """Get dashboard statistics for work orders"""
    try:
        stats = service.get_dashboard_stats(company_id)
        return stats
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving stats: {str(e)}")


@router.post("/generate-number")
async def generate_work_order_number(
    company_id: UUID = Query(..., description="Company ID for work order"),
    service: WorkOrderService = Depends(get_work_order_service)
):
    """Generate a new work order number"""
    try:
        work_order_number = service.generate_work_order_number(company_id)
        return {"work_order_number": work_order_number}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating work order number: {str(e)}")


@router.get("/statuses/list")
async def get_work_order_statuses():
    """Get list of available work order statuses"""
    return {
        "statuses": [
            {"value": status.value, "label": status.value.replace("_", " ").title()}
            for status in WorkOrderStatus
        ]
    }


@router.get("/document-types/list")
async def get_document_types(
    db = Depends(get_database)
):
    """Get list of available document types from Document Types table"""
    from app.domains.document_types import service as dt_service
    
    session = db.get_session()
    try:
        document_types = dt_service.get_document_types(session, active_only=True)
        return {
            "document_types": [
                {"value": doc_type.code, "label": doc_type.name}
                for doc_type in document_types
                if hasattr(doc_type, 'code') and hasattr(doc_type, 'name')
            ]
        }
    finally:
        session.close()


@router.get("/priorities/list")
async def get_priority_levels():
    """Get list of available priority levels"""
    return {
        "priorities": [
            {"value": "low", "label": "Low"},
            {"value": "medium", "label": "Medium"},
            {"value": "high", "label": "High"},
            {"value": "urgent", "label": "Urgent"}
        ]
    }


@router.get("/{work_order_id}/activities")
async def get_work_order_activities(
    work_order_id: UUID,
    service: WorkOrderService = Depends(get_work_order_service)
):
    """Get activities/history for a work order (placeholder for now)"""
    # For now, return empty activities
    # This can be expanded later to include actual activity tracking
    return {
        "activities": [],
        "total": 0
    }


@router.post("/calculate-cost")
async def calculate_work_order_cost(
    data: dict = Body(..., description="Cost calculation parameters"),
    service: WorkOrderService = Depends(get_work_order_service)
):
    """Calculate work order cost based on document type, trades, and additional costs"""
    try:
        # Extract parameters
        document_type = data.get('document_type')
        trades = data.get('trades', [])
        company_id = data.get('company_id')
        additional_costs = data.get('additional_costs', [])
        
        # Calculate cost
        cost_breakdown = service.calculate_cost(document_type, trades, company_id, additional_costs)
        
        return cost_breakdown
        
    except Exception as e:
        logger.error(f"Error calculating cost: {e}")
        raise HTTPException(status_code=500, detail=f"Error calculating cost: {str(e)}")


@router.get("/{work_order_id}/files/count")
async def get_work_order_file_count(
    work_order_id: UUID,
    file_type: Optional[str] = Query(None, description="Filter by file type (image/document)")
):
    """Get file count for work order"""
    try:
        from app.domains.file.service import FileService
        from app.core.database_factory import get_database

        file_service = FileService(get_database())

        if file_type:
            count = file_service.get_file_count_by_type(
                context="work-order",
                context_id=str(work_order_id),
                file_type=file_type
            )
        else:
            count = file_service.get_file_count(
                context="work-order",
                context_id=str(work_order_id)
            )

        return {"count": count}

    except Exception as e:
        logger.error(f"Error getting file count: {e}")
        raise HTTPException(status_code=500, detail=f"Error getting file count: {str(e)}")


@router.get("/{work_order_id}/debug")
async def debug_work_order(
    work_order_id: UUID,
    service: WorkOrderService = Depends(get_work_order_service)
):
    """Debug endpoint to check work order data and cost calculation"""
    try:
        # Get raw work order data
        work_order = service.get_by_id(work_order_id)
        if not work_order:
            raise HTTPException(status_code=404, detail="Work order not found")

        # Debug info
        debug_info = {
            "raw_work_order": {
                "id": work_order.get('id'),
                "trades": work_order.get('trades'),
                "trades_type": str(type(work_order.get('trades'))),
                "base_fee": work_order.get('base_fee'),
                "base_fee_type": str(type(work_order.get('base_fee'))),
                "final_cost": work_order.get('final_cost'),
                "final_cost_type": str(type(work_order.get('final_cost'))),
                "additional_costs": work_order.get('additional_costs'),
                "company_id": work_order.get('company_id'),
                "document_type": work_order.get('document_type')
            }
        }

        # Try to recalculate costs
        if work_order.get('trades'):
            try:
                cost_breakdown = service.calculate_cost(
                    work_order.get('document_type'),
                    work_order.get('trades', []),
                    work_order.get('company_id'),
                    work_order.get('additional_costs', [])
                )
                debug_info['recalculated_costs'] = cost_breakdown
            except Exception as calc_error:
                debug_info['calculation_error'] = str(calc_error)

        # Apply ensure_cost_fields
        work_order_with_costs = service.ensure_cost_fields(work_order.copy())
        debug_info['after_ensure_cost_fields'] = {
            "base_fee": work_order_with_costs.get('base_fee'),
            "base_fee_type": str(type(work_order_with_costs.get('base_fee'))),
            "final_cost": work_order_with_costs.get('final_cost'),
            "final_cost_type": str(type(work_order_with_costs.get('final_cost')))
        }

        return debug_info

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Debug error: {str(e)}")


@router.post("/{work_order_id}/completion-report/generate")
async def generate_completion_report(
    work_order_id: UUID,
    request: CompletionReportRequest,
    service: WorkOrderService = Depends(get_work_order_service),
):
    """Generate Completion Photo Report PDF from claim photos.

    Fetches work order, company, client, and claim data, downloads selected
    photos from storage, generates a PDF report, uploads it to storage,
    and returns the PDF as a downloadable response.
    """
    import tempfile
    from pathlib import Path

    from fastapi.responses import Response

    temp_files = []  # Track all temp files for cleanup in finally block

    try:
        # 1. Get work order
        work_order = service.get_by_id(str(work_order_id))
        if not work_order:
            raise HTTPException(status_code=404, detail="Work order not found")

        # 2. Get company data
        company_data = None
        if work_order.get('company_id'):
            try:
                from app.domains.company.service import CompanyService
                company_svc = CompanyService(get_database())
                company = company_svc.get_by_id(str(work_order['company_id']))
                if company:
                    logo_path = None
                    if company.get('logo'):
                        import base64
                        try:
                            logo_data_str = company['logo']
                            if ',' in logo_data_str:
                                logo_data_str = logo_data_str.split(',', 1)[1]
                            logo_bytes = base64.b64decode(logo_data_str)
                            logo_temp = tempfile.NamedTemporaryFile(delete=False, suffix='.png')
                            logo_temp.write(logo_bytes)
                            logo_temp.close()
                            logo_path = logo_temp.name
                            temp_files.append(logo_temp.name)
                        except Exception as logo_err:
                            logger.warning(f"Failed to process company logo: {logo_err}")

                    company_data = {
                        'name': company.get('name', ''),
                        'logo': logo_path,
                        'address': company.get('address', ''),
                        'city': company.get('city', ''),
                        'state': company.get('state', ''),
                        'zipcode': company.get('zipcode', ''),
                        'phone': company.get('phone', ''),
                        'email': company.get('email', ''),
                    }
            except Exception as e:
                logger.warning(f"Failed to fetch company data: {e}")

        # 3. Get claim data
        claim_data = None
        if work_order.get('claim_id'):
            try:
                from app.domains.client.service import ClaimService
                claim_svc = ClaimService(get_database())
                claim = claim_svc.get_by_id(str(work_order['claim_id']))
                if claim:
                    claim_data = {
                        'claim_number': claim.get('claim_number', ''),
                        'insurance_company': claim.get('insurance_company', ''),
                        'policy_number': claim.get('policy_number', ''),
                        'insurance_deductible': claim.get('insurance_deductible'),
                        'date_of_loss': claim.get('date_of_loss', ''),
                        'adjuster_name': claim.get('adjuster_name', ''),
                        'adjuster_phone': claim.get('adjuster_phone', ''),
                        'adjuster_email': claim.get('adjuster_email', ''),
                    }
            except Exception as e:
                logger.warning(f"Failed to fetch claim data: {e}")

        # 4. Get client data
        client_data = None
        if work_order.get('client_id'):
            try:
                from app.domains.client.service import ClientService
                client_svc = ClientService(get_database())
                client = client_svc.get_by_id(str(work_order['client_id']))
                if client:
                    client_data = {
                        'display_name': client.get('display_name', ''),
                        'address': client.get('address', ''),
                        'city': client.get('city', ''),
                        'state': client.get('state', ''),
                        'zipcode': client.get('zipcode', ''),
                        'phone': client.get('phone', ''),
                        'email': client.get('email', ''),
                    }
            except Exception as e:
                logger.warning(f"Failed to fetch client data: {e}")

        # 5. Download photos from storage
        from app.domains.file.service import FileService, get_storage_provider
        file_service = FileService(service.db)
        storage = get_storage_provider()

        photo_items = []

        for file_id in request.photo_ids:
            try:
                file_record = file_service.repository.get_by_id(file_id)
                if not file_record or not file_record.get('is_active', True):
                    logger.warning(f"File not found or inactive: {file_id}")
                    continue

                file_url = file_record.get('url', '')
                photo_path = None

                if file_url.startswith('gs://') or file_url.startswith('b2://') or file_url.startswith('https://') or file_url.startswith('http://'):
                    photo_data = storage.download(file_url)
                    if photo_data:
                        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.jpg')
                        temp_file.write(photo_data)
                        temp_file.close()
                        photo_path = temp_file.name
                        temp_files.append(temp_file.name)
                else:
                    # Local file
                    local_path = Path(file_url)
                    if local_path.exists():
                        photo_path = str(local_path)
                    else:
                        # Try relative path from uploads dir
                        from app.core.config import settings
                        upload_path = Path(settings.STORAGE_BASE_DIR or 'uploads') / file_url
                        if upload_path.exists():
                            photo_path = str(upload_path)

                if photo_path:
                    photo_items.append({
                        'file_path': photo_path,
                        'filename': file_record.get('original_name', ''),
                        'caption': file_record.get('description', ''),
                        'category': file_record.get('category', ''),
                    })
            except Exception as e:
                logger.warning(f"Failed to download photo {file_id}: {e}")
                continue

        if not photo_items:
            raise HTTPException(status_code=400, detail="No valid photos found for the report")

        # 6. Generate PDF
        from app.common.services.pdf_service import generate_completion_report_pdf

        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
            temp_output = tmp.name

        generate_completion_report_pdf(
            work_order_data=work_order,
            photos=photo_items,
            output_path=temp_output,
            company_data=company_data,
            client_data=client_data,
            claim_data=claim_data,
            title=request.title,
            description=request.description,
            report_date=request.report_date,
            compress=request.compress,
        )

        pdf_bytes = Path(temp_output).read_bytes()
        try:
            Path(temp_output).unlink()
        except Exception:
            pass

        logger.info(f"Completion report generated: {len(pdf_bytes)} bytes, {len(photo_items)} photos")

        # 7. Upload to storage
        job_site = work_order.get('job_site_address', 'Property')
        filename = f"{job_site} - Completion Photo Report.pdf"

        from app.common.utils.storage_helpers import upload_bytes_to_storage
        storage_info = upload_bytes_to_storage(
            file_bytes=pdf_bytes,
            filename=filename,
            content_type="application/pdf",
            context="work-order",
            context_id=str(work_order_id),
            category="reports",
        )

        # 8. Create file record
        file_record_data = {
            'context': 'work-order',
            'context_id': str(work_order_id),
            'category': 'reports',
            'filename': storage_info.get('filename', filename),
            'original_name': filename,
            'content_type': 'application/pdf',
            'size': len(pdf_bytes),
            'url': storage_info.get('file_url', ''),
            'storage_provider': storage_info.get('storage_provider'),
            'is_active': True,
        }
        created_file = file_service.repository.create(file_record_data)
        file_service.repository.session.commit()

        # 9. Return PDF as response
        file_id = created_file.get('id', '') if isinstance(created_file, dict) else str(getattr(created_file, 'id', ''))
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "X-File-Id": file_id,
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate completion report: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        for temp_path in temp_files:
            try:
                Path(temp_path).unlink(missing_ok=True)
            except Exception:
                pass