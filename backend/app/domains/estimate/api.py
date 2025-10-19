"""
Estimate domain API endpoints
"""

from fastapi import APIRouter, HTTPException, Depends, Response
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
import tempfile
import os
import json
import logging
import traceback

from app.core.database_factory import get_db_session as get_db
from app.domains.estimate.schemas import (
    EstimateCreate,
    EstimateUpdate,
    EstimateResponse,
    EstimateListResponse,
    EstimateItemResponse,
    EstimatePDFRequest,
    EstimateNumberResponse
)
from app.common.services.pdf_service import pdf_service
from app.domains.estimate.service import EstimateService

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/generate-number", response_model=EstimateNumberResponse)
async def generate_estimate_number(
    company_id: Optional[str] = None,
    estimate_type: Optional[str] = None,
    db=Depends(get_db)
):
    """Generate next estimate number with company and type-specific formatting"""
    import logging
    import traceback
    logger = logging.getLogger(__name__)
    
    # Log the incoming request
    logger.info(f"=== GENERATE ESTIMATE NUMBER REQUEST ===")
    logger.info(f"company_id: {company_id}")
    logger.info(f"estimate_type: {estimate_type}")
    logger.info(f"db dependency: {db}")
    
    try:
        # Initialize database and service
        logger.info("Initializing database connection...")
        from app.core.database_factory import get_database
        database = get_database()
        logger.info(f"Database initialized: {database}")
        
        logger.info("Creating EstimateService...")
        service = EstimateService(database)
        logger.info(f"EstimateService created: {service}")
        
        # Call the service method
        logger.info("Calling service.generate_estimate_number...")
        result = service.generate_estimate_number(company_id, estimate_type)
        logger.info(f"Service result: {result}")
        
        # Create response
        logger.info("Creating EstimateNumberResponse...")
        response = EstimateNumberResponse(**result)
        logger.info(f"Response created: {response}")
        
        logger.info("=== GENERATE ESTIMATE NUMBER SUCCESS ===")
        return response
        
    except Exception as e:
        logger.error(f"=== GENERATE ESTIMATE NUMBER ERROR ===")
        logger.error(f"Error type: {type(e).__name__}")
        logger.error(f"Error message: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        logger.error(f"=== END ERROR ===")
        raise HTTPException(status_code=500, detail=f"Failed to generate estimate number: {str(e)}")


@router.get("/", response_model=List[EstimateListResponse])
async def list_estimates(
    skip: int = 0,
    limit: int = 100,
    client_name: Optional[str] = None,
    status: Optional[str] = None,
    estimate_type: Optional[str] = None,
    db=Depends(get_db)
):
    """List all estimates with optional filtering"""
    from app.core.database_factory import get_database
    database = get_database()
    service = EstimateService(database)
    
    # Get estimates
    estimates = service.get_all(limit=limit, offset=skip)
    
    # Filter by status if provided
    if status:
        estimates = [est for est in estimates if est.get('status') == status]
    
    # Filter by client_name if provided
    if client_name:
        estimates = [est for est in estimates if client_name.lower() in est.get('client_name', '').lower()]
    
    # Filter by estimate_type if provided
    if estimate_type:
        # Use estimate_type field as the primary source of truth
        estimates = [est for est in estimates if est.get('estimate_type') == estimate_type]
    
    # Convert to response format
    return [
        EstimateListResponse(
            id=est['id'],
            estimate_number=est.get('estimate_number', ''),
            estimate_type=est.get('estimate_type', 'standard'),
            company_id=est.get('company_id'),
            client_name=est.get('client_name', ''),
            client_address=est.get('client_address'),
            client_city=est.get('client_city'),
            total_amount=est.get('total_amount', 0),
            status=est.get('status', 'draft'),
            estimate_date=est.get('estimate_date'),
            valid_until=est.get('valid_until'),
            created_at=est.get('created_at'),
            updated_at=est.get('updated_at')
        )
        for est in estimates
    ]


@router.get("/insurance", response_model=List[EstimateListResponse])
async def list_insurance_estimates(
    skip: int = 0,
    limit: int = 100,
    db=Depends(get_db)
):
    """List insurance estimates"""
    from app.core.database_factory import get_database
    database = get_database()
    service = EstimateService(database)
    
    insurance_estimates = service.get_insurance_estimates()
    
    # Apply pagination
    paginated = insurance_estimates[skip:skip + limit]
    
    # Convert to response format
    return [
        EstimateListResponse(
            id=est['id'],
            estimate_number=est.get('estimate_number', ''),
            company_id=est.get('company_id'),
            client_name=est.get('client_name', ''),
            total_amount=est.get('total_amount', 0),
            status=est.get('status', 'draft'),
            estimate_date=est.get('estimate_date'),
            valid_until=est.get('valid_until'),
            created_at=est.get('created_at'),
            updated_at=est.get('updated_at')
        )
        for est in paginated
    ]


@router.get("/{estimate_id}", response_model=EstimateResponse)
async def get_estimate(estimate_id: str, db=Depends(get_db)):
    """Get a specific estimate by ID"""
    from app.core.database_factory import get_database
    database = get_database()
    service = EstimateService(database)
    
    estimate = service.get_with_items(estimate_id)
    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    logger.info(f"API get_estimate - estimate items before response conversion:")
    if estimate.get('items'):
        for i, item in enumerate(estimate['items']):
            logger.info(f"  Item {i}: name='{item.get('name')}', description='{item.get('description')}'")
    else:
        logger.info("  No items found in estimate")


    # Get company information if company_id exists
    company_info = {}
    if estimate.get('company_id'):
        try:
            from app.domains.company.repository import get_company_repository
            company_repo = get_company_repository(db)
            company = company_repo.get_by_id(str(estimate['company_id']))
            if company:
                company_info = {
                    'company_name': company.get('name'),
                    'company_address': company.get('address'),
                    'company_city': company.get('city'),
                    'company_state': company.get('state'),
                    'company_zipcode': company.get('zipcode'),
                    'company_phone': company.get('phone'),
                    'company_email': company.get('email'),
                }
        except Exception as e:
            logger.error(f"Error fetching company info: {e}")

    # Merge company info into estimate
    estimate.update(company_info)

    # Parse room_data if it's a string
    if estimate.get('room_data') and isinstance(estimate['room_data'], str):
        try:
            estimate['room_data'] = json.loads(estimate['room_data'])
        except json.JSONDecodeError:
            pass
    
    # Convert to response format
    return EstimateResponse(
        id=estimate['id'],
        estimate_number=estimate.get('estimate_number', ''),
        estimate_type=estimate.get('estimate_type', 'standard'),
        company_id=estimate.get('company_id'),
        company_name=estimate.get('company_name'),
        company_address=estimate.get('company_address'),
        company_city=estimate.get('company_city'),
        company_state=estimate.get('company_state'),
        company_zipcode=estimate.get('company_zipcode'),
        company_phone=estimate.get('company_phone'),
        company_email=estimate.get('company_email'),
        client_name=estimate.get('client_name', ''),
        client_address=estimate.get('client_address'),
        client_city=estimate.get('client_city'),
        client_state=estimate.get('client_state'),
        client_zipcode=estimate.get('client_zipcode'),
        client_phone=estimate.get('client_phone'),
        client_email=estimate.get('client_email'),
        estimate_date=estimate.get('estimate_date'),
        loss_date=estimate.get('loss_date'),
        valid_until=estimate.get('valid_until'),
        status=estimate.get('status', 'draft'),
        subtotal=estimate.get('subtotal', 0),
        tax_rate=estimate.get('tax_rate', 0),
        tax_amount=estimate.get('tax_amount', 0),
        discount_amount=estimate.get('discount_amount', 0),
        total_amount=estimate.get('total_amount', 0),
        claim_number=estimate.get('claim_number'),
        policy_number=estimate.get('policy_number'),
        insurance_company=estimate.get('insurance_company'),
        deductible=estimate.get('deductible'),
        adjuster_name=estimate.get('adjuster_name'),
        adjuster_phone=estimate.get('adjuster_phone'),
        adjuster_email=estimate.get('adjuster_email'),
        depreciation_amount=estimate.get('depreciation_amount', 0),
        acv_amount=estimate.get('acv_amount', 0),
        rcv_amount=estimate.get('rcv_amount', 0),
        notes=estimate.get('notes'),
        terms=estimate.get('terms'),
        room_data=estimate.get('room_data'),
        created_at=estimate.get('created_at'),
        updated_at=estimate.get('updated_at'),
        items=[
            EstimateItemResponse(
                id=item.get('id'),
                estimate_id=item.get('estimate_id'),
                room=item.get('room'),
                name=item.get('name'),
                description=item.get('description', ''),
                quantity=item.get('quantity', 0),
                unit=item.get('unit', ''),
                rate=item.get('rate', 0),
                amount=item.get('amount', 0),
                tax_rate=item.get('tax_rate', 0),
                tax_amount=item.get('tax_amount', 0),
                category=item.get('category'),
                primary_group=item.get('primary_group'),
                secondary_group=item.get('secondary_group'),
                sort_order=item.get('sort_order', 0),
                note=item.get('note'),
                depreciation_rate=item.get('depreciation_rate', 0),
                depreciation_amount=item.get('depreciation_amount', 0),
                acv_amount=item.get('acv_amount', 0),
                rcv_amount=item.get('rcv_amount', 0),
                order_index=item.get('order_index'),
                created_at=item.get('created_at'),
                updated_at=item.get('updated_at')
            )
            for item in estimate.get('items', [])
        ]
    )


@router.post("/", response_model=EstimateResponse)
async def create_estimate(estimate_data: EstimateCreate, db=Depends(get_db)):
    """Create a new estimate"""
    import logging
    logger = logging.getLogger(__name__)
    print("=== CREATE ESTIMATE ENDPOINT HIT ===")
    print(f"Received estimate data: {estimate_data.dict()}")
    logger.error(f"CREATE ESTIMATE ENDPOINT HIT: {estimate_data.dict()}")
    
    try:
        # Initialize service
        from app.core.database_factory import get_database
        database = get_database()
        service = EstimateService(database)
    except Exception as e:
        logger.error(f"Error initializing service: {e}")
        raise HTTPException(status_code=500, detail="Service initialization failed")
    
    # Determine company code if company_id is provided
    company_code = None
    if estimate_data.company_id:
        try:
            from app.domains.company.repository import get_company_repository
            company_repo = get_company_repository(db)
            company = company_repo.get_by_id(str(estimate_data.company_id))
            if company:
                company_code = company.get('company_code')
        except Exception as e:
            logger.error(f"Error fetching company: {e}")
    
    # Generate estimate number if not provided
    if not estimate_data.estimate_number:
        if company_code and estimate_data.client_address:
            # Try to generate a location-based estimate number
            try:
                from app.services.document_service import generate_estimate_number
                estimate_data.estimate_number = generate_estimate_number(
                    estimate_data.client_address,
                    company_code
                )
            except:
                # Fallback to timestamp-based number
                estimate_data.estimate_number = f"EST-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        else:
            # Fallback to timestamp-based number
            estimate_data.estimate_number = f"EST-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    
    # Convert dates if provided
    estimate_date = estimate_data.estimate_date or datetime.now()
    loss_date = estimate_data.loss_date
    valid_until = estimate_data.valid_until or (datetime.now() + timedelta(days=30))
    
    # Prepare data for repository
    estimate_dict = {
        'estimate_number': estimate_data.estimate_number,
        'estimate_type': estimate_data.estimate_type or 'standard',
        'company_id': str(estimate_data.company_id) if estimate_data.company_id else None,
        'client_name': estimate_data.client_name,
        'client_address': estimate_data.client_address,
        'client_city': estimate_data.client_city,
        'client_state': estimate_data.client_state,
        'client_zipcode': estimate_data.client_zipcode,
        'client_phone': estimate_data.client_phone,
        'client_email': estimate_data.client_email,
        'estimate_date': estimate_date,
        'loss_date': loss_date,
        'valid_until': valid_until,
        'status': estimate_data.status or 'draft',
        'notes': estimate_data.notes,
        'terms': estimate_data.terms,
        'claim_number': estimate_data.claim_number,
        'policy_number': estimate_data.policy_number,
        'deductible': estimate_data.deductible,
        'room_data': estimate_data.room_data,
        'items': [
            {
                'room': item.room,
                'description': item.description,
                'quantity': item.quantity,
                'unit': item.unit,
                'rate': item.rate,
                'category': item.category,
                'primary_group': item.primary_group,
                'secondary_group': item.secondary_group,
                'sort_order': item.sort_order,
                'note': item.note,
                'depreciation_rate': item.depreciation_rate,
                'depreciation_amount': item.depreciation_amount,
                'acv_amount': item.acv_amount,
                'rcv_amount': item.rcv_amount
            }
            for item in estimate_data.items
        ]
    }
    
    # Create estimate using service
    created_estimate = service.create_with_items(estimate_dict)
    
    # Parse room_data if it's a string
    if created_estimate.get('room_data') and isinstance(created_estimate['room_data'], str):
        try:
            created_estimate['room_data'] = json.loads(created_estimate['room_data'])
        except json.JSONDecodeError:
            pass
    
    # Convert to response format
    return EstimateResponse(
        id=created_estimate['id'],
        estimate_number=created_estimate.get('estimate_number', ''),
        estimate_type=created_estimate.get('estimate_type', 'standard'),
        company_id=created_estimate.get('company_id'),
        client_name=created_estimate.get('client_name', ''),
        client_address=created_estimate.get('client_address'),
        client_city=created_estimate.get('client_city'),
        client_state=created_estimate.get('client_state'),
        client_zipcode=created_estimate.get('client_zipcode'),
        client_phone=created_estimate.get('client_phone'),
        client_email=created_estimate.get('client_email'),
        estimate_date=created_estimate.get('estimate_date'),
        loss_date=created_estimate.get('loss_date'),
        valid_until=created_estimate.get('valid_until'),
        status=created_estimate.get('status', 'draft'),
        subtotal=created_estimate.get('subtotal', 0),
        tax_rate=created_estimate.get('tax_rate', 0),
        tax_amount=created_estimate.get('tax_amount', 0),
        discount_amount=created_estimate.get('discount_amount', 0),
        total_amount=created_estimate.get('total_amount', 0),
        claim_number=created_estimate.get('claim_number'),
        policy_number=created_estimate.get('policy_number'),
        deductible=created_estimate.get('deductible'),
        depreciation_amount=created_estimate.get('depreciation_amount', 0),
        acv_amount=created_estimate.get('acv_amount', 0),
        rcv_amount=created_estimate.get('rcv_amount', 0),
        notes=created_estimate.get('notes'),
        terms=created_estimate.get('terms'),
        room_data=created_estimate.get('room_data'),
        created_at=created_estimate.get('created_at'),
        updated_at=created_estimate.get('updated_at'),
        items=[
            EstimateItemResponse(
                id=item.get('id'),
                estimate_id=item.get('estimate_id'),
                room=item.get('room'),
                name=item.get('name'),
                description=item.get('description', ''),
                quantity=item.get('quantity', 0),
                unit=item.get('unit', ''),
                rate=item.get('rate', 0),
                amount=item.get('amount', 0),
                tax_rate=item.get('tax_rate', 0),
                tax_amount=item.get('tax_amount', 0),
                category=item.get('category'),
                primary_group=item.get('primary_group'),
                secondary_group=item.get('secondary_group'),
                sort_order=item.get('sort_order', 0),
                note=item.get('note'),
                depreciation_rate=item.get('depreciation_rate', 0),
                depreciation_amount=item.get('depreciation_amount', 0),
                acv_amount=item.get('acv_amount', 0),
                rcv_amount=item.get('rcv_amount', 0),
                order_index=item.get('order_index'),
                created_at=item.get('created_at'),
                updated_at=item.get('updated_at')
            )
            for item in created_estimate.get('items', [])
        ]
    )


@router.put("/{estimate_id}", response_model=EstimateResponse)
async def update_estimate(
    estimate_id: str,
    estimate_data: EstimateUpdate,
    db=Depends(get_db)
):
    """Update an existing estimate"""
    from app.core.database_factory import get_database
    database = get_database()
    service = EstimateService(database)
    
    # Check if estimate exists
    existing = service.get_by_id(estimate_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Estimate not found")
    
    # Prepare update data
    update_dict = estimate_data.dict(exclude_unset=True)

    # Debug logging
    logger.info(f"=== UPDATE ESTIMATE DEBUG ===")
    logger.info(f"Estimate ID: {estimate_id}")
    logger.info(f"Raw update_dict: {update_dict}")
    logger.info(f"loss_date in update_dict: {update_dict.get('loss_date')}")
    logger.info(f"company_id in update_dict: {update_dict.get('company_id')}")
    
    # Update estimate with items
    updated_estimate = service.update_with_items(estimate_id, update_dict)
    if not updated_estimate:
        raise HTTPException(status_code=500, detail="Failed to update estimate")
    
    # Parse room_data if it's a string
    if updated_estimate.get('room_data') and isinstance(updated_estimate['room_data'], str):
        try:
            updated_estimate['room_data'] = json.loads(updated_estimate['room_data'])
        except json.JSONDecodeError:
            pass
    
    # Convert to response format
    return EstimateResponse(
        id=updated_estimate['id'],
        estimate_number=updated_estimate.get('estimate_number', ''),
        estimate_type=updated_estimate.get('estimate_type', 'standard'),
        company_id=updated_estimate.get('company_id'),
        client_name=updated_estimate.get('client_name', ''),
        client_address=updated_estimate.get('client_address'),
        client_city=updated_estimate.get('client_city'),
        client_state=updated_estimate.get('client_state'),
        client_zipcode=updated_estimate.get('client_zipcode'),
        client_phone=updated_estimate.get('client_phone'),
        client_email=updated_estimate.get('client_email'),
        estimate_date=updated_estimate.get('estimate_date'),
        loss_date=updated_estimate.get('loss_date'),
        valid_until=updated_estimate.get('valid_until'),
        status=updated_estimate.get('status', 'draft'),
        subtotal=updated_estimate.get('subtotal', 0),
        tax_rate=updated_estimate.get('tax_rate', 0),
        tax_amount=updated_estimate.get('tax_amount', 0),
        discount_amount=updated_estimate.get('discount_amount', 0),
        total_amount=updated_estimate.get('total_amount', 0),
        claim_number=updated_estimate.get('claim_number'),
        policy_number=updated_estimate.get('policy_number'),
        insurance_company=updated_estimate.get('insurance_company'),
        deductible=updated_estimate.get('deductible'),
        adjuster_name=updated_estimate.get('adjuster_name'),
        adjuster_phone=updated_estimate.get('adjuster_phone'),
        adjuster_email=updated_estimate.get('adjuster_email'),
        depreciation_amount=updated_estimate.get('depreciation_amount', 0),
        acv_amount=updated_estimate.get('acv_amount', 0),
        rcv_amount=updated_estimate.get('rcv_amount', 0),
        notes=updated_estimate.get('notes'),
        terms=updated_estimate.get('terms'),
        room_data=updated_estimate.get('room_data'),
        created_at=updated_estimate.get('created_at'),
        updated_at=updated_estimate.get('updated_at'),
        items=[
            EstimateItemResponse(
                id=item.get('id'),
                estimate_id=item.get('estimate_id'),
                room=item.get('room'),
                name=item.get('name'),
                description=item.get('description', ''),
                quantity=item.get('quantity', 0),
                unit=item.get('unit', ''),
                rate=item.get('rate', 0),
                amount=item.get('amount', 0),
                tax_rate=item.get('tax_rate', 0),
                tax_amount=item.get('tax_amount', 0),
                category=item.get('category'),
                primary_group=item.get('primary_group'),
                secondary_group=item.get('secondary_group'),
                sort_order=item.get('sort_order', 0),
                note=item.get('note'),
                depreciation_rate=item.get('depreciation_rate', 0),
                depreciation_amount=item.get('depreciation_amount', 0),
                acv_amount=item.get('acv_amount', 0),
                rcv_amount=item.get('rcv_amount', 0),
                order_index=item.get('order_index'),
                created_at=item.get('created_at'),
                updated_at=item.get('updated_at')
            )
            for item in updated_estimate.get('items', [])
        ]
    )


@router.delete("/{estimate_id}")
async def delete_estimate(estimate_id: str, db=Depends(get_db)):
    """Delete an estimate"""
    from app.core.database_factory import get_database
    database = get_database()
    service = EstimateService(database)
    
    # Check if estimate exists
    existing = service.get_by_id(estimate_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Estimate not found")
    
    # Delete estimate
    if not service.delete(estimate_id):
        raise HTTPException(status_code=500, detail="Failed to delete estimate")
    
    return {"message": "Estimate deleted successfully"}


@router.post("/{estimate_id}/accept")
async def accept_estimate(estimate_id: str, db=Depends(get_db)):
    """Accept an estimate"""
    from app.core.database_factory import get_database
    database = get_database()
    service = EstimateService(database)
    
    updated_estimate = service.accept_estimate(estimate_id)
    if not updated_estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")
    
    return {"message": "Estimate accepted successfully", "status": "accepted"}


@router.post("/{estimate_id}/reject")
async def reject_estimate(
    estimate_id: str, 
    reason: Optional[str] = None,
    db=Depends(get_db)
):
    """Reject an estimate"""
    from app.core.database_factory import get_database
    database = get_database()
    service = EstimateService(database)
    
    updated_estimate = service.reject_estimate(estimate_id, reason)
    if not updated_estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")
    
    return {"message": "Estimate rejected", "status": "rejected", "reason": reason}


@router.post("/{estimate_id}/convert-to-invoice")
async def convert_estimate_to_invoice(estimate_id: str, db=Depends(get_db)):
    """Convert estimate to invoice"""
    from app.core.database_factory import get_database
    database = get_database()
    service = EstimateService(database)
    
    try:
        invoice = service.convert_to_invoice(estimate_id)
        return {
            "message": "Estimate converted to invoice successfully",
            "invoice_id": invoice.get('id'),
            "invoice_number": invoice.get('invoice_number')
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{estimate_id}/duplicate", response_model=EstimateResponse)
async def duplicate_estimate(estimate_id: str, db=Depends(get_db)):
    """Duplicate an existing estimate"""
    from app.core.database_factory import get_database
    database = get_database()
    service = EstimateService(database)
    
    # Duplicate estimate
    duplicated = service.duplicate(estimate_id)
    if not duplicated:
        raise HTTPException(status_code=404, detail="Estimate not found or failed to duplicate")
    
    # Parse room_data if it's a string
    if duplicated.get('room_data') and isinstance(duplicated['room_data'], str):
        try:
            duplicated['room_data'] = json.loads(duplicated['room_data'])
        except json.JSONDecodeError:
            pass
    
    # Convert to response format
    return EstimateResponse(
        id=duplicated['id'],
        estimate_number=duplicated.get('estimate_number', ''),
        estimate_type=duplicated.get('estimate_type', 'standard'),
        company_id=duplicated.get('company_id'),
        client_name=duplicated.get('client_name', ''),
        client_address=duplicated.get('client_address'),
        client_city=duplicated.get('client_city'),
        client_state=duplicated.get('client_state'),
        client_zipcode=duplicated.get('client_zipcode'),
        client_phone=duplicated.get('client_phone'),
        client_email=duplicated.get('client_email'),
        estimate_date=duplicated.get('estimate_date'),
        valid_until=duplicated.get('valid_until'),
        status=duplicated.get('status', 'draft'),
        subtotal=duplicated.get('subtotal', 0),
        tax_rate=duplicated.get('tax_rate', 0),
        tax_amount=duplicated.get('tax_amount', 0),
        discount_amount=duplicated.get('discount_amount', 0),
        total_amount=duplicated.get('total_amount', 0),
        claim_number=duplicated.get('claim_number'),
        policy_number=duplicated.get('policy_number'),
        deductible=duplicated.get('deductible'),
        depreciation_amount=duplicated.get('depreciation_amount', 0),
        acv_amount=duplicated.get('acv_amount', 0),
        rcv_amount=duplicated.get('rcv_amount', 0),
        notes=duplicated.get('notes'),
        terms=duplicated.get('terms'),
        room_data=duplicated.get('room_data'),
        created_at=duplicated.get('created_at'),
        updated_at=duplicated.get('updated_at'),
        items=[
            EstimateItemResponse(
                id=item.get('id'),
                estimate_id=item.get('estimate_id'),
                room=item.get('room'),
                name=item.get('name'),
                description=item.get('description', ''),
                quantity=item.get('quantity', 0),
                unit=item.get('unit', ''),
                rate=item.get('rate', 0),
                amount=item.get('amount', 0),
                tax_rate=item.get('tax_rate', 0),
                tax_amount=item.get('tax_amount', 0),
                category=item.get('category'),
                primary_group=item.get('primary_group'),
                secondary_group=item.get('secondary_group'),
                sort_order=item.get('sort_order', 0),
                note=item.get('note'),
                depreciation_rate=item.get('depreciation_rate', 0),
                depreciation_amount=item.get('depreciation_amount', 0),
                acv_amount=item.get('acv_amount', 0),
                rcv_amount=item.get('rcv_amount', 0),
                order_index=item.get('order_index'),
                created_at=item.get('created_at'),
                updated_at=item.get('updated_at')
            )
            for item in duplicated.get('items', [])
        ]
    )


def _group_items_into_sections(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Group items by primary_group to create sections for PDF rendering"""
    logger = logging.getLogger(__name__)
    logger.info(f"_group_items_into_sections called with {len(items)} items")

    if not items:
        logger.info("No items found, returning empty sections")
        return []

    # Debug: log first item structure and all group fields
    if items:
        first_item = items[0]
        logger.info(f"First item structure: {list(first_item.keys())}")
        logger.info(f"First item primary_group: '{first_item.get('primary_group')}'")
        logger.info(f"First item secondary_group: '{first_item.get('secondary_group')}'")
        logger.info(f"First item room: '{first_item.get('room')}'")

        # Log all items' group information
        for i, item in enumerate(items[:5]):  # Log first 5 items only
            item_name = item.get('name') or item.get('description', '')
            logger.info(f"Item {i+1}: name='{item_name[:50]}...', primary_group='{item.get('primary_group')}', room='{item.get('room')}'")

    sections_dict = {}
    for item in items:
        # Try multiple possible field names for section/group
        group = (item.get('primary_group') or
                item.get('secondary_group') or
                item.get('room') or
                item.get('section') or
                item.get('group') or
                item.get('category') or
                'General')

        if not group or group.strip() == '':
            group = 'General'

        if group not in sections_dict:
            sections_dict[group] = {
                'title': group,
                'items': [],
                'subtotal': 0,
                'showSubtotal': True
            }

        # Add processed item to section
        # Use description as name if name is not provided (frontend compatibility)
        item_name = item.get('name') or item.get('description', '')
        item_description = item.get('description', '') if item.get('name') else ''

        sections_dict[group]['items'].append({
            'name': item_name,
            'description': item_description,
            'note': item.get('note', ''),
            'quantity': item.get('quantity', 0),
            'unit': item.get('unit', 'EA'),
            'rate': item.get('rate', 0)
        })

        # Update section subtotal
        item_total = item.get('quantity', 0) * item.get('rate', 0)
        sections_dict[group]['subtotal'] += item_total

    # Convert to list and sort by section name
    sections = list(sections_dict.values())
    sections.sort(key=lambda x: x['title'])

    logger.info(f"Created {len(sections)} sections:")
    for section in sections:
        logger.info(f"  Section '{section['title']}': {len(section['items'])} items, subtotal: {section['subtotal']}")
        # Debug: check if items is actually a list
        logger.info(f"  Section items type: {type(section['items'])}")

    return sections


@router.post("/{estimate_id}/pdf")
async def generate_estimate_pdf(estimate_id: str, db=Depends(get_db)):
    """Generate PDF for an estimate"""
    from app.core.database_factory import get_database
    database = get_database()
    service = EstimateService(database)
    
    # Get estimate from database
    estimate = service.get_with_items(estimate_id)
    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    # Get company info if company_id exists
    if estimate.get('company_id'):
        try:
            from app.domains.company.repository import get_company_repository
            company_repo = get_company_repository(db)
            company_info = company_repo.get_by_id(str(estimate['company_id']))
            if company_info:
                # Merge company info
                estimate['company_name'] = company_info.get('name')
                estimate['company_address'] = company_info.get('address')
                estimate['company_city'] = company_info.get('city')
                estimate['company_state'] = company_info.get('state')
                estimate['company_zipcode'] = company_info.get('zipcode')
                estimate['company_phone'] = company_info.get('phone')
                estimate['company_email'] = company_info.get('email')
                estimate['company_logo'] = company_info.get('logo')
        except Exception as e:
            logger.error(f"Error fetching company info: {e}")

    # Prepare data for PDF generation
    # Generate sections from items first
    items_data = estimate.get('items', [])
    logger.info(f"Total items for PDF: {len(items_data)}")
    if items_data:
        logger.info(f"Sample item structure: {items_data[0]}")

    sections_data = _group_items_into_sections(items_data)
    logger.info(f"PDF context sections: {len(sections_data)} sections created")

    # Log each section details
    for i, section in enumerate(sections_data):
        logger.info(f"  Section {i+1}: '{section.get('title')}' with {len(section.get('items', []))} items")

    pdf_data = {
        "estimate_number": estimate.get('estimate_number', ''),
        "estimate_date": estimate.get('estimate_date', estimate.get('created_at', '')),
        "valid_until": estimate.get('valid_until', ''),
        "company": {
            "name": estimate.get('company_name', ''),
            "address": estimate.get('company_address'),
            "city": estimate.get('company_city'),
            "state": estimate.get('company_state'),
            "zip": estimate.get('company_zipcode'),
            "phone": estimate.get('company_phone'),
            "email": estimate.get('company_email'),
            "logo": estimate.get('company_logo')
        },
        "client": {
            "name": estimate.get('client_name', ''),
            "address": estimate.get('client_address'),
            "city": estimate.get('client_city'),
            "state": estimate.get('client_state'),
            "zip": estimate.get('client_zipcode'),
            "phone": estimate.get('client_phone'),
            "email": estimate.get('client_email')
        },
        "items": [
            {
                "name": item.get('name') or item.get('description', ''),
                "room": item.get('room', ''),
                "description": item.get('description', ''),
                "note": item.get('note', ''),
                "quantity": item.get('quantity', 0),
                "unit": item.get('unit', ''),
                "rate": item.get('rate', 0),
                "primary_group": item.get('primary_group')
            }
            for item in estimate.get('items', [])
        ],
        # Add sections data for proper section-based display
        "sections": sections_data,
        "subtotal": estimate.get('subtotal', 0),
        "op_percent": estimate.get('op_percent', 0),
        "op_amount": estimate.get('op_amount', 0),
        "tax_rate": estimate.get('tax_rate', 0),
        "tax_amount": estimate.get('tax_amount', 0),
        "discount_amount": estimate.get('discount_amount', 0),
        "total": estimate.get('total_amount', 0),
        "claim_number": estimate.get('claim_number'),
        "policy_number": estimate.get('policy_number'),
        "deductible": estimate.get('deductible'),
        "notes": estimate.get('notes'),
        "terms": estimate.get('terms')
    }
    
    # Generate PDF
    if not pdf_service:
        raise HTTPException(status_code=500, detail="PDF service not available")
    
    # Create temporary file for PDF
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp_file:
        output_path = tmp_file.name
    
    try:
        # Generate PDF
        pdf_path = pdf_service.generate_estimate_pdf(pdf_data, output_path)
        
        # Read PDF file
        with open(pdf_path, "rb") as pdf_file:
            pdf_content = pdf_file.read()
        
        # Clean up temp file
        os.unlink(pdf_path)
        
        # Return PDF as response
        return Response(
            content=pdf_content,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"attachment; filename=estimate_{estimate.get('estimate_number', 'unknown')}.pdf"
            }
        )
    except Exception as e:
        # Clean up on error
        if os.path.exists(output_path):
            os.unlink(output_path)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/preview-html")
async def preview_estimate_html(data: EstimatePDFRequest):
    """Generate HTML preview from estimate data without saving"""
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        # Prepare data for HTML generation
        html_data = data.dict()
        logger.info(f"Generating HTML preview with data keys: {html_data.keys()}")

        # Generate sections from items before passing to PDF service
        if 'items' in html_data:
            sections_data = _group_items_into_sections(html_data.get('items', []))
            html_data['sections'] = sections_data
            logger.info(f"Generated {len(sections_data)} sections for HTML preview")

        # Use the same PDF service but get HTML instead of PDF
        if not pdf_service:
            raise HTTPException(status_code=500, detail="PDF service not available")
        html_content = pdf_service.generate_estimate_html(html_data)
        
        logger.info(f"HTML content length: {len(html_content)} characters")
        
        # Return HTML as response
        return Response(
            content=html_content,
            media_type="text/html",
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0"
            }
        )
        
    except Exception as e:
        logger.error(f"HTML generation error: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to generate HTML preview: {str(e)}")

@router.post("/preview-pdf")
async def preview_estimate_pdf(data: EstimatePDFRequest):
    """Generate a preview PDF from estimate data without saving"""
    import logging
    import traceback
    logger = logging.getLogger(__name__)
    
    if not pdf_service:
        raise HTTPException(status_code=500, detail="PDF service not available")
    
    # Create temporary file for PDF
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp_file:
        output_path = tmp_file.name
    
    try:
        # Prepare data for PDF generation
        pdf_data = data.dict()
        logger.info(f"Generating PDF preview with data keys: {pdf_data.keys()}")

        # Generate sections from items before passing to PDF service
        if 'items' in pdf_data:
            sections_data = _group_items_into_sections(pdf_data.get('items', []))
            pdf_data['sections'] = sections_data
            logger.info(f"Generated {len(sections_data)} sections for PDF preview")

        # Generate PDF
        pdf_path = pdf_service.generate_estimate_pdf(pdf_data, output_path)
        logger.info(f"PDF generated successfully at: {pdf_path}")
        
        # Check if PDF file was actually created and has content
        if not os.path.exists(pdf_path):
            raise HTTPException(status_code=500, detail="PDF file was not created")
            
        file_size = os.path.getsize(pdf_path)
        if file_size == 0:
            raise HTTPException(status_code=500, detail="PDF file is empty")
            
        logger.info(f"PDF file size: {file_size} bytes")
        
        # Read PDF file
        with open(pdf_path, "rb") as pdf_file:
            pdf_content = pdf_file.read()
        
        logger.info(f"PDF content length: {len(pdf_content)} bytes")
        
        # Clean up temp file
        os.unlink(pdf_path)
        
        # Return PDF as response with improved headers
        return Response(
            content=pdf_content,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"inline; filename=preview_estimate.pdf",
                "Content-Length": str(len(pdf_content)),
                "Cache-Control": "no-cache",
                "Accept-Ranges": "bytes"
            }
        )
    except Exception as e:
        # Clean up on error
        logger.error(f"PDF generation error: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        if os.path.exists(output_path):
            os.unlink(output_path)
        raise HTTPException(status_code=500, detail=str(e))