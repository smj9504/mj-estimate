"""
Address normalization for client matching/dedup.
"""

import re

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
