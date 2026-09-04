"""
US address parsing utilities.

Shared helper for splitting a single free-form address string into
street / city / state / zipcode components. Used wherever an address is
captured as one field (manual entry, CompanyCam sync, Google Sheets sync)
but needs to be stored in separate columns.
"""

import re
from typing import Dict, Optional

# US state / territory abbreviations
US_STATES = {
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
    'DC', 'PR', 'VI', 'GU', 'AS', 'MP'
}


def parse_us_address(full_address: Optional[str]) -> Dict[str, Optional[str]]:
    """
    Parse a US address string into components.

    Handles formats like:
    - "13042 Quartz Lane, Clifton VA 20124"
    - "12312 La Plata, Silver Spring MD 20904"
    - "123 Main St, Anytown, MD 20001"
    - "456 Oak Ave, Washington, DC 20500"

    Returns:
        Dict with keys: street, city, state, zipcode (values may be None)
    """
    result: Dict[str, Optional[str]] = {
        "street": None,
        "city": None,
        "state": None,
        "zipcode": None,
    }

    if not full_address or not full_address.strip():
        return result

    address = full_address.strip()

    # Trailing ZIP code (5 digits or ZIP+4)
    zip_match = re.search(r'\b(\d{5}(?:-\d{4})?)\s*$', address)
    if zip_match:
        result["zipcode"] = zip_match.group(1)
        address = address[:zip_match.start()].strip()
        address = address.rstrip(',').strip()

    # Trailing 2-letter state code
    state_match = re.search(r'\b([A-Z]{2})\s*$', address)
    if state_match and state_match.group(1) in US_STATES:
        result["state"] = state_match.group(1)
        address = address[:state_match.start()].strip()
        address = address.rstrip(',').strip()

    # Remaining: last comma-separated part is the city, the rest is the street
    parts = [p.strip() for p in address.split(',') if p.strip()]

    if len(parts) >= 2:
        result["city"] = parts[-1]
        result["street"] = ', '.join(parts[:-1])
    elif len(parts) == 1:
        # Single part - no comma to separate city, treat it all as street
        result["street"] = parts[0]

    return result


def fill_missing_address_parts(
    full_address: Optional[str],
    street: Optional[str] = None,
    city: Optional[str] = None,
    state: Optional[str] = None,
    zipcode: Optional[str] = None,
) -> Dict[str, Optional[str]]:
    """
    Derive the address components that were not explicitly provided.

    Explicit values always win; parsing only fills the blanks. This lets a
    caller send an already-split address (e.g. an autocomplete selection)
    without having it second-guessed, while a caller that only has the full
    string still gets usable components.
    """
    parsed = parse_us_address(full_address)

    # A "street" that still carries a city/state/zip is not a street - it is a
    # full address that was put in the street field (legacy rows, or a form
    # whose street box was pre-filled with the full address). Re-parse it so we
    # do not end up repeating the tail when the full address is recomposed.
    street_clean = (street or '').strip()
    if street_clean:
        street_parsed = parse_us_address(street_clean)
        if street_parsed["state"] or street_parsed["zipcode"] or street_parsed["city"]:
            street_clean = street_parsed["street"] or street_clean
            city = city or street_parsed["city"]
            state = state or street_parsed["state"]
            zipcode = zipcode or street_parsed["zipcode"]

    def pick(explicit: Optional[str], key: str) -> Optional[str]:
        if explicit is not None and str(explicit).strip():
            return str(explicit).strip()
        return parsed[key]

    return {
        "street": pick(street_clean, "street"),
        "city": pick(city, "city"),
        "state": pick(state, "state"),
        "zipcode": pick(zipcode, "zipcode"),
    }
