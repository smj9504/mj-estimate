"""
Payment configuration API endpoints
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional
from sqlalchemy.orm import Session

from app.core.database_factory import get_db_session as get_db
from app.domains.auth.dependencies import get_current_staff, require_admin
from .schemas import (
    PaymentMethodCreate, PaymentMethodUpdate, PaymentMethodResponse,
    PaymentFrequencyCreate, PaymentFrequencyUpdate, PaymentFrequencyResponse
)
from .service import PaymentConfigService

router = APIRouter()
service = PaymentConfigService()


# Payment Method endpoints
@router.get("/payment-methods", response_model=List[PaymentMethodResponse])
async def get_payment_methods(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    active_only: bool = Query(True),
    db: Session = Depends(get_db)
):
    """Get all payment methods"""
    return service.get_payment_methods(db, skip=skip, limit=limit, active_only=active_only)


@router.get("/payment-methods/{method_id}", response_model=PaymentMethodResponse)
async def get_payment_method(
    method_id: str,
    db: Session = Depends(get_db)
):
    """Get payment method by ID"""
    method = service.get_payment_method(db, method_id)
    if not method:
        raise HTTPException(status_code=404, detail="Payment method not found")
    return method


@router.post("/payment-methods", response_model=PaymentMethodResponse)
async def create_payment_method(
    method: PaymentMethodCreate,
    db: Session = Depends(get_db),
    current_staff: dict = Depends(require_admin)
):
    """Create new payment method (Admin only)"""
    try:
        return service.create_payment_method(db, method)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/payment-methods/{method_id}", response_model=PaymentMethodResponse)
async def update_payment_method(
    method_id: str,
    method: PaymentMethodUpdate,
    db: Session = Depends(get_db),
    current_staff: dict = Depends(require_admin)
):
    """Update payment method (Admin only)"""
    updated_method = service.update_payment_method(db, method_id, method)
    if not updated_method:
        raise HTTPException(status_code=404, detail="Payment method not found")
    return updated_method


@router.delete("/payment-methods/{method_id}")
async def delete_payment_method(
    method_id: str,
    db: Session = Depends(get_db),
    current_staff: dict = Depends(require_admin)
):
    """Delete payment method (Admin only)"""
    if not service.delete_payment_method(db, method_id):
        raise HTTPException(status_code=404, detail="Payment method not found")
    return {"message": "Payment method deleted successfully"}


# Payment Frequency endpoints
@router.get("/payment-frequencies", response_model=List[PaymentFrequencyResponse])
async def get_payment_frequencies(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    active_only: bool = Query(True),
    db: Session = Depends(get_db)
):
    """Get all payment frequencies"""
    return service.get_payment_frequencies(db, skip=skip, limit=limit, active_only=active_only)


@router.get("/payment-frequencies/{frequency_id}", response_model=PaymentFrequencyResponse)
async def get_payment_frequency(
    frequency_id: str,
    db: Session = Depends(get_db)
):
    """Get payment frequency by ID"""
    frequency = service.get_payment_frequency(db, frequency_id)
    if not frequency:
        raise HTTPException(status_code=404, detail="Payment frequency not found")
    return frequency


@router.post("/payment-frequencies", response_model=PaymentFrequencyResponse)
async def create_payment_frequency(
    frequency: PaymentFrequencyCreate,
    db: Session = Depends(get_db),
    current_staff: dict = Depends(require_admin)
):
    """Create new payment frequency (Admin only)"""
    try:
        return service.create_payment_frequency(db, frequency)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/payment-frequencies/{frequency_id}", response_model=PaymentFrequencyResponse)
async def update_payment_frequency(
    frequency_id: str,
    frequency: PaymentFrequencyUpdate,
    db: Session = Depends(get_db),
    current_staff: dict = Depends(require_admin)
):
    """Update payment frequency (Admin only)"""
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"Received update request for frequency {frequency_id}")
    logger.info(f"Raw frequency data: {frequency}")
    logger.info(f"Frequency dict: {frequency.dict()}")
    logger.info(f"Frequency dict (exclude_unset): {frequency.dict(exclude_unset=True)}")
    updated_frequency = service.update_payment_frequency(db, frequency_id, frequency)
    if not updated_frequency:
        raise HTTPException(status_code=404, detail="Payment frequency not found")
    return updated_frequency


@router.delete("/payment-frequencies/{frequency_id}")
async def delete_payment_frequency(
    frequency_id: str,
    db: Session = Depends(get_db),
    current_staff: dict = Depends(require_admin)
):
    """Delete payment frequency (Admin only)"""
    if not service.delete_payment_frequency(db, frequency_id):
        raise HTTPException(status_code=404, detail="Payment frequency not found")
    return {"message": "Payment frequency deleted successfully"}