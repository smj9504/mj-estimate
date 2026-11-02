"""Address lookup responses."""

from typing import List, Optional

from pydantic import BaseModel


class AddressSuggestion(BaseModel):
    place_id: str
    full_text: str
    main_text: str
    secondary_text: str = ""


class AddressSuggestions(BaseModel):
    suggestions: List[AddressSuggestion]


class AddressDetails(BaseModel):
    street_address: str
    city: str = ""
    state: str = ""
    zip: str = ""
    county: Optional[str] = None
