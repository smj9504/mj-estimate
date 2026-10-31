"""
ScopeIt - Packing Tool Vision Service

Provides Claude Vision API integration for photo-based room content analysis.
Ported from moving_estimate standalone application.

Two public service functions:
    analyze_room_photos(room_name, images, existing_items, settings)
        -> RoomAnalysisResponse

    build_master_content_list(rooms)
        -> MasterContentResponse

The analysis is one Claude vision call with tool use: it identifies every
packable item with its category, quantity, size, weight and fragility, and says
what the photo can't settle. Names are normalized via the taxonomy, then
item_plan works out each item's packing method, materials and labor from those
attributes, the same way it does when the estimator changes one by hand.

Graceful degradation: if anthropic is not installed or ANTHROPIC_API_KEY is
not set, both public functions raise HTTPException(503) with a clear message.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
from collections import defaultdict
from typing import List, Optional

from fastapi import HTTPException

from app.core.config import settings
from app.domains.pack_calculation.item_plan import SIZES, WEIGHTS, apply_plan
from app.domains.pack_calculation.packing_schemas import (
    DetectedContentItem,
    ExistingItem,
    MasterContentItem,
    MasterContentResponse,
    MasterContentRoom,
    RoomAnalysisResponse,
)

try:
    import anthropic as _anthropic_module

    _ANTHROPIC_AVAILABLE = True
except ImportError:  # pragma: no cover
    _anthropic_module = None  # type: ignore[assignment]
    _ANTHROPIC_AVAILABLE = False

try:
    # Teaches Pillow to open iPhone HEIC/HEIF photos
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:  # pragma: no cover
    pass

try:
    from app.domains.pack_calculation.taxonomy import normalize_items_list

    _TAXONOMY_AVAILABLE = True
except ImportError:
    normalize_items_list = None  # type: ignore[assignment]
    _TAXONOMY_AVAILABLE = False


# ============================================
# CONSTANTS
# ============================================

MAX_IMAGE_BYTES = 1_000_000   # 1 MB per image — 1024 px JPEG is sufficient
MAX_IMAGE_DIM = 1024          # px — halving from 2048 cuts image tokens 4×
MAX_IMAGES_PER_ROOM = 6       # hard cap after deduplication

# A reply cut off at max_tokens comes back with an empty tool input, and each
# item now reports more: at 4096, a room of about 20 items would lose them all.
MAX_ANALYSIS_TOKENS = 16000


# ============================================
# ANALYSIS TOOL: Item Identification (Vision)
# ============================================

ITEM_CATEGORIES = [
    "Furniture", "Electronics", "Books", "Kitchenware",
    "Clothing", "Fragile", "Artwork", "Collectibles",
    "Appliances", "Tools", "Sports", "Other",
]

DENSITY_VALUES = ["light", "normal", "dense", "heavy"]
ROOM_SIZE_VALUES = ["small", "large", "xlarge"]

# What the AI can leave for the estimator to decide. Whether an item is there
# at all comes from its item_confidence: it decides whether the item is priced,
# so it needs the number, not a passing doubt.
REVIEW_FIELDS = [
    "name", "quantity", "category",
    "size", "weight", "fragile", "disassembly",
]

# Below this it's a guess, not an item
MIN_ITEM_CONFIDENCE = 0.5
# Below this it may not be there: shown to the estimator, not priced until kept
SURE_ITEM_CONFIDENCE = 0.8

ANALYSIS_TOOL = {
    "name": "report_room_contents",
    "description": (
        "Report all packable items visible in the room photo(s). "
        "Each item should be named for PACKING purposes only -- include type, "
        "material, and size when relevant. Omit colors, patterns, brand names, "
        "and character references. "
        "Examples of GOOD names: 'Queen Bed Frame', 'Wooden Bookshelf', "
        "'Table Lamp', 'Quilt Blanket', '4-Drawer Dresser'. "
        "Examples of BAD names: 'Colorful Patchwork Quilt with Winnie the Pooh', "
        "'Dark Brown Vintage Bookshelf', 'Blue Ceramic Vase'."
    ),
    "input_schema": {
        "type": "object",
        "required": ["items", "density", "room_size", "confidence"],
        "properties": {
            "items": {
                "type": "array",
                "description": (
                    "Every MOVABLE, packable item visible. "
                    "INCLUDE: freestanding furniture, electronics, boxes, decor, rugs, "
                    "baskets, lamps, books, artwork, bedding, clothing, freestanding "
                    "appliances (fridge, washer/dryer, stove), wall-mounted TVs. "
                    "EXCLUDE anything permanently attached to the building structure — "
                    "recessed/ceiling lights, ceiling fans, pendant fixtures, bathtub, "
                    "toilet, shower, built-in kitchen/bathroom cabinets (screwed to wall), "
                    "countertops, backsplash, built-in shelving, HVAC vents, thermostats, "
                    "blinds/shutters on tracks, smoke detectors. "
                    "KEY TEST: if removing it requires cutting plumbing, unscrewing from "
                    "wall/ceiling, or structural work → EXCLUDE. If it can be carried out "
                    "as-is → INCLUDE."
                ),
                "items": {
                    "type": "object",
                    "required": [
                        "name", "category", "quantity", "size", "weight",
                        "is_high_value", "is_fragile", "needs_disassembly",
                        "item_confidence", "uncertain",
                    ],
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": (
                                "Packing-focused name: type + material + size. "
                                "NO colors, patterns, brands, characters. "
                                "GOOD: 'Queen Bed Frame', '4-Drawer Wooden Dresser', 'Quilt Blanket'. "
                                "BAD: 'Colorful Patchwork Quilt', 'Dark Clothing Items on Chair'."
                            ),
                        },
                        "category": {
                            "type": "string",
                            "enum": ITEM_CATEGORIES,
                        },
                        "quantity": {
                            "type": "integer",
                            "minimum": 1,
                            "description": (
                                "Count of items. "
                                "For books: estimated number of individual books (e.g. 80). "
                                "For sectional sofa: number of sections (e.g. 3). "
                                "For identical small items: total count. "
                                "For unique large items: 1."
                            ),
                        },
                        "size": {
                            "type": "string",
                            "enum": list(SIZES),
                            "description": (
                                "Size of ONE unit. "
                                "small: fits in a box, carried in one hand (vase, toaster, book). "
                                "medium: one person carries it (nightstand, dining chair, 40-inch TV, microwave). "
                                "large: two people carry it (sofa, dresser, queen mattress, refrigerator). "
                                "xlarge: oversized (armoire, china cabinet, king mattress, treadmill)."
                            ),
                        },
                        "weight": {
                            "type": "string",
                            "enum": list(WEIGHTS),
                            "description": (
                                "Weight of ONE unit, with whatever stays inside it. "
                                "light: under 20 lb. medium: 20-50 lb, one person lifts it. "
                                "heavy: 50-150 lb, two-person lift. "
                                "very_heavy: over 150 lb, dolly and 3+ people (upright piano, safe, solid wood armoire)."
                            ),
                        },
                        "is_high_value": {
                            "type": "boolean",
                            "description": "True if replacement value > $500",
                        },
                        "estimated_value": {
                            "type": ["string", "null"],
                            "description": "Dollar range string if high-value, else null. E.g. '$800 - $1200'",
                        },
                        "is_fragile": {
                            "type": "boolean",
                            "description": "True if breakable or requires delicate handling",
                        },
                        "needs_disassembly": {
                            "type": "boolean",
                            "description": "True only if it needs tools to come apart before it can leave the room or ride safely (bed frame, bunk bed, large desk, sectional hardware). False for dressers, chairs, lamps, or anything that only needs drawers or a shade taken off.",
                        },
                        "item_confidence": {
                            "type": "number",
                            "minimum": 0.0,
                            "maximum": 1.0,
                            "description": (
                                "Your confidence (0.0-1.0) that this item is ACTUALLY present and visible "
                                "in the photo. 1.0 = clearly visible, unambiguous. "
                                "0.8 = fairly certain but slightly obscured. "
                                "0.5 = partially visible or uncertain. "
                                "Leave out anything below 0.5."
                            ),
                        },
                        "uncertain": {
                            "type": "array",
                            "items": {"type": "string", "enum": REVIEW_FIELDS},
                            "description": (
                                "Which answers for this item the photo can't settle, so an estimator should "
                                "decide them. List a field only when another estimator looking at the same "
                                "photo could reasonably answer differently. Empty when it's clear."
                            ),
                        },
                        "uncertainty_note": {
                            "type": ["string", "null"],
                            "description": (
                                "One short sentence an estimator can act on, saying what you can't tell. "
                                "E.g. 'Can't tell solid wood from particle board, so it could be medium or heavy.' "
                                "Null when uncertain is empty."
                            ),
                        },
                        "special_instructions": {
                            "type": ["string", "null"],
                            "description": "Field note only if something on site matters. E.g. 'Keep cables with item', 'Check moisture at the base'",
                        },
                    },
                },
            },
            "density": {
                "type": "string",
                "enum": DENSITY_VALUES,
                "description": (
                    "Rate the PRIMARY living space only. "
                    "EXCLUDE closets, walk-in wardrobes, and attached storage areas — "
                    "their contents are inventoried separately and must NOT inflate density. "
                    "light: sparsely furnished main area (few large pieces, lots of open floor). "
                    "normal: typical furnishing (bed + dresser + nightstands, or equivalent). "
                    "dense: heavily furnished main area (extra furniture, many decor pieces, limited walkway). "
                    "heavy: packed/cluttered main area (hoarding-level, furniture stacked or layered)."
                ),
            },
            "room_size": {
                "type": "string",
                "enum": ROOM_SIZE_VALUES,
                "description": (
                    "small: <80 sqft (bathroom, closet). "
                    "large: 80-250 sqft (bedroom, kitchen). "
                    "xlarge: 250+ sqft (master, basement, garage)."
                ),
            },
            "confidence": {
                "type": "number",
                "minimum": 0.0,
                "maximum": 1.0,
                "description": "Confidence in the overall analysis (0.0-1.0)",
            },
        },
    },
}


# ============================================
# ROOM CONTEXT HELPERS
# ============================================

# Maps normalized room keywords to (typical_items, unlikely_items)
_ROOM_CONTEXT: dict[str, dict] = {
    "kitchen": {
        "typical": [
            "refrigerator", "microwave", "toaster", "coffee maker", "blender",
            "stand mixer", "dish rack", "small appliances", "kitchenware",
            "pots and pans", "cutting board", "knife block", "kitchen island",
            "bar stool", "dining table", "dining chair",
        ],
        "unlikely": [
            "bed frame", "mattress", "bedding", "dresser", "nightstand",
            "wardrobe", "clothing", "sofa", "coffee table", "TV stand",
            "toilet", "bathtub", "shower", "bathroom vanity",
        ],
    },
    "bedroom": {
        "typical": [
            "bed frame", "mattress", "bedding", "dresser", "nightstand",
            "wardrobe", "armoire", "clothing", "mirror", "desk", "desk chair",
            "lamp", "bookcase", "TV", "fan",
        ],
        "unlikely": [
            "refrigerator", "stove", "toilet", "bathtub", "shower",
            "washer", "dryer", "kitchen island", "dining table",
        ],
    },
    "bathroom": {
        "typical": [
            "freestanding mirror", "bathroom cabinet", "toilet paper holder",
            "towel rack", "scale", "hamper", "trash can", "shower caddy",
            "freestanding shelving",
        ],
        "unlikely": [
            "bed frame", "mattress", "sofa", "dining table", "refrigerator",
            "stove", "dresser", "wardrobe", "TV",
        ],
    },
    "living room": {
        "typical": [
            "sofa", "sectional", "loveseat", "armchair", "coffee table",
            "TV", "TV stand", "entertainment center", "bookcase", "lamp",
            "rug", "side table", "accent table", "decorative items",
        ],
        "unlikely": [
            "bed frame", "mattress", "toilet", "bathtub", "stove",
            "refrigerator", "washer", "dryer",
        ],
    },
    "dining room": {
        "typical": [
            "dining table", "dining chair", "buffet", "sideboard",
            "china cabinet", "bar cart", "rug", "lamp",
        ],
        "unlikely": [
            "bed frame", "mattress", "toilet", "bathtub", "washer", "dryer",
        ],
    },
    "office": {
        "typical": [
            "desk", "office chair", "bookcase", "filing cabinet", "printer",
            "monitor", "computer tower", "laptop", "desk lamp", "shelving",
        ],
        "unlikely": [
            "bed frame", "mattress", "toilet", "bathtub", "stove",
            "refrigerator", "washer", "dryer",
        ],
    },
    "garage": {
        "typical": [
            "workbench", "tool chest", "shelving unit", "storage cabinet",
            "bicycle", "lawn mower", "power tools", "sports equipment",
            "storage bins", "ladder",
        ],
        "unlikely": [
            "bed frame", "mattress", "toilet", "bathtub", "shower",
        ],
    },
    "laundry": {
        "typical": [
            "washer", "dryer", "laundry basket", "drying rack",
            "storage cabinet", "shelving unit",
        ],
        "unlikely": [
            "bed frame", "mattress", "sofa", "dining table", "toilet", "bathtub",
        ],
    },
    "basement": {
        "typical": [
            "shelving unit", "storage cabinet", "washer", "dryer",
            "exercise equipment", "workbench", "storage bins", "furniture",
        ],
        "unlikely": [],
    },
    "attic": {
        "typical": [
            "storage boxes", "shelving unit", "furniture (stored)",
            "seasonal items", "luggage",
        ],
        "unlikely": [],
    },
}


def _get_room_context_note(room_name: str) -> str:
    """Return a room-context guidance note based on the room name."""
    normalized = room_name.lower()
    matched_key = None
    for key in _ROOM_CONTEXT:
        if key in normalized:
            matched_key = key
            break

    if not matched_key:
        return (
            f'The room is labeled "{room_name}". '
            "Use this as helpful context, but only report items you can VISUALLY CONFIRM in the photo(s)."
        )

    ctx = _ROOM_CONTEXT[matched_key]
    typical_str = ", ".join(ctx["typical"][:10])
    unlikely_str = ", ".join(ctx["unlikely"][:8])

    note = (
        f'The room is labeled "{room_name}" (a {matched_key}). '
        f"Use this as CONTEXT to guide your analysis:\n"
        f"- TYPICAL items for this room: {typical_str}, etc.\n"
    )
    if unlikely_str:
        note += (
            f"- UNLIKELY items for this room: {unlikely_str}, etc.\n"
            f"  → If you think you see one of these unlikely items, apply EXTRA SCRUTINY "
            f"before listing it. Ask yourself: is this DEFINITELY visible in the photo, "
            f"or am I inferring it based on context? Only include it if 100% visually confirmed.\n"
        )
    note += "Only report items you can VISUALLY CONFIRM in the photo(s)."
    return note


# ============================================
# PROMPT BUILDERS
# ============================================

def _build_analysis_prompt(
    room_name: str,
    num_images: int,
    existing_items: Optional[List[ExistingItem]] = None,
) -> str:
    """Build the prompt for use with the report_room_contents tool."""
    multi_note = ""
    if num_images > 1:
        multi_note = (
            f"\nYou see {num_images} photos of the SAME room from different angles. "
            "Count each real-world item ONLY ONCE using spatial reasoning.\n"
        )

    existing_note = ""
    if existing_items:
        items_str = ", ".join(
            f"{item.name} (x{item.quantity})" for item in existing_items
        )
        existing_note = (
            f"\nAlready inventoried (SKIP these): {items_str}\n"
            "Only report items NOT on this list.\n"
        )

    room_context_note = _get_room_context_note(room_name)

    return f"""You are a professional Content Pack-Out Estimator. Analyze the photo(s) and list every packable item.
{multi_note}{existing_note}
ROOM CONTEXT: {room_context_note}

RULES:
1. Identify every MOVABLE, packable item — furniture, electronics, boxes, decor, rugs, lamps, books, artwork, bedding, clothing, freestanding appliances, etc.
2. DWELLING vs. CONTENT — apply this test for every item you see:
   EXCLUDE if: removing it requires cutting plumbing/electrical, unscrewing from wall/ceiling, or structural work.
   INCLUDE if: it can be picked up and carried out as-is (even if heavy).

   ALWAYS EXCLUDE (permanently attached to structure):
   - Recessed/pot lights, ceiling-mounted light fixtures, ceiling fans
   - Bathtub, shower, toilet — plumbed into floor/wall
   - Built-in kitchen cabinets (upper/lower wall cabinets screwed to wall)
   - Built-in bathroom vanity cabinet (if wall-mounted/plumbed)
   - Countertops, backsplash, tile
   - Built-in shelving or closet organizers attached to walls
   - HVAC vents, thermostats, smoke detectors, electrical panels
   - Window blinds, shutters, or curtain rods mounted to wall/frame

   ALWAYS INCLUDE (freestanding / removable content):
   - Freestanding kitchen island (sits on floor, not bolted to wall)
   - Freestanding wardrobe, armoire, storage cabinet
   - Refrigerator, stove/range, washer, dryer (appliances — move even if connected)
   - Microwave (countertop or over-range — both are content)
   - Wall-mounted TV (content — it's electronics, just needs unmounting)
   - Curtains/drapes (the fabric itself, not the rod)
   - Freestanding baker's rack, shelving unit, or bookshelf

   AMBIGUOUS — USE VISUAL JUDGMENT:
   - Cabinet: if it looks built into the wall (flush, no gap, no legs) → EXCLUDE. If it's freestanding with visible sides/legs → INCLUDE.
   - Shelving: if brackets are screwed into wall with no way to remove shelf as a unit → EXCLUDE. If it's a standalone unit → INCLUDE.

3. Give each item an honest item_confidence score (0.0–1.0) that it is truly present. If it is blurry or barely visible, still list it with a score of 0.5–0.8 and an estimator will decide. OMIT anything below 0.5, and anything you are only inferring from the kind of room.
4. NAME items for PACKING: type + material + size. NO colors, patterns, brands, characters, or location info.
   - INCLUDE size/configuration info that AFFECTS PACKING: "3-Section Sectional Sofa", "6-Shelf Tall Bookcase", "4-Drawer Dresser", "King Bed Frame"
   - GOOD: "3-Section L-Shaped Sofa", "Tall 5-Shelf Wooden Bookcase", "Queen Bed Frame", "Large 3-Door Wardrobe"
   - BAD: "Comfortable Sofa", "Nice Bookshelf", "Big Bed"
5. Scan EVERY area: foreground, background, shelves, floor, walls, corners, on top of furniture.
6. Group ONLY identical small items (e.g. "Photo Frame" qty 3). Each distinct item = separate entry.

CRITICAL - REPORT CONTENTS SEPARATELY FROM CONTAINERS:
- If a bookcase/bookshelf has visible books → list the bookcase as "Furniture" AND list "Book Collection" separately as "Books" with an estimated quantity
- If a dresser has visible clothing → list the dresser as "Furniture" AND list "Clothing Items" as "Clothing"
- If shelves have dishes/kitchenware → list as "Kitchenware" separately
- Items ON TOP of furniture (lamps, decor, electronics) → list each separately

DENSITY RATING — PRIMARY SPACE ONLY:
- If any photo shows a closet, walk-in wardrobe, or attached storage area, inventory those items normally BUT do NOT factor them into the density rating.
- Density must reflect how crowded the MAIN living area feels (open floor space, furniture arrangement), not the total item count across all photos.
- A master bedroom with a packed walk-in closet photo is still "normal" density if the bedroom itself is typically furnished.

SOFA/SEATING SIZE RULES (affects material quantity significantly):
- Standard sofa (2-3 cushions, single piece): quantity = 1
- Sectional sofa with 2 pieces: quantity = 2, name = "2-Section Sectional Sofa"
- Sectional sofa with 3+ pieces: quantity = 3 (or more), name = "3-Section Sectional Sofa"
- Each section = separate packing unit requiring its own cover and blankets

SIZE AND WEIGHT DECIDE HOW IT IS PACKED AND HOW LONG IT TAKES:
- Both describe ONE unit, never the whole line: "Book Collection" qty 80 is size small, weight light.
- Judge weight from the material you can see, with what stays inside. A solid oak dresser is heavier than a laminate one of the same size.

SAY WHAT YOU CAN'T TELL — an estimator reads this and decides, so don't guess silently:
- Weight: can't tell solid wood from particle board, or whether a cabinet is full → uncertain "weight".
- Size: partly hidden or nothing nearby to judge scale by → uncertain "size".
- Quantity: books or clothes counted roughly from a shelf or closet → uncertain "quantity".
- Fragile: a vase that could be ceramic or plastic, a table top that could be glass → uncertain "fragile".
- Category or name: could be two different things → uncertain "category" or "name".
- Disassembly: can't see whether it comes apart or fits through the door → uncertain "disassembly".
- Whether it's there at all: say so with item_confidence, not here.
When you list anything in uncertain, say why in uncertainty_note. When an answer is clear, leave it out: most items should have an empty uncertain list.

Use the report_room_contents tool to submit your findings."""


# ============================================
# TOOL RESULT EXTRACTION
# ============================================

def _extract_tool_result(response) -> Optional[dict]:
    """Extract the tool input dict from a Claude API response.

    When using tool_choice={"type": "tool", "name": "..."}, the response
    contains a tool_use block whose 'input' is the structured data.
    Returns None if no tool_use block is found.
    """
    for block in response.content:
        if block.type == "tool_use":
            return block.input
    return None


# ============================================
# IMAGE HELPERS
# ============================================

def _select_diverse_images(
    images: list,
    max_images: int = MAX_IMAGES_PER_ROOM,
    threshold: float = 0.95,
) -> list:
    """Return up to max_images photos, skipping near-duplicate shots.

    Resizes each image to a 32x32 grayscale thumbnail and compares cosine
    similarity against already-selected thumbnails. Two images whose similarity
    exceeds threshold are considered the same angle and the later one is dropped.

    Falls back to a simple slice if Pillow is not available.
    """
    THUMB = 32

    try:
        from PIL import Image as _Image
    except ImportError:
        return images[:max_images]

    def _thumb_pixels(img_b64: str):
        try:
            raw = img_b64
            if raw.startswith("data:"):
                raw = raw.split(",", 1)[1]
            img_bytes = base64.b64decode(raw)
            with io.BytesIO(img_bytes) as buf:
                img = _Image.open(buf)
                img.load()  # Force full decode so buf can be closed
                thumb = img.resize((THUMB, THUMB), _Image.LANCZOS).convert("L")
                pixels = list(thumb.getdata())
            return pixels
        except Exception:
            return None

    def _cosine(a: list, b: list) -> float:
        dot = sum(x * y for x, y in zip(a, b))
        mag_a = sum(x * x for x in a) ** 0.5
        mag_b = sum(x * x for x in b) ** 0.5
        return dot / (mag_a * mag_b) if mag_a and mag_b else 0.0

    selected: list = []
    thumbs: list = []
    for img in images:
        if len(selected) >= max_images:
            break
        pixels = _thumb_pixels(img)
        if pixels is None:
            selected.append(img)
            continue
        if any(_cosine(pixels, t) >= threshold for t in thumbs):
            continue
        selected.append(img)
        thumbs.append(pixels)

    return selected


def _sniff_media_type(raw_b64: str) -> Optional[str]:
    """Return the media type Claude accepts for these bytes, or None.

    Reads the file signature, since the frontend sends bare base64 without
    a data URL prefix and the photo may be PNG/WebP rather than JPEG.
    """
    try:
        head = base64.b64decode(raw_b64[:24])
    except Exception:
        return None
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


def _compress_image_base64(
    image_base64: str,
    max_bytes: int = MAX_IMAGE_BYTES,
) -> tuple[str, str]:
    """Compress a base64 image so the raw base64 string stays under max_bytes.

    Returns (media_type, base64_data) with the data URL prefix stripped.
    If the image is already small enough and in a format Claude accepts
    (JPEG/PNG/GIF/WebP), returns it unchanged; anything else is re-encoded
    as JPEG. Raises HTTPException(400) for a photo Pillow cannot read.
    """
    raw_b64 = image_base64

    if raw_b64.startswith("data:"):
        parts = raw_b64.split(",", 1)
        if len(parts) > 1:
            raw_b64 = parts[1]

    # Trust the bytes, not the label: a mislabeled image is a 400 from Claude
    media_type = _sniff_media_type(raw_b64)

    if media_type and len(raw_b64) <= max_bytes:
        return media_type, raw_b64

    try:
        from PIL import Image

        img_bytes = base64.b64decode(raw_b64)
        with io.BytesIO(img_bytes) as input_buf:
            img = Image.open(input_buf)
            img.load()  # Force full decode so input_buf can be closed
            if img.mode in ("RGBA", "P", "LA"):
                img = img.convert("RGB")

        quality = 85
        max_dim = MAX_IMAGE_DIM

        while True:
            if max(img.size) > max_dim:
                img.thumbnail((max_dim, max_dim), Image.LANCZOS)

            with io.BytesIO() as buf:
                img.save(buf, format="JPEG", quality=quality, optimize=True)
                encoded = base64.b64encode(buf.getvalue()).decode("ascii")

            if len(encoded) <= max_bytes or quality <= 30:
                return "image/jpeg", encoded

            if quality > 40:
                quality -= 15
            else:
                quality = 30
                max_dim = int(max_dim * 0.75)
                if max_dim < 512:
                    return "image/jpeg", encoded

    except ImportError:
        pass  # Pillow not installed — return as-is
    except Exception:
        pass

    if media_type is None:
        # Pillow couldn't open it and Claude won't take it as-is
        raise HTTPException(status_code=400, detail=_UNREADABLE_PHOTO)
    return media_type, raw_b64


_UNREADABLE_PHOTO = (
    "A photo is in a format that can't be read. "
    "Please upload JPEG, PNG, WebP or HEIC photos."
)

PREVIEW_MAX_DIM = 2048  # px — sharp enough to zoom in the photo preview


def convert_photo_to_jpeg(data: bytes, max_dim: int = PREVIEW_MAX_DIM) -> str:
    """Re-encode an uploaded photo (e.g. iPhone HEIC) as base64 JPEG.

    Browsers like Chrome can't display HEIC, so the frontend converts those
    photos here on upload and keeps the JPEG for thumbnails and analysis.
    Raises HTTPException(400) for a file Pillow cannot read.
    """
    from PIL import Image, ImageOps

    try:
        with io.BytesIO(data) as input_buf:
            img = Image.open(input_buf)
            img.load()  # Force full decode so input_buf can be closed
    except Exception:
        raise HTTPException(status_code=400, detail=_UNREADABLE_PHOTO)

    img = ImageOps.exif_transpose(img)
    if img.mode != "RGB":
        img = img.convert("RGB")
    img.thumbnail((max_dim, max_dim), Image.LANCZOS)

    with io.BytesIO() as buf:
        img.save(buf, format="JPEG", quality=85, optimize=True)
        return base64.b64encode(buf.getvalue()).decode("ascii")


# ============================================
# DEPENDENCY GUARD
# ============================================

def _require_vision_dependencies() -> None:
    """Raise HTTPException(503) if vision dependencies are not available."""
    if not _ANTHROPIC_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail=(
                "Photo analysis requires the 'anthropic' package. "
                "Install it with: pip install anthropic"
            ),
        )
    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=503,
            detail=(
                "Photo analysis requires ANTHROPIC_API_KEY to be set. "
                "Add it to your .env.local file: ANTHROPIC_API_KEY=sk-ant-..."
            ),
        )


# ============================================
# CORE VISION PIPELINE (INTERNAL)
# ============================================

async def _analyze_room_with_claude(
    images: List[str],
    room_name: str,
    existing_items: Optional[List[ExistingItem]] = None,
) -> Optional[dict]:
    """Room analysis using Claude vision and tool use.

    Sends the images with the report_room_contents tool schema. Claude returns
    structured output with constrained enums and typed fields, then item names
    are normalized via the packing taxonomy.

    Returns the result dict, or None on failure.
    """
    async with _anthropic_module.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY) as client:

        per_image_limit = MAX_IMAGE_BYTES // max(len(images), 1)
        per_image_limit = max(per_image_limit, 1_000_000)

        content = []
        for img in images:
            # PIL decode/re-encode is CPU-bound; keep it off the event loop
            media_type, img_data = await asyncio.to_thread(
                _compress_image_base64, img, max_bytes=per_image_limit
            )
            content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": img_data,
                },
            })

        content.append({
            "type": "text",
            "text": _build_analysis_prompt(room_name, len(images), existing_items),
        })

        # No `temperature`: anthropic>=1.15 dropped it from messages.create
        # and raises TypeError before any request is sent.
        msg = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=MAX_ANALYSIS_TOKENS,
            tools=[ANALYSIS_TOOL],
            tool_choice={"type": "tool", "name": "report_room_contents"},
            messages=[{"role": "user", "content": content}],
        )

        # Release large base64 image data immediately after the API call
        del content

        result = _extract_tool_result(msg)
        del msg

    if result and result.get("items") and _TAXONOMY_AVAILABLE and normalize_items_list is not None:
        # Deterministic, no API cost
        normalize_items_list(result["items"])

    return result


def _choice(value, allowed) -> Optional[str]:
    return value if value in allowed else None


def _review_of(item_data: dict, item: DetectedContentItem) -> tuple:
    """What the estimator should decide about an item, and why.

    The AI's own doubts, plus what the checks here can see: a low confidence that
    it's there, a loose taxonomy match, an answer missing, or a size and weight
    that don't go together.
    """
    taxonomy_review = item_data.get("_taxonomy_review") or []
    fields = [f for f in item_data.get("uncertain") or [] if f in REVIEW_FIELDS] + taxonomy_review
    notes = []
    if item_data.get("uncertainty_note"):
        notes.append(item_data["uncertainty_note"].strip())

    confidence = item_data.get("item_confidence")
    if confidence is not None and confidence < SURE_ITEM_CONFIDENCE:
        fields.append("presence")

    if "name" in taxonomy_review and item_data.get("_original_name"):
        notes.append(f'The AI called this "{item_data["_original_name"]}".')
    if "fragile" in taxonomy_review:
        notes.append("Items like this usually aren't fragile, but this one looked it, so it's marked fragile until you say.")

    if item.size is None:
        fields.append("size")
    if item.weight is None:
        fields.append("weight")
    if (item.size == "small" and item.weight in ("heavy", "very_heavy")) or (
        item.size == "xlarge" and item.weight == "light"
    ):
        fields.append("weight")
        notes.append("That size and weight don't usually go together.")

    return list(dict.fromkeys(fields)), " ".join(notes) or None


def _build_room_analysis_response(
    result: dict,
    room_name: str,
) -> RoomAnalysisResponse:
    """Convert raw Claude result dict into a RoomAnalysisResponse."""
    items: List[DetectedContentItem] = []
    total_labor = 0.0
    fragile_count = 0
    high_value_count = 0
    field_notes: List[str] = []

    for item_data in result.get("items", []):
        item_conf = item_data.get("item_confidence")
        if item_conf is not None and item_conf < MIN_ITEM_CONFIDENCE:
            continue

        qty = max(1, int(item_data.get("quantity") or 1))
        is_frag = item_data.get("is_fragile", False)
        is_hv = item_data.get("is_high_value", False)
        instructions = item_data.get("special_instructions")

        if instructions and any(
            kw in instructions.upper()
            for kw in ["2-MAN", "MOISTURE", "PHOTOGRAPH", "HAZMAT", "VERIFY"]
        ):
            field_notes.append(
                f"{item_data.get('name', 'Unknown')}: {instructions}"
            )

        item = DetectedContentItem(
            name=item_data.get("name", "Unknown"),
            category=item_data.get("category", "Other"),
            quantity=qty,
            is_high_value=is_hv,
            estimated_value=item_data.get("estimated_value"),
            is_fragile=is_frag,
            needs_disassembly=item_data.get("needs_disassembly", False),
            size=_choice(item_data.get("size"), SIZES),
            weight=_choice(item_data.get("weight"), WEIGHTS),
            special_instructions=instructions,
            match_confidence=item_data.get("_match_confidence"),
        )
        item.uncertain_fields, item.review_note = _review_of(item_data, item)
        plan = apply_plan(item)
        items.append(item)

        # An item that may not be there isn't priced, so it doesn't count yet
        if "presence" not in item.uncertain_fields:
            total_labor += plan.total_hours
            if is_frag:
                fragile_count += qty
            if is_hv:
                high_value_count += qty

    # What needs a decision comes first, in the order the AI found it
    items.sort(key=lambda i: not i.uncertain_fields)

    return RoomAnalysisResponse(
        room_name=room_name,
        items=items,
        density=result.get("density", "normal"),
        room_size=result.get("room_size", "large"),
        confidence_score=result.get("confidence", 0.7),
        total_labor_hours=round(total_labor, 2),
        fragile_count=fragile_count,
        high_value_count=high_value_count,
        field_notes=field_notes[:10],
    )


# ============================================
# PUBLIC SERVICE FUNCTIONS
# ============================================

async def analyze_room_photos(
    room_name: str,
    images: List[str],
    existing_items: Optional[List[ExistingItem]] = None,
    max_images: int = MAX_IMAGES_PER_ROOM,
    dedup_threshold: float = 0.95,
) -> RoomAnalysisResponse:
    """Analyze room photos and return an itemized content list.

    Sends all photos in a single Claude API call so the model can
    de-duplicate items seen from multiple angles.

    Args:
        room_name: Human-readable label for the room (e.g. "Master Bedroom").
        images: List of base64-encoded image strings (data URL or raw base64).
        existing_items: Previously inventoried items to skip in this call.
        max_images: Hard cap on images sent to Claude after deduplication.
        dedup_threshold: Cosine-similarity threshold (0-1) for near-duplicate
            detection. Higher = more permissive (fewer dropped images).

    Returns:
        RoomAnalysisResponse with detected items, density, room_size, and
        aggregate statistics.

    Raises:
        HTTPException(400): No images supplied.
        HTTPException(502): Claude API call returned no usable result.
        HTTPException(503): anthropic package not installed or API key missing.
    """
    if not images:
        raise HTTPException(status_code=400, detail="No images provided")

    _require_vision_dependencies()

    # Decodes every image with PIL — run off the event loop
    deduplicated = await asyncio.to_thread(
        _select_diverse_images,
        images,
        max_images=max_images,
        threshold=dedup_threshold,
    )

    result = await _analyze_room_with_claude(
        images=deduplicated,
        room_name=room_name,
        existing_items=existing_items,
    )

    if not result:
        raise HTTPException(
            status_code=502,
            detail=(
                "Photo analysis failed. "
                "Please try again or verify your ANTHROPIC_API_KEY."
            ),
        )

    return _build_room_analysis_response(result, room_name)


def build_master_content_list(
    rooms: List[MasterContentRoom],
) -> MasterContentResponse:
    """Aggregate analyzed items across all rooms into a master content list.

    Items with the same name (case-insensitive) are merged: quantities are
    summed, room lists are de-duplicated, and flags are unioned.

    Args:
        rooms: List of MasterContentRoom objects, each carrying a room_name
            and a list of item dicts (as returned by analyze_room_photos).

    Returns:
        MasterContentResponse sorted by high-value flag descending then
        total quantity descending.
    """
    item_map: dict = defaultdict(lambda: {
        "name": "",
        "category": "",
        "total_quantity": 0,
        "rooms": [],
        "is_high_value": False,
        "is_fragile": False,
        "estimator_flags": set(),
        "total_labor_hours": 0.0,
    })

    for room in rooms:
        for item in room.items:
            name = item.get("name", "Unknown")
            key = name.lower().strip()
            entry = item_map[key]
            entry["name"] = name
            entry["category"] = item.get("category", "")
            entry["total_quantity"] += item.get("quantity", 1)
            if room.room_name not in entry["rooms"]:
                entry["rooms"].append(room.room_name)
            if item.get("is_high_value"):
                entry["is_high_value"] = True
            if item.get("is_fragile"):
                entry["is_fragile"] = True
            for flag in item.get("estimator_flags") or []:
                entry["estimator_flags"].add(flag)
            _bh = item.get("base_labor_hours")
            _puh = item.get("per_unit_labor_hours")
            _qty = item.get("quantity", 1)
            if _bh is not None and _puh is not None:
                entry["total_labor_hours"] += _bh + (_puh * _qty)
            else:
                # Legacy: already total for all units
                entry["total_labor_hours"] += (
                    item.get("estimated_labor_hours") or 0.0
                )

    items: List[MasterContentItem] = []
    flag_summary: dict = defaultdict(int)
    total_labor = 0.0
    hv_count = 0
    frag_count = 0

    for entry in item_map.values():
        flags = list(entry["estimator_flags"])
        for f in flags:
            flag_summary[f] += entry["total_quantity"]
        total_labor += entry["total_labor_hours"]
        if entry["is_high_value"]:
            hv_count += entry["total_quantity"]
        if entry["is_fragile"]:
            frag_count += entry["total_quantity"]
        items.append(MasterContentItem(
            name=entry["name"],
            category=entry["category"],
            total_quantity=entry["total_quantity"],
            rooms=entry["rooms"],
            is_high_value=entry["is_high_value"],
            is_fragile=entry["is_fragile"],
            estimator_flags=flags,
            total_labor_hours=round(entry["total_labor_hours"], 2),
        ))

    items.sort(key=lambda x: (-int(x.is_high_value), -x.total_quantity))

    return MasterContentResponse(
        items=items,
        total_items=sum(i.total_quantity for i in items),
        total_labor_hours=round(total_labor, 2),
        high_value_count=hv_count,
        fragile_count=frag_count,
        flag_summary=dict(flag_summary),
    )


# ============================================
# BATCH ANALYSIS HELPER (with retry)
# ============================================

async def analyze_room_with_retry(
    room_name: str,
    images: List[str],
    existing_items: Optional[List[ExistingItem]] = None,
    max_retries: int = 3,
    base_delay: float = 2.0,
) -> tuple:
    """Wrap analyze_room_photos with retry on rate-limit errors.

    Returns:
        (RoomAnalysisResponse, None, None) on success
        (None, error_code, error_message) on terminal failure
    """
    _require_vision_dependencies()

    if not images:
        return None, "IMAGE_ERROR", "No images provided"

    deduplicated = await asyncio.to_thread(_select_diverse_images, images)
    if not deduplicated:
        return None, "IMAGE_ERROR", "No valid images after filtering"

    last_code = "INTERNAL_ERROR"
    last_msg = "Unknown error"

    for attempt in range(max_retries):
        try:
            result = await _analyze_room_with_claude(
                images=deduplicated,
                room_name=room_name,
                existing_items=existing_items,
            )
            if result is None:
                return (
                    None,
                    "PARSE_ERROR",
                    "Claude returned no usable result",
                )
            resp = _build_room_analysis_response(
                result, room_name,
            )
            return resp, None, None

        except Exception as exc:
            exc_str = str(exc).lower()
            is_rate = (
                "rate_limit" in exc_str
                or "overloaded" in exc_str
                or "529" in str(exc)
                or "429" in str(exc)
            )
            if is_rate and attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt)
                last_code = "RATE_LIMITED"
                last_msg = str(exc)
                await asyncio.sleep(delay)
                continue

            last_code = (
                "RATE_LIMITED" if is_rate
                else "INTERNAL_ERROR"
            )
            last_msg = str(exc)
            break

    return None, last_code, last_msg
