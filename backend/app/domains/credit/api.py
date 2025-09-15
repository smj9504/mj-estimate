"""
Credit and discount API endpoints
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from decimal import Decimal

from .schemas import (
    CustomerCredit, CustomerCreditCreate, CustomerCreditUpdate,
    CustomerCreditResponse, CustomerCreditsResponse,
    DiscountRule, DiscountRuleCreate, DiscountRuleUpdate,
    DiscountRuleResponse, DiscountRulesResponse,
    AppliedDiscount, AppliedDiscountCreate, AppliedDiscountUpdate,
    AppliedDiscountResponse, AppliedDiscountsResponse,
    CustomerCreditFilter, DiscountRuleFilter
)
from .service import CreditService
from .models import CreditType, DiscountType, CreditStatus
from app.core.database_factory import get_database

router = APIRouter()


def get_credit_service():
    """Dependency to get credit service"""
    return CreditService(get_database())


# Customer Credit endpoints
@router.get("/", response_model=CustomerCreditsResponse)
async def get_customer_credits(
    search: Optional[str] = Query(None, description="Search term"),
    credit_type: Optional[CreditType] = Query(None, description="Filter by credit type"),
    status: Optional[CreditStatus] = Query(None, description="Filter by status"),
    company_id: Optional[UUID] = Query(None, description="Filter by company ID"),
    customer_email: Optional[str] = Query(None, description="Filter by customer email"),
    amount_min: Optional[Decimal] = Query(None, description="Minimum amount"),
    amount_max: Optional[Decimal] = Query(None, description="Maximum amount"),
    date_from: Optional[datetime] = Query(None, description="Filter from date"),
    date_to: Optional[datetime] = Query(None, description="Filter to date"),
    service: CreditService = Depends(get_credit_service)
):
    """Get all customer credits with optional filters"""
    try:
        filters = CustomerCreditFilter(
            search=search,
            credit_type=credit_type,
            status=status,
            company_id=company_id,
            customer_email=customer_email,
            amount_min=amount_min,
            amount_max=amount_max,
            date_from=date_from,
            date_to=date_to
        )
        
        result = service.get_customer_credits_with_filters(filters)
        credits = result.get('credits', [])
        
        return CustomerCreditsResponse(data=credits, total=len(credits))
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving customer credits: {str(e)}")


@router.get("/{credit_id}", response_model=CustomerCreditResponse)
async def get_customer_credit(
    credit_id: UUID,
    service: CreditService = Depends(get_credit_service)
):
    """Get single customer credit by ID"""
    try:
        credit = service.get_by_id(credit_id)
        if not credit:
            raise HTTPException(status_code=404, detail="Customer credit not found")
        return CustomerCreditResponse(data=credit)
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving customer credit: {str(e)}")


@router.post("/", response_model=CustomerCreditResponse)
async def create_customer_credit(
    credit: CustomerCreditCreate,
    service: CreditService = Depends(get_credit_service)
):
    """Create new customer credit"""
    try:
        new_credit = service.create_customer_credit(credit)
        return CustomerCreditResponse(
            data=new_credit,
            message="Customer credit created successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error creating customer credit: {str(e)}")


@router.put("/{credit_id}", response_model=CustomerCreditResponse)
async def update_customer_credit(
    credit_id: UUID,
    credit: CustomerCreditUpdate,
    service: CreditService = Depends(get_credit_service)
):
    """Update customer credit"""
    try:
        update_data = credit.dict(exclude_none=True)
        updated_credit = service.update(credit_id, update_data)
        
        if not updated_credit:
            raise HTTPException(status_code=404, detail="Customer credit not found")
            
        return CustomerCreditResponse(
            data=updated_credit,
            message="Customer credit updated successfully"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Update failed: {str(e)}")


@router.post("/{credit_id}/use", response_model=CustomerCreditResponse)
async def use_customer_credit(
    credit_id: UUID,
    amount_to_use: Decimal = Query(..., description="Amount to use from credit"),
    work_order_id: Optional[UUID] = Query(None, description="Work order ID"),
    service: CreditService = Depends(get_credit_service)
):
    """Use customer credit for payment"""
    try:
        updated_credit = service.use_customer_credit(credit_id, amount_to_use, work_order_id)
        
        if not updated_credit:
            raise HTTPException(status_code=404, detail="Customer credit not found or insufficient balance")
            
        return CustomerCreditResponse(
            data=updated_credit,
            message=f"${amount_to_use} used from customer credit"
        )
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error using customer credit: {str(e)}")


# Discount Rule endpoints
@router.get("/discount-rules/", response_model=DiscountRulesResponse)
async def get_discount_rules(
    search: Optional[str] = Query(None, description="Search term"),
    discount_type: Optional[DiscountType] = Query(None, description="Filter by discount type"),
    company_id: Optional[UUID] = Query(None, description="Filter by company ID"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    is_public: Optional[bool] = Query(None, description="Filter by public visibility"),
    service: CreditService = Depends(get_credit_service)
):
    """Get all discount rules with optional filters"""
    try:
        filters = DiscountRuleFilter(
            search=search,
            discount_type=discount_type,
            company_id=company_id,
            is_active=is_active,
            is_public=is_public
        )
        
        result = service.get_discount_rules_with_filters(filters)
        rules = result.get('rules', [])
        
        return DiscountRulesResponse(data=rules, total=len(rules))
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving discount rules: {str(e)}")


@router.post("/discount-rules/", response_model=DiscountRuleResponse)
async def create_discount_rule(
    rule: DiscountRuleCreate,
    service: CreditService = Depends(get_credit_service)
):
    """Create new discount rule"""
    try:
        new_rule = service.create_discount_rule(rule)
        return DiscountRuleResponse(
            data=new_rule,
            message="Discount rule created successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error creating discount rule: {str(e)}")


@router.post("/apply-discount/", response_model=AppliedDiscountResponse)
async def apply_discount(
    work_order_id: UUID = Query(..., description="Work order ID"),
    staff_id: UUID = Query(..., description="Staff applying discount"),
    discount_rule_id: Optional[UUID] = Query(None, description="Discount rule ID"),
    customer_credit_id: Optional[UUID] = Query(None, description="Customer credit ID"),
    discount_code: Optional[str] = Query(None, description="Discount code"),
    service: CreditService = Depends(get_credit_service)
):
    """Apply discount to work order"""
    try:
        applied_discount = service.apply_discount(
            work_order_id=work_order_id,
            discount_rule_id=discount_rule_id,
            customer_credit_id=customer_credit_id,
            discount_code=discount_code,
            staff_id=staff_id
        )
        
        return AppliedDiscountResponse(
            data=applied_discount,
            message="Discount applied successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error applying discount: {str(e)}")


@router.post("/validate-code/")
async def validate_discount_code(
    discount_code: str = Query(..., description="Discount code to validate"),
    work_order_amount: Decimal = Query(..., description="Work order total amount"),
    service: CreditService = Depends(get_credit_service)
):
    """Validate discount code and calculate discount"""
    try:
        result = service.validate_discount_code(discount_code, work_order_amount)
        return result
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error validating discount code: {str(e)}")


# Utility endpoints
@router.get("/credit-types/list")
async def get_credit_types():
    """Get list of available credit types"""
    return {
        "credit_types": [
            {"value": credit_type.value, "label": credit_type.value.replace("_", " ").title()}
            for credit_type in CreditType
        ]
    }


@router.get("/discount-types/list")
async def get_discount_types():
    """Get list of available discount types"""
    return {
        "discount_types": [
            {"value": discount_type.value, "label": discount_type.value.replace("_", " ").title()}
            for discount_type in DiscountType
        ]
    }


@router.get("/credit-statuses/list")
async def get_credit_statuses():
    """Get list of available credit statuses"""
    return {
        "statuses": [
            {"value": status.value, "label": status.value.replace("_", " ").title()}
            for status in CreditStatus
        ]
    }


@router.get("/dashboard/stats")
async def get_credit_dashboard_stats(
    company_id: Optional[UUID] = Query(None, description="Filter by company ID"),
    service: CreditService = Depends(get_credit_service)
):
    """Get credit and discount dashboard statistics"""
    try:
        stats = service.get_credit_dashboard_stats(company_id)
        return stats
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving credit stats: {str(e)}")


@router.post("/generate-credit-number")
async def generate_credit_number(
    service: CreditService = Depends(get_credit_service)
):
    """Generate a new credit number"""
    try:
        credit_number = service.generate_credit_number()
        return {"credit_number": credit_number}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating credit number: {str(e)}")