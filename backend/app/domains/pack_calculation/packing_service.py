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
from app.domains.pack_calculation.item_plan import (
    apply_plan,
    method_label,
    plan_item,
)
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


def estimate_line(name: str, qty: float, unit: str, rate: float, detail: str = "") -> dict:
    """One line of an estimate. Its amount is what the page shows, qty × rate to the
    cent, and everything above it adds these up, so the numbers can't disagree."""
    rate = round(rate, 2)
    return {
        "name": name,
        "qty": qty,
        "unit": unit,
        "rate": rate,
        "detail": detail,
        "amount": round(qty * rate, 2),
    }


def section_totals(section_details: Dict[str, Any]) -> Dict[str, float]:
    """A section's total is the sum of its lines."""
    return {
        name: round(sum(line["amount"] for line in detail["lines"]), 2)
        for name, detail in section_details.items()
    }


def build_storage_section_detail(
    storage_sf: int,
    sf_rate: float,
    storage_months: int,
    setup_fee: float,
) -> dict:
    """Build a section_detail dict for the Storage line item.

    Shows the unit dimensions, per-SF rate, and month breakdown so the
    adjuster can see exactly how the charge was computed.
    """
    unit_label = STORAGE_UNIT_LABELS.get(storage_sf, f"{storage_sf} SF")
    monthly_sf_cost = round(storage_sf * sf_rate, 2)
    return {"lines": [
        estimate_line(
            f"Climate-Controlled Storage — {unit_label} unit ({storage_sf} SF)",
            storage_months, "MO", monthly_sf_cost,
            f"{storage_sf} SF × ${sf_rate:.2f}/SF/mo = ${monthly_sf_cost:.2f}/mo",
        ),
        estimate_line(
            "Storage Setup & Inventory Placement",
            1, "EA", setup_fee,
            f"Shelving, padlock, item placement & first-access coordination  ({unit_label} unit)",
        ),
    ]}


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
                        f"{item.name}: {method_label(item.packing_method)}"
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

    def _material_lines(self, materials: Dict[str, int], describe) -> Tuple[list, list]:
        """The Materials section's lines and the material table, from one calculation."""
        lines = []
        material_details = []
        for mat_key, qty in materials.items():
            code = MATERIAL_CODES.get(mat_key)
            if not code or qty <= 0:
                continue
            unit_price = round(self.get_price(code), 2)
            if unit_price <= 0:
                continue
            p = self.prices.get(code)
            name = p.name if p else DEFAULT_PRICES.get(code, {}).get("name", mat_key)
            unit = p.unit if p else DEFAULT_PRICES.get(code, {}).get("unit", "EA")
            line = estimate_line(name, qty, unit, unit_price, describe(mat_key))
            lines.append(line)
            material_details.append({
                "code": code,
                "name": name,
                "quantity": qty,
                "unit": unit,
                "unit_price": unit_price,
                "total": line["amount"],
                "detail": line["detail"],
            })
        return lines, material_details

    @staticmethod
    def _special_item_lines(request) -> list:
        """Fixed-cost lines, not affected by region/density/floor.
        Merges request-level + per-room special items."""
        keys = set(getattr(request, 'special_items', []))
        customs = list(getattr(request, 'custom_special_items', []))
        for room_input in request.rooms:
            keys.update(getattr(room_input, 'special_items', []))
            customs.extend(getattr(room_input, 'custom_special_items', []))

        note = "Fixed-cost specialty item — independent of density/floor/region"
        lines = []
        for key in sorted(keys):
            spec = SPECIAL_ITEM_COSTS.get(key)
            if spec:
                lines.append(estimate_line(spec["name"], 1, spec["unit"], spec["price"], note))
        for custom in customs:
            lines.append(estimate_line(custom.name, 1, "EA", custom.price, note))
        return lines

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

        # Transport & Storage costs depend on staging type
        is_on_site = request.staging_type == StagingType.ON_SITE
        quick_num_rooms = len(request.rooms)
        quick_loading_hours = max(2.0, quick_num_rooms * 0.5)

        # On-site: no truck, just crew moving contents within the property
        quick_on_site_hours = max(1.5, quick_num_rooms * 0.35)

        # Storage (per SF) - always calculate SF for display
        storage_sf = self.estimate_storage_sf_from_rooms(
            request.rooms
        )
        has_storage = not is_on_site and request.storage_months > 0 and storage_sf > 0

        # Smart truck selection based on job size
        _, truck_rate = self.select_truck(storage_sf)
        # Truck trips: large van holds ~500 SF
        quick_truck_trips = max(
            1, math.ceil(storage_sf / 500)
        ) if storage_sf > 0 else 1

        room_summaries = self._build_room_summaries_from_hints(
            request.rooms
        )

        # Every line of the estimate; each section's total is the sum of its lines
        section_details: Dict[str, Any] = {}
        crew = request.crew_size
        specialty_rate = self.get_price("2912") or 127.74

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
            estimate_line(
                "Pack-Out Crew Labor", _po_crew_hours, "HR", labor_rate,
                f"{crew}-person crew, professional packing of all contents including wrapping, boxing, labeling, and loading",
            ),
            estimate_line(
                "Supervisor/Foreman", supervisor_hours, "HR", supervisor_rate,
                f"On-site supervision across {len(request.rooms)} rooms, inventory documentation, quality control",
            ),
            estimate_line(
                "Specialized Handling", _po_specialized_hours, "HR", specialty_rate,
                "Electronics, fragile items, artwork — includes extra care packaging and custom crating as needed",
            ),
        ]}

        mat_lines, material_details = self._material_lines(
            materials, lambda mat_key: MATERIAL_DETAIL.get(mat_key, "Packing supply"),
        )
        section_details["Materials"] = {"lines": mat_lines}

        def _rh(x):
            return round(x * 2) / 2

        _on_site_ph = crew * quick_on_site_hours
        _t_lines = [
            estimate_line(
                "26' Moving Van", quick_truck_trips, "DY", truck_rate,
                f"{quick_truck_trips} trip{'s' if quick_truck_trips > 1 else ''}  (~500 SF capacity per trip)",
            ),
            estimate_line(
                "Loading / Unloading Labor", _rh(quick_loading_hours * crew) * quick_truck_trips, "HR", labor_rate,
                f"{quick_loading_hours:.1f} elapsed hr · {crew}-person crew  (stage, load, secure, unload)",
            ),
        ]

        if is_on_site:
            section_details["On-Site Relocation"] = {"lines": [
                estimate_line(
                    "Move Contents to Staging Area", _on_site_ph, "HR", labor_rate,
                    f"{quick_on_site_hours:.1f} elapsed hr · {crew}-person crew  (move contents to the staging area on site)",
                ),
            ]}
        else:
            section_details["Transport Out"] = {"lines": _t_lines}
            if has_storage:
                section_details["Storage"] = build_storage_section_detail(
                    storage_sf, self.get_price("2840") or 2.20, request.storage_months,
                    get_storage_setup_fee(storage_sf),
                )

        if request.include_packback:
            if is_on_site:
                section_details["On-Site Pack-Back Move"] = {"lines": [
                    estimate_line(
                        "Move Contents Back from Staging Area", _on_site_ph, "HR", labor_rate,
                        f"{quick_on_site_hours:.1f} elapsed hr · {crew}-person crew  (move contents back to the restored rooms)",
                    ),
                ]}
            else:
                section_details["Transport Back"] = {"lines": _t_lines}

            # Split Pack-Back into sub-lines matching PDF format
            _pb_crew_base = max(8, round(pack_back_hours * 0.65))
            _pb_reassembly = max(2, round(pack_back_hours * 0.12))
            _pb_appliance = max(1, round(pack_back_hours * 0.06))
            _pb_waste = max(1, round(pack_back_hours * 0.06))
            _pb_supervisor = max(2, round(pack_back_hours * 0.12))
            _pb_total_crew = _pb_crew_base + _pb_reassembly + _pb_appliance + _pb_waste
            _spec_ratio = _po_specialized_hours / max(1, _po_crew_hours + _po_specialized_hours)
            _pb_specialized = max(1, round(_pb_total_crew * _spec_ratio))

            section_details["Pack-Back Labor"] = {"lines": [
                estimate_line(
                    "Pack-Back Crew Labor", _pb_total_crew, "HR", labor_rate,
                    f"{crew}-person crew, unloading, placement, furniture reassembly, and unpacking",
                ),
                estimate_line(
                    "Supervisor/Foreman", _pb_supervisor, "HR", supervisor_rate,
                    "Pack-back oversight, quality control, client walkthrough",
                ),
                estimate_line(
                    "Specialized Handling", _pb_specialized, "HR", specialty_rate,
                    "Electronics, fragile items, artwork — careful unpacking and placement",
                ),
            ]}

        special_lines = self._special_item_lines(request)
        if special_lines:
            section_details["Special Items"] = {"lines": special_lines}

        section_details = {name: d for name, d in section_details.items() if d["lines"]}
        sections = section_totals(section_details)

        subtotal = round(sum(sections.values()), 2)
        op_amount = round(subtotal * (request.op_rate / 100), 2) if request.include_op else 0

        # Evaluate conditional supplements
        supplements = self.evaluate_supplements(
            request.rooms, subtotal,
            overrides=getattr(request, 'supplement_overrides', None),
        )
        supplements_total = round(sum(s.amount for s in supplements if s.enabled), 2)

        # Legacy contingency (backwards compat, defaults off)
        contingency_amount = round(subtotal * (request.contingency_rate / 100), 2) if request.include_contingency else 0
        grand_total = round(subtotal + op_amount + supplements_total + contingency_amount, 2)

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

    # ── Item-based labor estimation ──────────────────────────────────
    # Each item's person-hours come from item_plan: what it is, its size and
    # weight, fragile or not. Rooms add what a photo can't show and how hard the
    # room is to work in.

    # Contents the photos can't show (drawers, cabinets, closets), in person-hours
    UNSEEN_CONTENT_HOURS = {"small": 0.75, "large": 1.5, "xlarge": 2.0}

    # A crowded room slows each item; having more items is already counted
    CROWDING_MULTIPLIERS = {"light": 1.0, "normal": 1.0, "dense": 1.1, "heavy": 1.2, "extreme": 1.35}

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

    # Per-room carry overhead: navigate hallway, hold/prop doors, position dolly, clear path.
    # 8.0 min was too aggressive for a single room; 5.0 min is realistic.
    ROOM_CARRY_OVERHEAD_MINS: float = 5.0

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
                carry = plan_item(item).carry_minutes * (item.quantity or 1)
                room_mins += carry * mult
                room_raw_mins += carry
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
        """Add up what every item's plan needs, room by room.

        Items in a room share boxes and rolls, so amounts round up per room.
        Packing paper is accumulated as a raw item count across ALL items,
        then converted to 50-lb bundles once at the end.
        """
        materials: Dict[str, int] = {}
        packing_paper_raw = 0  # accumulate raw item count across all items

        for room in rooms:
            room_amounts: Dict[str, float] = {}
            for item in room.items:
                for mat_key, per_unit in plan_item(item).materials.items():
                    if mat_key == "packing_paper":
                        packing_paper_raw += per_unit * item.quantity
                    else:
                        room_amounts[mat_key] = room_amounts.get(mat_key, 0) + per_unit * item.quantity
            for mat_key, amount in room_amounts.items():
                # Fractions of a box add up inexactly, so 1.0000001 boxes stays 1
                materials[mat_key] = materials.get(mat_key, 0) + math.ceil(amount - 1e-9)

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
                for mat_key in plan_item(item).materials:
                    if mat_key in materials:
                        cat = getattr(item, "category", None) or "General"
                        mat_cats[mat_key].add(cat)

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

    def classify_labor_hours(
        self, rooms: List[Any]
    ) -> Dict[str, float]:
        """Person-hours by labor tier across the job, from what's in each room.

        Each item brings its own hours, in the tier its handling calls for.
        Floor and contamination slow everything in the room; density scales the
        contents the photos can't show.
        """
        hours = {
            "standard": 0.0,
            "fragile": 0.0,
            "specialty": 0.0,
            "furniture_disassembly": 0.0,
            "appliance": 0.0,
        }

        for room in rooms:
            density_mult = DENSITY_MULTIPLIERS.get(room.density, 1.0)
            floor_mult = FLOOR_MULTIPLIERS.get(room.floor, 1.0)
            contamination_mult = CONTAMINATION_MULTIPLIERS.get(
                getattr(room, 'contamination', 'clean'), 1.0
            )
            room_mult = floor_mult * contamination_mult

            unseen = self.UNSEEN_CONTENT_HOURS.get(self._get_room_size(room), 1.0)
            hours["standard"] += unseen * density_mult * room_mult

            item_mult = room_mult * self.CROWDING_MULTIPLIERS.get(room.density, 1.0)
            for item in getattr(room, 'items', []):
                for tier, tier_hours in plan_item(item).tier_hours.items():
                    hours[tier] += tier_hours * item_mult

        return {tier: round(value, 1) for tier, value in hours.items()}

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

        for room in request.rooms:
            # The AI wasn't sure these are there; they count once someone keeps them
            room.items = [i for i in room.items if "presence" not in i.uncertain_fields]
            # The price comes from the item's attributes, whatever the screen last showed
            for item in room.items:
                apply_plan(item)

        total_items = sum(item.quantity for room in request.rooms for item in room.items)

        # --- Materials: aggregate from each item's plan ---
        materials = self.aggregate_item_materials(request.rooms)

        # Fallback: if no materials at all, use hint-based calculation
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

        # --- Labor tiers ---
        # classify_labor_hours returns PERSON-HOURS (single-worker equivalent).
        # Divide by crew_size to get ELAPSED hours (crew works in parallel).
        person_hours = self.classify_labor_hours(request.rooms)
        crew = request.crew_size
        total_labor_hours = sum(person_hours.values()) / crew

        labor_rate = self.get_price("2825") or 59.03      # Standard (per person/hr)
        fragile_rate = self.get_price("2911") or 89.75     # Fragile / Supervisor
        specialty_rate = self.get_price("2912") or 127.74  # Specialty (fallback)

        # Regional labor premium (Northeast +30%, West +20%, etc.)
        region_str = request.region.value if hasattr(request.region, 'value') else str(getattr(request, 'region', 'midwest'))
        region_mult = REGION_MULTIPLIERS.get(region_str, 1.0)
        labor_rate_adj = labor_rate * region_mult
        fragile_rate_adj = fragile_rate * region_mult
        specialty_rate_adj = specialty_rate * region_mult

        # Pack-out / pack-back split
        # Pack-out is more labor-intensive: inventory, assessment, wrapping, packing, documenting
        # Pack-back is simpler: unload, place, unpack (no inventory/wrapping needed)
        packout_fraction = 0.62 if request.include_packback else 0.85
        packback_fraction = 0.38 if request.include_packback else 0.0

        def rh(x):
            """Round to nearest 0.5."""
            return round(x * 2) / 2

        def tier_ph(tier, fraction):
            """A tier's share of person-hours to the quarter hour, so one item's
            hours still show; a tier with any work keeps at least that."""
            return max(0.25, round(person_hours[tier] * fraction * 4) / 4) if person_hours[tier] > 0 else 0

        def elapsed(ph):
            """Hours on the clock for this crew."""
            return round(ph / crew, 1)

        # Inventory & documentation: 1 person does this, not full crew
        inventory_hours = rh(total_labor_hours * 0.09) if total_labor_hours > 2 else 0.5
        # Supervisor: 1 person, not full crew
        supervisor_hours = rh(total_labor_hours * 0.15) if total_labor_hours > 2 else 0.5

        # Pack-out person-hours per tier
        po_standard_ph = max(0.5, tier_ph("standard", packout_fraction))
        po_fragile_ph = tier_ph("fragile", packout_fraction)
        po_specialty_ph = tier_ph("specialty", packout_fraction)
        po_furniture_ph = tier_ph("furniture_disassembly", packout_fraction)
        po_appliance_ph = tier_ph("appliance", packout_fraction)

        # Transport & Storage costs depend on staging type
        is_on_site = request.staging_type == StagingType.ON_SITE
        num_rooms = len(request.rooms)

        # Floor-weighted carry labor: physically moving packed items from rooms to truck/staging
        carry_person_hours, carry_floor_note = self._calculate_relocation_hours(request.rooms)
        # Truck loading/securing on top (flat add: position items, strap, fill gaps)
        truck_load_person_hours = rh(max(1.0, num_rooms * 0.5))

        # Storage (per SF based on content volume)
        storage_sf = self.estimate_storage_sf_from_items(
            request.rooms
        )
        has_storage = not is_on_site and request.storage_months > 0 and storage_sf > 0

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
        # Build description for section_details
        _debris_desc_parts = []
        if disposable_box_qty:
            _debris_desc_parts.append(f"{disposable_box_qty} boxes")
        if packing_paper_qty:
            _debris_desc_parts.append(f"{packing_paper_qty} paper bundle(s)")
        _debris_desc = (
            (", ".join(_debris_desc_parts) + "  ·  ") if _debris_desc_parts else ""
        ) + "flatten, bundle & haul spent packing materials post-pack-out"

        # Truck trips: 26' van holds ~500 SF worth of contents
        truck_trips = max(1, math.ceil(storage_sf / 500)) if storage_sf > 0 else 1

        # total_hours = elapsed time (what the crew actually spends on site)
        total_hours_calc = total_labor_hours + supervisor_hours + inventory_hours + debris_hours

        room_summaries = self._build_room_summaries(request.rooms)

        # Every line of the estimate, at the rate charged: labor carries the region's
        # multiplier; the truck, materials, storage and special items don't.
        # Each section's total is the sum of its lines.
        section_details: Dict[str, Any] = {}

        def crew_line(name, ph, rate, work):
            return estimate_line(
                name, ph, "HR", rate, f"{elapsed(ph)} elapsed hr · {crew}-person crew  ({work})",
            )

        po_lines = []
        if po_standard_ph > 0:
            po_lines.append(crew_line("Standard Pack-Out", po_standard_ph, labor_rate_adj, "wrap, box, label, stage"))
        if po_fragile_ph > 0:
            po_lines.append(crew_line(
                "Fragile / High-Care Items", po_fragile_ph, fragile_rate_adj,
                "individual wrap, double-box, condition photo",
            ))
        if po_specialty_ph > 0:
            po_lines.append(crew_line(
                "Specialty / High-Value Items", po_specialty_ph, specialty_rate_adj,
                "serial# record, custom pack, high-value documentation",
            ))
        if po_furniture_ph > 0:
            po_lines.append(crew_line(
                "Furniture Disassembly", po_furniture_ph, labor_rate_adj,
                "disassemble, blanket-wrap, shrink-wrap",
            ))
        if po_appliance_ph > 0:
            po_lines.append(crew_line(
                "Appliance Handling", po_appliance_ph, labor_rate_adj,
                "disconnect, secure internals, dolly",
            ))
        # Inventory & supervisor are single-person tasks
        if inventory_hours > 0:
            po_lines.append(estimate_line(
                "Inventory & Documentation", float(inventory_hours), "HR", labor_rate_adj,
                f"{inventory_hours} hr · 1 person  (photo log, written inventory per item)",
            ))
        if supervisor_hours > 0:
            po_lines.append(estimate_line(
                "Supervision", float(supervisor_hours), "HR", fragile_rate_adj,
                f"{supervisor_hours} hr · 1 supervisor  (quality control, crew coordination)",
            ))
        section_details["Pack-Out Labor"] = {"lines": po_lines}

        mat_detail_strs = self.build_material_detail_strings(request.rooms, materials)
        mat_lines, material_details = self._material_lines(
            materials, lambda mat_key: mat_detail_strs.get(mat_key, ""),
        )
        section_details["Materials"] = {"lines": mat_lines}

        def transport_lines():
            return [
                estimate_line(
                    "26' Moving Van", truck_trips, "DY", truck_rate,
                    f"{truck_trips} trip{'s' if truck_trips > 1 else ''}  (~500 SF capacity per trip)",
                ),
                estimate_line(
                    "Content Carry-Out (floor-weighted)", carry_person_hours * truck_trips, "HR",
                    labor_rate_adj, carry_floor_note,
                ),
                estimate_line(
                    "Truck Loading & Securing", truck_load_person_hours * truck_trips, "HR", labor_rate_adj,
                    f"{truck_load_person_hours:.1f} person-hrs  (position items, strap, fill gaps)",
                ),
            ]

        if is_on_site:
            # On-site staging: same carry labor (no truck loading overhead)
            section_details["On-Site Relocation"] = {"lines": [
                estimate_line(
                    "Content Carry to Staging Area (floor-weighted)", carry_person_hours, "HR",
                    labor_rate_adj, carry_floor_note,
                ),
            ]}
        else:
            section_details["Transport Out"] = {"lines": transport_lines()}
            if has_storage:
                section_details["Storage"] = build_storage_section_detail(
                    storage_sf, self.get_price("2840") or 2.20, request.storage_months,
                    get_storage_setup_fee(storage_sf),
                )

        # Debris Hauling section_details — show exactly what drove the charge
        section_details["Debris Hauling"] = {"lines": [
            estimate_line("Debris Hauling", debris_hours, "HR", labor_rate_adj, _debris_desc),
        ]}

        if request.include_packback:
            if is_on_site:
                section_details["On-Site Pack-Back Move"] = {"lines": [
                    estimate_line(
                        "Content Carry Back from Staging Area (floor-weighted)", carry_person_hours, "HR",
                        labor_rate_adj, carry_floor_note,
                    ),
                ]}
            else:
                section_details["Transport Back"] = {"lines": transport_lines()}

            pb_supervisor = rh(total_labor_hours * packback_fraction * 0.10) if total_labor_hours > 2 else 0.5

            # Pack-back is simpler: unload, unpack, place — no wrapping/inventory needed,
            # so fragile and high-value items unpack at the standard rate
            unpacking_hours = person_hours["standard"] + person_hours["fragile"] + person_hours["specialty"]
            pb_standard_ph = max(0.5, round(unpacking_hours * packback_fraction * 4) / 4)
            pb_appliance_ph = tier_ph("appliance", packback_fraction)
            # Furniture assembly is separate from standard pack-back
            pb_furniture_ph = tier_ph("furniture_disassembly", packback_fraction)

            pb_lines = [crew_line(
                "Standard Pack-Back", pb_standard_ph, labor_rate_adj,
                "unpack, place, remove packing material",
            )]
            if pb_appliance_ph > 0:
                pb_lines.append(crew_line(
                    "Appliance Reconnection", pb_appliance_ph, labor_rate_adj,
                    "reconnect utilities, test operation",
                ))
            # Note: debris/waste removal is covered by the dedicated Debris Hauling section
            if pb_supervisor > 0:
                pb_lines.append(estimate_line(
                    "Supervision", float(pb_supervisor), "HR", fragile_rate_adj,
                    f"{pb_supervisor} hr · 1 supervisor  (placement verification, damage check)",
                ))
            section_details["Pack-Back Labor"] = {"lines": pb_lines}

            if pb_furniture_ph > 0:
                section_details["Furniture Assembly"] = {"lines": [crew_line(
                    "Furniture Reassembly", pb_furniture_ph, labor_rate_adj,
                    "reassemble disassembled pieces",
                )]}

        special_lines = self._special_item_lines(request)
        if special_lines:
            section_details["Special Items"] = {"lines": special_lines}

        section_details = {name: d for name, d in section_details.items() if d["lines"]}
        sections = section_totals(section_details)

        subtotal = round(sum(sections.values()), 2)
        op_amount = round(subtotal * (request.op_rate / 100), 2) if request.include_op else 0

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
        supplements_total = round(sum(s.amount for s in supplements if s.enabled), 2)

        # Legacy contingency support
        contingency_amount = round(subtotal * (request.contingency_rate / 100), 2) if request.include_contingency else 0
        grand_total = round(subtotal + op_amount + supplements_total + contingency_amount, 2)

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
