"""
ScopeIt - Packing Tool Vision Service

Provides Claude Vision API integration for photo-based room content analysis.
Ported from moving_estimate standalone application.

Two public service functions:
    analyze_room_photos(room_name, images, existing_items, settings)
        -> RoomAnalysisResponse

    build_master_content_list(rooms)
        -> MasterContentResponse

Both rely on a two-pass Claude API strategy:
    Pass 1 (vision + tool use): Identify every packable item with constrained
        category enums and typed fields. Normalize names via taxonomy.
    Pass 2 (text + tool use): Enrich items with packing method, materials
        (constrained to valid keys), labor estimates, and flags.

Graceful degradation: if anthropic is not installed or ANTHROPIC_API_KEY is
not set, both public functions raise HTTPException(503) with a clear message.
"""

from __future__ import annotations

import base64
import io
import json
from collections import defaultdict
from typing import List, Optional

from fastapi import HTTPException

from app.core.config import settings
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


# ============================================
# PASS 1 TOOL: Item Identification (Vision)
# ============================================

ITEM_CATEGORIES = [
    "Furniture", "Electronics", "Books", "Kitchenware",
    "Clothing", "Fragile", "Artwork", "Collectibles",
    "Appliances", "Tools", "Sports", "Other",
]

DENSITY_VALUES = ["light", "normal", "dense", "heavy"]
ROOM_SIZE_VALUES = ["small", "large", "xlarge"]

MATERIAL_KEYS = [
    "wardrobe_box", "wardrobe_box_small", "wardrobe_box_large",
    "small_box", "medium_box", "large_box",
    "dish_pack_box", "book_box", "tv_box", "mirror_box", "lamp_box",
    "bubble_wrap_12", "bubble_wrap_24", "packing_paper",
    "moving_blanket", "furniture_pad",
    "stretch_wrap", "corner_protector",
    "mattress_bag",
    "chair_cover", "sofa_cover",
]

ESTIMATOR_FLAGS = [
    "HEAVY", "HIGH_VALUE", "FRAGILE", "CHECK_MOISTURE",
    "LIQUID_ITEMS", "DOCUMENTS", "VERIFY_CONTENTS", "DISASSEMBLY",
]

PASS1_TOOL = {
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
                    "required": ["name", "category", "quantity", "is_high_value", "is_fragile"],
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
# PASS 2 TOOL: Packing Enrichment (Text-only)
# ============================================

PASS2_TOOL = {
    "name": "enrich_packing_details",
    "description": (
        "Add packing details (method, materials, labor, instructions) "
        "to each previously identified item. Return the complete enriched list."
    ),
    "input_schema": {
        "type": "object",
        "required": ["items"],
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": [
                        "name", "category", "quantity",
                        "is_high_value", "is_fragile",
                        "needs_disassembly", "packing_method",
                        "required_materials",
                        "base_labor_hours", "per_unit_labor_hours",
                    ],
                    "properties": {
                        "name": {"type": "string"},
                        "category": {
                            "type": "string",
                            "enum": ITEM_CATEGORIES,
                        },
                        "quantity": {"type": "integer", "minimum": 1},
                        "is_high_value": {"type": "boolean"},
                        "estimated_value": {"type": ["string", "null"]},
                        "is_fragile": {"type": "boolean"},
                        "needs_disassembly": {
                            "type": "boolean",
                            "description": "True only if disassembly is required for transport",
                        },
                        "packing_method": {
                            "type": "string",
                            "description": (
                                "Step-by-step packing instruction. Be specific. "
                                "E.g. 'Empty all drawers; wrap body in moving blanket; "
                                "tape drawers shut with painter's tape; pad corners'"
                            ),
                        },
                        "required_materials": {
                            "type": "array",
                            "items": {
                                "type": "string",
                                "enum": MATERIAL_KEYS,
                            },
                            "description": (
                                "Materials needed. REPEAT a key to indicate quantity: "
                                "['sofa_cover','moving_blanket','moving_blanket','stretch_wrap'] "
                                "means 1 sofa cover + 2 blankets + 1 stretch wrap. "
                                "Scale with item size — large furniture needs more blankets."
                            ),
                        },
                        "base_labor_hours": {
                            "type": "number",
                            "minimum": 0.0,
                            "maximum": 1.0,
                            "description": (
                                "Fixed SETUP time (hours) for ONE person, "
                                "independent of quantity. "
                                "Includes: preparing workspace, "
                                "gathering materials, setting up station. "
                                "Single furniture: 0.05-0.15h. "
                                "Batch items (books, clothing): 0.15-0.30h. "
                                "Large appliance: 0.15-0.25h. "
                                "Small single item: 0.02-0.05h."
                            ),
                        },
                        "per_unit_labor_hours": {
                            "type": "number",
                            "minimum": 0.0,
                            "maximum": 2.0,
                            "description": (
                                "MARGINAL packing time per single unit "
                                "for ONE person. "
                                "total = base_labor_hours + "
                                "(per_unit_labor_hours * quantity). "
                                "Book (batch boxing): 0.01-0.02h/book. "
                                "Clothing (batch folding): 0.005-0.015h/pc. "
                                "Dish/glass (wrap each): 0.03-0.05h/pc. "
                                "Photo frame: 0.04-0.06h/each. "
                                "Sectional section: 0.5-0.6h/section. "
                                "Dining chair: 0.2-0.35h/chair. "
                                "Single sofa (qty=1): 0.7-0.9h. "
                                "Large wardrobe (qty=1): 1.0-1.8h. "
                                "Small decor (qty=1): 0.05-0.15h."
                            ),
                        },
                        "special_instructions": {
                            "type": ["string", "null"],
                            "description": "Field notes. E.g. 'Heavy - 2-man lift', 'Keep cables with item'",
                        },
                        "estimator_flags": {
                            "type": "array",
                            "items": {
                                "type": "string",
                                "enum": ESTIMATOR_FLAGS,
                            },
                            "description": "Applicable flags for this item",
                        },
                    },
                },
            },
        },
    },
}


# ============================================
# PROMPT BUILDERS
# ============================================

def _build_pass1_tool_prompt(
    room_name: str,
    num_images: int,
    existing_items: Optional[List[ExistingItem]] = None,
) -> str:
    """Build the Pass 1 prompt for use with the report_room_contents tool."""
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

    return f"""You are a professional Content Pack-Out Estimator. Analyze the photo(s) and list every packable item.
{multi_note}{existing_note}
NOTE: The user labeled this room "{room_name}" but IGNORE that label when deciding what items exist. Only report what you ACTUALLY SEE in the image.

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

3. ONLY list items you can visually confirm. If an item is partially covered, list what you can SEE (e.g., a quilt covering something bed-shaped = list the quilt AND the bed). Do NOT guess or infer items based on room type or label.
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

Use the report_room_contents tool to submit your findings."""


def _build_pass2_tool_prompt(items_json: str) -> str:
    """Build the Pass 2 prompt for use with the enrich_packing_details tool."""
    return f"""You are a professional Content Pack-Out Estimator. Add packing details to these items:

{items_json}

For EACH item, determine:
- needs_disassembly: true only if disassembly is required for transport
- packing_method: step-by-step packing instruction (be specific)
- required_materials: list of material keys needed — REPEAT a key multiple times to indicate quantity needed
- base_labor_hours: fixed setup time (preparing materials, workspace) — does NOT scale with quantity
- per_unit_labor_hours: marginal packing time for EACH single unit
- special_instructions: field notes if needed (null otherwise)
- estimator_flags: applicable flags

CRITICAL — MATERIAL QUANTITY via REPETITION:
Include each material key once per unit needed. Examples:
- Standard sofa (1 piece): ["sofa_cover", "moving_blanket", "moving_blanket", "stretch_wrap"]
  → 1 sofa cover, 2 blankets, 1 stretch wrap
- 3-section sectional sofa (quantity=3, each section is one item):
  → each section gets: ["sofa_cover", "moving_blanket", "moving_blanket", "stretch_wrap"]
- Large armchair: ["chair_cover", "moving_blanket", "stretch_wrap"]
- Large 5-shelf bookcase (the shelf unit itself, books listed separately):
  ["moving_blanket", "moving_blanket", "stretch_wrap"]  → 2 blankets for a tall unit
- Small 2-shelf bookcase: ["moving_blanket", "stretch_wrap"]
- King/Queen bed frame (disassembly required): ["moving_blanket", "moving_blanket", "moving_blanket", "stretch_wrap"]
- Large 3-door wardrobe: ["moving_blanket", "moving_blanket", "moving_blanket", "stretch_wrap"]
- Dresser (4+ drawers): ["moving_blanket", "moving_blanket", "stretch_wrap"]
- TV / large monitor (32"+): ["tv_box", "bubble_wrap_12", "bubble_wrap_12"]
  IMPORTANT: tv_box is ONLY for actual TVs or monitors 32" and larger.
  Do NOT use tv_box for: gaming consoles, routers, small monitors, speakers, printers, or other electronics.
  For small/medium electronics use: ["medium_box", "bubble_wrap_12"] instead.
- Book collection (100 books): set quantity=100 in item, use ["book_box"] once — calculator divides by 15 books/box automatically
- Glass/dish items: ["dish_pack_box", "packing_paper", "packing_paper"]

LABOR MODEL — base_labor_hours + per_unit_labor_hours:
total = base_labor_hours + (per_unit_labor_hours × quantity)

base_labor_hours = fixed setup (preparing materials, workspace). Does NOT scale with quantity.
per_unit_labor_hours = marginal time to pack EACH unit.

| Item                     | base  | per_unit | qty | total  |
|--------------------------|-------|----------|-----|--------|
| Book collection          | 0.25  | 0.02    | 80  | 1.85h  |
| Clothing items           | 0.20  | 0.01    | 30  | 0.50h  |
| Dishes/glassware set     | 0.20  | 0.04    | 15  | 0.80h  |
| Photo frames             | 0.10  | 0.05    |  5  | 0.35h  |
| 3-section sectional      | 0.10  | 0.55    |  3  | 1.75h  |
| Single standard sofa     | 0.10  | 0.75    |  1  | 0.85h  |
| Dining chairs            | 0.10  | 0.30    |  6  | 1.90h  |
| Large wardrobe           | 0.20  | 1.50    |  1  | 1.70h  |
| King bed frame           | 0.15  | 1.00    |  1  | 1.15h  |
| Small lamp               | 0.02  | 0.10    |  1  | 0.12h  |
| Large appliance          | 0.20  | 0.90    |  1  | 1.10h  |
| Fragile glassware set    | 0.20  | 0.05    | 15  | 0.95h  |

KEY: BATCH items (books, clothing, small kitchenware) → LOW per_unit, HIGHER base.
     INDIVIDUAL items (furniture, each wrapped separately) → LOW base, HIGHER per_unit.

Keep all original fields (name, category, quantity, is_high_value, estimated_value, is_fragile) unchanged.

Use the enrich_packing_details tool to submit the enriched items."""


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
            img = _Image.open(io.BytesIO(img_bytes))
            thumb = img.resize((THUMB, THUMB), _Image.LANCZOS).convert("L")
            return list(thumb.getdata())
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


def _compress_image_base64(
    image_base64: str,
    max_bytes: int = MAX_IMAGE_BYTES,
) -> tuple[str, str]:
    """Compress a base64 image so the raw base64 string stays under max_bytes.

    Returns (media_type, base64_data) with the data URL prefix stripped.
    If the image is already small enough, returns it unchanged.
    Falls back gracefully if Pillow is not installed.
    """
    media_type = "image/jpeg"
    raw_b64 = image_base64

    if raw_b64.startswith("data:"):
        parts = raw_b64.split(",", 1)
        if len(parts) > 1:
            media_type = parts[0].split(":")[1].split(";")[0]
            raw_b64 = parts[1]

    if len(raw_b64) <= max_bytes:
        return media_type, raw_b64

    try:
        from PIL import Image

        img_bytes = base64.b64decode(raw_b64)
        img = Image.open(io.BytesIO(img_bytes))

        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")

        quality = 85
        max_dim = MAX_IMAGE_DIM

        while True:
            if max(img.size) > max_dim:
                img.thumbnail((max_dim, max_dim), Image.LANCZOS)

            buf = io.BytesIO()
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

    return media_type, raw_b64


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
    """Hybrid 2-pass room analysis using Claude tool use.

    Pass 1 (vision + tool use):
        Send images with the report_room_contents tool schema. Claude returns
        structured output with constrained category enums and typed fields.
        Item names are then normalized via the packing taxonomy.

    Pass 2 (text + tool use):
        Send the normalized item list with the enrich_packing_details tool.
        Claude returns packing method, materials (constrained to valid keys),
        labor estimates, and flags.

    Returns the merged result dict, or None on failure.
    """
    client = _anthropic_module.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    # ── Pass 1: Vision + Tool Use ──────────────────────────────────────────
    per_image_limit = MAX_IMAGE_BYTES // max(len(images), 1)
    per_image_limit = max(per_image_limit, 1_000_000)

    content = []
    for img in images:
        media_type, img_data = _compress_image_base64(img, max_bytes=per_image_limit)
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": img_data,
            },
        })

    pass1_prompt = _build_pass1_tool_prompt(room_name, len(images), existing_items)
    content.append({"type": "text", "text": pass1_prompt})

    pass1_msg = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=4096,
        temperature=0,
        tools=[PASS1_TOOL],
        tool_choice={"type": "tool", "name": "report_room_contents"},
        messages=[{"role": "user", "content": content}],
    )

    pass1_result = _extract_tool_result(pass1_msg)
    if not pass1_result or not pass1_result.get("items"):
        return pass1_result

    # ── Taxonomy Normalization (deterministic, no API cost) ────────────────
    if _TAXONOMY_AVAILABLE and normalize_items_list is not None:
        normalize_items_list(pass1_result["items"])

    # ── Pass 2: Text-only + Tool Use ───────────────────────────────────────
    # Compact JSON (no indent) saves ~15 % input tokens vs indent=2.
    items_json = json.dumps(pass1_result["items"])
    pass2_prompt = _build_pass2_tool_prompt(items_json)

    pass2_msg = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=4096,
        temperature=0,
        tools=[PASS2_TOOL],
        tool_choice={"type": "tool", "name": "enrich_packing_details"},
        messages=[{"role": "user", "content": pass2_prompt}],
    )

    pass2_result = _extract_tool_result(pass2_msg)

    # ── Merge: Pass 1 metadata + Pass 2 enriched items ────────────────────
    if pass2_result and pass2_result.get("items"):
        return {
            "items": pass2_result["items"],
            "density": pass1_result.get("density", "normal"),
            "room_size": pass1_result.get("room_size", "large"),
            "confidence": pass1_result.get("confidence", 0.7),
        }

    # Pass 2 failed — return Pass 1 items (already normalized, just missing
    # packing details).
    return pass1_result


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
        qty = item_data.get("quantity", 1)

        # New split model: base + per_unit * qty
        base_h = item_data.get("base_labor_hours")
        per_unit_h = item_data.get("per_unit_labor_hours")
        legacy_labor = item_data.get("estimated_labor_hours")

        if base_h is not None and per_unit_h is not None:
            computed_total = base_h + (per_unit_h * qty)
            total_labor += computed_total
        elif legacy_labor is not None:
            computed_total = float(legacy_labor)
            # Legacy: already total, do NOT multiply by qty
            total_labor += computed_total
        else:
            computed_total = None

        is_frag = item_data.get("is_fragile", False)
        is_hv = item_data.get("is_high_value", False)

        if is_frag:
            fragile_count += qty
        if is_hv:
            high_value_count += qty

        flags = item_data.get("estimator_flags") or []
        instructions = item_data.get("special_instructions")

        if instructions and any(
            kw in instructions.upper()
            for kw in ["2-MAN", "MOISTURE", "PHOTOGRAPH", "HAZMAT", "VERIFY"]
        ):
            field_notes.append(
                f"{item_data.get('name', 'Unknown')}: {instructions}"
            )

        items.append(DetectedContentItem(
            name=item_data.get("name", "Unknown"),
            category=item_data.get("category", "Other"),
            quantity=qty,
            is_high_value=is_hv,
            estimated_value=item_data.get("estimated_value"),
            is_fragile=is_frag,
            needs_disassembly=item_data.get("needs_disassembly", False),
            packing_method=item_data.get("packing_method"),
            required_materials=item_data.get("required_materials"),
            base_labor_hours=(
                float(base_h) if base_h is not None else None
            ),
            per_unit_labor_hours=(
                float(per_unit_h) if per_unit_h is not None else None
            ),
            estimated_labor_hours=computed_total,
            special_instructions=instructions,
            estimator_flags=flags if flags else None,
        ))

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

    deduplicated = _select_diverse_images(
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
    import asyncio

    _require_vision_dependencies()

    if not images:
        return None, "IMAGE_ERROR", "No images provided"

    deduplicated = _select_diverse_images(images)
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
