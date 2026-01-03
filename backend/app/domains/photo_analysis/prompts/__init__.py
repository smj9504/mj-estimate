"""
Photo Analysis Prompts

Room-specific prompt templates for GPT-4 Vision analysis.
"""

from app.domains.photo_analysis.prompts.room_prompts import (
    get_room_prompt,
    KITCHEN_PROMPT,
    BEDROOM_PROMPT,
    LIVING_ROOM_PROMPT,
    BATHROOM_PROMPT,
    GARAGE_PROMPT,
    OFFICE_PROMPT,
    DINING_ROOM_PROMPT,
    BASEMENT_PROMPT,
    ATTIC_PROMPT,
    CLOSET_PROMPT,
    LAUNDRY_PROMPT,
)

__all__ = [
    "get_room_prompt",
    "KITCHEN_PROMPT",
    "BEDROOM_PROMPT",
    "LIVING_ROOM_PROMPT",
    "BATHROOM_PROMPT",
    "GARAGE_PROMPT",
    "OFFICE_PROMPT",
    "DINING_ROOM_PROMPT",
    "BASEMENT_PROMPT",
    "ATTIC_PROMPT",
    "CLOSET_PROMPT",
    "LAUNDRY_PROMPT",
]
