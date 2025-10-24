"""
Utility functions for CompanyCam integration

Includes:
- Address parsing and normalization
- Address matching algorithms
- Photo metadata extraction
"""

import re
from typing import Optional, Tuple
from difflib import SequenceMatcher
import logging

from .schemas import AddressInfo, CompanyCamProject

logger = logging.getLogger(__name__)


def parse_companycam_address(project: CompanyCamProject) -> AddressInfo:
    """
    Parse address from CompanyCam project

    Args:
        project: CompanyCam project object

    Returns:
        Parsed address information
    """
    address_info = AddressInfo()

    if not project.address:
        return address_info

    # CompanyCam address structure: {street, city, state, zip}
    address_data = project.address

    address_info.street = address_data.get("street", "").strip()
    address_info.city = address_data.get("city", "").strip()
    address_info.state = address_data.get("state", "").strip()
    address_info.zipcode = address_data.get("zip", "").strip()

    return address_info


def normalize_address(address: str) -> str:
    """
    Normalize address for matching

    - Convert to lowercase
    - Remove extra whitespace
    - Remove punctuation except commas
    - Standardize abbreviations (St -> Street, Ave -> Avenue, etc.)

    Args:
        address: Raw address string

    Returns:
        Normalized address string
    """
    if not address:
        return ""

    # Convert to lowercase
    normalized = address.lower()

    # Remove extra whitespace
    normalized = " ".join(normalized.split())

    # Remove periods and other punctuation (keep commas)
    normalized = re.sub(r"[^\w\s,]", "", normalized)

    # Standardize common abbreviations
    abbreviations = {
        r"\bst\b": "street",
        r"\bave\b": "avenue",
        r"\brd\b": "road",
        r"\bdr\b": "drive",
        r"\bln\b": "lane",
        r"\bblvd\b": "boulevard",
        r"\bct\b": "court",
        r"\bpl\b": "place",
        r"\bapt\b": "apartment",
        r"\bste\b": "suite",
        r"\bn\b": "north",
        r"\bs\b": "south",
        r"\be\b": "east",
        r"\bw\b": "west",
    }

    for abbr, full in abbreviations.items():
        normalized = re.sub(abbr, full, normalized)

    return normalized.strip()


def calculate_address_similarity(address1: str, address2: str) -> float:
    """
    Calculate similarity score between two addresses

    Uses SequenceMatcher for fuzzy string matching.

    Args:
        address1: First address string
        address2: Second address string

    Returns:
        Similarity score between 0.0 and 1.0
    """
    if not address1 or not address2:
        return 0.0

    # Normalize both addresses
    norm1 = normalize_address(address1)
    norm2 = normalize_address(address2)

    # Calculate similarity using SequenceMatcher
    similarity = SequenceMatcher(None, norm1, norm2).ratio()

    return similarity


def match_addresses(
    companycam_address: AddressInfo,
    work_order_address: str,
    work_order_city: Optional[str] = None,
    work_order_state: Optional[str] = None,
    work_order_zipcode: Optional[str] = None,
    threshold: float = 0.85
) -> Tuple[bool, float, str]:
    """
    Match CompanyCam address with work order address

    Matching strategy:
    1. Exact match on full address
    2. Exact match on street + city + state
    3. Fuzzy match on full address (>= threshold)
    4. Fuzzy match on street + city (>= threshold * 0.9)

    Args:
        companycam_address: Parsed CompanyCam address
        work_order_address: Work order street address
        work_order_city: Work order city
        work_order_state: Work order state
        work_order_zipcode: Work order zipcode
        threshold: Minimum similarity score for fuzzy matching (default 0.85)

    Returns:
        Tuple of (is_match, confidence_score, match_type)
    """
    # Build full addresses for comparison
    cc_full = companycam_address.full_address
    wo_parts = [p for p in [work_order_address, work_order_city, work_order_state, work_order_zipcode] if p]
    wo_full = ", ".join(wo_parts)

    if not cc_full or not wo_full:
        logger.debug("Cannot match: missing address data")
        return False, 0.0, "no_data"

    # Strategy 1: Exact match on full address
    if normalize_address(cc_full) == normalize_address(wo_full):
        logger.info(f"Exact match found: {cc_full}")
        return True, 1.0, "exact_full"

    # Strategy 2: Exact match on street + city + state
    if (companycam_address.street and work_order_address and
        companycam_address.city and work_order_city and
        companycam_address.state and work_order_state):

        cc_street_city = f"{companycam_address.street}, {companycam_address.city}, {companycam_address.state}"
        wo_street_city = f"{work_order_address}, {work_order_city}, {work_order_state}"

        if normalize_address(cc_street_city) == normalize_address(wo_street_city):
            logger.info(f"Exact match on street+city+state: {cc_street_city}")
            return True, 0.98, "exact_street_city_state"

    # Strategy 3: Fuzzy match on full address
    full_similarity = calculate_address_similarity(cc_full, wo_full)
    if full_similarity >= threshold:
        logger.info(f"Fuzzy match on full address (score: {full_similarity:.2f}): {cc_full} ~ {wo_full}")
        return True, full_similarity, "fuzzy_full"

    # Strategy 4: Fuzzy match on street + city
    if companycam_address.street and work_order_address and companycam_address.city and work_order_city:
        cc_street_city = f"{companycam_address.street}, {companycam_address.city}"
        wo_street_city = f"{work_order_address}, {work_order_city}"

        street_city_similarity = calculate_address_similarity(cc_street_city, wo_street_city)
        fuzzy_threshold = threshold * 0.9  # Slightly lower threshold for partial match

        if street_city_similarity >= fuzzy_threshold:
            logger.info(f"Fuzzy match on street+city (score: {street_city_similarity:.2f}): {cc_street_city} ~ {wo_street_city}")
            return True, street_city_similarity, "fuzzy_street_city"

    # No match found
    logger.debug(f"No match found for {cc_full} vs {wo_full} (best score: {full_similarity:.2f})")
    return False, full_similarity, "no_match"


def extract_photo_filename(photo_url: str, photo_id: int) -> str:
    """
    Extract or generate filename for photo

    Args:
        photo_url: CompanyCam photo URL
        photo_id: Photo ID

    Returns:
        Filename for photo
    """
    # Try to extract filename from URL
    if "/" in photo_url:
        url_filename = photo_url.split("/")[-1]
        if "." in url_filename:
            return url_filename

    # Generate filename from photo ID
    return f"companycam_photo_{photo_id}.jpg"
