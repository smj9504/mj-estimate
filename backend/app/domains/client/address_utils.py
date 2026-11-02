"""
Address normalization for client matching/dedup.
"""

import re
from typing import Any, Dict, Optional

# Common address abbreviations for normalization
ADDRESS_ABBREVIATIONS = {
    "street": "st", "avenue": "ave", "boulevard": "blvd", "drive": "dr",
    "road": "rd", "lane": "ln", "court": "ct", "place": "pl",
    "circle": "cir", "terrace": "ter", "trail": "trl", "way": "way",
    "highway": "hwy", "parkway": "pkwy", "north": "n", "south": "s",
    "east": "e", "west": "w", "northeast": "ne", "northwest": "nw",
    "southeast": "se", "southwest": "sw", "apartment": "apt",
    "suite": "ste", "unit": "unit", "building": "bldg", "floor": "fl",
    "number": "#",
}


def normalize_address(address: str) -> str:
    """
    Normalize an address for comparison.
    - Lowercase
    - Remove punctuation (except #)
    - Standardize abbreviations
    - Collapse whitespace
    - Remove zip+4 extension
    """
    if not address:
        return ""

    addr = address.lower().strip()

    # Remove common punctuation (keep #)
    addr = re.sub(r"[.,;:!?()\[\]{}'\"]", "", addr)

    # Standardize abbreviations
    words = addr.split()
    normalized_words = []
    for word in words:
        normalized_words.append(ADDRESS_ABBREVIATIONS.get(word, word))

    addr = " ".join(normalized_words)

    # Remove zip+4 (keep first 5 digits of zip)
    addr = re.sub(r"(\d{5})-\d{4}", r"\1", addr)

    # Collapse whitespace
    addr = re.sub(r"\s+", " ", addr).strip()

    return addr


def same_address(one: Dict[str, Optional[str]], other: Dict[str, Optional[str]]) -> bool:
    """
    Whether two addresses, split by fill_missing_address_parts, are the same place.

    The whole street has to agree, so one unit isn't mistaken for its neighbor. A street
    name repeats across towns, so the zip rules it out, or the city when a zip is missing;
    an address that says neither can't rule itself out.
    """
    street = normalize_address(one.get("street") or "")
    if not street or street != normalize_address(other.get("street") or ""):
        return False

    zips = [(part.get("zipcode") or "").strip()[:5] for part in (one, other)]
    if all(zips):
        return zips[0] == zips[1]

    cities = [(part.get("city") or "").strip().lower() for part in (one, other)]
    return not all(cities) or cities[0] == cities[1]


def named_after_address(client: Any) -> bool:
    """A client made from just an address: it has no owner yet, so its address stands in
    for its name. No owners alone doesn't say that: imported clients have real names and
    no owners."""
    return not client.owners and (client.display_name or "").strip() == (client.address or "").strip()
