"""
Pack Estimate Prompts

Phase 1: Photo Analysis for Content Pack-Out Inventory
Phase 2: Estimate Generation with Pricing Data

Enhanced to support various packing materials and methods based on real pack-out workflows.
"""

from typing import Optional

# =============================================================================
# PACKING MATERIAL TYPES & METHODS REFERENCE
# =============================================================================

# Box Types with specifications
BOX_TYPES = {
    "SMALL_BOX": {
        "code": "BXSM",
        "name": "Small Box (1.5 cu ft)",
        "unit_price": 3.50,
        "use_cases": ["books", "small items", "heavy items", "canned goods", "tools"],
        "max_weight_lbs": 50
    },
    "MEDIUM_BOX": {
        "code": "BXMD",
        "name": "Medium Box (3.0 cu ft)",
        "unit_price": 4.50,
        "use_cases": ["general household", "kitchen items", "toys", "shoes", "small appliances"],
        "max_weight_lbs": 40
    },
    "LARGE_BOX": {
        "code": "BXLG",
        "name": "Large Box (4.5 cu ft)",
        "unit_price": 5.50,
        "use_cases": ["lightweight bulky items", "linens", "pillows", "lampshades", "plastic containers"],
        "max_weight_lbs": 30
    },
    "EXTRA_LARGE_BOX": {
        "code": "BXXL",
        "name": "Extra Large Box (6.0 cu ft)",
        "unit_price": 7.00,
        "use_cases": ["comforters", "large lightweight items", "artificial trees"],
        "max_weight_lbs": 25
    },
    "WARDROBE_BOX": {
        "code": "BXWB",
        "name": "Wardrobe Box (24x24x48)",
        "unit_price": 12.00,
        "use_cases": ["hanging clothes", "coats", "dresses", "suits", "long textiles", "throw blankets"],
        "max_weight_lbs": 40
    },
    "DISH_PACK_BOX": {
        "code": "BXDSH",
        "name": "Dish Pack Box (18x18x28)",
        "unit_price": 8.00,
        "use_cases": ["dishes", "glassware", "china", "fragile kitchen items"],
        "max_weight_lbs": 45
    },
    "PICTURE_BOX": {
        "code": "BXPIC",
        "name": "Picture/Mirror Box (Adjustable)",
        "unit_price": 15.00,
        "use_cases": ["framed artwork", "mirrors", "glass tabletops", "flat screen TVs", "glass items"],
        "max_weight_lbs": 50
    },
    "LONG_BOX": {
        "code": "BXLNG",
        "name": "Long Box (9x9x48)",
        "unit_price": 6.00,
        "use_cases": ["curtain rods", "golf clubs", "fishing rods", "brooms", "mops", "cleaning tools", "floor lamps"],
        "max_weight_lbs": 30
    },
    "LAMP_BOX": {
        "code": "BXLMP",
        "name": "Lamp Box (12x12x48)",
        "unit_price": 10.00,
        "use_cases": ["table lamps", "floor lamp shades", "tall vases"],
        "max_weight_lbs": 20
    },
    "FILE_BOX": {
        "code": "BXFIL",
        "name": "File/Document Box",
        "unit_price": 4.00,
        "use_cases": ["files", "documents", "records", "legal papers"],
        "max_weight_lbs": 35
    },
    "WINE_BOX": {
        "code": "BXWNE",
        "name": "Wine Box with Dividers",
        "unit_price": 8.00,
        "use_cases": ["wine bottles", "liquor bottles", "olive oil bottles"],
        "max_weight_lbs": 50
    },
    "MATTRESS_BOX": {
        "code": "BXMAT",
        "name": "Mattress Box/Bag",
        "unit_price": 20.00,
        "use_cases": ["mattresses", "box springs"],
        "sizes": ["Twin", "Full", "Queen", "King"]
    },
    "TV_BOX": {
        "code": "BXTV",
        "name": "TV Box with Foam",
        "unit_price": 35.00,
        "use_cases": ["flat screen TVs", "monitors", "large electronics"],
        "sizes": ["32-42 inch", "43-55 inch", "56-70 inch", "71-85 inch"]
    },
    "TUBE_BOX": {
        "code": "BXTUB",
        "name": "Poster/Art Tube",
        "unit_price": 8.00,
        "use_cases": ["rolled artwork", "posters", "blueprints", "tapestries", "rugs (small)"]
    }
}

# Packing Supplies
PACKING_SUPPLIES = {
    "PACKING_PAPER": {
        "code": "PPRBND",
        "name": "Packing Paper Bundle (25 lbs)",
        "unit_price": 18.00,
        "coverage": "10-15 boxes worth"
    },
    "BUBBLE_WRAP": {
        "code": "BBWRRL",
        "name": "Bubble Wrap Roll (12\" x 175')",
        "unit_price": 25.00,
        "coverage": "8-10 fragile items"
    },
    "BUBBLE_WRAP_LARGE": {
        "code": "BBWRLG",
        "name": "Bubble Wrap Roll Large (24\" x 175')",
        "unit_price": 45.00,
        "coverage": "furniture surfaces, large items"
    },
    "PACKING_TAPE": {
        "code": "TPPACK",
        "name": "Packing Tape Roll",
        "unit_price": 4.00,
        "coverage": "5-8 boxes"
    },
    "FRAGILE_TAPE": {
        "code": "TPFRAG",
        "name": "Fragile/Handle with Care Tape",
        "unit_price": 6.00
    },
    "STRETCH_WRAP": {
        "code": "SHRWRAP",
        "name": "Stretch Wrap Roll (18\" x 1500')",
        "unit_price": 12.00,
        "use_cases": ["furniture wrap", "drawer securing", "bundling items"]
    },
    "FURNITURE_PAD": {
        "code": "FRNPAD",
        "name": "Furniture Pad/Moving Blanket",
        "unit_price": 8.00,
        "rental_price": 3.00
    },
    "PLASTIC_WRAP": {
        "code": "PLSWRP",
        "name": "Plastic Sheeting Roll",
        "unit_price": 15.00,
        "use_cases": ["mattress protection", "upholstery protection", "outdoor items"]
    },
    "FOAM_WRAP": {
        "code": "FMWRAP",
        "name": "Foam Wrap Roll (12\" x 70')",
        "unit_price": 20.00,
        "use_cases": ["electronics", "delicate surfaces", "antiques"]
    },
    "CORNER_PROTECTOR": {
        "code": "CRNPRO",
        "name": "Cardboard Corner Protectors (4-pack)",
        "unit_price": 4.00,
        "use_cases": ["picture frames", "mirrors", "furniture corners", "TVs"]
    },
    "CELL_DIVIDERS": {
        "code": "CELDIV",
        "name": "Cell Box Dividers (for dish boxes)",
        "unit_price": 3.00
    },
    "ACID_FREE_PAPER": {
        "code": "PPRACD",
        "name": "Acid-Free Tissue Paper (100 sheets)",
        "unit_price": 12.00,
        "use_cases": ["artwork", "antiques", "silver", "delicate fabrics"]
    },
    "SILICA_GEL": {
        "code": "SILGEL",
        "name": "Silica Gel Packets (20-pack)",
        "unit_price": 8.00,
        "use_cases": ["electronics", "leather goods", "climate sensitive items"]
    },
    "MARKER_LABEL_KIT": {
        "code": "MKRLBL",
        "name": "Marker & Label Kit",
        "unit_price": 8.00
    },
    "INVENTORY_TAGS": {
        "code": "INVTAG",
        "name": "Inventory Tags (100-pack)",
        "unit_price": 15.00
    }
}

# Special Handling Categories
SPECIAL_HANDLING = {
    "FRAGILE": {
        "label": "FRAGILE",
        "requirements": ["bubble wrap", "corner protectors", "fragile tape", "picture box or dish box"],
        "labor_multiplier": 1.3
    },
    "HEAVY": {
        "label": "Heavy Item",
        "requirements": ["2-person lift required", "furniture dolly", "back brace"],
        "labor_multiplier": 1.5,
        "weight_threshold_lbs": 50
    },
    "TWO_PERSON_LIFT": {
        "label": "2-Person Lift Required",
        "requirements": ["team coordination", "furniture dolly or hand truck"],
        "labor_multiplier": 2.0
    },
    "ELECTRICAL": {
        "label": "Electrical/Electronics",
        "requirements": ["disconnect power", "wrap cables", "original box preferred", "anti-static protection"],
        "labor_multiplier": 1.3
    },
    "DISASSEMBLY": {
        "label": "Disassemble Required",
        "requirements": ["tools", "hardware bags", "labeling"],
        "labor_multiplier": 1.5
    },
    "CLIMATE_SENSITIVE": {
        "label": "Climate Sensitive",
        "requirements": ["climate controlled storage", "silica gel packets", "moisture barrier"],
        "labor_multiplier": 1.2
    },
    "VALUABLE": {
        "label": "High Value Item",
        "requirements": ["detailed inventory", "photography", "special insurance", "white glove handling"],
        "labor_multiplier": 1.5
    },
    "ARTWORK": {
        "label": "Artwork/Antique",
        "requirements": ["acid-free paper", "corner protectors", "picture box", "custom crating for large pieces"],
        "labor_multiplier": 1.5
    },
    "DO_NOT_PACK": {
        "label": "Do Not Pack - Fixture",
        "requirements": ["property fixture", "not to be moved"],
        "labor_multiplier": 0
    },
    "FABRIC_PROTECTION": {
        "label": "Fabric Protection Needed",
        "requirements": ["plastic wrap", "furniture pads", "upholstery protection"],
        "labor_multiplier": 1.2
    }
}

# Packing Methods by Item Category
PACKING_METHODS = {
    "FURNITURE_LARGE": {
        "method": "Wrap with furniture pads and stretch wrap",
        "materials": ["FRNPAD", "SHRWRAP", "PLSWRP"],
        "box_type": None,  # N/A - wrap only
        "notes": "Disassemble if possible, protect surfaces"
    },
    "FURNITURE_MEDIUM": {
        "method": "Wrap with furniture blankets",
        "materials": ["FRNPAD", "SHRWRAP"],
        "box_type": None
    },
    "GLASS_TABLETOP": {
        "method": "Wrap glass with bubble wrap and corner protectors, pad frame",
        "materials": ["BBWRRL", "CRNPRO", "BXPIC"],
        "box_type": "PICTURE_BOX"
    },
    "FRAMED_ARTWORK": {
        "method": "Wrap in acid-free paper, corner protectors, picture box",
        "materials": ["PPRACD", "CRNPRO", "BXPIC"],
        "box_type": "PICTURE_BOX"
    },
    "ELECTRONICS": {
        "method": "Wrap cables, anti-static protection, original box or foam lined box",
        "materials": ["FMWRAP", "BBWRRL", "SILGEL"],
        "box_type": "TV_BOX",
        "notes": "Keep upright, label FRAGILE"
    },
    "BOOKS": {
        "method": "Pack spine-down in small boxes, do not overfill",
        "materials": ["PPRBND", "BXSM"],
        "box_type": "SMALL_BOX",
        "items_per_box": 20
    },
    "DISHES": {
        "method": "Wrap each piece individually, pack vertically in dish box with dividers",
        "materials": ["PPRBND", "CELDIV", "BXDSH"],
        "box_type": "DISH_PACK_BOX"
    },
    "CLOTHING_HANGING": {
        "method": "Transfer directly to wardrobe box on hangers",
        "materials": ["BXWB"],
        "box_type": "WARDROBE_BOX",
        "items_per_box": 24
    },
    "CLOTHING_FOLDED": {
        "method": "Fold and pack in large boxes or bins",
        "materials": ["BXLG"],
        "box_type": "LARGE_BOX"
    },
    "LINENS": {
        "method": "Fold and pack in wardrobe or large boxes",
        "materials": ["BXWB", "BXLG"],
        "box_type": "WARDROBE_BOX"
    },
    "CHRISTMAS_ORNAMENTS": {
        "method": "Wrap each ornament individually in tissue, pack with dividers",
        "materials": ["PPRBND", "CELDIV", "BXSM"],
        "box_type": "SMALL_BOX"
    },
    "CLEANING_TOOLS": {
        "method": "Bundle together, wrap heads, pack in long box",
        "materials": ["BXLNG"],
        "box_type": "LONG_BOX"
    },
    "CURTAIN_ROD": {
        "method": "Wrap in bubble wrap, pack in long box with hardware",
        "materials": ["BBWRRL", "BXLNG"],
        "box_type": "LONG_BOX"
    },
    "AREA_RUG": {
        "method": "Roll tightly, wrap in plastic sheeting",
        "materials": ["PLSWRP"],
        "box_type": None,
        "notes": "Protect from moisture/dirt"
    },
    "APPLIANCE_LARGE": {
        "method": "Disconnect, defrost if needed, secure doors, dolly required",
        "materials": ["SHRWRAP", "FRNPAD"],
        "box_type": None,
        "notes": "Professional move recommended"
    },
    "TOILETRIES": {
        "method": "Check for leaks, wrap in plastic, pack upright",
        "materials": ["PLSWRP", "BXSM"],
        "box_type": "SMALL_BOX"
    }
}

# Phase 1: Photo Analysis Prompt (Enhanced)
PHASE1_PACK_ANALYSIS_PROMPT = """You are an expert content pack-out inventory specialist with deep knowledge of professional packing methods, materials, and special handling requirements.

Analyze the provided photos and create a detailed inventory following professional pack-out standards.

For each item visible, determine:
1. **Item identification** - What is it exactly?
2. **Packing method** - How should it be packed based on industry best practices?
3. **Box type needed** - Which specific box type or if N/A (furniture wrap only)
4. **Special handling** - Any special requirements (FRAGILE, Heavy, 2-Person Lift, etc.)
5. **Packing instructions** - Step-by-step professional packing guidance

AVAILABLE BOX TYPES (use exact codes):
- SMALL_BOX: Books, heavy small items, canned goods (1.5 cu ft, max 50 lbs)
- MEDIUM_BOX: General household, kitchen items, toys (3.0 cu ft, max 40 lbs)
- LARGE_BOX: Lightweight bulky items, linens, pillows (4.5 cu ft, max 30 lbs)
- EXTRA_LARGE_BOX: Comforters, artificial trees (6.0 cu ft, max 25 lbs)
- WARDROBE_BOX: Hanging clothes, coats, throw blankets (24x24x48)
- DISH_PACK_BOX: Dishes, glassware, fragile kitchen items (18x18x28)
- PICTURE_BOX: Framed artwork, mirrors, glass tabletops (adjustable)
- LONG_BOX: Curtain rods, golf clubs, brooms, mops (9x9x48)
- LAMP_BOX: Table lamps, floor lamp shades, tall vases (12x12x48)
- TV_BOX: Flat screen TVs, large monitors
- TUBE_BOX: Rolled artwork, posters, tapestries
- N/A: Furniture that is wrap-only (sofas, tables, etc.)

SPECIAL HANDLING FLAGS (use when applicable):
- FRAGILE: Glass, artwork, delicate items
- HEAVY: Items over 50 lbs
- TWO_PERSON_LIFT: Large furniture requiring 2+ people
- ELECTRICAL: Electronics requiring disconnect
- DISASSEMBLY: Items needing disassembly before moving
- VALUABLE: High-value items requiring special care
- FABRIC_PROTECTION: Upholstered items needing protection
- DO_NOT_PACK: Property fixtures that don't move

Provide your analysis in the following JSON format:
{
    "room_name": "string",
    "items": [
        {
            "item_id": "XX-001",  // Room code + sequential number (e.g., LR-001 for Living Room)
            "category": "Furniture|Electronics|Decorative|Books/Media|Clothing|Kitchenware|Personal|Specialty|Seasonal|Appliance",
            "description": "Detailed item description with key characteristics",
            "quantity": 1,
            "size_type": "Small|Medium|Large",  // Physical size of the item
            "condition": "good|fair|poor",
            "packing_method": "Detailed packing instructions for this specific item",
            "box_type": "SMALL_BOX|MEDIUM_BOX|LARGE_BOX|WARDROBE_BOX|DISH_PACK_BOX|PICTURE_BOX|LONG_BOX|LAMP_BOX|TV_BOX|TUBE_BOX|N/A",
            "special_handling": ["FRAGILE", "HEAVY", "TWO_PERSON_LIFT", "ELECTRICAL", "DISASSEMBLY", "VALUABLE", "FABRIC_PROTECTION"],
            "packing_materials_needed": ["FRNPAD", "SHRWRAP", "BBWRRL", "PPRBND", "CRNPRO"],  // Material codes
            "estimated_pack_time_minutes": 10,
            "notes": "Any special notes like color, brand, or concerns"
        }
    ],
    "room_characteristics": {
        "approximate_size": "small|medium|large",
        "density_level": "MINIMAL|MODERATE|FULL|PACKED",
        "access_notes": "Any access or space concerns"
    },
    "packing_summary": {
        "box_requirements": {
            "SMALL_BOX": 0,
            "MEDIUM_BOX": 0,
            "LARGE_BOX": 0,
            "WARDROBE_BOX": 0,
            "DISH_PACK_BOX": 0,
            "PICTURE_BOX": 0,
            "LONG_BOX": 0,
            "OTHER": 0
        },
        "supplies_needed": [
            {"code": "PPRBND", "name": "Packing Paper Bundle", "quantity": 1},
            {"code": "BBWRRL", "name": "Bubble Wrap Roll", "quantity": 1},
            {"code": "TPPACK", "name": "Packing Tape", "quantity": 2},
            {"code": "FRNPAD", "name": "Furniture Pads", "quantity": 4}
        ],
        "fragile_item_count": 0,
        "heavy_item_count": 0,
        "estimated_total_pack_time_hours": 4.0,
        "crew_size_recommended": 2,
        "special_equipment_needed": ["Furniture dolly", "Hand truck"]
    }
}
"""

# Phase 2: Estimate Generation Prompt Template
# Takes inventory data and generates line items with pricing
PHASE2_ESTIMATE_GENERATION_PROMPT_TEMPLATE = """You are an expert DMV area moving and pack-out services estimator.
Using the inventory data provided and the pricing reference data below, generate a detailed estimate.

PRICING REFERENCE DATA:
{pricing_data}

INVENTORY DATA FROM PHOTO ANALYSIS:
{inventory_data}

Generate line items for:
1. Packing labor (based on room size and density)
2. Packing materials (boxes, tape, paper, bubble wrap)
3. Special handling items (fragile, valuable, oversized)
4. Loading and unloading labor
5. Transportation (if applicable)
6. Storage preparation (if applicable)

For each line item, provide:
{
    "line_items": [
        {
            "name": "short item name",
            "description": "detailed description of work/materials",
            "quantity": number,
            "unit": "HR|EA|BX|SF|LF|LD",
            "unit_price": number,
            "total": number,
            "category": "LABOR|MATERIALS|EQUIPMENT|SPECIAL",
            "notes": "optional notes"
        }
    ],
    "summary": {
        "subtotal": number,
        "tax_rate": number,
        "tax_amount": number,
        "total": number,
        "estimated_duration_hours": number
    }
}

Use these unit abbreviations:
- HR = Hour (labor)
- EA = Each (individual items)
- BX = Box (packing supplies)
- SF = Square Foot (floor protection, etc.)
- LF = Linear Foot (tape, wrap rolls)
- LD = Load (truck loads)
"""


def get_phase1_prompt() -> str:
    """Get Phase 1 photo analysis prompt."""
    return PHASE1_PACK_ANALYSIS_PROMPT


def get_phase2_prompt(pricing_data: str, inventory_data: str) -> str:
    """
    Get Phase 2 estimate generation prompt with data.

    Args:
        pricing_data: JSON string of pricing reference data
        inventory_data: JSON string of inventory from Phase 1

    Returns:
        Formatted prompt string
    """
    return PHASE2_ESTIMATE_GENERATION_PROMPT_TEMPLATE.format(
        pricing_data=pricing_data,
        inventory_data=inventory_data
    )


# Labor Rates
LABOR_RATES = {
    "PACK_SPECIALIST_STANDARD": {
        "code": "PKOUTST",
        "name": "Pack-Out Specialist (Standard)",
        "unit_price": 65.00,
        "unit": "HR"
    },
    "PACK_TEAM_LEAD": {
        "code": "PKOUTTL",
        "name": "Pack-Out Team Lead",
        "unit_price": 75.00,
        "unit": "HR"
    },
    "PACK_SPECIALIST_FRAGILE": {
        "code": "PKOUTSP",
        "name": "Pack-Out Specialist (Specialty/Fragile)",
        "unit_price": 85.00,
        "unit": "HR"
    },
    "LOADING_UNLOADING": {
        "code": "LDUNLD",
        "name": "Loading/Unloading Labor",
        "unit_price": 55.00,
        "unit": "HR"
    },
    "TWO_PERSON_HEAVY": {
        "code": "PKOUT2P",
        "name": "2-Person Heavy Item Handling",
        "unit_price": 120.00,
        "unit": "HR"
    }
}

# Specialty Services
SPECIALTY_SERVICES = {
    "CRATING": {
        "code": "CRTSPC",
        "name": "Custom Crating Service",
        "unit_price": 150.00,
        "unit": "EA"
    },
    "ELECTRONICS_PACK": {
        "code": "ELECPK",
        "name": "Electronics Pack",
        "unit_price": 25.00,
        "unit": "EA"
    },
    "ARTWORK_PACK": {
        "code": "ARTPK",
        "name": "Artwork/Antique Pack",
        "unit_price": 45.00,
        "unit": "EA"
    },
    "HEAVY_ITEM_PACK": {
        "code": "HVYPK",
        "name": "Heavy Item Pack (100+ lbs)",
        "unit_price": 35.00,
        "unit": "EA"
    },
    "FRAGILE_PREMIUM": {
        "code": "FRAGLP",
        "name": "Fragile Item Premium Pack",
        "unit_price": 15.00,
        "unit": "EA"
    },
    "DISASSEMBLY": {
        "code": "DISMBL",
        "name": "Furniture Disassembly",
        "unit_price": 25.00,
        "unit": "EA"
    },
    "REASSEMBLY": {
        "code": "REASBL",
        "name": "Furniture Reassembly",
        "unit_price": 25.00,
        "unit": "EA"
    }
}

# Equipment Rental
EQUIPMENT = {
    "FURNITURE_DOLLY": {
        "code": "DOLLY",
        "name": "Furniture Dolly (daily)",
        "unit_price": 15.00,
        "unit": "EA"
    },
    "HAND_TRUCK": {
        "code": "HANDTK",
        "name": "Hand Truck (daily)",
        "unit_price": 10.00,
        "unit": "EA"
    },
    "APPLIANCE_DOLLY": {
        "code": "APLNCD",
        "name": "Appliance Dolly (daily)",
        "unit_price": 20.00,
        "unit": "EA"
    },
    "STAIR_DOLLY": {
        "code": "STRDLY",
        "name": "Stair Climbing Dolly (daily)",
        "unit_price": 35.00,
        "unit": "EA"
    }
}


def get_pricing_data_for_prompt() -> str:
    """
    Generate pricing data string for AI prompt from dictionaries.
    This ensures pricing data is always in sync with the structured data.
    """
    lines = []

    # Labor Rates
    lines.append("LABOR RATES:")
    for item in LABOR_RATES.values():
        lines.append(
            f"- {item['code']}: {item['name']} - "
            f"${item['unit_price']:.2f}/{item['unit']}"
        )
    lines.append("")

    # Box Types
    lines.append("BOX TYPES:")
    for item in BOX_TYPES.values():
        lines.append(
            f"- {item['code']}: {item['name']} - "
            f"${item['unit_price']:.2f}/EA"
        )
    lines.append("")

    # Packing Supplies
    lines.append("PACKING SUPPLIES:")
    for item in PACKING_SUPPLIES.values():
        lines.append(
            f"- {item['code']}: {item['name']} - "
            f"${item['unit_price']:.2f}/EA"
        )
    lines.append("")

    # Specialty Services
    lines.append("SPECIALTY SERVICES:")
    for item in SPECIALTY_SERVICES.values():
        lines.append(
            f"- {item['code']}: {item['name']} - "
            f"${item['unit_price']:.2f}/{item['unit']}"
        )
    lines.append("")

    # Equipment
    lines.append("EQUIPMENT:")
    for item in EQUIPMENT.values():
        lines.append(
            f"- {item['code']}: {item['name']} - "
            f"${item['unit_price']:.2f}/{item['unit']}"
        )

    return "\n".join(lines)


# For backward compatibility
DEFAULT_PACK_PRICING_DATA = get_pricing_data_for_prompt()


# JSON Schema for Phase 1 output validation
PHASE1_OUTPUT_SCHEMA = {
    "type": "object",
    "required": ["room_name", "items", "room_characteristics", "packing_recommendations"],
    "properties": {
        "room_name": {"type": "string"},
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["category", "description", "quantity", "size_category"],
                "properties": {
                    "category": {"type": "string"},
                    "description": {"type": "string"},
                    "quantity": {"type": "integer", "minimum": 1},
                    "condition": {"type": "string", "enum": ["good", "fair", "poor"]},
                    "size_category": {"type": "string", "enum": ["SM", "MD", "LG", "OV"]},
                    "special_handling": {"type": "array", "items": {"type": "string"}},
                    "estimated_boxes": {"type": "integer", "minimum": 0},
                    "notes": {"type": "string"}
                }
            }
        },
        "room_characteristics": {
            "type": "object",
            "properties": {
                "approximate_size": {"type": "string"},
                "density_level": {"type": "string", "enum": ["MINIMAL", "MODERATE", "FULL", "PACKED"]},
                "access_notes": {"type": "string"}
            }
        },
        "packing_recommendations": {
            "type": "object",
            "properties": {
                "estimated_total_boxes": {"type": "integer"},
                "special_supplies_needed": {"type": "array", "items": {"type": "string"}},
                "estimated_pack_time_hours": {"type": "number"}
            }
        }
    }
}


# JSON Schema for Phase 2 output validation
PHASE2_OUTPUT_SCHEMA = {
    "type": "object",
    "required": ["line_items", "summary"],
    "properties": {
        "line_items": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["name", "description", "quantity", "unit", "unit_price", "total"],
                "properties": {
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                    "quantity": {"type": "number", "minimum": 0},
                    "unit": {"type": "string", "enum": ["HR", "EA", "BX", "SF", "LF", "LD"]},
                    "unit_price": {"type": "number", "minimum": 0},
                    "total": {"type": "number", "minimum": 0},
                    "category": {"type": "string", "enum": ["LABOR", "MATERIALS", "EQUIPMENT", "SPECIAL"]},
                    "notes": {"type": "string"}
                }
            }
        },
        "summary": {
            "type": "object",
            "properties": {
                "subtotal": {"type": "number"},
                "tax_rate": {"type": "number"},
                "tax_amount": {"type": "number"},
                "total": {"type": "number"},
                "estimated_duration_hours": {"type": "number"}
            }
        }
    }
}
