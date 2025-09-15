"""
Document Types and Trades API endpoints
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID, uuid4

from app.core.database_factory import get_db_session as get_db
from . import models, schemas, service

router = APIRouter()


# Document Types endpoints
@router.get("/document-types/", response_model=List[schemas.DocumentTypeResponse])
async def get_document_types(
    skip: int = 0,
    limit: int = 100,
    active_only: bool = True,
    category: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Get all document types"""
    return service.get_document_types(db, skip=skip, limit=limit, active_only=active_only, category=category)


@router.get("/document-types/{document_type_id}", response_model=schemas.DocumentTypeResponse)
async def get_document_type(
    document_type_id: UUID,
    db: Session = Depends(get_db)
):
    """Get a specific document type"""
    document_type = service.get_document_type(db, document_type_id)
    if not document_type:
        raise HTTPException(status_code=404, detail="Document type not found")
    return document_type


@router.post("/document-types/", response_model=schemas.DocumentTypeResponse)
async def create_document_type(
    document_type: schemas.DocumentTypeCreate,
    db: Session = Depends(get_db)
):
    """Create a new document type"""
    try:
        # Using a default user ID for now - in production, get from auth
        user_id = uuid4()
        return service.create_document_type(db, document_type, user_id)
    except Exception as e:
        # Check for unique constraint violation
        if "UNIQUE constraint failed: document_types.code" in str(e):
            raise HTTPException(
                status_code=400, 
                detail=f"Document type with code '{document_type.code}' already exists"
            )
        else:
            raise HTTPException(status_code=500, detail=str(e))


@router.put("/document-types/{document_type_id}", response_model=schemas.DocumentTypeResponse)
async def update_document_type(
    document_type_id: UUID,
    document_type: schemas.DocumentTypeUpdate,
    db: Session = Depends(get_db)
):
    """Update a document type"""
    try:
        user_id = uuid4()
        updated = service.update_document_type(db, document_type_id, document_type, user_id)
        if not updated:
            raise HTTPException(status_code=404, detail="Document type not found")
        return updated
    except Exception as e:
        # Check for unique constraint violation
        if "UNIQUE constraint failed: document_types.code" in str(e):
            raise HTTPException(
                status_code=400, 
                detail=f"Document type with code '{document_type.code}' already exists"
            )
        else:
            raise HTTPException(status_code=500, detail=str(e))


@router.delete("/document-types/{document_type_id}")
async def delete_document_type(
    document_type_id: UUID,
    db: Session = Depends(get_db)
):
    """Delete a document type"""
    if not service.delete_document_type(db, document_type_id):
        raise HTTPException(status_code=404, detail="Document type not found")
    return {"message": "Document type deleted successfully"}


@router.post("/document-types/{document_type_id}/calculate-price")
async def calculate_document_price(
    document_type_id: UUID,
    params: schemas.PriceCalculationParams,
    db: Session = Depends(get_db)
):
    """Calculate price for a document type based on parameters"""
    price = service.calculate_document_price(db, document_type_id, params)
    if price is None:
        raise HTTPException(status_code=404, detail="Document type not found")
    return {"price": price, "parameters": params.dict()}


# Trades endpoints
@router.get("/trades/", response_model=List[schemas.TradeResponse])
async def get_trades(
    skip: int = 0,
    limit: int = 100,
    active_only: bool = True,
    category: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Get all trades"""
    return service.get_trades(db, skip=skip, limit=limit, active_only=active_only, category=category)


@router.get("/trades/{trade_id}", response_model=schemas.TradeResponse)
async def get_trade(
    trade_id: UUID,
    db: Session = Depends(get_db)
):
    """Get a specific trade"""
    trade = service.get_trade(db, trade_id)
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")
    return trade


@router.post("/trades/", response_model=schemas.TradeResponse)
async def create_trade(
    trade: schemas.TradeCreate,
    db: Session = Depends(get_db)
):
    """Create a new trade"""
    user_id = uuid4()
    return service.create_trade(db, trade, user_id)


@router.put("/trades/{trade_id}", response_model=schemas.TradeResponse)
async def update_trade(
    trade_id: UUID,
    trade: schemas.TradeUpdate,
    db: Session = Depends(get_db)
):
    """Update a trade"""
    user_id = uuid4()
    updated = service.update_trade(db, trade_id, trade, user_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Trade not found")
    return updated


@router.delete("/trades/{trade_id}")
async def delete_trade(
    trade_id: UUID,
    db: Session = Depends(get_db)
):
    """Delete a trade"""
    if not service.delete_trade(db, trade_id):
        raise HTTPException(status_code=404, detail="Trade not found")
    return {"message": "Trade deleted successfully"}


# Measurement Report Types endpoints
@router.get("/measurement-report-types/", response_model=List[schemas.MeasurementReportTypeResponse])
async def get_measurement_report_types(
    skip: int = 0,
    limit: int = 100,
    active_only: bool = True,
    provider: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Get all measurement report types"""
    return service.get_measurement_report_types(db, skip=skip, limit=limit, active_only=active_only, provider=provider)


@router.get("/measurement-report-types/{report_type_id}", response_model=schemas.MeasurementReportTypeResponse)
async def get_measurement_report_type(
    report_type_id: UUID,
    db: Session = Depends(get_db)
):
    """Get a specific measurement report type"""
    report_type = service.get_measurement_report_type(db, report_type_id)
    if not report_type:
        raise HTTPException(status_code=404, detail="Measurement report type not found")
    return report_type


@router.post("/measurement-report-types/", response_model=schemas.MeasurementReportTypeResponse)
async def create_measurement_report_type(
    report_type: schemas.MeasurementReportTypeCreate,
    db: Session = Depends(get_db)
):
    """Create a new measurement report type"""
    return service.create_measurement_report_type(db, report_type)


@router.put("/measurement-report-types/{report_type_id}", response_model=schemas.MeasurementReportTypeResponse)
async def update_measurement_report_type(
    report_type_id: UUID,
    report_type: schemas.MeasurementReportTypeUpdate,
    db: Session = Depends(get_db)
):
    """Update a measurement report type"""
    updated = service.update_measurement_report_type(db, report_type_id, report_type)
    if not updated:
        raise HTTPException(status_code=404, detail="Measurement report type not found")
    return updated


@router.delete("/measurement-report-types/{report_type_id}")
async def delete_measurement_report_type(
    report_type_id: UUID,
    db: Session = Depends(get_db)
):
    """Delete a measurement report type"""
    if not service.delete_measurement_report_type(db, report_type_id):
        raise HTTPException(status_code=404, detail="Measurement report type not found")
    return {"message": "Measurement report type deleted successfully"}


@router.post("/measurement-report-types/{report_type_id}/calculate-price")
async def calculate_report_price(
    report_type_id: UUID,
    rush: bool = False,
    db: Session = Depends(get_db)
):
    """Calculate price for a measurement report"""
    price = service.calculate_report_price(db, report_type_id, rush)
    if price is None:
        raise HTTPException(status_code=404, detail="Measurement report type not found")
    return {"price": price, "rush": rush}