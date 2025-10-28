"""
Utility functions for Google Sheets integration
"""

import re
from typing import Optional
from datetime import datetime


def normalize_address(address: str) -> str:
    """
    Normalize address for fuzzy comparison
    - Remove extra whitespace
    - Convert to lowercase
    - Remove special characters except commas and hyphens

    Args:
        address: Raw address string

    Returns:
        Normalized address string
    """
    if not address:
        return ""

    # Convert to lowercase
    normalized = address.lower().strip()

    # Replace multiple spaces with single space
    normalized = re.sub(r'\s+', ' ', normalized)

    # Remove special characters except commas, hyphens, and periods
    normalized = re.sub(r'[^\w\s,.-]', '', normalized)

    # Remove extra spaces around commas
    normalized = re.sub(r'\s*,\s*', ',', normalized)

    return normalized


def addresses_match(address1: str, address2: str) -> bool:
    """
    Compare two addresses with fuzzy matching
    - Case insensitive
    - Whitespace insensitive
    - Special character tolerant

    Args:
        address1: First address
        address2: Second address

    Returns:
        True if addresses match
    """
    if not address1 or not address2:
        return False

    normalized1 = normalize_address(address1)
    normalized2 = normalize_address(address2)

    return normalized1 == normalized2


def parse_date_value(value: any) -> Optional[datetime]:
    """
    Parse date from various formats
    Supports:
    - ISO format (YYYY-MM-DD)
    - US format (MM/DD/YYYY)
    - Google Sheets serial number

    Args:
        value: Date value (string, int, or datetime)

    Returns:
        datetime object or None
    """
    if not value:
        return None

    if isinstance(value, datetime):
        return value

    # Try parsing as string
    if isinstance(value, str):
        # Remove whitespace
        value = value.strip()
        if not value:
            return None

        # Try ISO format (YYYY-MM-DD)
        try:
            return datetime.strptime(value, "%Y-%m-%d")
        except ValueError:
            pass

        # Try US format (MM/DD/YYYY)
        try:
            return datetime.strptime(value, "%m/%d/%Y")
        except ValueError:
            pass

        # Try US format with 2-digit year (M/D/YY)
        try:
            return datetime.strptime(value, "%m/%d/%y")
        except ValueError:
            pass

        # Try with time (YYYY-MM-DD HH:MM:SS)
        try:
            return datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            pass

    # Try parsing as Google Sheets serial number (days since 1899-12-30)
    if isinstance(value, (int, float)):
        try:
            # Google Sheets epoch: December 30, 1899
            excel_epoch = datetime(1899, 12, 30)
            return excel_epoch + timedelta(days=int(value))
        except:
            pass

    return None


def parse_boolean_value(value: any) -> bool:
    """
    Parse boolean from various formats

    Args:
        value: Boolean value (string, bool, int)

    Returns:
        Boolean value
    """
    if isinstance(value, bool):
        return value

    if isinstance(value, str):
        value = value.strip().lower()
        return value in ('true', 'yes', '1', 'y', 't', 'x', '✓', '✔')

    if isinstance(value, (int, float)):
        return bool(value)

    return False


def parse_numeric_value(value: any) -> Optional[float]:
    """
    Parse numeric value from string or number

    Args:
        value: Numeric value (string or number)

    Returns:
        Float value or None
    """
    if not value:
        return None

    if isinstance(value, (int, float)):
        return float(value)

    if isinstance(value, str):
        # Remove currency symbols and commas
        value = value.strip().replace('$', '').replace(',', '')

        try:
            return float(value)
        except ValueError:
            return None

    return None


from datetime import timedelta
