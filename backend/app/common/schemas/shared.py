"""
Shared schema types used across domains
"""

from typing import Optional
from decimal import Decimal
from pydantic import BaseModel, Field, field_validator
from .base import BaseSchema


class Address(BaseSchema):
    """Address schema used across different domains"""
    street: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zipcode: Optional[str] = None
    country: Optional[str] = "USA"
    
    def to_string(self) -> str:
        """Convert address to single string"""
        parts = []
        if self.street:
            parts.append(self.street)
        if self.city:
            parts.append(self.city)
        if self.state:
            parts.append(self.state)
        if self.zipcode:
            parts.append(self.zipcode)
        return ", ".join(parts)


class Money(BaseSchema):
    """Money/currency schema with decimal precision"""
    amount: Decimal = Field(decimal_places=2)
    currency: str = "USD"
    
    @field_validator('amount')
    @classmethod
    def validate_amount(cls, v):
        if v < 0:
            raise ValueError("Amount cannot be negative")
        return round(v, 2)


class ContactInfo(BaseSchema):
    """Contact information schema"""
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[Address] = None


class ClientInfo(ContactInfo):
    """Client/Customer information schema"""
    company_name: Optional[str] = None
    tax_id: Optional[str] = None