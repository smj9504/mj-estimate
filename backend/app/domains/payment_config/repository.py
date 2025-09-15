"""
Payment configuration repository
"""

from typing import Optional, List
from app.common.base_repository import SQLAlchemyRepository, SupabaseRepository
from app.core.config import settings
from .models import PaymentMethod, PaymentFrequency


class PaymentMethodRepository:
    """Repository for payment method operations"""
    
    def __init__(self, session):
        if settings.USE_SQLITE:
            self.repo = SQLAlchemyRepository(session, PaymentMethod)
        else:
            self.repo = SupabaseRepository(session, "payment_methods", PaymentMethod)
    
    def get_by_code(self, code: str) -> Optional[dict]:
        """Get payment method by code"""
        results = self.repo.get_all(filters={'code': code}, limit=1)
        return results[0] if results else None
    
    def get_all(self, active_only: bool = True, **kwargs):
        """Get all payment methods"""
        filters = kwargs.get('filters', {})
        if active_only:
            filters['is_active'] = True
        kwargs['filters'] = filters
        return self.repo.get_all(**kwargs)
    
    def create(self, data: dict):
        """Create payment method"""
        return self.repo.create(data)
    
    def update(self, method_id: str, data: dict):
        """Update payment method"""
        return self.repo.update(method_id, data)
    
    def delete(self, method_id: str):
        """Delete payment method"""
        return self.repo.delete(method_id)
    
    def get_by_id(self, method_id: str):
        """Get payment method by ID"""
        return self.repo.get_by_id(method_id)


class PaymentFrequencyRepository:
    """Repository for payment frequency operations"""
    
    def __init__(self, session):
        if settings.USE_SQLITE:
            self.repo = SQLAlchemyRepository(session, PaymentFrequency)
        else:
            self.repo = SupabaseRepository(session, "payment_frequencies", PaymentFrequency)
    
    def get_by_code(self, code: str) -> Optional[dict]:
        """Get payment frequency by code"""
        results = self.repo.get_all(filters={'code': code}, limit=1)
        return results[0] if results else None
    
    def get_all(self, active_only: bool = True, **kwargs):
        """Get all payment frequencies"""
        filters = kwargs.get('filters', {})
        if active_only:
            filters['is_active'] = True
        kwargs['filters'] = filters
        return self.repo.get_all(**kwargs)
    
    def create(self, data: dict):
        """Create payment frequency"""
        return self.repo.create(data)
    
    def update(self, frequency_id: str, data: dict):
        """Update payment frequency"""
        return self.repo.update(frequency_id, data)
    
    def delete(self, frequency_id: str):
        """Delete payment frequency"""
        return self.repo.delete(frequency_id)
    
    def get_by_id(self, frequency_id: str):
        """Get payment frequency by ID"""
        return self.repo.get_by_id(frequency_id)