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


# Common street suffix variations to remove for matching
STREET_SUFFIXES = [
    'street', 'st', 'st.',
    'avenue', 'ave', 'ave.',
    'road', 'rd', 'rd.',
    'drive', 'dr', 'dr.',
    'lane', 'ln', 'ln.',
    'court', 'ct', 'ct.',
    'place', 'pl', 'pl.',
    'boulevard', 'blvd', 'blvd.',
    'circle', 'cir', 'cir.',
    'way', 'terrace', 'ter', 'ter.',
    'trail', 'trl', 'trl.',
    'highway', 'hwy', 'hwy.',
    'parkway', 'pkwy', 'pkwy.',
]

# State name to abbreviation mapping
STATE_ABBREVIATIONS = {
    'alabama': 'al', 'alaska': 'ak', 'arizona': 'az', 'arkansas': 'ar',
    'california': 'ca', 'colorado': 'co', 'connecticut': 'ct', 'delaware': 'de',
    'florida': 'fl', 'georgia': 'ga', 'hawaii': 'hi', 'idaho': 'id',
    'illinois': 'il', 'indiana': 'in', 'iowa': 'ia', 'kansas': 'ks',
    'kentucky': 'ky', 'louisiana': 'la', 'maine': 'me', 'maryland': 'md',
    'massachusetts': 'ma', 'michigan': 'mi', 'minnesota': 'mn', 'mississippi': 'ms',
    'missouri': 'mo', 'montana': 'mt', 'nebraska': 'ne', 'nevada': 'nv',
    'new hampshire': 'nh', 'new jersey': 'nj', 'new mexico': 'nm', 'new york': 'ny',
    'north carolina': 'nc', 'north dakota': 'nd', 'ohio': 'oh', 'oklahoma': 'ok',
    'oregon': 'or', 'pennsylvania': 'pa', 'rhode island': 'ri', 'south carolina': 'sc',
    'south dakota': 'sd', 'tennessee': 'tn', 'texas': 'tx', 'utah': 'ut',
    'vermont': 'vt', 'virginia': 'va', 'washington': 'wa', 'west virginia': 'wv',
    'wisconsin': 'wi', 'wyoming': 'wy', 'district of columbia': 'dc'
}


def normalize_address_for_matching(address: str) -> str:
    """
    Aggressively normalize address for fuzzy matching.

    Handles variations like:
    - "12312 La Plata, Silver Spring MD 20904"
    - "12312 La Plata Street, Silver Spring, MD 20904"

    Args:
        address: Raw address string

    Returns:
        Normalized address string for comparison
    """
    if not address:
        return ""

    # Convert to lowercase
    normalized = address.lower().strip()

    # Remove all punctuation and special characters
    normalized = re.sub(r'[^\w\s]', ' ', normalized)

    # Replace multiple spaces with single space
    normalized = re.sub(r'\s+', ' ', normalized)

    # Split into words for processing
    words = normalized.split()

    # Remove common street suffixes
    filtered_words = []
    for word in words:
        if word not in STREET_SUFFIXES:
            filtered_words.append(word)

    # Normalize state names to abbreviations
    result_words = []
    skip_next = False
    for i, word in enumerate(filtered_words):
        if skip_next:
            skip_next = False
            continue

        # Check for two-word state names (e.g., "new york")
        if i < len(filtered_words) - 1:
            two_word = f"{word} {filtered_words[i+1]}"
            if two_word in STATE_ABBREVIATIONS:
                result_words.append(STATE_ABBREVIATIONS[two_word])
                skip_next = True
                continue

        # Check for single-word state names
        if word in STATE_ABBREVIATIONS:
            result_words.append(STATE_ABBREVIATIONS[word])
        else:
            result_words.append(word)

    return ' '.join(result_words)


def extract_street_number(address: str) -> Optional[str]:
    """Extract the street number from an address."""
    if not address:
        return None
    match = re.match(r'^(\d+)', address.strip())
    return match.group(1) if match else None


def addresses_match(address1: str, address2: str) -> bool:
    """
    Compare two addresses with fuzzy matching
    - Case insensitive
    - Whitespace insensitive
    - Special character tolerant
    - Street suffix tolerant (Street, St, Ave, etc.)
    - State name/abbreviation tolerant (Maryland vs MD)

    Examples that should match:
    - "12312 La Plata, Silver Spring MD 20904"
    - "12312 La Plata Street, Silver Spring, MD 20904"

    Args:
        address1: First address
        address2: Second address

    Returns:
        True if addresses match
    """
    if not address1 or not address2:
        return False

    # Quick check: street numbers must match
    num1 = extract_street_number(address1)
    num2 = extract_street_number(address2)
    if num1 and num2 and num1 != num2:
        return False

    # Normalize both addresses
    normalized1 = normalize_address_for_matching(address1)
    normalized2 = normalize_address_for_matching(address2)

    # Exact match after normalization
    if normalized1 == normalized2:
        return True

    # Check if one is a subset of the other (handles missing components)
    words1 = set(normalized1.split())
    words2 = set(normalized2.split())

    # Calculate similarity - at least 80% of shorter address should be in longer
    smaller = words1 if len(words1) < len(words2) else words2
    larger = words2 if len(words1) < len(words2) else words1

    if not smaller:
        return False

    common_words = smaller.intersection(larger)
    similarity = len(common_words) / len(smaller)

    # Street number must be in common words
    if num1 and num1 not in common_words:
        return False

    return similarity >= 0.8


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
