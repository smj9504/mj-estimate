"""
Document Types and Trades service layer
"""

from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from typing import List, Optional
from uuid import UUID
from datetime import datetime

from . import models, schemas


# Document Types services
def get_document_types(
    db: Session,
    skip: int = 0,
    limit: int = 100,
    active_only: bool = True,
    category: Optional[str] = None
) -> List[models.DocumentType]:
    query = db.query(models.DocumentType)
    
    if active_only:
        query = query.filter(models.DocumentType.is_active == True)
    
    if category:
        query = query.filter(models.DocumentType.category == category)
    
    return query.order_by(models.DocumentType.name).offset(skip).limit(limit).all()


def get_document_type(db: Session, document_type_id: UUID) -> Optional[models.DocumentType]:
    return db.query(models.DocumentType).filter(models.DocumentType.id == document_type_id).first()


def create_document_type(db: Session, document_type: schemas.DocumentTypeCreate, user_id: UUID) -> models.DocumentType:
    db_document_type = models.DocumentType(
        **document_type.dict(),
        created_by=user_id,
        updated_by=user_id
    )
    db.add(db_document_type)
    db.commit()
    db.refresh(db_document_type)
    return db_document_type


def update_document_type(
    db: Session,
    document_type_id: UUID,
    document_type: schemas.DocumentTypeUpdate,
    user_id: UUID
) -> Optional[models.DocumentType]:
    db_document_type = get_document_type(db, document_type_id)
    if not db_document_type:
        return None
    
    update_data = document_type.dict(exclude_unset=True)
    update_data['updated_by'] = user_id
    update_data['updated_at'] = datetime.utcnow()
    
    for field, value in update_data.items():
        setattr(db_document_type, field, value)
    
    db.commit()
    db.refresh(db_document_type)
    return db_document_type


def delete_document_type(db: Session, document_type_id: UUID) -> bool:
    db_document_type = get_document_type(db, document_type_id)
    if not db_document_type:
        return False
    
    db.delete(db_document_type)
    db.commit()
    return True


def calculate_document_price(db: Session, document_type_id: UUID, params: schemas.PriceCalculationParams) -> Optional[float]:
    db_document_type = get_document_type(db, document_type_id)
    if not db_document_type:
        return None
    
    return db_document_type.calculate_price(**params.dict())


# Trades services
def get_trades(
    db: Session,
    skip: int = 0,
    limit: int = 100,
    active_only: bool = True,
    category: Optional[str] = None
) -> List[models.Trade]:
    query = db.query(models.Trade)
    
    if active_only:
        query = query.filter(models.Trade.is_active == True)
    
    if category:
        query = query.filter(models.Trade.category == category)
    
    return query.order_by(models.Trade.name).offset(skip).limit(limit).all()


def get_trade(db: Session, trade_id: UUID) -> Optional[models.Trade]:
    return db.query(models.Trade).filter(models.Trade.id == trade_id).first()


def create_trade(db: Session, trade: schemas.TradeCreate, user_id: UUID) -> models.Trade:
    db_trade = models.Trade(
        **trade.dict(),
        created_by=user_id,
        updated_by=user_id
    )
    db.add(db_trade)
    db.commit()
    db.refresh(db_trade)
    return db_trade


def update_trade(
    db: Session,
    trade_id: UUID,
    trade: schemas.TradeUpdate,
    user_id: UUID
) -> Optional[models.Trade]:
    db_trade = get_trade(db, trade_id)
    if not db_trade:
        return None
    
    update_data = trade.dict(exclude_unset=True)
    update_data['updated_by'] = user_id
    update_data['updated_at'] = datetime.utcnow()
    
    for field, value in update_data.items():
        setattr(db_trade, field, value)
    
    db.commit()
    db.refresh(db_trade)
    return db_trade


def delete_trade(db: Session, trade_id: UUID) -> bool:
    db_trade = get_trade(db, trade_id)
    if not db_trade:
        return False
    
    db.delete(db_trade)
    db.commit()
    return True


# Measurement Report Types services
def get_measurement_report_types(
    db: Session,
    skip: int = 0,
    limit: int = 100,
    active_only: bool = True,
    provider: Optional[str] = None
) -> List[models.MeasurementReportType]:
    query = db.query(models.MeasurementReportType)
    
    if active_only:
        query = query.filter(models.MeasurementReportType.is_active == True)
    
    if provider:
        query = query.filter(models.MeasurementReportType.provider == provider)
    
    return query.order_by(models.MeasurementReportType.name).offset(skip).limit(limit).all()


def get_measurement_report_type(db: Session, report_type_id: UUID) -> Optional[models.MeasurementReportType]:
    return db.query(models.MeasurementReportType).filter(models.MeasurementReportType.id == report_type_id).first()


def create_measurement_report_type(db: Session, report_type: schemas.MeasurementReportTypeCreate) -> models.MeasurementReportType:
    db_report_type = models.MeasurementReportType(**report_type.dict())
    db.add(db_report_type)
    db.commit()
    db.refresh(db_report_type)
    return db_report_type


def update_measurement_report_type(
    db: Session,
    report_type_id: UUID,
    report_type: schemas.MeasurementReportTypeUpdate
) -> Optional[models.MeasurementReportType]:
    db_report_type = get_measurement_report_type(db, report_type_id)
    if not db_report_type:
        return None
    
    update_data = report_type.dict(exclude_unset=True)
    update_data['updated_at'] = datetime.utcnow()
    
    for field, value in update_data.items():
        setattr(db_report_type, field, value)
    
    db.commit()
    db.refresh(db_report_type)
    return db_report_type


def delete_measurement_report_type(db: Session, report_type_id: UUID) -> bool:
    db_report_type = get_measurement_report_type(db, report_type_id)
    if not db_report_type:
        return False
    
    db.delete(db_report_type)
    db.commit()
    return True


def calculate_report_price(db: Session, report_type_id: UUID, rush: bool = False) -> Optional[float]:
    db_report_type = get_measurement_report_type(db, report_type_id)
    if not db_report_type:
        return None
    
    return db_report_type.calculate_price(rush=rush)