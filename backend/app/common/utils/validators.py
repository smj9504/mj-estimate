"""
Common validation utilities
"""

import re
from typing import Optional
from decimal import Decimal


def validate_email(email: str) -> bool:
    """Validate email format"""
    pattern = r'^[\w\.-]+@[\w\.-]+\.\w+$'
    return bool(re.match(pattern, email))


def validate_phone(phone: str) -> bool:
    """Validate phone number format"""
    # Remove common formatting characters
    cleaned = re.sub(r'[\s\-\(\)]', '', phone)
    # Check if it's a valid phone number (10-15 digits)
    return bool(re.match(r'^\+?\d{10,15}$', cleaned))


def validate_zipcode(zipcode: str, country: str = "USA") -> bool:
    """Validate zipcode format based on country"""
    if country == "USA":
        # US ZIP or ZIP+4
        return bool(re.match(r'^\d{5}(-\d{4})?$', zipcode))
    # Add more country-specific validations as needed
    return len(zipcode) > 0


def validate_money(amount: Decimal) -> bool:
    """Validate monetary amount"""
    return amount >= 0 and amount.as_tuple().exponent >= -2


def sanitize_string(value: Optional[str]) -> Optional[str]:
    """Sanitize string input"""
    if value is None:
        return None
    return value.strip()


def validate_percentage(value: Decimal) -> bool:
    """Validate percentage value (0-100)"""
    return 0 <= value <= 100