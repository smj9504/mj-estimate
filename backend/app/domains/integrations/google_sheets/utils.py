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
        except (ValueError, OverflowError, TypeError):
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
from typing import Tuple


def parse_mitigation_period(period_str: str, reference_year: Optional[int] = None) -> Tuple[Optional[datetime], Optional[datetime]]:
    """
    Parse mitigation period string into start and end dates

    Supports formats:
    - "12/25-12/27 (3)" -> December 25 to December 27
    - "12/25 - 12/27" -> December 25 to December 27
    - "12/25-12/27" -> December 25 to December 27
    - "12/25" -> Only start date

    Args:
        period_str: Mitigation period string
        reference_year: Year to use (defaults to current year)

    Returns:
        Tuple of (start_date, end_date) or (None, None) if parsing fails
    """
    if not period_str or not isinstance(period_str, str):
        return (None, None)

    # Use current year if not provided
    if reference_year is None:
        reference_year = datetime.now().year

    # Clean up the string - remove parenthetical content and extra whitespace
    period_str = re.sub(r'\([^)]*\)', '', period_str).strip()

    # Try to extract date range (MM/DD-MM/DD or MM/DD - MM/DD)
    # Pattern: month/day - month/day (with optional spaces around dash)
    pattern = r'(\d{1,2})/(\d{1,2})\s*-\s*(\d{1,2})/(\d{1,2})'
    match = re.search(pattern, period_str)

    if match:
        start_month, start_day, end_month, end_day = match.groups()
        try:
            start_date = datetime(reference_year, int(start_month), int(start_day))
            end_date = datetime(reference_year, int(end_month), int(end_day))
            return (start_date, end_date)
        except ValueError:
            pass

    # Try single date format (MM/DD)
    single_pattern = r'(\d{1,2})/(\d{1,2})'
    match = re.search(single_pattern, period_str)

    if match:
        month, day = match.groups()
        try:
            start_date = datetime(reference_year, int(month), int(day))
            return (start_date, None)
        except ValueError:
            pass

    return (None, None)
