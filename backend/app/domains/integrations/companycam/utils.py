"""
Utility functions for CompanyCam integration

Includes:
- Address parsing and normalization
- Address matching algorithms
- Photo metadata extraction
"""

import logging
import re
from difflib import SequenceMatcher
from typing import Optional, Tuple

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

    # CompanyCam address structure from webhook:
    # {
    #   "street_address_1": "123 Main St",
    #   "street_address_2": null,
    #   "city": "Gangnam",
    #   "state": "Seoul",
    #   "postal_code": "06134",
    #   "country": "US"
    # }
    address_data = project.address

    # Handle None values from CompanyCam API
    # Combine street_address_1 and street_address_2 if both exist
    street_parts = []
    if address_data.get("street_address_1"):
        street_parts.append(address_data.get("street_address_1"))
    if address_data.get("street_address_2"):
        street_parts.append(address_data.get("street_address_2"))

    address_info.street = " ".join(street_parts).strip() if street_parts else ""
    address_info.city = (address_data.get("city") or "").strip()
    address_info.state = (address_data.get("state") or "").strip()
    address_info.zipcode = (address_data.get("postal_code") or address_data.get("zip") or "").strip()

    return address_info


# US State abbreviations mapping (full name -> abbreviation)
US_STATE_MAPPING = {
    "alabama": "al", "alaska": "ak", "arizona": "az", "arkansas": "ar",
    "california": "ca", "colorado": "co", "connecticut": "ct", "delaware": "de",
    "florida": "fl", "georgia": "ga", "hawaii": "hi", "idaho": "id",
    "illinois": "il", "indiana": "in", "iowa": "ia", "kansas": "ks",
    "kentucky": "ky", "louisiana": "la", "maine": "me", "maryland": "md",
    "massachusetts": "ma", "michigan": "mi", "minnesota": "mn", "mississippi": "ms",
    "missouri": "mo", "montana": "mt", "nebraska": "ne", "nevada": "nv",
    "new hampshire": "nh", "new jersey": "nj", "new mexico": "nm", "new york": "ny",
    "north carolina": "nc", "north dakota": "nd", "ohio": "oh", "oklahoma": "ok",
    "oregon": "or", "pennsylvania": "pa", "rhode island": "ri", "south carolina": "sc",
    "south dakota": "sd", "tennessee": "tn", "texas": "tx", "utah": "ut",
    "vermont": "vt", "virginia": "va", "washington": "wa", "west virginia": "wv",
    "wisconsin": "wi", "wyoming": "wy", "district of columbia": "dc"
}

# Reverse mapping (abbreviation -> full name) for normalization
US_STATE_REVERSE = {v: k for k, v in US_STATE_MAPPING.items()}


def normalize_state(state: str) -> str:
    """
    Normalize state name to abbreviation
    
    Args:
        state: State name or abbreviation
        
    Returns:
        Normalized state abbreviation (lowercase)
    """
    if not state:
        return ""
    
    state_lower = state.strip().lower()
    
    # If already an abbreviation (2 letters), return as is
    if len(state_lower) == 2 and state_lower in US_STATE_MAPPING.values():
        return state_lower
    
    # Try to find in mapping
    if state_lower in US_STATE_MAPPING:
        return US_STATE_MAPPING[state_lower]
    
    # If not found, return normalized (lowercase, trimmed)
    return state_lower


def normalize_street_address(street: str) -> str:
    """
    Normalize street address for matching
    
    - Convert to lowercase
    - Remove extra whitespace
    - Remove punctuation except hyphens
    - Standardize abbreviations
    
    Args:
        street: Street address string
        
    Returns:
        Normalized street address
    """
    if not street:
        return ""
    
    # Convert to lowercase
    normalized = street.lower()
    
    # Remove extra whitespace
    normalized = " ".join(normalized.split())
    
    # Remove periods and other punctuation (keep hyphens for apartment numbers)
    normalized = re.sub(r"[^\w\s-]", "", normalized)
    
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
        r"\bunit\b": "unit",
        r"\b#\b": "",  # Remove # symbol
        r"\bn\b": "north",
        r"\bs\b": "south",
        r"\be\b": "east",
        r"\bw\b": "west",
    }
    
    for abbr, full in abbreviations.items():
        normalized = re.sub(abbr, full, normalized)
    
    return normalized.strip()


def normalize_address(address: str) -> str:
    """
    Normalize address for matching

    - Convert to lowercase
    - Remove extra whitespace
    - Remove punctuation except commas
    - Standardize abbreviations (St -> Street, Ave -> Avenue, etc.)
    - Remove zipcode/postal code for matching

    Args:
        address: Raw address string

    Returns:
        Normalized address string (without zipcode)
    """
    if not address:
        return ""

    # Convert to lowercase
    normalized = address.lower()

    # Remove extra whitespace
    normalized = " ".join(normalized.split())

    # Remove zipcode/postal code (5 digits or 5+4 format)
    normalized = re.sub(r'\b\d{5}(-\d{4})?\b', '', normalized)

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


def match_street_address(
    street1: Optional[str],
    city1: Optional[str],
    state1: Optional[str],
    street2: Optional[str],
    city2: Optional[str],
    state2: Optional[str],
    threshold: float = 0.85
) -> Tuple[bool, float, str]:
    """
    Match two addresses based on street, city, and state (ignoring zipcode)
    
    This is the primary matching function for preventing duplicate leads.
    It normalizes states (Maryland -> MD, Virginia -> VA, etc.) and
    compares street addresses with fuzzy matching.
    
    Args:
        street1: First street address
        city1: First city
        state1: First state (can be full name or abbreviation)
        street2: Second street address
        city2: Second city
        state2: Second state (can be full name or abbreviation)
        threshold: Minimum similarity score for fuzzy matching (default 0.85)
        
    Returns:
        Tuple of (is_match, confidence_score, match_type)
    """
    # Check if we have minimum required fields
    if not street1 or not street2:
        return False, 0.0, "no_street"
    
    # Normalize states
    norm_state1 = normalize_state(state1) if state1 else ""
    norm_state2 = normalize_state(state2) if state2 else ""
    
    # Normalize street addresses
    norm_street1 = normalize_street_address(street1)
    norm_street2 = normalize_street_address(street2)
    
    # Normalize cities (lowercase, trim)
    norm_city1 = city1.lower().strip() if city1 else ""
    norm_city2 = city2.lower().strip() if city2 else ""
    
    # Strategy 1: Exact match on street + city + state (normalized)
    if norm_city1 and norm_city2 and norm_state1 and norm_state2:
        if (norm_street1 == norm_street2 and 
            norm_city1 == norm_city2 and 
            norm_state1 == norm_state2):
            logger.info(f"Exact match on street+city+state: {street1}, {city1}, {state1}")
            return True, 1.0, "exact_street_city_state"
    
    # Strategy 2: Exact match on street + city (if states don't match or missing)
    if norm_city1 and norm_city2:
        if norm_street1 == norm_street2 and norm_city1 == norm_city2:
            # If states match or both are missing, it's a good match
            if norm_state1 == norm_state2:
                logger.info(f"Exact match on street+city: {street1}, {city1}")
                return True, 0.95, "exact_street_city"
            # If states don't match but street+city match, still consider it (lower confidence)
            elif not norm_state1 or not norm_state2:
                logger.info(f"Exact match on street+city (state missing): {street1}, {city1}")
                return True, 0.90, "exact_street_city_no_state"
    
    # Strategy 3: Fuzzy match on street + city + state
    if norm_city1 and norm_city2 and norm_state1 and norm_state2:
        addr1 = f"{norm_street1}, {norm_city1}, {norm_state1}"
        addr2 = f"{norm_street2}, {norm_city2}, {norm_state2}"
        similarity = calculate_address_similarity(addr1, addr2)
        
        if similarity >= threshold:
            logger.info(f"Fuzzy match on street+city+state (score: {similarity:.2f}): {addr1} ~ {addr2}")
            return True, similarity, "fuzzy_street_city_state"
    
    # Strategy 4: Fuzzy match on street + city (if states match or missing)
    if norm_city1 and norm_city2:
        # Only fuzzy match if states match or both are missing
        if norm_state1 == norm_state2:
            addr1 = f"{norm_street1}, {norm_city1}"
            addr2 = f"{norm_street2}, {norm_city2}"
            similarity = calculate_address_similarity(addr1, addr2)
            fuzzy_threshold = threshold * 0.9  # Slightly lower for street+city only
            
            if similarity >= fuzzy_threshold:
                logger.info(f"Fuzzy match on street+city (score: {similarity:.2f}): {addr1} ~ {addr2}")
                return True, similarity, "fuzzy_street_city"
    
    # Strategy 5: Fuzzy match on street only (if cities match)
    if norm_city1 == norm_city2:
        similarity = calculate_address_similarity(norm_street1, norm_street2)
        street_threshold = threshold * 0.85  # Lower threshold for street only
        
        if similarity >= street_threshold:
            logger.info(f"Fuzzy match on street only (score: {similarity:.2f}): {norm_street1} ~ {norm_street2}")
            return True, similarity, "fuzzy_street"
    
    # No match found
    best_score = 0.0
    if norm_city1 and norm_city2:
        addr1 = f"{norm_street1}, {norm_city1}"
        addr2 = f"{norm_street2}, {norm_city2}"
        best_score = calculate_address_similarity(addr1, addr2)
    
    logger.debug(f"No match found: {street1}, {city1}, {state1} vs {street2}, {city2}, {state2} (score: {best_score:.2f})")
    return False, best_score, "no_match"


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

    Matching strategy (prioritizes street address matching):
    1. Match on street + city + state (using match_street_address)
    2. Exact match on full address
    3. Fuzzy match on full address (>= threshold)

    Args:
        companycam_address: Parsed CompanyCam address
        work_order_address: Work order street address
        work_order_city: Work order city
        work_order_state: Work order state
        work_order_zipcode: Work order zipcode (ignored for matching)
        threshold: Minimum similarity score for fuzzy matching (default 0.85)

    Returns:
        Tuple of (is_match, confidence_score, match_type)
    """
    # Primary strategy: Match on street + city + state (ignoring zipcode)
    if (companycam_address.street and work_order_address):
        is_match, confidence, match_type = match_street_address(
            companycam_address.street,
            companycam_address.city,
            companycam_address.state,
            work_order_address,
            work_order_city,
            work_order_state,
            threshold
        )
        if is_match:
            return is_match, confidence, match_type
    
    # Fallback: Match on full address (for backward compatibility)
    cc_full = companycam_address.full_address
    wo_parts = [p for p in [work_order_address, work_order_city, work_order_state, work_order_zipcode] if p]
    wo_full = ", ".join(wo_parts)

    if not cc_full or not wo_full:
        logger.debug("Cannot match: missing address data")
        return False, 0.0, "no_data"

    # Exact match on full address
    if normalize_address(cc_full) == normalize_address(wo_full):
        logger.info(f"Exact match found: {cc_full}")
        return True, 1.0, "exact_full"

    # Fuzzy match on full address
    full_similarity = calculate_address_similarity(cc_full, wo_full)
    if full_similarity >= threshold:
        logger.info(f"Fuzzy match on full address (score: {full_similarity:.2f}): {cc_full} ~ {wo_full}")
        return True, full_similarity, "fuzzy_full"

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
