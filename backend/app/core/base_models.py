"""
Base models and mixins for all domain models
"""

from sqlalchemy import Column, DateTime
from sqlalchemy.sql import func
from sqlalchemy.ext.declarative import declared_attr
from app.core.database_types import get_uuid_column, generate_uuid


class UUIDMixin:
    """Mixin to add UUID primary key to models"""
    id = Column(get_uuid_column(), primary_key=True, default=generate_uuid, index=True)


class TimestampMixin:
    """Mixin to add created_at and updated_at timestamps to models"""
    
    @declared_attr
    def created_at(cls):
        return Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    
    @declared_attr
    def updated_at(cls):
        return Column(DateTime(timezone=True), onupdate=func.now())


class BaseModel(UUIDMixin, TimestampMixin):
    """Base model class with UUID and timestamps"""
    pass