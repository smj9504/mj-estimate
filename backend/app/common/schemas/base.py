"""
Base schemas and common schema classes
"""

from typing import Optional, TypeVar, Generic
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict


class BaseSchema(BaseModel):
    """Base schema with common configuration"""
    model_config = ConfigDict(
        from_attributes=True,
        arbitrary_types_allowed=True,
        use_enum_values=True
    )


class TimestampSchema(BaseSchema):
    """Schema mixin for timestamp fields"""
    created_at: datetime
    updated_at: Optional[datetime] = None


class UUIDSchema(BaseSchema):
    """Schema mixin for UUID fields"""
    id: str = Field(description="Unique identifier")


class BaseResponseSchema(UUIDSchema, TimestampSchema):
    """Base schema for API responses with ID and timestamps"""
    pass


T = TypeVar('T')


class PaginatedResponse(BaseSchema, Generic[T]):
    """Generic paginated response schema"""
    items: list[T]
    total: int
    page: int = 1
    per_page: int = 10
    pages: int = 1