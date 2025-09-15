"""
Company API endpoints - FIXED VERSION
This version has proper route ordering to prevent path conflicts
"""

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Query
from typing import Optional
import logging

from app.core.database_factory import get_database

logger = logging.getLogger(__name__)
from .schemas import (
    CompanyCreate, 
    CompanyUpdate, 
    CompanyResponse,
    CompanyDetailResponse,
    PaymentMethodInfo,
    PaymentFrequencyInfo,
    CompanyFilter,
    CompanyPaginatedResponse
)
from .service import CompanyService

def get_company_service():
    """Get company service instance"""
    try:
        logger.info("get_company_service: Creating database connection...")
        database = get_database()
        logger.info(f"get_company_service: Database created: {type(database)}")
        
        service = CompanyService(database)
        logger.info(f"get_company_service: Service created: {type(service)}")
        return service
    except Exception as e:
        import traceback
        logger.error(f"get_company_service ERROR: {e}")
        logger.error(f"get_company_service TRACEBACK: {traceback.format_exc()}")
        raise

router = APIRouter(
    tags=["companies"]
)


# IMPORTANT: Specific routes MUST come BEFORE path parameter routes
# to prevent FastAPI from matching everything against /{company_id}

@router.get("/")
async def get_companies(
    search: Optional[str] = Query(None, description="Search term for name, address, email, or phone"),
    city: Optional[str] = Query(None, description="Filter by city"),
    state: Optional[str] = Query(None, description="Filter by state"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    is_default: Optional[bool] = Query(None, description="Filter by default status"),
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(10, ge=1, le=100, description="Items per page"),
    service: CompanyService = Depends(get_company_service)
):
    """Get all companies with optional filters and pagination"""
    logger.info("Starting get_companies endpoint with proper dependency injection")
    try:
        # Calculate offset
        offset = (page - 1) * per_page
        logger.info(f"Calculated offset: {offset}, limit: {per_page}")
        
        # Create filter params
        filter_params = CompanyFilter(
            search=search,
            city=city,
            state=state,
            is_active=is_active,
            is_default=is_default
        )
        logger.info(f"Filter params created successfully: {filter_params}")
        
        # Get companies with filters
        logger.info("Calling service.get_companies_with_filters...")
        result = service.get_companies_with_filters(
            filter_params=filter_params,
            limit=per_page,
            offset=offset
        )
        logger.info(f"Service call completed, result type: {type(result)}")
        
        companies = result.get('companies', [])
        total = result.get('total', len(companies))
        pages = (total + per_page - 1) // per_page  # Calculate total pages
        
        logger.info(f"Found {len(companies)} companies, total: {total}")
        
        return {
            "items": companies,
            "total": total,
            "page": page,
            "per_page": per_page,
            "pages": pages
        }
    except Exception as e:
        import traceback
        logger.error(f"EXCEPTION IN get_companies: {e}")
        logger.error(f"Exception type: {type(e)}")
        logger.error(f"Full traceback: {traceback.format_exc()}")
        
        # Return proper HTTP exception
        raise HTTPException(status_code=500, detail=f"Database error occurred: {str(e)}")


@router.get("/test")
async def test_companies():
    """Test endpoint to verify database connection - NO response_model to avoid serialization issues"""
    try:
        from app.domains.company.repository import CompanyRepository
        from app.core.database_factory import get_database
        
        db = get_database()
        session = db.get_session()
        try:
            repo = CompanyRepository(session)
            companies = repo.get_all()
            logger.info(f"Found {len(companies)} companies in test endpoint")
            return {
                "status": "success",
                "companies_found": len(companies),
                "companies": companies
            }
        finally:
            session.close()
    except Exception as e:
        import traceback
        logger.error(f"Exception in test_companies: {e}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return {
            "status": "error",
            "error": str(e), 
            "traceback": traceback.format_exc()
        }


@router.get("/debug")
async def debug_companies():
    """Debug endpoint with comprehensive testing"""
    try:
        from app.core.database_factory import get_database
        from app.domains.company.service import CompanyService
        
        # Test direct database and service access
        database = get_database()
        service = CompanyService(database)
        companies = service.get_all()
        
        return {
            "status": "success",
            "companies_found": len(companies),
            "database_type": type(database).__name__,
            "service_type": type(service).__name__,
            "first_company": companies[0] if companies else None,
            "database_healthy": database.health_check()
        }
    except Exception as e:
        import traceback
        return {
            "status": "error",
            "error": str(e),
            "error_type": type(e).__name__,
            "traceback": traceback.format_exc()
        }


@router.get("/search", response_model=CompanyPaginatedResponse)
async def search_companies(
    q: str = Query(..., description="Search term for name, address, email, or phone"),
    city: Optional[str] = Query(None, description="Filter by city"),
    state: Optional[str] = Query(None, description="Filter by state"),
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(10, ge=1, le=100, description="Items per page"),
    service: CompanyService = Depends(get_company_service)
):
    """Search companies with filters and pagination"""
    
    # Calculate offset
    offset = (page - 1) * per_page
    
    # Create filter params
    filter_params = CompanyFilter(
        search=q,
        city=city,
        state=state
    )
    
    try:
        companies, total = service.get_companies_paginated(filter_params, per_page, offset)
        total_pages = (total + per_page - 1) // per_page
        
        return CompanyPaginatedResponse(
            items=companies,
            total=total,
            page=page,
            pages=total_pages
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/stats/summary")
async def get_companies_stats_summary(
    service: CompanyService = Depends(get_company_service)
):
    """Get companies statistics summary"""
    try:
        stats = service.get_companies_summary_stats()
        return stats
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/stats")
async def get_companies_with_stats(
    service: CompanyService = Depends(get_company_service)
):
    """Get companies with invoice and estimate counts"""
    try:
        companies = service.get_companies_with_stats()
        return companies
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/", response_model=CompanyResponse, status_code=201)
async def create_company(
    company: CompanyCreate, 
    service: CompanyService = Depends(get_company_service)
):
    """Create new company"""
    try:
        new_company = service.create(company)
        return CompanyResponse(**new_company)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# Path parameter routes MUST come LAST to prevent them from matching specific routes above
@router.get("/by-email/{email}", response_model=CompanyResponse)
async def get_company_by_email(
    email: str,
    service: CompanyService = Depends(get_company_service)
):
    """Get company by email address"""
    try:
        company = service.get_company_by_email(email)
        if not company:
            raise HTTPException(status_code=404, detail="Company not found")
        return CompanyResponse(**company)
    except Exception as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail="Company not found")
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{company_id}", response_model=CompanyResponse)
async def update_company(
    company_id: str, 
    company: CompanyUpdate, 
    service: CompanyService = Depends(get_company_service)
):
    """Update company"""
    try:
        updated_company = service.update(company_id, company)
        if not updated_company:
            raise HTTPException(status_code=404, detail="Company not found")
        return CompanyResponse(**updated_company)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Update failed: {str(e)}")


@router.delete("/{company_id}", status_code=204)
async def delete_company(
    company_id: str, 
    service: CompanyService = Depends(get_company_service)
):
    """Delete company"""
    try:
        success = service.delete(company_id)
        if not success:
            raise HTTPException(status_code=404, detail="Company not found")
        return None  # 204 No Content
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{company_id}/logo", response_model=dict)
async def upload_logo(
    company_id: str, 
    file: UploadFile = File(...), 
    service: CompanyService = Depends(get_company_service)
):
    """Upload company logo as base64"""
    
    # Validate file type
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    
    # Validate file size (5MB limit)
    content = await file.read()
    file_size = len(content)
    if file_size > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size must be less than 5MB")
    
    # Reset file position
    await file.seek(0)
    
    try:
        result = await service.upload_logo(company_id, file)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{company_id}/set-default", response_model=CompanyResponse)
async def set_default_company(
    company_id: str,
    service: CompanyService = Depends(get_company_service)
):
    """Set a company as the default company"""
    try:
        updated_company = service.set_default_company(company_id)
        if not updated_company:
            raise HTTPException(status_code=404, detail="Company not found")
        return CompanyResponse(**updated_company)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# GET /{company_id} should be the VERY LAST route to avoid catching other specific paths
@router.get("/{company_id}", response_model=CompanyDetailResponse)
async def get_company(
    company_id: str, 
    service: CompanyService = Depends(get_company_service)
):
    """Get single company by ID with payment configuration details"""
    company = service.get_by_id(company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    
    # Create response with payment configuration details
    response_data = {**company}
    
    # Add payment method details if available
    if company.get('payment_method_ref'):
        method_ref = company['payment_method_ref']
        response_data['payment_method_details'] = PaymentMethodInfo(
            id=method_ref.get('id'),
            code=method_ref.get('code'),
            name=method_ref.get('name'),
            description=method_ref.get('description'),
            requires_account_info=method_ref.get('requires_account_info', False),
            icon=method_ref.get('icon')
        )
    
    # Add payment frequency details if available
    if company.get('payment_frequency_ref'):
        freq_ref = company['payment_frequency_ref']
        response_data['payment_frequency_details'] = PaymentFrequencyInfo(
            id=freq_ref.get('id'),
            code=freq_ref.get('code'),
            name=freq_ref.get('name'),
            description=freq_ref.get('description'),
            days_interval=freq_ref.get('days_interval')
        )
    
    return CompanyDetailResponse(**response_data)