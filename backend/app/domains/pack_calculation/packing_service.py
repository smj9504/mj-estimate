"""
Packing Estimate Calculator Service

Core calculation logic for pack-out estimates.
Integrated from packing_tool_export.
"""

from typing import Dict, List, Tuple, Any
from app.domains.pack_calculation.packing_schemas import (
    RoomInput, QuickEstimateRequest, EstimateResponse,
    RoomsEstimateRequest, DetectedContentItem,
    RoomItemSummary, StagingType, SupplementItem,
)
from sqlalchemy.orm import Session
from app.domains.pack_calculation.models import PackingPrice
from app.domains.pack_calculation.presets import ROOM_PRESETS
from app.domains.pack_calculation.seed_prices import (
    get_default_prices_dict,
)
import math


# ============================================
# CONSTANTS
# ============================================

DENSITY_MULTIPLIERS = {
    "light": 0.7,
    "normal": 1.0,
    "dense": 1.3,
    "heavy": 1.6,
    "extreme": 2.5,   # Hoarding / absolute maximum
}

FLOOR_MULTIPLIERS = {
    "basement": 1.1,
    "1st": 1.0,
    "2nd": 1.15,
    "3rd": 1.25,
    "4th+": 1.40,     # 3+ stair flights — eastern US brownstones/walkups
}

# Regional labor cost multipliers (applied to labor sections only, not materials/storage)
REGION_MULTIPLIERS = {
    "mid_atlantic": 1.00,  # Baseline — Northern Virginia / DC metro (price calibration origin)
    "northeast":    1.15,  # +15% — NY/NJ/MA/CT metro premium over NOVA
    "west":         1.05,  # +5%  — CA/WA/OR (similar to NOVA, slightly higher in SF/Seattle)
    "midwest":      0.90,  # -10% — IL/OH/MI/WI: lower COL than DC metro
    "southwest":    0.85,  # -15% — TX/AZ/NV: competitive labor market
    "southeast":    0.80,  # -20% — FL/GA/NC/SC/TN: lowest union density, lowest COL
}

# Contamination multipliers — Category per IICRC S500 standard
# Applied per-room to both labor and item count
CONTAMINATION_MULTIPLIERS = {
    "clean": 1.0,          # Category 1 — dry / no contamination
    "gray_water": 1.4,     # Category 2 — washing machine, dishwasher, toilet overflow
    "black_water": 1.8,    # Category 3 — sewage, flood, fire suppression
}

# Special items: fixed-cost line items (not affected by density/floor/region)
# 2026-08: +5% (specialty-tier increase, see seed_prices.py header for rationale)
SPECIAL_ITEM_COSTS = {
    "piano":      {"name": "Piano — Specialty Handling & Crating",       "unit": "EA", "price": 472.50},
    "pool_table": {"name": "Pool Table — Disassembly, Felt Wrap & Crate", "unit": "EA", "price": 404.25},
    "gun_safe":   {"name": "Gun Safe — Crane/Dolly Service",             "unit": "EA", "price": 288.75},
}

SIZE_TO_PRICE_CODE = {
    "small": "2833",
    "large": "2834",
    "xlarge": "2835",
}

# ============================================
# DEFAULT PRICES FALLBACK TABLE
# Used when DB prices are not seeded — ensures calculations always
# produce meaningful results independent of database state.
# 2026-08: kept in sync with seed_prices.DEFAULT_PACKING_PRICES
# (same category-tiered increase: labor/room +3%, box/protective/
# specialty +5%, transport +4%, storage +1%, debris +2%).
# ============================================
DEFAULT_PRICES = {
    # Labor
    "2825": {"price": 59.03, "name": "Pack-Out Labor", "unit": "HR"},
    "2826": {"price": 53.75, "name": "Pack-Back Labor", "unit": "HR"},
    "2911": {"price": 89.75, "name": "Supervisor / Fragile Specialist", "unit": "HR"},
    "2912": {"price": 127.74, "name": "Specialty Item Handler", "unit": "HR"},
    # Transport
    "2932": {"price": 179.25, "name": "Transport - Small Van", "unit": "EA"},
    "2933": {"price": 186.42, "name": "Transport - Medium Van", "unit": "EA"},
    "2934": {"price": 205.25, "name": "Transport - Large Van", "unit": "EA"},
    # Storage
    "2840": {"price": 2.20, "name": "Storage (per SF/month)", "unit": "SF"},
    "2841": {"price": 42.42, "name": "Storage Setup Fee", "unit": "EA"},
    # Room-size base rates (used by calculate_room_base via SIZE_TO_PRICE_CODE)
    "2833": {"price": 190.55, "name": "Room Rate - Small", "unit": "EA"},
    "2834": {"price": 293.55, "name": "Room Rate - Standard", "unit": "EA"},
    "2835": {"price": 427.45, "name": "Room Rate - Large", "unit": "EA"},
    # Materials - Boxes
    # Code assignments aligned with MATERIAL_CODES mapping.
    "3026": {"price": 5.06, "name": "Small Box (1.5 cu ft)", "unit": "EA"},
    "3025": {"price": 6.26, "name": "Medium Box (3.0 cu ft)", "unit": "EA"},
    "3027": {"price": 7.50, "name": "Large Box (4.5 cu ft)", "unit": "EA"},
    "3028": {"price": 9.38, "name": "XL Box (6.0 cu ft)", "unit": "EA"},
    "3029": {"price": 5.06, "name": "Book Box (1.5 cu ft)", "unit": "EA"},
    "3030": {"price": 10.12, "name": "Dish Pack Box", "unit": "EA"},
    "3031": {"price": 5.63, "name": "Lamp Box", "unit": "EA"},
    "3033": {"price": 10.12, "name": "Mirror/Picture Box", "unit": "EA"},
    "3039": {"price": 13.50, "name": "Wardrobe Box", "unit": "EA"},
    "3032": {"price": 3.75, "name": "File Box", "unit": "EA"},
    # Materials - Protective
    "2915": {"price": 15.00, "name": "Moving Blanket", "unit": "EA"},
    "3023": {"price": 9.38, "name": "Bubble Wrap Roll 12in", "unit": "EA"},
    "3018": {"price": 13.13, "name": "Bubble Wrap Roll 24in", "unit": "EA"},
    "3089": {"price": 33.75, "name": "Packing Paper (50-lb bundle)", "unit": "EA"},
    "3035": {"price": 4.68, "name": "Packing Tape Roll", "unit": "EA"},
    "2936": {"price": 9.38, "name": "Stretch/Shrink Wrap Roll", "unit": "EA"},
    "2916": {"price": 9.00, "name": "Furniture Pad", "unit": "EA"},
    "3022": {"price": 2.81, "name": "Corner Protector Set", "unit": "EA"},
    "2917": {"price": 5.63, "name": "Chair Cover", "unit": "EA"},
    "2918": {"price": 9.38, "name": "Sofa Cover", "unit": "EA"},
    "3041": {"price": 1.88, "name": "Foam Sheet", "unit": "EA"},
    "3043": {"price": 3.37, "name": "Dust Cover", "unit": "EA"},
    # Materials - Specialty
    "3050": {"price": 4.68, "name": "Anti-Static Wrap", "unit": "EA"},
    "3051": {"price": 5.63, "name": "Acid-Free Tissue", "unit": "EA"},
    "3052": {"price": 18.75, "name": "Wine Cell Box (12-cell)", "unit": "EA"},
    "3053": {"price": 9.38, "name": "Electronics Box", "unit": "EA"},
    "3054": {"price": 13.13, "name": "TV Box", "unit": "EA"},
    "3055": {"price": 3.75, "name": "Lamp Box", "unit": "EA"},
    "3056": {"price": 5.63, "name": "Rug Wrap", "unit": "EA"},
    "3057": {"price": 7.50, "name": "Piano Board", "unit": "EA"},
    "3058": {"price": 0.75, "name": "Marker/Label Set", "unit": "EA"},
    "3059": {"price": 2.25, "name": "Hazmat Label", "unit": "EA"},
    "3060": {"price": 16.87, "name": "Instrument Case Wrap", "unit": "EA"},
    "3061": {"price": 1.50, "name": "Silica Gel Pack", "unit": "EA"},
    "3062": {"price": 7.50, "name": "Gun Sleeve", "unit": "EA"},
    "3063": {"price": 2.63, "name": "Tool Roll", "unit": "EA"},
    "3064": {"price": 3.75, "name": "Bike Box/Bag", "unit": "EA"},
    "3065": {"price": 7.50, "name": "Plant Pot Wrap", "unit": "EA"},
    # Debris / Cleaning
    "3080": {"price": 255.00, "name": "Debris Hauling", "unit": "EA"},
    "3081": {"price": 45.90, "name": "Cleaning Fee", "unit": "HR"},
    # Materials - Additional size variants and mattress bags
    "3039S": {"price": 7.50, "name": "Wardrobe Box - Small", "unit": "EA"},
    "3039L": {"price": 11.25, "name": "Wardrobe Box - Large", "unit": "EA"},
    "3899": {"price": 15.00, "name": "TV Box", "unit": "EA"},
    "3876": {"price": 9.20, "name": "Mattress Bag - Twin", "unit": "EA"},
    "3905": {"price": 11.03, "name": "Mattress Bag - Full", "unit": "EA"},
    "3877": {"price": 12.88, "name": "Mattress Bag - Queen", "unit": "EA"},
    "3878": {"price": 14.72, "name": "Mattress Bag - King", "unit": "EA"},
}

# Content hints -> material mapping
# Format: {material_key: factor_per_item}
# SF of storage space per item by category
# Based on industry averages for packed/crated household goods
SF_PER_ITEM = {
    "Furniture": 12.0,       # Sofas, tables, dressers — bulky
    "Electronics": 4.0,      # TVs, monitors, gaming systems
    "Books": 0.5,            # Dense, small footprint per item
    "Kitchenware": 1.0,      # Dishes, pots boxed up
    "Clothing": 0.4,         # Wardrobe boxes / medium boxes
    "Fragile": 2.0,          # Extra padding = more volume
    "Artwork": 3.0,          # Flat but needs spacing
    "Collectibles": 1.5,     # Small but padded
    "Appliances": 10.0,      # Washers, fridges, microwaves
    "Tools": 1.5,            # Boxed tools
    "Sports": 4.0,           # Bikes, gear bags
    "Other": 1.5,
}

# SF per room size for hint-based (quick) estimates
# Values reflect stacked storage (items packed floor-to-ceiling ~7 ft),
# not flat floor area. Industry rule: 3BR house fits ~150-200 SF unit.
SF_PER_ROOM_SIZE = {
    "small": 8,     # bathroom, closet → ~5×5 portion of unit
    "large": 25,    # standard bedroom, kitchen → ~quarter of 10×10
    "xlarge": 45,   # master, basement, garage → ~half of 10×10
}

# Room-size-based material volume scale (replaces item count for material calculations).
# Represents relative content volume per room size — density multiplier is applied on top.
# Calibrated to match historical material quantities without depending on preset.base_items.
MAT_SCALE_PER_SIZE = {
    "small": 30,    # bathroom, closet
    "large": 80,    # standard bedroom, living room, kitchen
    "xlarge": 120,  # master bedroom, basement, garage
}

# Base materials per room — covers miscellaneous contents not captured
# by hints (drawer contents, shelf items, small decor, toiletries).
# Values are per-room BEFORE density multiplier.  Calibrated so a
# typical 3BR house (11 rooms) lands within industry norms when
# combined with hint-based materials.
BASE_ROOM_MATERIALS = {
    "small":  {"box_small": 1},
    "large":  {"box_small": 1, "box_medium": 2, "box_large": 1},
    "xlarge": {"box_small": 2, "box_medium": 2, "box_large": 1},
}

# Per-hint volume level multipliers: index 0=S, 1=M (default), 2=L, 3=XL
# Mirrors HINT_VOLUME_LEVELS.mult values in the frontend.
HINT_VOLUME_MULTS = [0.4, 1.0, 1.8, 3.0]

# Standard self-storage unit sizes (width × depth = SF)
# Industry-standard sizes used by Public Storage, Extra Space Storage,
# CubeSmart, StorageMart, Life Storage, etc.
STANDARD_UNIT_SIZES = [25, 50, 75, 100, 150, 200, 250, 300]
# 5×5=25  | 5×10=50  | 5×15=75  | 10×10=100
# 10×15=150 | 10×20=200 | 10×25=250 | 10×30=300

# Human-readable labels for each unit size (shown in section_details)
STORAGE_UNIT_LABELS = {
    25:  "5×5",
    50:  "5×10",
    75:  "5×15",
    100: "10×10",
    150: "10×15",
    200: "10×20",
    250: "10×25",
    300: "10×30",
}

# Storage setup fee by unit size (scales with unit size)
# Covers: inventory placement, shelving, padlock, first-access coordination
# Based on: base $85 for 10×10 (Xactimate reference), power-law scaling (^0.65)
# 2026-08: +1% (storage-tier increase — national self-storage rates are
# trending down, so increase kept minimal; see seed_prices.py header)
STORAGE_SETUP_BY_SIZE = {
    25:  42.42,   # 5×5   — ~0.5 hr setup
    50:  54.54,   # 5×10  — ~0.75 hr setup
    75:  68.68,   # 5×15  — ~0.75-1.0 hr setup
    100: 85.85,   # 10×10 — ~1.0-1.5 hr setup (Xactimate reference)
    150: 110.09,  # 10×15 — ~1.5-2.0 hr setup
    200: 132.31,  # 10×20 — ~2.0-2.5 hr setup
    250: 153.52,  # 10×25 — ~2.5-3.0 hr setup
    300: 173.72,  # 10×30 — ~3.0-4.0 hr setup
}


# Human-readable labels for content hints
HINT_LABELS = {
    "clothing_hanging":  "hanging garments",
    "clothing_folded":   "folded clothing",
    "bedding":           "bedding & linens",
    "books":             "books & media",
    "documents":         "documents & files",
    "electronics":       "electronics",
    "kitchenware":       "kitchenware & dishes",
    "fragile":           "fragile items",
    "artwork":           "artwork & frames",
    "collectibles":      "collectibles",
    "valuables":         "jewelry & valuables",
    "wine_collection":   "wine collection",
    "furniture":         "furniture",
    "rugs":              "rugs & carpets",
    "lamps_lighting":    "lamps & lighting",
    "appliances_small":  "small appliances",
    "appliances_large":  "large appliances",
    "toys":              "toys & games",
    "sports":            "sports equipment",
    "bicycles":          "bicycles & scooters",
    "tools":             "tools & hardware",
    "equipment_heavy":   "heavy equipment",
    "boxes_stored":      "stored boxes",
    "holiday_decor":     "holiday & seasonal decor",
    "instruments":       "musical instruments",
    "baby_items":        "baby & nursery items",
    "outdoor_furniture": "outdoor furniture",
    "plants":            "plants & pots",
    "chemicals":         "cleaning & chemicals",
}

# Labor multipliers for specialty content hints.
# Applied as max() across all hints in a room — NOT cumulative.
# Having fragile + artwork uses only the higher value (1.15), not 1.12 × 1.15.
# These are modest adjustments reflecting that specialty content is one category
# among many in a mixed room, not the entire room's contents.
# Plants and chemicals = 0.0 (non-packable: disposal/exclusion only).
HINT_LABOR_MULTIPLIERS = {
    "fragile":          1.12,  # +12%
    "artwork":          1.15,  # +15%
    "instruments":      1.15,  # +15%
    "valuables":        1.08,  # +8%
    "wine_collection":  1.12,  # +12%
    "lamps_lighting":   1.08,  # +8%
    "bicycles":         1.08,  # +8%
    "holiday_decor":    1.08,  # +8%
    "collectibles":     1.10,  # +10%
    "equipment_heavy":  1.08,  # +8%
    "plants":           0.0,   # excluded — not packable per insurance policy
    "chemicals":        0.0,   # excluded — hazmat disposal only (OSHA/EPA)
}

# Categories considered notable for description building
NOTABLE_CATEGORIES = {
    "Furniture", "Appliances", "Electronics", "Artwork",
}


def snap_to_storage_unit(raw_sf: float) -> int:
    """Snap raw SF to the nearest standard self-storage unit size.
    Always rounds UP to the next available unit. Returns 0 if no storage needed."""
    if raw_sf <= 0:
        return 0
    for size in STANDARD_UNIT_SIZES:
        if raw_sf <= size:
            return size
    return STANDARD_UNIT_SIZES[-1]  # cap at largest


def get_storage_setup_fee(unit_sf: int) -> float:
    """Get storage setup fee for a given unit size."""
    return STORAGE_SETUP_BY_SIZE.get(unit_sf, 85.85)


def build_storage_section_detail(
    storage_sf: int,
    sf_rate: float,
    storage_months: int,
    setup_fee: float,
    storage_cost: float,
) -> dict:
    """Build a section_detail dict for the Storage line item.

    Shows the unit dimensions, per-SF rate, and month breakdown so the
    adjuster can see exactly how the charge was computed.
    """
    unit_label = STORAGE_UNIT_LABELS.get(storage_sf, f"{storage_sf} SF")
    monthly_sf_cost = round(storage_sf * sf_rate, 2)
    lines = [
        {
            "name": f"Climate-Controlled Storage — {unit_label} unit ({storage_sf} SF)",
            "qty": storage_months,
            "unit": "MO",
            "rate": monthly_sf_cost,
            "detail": (
                f"{storage_sf} SF × ${sf_rate:.2f}/SF/mo = ${monthly_sf_cost:.2f}/mo"
            ),
            "amount": round(storage_sf * sf_rate * storage_months, 2),
        },
        {
            "name": "Storage Setup & Inventory Placement",
            "qty": 1,
            "unit": "EA",
            "rate": round(setup_fee, 2),
            "detail": (
                f"Shelving, padlock, item placement & first-access coordination  "
                f"({unit_label} unit)"
            ),
            "amount": round(setup_fee, 2),
        },
    ]
    return {"lines": lines}


# Unit-based hints: materials per single piece (mirrors frontend HINT_UNIT_MATERIALS)
# Used when hint_qty is provided — qty × per-unit materials (no volume scaling)
#
# Furniture items (sofa, bed, etc.) are truly per-piece: qty=1 = 1 physical item.
# Category hints (clothing, appliances) represent a "collection": qty=1 = one
# closet section / dresser load / set of appliances — per-unit values are calibrated
# to match the volume-based HINT_MATERIAL_MAP output for a standard "large" room
# (MAT_SCALE=80) so results are consistent regardless of calculation path.
UNIT_HINT_MATERIAL_MAP = {
    "sofa":          {"sofa_cover": 1, "blanket": 2, "shrink_wrap": 1},
    "loveseat":      {"sofa_cover": 1, "blanket": 1},
    "armchair":      {"chair_cover": 1, "blanket": 1},
    "bed_large":     {"blanket": 2, "shrink_wrap": 1, "furniture_pad": 1},
    "bed_small":     {"blanket": 1, "shrink_wrap": 1},
    "dresser":       {"blanket": 2, "shrink_wrap": 1, "furniture_pad": 1},
    "wardrobe":      {"blanket": 3, "shrink_wrap": 1, "furniture_pad": 2},
    "dining_table":  {"blanket": 2, "furniture_pad": 2},
    "dining_chair":  {"chair_cover": 1},
    "coffee_table":  {"blanket": 1, "furniture_pad": 1},
    "bookcase":      {"blanket": 1, "furniture_pad": 1},
    "desk":          {"blanket": 2, "furniture_pad": 1},
    "bicycles":      {"blanket": 1, "shrink_wrap": 1},
    "instruments":   {"blanket": 2, "bubble_12": 1},
    # Category hints — per-unit = one closet section / dresser / appliance set.
    # Values are calibrated for a "large" room (MAT_SCALE=80).
    # Room-size scaling is applied in calculate_materials for these hints.
    "clothing_hanging": {"box_wardrobe": 1},
    "clothing_folded":  {"box_medium": 1},
    "appliances_large": {"blanket": 2, "shrink_wrap": 1},
    "appliances_small": {"box_medium": 1, "bubble_12": 1},
}

HINT_MATERIAL_MAP = {
    # ── Clothing & Textiles ──────────────────────────────────────────────
    # Factors are per vol_scale unit. Large room scale=80, xlarge=120.
    # Target: bedroom → 2 wardrobe boxes, 2-3 medium boxes for clothes.
    "clothing_hanging":  {"box_wardrobe": 0.025},                         # 80×0.025=2 wardrobe boxes
    "clothing_folded":   {"box_medium": 0.03},                            # 80×0.03=2.4 → 3 medium boxes
    "bedding":           {"box_large": 0.025, "box_xlarge": 0.012},       # 80×0.025=2 large + 1 xlarge

    # ── Books & Media ────────────────────────────────────────────────────
    # Target: office → 4 book boxes, 1-2 small boxes
    "books":             {"box_book": 0.05, "box_small": 0.015},          # 80×0.05=4 book + 1-2 small
    "documents":         {"box_small": 0.03, "box_medium": 0.012},        # 80×0.03=2-3 small + 1 med

    # ── Electronics ──────────────────────────────────────────────────────
    # Most rooms have 1 TV at most; other electronics (consoles, routers) use medium boxes
    # Target: 0-1 TV box, 2 medium boxes, 1 bubble roll per room
    "electronics":       {"box_tv": 0.006, "box_medium": 0.025, "bubble_12": 0.008},

    # ── Kitchen ──────────────────────────────────────────────────────────
    # Target: 3-4 dish boxes, 2-3 medium, 1-2 bundles packing paper
    "kitchenware":       {"box_dish": 0.04, "box_medium": 0.025, "packing_paper": 0.006},
    # Fragile & Valuables
    "fragile":           {"box_dish": 0.04, "packing_paper": 0.008, "bubble_12": 0.004},
    "artwork":           {"box_mirror": 0.018, "corner_protector": 0.004, "bubble_24": 0.003},
    "collectibles":      {"box_small": 0.04, "bubble_12": 0.006, "packing_paper": 0.004},
    "valuables":         {"box_small": 0.015, "bubble_24": 0.008, "packing_paper": 0.006},
    "wine_collection":   {"box_small": 0.06, "bubble_12": 0.015, "packing_paper": 0.015},

    # ── Furniture ────────────────────────────────────────────────────────
    # Typical bedroom: bed frame(2 blankets) + dresser(1) + nightstands(0) = 2-3 blankets, 1 pad
    # Typical living: sofa(2) + coffee table(1) + TV stand(1) = 3-4 blankets, 1 pad
    # Target large(80): blanket=2-3, pad=1, chair_cover=0, sofa_cover=0, shrink=1
    # sofa/chair covers only meaningful at scale ≥120 (living rooms with multiple seating)
    "furniture":         {"blanket": 0.035, "shrink_wrap": 0.01, "furniture_pad": 0.012, "chair_cover": 0.004, "sofa_cover": 0.003},
    "rugs":              {"shrink_wrap": 0.012, "blanket": 0.008},
    "lamps_lighting":    {"box_lamp": 0.025, "box_medium": 0.012, "bubble_12": 0.008},

    # ── Appliances ───────────────────────────────────────────────────────
    "appliances_small":  {"box_medium": 0.03, "bubble_12": 0.004},
    "appliances_large":  {"blanket": 0.08, "shrink_wrap": 0.025},         # 80×0.08=6.4 → only for heavy appliance rooms

    # ── Recreation ───────────────────────────────────────────────────────
    "toys":              {"box_large": 0.03, "box_medium": 0.02},         # 80×0.03=2-3 large + 2 med
    "sports":            {"box_xlarge": 0.02, "blanket": 0.025},
    "bicycles":          {"blanket": 0.015, "shrink_wrap": 0.008},

    # ── Tools & Equipment ────────────────────────────────────────────────
    "tools":             {"box_small": 0.03, "blanket": 0.025},
    "equipment_heavy":   {"blanket": 0.08, "shrink_wrap": 0.02},

    # ── Storage ──────────────────────────────────────────────────────────
    "boxes_stored":      {"shrink_wrap": 0.008},
    "holiday_decor":     {"box_medium": 0.025, "box_large": 0.012, "packing_paper": 0.006, "bubble_12": 0.006},

    # ── Music & Arts ─────────────────────────────────────────────────────
    "instruments":       {"blanket": 0.06, "bubble_24": 0.012},

    # ── Specialty ────────────────────────────────────────────────────────
    "baby_items":        {"box_medium": 0.03, "box_large": 0.015, "blanket": 0.008},
    "outdoor_furniture": {"blanket": 0.04, "shrink_wrap": 0.012, "furniture_pad": 0.012},
    "plants":            {},  # not packable — excluded from insurance contents claims
    "chemicals":         {},  # hazmat — disposal only per OSHA/EPA; not transported
}

# Material code mapping
MATERIAL_CODES = {
    "box_small": "3026",
    "box_medium": "3025",
    "box_large": "3027",
    "box_xlarge": "3028",
    "box_book": "3029",
    "box_dish": "3030",
    "box_wardrobe": "3039",
    "box_wardrobe_small": "3039S",
    "box_wardrobe_large": "3039L",
    "box_mirror": "3033",
    "box_tv": "3899",
    "box_lamp": "3031",
    "mattress_twin": "3876",
    "mattress_full": "3905",
    "mattress_queen": "3877",
    "mattress_king": "3878",
    "blanket": "2915",
    "furniture_pad": "2916",
    "chair_cover": "2917",
    "sofa_cover": "2918",
    "bubble_12": "3023",
    "bubble_24": "3018",
    "packing_paper": "3089",
    "packing_tape": "3035",
    "shrink_wrap": "2936",
    "corner_protector": "3022",
}

# Human-readable descriptions for each material (shown in estimate detail)
MATERIAL_DETAIL = {
    "box_small": "Small/heavy items: books, cans, tools",
    "box_medium": "General packing: folded clothes, appliances, kitchenware",
    "box_large": "Bulky/light items: bedding, linens, toys",
    "box_xlarge": "Oversized light items: pillows, comforters, cushions",
    "box_book": "Dense items: hardcovers, binders, records",
    "box_dish": "Fragile dishware with cell dividers",
    "box_wardrobe": "Hanging garments transferred on-hanger",
    "box_wardrobe_small": "Short hanging garments (shirts, jackets)",
    "box_wardrobe_large": "Long hanging garments (dresses, coats)",
    "box_mirror": "Framed artwork, mirrors, glass panels",
    "box_tv": "Flat-screen TV with foam corners",
    "box_lamp": "Table/floor lamps with shade protection",
    "mattress_twin": "Mattress protection — Twin size",
    "mattress_full": "Mattress protection — Full size",
    "mattress_queen": "Mattress protection — Queen size",
    "mattress_king": "Mattress protection — King size",
    "blanket": "Furniture wrapping and surface protection",
    "furniture_pad": "Heavy-duty padding for large furniture",
    "chair_cover": "Fitted cover for dining/accent chairs",
    "sofa_cover": "Fitted cover for sofas and sectionals",
    "bubble_12": "Fragile item wrap: electronics, glassware, ceramics",
    "bubble_24": "Wide wrap for large fragile items, artwork",
    "packing_paper": "Void fill, wrapping, and interleaving",
    "packing_tape": "Box sealing and reinforcement",
    "shrink_wrap": "Securing blankets, bundling drawers and doors",
    "corner_protector": "Edge protection for furniture and frames",
}


# ============================================
# CALCULATOR CLASS
# ============================================

class EstimateCalculator:
    def __init__(self, db: Session, company_id=None):
        self.db = db
        self.company_id = company_id
        self._load_prices()
        self._load_presets()

    def _load_prices(self):
        """Load prices from PackingPrice table, falling back to defaults."""
        items = self.db.query(PackingPrice).filter(
            PackingPrice.is_active.is_(True),
        )
        if self.company_id:
            items = items.filter(
                PackingPrice.company_id == self.company_id
            )
        items = items.all()

        self.prices = {}
        for item in items:
            if item.code:
                self.prices[item.code] = type('Price', (), {
                    'price': float(item.unit_price),
                    'code': item.code,
                    'name': item.name,
                    'unit': item.unit,
                })()

        # Merge defaults for codes not in DB
        defaults = get_default_prices_dict()
        for code, info in defaults.items():
            if code not in self.prices:
                self.prices[code] = type('Price', (), {
                    'price': info['price'],
                    'code': code,
                    'name': info['name'],
                    'unit': info['unit'],
                })()

        # Create reverse lookup by material key
        self.price_by_key = {}
        for key, code in MATERIAL_CODES.items():
            if code in self.prices:
                self.price_by_key[key] = self.prices[code]

    def _load_presets(self):
        """Load room presets from constants."""
        self.presets = {}
        for key, data in ROOM_PRESETS.items():
            self.presets[key] = type('Preset', (), {
                'key': key,
                'name': data['name'],
                'category': data['category'],
                'size': data['size'],
                'base_items': data['base_items'],
                'default_hints': data['default_hints'],
                'mattress': data.get('mattress'),
            })()

    def get_price(self, code: str) -> float:
        """Get price by code, with fallback to DEFAULT_PRICES."""
        p = self.prices.get(code)
        if p:
            return p.price
        default = DEFAULT_PRICES.get(code)
        return default["price"] if default else 0

    # ============================================
    # CONDITIONAL SUPPLEMENTS
    # 2026-08: +3% (labor-tier increase — these are all additional
    # handling/staging time charges; see seed_prices.py header)
    # ============================================

    SUPPLEMENT_DEFINITIONS = [
        {
            "key": "hidden_damage",
            "name": "Unforeseen Conditions — Concealed Contamination",
            "description": "Per IICRC S500 §12.3 — additional handling for concealed water/mold damage",
            "flat_amount": 154.50,
            "trigger": "contamination",
        },
        {
            "key": "high_value_documentation",
            "name": "High-Value Contents Documentation",
            "description": "Serial number recording, appraisal photo, condition report — flat fee per job",
            "flat_amount": 87.55,
            "trigger": "high_value",
            "min_items": 3,
        },
        {
            "key": "difficult_access",
            "name": "Difficult Access Supplement",
            "description": "Narrow stairwell / no elevator — additional carry time",
            "flat_amount": 123.60,
            "trigger": "upper_floor",
        },
        {
            "key": "heavy_contents",
            "name": "Heavy Contents Supplement",
            "description": "Above-average contents volume requiring additional sort/stage time",
            "flat_amount": 97.85,
            "trigger": "heavy_density",
        },
    ]

    def evaluate_supplements(
        self,
        rooms,
        subtotal,
        overrides=None,
        context=None,
    ) -> List[SupplementItem]:
        """Evaluate all supplement conditions and return triggered items.

        Supplements use fixed amounts — not percentages or per-item rates —
        so they stay reasonable regardless of estimate size.
        Users can toggle each supplement and edit the amount in the frontend.
        """
        overrides = overrides or {}
        ctx = context or {}

        # Build context from rooms
        if "has_contamination" not in ctx:
            ctx["has_contamination"] = any(
                getattr(r, "contamination", "clean")
                not in ("clean", "Clean")
                for r in rooms
            )
        if "high_value_count" not in ctx:
            hv = 0
            for r in rooms:
                for item in getattr(r, "items", []):
                    if getattr(item, "is_high_value", False):
                        hv += 1
            ctx["high_value_count"] = hv
        if "has_upper_floor" not in ctx:
            upper = {"3rd", "4th+"}
            ctx["has_upper_floor"] = any(
                str(getattr(r, "floor", "1st")) in upper
                for r in rooms
            )
        if "has_heavy_density" not in ctx:
            heavy = {"heavy", "extreme"}
            ctx["has_heavy_density"] = any(
                str(getattr(r, "density", "normal")) in heavy
                for r in rooms
            )

        supplements = []

        for defn in self.SUPPLEMENT_DEFINITIONS:
            key = defn["key"]
            triggered = False

            if defn["trigger"] == "contamination":
                triggered = ctx["has_contamination"]
            elif defn["trigger"] == "high_value":
                triggered = (
                    ctx["high_value_count"]
                    >= defn.get("min_items", 3)
                )
            elif defn["trigger"] == "upper_floor":
                triggered = ctx["has_upper_floor"]
            elif defn["trigger"] == "heavy_density":
                triggered = ctx["has_heavy_density"]

            if not triggered:
                continue

            amount = defn.get("flat_amount", 0)
            enabled = overrides.get(key, True)
            supplements.append(SupplementItem(
                key=key,
                name=defn["name"],
                description=defn["description"],
                amount=round(amount, 2),
                triggered=True,
                enabled=enabled,
            ))

        return supplements

    def select_truck(self, storage_sf: int) -> tuple:
        """Select appropriate truck size based on storage SF.
        Returns (code, rate) tuple."""
        if storage_sf <= 50:
            # Small job: 14'-15' van
            code = "2932"
            fallback = 179.25
        elif storage_sf <= 150:
            # Medium job: 16'-20' van
            code = "2933"
            fallback = 186.42
        else:
            # Large job: 21'-27' van
            code = "2934"
            fallback = 205.25
        return code, self.get_price(code) or fallback

    def estimate_storage_sf_from_rooms(
        self, rooms: List[RoomInput]
    ) -> int:
        """Estimate required storage SF from room presets.
        Returns a standard storage unit size (25, 50, 100, etc.)."""
        total_sf = 0.0
        for room in rooms:
            preset = self.presets.get(room.preset)
            if not preset:
                continue
            density_mult = DENSITY_MULTIPLIERS.get(
                room.density.value, 1.0
            )
            base_sf = SF_PER_ROOM_SIZE.get(preset.size, 40)
            total_sf += base_sf * density_mult
        return snap_to_storage_unit(total_sf)

    def estimate_storage_sf_from_items(
        self, rooms: List[Any]
    ) -> int:
        """Estimate required storage SF from AI-detected rooms.

        Priority: preset_id → SF_PER_ROOM_SIZE (most accurate).
        Fallback: item count, with conservative thresholds and smaller SF values
        to avoid over-sizing the storage unit.

        AI detects items as grouped objects (e.g. "Plates" qty=20 = 1 dish-pack),
        so the raw item count inflates easily. Thresholds are raised accordingly.

        Returns a standard storage unit size (25, 50, 100, etc.).
        """
        # Conservative SF per room for item-based fallback
        # (smaller than quick-estimate values — AI grouping inflates item counts)
        ITEM_SF_MAP = {"small": 7, "large": 20, "xlarge": 35}

        total_sf = 0.0
        for room in rooms:
            # Prefer preset-based SF (most reliable)
            preset_id = getattr(room, 'preset_id', None)
            if preset_id and preset_id in self.presets:
                preset = self.presets[preset_id]
                density_mult = DENSITY_MULTIPLIERS.get(
                    getattr(room, 'density', 'normal'), 1.0
                )
                base_sf = SF_PER_ROOM_SIZE.get(preset.size, 30)
                total_sf += base_sf * density_mult
            else:
                # Fallback: item count with raised thresholds
                # (AI groups items, so 80 qty ≠ 80 individual pieces)
                item_count = sum(item.quantity for item in room.items)
                if item_count <= 50:
                    size = "small"
                elif item_count <= 120:
                    size = "large"
                else:
                    size = "xlarge"
                total_sf += ITEM_SF_MAP.get(size, 30)

        return snap_to_storage_unit(total_sf)

    def _build_room_summaries(
        self, rooms: List[Any]
    ) -> List[RoomItemSummary]:
        """Build room summaries from AI-detected items."""
        summaries = []
        for room in rooms:
            notable = []
            high_value = []
            categories = set()
            packing_notes = []

            for item in room.items:
                categories.add(item.category)
                if item.is_high_value:
                    high_value.append(item.name)
                    notable.append(item.name)
                elif item.category in NOTABLE_CATEGORIES:
                    notable.append(item.name)

                if (item.packing_method
                        and (item.is_high_value
                             or item.category in NOTABLE_CATEGORIES)):
                    packing_notes.append(
                        f"{item.name}: {item.packing_method}"
                    )

            summaries.append(RoomItemSummary(
                room_name=room.room_name,
                notable_items=notable[:8],
                categories_present=sorted(categories),
                high_value_items=high_value[:5],
                packing_notes=packing_notes[:5],
                item_count=sum(i.quantity for i in room.items),
            ))
        return summaries

    def _build_room_summaries_from_hints(
        self, rooms: List[RoomInput]
    ) -> List[RoomItemSummary]:
        """Build room summaries from preset hints (quick estimate)."""
        summaries = []
        for room in rooms:
            preset = self.presets.get(room.preset)
            if not preset:
                continue
            hints = room.hints or preset.default_hints or []
            cats = []
            for h in hints:
                h_str = h.value if hasattr(h, 'value') else str(h)
                cats.append(HINT_LABELS.get(h_str, h_str))
            density_mult = DENSITY_MULTIPLIERS.get(
                room.density.value, 1.0
            )
            summaries.append(RoomItemSummary(
                room_name=preset.name,
                notable_items=[],
                categories_present=cats,
                high_value_items=[],
                packing_notes=[],
                item_count=int(
                    preset.base_items * density_mult
                ),
            ))
        return summaries

    def calculate_room_base(self, room: RoomInput) -> Tuple[float, int]:
        """Calculate base price and item count for a room"""
        preset = self.presets.get(room.preset)
        if not preset:
            return 0, 0

        # Get room rate based on size
        rate_code = SIZE_TO_PRICE_CODE.get(preset.size, "2834")
        base_rate = self.get_price(rate_code)

        # Apply multipliers
        density_mult = DENSITY_MULTIPLIERS.get(room.density.value, 1.0)
        floor_mult = FLOOR_MULTIPLIERS.get(room.floor.value, 1.0)
        contamination_str = room.contamination.value if hasattr(room.contamination, 'value') else str(getattr(room, 'contamination', 'clean'))
        contamination_mult = CONTAMINATION_MULTIPLIERS.get(contamination_str, 1.0)

        # Hint-based labor multiplier: specialty content (fragile, artwork, instruments,
        # valuables, wine) reduces packing production from 4-5 boxes/hr to 2-3 boxes/hr.
        # Use max() across all hints — not cumulative — the dominant content type drives
        # the rate. Plants/chemicals = 0.0 flag (non-packable items excluded from labor).
        hints = room.hints or preset.default_hints or []
        hint_labor_mult = 1.0
        for hint in hints:
            hint_str = hint.value if hasattr(hint, 'value') else str(hint)
            mult = HINT_LABOR_MULTIPLIERS.get(hint_str, 1.0)
            if mult == 0.0:
                continue  # plants/chemicals don't suppress labor for the whole room
            hint_labor_mult = max(hint_labor_mult, mult)

        adjusted_price = base_rate * density_mult * floor_mult * contamination_mult * hint_labor_mult
        # Volume index for display only — room-size based, not item-count based
        vol_index = int(MAT_SCALE_PER_SIZE.get(preset.size, 80) * density_mult * contamination_mult)

        return adjusted_price, vol_index

    def calculate_materials(self, rooms: List[RoomInput]) -> Dict[str, int]:
        """Calculate required materials based on rooms and content hints.

        All continuous materials are accumulated as floats across all rooms and hints,
        then converted to integers once at the end — avoiding spurious per-room minimums
        from ceil() that cause over-counting on small rooms.
        Mattresses are integer items added directly (1 per applicable room).
        """
        mat_floats: Dict[str, float] = {}  # accumulate raw fractions across all rooms/hints
        mattresses: Dict[str, int] = {}    # integer items, not subject to float accumulation

        for room in rooms:
            preset = self.presets.get(room.preset)
            if not preset:
                continue

            density_mult = DENSITY_MULTIPLIERS.get(room.density.value, 1.0)
            # Base room-size volume scale (density applied per-hint below)
            base_vol_scale = MAT_SCALE_PER_SIZE.get(preset.size, 80) * density_mult

            # Add mattress if applicable (always 1 per room, not fraction-based)
            if preset.mattress:
                mat_key = f"mattress_{preset.mattress}"
                mattresses[mat_key] = mattresses.get(mat_key, 0) + 1

            # Accumulate hint-based materials as floats across all rooms
            hints = room.hints or preset.default_hints or []
            hint_volume = room.hint_volume if hasattr(room, 'hint_volume') and room.hint_volume else {}
            hint_qty = room.hint_qty if hasattr(room, 'hint_qty') and room.hint_qty else {}
            for hint in hints:
                hint_str = hint.value if hasattr(hint, 'value') else str(hint)
                # Unit-based hint: qty × per-piece materials (no volume scaling)
                if hint_str in UNIT_HINT_MATERIAL_MAP:
                    qty = hint_qty.get(hint_str, 1)
                    for mat_key, per_unit in UNIT_HINT_MATERIAL_MAP[hint_str].items():
                        mat_floats[mat_key] = mat_floats.get(mat_key, 0.0) + qty * per_unit
                    continue
                # Volume-based hint: vol_scale × factor
                vol_level_idx = hint_volume.get(hint_str, 1)
                hint_vol_mult = HINT_VOLUME_MULTS[vol_level_idx] if 0 <= vol_level_idx < len(HINT_VOLUME_MULTS) else 1.0
                vol_scale = base_vol_scale * hint_vol_mult
                hint_materials = HINT_MATERIAL_MAP.get(hint_str, {})
                for mat_key, factor in hint_materials.items():
                    mat_floats[mat_key] = mat_floats.get(mat_key, 0.0) + vol_scale * factor

        # Convert accumulated floats to integers (ceil once per material, not per room).
        # Skip materials below threshold — avoids inflating near-zero fractions to 1
        # (e.g. sofa_cover in a bedroom where there is no sofa).
        # Threshold 0.25 balances filtering noise vs including legitimate materials
        # for small rooms or single-room estimates.
        materials: Dict[str, int] = dict(mattresses)
        for mat_key, raw in mat_floats.items():
            if mat_key == "packing_paper":
                continue  # handled separately below (bundle conversion)
            if raw < 0.25:
                continue  # too small to warrant inclusion
            materials[mat_key] = materials.get(mat_key, 0) + math.ceil(raw)

        # Convert accumulated packing paper to bundles (50-lb bundle ≈ ~150 items worth)
        packing_paper_raw = mat_floats.get("packing_paper", 0.0)
        num_rooms = len(rooms)
        if packing_paper_raw > 0:
            materials["packing_paper"] = max(1, math.ceil(packing_paper_raw))
        elif materials and num_rooms > 0:
            # Other materials found — add a small default for void-fill / misc wrapping.
            materials["packing_paper"] = max(1, math.ceil(num_rooms / 3))

        return materials

    def calculate_material_cost(self, materials: Dict[str, int]) -> float:
        """Calculate total material cost"""
        total = 0
        for mat_key, qty in materials.items():
            code = MATERIAL_CODES.get(mat_key)
            if code:
                total += self.get_price(code) * qty
        return total

    def calculate_estimate(self, request: QuickEstimateRequest) -> EstimateResponse:
        """Main calculation method"""

        # Calculate room bases
        total_room_base = 0
        total_items = 0

        for room in request.rooms:
            room_price, items = self.calculate_room_base(room)
            total_room_base += room_price
            total_items += items

        # Crew efficiency with diminishing returns (industry standard: each extra person adds ~0.7-0.8x marginal efficiency)
        # Results: 2→1.0x, 3→1.42x, 4→1.77x, 5→2.05x, 6→2.26x
        def crew_efficiency(n: int) -> float:
            total = 1.0
            for i in range(1, n - 1):
                total += max(0.2, 1.0 - 0.15 * i)
            return total

        # Region labor premium (applied to labor only, not materials/storage)
        region_str = request.region.value if hasattr(request.region, 'value') else str(getattr(request, 'region', 'midwest'))
        region_mult = REGION_MULTIPLIERS.get(region_str, 1.0)

        crew_multiplier = crew_efficiency(request.crew_size)
        labor_base = total_room_base * crew_multiplier * region_mult

        # Calculate hours
        labor_rate = self.get_price("2825")  # Content manipulation
        total_hours = labor_base / labor_rate if labor_rate > 0 else 0

        # Pack-out/pack-back split
        pack_out_hours = round(total_hours * 0.62)
        pack_back_hours = round(total_hours * 0.38) if request.include_packback else 0

        # Supervision hours
        supervisor_hours = round(total_hours * 0.1)
        supervisor_rate = self.get_price("2911")

        # Calculate materials
        materials = self.calculate_materials(request.rooms)
        material_cost = self.calculate_material_cost(materials)

        # Transport & Storage costs depend on staging type
        is_on_site = request.staging_type == StagingType.ON_SITE
        quick_num_rooms = len(request.rooms)
        quick_loading_hours = max(2.0, quick_num_rooms * 0.5)
        loading_cost = request.crew_size * quick_loading_hours * labor_rate

        # On-site: no truck, just crew moving contents within the property
        quick_on_site_hours = max(1.5, quick_num_rooms * 0.35)
        on_site_moving_fee = request.crew_size * quick_on_site_hours * labor_rate

        # Storage costs (per SF) - always calculate SF for display
        storage_sf = self.estimate_storage_sf_from_rooms(
            request.rooms
        )
        storage_cost = 0
        if not is_on_site and request.storage_months > 0:
            setup_fee = get_storage_setup_fee(storage_sf)
            sf_rate = self.get_price("2840") or 2.20
            storage_cost = (
                storage_sf * sf_rate * request.storage_months
                + setup_fee
            )

        # Smart truck selection based on job size
        _, truck_rate = self.select_truck(storage_sf)
        # Truck trips: large van holds ~500 SF
        quick_truck_trips = max(
            1, math.ceil(storage_sf / 500)
        ) if storage_sf > 0 else 1

        # Special items (fixed cost, not affected by region/density/floor)
        # Merge request-level + per-room special items
        all_special = set(getattr(request, 'special_items', []))
        all_custom_special = list(getattr(request, 'custom_special_items', []))
        for room_input in request.rooms:
            all_special.update(getattr(room_input, 'special_items', []))
            all_custom_special.extend(getattr(room_input, 'custom_special_items', []))

        special_item_cost = 0.0
        special_item_lines = []
        for item_key in all_special:
            spec = SPECIAL_ITEM_COSTS.get(item_key)
            if spec:
                special_item_cost += spec["price"]
                special_item_lines.append(spec)
        for custom in all_custom_special:
            special_item_cost += custom.price
            special_item_lines.append({"name": custom.name, "unit": "EA", "price": custom.price})

        # Build sections (Pack-Out Labor total is recalculated after section_details)
        sections = {
            "Pack-Out Labor": pack_out_hours * labor_rate,
            "Materials": material_cost,
        }

        if is_on_site:
            sections["On-Site Relocation"] = on_site_moving_fee
        else:
            sections["Transport Out"] = (truck_rate + loading_cost) * quick_truck_trips
            if storage_cost > 0:
                sections["Storage"] = storage_cost

        if request.include_packback:
            if is_on_site:
                sections["On-Site Pack-Back Move"] = on_site_moving_fee
            else:
                sections["Transport Back"] = (truck_rate + loading_cost) * quick_truck_trips
            sections["Pack-Back Labor"] = pack_back_hours * labor_rate

        if special_item_cost > 0:
            sections["Special Items"] = round(special_item_cost, 2)

        # Initial totals (recalculated after section_details adjust sections)
        subtotal = sum(sections.values())
        op_amount = subtotal * (request.op_rate / 100) if request.include_op else 0

        # Evaluate conditional supplements
        supplements = self.evaluate_supplements(
            request.rooms, subtotal,
            overrides=getattr(request, 'supplement_overrides', None),
        )
        supplements_total = sum(s.amount for s in supplements if s.enabled)

        # Legacy contingency (backwards compat, defaults off)
        contingency_amount = subtotal * (request.contingency_rate / 100) if request.include_contingency else 0
        grand_total = subtotal + op_amount + supplements_total + contingency_amount

        room_summaries = self._build_room_summaries_from_hints(
            request.rooms
        )

        # Build section_details for notes/audit trail
        section_details: Dict[str, Any] = {}
        crew = request.crew_size

        # Split Pack-Out Labor into sub-lines matching PDF format
        _po_std_hours = max(4, round(pack_out_hours * 0.6))
        _po_fragile_hours = max(2, round(pack_out_hours * 0.15))
        _po_specialty_hours = max(1, round(pack_out_hours * 0.08))
        _po_furniture_hours = max(2, round(pack_out_hours * 0.1))
        _po_appliance_hours = max(2, round(pack_out_hours * 0.08))
        _po_inventory_hours = max(2, round(total_hours * 0.06))
        _po_crew_hours = _po_std_hours + _po_furniture_hours + _po_appliance_hours + _po_inventory_hours
        _po_specialized_hours = _po_fragile_hours + _po_specialty_hours

        section_details["Pack-Out Labor"] = {"lines": [
            {"name": "Pack-Out Crew Labor", "qty": _po_crew_hours, "unit": "HR",
             "rate": round(labor_rate, 2),
             "detail": f"{crew}-person crew, professional packing of all contents including wrapping, boxing, labeling, and loading",
             "amount": round(_po_crew_hours * labor_rate, 2)},
            {"name": "Supervisor/Foreman", "qty": supervisor_hours, "unit": "HR",
             "rate": round(supervisor_rate, 2),
             "detail": f"On-site supervision across {len(request.rooms)} rooms, inventory documentation, quality control",
             "amount": round(supervisor_hours * supervisor_rate, 2)},
            {"name": "Specialized Handling", "qty": _po_specialized_hours, "unit": "HR",
             "rate": round(self.get_price("2912") or 127.74, 2),
             "detail": "Electronics, fragile items, artwork — includes extra care packaging and custom crating as needed",
             "amount": round(_po_specialized_hours * (self.get_price("2912") or 127.74), 2)},
        ]}
        # Recalculate Pack-Out Labor section total to match sub-lines
        sections["Pack-Out Labor"] = sum(l["amount"] for l in section_details["Pack-Out Labor"]["lines"])

        def _rh(x):
            return round(x * 2) / 2

        if not is_on_site:
            _load_ph = _rh(quick_loading_hours * crew)
            _t_lines = [
                {"name": "26' Moving Van", "qty": quick_truck_trips, "unit": "DY",
                 "rate": round(truck_rate, 2),
                 "detail": f"{quick_truck_trips} trip{'s' if quick_truck_trips > 1 else ''}  (~500 SF capacity per trip)",
                 "amount": round(truck_rate * quick_truck_trips, 2)},
                {"name": "Loading / Unloading Labor", "qty": _load_ph, "unit": "HR",
                 "rate": round(labor_rate, 2),
                 "detail": f"{quick_loading_hours:.1f} elapsed hr · {crew}-person crew  (stage, load, secure, unload)",
                 "amount": round(_load_ph * labor_rate, 2)},
            ]
            section_details["Transport Out"] = {"lines": _t_lines}
            if request.include_packback:
                section_details["Transport Back"] = {"lines": _t_lines}
            if storage_cost > 0:
                _sf_rate = self.get_price("2840") or 2.20
                _setup_fee = get_storage_setup_fee(storage_sf)
                section_details["Storage"] = build_storage_section_detail(
                    storage_sf, _sf_rate, request.storage_months,
                    _setup_fee, storage_cost,
                )
        if request.include_packback:
            # Split Pack-Back into sub-lines matching PDF format
            _pb_crew_base = max(8, round(pack_back_hours * 0.65))
            _pb_reassembly = max(2, round(pack_back_hours * 0.12))
            _pb_appliance = max(1, round(pack_back_hours * 0.06))
            _pb_waste = max(1, round(pack_back_hours * 0.06))
            _pb_supervisor = max(2, round(pack_back_hours * 0.12))
            _pb_total_crew = _pb_crew_base + _pb_reassembly + _pb_appliance + _pb_waste
            _spec_ratio = _po_specialized_hours / max(1, _po_crew_hours + _po_specialized_hours)
            _pb_specialized = max(1, round(_pb_total_crew * _spec_ratio))
            _specialty_rate = self.get_price("2912") or 127.74

            pb_lines = [
                {"name": "Pack-Back Crew Labor", "qty": _pb_total_crew, "unit": "HR",
                 "rate": round(labor_rate, 2),
                 "detail": f"{crew}-person crew, unloading, placement, furniture reassembly, and unpacking",
                 "amount": round(_pb_total_crew * labor_rate, 2)},
                {"name": "Supervisor/Foreman", "qty": _pb_supervisor, "unit": "HR",
                 "rate": round(supervisor_rate, 2),
                 "detail": "Pack-back oversight, quality control, client walkthrough",
                 "amount": round(_pb_supervisor * supervisor_rate, 2)},
                {"name": "Specialized Handling", "qty": _pb_specialized, "unit": "HR",
                 "rate": round(_specialty_rate, 2),
                 "detail": "Electronics, fragile items, artwork — careful unpacking and placement",
                 "amount": round(_pb_specialized * _specialty_rate, 2)},
            ]
            section_details["Pack-Back Labor"] = {"lines": pb_lines}
            # Recalculate Pack-Back Labor section total to match sub-lines
            sections["Pack-Back Labor"] = sum(l["amount"] for l in pb_lines)

        if special_item_lines:
            section_details["Special Items"] = {"lines": [
                {"name": s["name"], "qty": 1, "unit": s["unit"],
                 "rate": s["price"],
                 "detail": "Fixed-cost specialty item — independent of density/floor/region",
                 "amount": s["price"]}
                for s in special_item_lines
            ]}

        # Build Materials section_details and material_details from calculated materials
        mat_lines = []
        material_details = []
        for mat_key, qty in materials.items():
            if qty <= 0:
                continue
            code = MATERIAL_CODES.get(mat_key)
            if not code:
                continue
            unit_price = round(self.get_price(code), 2)
            if unit_price <= 0:
                continue
            p = self.prices.get(code)
            name = p.name if p else DEFAULT_PRICES.get(code, {}).get("name", mat_key)
            unit = p.unit if p else DEFAULT_PRICES.get(code, {}).get("unit", "EA")
            mat_lines.append({
                "name": name,
                "qty": qty,
                "unit": unit,
                "rate": unit_price,
                "detail": MATERIAL_DETAIL.get(mat_key, "Packing supply"),
                "amount": round(unit_price * qty, 2),
            })
            material_details.append({
                "code": code,
                "name": name,
                "quantity": qty,
                "unit": unit,
                "unit_price": unit_price,
                "total": round(unit_price * qty, 2),
            })
        section_details["Materials"] = {"lines": mat_lines}

        # Build Storage section_details when storage is included but cost is 0
        if "Storage" not in section_details:
            if not is_on_site and storage_sf > 0:
                _sf_rate = self.get_price("2840") or 2.20
                _setup_fee = get_storage_setup_fee(storage_sf)
                section_details["Storage"] = build_storage_section_detail(
                    storage_sf, _sf_rate, request.storage_months or 0,
                    _setup_fee, storage_cost,
                )
            else:
                section_details["Storage"] = {"lines": []}

        # Recalculate totals after section_details adjusted section amounts
        subtotal = sum(sections.values())
        op_amount = subtotal * (request.op_rate / 100) if request.include_op else 0

        # Evaluate conditional supplements
        supplements = self.evaluate_supplements(
            request.rooms, subtotal,
            overrides=getattr(request, 'supplement_overrides', None),
        )
        supplements_total = sum(s.amount for s in supplements if s.enabled)

        # Legacy contingency (backwards compat, defaults off)
        contingency_amount = subtotal * (request.contingency_rate / 100) if request.include_contingency else 0
        grand_total = subtotal + op_amount + supplements_total + contingency_amount

        return EstimateResponse(
            total_rooms=len(request.rooms),
            total_items=total_items,
            total_hours=round(total_hours, 1),
            crew_size=request.crew_size,
            sections=sections,
            section_details=section_details,
            materials=materials,
            material_details=material_details,
            storage_sf=storage_sf if not is_on_site else 0,
            staging_type=request.staging_type,
            room_summaries=room_summaries,
            subtotal=round(subtotal, 2),
            include_op=request.include_op,
            op_rate=request.op_rate,
            op_amount=round(op_amount, 2),
            include_contingency=request.include_contingency,
            contingency_rate=request.contingency_rate,
            contingency_amount=round(contingency_amount, 2),
            supplements=supplements,
            supplements_total=round(supplements_total, 2),
            grand_total=round(grand_total, 2),
        )

    # ============================================
    # ITEM-BASED CALCULATION (from room content lists)
    # ============================================

    # Categories that use fragile labor rate
    FRAGILE_CATEGORIES = {"Fragile", "Artwork", "Collectibles"}
    # Categories that use specialty labor rate
    SPECIALTY_CATEGORIES = {"Electronics"}

    # ── Room-based labor estimation ──────────────────────────────────
    # Labor is driven by room characteristics, NOT individual item counts.
    # Item analysis exists for packing MATERIALS — labor is about how long
    # a crew spends in a room based on density, content type, and room size.
    #
    # Base = PERSON-HOURS (single-worker equivalent).
    # A 4-person crew in a standard bedroom at normal density: 4.0 ph ÷ 4 = 1.0 elapsed hr.
    # Reference: industry average 1-2 elapsed hours per standard room with 3-4 crew.
    ROOM_BASE_PERSON_HOURS = {
        "small": 2.0,    # bathroom, closet, pantry — ~30 min elapsed with 4 crew
        "large": 5.5,    # standard bedroom, living room, kitchen — ~1.4 hr elapsed
        "xlarge": 9.0,   # master bedroom, basement, garage — ~2.25 hr elapsed
    }

    CONTENT_TYPE_MODIFIERS = {
        "fragile_heavy":    0.40,   # dishes, glass → careful wrapping adds ~40%
        "furniture_heavy":  0.30,   # large furniture → disassembly, blanket wrap
        "appliance_heavy":  0.25,   # appliances → disconnect, dolly
        "electronics_heavy": 0.15,  # electronics → serial#, careful boxing
        "clothing_dominant": -0.10, # mostly clothing → faster wardrobe-box packing
    }

    def _classify_room_content(self, items: List[Any]) -> Dict[str, bool]:
        """Determine dominant content types in a room from its items."""
        if not items:
            return {}
        total_lines = len(items)
        cats: Dict[str, int] = {}
        fragile_lines = 0
        for item in items:
            cat = getattr(item, "category", "Other")
            cats[cat] = cats.get(cat, 0) + 1
            if getattr(item, "is_fragile", False):
                fragile_lines += 1

        flags: Dict[str, bool] = {}
        threshold = max(2, total_lines * 0.30)

        if fragile_lines >= threshold or cats.get("Kitchenware", 0) + cats.get("Fragile", 0) >= threshold:
            flags["fragile_heavy"] = True
        if cats.get("Furniture", 0) >= threshold:
            flags["furniture_heavy"] = True
        if cats.get("Appliances", 0) >= threshold:
            flags["appliance_heavy"] = True
        if cats.get("Electronics", 0) >= threshold:
            flags["electronics_heavy"] = True
        if cats.get("Clothing", 0) >= total_lines * 0.50:
            flags["clothing_dominant"] = True

        return flags

    def _get_room_size(self, room) -> str:
        """Resolve room size from preset_id or fallback to 'large'."""
        preset_id = getattr(room, 'preset_id', None)
        if preset_id and preset_id in self.presets:
            return self.presets[preset_id].size
        name = getattr(room, 'room_name', '').lower()
        if any(k in name for k in ('bath', 'closet', 'pantry', 'laundry', 'half')):
            return "small"
        if any(k in name for k in ('master', 'basement', 'garage', 'attic', 'family')):
            return "xlarge"
        return "large"

    # ---- Content Relocation (carry packed items from room to truck / staging area) ----
    # Multiplier applied to base carry time by floor.
    # Higher floors add stair travel with heavy/bulky boxes and furniture.
    FLOOR_CARRY_MULT: Dict[str, float] = {
        "basement": 1.30,  # carry UP: one stair flight with loaded boxes/dolly
        "1st":      1.00,  # baseline — level exit or short ramp
        "2nd":      1.50,  # carry DOWN one flight
        "3rd":      1.90,  # carry DOWN two flights
        "4th+":     2.40,  # carry DOWN three+ flights — eastern US brownstones/walkups
    }

    # Base person-minutes to carry ONE AI-reported item-unit from its room to truck/staging.
    # Covers: pick up → navigate hallway → stairs (if any) → place at loading position.
    #
    # IMPORTANT: AI reports item COUNTS, not box counts.
    # e.g. "Books qty=30" = 30 individual books → packed into ~2 boxes → ~3 person-min total.
    # Values are calibrated accordingly: boxes_per_item × 1.5 min/box.
    #
    # Large discrete items (Furniture, Appliances, Artwork) are 1 item ≈ 1 carry trip —
    # values for those are kept higher to reflect dolly setup, 2-person lift, or careful carry.
    BASE_CARRY_MINS: Dict[str, float] = {
        "Furniture":    3.5,   # 1 item = 1 wrapped piece; dolly + 2-person = ~3-4 min
        "Appliances":   5.0,   # heavy appliance; 2-person, dolly, disconnect checks = ~5 min
        "Electronics":  1.2,   # 1 item ≈ 1 device (TV, monitor); padded carry = ~1-1.5 min
        "Books":        0.10,  # ~15 books/box × 1.5 min/box → 0.10 min/book
        "Fragile":      0.25,  # ~8 items/dish-pack × 2 min/box → 0.25 min/item
        "Artwork":      2.5,   # 1 item = 1 framed piece / mirror; mirror box carry = ~2-3 min
        "Kitchenware":  0.15,  # ~8-10 items/box × 1.2 min/box → 0.15 min/item
        "Clothing":     0.10,  # ~15 items/wardrobe-box × 1.5 min/box → 0.10 min/item
        "Collectibles": 0.30,  # ~6 items/box, handled carefully × 1.8 min/box → 0.30 min/item
        "Tools":        0.20,  # ~10 items/toolbox × 2 min/box → 0.20 min/item
        "Sports":       1.2,   # discrete items (bike, bag, equipment); ~1-1.5 min each
        "Toys":         0.15,  # ~10 items/box × 1.5 min/box → 0.15 min/item
        "Other":        0.20,  # ~8 items/box × 1.5 min/box → 0.20 min/item
    }

    # Per-room carry overhead: navigate hallway, hold/prop doors, position dolly, clear path.
    # 8.0 min was too aggressive for a single room; 5.0 min is realistic.
    ROOM_CARRY_OVERHEAD_MINS: float = 5.0

    # Packing method → material inference when required_materials is empty
    PACKING_METHOD_MATERIALS = {
        "bubble": ["bubble_12"],
        "bubble wrap": ["bubble_12"],
        "double box": ["box_medium", "box_large"],
        "dish pack": ["box_dish", "packing_paper"],
        "dish-pack": ["box_dish", "packing_paper"],
        "wardrobe": ["box_wardrobe"],
        "mirror box": ["box_mirror"],
        "picture box": ["box_mirror"],
        "tv box": ["box_tv"],
        "blanket wrap": ["blanket", "shrink_wrap"],
        "pad wrap": ["furniture_pad", "shrink_wrap"],
        "chair cover": ["chair_cover"],
        "sofa cover": ["sofa_cover"],
        "couch cover": ["sofa_cover"],
        "furniture cover": ["chair_cover", "sofa_cover"],
        "plastic cover": ["chair_cover"],
        "shrink wrap": ["shrink_wrap"],
        "stretch wrap": ["shrink_wrap"],
        "crate": ["box_xlarge", "bubble_24"],
        "custom crate": ["box_xlarge", "bubble_24", "corner_protector"],
    }

    def _infer_materials_from_packing_method(self, packing_method: str) -> List[str]:
        """Infer materials from packing_method description string."""
        if not packing_method:
            return []
        method_lower = packing_method.lower()
        inferred = []
        for keyword, mats in self.PACKING_METHOD_MATERIALS.items():
            if keyword in method_lower:
                inferred.extend(mats)
        # Deduplicate while preserving order
        return list(dict.fromkeys(inferred))

    # How many items fit per box/material unit (packing ratio)
    ITEMS_PER_BOX = {
        "box_small": 12, "box_medium": 12, "box_large": 6,
        "box_xlarge": 4, "box_book": 20, "box_dish": 12,
        "box_wardrobe": 24,       # standard wardrobe box holds 24 hanging garments
        "box_wardrobe_small": 18,
        "box_wardrobe_large": 30,
        # Specialty boxes: 1 item per box
        "box_tv": 1, "box_mirror": 1, "box_lamp": 1,
        # Bubble wrap rolls: NOT 1:1 per item — 1 roll covers multiple items.
        # 12" × 60ft roll: covers ~20 medium fragile items
        # 24" × 30ft roll: covers ~8 large fragile items
        "bubble_12": 20,
        "bubble_24": 8,
        # Corner protectors: sold in box of 100; ~16 furniture items use 1 box
        "corner_protector": 16,
        # Stretch wrap roll (20" × 1500ft): 1 roll wraps ~8 furniture pieces.
        # AI encodes as "1 per item" but the Xactimate code 2936 is per ROLL.
        "shrink_wrap": 8,
        # Furniture pad (72" × 80"): large heavy-duty pad shared across ~2 items.
        # 1:1 would over-count when qty > 1 per item entry.
        "furniture_pad": 2,
    }
    # Wrapping materials: 1 unit per item.quantity (covers, mattress bags, blankets).
    # shrink_wrap and furniture_pad excluded — they use ITEMS_PER_BOX ratio to avoid
    # over-counting when item.quantity > 1 (e.g. 8 chairs → 1 roll, not 8 rolls).
    WRAP_MATERIALS = {
        "blanket",
        "mattress_twin", "mattress_full", "mattress_queen", "mattress_king",
        "chair_cover", "sofa_cover",
    }

    # Keywords indicating large furniture that needs extra wrapping materials
    _LARGE_FURNITURE_KEYWORDS = {
        "sectional", "l-shaped", "l shaped", "chaise", "sofa bed", "sleeper sofa",
        "king", "armoire", "wardrobe", "large wardrobe", "3-door", "4-door",
        "large bookcase", "tall bookcase", "6-shelf", "7-shelf", "8-shelf",
        "entertainment center", "china cabinet", "hutch",
    }
    # Minimum blankets to assign for large furniture when AI under-specifies
    _LARGE_FURNITURE_MIN_BLANKETS = 2

    def _supplement_furniture_materials(
        self, item: Any, mat_counts: Dict[str, int]
    ) -> None:
        """Ensure large furniture gets adequate wrapping materials.

        When the AI returns required_materials, duplicates already encode
        quantity. This method adds a safety-net floor for large furniture
        that may have been under-specified — it will NOT reduce existing counts.
        """
        if item.category != "Furniture":
            return
        name_lower = (item.name or "").lower()
        is_large = any(kw in name_lower for kw in self._LARGE_FURNITURE_KEYWORDS)
        if not is_large:
            return
        # Ensure at least 2 blankets for large furniture
        current_blankets = mat_counts.get("blanket", 0)
        needed = self._LARGE_FURNITURE_MIN_BLANKETS * item.quantity
        if current_blankets < needed:
            mat_counts["blanket"] = needed

    def _calculate_relocation_hours(
        self, rooms: List[Any]
    ) -> Tuple[float, str]:
        """Person-hours to physically carry packed items from rooms to truck / staging area.

        Floor-weighted: each item's carry time is multiplied by its room's floor factor.
        Returns (total_person_hours_rounded_to_0.5, floor_detail_note).
        """
        FLOOR_LABEL = {"basement": "Basement", "1st": "1st fl", "2nd": "2nd fl", "3rd": "3rd fl"}
        total_mins = 0.0
        floor_stats: Dict[str, Dict[str, Any]] = {}  # floor → {rooms, raw_mins}

        for room in rooms:
            floor = (getattr(room, "floor", None) or "1st").lower()
            # Normalise "2nd floor" → "2nd" etc.
            for key in self.FLOOR_CARRY_MULT:
                if floor.startswith(key.rstrip("st").rstrip("nd").rstrip("rd")):
                    floor = key
                    break
            mult = self.FLOOR_CARRY_MULT.get(floor, 1.0)

            if floor not in floor_stats:
                floor_stats[floor] = {"rooms": 0, "raw_mins": 0.0}
            floor_stats[floor]["rooms"] += 1

            room_mins = self.ROOM_CARRY_OVERHEAD_MINS * mult
            room_raw_mins = self.ROOM_CARRY_OVERHEAD_MINS  # without floor mult
            for item in room.items:
                qty = item.quantity or 1
                base = self.BASE_CARRY_MINS.get(item.category, 2.0)
                room_mins += base * qty * mult
                room_raw_mins += base * qty
            floor_stats[floor]["raw_mins"] += room_raw_mins

            total_mins += room_mins

        person_hours = round(total_mins / 60.0 * 2) / 2  # round to 0.5
        person_hours = max(1.0, person_hours)

        # Build readable floor breakdown note
        # Shows base carry time (without floor multiplier) so adjusters can see
        # raw volume per floor independent of stair difficulty.
        order = ["basement", "1st", "2nd", "3rd", "4th+"]
        parts = []
        for fl in order:
            if fl in floor_stats:
                s = floor_stats[fl]
                mult = self.FLOOR_CARRY_MULT.get(fl, 1.0)
                base_hrs = s["raw_mins"] / 60.0
                # Format as e.g. "0.5 hr" or "2.0 hrs"
                hrs_str = f"{base_hrs:.1f} hr" if base_hrs < 2 else f"{base_hrs:.1f} hrs"
                parts.append(
                    f"{FLOOR_LABEL.get(fl, fl)}: {s['rooms']} room(s), "
                    f"~{hrs_str} base carry (×{mult:.2f})"
                )
        note = "  ·  ".join(parts)
        return person_hours, note

    def aggregate_item_materials(self, rooms: List[Any]) -> Dict[str, int]:
        """Aggregate required_materials from all items across all rooms.

        Boxes use a packing ratio (multiple items per box).
        Wrapping materials scale 1:1 — the AI encodes quantity via duplicate
        keys in the required_materials list (e.g. two "moving_blanket" entries
        = 2 blankets for that item).
        Packing paper is accumulated as a raw item count across ALL items,
        then converted to 50-lb bundles once at the end.
        """
        materials: Dict[str, int] = {}
        packing_paper_raw = 0  # accumulate raw item count across all items

        # Keywords that identify actual TVs/large monitors (32"+) vs other electronics
        _TV_KEYWORDS = {"tv", "television", "flat screen", "flatscreen", "oled", "qled"}

        for room in rooms:
            for item in room.items:
                item_mats = []
                if item.required_materials:
                    item_mats = list(item.required_materials)
                elif hasattr(item, 'packing_method') and item.packing_method:
                    item_mats = self._infer_materials_from_packing_method(item.packing_method)

                # Guard: tv_box only for actual TVs/large monitors.
                # Downgrade to medium_box for other electronics (consoles, routers, etc.)
                if item.category == "Electronics" and item_mats:
                    name_lower = (item.name or "").lower()
                    is_actual_tv = any(kw in name_lower for kw in _TV_KEYWORDS) or "monitor" in name_lower
                    if not is_actual_tv:
                        item_mats = [("medium_box" if m in ("tv_box", "box_tv") else m) for m in item_mats]

                # Track per-item material counts before merging into global dict
                # so _supplement_furniture_materials can reason about this item's share.
                item_mat_counts: Dict[str, int] = {}

                # When AI lists multiple box types for one item (e.g. wardrobe_box + medium_box
                # for clothing), each type should receive a proportional share of the item qty
                # rather than the full qty — otherwise box counts inflate ~Nx.
                item_box_types: set = set()
                for mk in item_mats:
                    n = self._normalize_material_key(mk)
                    if n and n in self.ITEMS_PER_BOX and n.startswith("box_") and n not in ("box_tv", "box_mirror", "box_lamp"):
                        item_box_types.add(n)
                qty_per_box_type = (item.quantity / len(item_box_types)) if len(item_box_types) > 1 else item.quantity

                for mat_key in item_mats:
                    norm = self._normalize_material_key(mat_key)
                    if not norm:
                        continue
                    if norm == "packing_paper":
                        # Accumulate raw item count; convert to bundles after loop.
                        packing_paper_raw += item.quantity
                    elif norm in self.WRAP_MATERIALS:
                        # Wrap materials: each occurrence = 1 unit per item.
                        # AI uses duplicate keys to represent quantity
                        # (e.g., 2× "moving_blanket" = 2 blankets per unit).
                        # Multiply occurrence count by item.quantity (number of units).
                        item_mat_counts[norm] = item_mat_counts.get(norm, 0) + item.quantity
                    elif norm in self.ITEMS_PER_BOX:
                        # Boxes: ceil(effective_qty / items_per_box) per occurrence.
                        # For regular box types, use split qty when multiple box types are
                        # listed for the same item (avoids Nx inflation).
                        # Specialty single-item boxes (tv/mirror/lamp) always use full qty.
                        per_box = self.ITEMS_PER_BOX[norm]
                        is_specialty = norm in ("box_tv", "box_mirror", "box_lamp")
                        eff_qty = item.quantity if is_specialty else qty_per_box_type
                        boxes = math.ceil(eff_qty / per_box)
                        item_mat_counts[norm] = item_mat_counts.get(norm, 0) + max(1, boxes)
                    else:
                        # Unknown material: 1 per occurrence
                        item_mat_counts[norm] = item_mat_counts.get(norm, 0) + 1

                # Safety floor for large furniture
                self._supplement_furniture_materials(item, item_mat_counts)

                # Merge item-level counts into global totals
                for norm, cnt in item_mat_counts.items():
                    materials[norm] = materials.get(norm, 0) + cnt

        # Count total boxes for paper and tape calculation
        box_keys = {k for k in materials if k.startswith("box_")}
        total_boxes = sum(materials.get(k, 0) for k in box_keys)
        num_rooms = len(rooms)

        # Packing paper: max of (item-based, box-based, room-based)
        paper_from_items = packing_paper_raw / 150.0
        paper_from_boxes = total_boxes / 15.0
        paper_from_rooms = num_rooms / 3.0
        materials["packing_paper"] = max(1, math.ceil(
            max(paper_from_items, paper_from_boxes, paper_from_rooms)
        ))

        # Packing tape: 1 roll per ~10 boxes
        materials["packing_tape"] = max(
            1, math.ceil(total_boxes / 10.0)
        )

        return materials

    def build_material_detail_strings(
        self, rooms: List[Any], materials: Dict[str, int]
    ) -> Dict[str, str]:
        """Build a human-readable basis description for each material key.

        Explains *why* a quantity was generated without showing raw formulas
        or mentioning specific item names — only broad categories (Furniture,
        Electronics, Clothing, etc.) and room count.

        Returns {mat_key: description_string}.
        """
        _BOX_KEYS = {
            "box_small", "box_medium", "box_large", "box_xlarge",
            "box_book", "box_dish", "box_wardrobe", "box_wardrobe_small",
            "box_wardrobe_large", "box_tv", "box_mirror", "box_lamp",
        }
        _MATTRESS_LABELS = {
            "mattress_twin": "Twin", "mattress_full": "Full",
            "mattress_queen": "Queen", "mattress_king": "King",
        }
        _ACTION = {
            "blanket":          "Furniture padding",
            "furniture_pad":    "Large furniture padding",
            "shrink_wrap":      "Furniture securing",
            "chair_cover":      "Seating protection",
            "sofa_cover":       "Sofa protection",
            "bubble_12":        "Fragile item cushioning",
            "bubble_24":        "Oversized fragile item cushioning",
            "corner_protector": "Edge and corner protection",
            "packing_paper":    "Cushioning and void fill",
        }

        def _join(cats: list) -> str:
            cats = sorted(cats)
            if not cats:
                return ""
            if len(cats) == 1:
                return cats[0]
            return ", ".join(cats[:-1]) + ", and " + cats[-1]

        # Collect contributing categories per material key
        mat_cats: Dict[str, set] = {k: set() for k in materials}

        for room in rooms:
            for item in room.items:
                item_mats = []
                if item.required_materials:
                    item_mats = item.required_materials
                elif hasattr(item, "packing_method") and item.packing_method:
                    item_mats = self._infer_materials_from_packing_method(
                        item.packing_method
                    )
                seen = set()
                for mk in item_mats:
                    norm = self._normalize_material_key(mk)
                    if not norm or norm not in materials or norm in seen:
                        continue
                    seen.add(norm)
                    cat = getattr(item, "category", None) or "General"
                    mat_cats[norm].add(cat)

        results: Dict[str, str] = {}
        for mat_key in materials:
            cats = sorted(mat_cats.get(mat_key, set()))[:3]

            if mat_key in _MATTRESS_LABELS:
                size = _MATTRESS_LABELS[mat_key]
                results[mat_key] = f"{size} mattress protection"

            elif mat_key in _BOX_KEYS:
                results[mat_key] = _join(cats) if cats else ""

            elif mat_key in _ACTION:
                action = _ACTION[mat_key]
                if cats:
                    results[mat_key] = f"{action} — {_join(cats)}"
                else:
                    results[mat_key] = action

            else:
                results[mat_key] = ""

        return results

    @staticmethod
    def _normalize_material_key(key: str) -> str | None:
        """Map AI-returned material names to our internal keys."""
        ALIASES = {
            "moving_blanket": "blanket", "furniture_pad": "furniture_pad",
            "stretch_wrap": "shrink_wrap", "wardrobe_box": "box_wardrobe",
            "small_box": "box_small", "medium_box": "box_medium",
            "large_box": "box_large", "dish_pack_box": "box_dish",
            "book_box": "box_book", "tv_box": "box_tv", "mirror_box": "box_mirror",
            "lamp_box": "box_lamp", "bubble_wrap_12": "bubble_12",
            "bubble_wrap_24": "bubble_24", "packing_paper": "packing_paper",
            "corner_protector": "corner_protector", "mattress_bag": "mattress_queen",
            # New item aliases
            "chair_cover": "chair_cover", "plastic_chair_cover": "chair_cover",
            "sofa_cover": "sofa_cover", "couch_cover": "sofa_cover",
            "plastic_sofa_cover": "sofa_cover", "plastic_couch_cover": "sofa_cover",
            "wardrobe_box_small": "box_wardrobe_small",
            "small_wardrobe_box": "box_wardrobe_small",
            "wardrobe_box_large": "box_wardrobe_large",
            "large_wardrobe_box": "box_wardrobe_large",
            "box_wardrobe_small": "box_wardrobe_small",
            "box_wardrobe_large": "box_wardrobe_large",
            # Direct matches
            "blanket": "blanket", "shrink_wrap": "shrink_wrap",
            "box_small": "box_small", "box_medium": "box_medium",
            "box_large": "box_large", "box_xlarge": "box_xlarge",
            "box_dish": "box_dish", "box_wardrobe": "box_wardrobe",
            "box_mirror": "box_mirror", "box_tv": "box_tv", "box_lamp": "box_lamp",
            "box_book": "box_book", "bubble_12": "bubble_12", "bubble_24": "bubble_24",
            "furniture_pad": "furniture_pad",
        }
        return ALIASES.get(key)

    def classify_labor_hours(
        self, rooms: List[Any]
    ) -> Dict[str, float]:
        """Estimate labor hours per room based on density, content type, and size.

        This is a ROOM-LEVEL estimation. Item-level analysis is used only for
        packing material calculations, not labor. A crew walks into a room and
        the time depends on: how full it is, what kind of stuff is in it, and
        how big the space is.
        """
        standard_mins = 0.0
        fragile_mins = 0.0
        specialty_mins = 0.0
        furniture_disassembly_mins = 0.0
        appliance_mins = 0.0

        for room in rooms:
            density_mult = DENSITY_MULTIPLIERS.get(room.density, 1.0)
            floor_mult = FLOOR_MULTIPLIERS.get(room.floor, 1.0)
            contamination_mult = CONTAMINATION_MULTIPLIERS.get(
                getattr(room, 'contamination', 'clean'), 1.0
            )

            # Base time for this room
            room_size = self._get_room_size(room)
            base_ph = self.ROOM_BASE_PERSON_HOURS.get(room_size, 2.5)

            if room.density == "light" and room_size == "small":
                base_ph = 0.5

            # Apply density, floor, contamination
            room_ph = base_ph * density_mult * floor_mult * contamination_mult

            # Content-type modifiers
            items = getattr(room, 'items', [])
            content_flags = self._classify_room_content(items)
            content_modifier = 1.0
            for flag, mod_value in self.CONTENT_TYPE_MODIFIERS.items():
                if content_flags.get(flag):
                    content_modifier += mod_value
            room_ph *= content_modifier

            room_mins = room_ph * 60

            # Split into labor tiers based on content flags
            if content_flags.get("fragile_heavy"):
                fragile_mins += room_mins * 0.30
                standard_mins += room_mins * 0.70
            elif content_flags.get("furniture_heavy"):
                furniture_disassembly_mins += room_mins * 0.25
                standard_mins += room_mins * 0.75
            elif content_flags.get("appliance_heavy"):
                appliance_mins += room_mins * 0.30
                standard_mins += room_mins * 0.70
            else:
                standard_mins += room_mins

            # High-value items → small specialty surcharge
            hv_count = sum(1 for i in items if getattr(i, 'is_high_value', False))
            if hv_count > 0:
                specialty_mins += min(hv_count * 10, room_mins * 0.20)

        return {
            "standard": round(standard_mins / 60, 1),
            "fragile": round(fragile_mins / 60, 1),
            "specialty": round(specialty_mins / 60, 1),
            "furniture_disassembly": round(
                furniture_disassembly_mins / 60, 1
            ),
            "appliance": round(appliance_mins / 60, 1),
        }

    @staticmethod
    def recommend_crew_size(num_rooms: int, total_hours: float) -> int:
        """Recommend crew size based on room count and estimated labor hours."""
        if num_rooms <= 2 and total_hours < 5:
            return 2
        if num_rooms <= 4 and total_hours < 12:
            return 3
        if num_rooms <= 7 and total_hours < 20:
            return 4
        if num_rooms <= 10:
            return 5
        return 6

    def calculate_estimate_from_content(self, request: RoomsEstimateRequest) -> EstimateResponse:
        """Calculate estimate using per-item content data from AI analysis."""

        total_items = sum(item.quantity for room in request.rooms for item in room.items)

        # --- Materials: aggregate from per-item required_materials ---
        materials = self.aggregate_item_materials(request.rooms)

        # Fallback: if no required_materials at all, use hint-based calculation
        if not materials:
            hint_rooms = []
            for room in request.rooms:
                preset_key = room.preset_id or "living_standard"
                hints = self._derive_hints(room.items)
                hint_rooms.append(RoomInput(
                    preset=preset_key,
                    floor=room.floor,
                    density=room.density,
                    hints=hints,
                ))
            materials = self.calculate_materials(hint_rooms)

        material_cost = self.calculate_material_cost(materials)

        # --- Labor tiers ---
        # classify_labor_hours returns PERSON-HOURS (single-worker equivalent).
        # Divide by crew_size to get ELAPSED hours (crew works in parallel).
        person_hours = self.classify_labor_hours(request.rooms)
        crew = request.crew_size
        labor_hours = {k: round(v / crew, 1) for k, v in person_hours.items()}
        total_labor_hours = sum(labor_hours.values())

        labor_rate = self.get_price("2825") or 59.03      # Standard (per person/hr)
        fragile_rate = self.get_price("2911") or 89.75     # Fragile / Supervisor
        specialty_rate = self.get_price("2912") or 127.74  # Specialty (fallback)

        # Regional labor premium (Northeast +30%, West +20%, etc.)
        region_str = request.region.value if hasattr(request.region, 'value') else str(getattr(request, 'region', 'midwest'))
        region_mult = REGION_MULTIPLIERS.get(region_str, 1.0)
        labor_rate_adj = labor_rate * region_mult
        fragile_rate_adj = fragile_rate * region_mult
        specialty_rate_adj = specialty_rate * region_mult

        # Cost multiplier: elapsed hours × crew members × rate = person-hours × rate
        crew_cost = crew  # each elapsed hour costs crew × rate

        # Special items (fixed cost — not affected by region/contamination/density)
        # Merge request-level + per-room special items
        all_special = set(getattr(request, 'special_items', []))
        all_custom_special = list(getattr(request, 'custom_special_items', []))
        for room_input in request.rooms:
            all_special.update(getattr(room_input, 'special_items', []))
            all_custom_special.extend(getattr(room_input, 'custom_special_items', []))

        special_item_cost = 0.0
        special_item_lines = []
        for item_key in all_special:
            spec = SPECIAL_ITEM_COSTS.get(item_key)
            if spec:
                special_item_cost += spec["price"]
                special_item_lines.append(spec)
        for custom in all_custom_special:
            special_item_cost += custom.price
            special_item_lines.append({"name": custom.name, "unit": "EA", "price": custom.price})

        # Pack-out / pack-back split
        # Pack-out is more labor-intensive: inventory, assessment, wrapping, packing, documenting
        # Pack-back is simpler: unload, place, unpack (no inventory/wrapping needed)
        packout_fraction = 0.62 if request.include_packback else 0.85
        packback_fraction = 0.38 if request.include_packback else 0.0

        po_standard = labor_hours["standard"] * packout_fraction
        po_fragile = labor_hours["fragile"] * packout_fraction
        po_specialty = labor_hours["specialty"] * packout_fraction
        po_furniture = labor_hours["furniture_disassembly"] * packout_fraction
        po_appliance = labor_hours["appliance"] * packout_fraction

        def rh(x):
            """Round to nearest 0.5."""
            return round(x * 2) / 2

        # Inventory & documentation: 1 person does this, not full crew
        inventory_hours = rh(total_labor_hours * 0.09) if total_labor_hours > 2 else 0.5
        # Supervisor: 1 person, not full crew
        supervisor_hours = rh(total_labor_hours * 0.15) if total_labor_hours > 2 else 0.5

        # Pack-out elapsed hours — no artificial minimums that inflate small jobs
        po_standard_hrs = max(0.5, rh(po_standard))
        po_fragile_hrs = rh(po_fragile) if labor_hours["fragile"] > 0 else 0
        po_specialty_hrs = rh(po_specialty) if labor_hours["specialty"] > 0 else 0
        po_furniture_hrs = rh(po_furniture) if labor_hours["furniture_disassembly"] > 0 else 0
        po_appliance_hrs = rh(po_appliance) if labor_hours["appliance"] > 0 else 0

        # Cost = elapsed hours × crew × rate (for crew tasks)
        # Inventory & supervisor are single-person tasks (× 1, not × crew)
        # Region multiplier applied via adjusted rates
        pack_out_labor = (
            po_standard_hrs * crew_cost * labor_rate_adj
            + po_fragile_hrs * crew_cost * fragile_rate_adj
            + po_specialty_hrs * crew_cost * specialty_rate_adj
            + po_furniture_hrs * crew_cost * labor_rate_adj
            + po_appliance_hrs * crew_cost * labor_rate_adj
            + inventory_hours * labor_rate_adj          # 1 person
            + supervisor_hours * fragile_rate_adj       # 1 person
        )

        # Transport & Storage costs depend on staging type
        is_on_site = request.staging_type == StagingType.ON_SITE
        num_rooms = len(request.rooms)

        # Floor-weighted carry labor: physically moving packed items from rooms to truck/staging
        carry_person_hours, carry_floor_note = self._calculate_relocation_hours(request.rooms)
        # Truck loading/securing on top (flat add: position items, strap, fill gaps)
        truck_load_person_hours = rh(max(1.0, num_rooms * 0.5))
        # Total person-hours for the full relocation operation
        loading_person_hours = carry_person_hours + truck_load_person_hours
        loading_cost = loading_person_hours * labor_rate_adj  # region-adjusted rate

        # On-site staging: same carry labor (no truck loading overhead)
        on_site_person_hours = carry_person_hours
        on_site_moving_fee = on_site_person_hours * labor_rate_adj

        # Storage (per SF based on content volume)
        storage_sf = self.estimate_storage_sf_from_items(
            request.rooms
        )
        storage_cost = 0
        if not is_on_site and request.storage_months > 0:
            setup_fee = get_storage_setup_fee(storage_sf)
            sf_rate = self.get_price("2840") or 2.20
            storage_cost = (
                storage_sf * sf_rate * request.storage_months
                + setup_fee
            )

        # Smart truck selection based on job size
        _, truck_rate = self.select_truck(storage_sf)

        # Debris hauling — only count DISPOSABLE box materials and packing paper.
        # Reusable materials (blankets, bubble wrap rolls, shrink wrap, corner protectors)
        # are returned to the company and should NOT inflate this charge.
        # Rate: ~75 boxes/hr (industry standard: crews can flatten and haul 60-90 boxes/hr).
        # Covers: flattening boxes, bundling paper, bagging debris, hauling to truck/dumpster.
        BOX_KEYS = {"box_small", "box_medium", "box_large", "box_xlarge",
                    "box_book", "box_dish", "box_wardrobe",
                    "box_wardrobe_small", "box_wardrobe_large",
                    "box_mirror", "box_tv", "box_lamp"}
        disposable_box_qty = sum(qty for k, qty in materials.items() if k in BOX_KEYS)
        packing_paper_qty = materials.get("packing_paper", 0)
        # Boxes dominate volume; each packing paper bundle ≈ 3 boxes of debris volume
        debris_unit_equiv = disposable_box_qty + packing_paper_qty * 3
        debris_hours = max(0.5, round(debris_unit_equiv / 75 * 2) / 2)  # round to 0.5
        debris_cost = debris_hours * labor_rate_adj
        # Build description for section_details
        _debris_desc_parts = []
        if disposable_box_qty:
            _debris_desc_parts.append(f"{disposable_box_qty} boxes")
        if packing_paper_qty:
            _debris_desc_parts.append(f"{packing_paper_qty} paper bundle(s)")
        _debris_desc = (
            (", ".join(_debris_desc_parts) + "  ·  ") if _debris_desc_parts else ""
        ) + "flatten, bundle & haul spent packing materials post-pack-out"

        # Build sections
        sections = {
            "Pack-Out Labor": round(pack_out_labor, 2),
            "Materials": round(material_cost, 2),
        }

        # Truck trips: 26' van holds ~500 SF worth of contents
        truck_trips = max(1, math.ceil(storage_sf / 500)) if storage_sf > 0 else 1

        if is_on_site:
            sections["On-Site Relocation"] = round(on_site_moving_fee, 2)
        else:
            sections["Transport Out"] = round((truck_rate + loading_cost) * truck_trips, 2)
            sections["Storage"] = round(storage_cost, 2)

        sections["Debris Hauling"] = round(debris_cost, 2)

        if request.include_packback:
            pb_standard = labor_hours["standard"] * packback_fraction
            pb_furniture = labor_hours["furniture_disassembly"] * packback_fraction
            pb_appliance = labor_hours["appliance"] * packback_fraction
            pb_supervisor = rh(total_labor_hours * packback_fraction * 0.10) if total_labor_hours > 2 else 0.5

            # Pack-back is simpler: unload, unpack, place — no wrapping/inventory needed
            pb_standard_hrs = max(0.5, rh(pb_standard))
            pb_appliance_hrs = rh(pb_appliance) if labor_hours["appliance"] > 0 else 0
            # Furniture assembly is separate from standard pack-back
            pb_furniture_hrs = rh(pb_furniture) if labor_hours["furniture_disassembly"] > 0 else 0

            pack_back_labor = (
                pb_standard_hrs * crew_cost * labor_rate_adj
                + pb_appliance_hrs * crew_cost * labor_rate_adj
                + pb_supervisor * fragile_rate_adj        # 1 person
                # Note: debris/waste removal is covered by the dedicated Debris Hauling section
            )
            # Furniture assembly as separate cost (crew task)
            furniture_assembly_cost = pb_furniture_hrs * crew_cost * labor_rate_adj

            if is_on_site:
                sections["On-Site Pack-Back Move"] = round(on_site_moving_fee, 2)
            else:
                sections["Transport Back"] = round((truck_rate + loading_cost) * truck_trips, 2)
            sections["Pack-Back Labor"] = round(pack_back_labor, 2)
            if furniture_assembly_cost > 0:
                sections["Furniture Assembly"] = round(furniture_assembly_cost, 2)

        if special_item_cost > 0:
            sections["Special Items"] = round(special_item_cost, 2)

        subtotal = sum(sections.values())
        op_amount = subtotal * (request.op_rate / 100) if request.include_op else 0

        # Evaluate conditional supplements with item-level context
        hv_count = sum(
            item.quantity for room in request.rooms
            for item in room.items
            if getattr(item, "is_high_value", False)
        )
        supplements = self.evaluate_supplements(
            request.rooms, subtotal,
            overrides=getattr(request, 'supplement_overrides', None),
            context={"high_value_count": hv_count},
        )
        supplements_total = sum(s.amount for s in supplements if s.enabled)

        # Legacy contingency support
        contingency_amount = subtotal * (request.contingency_rate / 100) if request.include_contingency else 0
        grand_total = subtotal + op_amount + supplements_total + contingency_amount

        # total_hours = elapsed time (what the crew actually spends on site)
        total_hours_calc = total_labor_hours + supervisor_hours + inventory_hours + debris_hours

        # Build material_details for export/line-item rendering
        mat_detail_strs = self.build_material_detail_strings(request.rooms, materials)
        material_details = []
        for mat_key, qty in materials.items():
            code = MATERIAL_CODES.get(mat_key)
            if code:
                p = self.prices.get(code)
                unit_price = self.get_price(code)
                name = p.name if p else DEFAULT_PRICES.get(code, {}).get("name", mat_key)
                unit = p.unit if p else DEFAULT_PRICES.get(code, {}).get("unit", "EA")
                material_details.append({
                    "code": code,
                    "name": name,
                    "quantity": qty,
                    "unit": unit,
                    "unit_price": unit_price,
                    "total": round(unit_price * qty, 2),
                    "detail": mat_detail_strs.get(mat_key, ""),
                })

        room_summaries = self._build_room_summaries(request.rooms)

        # Build section_details: per-line breakdown for Pack-Out Labor and Transport
        section_details = {}

        def person_hrs(elapsed, c):
            """Convert elapsed hours × crew to total person-hours, rounded to 0.5."""
            return rh(elapsed * c)

        po_lines = []
        if po_standard_hrs > 0:
            ph = person_hrs(po_standard_hrs, crew)
            po_lines.append({
                "name": "Standard Pack-Out", "qty": ph, "unit": "HR",
                "rate": round(labor_rate, 2),
                "detail": f"{po_standard_hrs} elapsed hr · {crew}-person crew  (wrap, box, label, stage)",
                "amount": round(ph * labor_rate, 2),
            })
        if po_fragile_hrs > 0:
            ph = person_hrs(po_fragile_hrs, crew)
            po_lines.append({
                "name": "Fragile / High-Care Items", "qty": ph, "unit": "HR",
                "rate": round(fragile_rate, 2),
                "detail": f"{po_fragile_hrs} elapsed hr · {crew}-person crew  (individual wrap, double-box, condition photo)",
                "amount": round(ph * fragile_rate, 2),
            })
        if po_specialty_hrs > 0:
            ph = person_hrs(po_specialty_hrs, crew)
            po_lines.append({
                "name": "Specialty / High-Value Items", "qty": ph, "unit": "HR",
                "rate": round(specialty_rate, 2),
                "detail": f"{po_specialty_hrs} elapsed hr · {crew}-person crew  (serial# record, custom pack, high-value documentation)",
                "amount": round(ph * specialty_rate, 2),
            })
        if po_furniture_hrs > 0:
            ph = person_hrs(po_furniture_hrs, crew)
            po_lines.append({
                "name": "Furniture Disassembly", "qty": ph, "unit": "HR",
                "rate": round(labor_rate, 2),
                "detail": f"{po_furniture_hrs} elapsed hr · {crew}-person crew  (disassemble, blanket-wrap, shrink-wrap)",
                "amount": round(ph * labor_rate, 2),
            })
        if po_appliance_hrs > 0:
            ph = person_hrs(po_appliance_hrs, crew)
            po_lines.append({
                "name": "Appliance Handling", "qty": ph, "unit": "HR",
                "rate": round(labor_rate, 2),
                "detail": f"{po_appliance_hrs} elapsed hr · {crew}-person crew  (disconnect, secure internals, dolly)",
                "amount": round(ph * labor_rate, 2),
            })
        if inventory_hours > 0:
            po_lines.append({
                "name": "Inventory & Documentation", "qty": float(inventory_hours), "unit": "HR",
                "rate": round(labor_rate, 2),
                "detail": f"{inventory_hours} hr · 1 person  (photo log, written inventory per item)",
                "amount": round(inventory_hours * labor_rate, 2),
            })
        if supervisor_hours > 0:
            po_lines.append({
                "name": "Supervision", "qty": float(supervisor_hours), "unit": "HR",
                "rate": round(fragile_rate, 2),
                "detail": f"{supervisor_hours} hr · 1 supervisor  (quality control, crew coordination)",
                "amount": round(supervisor_hours * fragile_rate, 2),
            })
        if po_lines:
            section_details["Pack-Out Labor"] = {"lines": po_lines}

        def _transport_lines(trips, t_rate):
            return [
                {"name": "26' Moving Van", "qty": trips, "unit": "DY",
                 "rate": round(t_rate, 2),
                 "detail": f"{trips} trip{'s' if trips > 1 else ''}  (~500 SF capacity per trip)",
                 "amount": round(t_rate * trips, 2)},
                {"name": "Content Carry-Out (floor-weighted)", "qty": carry_person_hours, "unit": "HR",
                 "rate": round(labor_rate, 2),
                 "detail": carry_floor_note,
                 "amount": round(carry_person_hours * labor_rate, 2)},
                {"name": "Truck Loading & Securing", "qty": truck_load_person_hours, "unit": "HR",
                 "rate": round(labor_rate, 2),
                 "detail": f"{truck_load_person_hours:.1f} person-hrs  (position items, strap, fill gaps)",
                 "amount": round(truck_load_person_hours * labor_rate, 2)},
            ]

        if not is_on_site:
            section_details["Transport Out"] = {"lines": _transport_lines(truck_trips, truck_rate)}
            if "Transport Back" in sections:
                section_details["Transport Back"] = {"lines": _transport_lines(truck_trips, truck_rate)}
            if storage_cost > 0:
                _sf_rate = self.get_price("2840") or 2.20
                _setup_fee = get_storage_setup_fee(storage_sf)
                section_details["Storage"] = build_storage_section_detail(
                    storage_sf, _sf_rate, request.storage_months,
                    _setup_fee, storage_cost,
                )

        if is_on_site:
            section_details["On-Site Relocation"] = {"lines": [
                {"name": "Content Carry to Staging Area (floor-weighted)", "qty": on_site_person_hours, "unit": "HR",
                 "rate": round(labor_rate, 2),
                 "detail": carry_floor_note,
                 "amount": round(on_site_person_hours * labor_rate, 2)},
            ]}

        if request.include_packback:
            pb_lines = []
            if pb_standard_hrs > 0:
                ph = person_hrs(pb_standard_hrs, crew)
                pb_lines.append({
                    "name": "Standard Pack-Back", "qty": ph, "unit": "HR",
                    "rate": round(labor_rate, 2),
                    "detail": f"{pb_standard_hrs} elapsed hr · {crew}-person crew  (unpack, place, remove packing material)",
                    "amount": round(ph * labor_rate, 2),
                })
            if pb_appliance_hrs > 0:
                ph = person_hrs(pb_appliance_hrs, crew)
                pb_lines.append({
                    "name": "Appliance Reconnection", "qty": ph, "unit": "HR",
                    "rate": round(labor_rate, 2),
                    "detail": f"{pb_appliance_hrs} elapsed hr · {crew}-person crew  (reconnect utilities, test operation)",
                    "amount": round(ph * labor_rate, 2),
                })
            if pb_supervisor > 0:
                pb_lines.append({
                    "name": "Supervision", "qty": float(pb_supervisor), "unit": "HR",
                    "rate": round(fragile_rate, 2),
                    "detail": f"{pb_supervisor} hr · 1 supervisor  (placement verification, damage check)",
                    "amount": round(pb_supervisor * fragile_rate, 2),
                })
            if pb_lines:
                section_details["Pack-Back Labor"] = {"lines": pb_lines}
            if furniture_assembly_cost > 0:
                ph = person_hrs(pb_furniture_hrs, crew)
                section_details["Furniture Assembly"] = {"lines": [
                    {"name": "Furniture Reassembly", "qty": ph, "unit": "HR",
                     "rate": round(labor_rate, 2),
                     "detail": f"{pb_furniture_hrs} elapsed hr · {crew}-person crew  (reassemble disassembled pieces)",
                     "amount": round(ph * labor_rate, 2)},
                ]}

        # Debris Hauling section_details — show exactly what drove the charge
        section_details["Debris Hauling"] = {"lines": [
            {"name": "Debris Hauling", "qty": debris_hours, "unit": "HR",
             "rate": round(labor_rate_adj, 2),
             "detail": _debris_desc,
             "amount": round(debris_cost, 2)},
        ]}

        return EstimateResponse(
            total_rooms=len(request.rooms),
            total_items=total_items,
            total_hours=round(total_hours_calc, 1),
            crew_size=request.crew_size,
            sections=sections,
            section_details=section_details,
            materials=materials,
            material_details=material_details,
            materials_detail=mat_detail_strs,
            storage_sf=storage_sf if not is_on_site else 0,
            staging_type=request.staging_type,
            room_summaries=room_summaries,
            subtotal=round(subtotal, 2),
            include_op=request.include_op,
            op_rate=request.op_rate,
            op_amount=round(op_amount, 2),
            include_contingency=request.include_contingency,
            contingency_rate=request.contingency_rate,
            contingency_amount=round(contingency_amount, 2),
            supplements=supplements,
            supplements_total=round(supplements_total, 2),
            grand_total=round(grand_total, 2),
        )

    @staticmethod
    def _derive_hints(items: List[DetectedContentItem]) -> list:
        """Fallback: derive content hints from item categories."""
        category_to_hint = {
            "Furniture": "furniture", "Electronics": "electronics", "Books": "books",
            "Kitchenware": "kitchenware", "Clothing": "clothing_hanging",
            "Fragile": "fragile", "Artwork": "artwork", "Collectibles": "collectibles",
            "Appliances": "appliances_small", "Tools": "tools", "Sports": "sports",
        }
        return list({category_to_hint[i.category] for i in items if i.category in category_to_hint})

    def get_prices_dict(self) -> Dict[str, float]:
        """Export all prices as a flat dict for use by export service."""
        result = {}
        for code, p in self.prices.items():
            result[code] = p.price
        # Also add named lookups used by export.py
        CODE_TO_NAME = {
            "2825": "labor", "2911": "labor_fragile", "2912": "labor_specialty",
            "2934": "truck_26", "2840": "storage_sf", "2844": "storage_setup",
        }
        for code, name in CODE_TO_NAME.items():
            price = self.get_price(code)
            if price > 0:
                result[name] = price
        # Material key-based prices
        for key, code in MATERIAL_CODES.items():
            price = self.get_price(code)
            if price > 0:
                result[key] = price
        return result


def get_calculator(db: Session, company_id=None) -> EstimateCalculator:
    """Factory function to create calculator instance."""
    return EstimateCalculator(db, company_id)
