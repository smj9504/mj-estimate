"""
Payment API endpoints
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from decimal import Decimal

from .schemas import (
    Payment, PaymentCreate, PaymentUpdate, PaymentResponse, PaymentsResponse,
    BillingSchedule, BillingScheduleCreate, BillingScheduleUpdate,
    BillingScheduleResponse, BillingSchedulesResponse,
    PaymentRefund, PaymentRefundCreate, PaymentRefundUpdate,
    PaymentRefundResponse, PaymentRefundsResponse,
    PaymentFilter, BillingScheduleFilter
)
from .service import PaymentService
from .models import PaymentStatus, PaymentMethod, BillingCycle
from app.core.database_factory import get_database

router = APIRouter()


def get_payment_service():
    """Dependency to get payment service"""
    return PaymentService(get_database())


# Payment endpoints
@router.get("/", response_model=PaymentsResponse)
async def get_payments(
    search: Optional[str] = Query(None, description="Search term"),
    status: Optional[PaymentStatus] = Query(None, description="Filter by status"),
    payment_method: Optional[PaymentMethod] = Query(None, description="Filter by payment method"),
    company_id: Optional[UUID] = Query(None, description="Filter by company ID"),
    work_order_id: Optional[UUID] = Query(None, description="Filter by work order ID"),
    amount_min: Optional[Decimal] = Query(None, description="Minimum amount"),
    amount_max: Optional[Decimal] = Query(None, description="Maximum amount"),
    date_from: Optional[datetime] = Query(None, description="Filter from date"),
    date_to: Optional[datetime] = Query(None, description="Filter to date"),
    service: PaymentService = Depends(get_payment_service)
):
    """Get all payments with optional filters"""
    try:
        filters = PaymentFilter(
            search=search,
            status=status,
            payment_method=payment_method,
            company_id=company_id,
            work_order_id=work_order_id,
            amount_min=amount_min,
            amount_max=amount_max,
            date_from=date_from,
            date_to=date_to
        )
        
        result = service.get_payments_with_filters(filters)
        payments = result.get('payments', [])
        
        return PaymentsResponse(data=payments, total=len(payments))
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving payments: {str(e)}")


@router.get("/{payment_id}", response_model=PaymentResponse)
async def get_payment(
    payment_id: UUID,
    service: PaymentService = Depends(get_payment_service)
):
    """Get single payment by ID"""
    try:
        payment = service.get_by_id(payment_id)
        if not payment:
            raise HTTPException(status_code=404, detail="Payment not found")
        return PaymentResponse(data=payment)
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving payment: {str(e)}")


@router.post("/", response_model=PaymentResponse)
async def create_payment(
    payment: PaymentCreate,
    service: PaymentService = Depends(get_payment_service)
):
    """Create new payment"""
    try:
        new_payment = service.create_payment(payment)
        return PaymentResponse(
            data=new_payment,
            message="Payment created successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error creating payment: {str(e)}")


@router.put("/{payment_id}", response_model=PaymentResponse)
async def update_payment(
    payment_id: UUID,
    payment: PaymentUpdate,
    service: PaymentService = Depends(get_payment_service)
):
    """Update payment"""
    try:
        update_data = payment.dict(exclude_none=True)
        updated_payment = service.update(payment_id, update_data)
        
        if not updated_payment:
            raise HTTPException(status_code=404, detail="Payment not found")
            
        return PaymentResponse(
            data=updated_payment,
            message="Payment updated successfully"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Update failed: {str(e)}")


@router.delete("/{payment_id}")
async def delete_payment(
    payment_id: UUID,
    service: PaymentService = Depends(get_payment_service)
):
    """Delete payment"""
    try:
        success = service.delete(payment_id)
        if not success:
            raise HTTPException(status_code=404, detail="Payment not found")
        return {"message": "Payment deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error deleting payment: {str(e)}")


# Billing Schedule endpoints
@router.get("/schedules/", response_model=BillingSchedulesResponse)
async def get_billing_schedules(
    search: Optional[str] = Query(None, description="Search term"),
    billing_cycle: Optional[BillingCycle] = Query(None, description="Filter by billing cycle"),
    company_id: Optional[UUID] = Query(None, description="Filter by company ID"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    service: PaymentService = Depends(get_payment_service)
):
    """Get all billing schedules with optional filters"""
    try:
        filters = BillingScheduleFilter(
            search=search,
            billing_cycle=billing_cycle,
            company_id=company_id,
            is_active=is_active
        )
        
        result = service.get_billing_schedules_with_filters(filters)
        schedules = result.get('schedules', [])
        
        return BillingSchedulesResponse(data=schedules, total=len(schedules))
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving billing schedules: {str(e)}")


@router.post("/schedules/", response_model=BillingScheduleResponse)
async def create_billing_schedule(
    schedule: BillingScheduleCreate,
    service: PaymentService = Depends(get_payment_service)
):
    """Create new billing schedule"""
    try:
        new_schedule = service.create_billing_schedule(schedule)
        return BillingScheduleResponse(
            data=new_schedule,
            message="Billing schedule created successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error creating billing schedule: {str(e)}")


# Payment Refund endpoints
@router.get("/{payment_id}/refunds/", response_model=PaymentRefundsResponse)
async def get_payment_refunds(
    payment_id: UUID,
    service: PaymentService = Depends(get_payment_service)
):
    """Get all refunds for a payment"""
    try:
        refunds = service.get_payment_refunds(payment_id)
        return PaymentRefundsResponse(data=refunds, total=len(refunds))
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving refunds: {str(e)}")


@router.post("/{payment_id}/refunds/", response_model=PaymentRefundResponse)
async def create_payment_refund(
    payment_id: UUID,
    refund: PaymentRefundCreate,
    service: PaymentService = Depends(get_payment_service)
):
    """Create payment refund"""
    try:
        # Ensure payment_id matches
        refund_data = refund.dict()
        refund_data['payment_id'] = payment_id
        
        new_refund = service.create_payment_refund(PaymentRefundCreate(**refund_data))
        return PaymentRefundResponse(
            data=new_refund,
            message="Payment refund created successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error creating refund: {str(e)}")


# Utility endpoints
@router.get("/methods/list")
async def get_payment_methods():
    """Get list of available payment methods"""
    return {
        "payment_methods": [
            {"value": method.value, "label": method.value.replace("_", " ").title()}
            for method in PaymentMethod
        ]
    }


@router.get("/statuses/list")
async def get_payment_statuses():
    """Get list of available payment statuses"""
    return {
        "statuses": [
            {"value": status.value, "label": status.value.replace("_", " ").title()}
            for status in PaymentStatus
        ]
    }


@router.get("/cycles/list")
async def get_billing_cycles():
    """Get list of available billing cycles"""
    return {
        "billing_cycles": [
            {"value": cycle.value, "label": cycle.value.replace("_", " ").title()}
            for cycle in BillingCycle
        ]
    }


@router.get("/dashboard/stats")
async def get_payment_dashboard_stats(
    company_id: Optional[UUID] = Query(None, description="Filter by company ID"),
    service: PaymentService = Depends(get_payment_service)
):
    """Get payment dashboard statistics"""
    try:
        stats = service.get_payment_dashboard_stats(company_id)
        return stats
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving payment stats: {str(e)}")


@router.post("/generate-number")
async def generate_payment_number(
    service: PaymentService = Depends(get_payment_service)
):
    """Generate a new payment number"""
    try:
        payment_number = service.generate_payment_number()
        return {"payment_number": payment_number}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating payment number: {str(e)}")