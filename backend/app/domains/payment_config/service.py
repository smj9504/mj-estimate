"""
Payment configuration service
"""

from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from datetime import datetime
import logging

from .repository import PaymentMethodRepository, PaymentFrequencyRepository
from .schemas import (
    PaymentMethodCreate, PaymentMethodUpdate,
    PaymentFrequencyCreate, PaymentFrequencyUpdate
)

logger = logging.getLogger(__name__)


class PaymentConfigService:
    """Service for managing payment configuration"""
    
    # Payment Method operations
    def get_payment_methods(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 100,
        active_only: bool = True
    ) -> List[dict]:
        """Get all payment methods"""
        repo = PaymentMethodRepository(db)
        return repo.get_all(active_only=active_only, limit=limit, offset=skip, order_by='name')
    
    def get_payment_method(self, db: Session, method_id: str) -> Optional[dict]:
        """Get payment method by ID"""
        repo = PaymentMethodRepository(db)
        return repo.get_by_id(method_id)
    
    def get_payment_method_by_code(self, db: Session, code: str) -> Optional[dict]:
        """Get payment method by code"""
        repo = PaymentMethodRepository(db)
        return repo.get_by_code(code)
    
    def get_by_code(self, db: Session, code: str) -> Optional[dict]:
        """Alias for get_payment_method_by_code for backward compatibility"""
        return self.get_payment_method_by_code(db, code)
    
    def create_payment_method(self, db: Session, method: PaymentMethodCreate) -> dict:
        """Create new payment method"""
        repo = PaymentMethodRepository(db)
        
        # Check if code already exists
        existing = repo.get_by_code(method.code)
        if existing:
            raise ValueError(f"Payment method with code '{method.code}' already exists")
        
        # If setting as default, unset other defaults
        if method.is_default:
            all_methods = repo.get_all(active_only=False)
            for existing_method in all_methods:
                if existing_method.get('is_default'):
                    repo.update(existing_method['id'], {'is_default': False})
        
        result = repo.create(method.dict())
        logger.info(f"Created payment method: {method.code}")
        
        # Commit if using SQLAlchemy
        if hasattr(db, 'commit'):
            db.commit()
        
        return result
    
    def update_payment_method(
        self,
        db: Session,
        method_id: str,
        method: PaymentMethodUpdate
    ) -> Optional[dict]:
        """Update payment method"""
        repo = PaymentMethodRepository(db)
        
        existing_method = repo.get_by_id(method_id)
        if not existing_method:
            return None
        
        update_data = method.dict(exclude_none=True)
        logger.info(f"Update data for method {method_id}: {update_data}")
        
        # If setting as default, unset other defaults
        if update_data.get('is_default'):
            all_methods = repo.get_all(active_only=False)
            for existing in all_methods:
                if existing['id'] != method_id and existing.get('is_default'):
                    repo.update(existing['id'], {'is_default': False})
        
        result = repo.update(method_id, update_data)
        logger.info(f"Updated payment method: {existing_method.get('code')}")
        
        # Commit if using SQLAlchemy
        if hasattr(db, 'commit'):
            db.commit()
        
        return result
    
    def delete_payment_method(self, db: Session, method_id: str) -> bool:
        """Delete payment method"""
        repo = PaymentMethodRepository(db)
        
        existing_method = repo.get_by_id(method_id)
        if not existing_method:
            return False
        
        success = repo.delete(method_id)
        
        if success:
            logger.info(f"Deleted payment method: {existing_method.get('code')}")
            # Commit if using SQLAlchemy
            if hasattr(db, 'commit'):
                db.commit()
        
        return success
    
    # Payment Frequency operations
    def get_payment_frequencies(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 100,
        active_only: bool = True
    ) -> List[dict]:
        """Get all payment frequencies"""
        repo = PaymentFrequencyRepository(db)
        return repo.get_all(active_only=active_only, limit=limit, offset=skip, order_by='name')
    
    def get_payment_frequency(self, db: Session, frequency_id: str) -> Optional[dict]:
        """Get payment frequency by ID"""
        repo = PaymentFrequencyRepository(db)
        return repo.get_by_id(frequency_id)
    
    def get_payment_frequency_by_code(self, db: Session, code: str) -> Optional[dict]:
        """Get payment frequency by code"""
        repo = PaymentFrequencyRepository(db)
        return repo.get_by_code(code)
    
    def get_frequency_by_code(self, db: Session, code: str) -> Optional[dict]:
        """Alias for get_payment_frequency_by_code for backward compatibility"""
        return self.get_payment_frequency_by_code(db, code)
    
    def create_payment_frequency(self, db: Session, frequency: PaymentFrequencyCreate) -> dict:
        """Create new payment frequency"""
        repo = PaymentFrequencyRepository(db)
        
        # Check if code already exists
        existing = repo.get_by_code(frequency.code)
        if existing:
            raise ValueError(f"Payment frequency with code '{frequency.code}' already exists")
        
        # If setting as default, unset other defaults
        if frequency.is_default:
            all_frequencies = repo.get_all(active_only=False)
            for existing_freq in all_frequencies:
                if existing_freq.get('is_default'):
                    repo.update(existing_freq['id'], {'is_default': False})
        
        result = repo.create(frequency.dict())
        logger.info(f"Created payment frequency: {frequency.code}")
        
        # Commit if using SQLAlchemy
        if hasattr(db, 'commit'):
            db.commit()
        
        return result
    
    def update_payment_frequency(
        self,
        db: Session,
        frequency_id: str,
        frequency: PaymentFrequencyUpdate
    ) -> Optional[dict]:
        """Update payment frequency"""
        repo = PaymentFrequencyRepository(db)
        
        existing_frequency = repo.get_by_id(frequency_id)
        if not existing_frequency:
            return None
        
        update_data = frequency.dict(exclude_unset=True)
        logger.info(f"Update data for frequency {frequency_id}: {update_data}")
        
        # If setting as default, unset other defaults
        if update_data.get('is_default'):
            all_frequencies = repo.get_all(active_only=False)
            for existing in all_frequencies:
                if existing['id'] != frequency_id and existing.get('is_default'):
                    repo.update(existing['id'], {'is_default': False})
        
        result = repo.update(frequency_id, update_data)
        logger.info(f"Updated payment frequency: {existing_frequency.get('code')}")
        
        # Commit if using SQLAlchemy
        if hasattr(db, 'commit'):
            db.commit()
        
        return result
    
    def delete_payment_frequency(self, db: Session, frequency_id: str) -> bool:
        """Delete payment frequency"""
        repo = PaymentFrequencyRepository(db)
        
        existing_frequency = repo.get_by_id(frequency_id)
        if not existing_frequency:
            return False
        
        success = repo.delete(frequency_id)
        
        if success:
            logger.info(f"Deleted payment frequency: {existing_frequency.get('code')}")
            # Commit if using SQLAlchemy
            if hasattr(db, 'commit'):
                db.commit()
        
        return success