"""
Seed data for item-material mappings
Based on Xactimate line items (CPS, TMC categories)
"""

from typing import Dict, List

# Item-to-Material mapping data structure:
# {
#     "item_name": {
#         "category": "furniture|electronics|appliance|boxes",
#         "size": "small|medium|large|xl",
#         "materials": {
#             "CPS_CODE": quantity_per_item
#         },
#         "weight_lb": estimated_weight,
#         "fragile": bool,
#         "requires_disassembly": bool,
#         "packing_hours": base_hours,
#         "moving_hours": base_hours
#     }
# }

ITEM_MAPPINGS: Dict[str, dict] = {
    # === BEDS ===
    "bed_twin": {
        "category": "furniture",
        "size": "small",
        "materials": {
            "CPS BX MED": 2,  # 2 medium boxes for bed frame parts
            "CPS BWRAP": 15,  # 15 ft bubble wrap
            "CPS PAD": 2,  # 2 furniture pads
            "CPS CVMT": 1,  # twin mattress cover
        },
        "weight_lb": 120,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.5,
        "moving_hours": 0.3,
    },
    "bed_full": {
        "category": "furniture",
        "size": "medium",
        "materials": {
            "CPS BX MED": 2,
            "CPS BWRAP": 18,
            "CPS PAD": 2,
            "CPS CVMF": 1,  # full mattress cover
        },
        "weight_lb": 150,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.6,
        "moving_hours": 0.4,
    },
    "bed_queen": {
        "category": "furniture",
        "size": "large",
        "materials": {
            "CPS BX LRG": 2,  # large boxes for queen bed frame
            "CPS BWRAP": 20,
            "CPS PAD": 2,
            "CPS CVMQ": 1,  # queen mattress cover
        },
        "weight_lb": 200,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.7,
        "moving_hours": 0.5,
    },
    "bed_king": {
        "category": "furniture",
        "size": "xl",
        "materials": {
            "CPS BX LRG": 3,
            "CPS BWRAP": 30,
            "CPS PAD HVY": 3,  # heavy-duty pads for king bed
            "CPS CVMK": 1,  # king mattress cover
        },
        "weight_lb": 250,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.8,
        "moving_hours": 0.7,
    },

    # === FURNITURE ===
    "desk_small": {
        "category": "furniture",
        "size": "small",
        "materials": {
            "CPS BX MED": 1,
            "CPS BWRAP": 8,
            "CPS PAD": 1,
        },
        "weight_lb": 80,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.3,
        "moving_hours": 0.3,
    },
    "desk_large": {
        "category": "furniture",
        "size": "large",
        "materials": {
            "CPS BX LRG": 1,
            "CPS BWRAP": 12,
            "CPS PAD": 2,
        },
        "weight_lb": 150,
        "fragile": False,
        "requires_disassembly": True,
        "packing_hours": 0.5,
        "moving_hours": 0.5,
    },
    "nightstand": {
        "category": "furniture",
        "size": "small",
        "materials": {
            "CPS BX MED": 1,  # small box
            "CPS BWRAP": 5,
            "CPS PAD": 1,
        },
        "weight_lb": 40,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.2,
        "moving_hours": 0.2,
    },
    "dresser_small": {
        "category": "furniture",
        "size": "medium",
        "materials": {
            "CPS BX MED": 2,
            "CPS BWRAP": 10,
            "CPS PAD": 2,
        },
        "weight_lb": 100,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.4,
        "moving_hours": 0.4,
    },
    "dresser_large": {
        "category": "furniture",
        "size": "large",
        "materials": {
            "CPS BX LRG": 3,
            "CPS BWRAP": 15,
            "CPS PAD HVY": 2,
        },
        "weight_lb": 180,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.6,
        "moving_hours": 0.6,
    },
    "wardrobe_small": {
        "category": "furniture",
        "size": "medium",
        "materials": {
            "CPS BXWDR": 1,  # 7-10 cf wardrobe box
            "CPS PAD": 2,
        },
        "weight_lb": 150,
        "fragile": False,
        "requires_disassembly": True,
        "packing_hours": 0.8,
        "moving_hours": 0.5,
    },
    "wardrobe_large": {
        "category": "furniture",
        "size": "xl",
        "materials": {
            "CPS BXWDR>": 2,  # 11-15 cf wardrobe box
            "CPS PAD HVY": 3,
            "TMC BLK": 1,  # furniture blocks
        },
        "weight_lb": 300,
        "fragile": False,
        "requires_disassembly": True,
        "packing_hours": 1.2,
        "moving_hours": 0.8,
    },
    "couch_loveseat": {
        "category": "furniture",
        "size": "medium",
        "materials": {
            "CPS CVCH>": 1,  # couch cover
            "CPS PAD HVY": 2,
            "CPS WRAP": 1,  # stretch film
        },
        "weight_lb": 120,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.3,
        "moving_hours": 0.5,
    },
    "couch_standard": {
        "category": "furniture",
        "size": "large",
        "materials": {
            "CPS CVCH>": 1,
            "CPS PAD HVY": 3,
            "CPS WRAP": 1,
        },
        "weight_lb": 200,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.4,
        "moving_hours": 0.7,
    },
    "coffee_table": {
        "category": "furniture",
        "size": "small",
        "materials": {
            "CPS PAD": 2,
            "CPS WRAP": 1,
        },
        "weight_lb": 50,
        "fragile": True,
        "requires_disassembly": False,
        "packing_hours": 0.2,
        "moving_hours": 0.2,
    },
    "dining_table": {
        "category": "furniture",
        "size": "large",
        "materials": {
            "CPS PAD HVY": 3,
            "CPS WRAP": 1,
        },
        "weight_lb": 150,
        "fragile": False,
        "requires_disassembly": True,
        "packing_hours": 0.5,
        "moving_hours": 0.6,
    },
    "chair_dining": {
        "category": "furniture",
        "size": "small",
        "materials": {
            "CPS CVCH": 1,  # chair cover
            "CPS PAD": 1,
        },
        "weight_lb": 25,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.1,
        "moving_hours": 0.1,
    },
    "bookshelf_small": {
        "category": "furniture",
        "size": "medium",
        "materials": {
            "CPS PAD": 2,
            "CPS WRAP": 1,
        },
        "weight_lb": 60,
        "fragile": False,
        "requires_disassembly": True,
        "packing_hours": 0.4,
        "moving_hours": 0.3,
    },

    # === SPECIALTY / HEAVY ITEMS ===
    "piano": {
        "category": "furniture",
        "size": "xl",
        "materials": {
            "CPS PIANO": 1,  # piano skid board rental (monthly equipment)
            "CPS PAD HVY": 8,  # heavy furniture pads
            "CPS WRAP": 2,  # stretch wrap for securing pads
        },
        "weight_lb": 600,
        "fragile": True,
        "requires_disassembly": False,
        "packing_hours": 1.5,
        "moving_hours": 2.0,
    },

    # === COMMON CONTENTS/ACCESSORIES (to cover free-form lists) ===
    "shoe_cabinet": {
        "category": "furniture",
        "size": "medium",
        "materials": {
            "CPS PAD": 2,
            "CPS WRAP": 1,
        },
        "weight_lb": 80,
        "fragile": False,
        "requires_disassembly": True,
        "packing_hours": 0.3,
        "moving_hours": 0.3,
    },
    "sofa_table": {
        "category": "furniture",
        "size": "small",
        "materials": {
            "CPS PAD": 2,
            "CPS WRAP": 1,
        },
        "weight_lb": 40,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.2,
        "moving_hours": 0.2,
    },
    "clothes_box": {
        "category": "boxes",
        "size": "large",
        "materials": {
            "CPS BXWDR": 1
        },
        "weight_lb": 25,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.0,
        "moving_hours": 0.1,
    },
    "bed_frame": {
        "category": "furniture",
        "size": "medium",
        "materials": {
            "CPS PAD": 2,
            "CPS WRAP": 1,
        },
        "weight_lb": 120,
        "fragile": False,
        "requires_disassembly": True,
        "packing_hours": 0.3,
        "moving_hours": 0.3,
    },
    "mattress": {
        "category": "furniture",
        "size": "large",
        "materials": {
            "CPS CVMTF": 1,
            "CPS PAD": 2,
        },
        "weight_lb": 120,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.2,
        "moving_hours": 0.3,
    },
    "bedding_set": {
        "category": "boxes",
        "size": "medium",
        "materials": {
            "CPS BX MED": 1
        },
        "weight_lb": 20,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.0,
        "moving_hours": 0.08,
    },
    "pillows": {
        "category": "boxes",
        "size": "large",
        "materials": {
            "CPS BX LRG": 1
        },
        "weight_lb": 10,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.0,
        "moving_hours": 0.1,
    },
    "basket": {
        "category": "boxes",
        "size": "small",
        "materials": {
            "CPS BX MED": 1
        },
        "weight_lb": 10,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.0,
        "moving_hours": 0.05,
    },
    "drawer_bin": {
        "category": "boxes",
        "size": "medium",
        "materials": {
            "CPS BX MED": 1
        },
        "weight_lb": 15,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.0,
        "moving_hours": 0.08,
    },
    "picture_frame": {
        "category": "boxes",
        "size": "small",
        "materials": {
            "CPS BXPF": 1
        },
        "weight_lb": 8,
        "fragile": True,
        "requires_disassembly": False,
        "packing_hours": 0.1,
        "moving_hours": 0.05,
    },
    "clothes_rod": {
        "category": "furniture",
        "size": "small",
        "materials": {
            "CPS WRAP": 1,
            "CPS PAD": 1
        },
        "weight_lb": 8,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.1,
        "moving_hours": 0.05,
    },
    "bathroom_contents_box": {
        "category": "boxes",
        "size": "medium",
        "materials": {
            "CPS BX MED": 1
        },
        "weight_lb": 20,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.0,
        "moving_hours": 0.08,
    },
    "packed_contents_box": {
        "category": "boxes",
        "size": "medium",
        "materials": {
            "CPS BX MED": 1
        },
        "weight_lb": 20,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.0,
        "moving_hours": 0.08,
    },

    # === ELECTRONICS ===
    "tv_small": {
        "category": "electronics",
        "size": "small",
        "materials": {
            "CPS BXTV": 1,  # TV box
            "CPS BWRAP": 8,
            "CPS PAD": 1,
        },
        "weight_lb": 30,
        "fragile": True,
        "requires_disassembly": False,
        "packing_hours": 0.3,
        "moving_hours": 0.2,
    },
    "tv_medium": {
        "category": "electronics",
        "size": "medium",
        "materials": {
            "CPS BXTV": 1,
            "CPS BWRAP>": 10,  # 48" bubble wrap
            "CPS PAD": 2,
        },
        "weight_lb": 50,
        "fragile": True,
        "requires_disassembly": False,
        "packing_hours": 0.4,
        "moving_hours": 0.3,
    },
    "tv_large": {
        "category": "electronics",
        "size": "large",
        "materials": {
            "CPS BXTV": 1,
            "CPS BWRAP>": 15,
            "CPS PAD HVY": 2,
        },
        "weight_lb": 70,
        "fragile": True,
        "requires_disassembly": False,
        "packing_hours": 0.5,
        "moving_hours": 0.4,
    },
    "computer": {
        "category": "electronics",
        "size": "small",
        "materials": {
            "CPS BX MED": 1,  # small box
            "CPS BWRAP": 5,
            "CPS PEANUT": 2,  # 2 cf packing peanuts
        },
        "weight_lb": 15,
        "fragile": True,
        "requires_disassembly": False,
        "packing_hours": 0.2,
        "moving_hours": 0.1,
    },
    "printer": {
        "category": "electronics",
        "size": "small",
        "materials": {
            "CPS BX MED": 1,
            "CPS BWRAP": 5,
            "CPS PEANUT": 1,
        },
        "weight_lb": 20,
        "fragile": True,
        "requires_disassembly": False,
        "packing_hours": 0.2,
        "moving_hours": 0.1,
    },

    # === APPLIANCES ===
    "freezer_small": {
        "category": "appliance",
        "size": "medium",
        "materials": {
            "CPS PAD HVY": 4,
            "CPS WRAP": 2,
        },
        "weight_lb": 200,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.3,
        "moving_hours": 0.8,
    },
    "freezer_large": {
        "category": "appliance",
        "size": "large",
        "materials": {
            "CPS PAD HVY": 6,
            "CPS WRAP": 2,
        },
        "weight_lb": 350,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.4,
        "moving_hours": 1.0,
    },

    # === BOXES (pre-packed) ===
    "box_small_misc": {
        "category": "boxes",
        "size": "small",
        "materials": {
            "CPS BX MED": 1,
        },
        "weight_lb": 20,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.0,  # Already packed
        "moving_hours": 0.05,
    },
    "box_medium_misc": {
        "category": "boxes",
        "size": "medium",
        "materials": {
            "CPS BX MED": 1,
        },
        "weight_lb": 30,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.0,
        "moving_hours": 0.08,
    },
    "box_large_misc": {
        "category": "boxes",
        "size": "large",
        "materials": {
            "CPS BX LRG": 1,
        },
        "weight_lb": 40,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.0,
        "moving_hours": 0.1,
    },
    "box_xlarge_misc": {
        "category": "boxes",
        "size": "xl",
        "materials": {
            "CPS BX>>": 1,
        },
        "weight_lb": 50,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.0,
        "moving_hours": 0.12,
    },

    # === KITCHEN ITEMS ===
    "dishes_set": {
        "category": "kitchen",
        "size": "medium",
        "materials": {
            "CPS BXDISH": 1,  # dish pack with separators
        },
        "weight_lb": 40,
        "fragile": True,
        "requires_disassembly": False,
        "packing_hours": 0.8,
        "moving_hours": 0.2,
    },
    "pots_pans_set": {
        "category": "kitchen",
        "size": "medium",
        "materials": {
            "CPS BX MED": 2,
            "TMC BW24": 0.1,  # bubble wrap roll (partial)
        },
        "weight_lb": 35,
        "fragile": False,
        "requires_disassembly": False,
        "packing_hours": 0.5,
        "moving_hours": 0.2,
    },
}


# Xactimate line item descriptions and units
XACTIMATE_LINE_ITEMS = {
    # === CON Category - Contents Moving/Storage ===
    "CON BIDITM": {"description": "Note: Bid item.  No life expectancy data", "unit": "EA"},
    "CON LAB": {"description": "Hourly labor rate for a general laborer", "unit": "HR"},
    "CON LABA": {"description": "After hours hourly labor rate for a general laborer", "unit": "HR"},
    "CON PDB": {"description": "Note: Bid item.  No life expectancy data", "unit": "EA"},
    "CON POTNR": {"description": "Note: Bid item.  No life expectancy data", "unit": "EA"},
    "CON POTR": {"description": "Note: Bid item.  No life expectancy data", "unit": "EA"},
    "CON PROT": {"description": "6mil plastic, masking tape, and labor to wrap or cover and remove when surrounding work is completed", "unit": "EA"},
    "CON ROOM": {"description": "Labor charge to move out and reset contents back into an average size room", "unit": "EA"},
    "CON ROOM<": {"description": "Labor charge to move out and reset contents back into a small room", "unit": "EA"},
    "CON ROOM>": {"description": "Labor charge to move out and reset contents back into a large room", "unit": "EA"},
    "CON ROOM>>": {"description": "Labor charge to move out and reset contents back into an extra-large room", "unit": "EA"},
    "CON STOPC": {"description": "Monthly rental of job-site storage container", "unit": "MO"},
    "CON STOPC<": {"description": "Monthly rental of job-site storage container", "unit": "MO"},
    "CON STOPC>": {"description": "Monthly rental of job-site storage container", "unit": "MO"},
    "CON STOPCD": {"description": "Trucking fee for job-site storage containers", "unit": "EA"},
    "CON STOPM": {"description": "Monthly rental of job-site storage container", "unit": "MO"},
    "CON STOPM<": {"description": "Monthly rental of job-site storage container", "unit": "MO"},
    "CON STOPM<<": {"description": "Monthly rental of job-site storage container", "unit": "MO"},
    "CON STOPMD": {"description": "Trucking fee for job-site storage containers", "unit": "EA"},
    "CON STOPP": {"description": "Padlock/disc lock", "unit": "EA"},

    # === CPS Category - Contents Pack/Store ===
    # General items
    "CPS AGP": {"description": "Note: Bid item.  No life expectancy data", "unit": "EA"},
    "CPS BIDITM": {"description": "Note: Bid item.  No life expectancy data", "unit": "EA"},

    # Bubble wrap
    "CPS BWRAP": {"description": "3/16\" economy grade bubble wrap in 24\" wide rolls with perforation every 12\" for easy tear off", "unit": "LF"},
    "CPS BWRAP<": {"description": "3/16\" economy grade bubble wrap in 12\" wide rolls with perforation every 12\" for easy tear off", "unit": "LF"},
    "CPS BWRAP>": {"description": "3/16\" economy grade bubble wrap in 48\" wide rolls with perforation every 12\" for easy tear off", "unit": "LF"},

    # Standard boxes
    "CPS BX": {"description": "1.7 to 3.5 cubic ft box", "unit": "EA"},
    "CPS BX<": {"description": "1.25 to 1.6 cubic ft box", "unit": "EA"},
    "CPS BX>": {"description": "3.3 to 4.5 cubic ft box", "unit": "EA"},
    "CPS BX>>": {"description": "4.6 to 6.25 cubic ft box", "unit": "EA"},
    "CPS BXBK": {"description": "1.25 to 1.6 cubic ft book box", "unit": "EA"},

    # Box evaluation with packing (includes labor)
    "CPS BXBKE": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXBLE": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXBLE<": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXBLE>": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXBME": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXBME<": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXBME>": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXBSE": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXBSE<": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXBSE>": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXBXE": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXBXE<": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXBXE>": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},

    # Specialty boxes
    "CPS BXDISH": {"description": "5 to 5.25 cubic ft dish pack box", "unit": "EA"},
    "CPS BXDPE": {"description": "Dish pack box with separators, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXGL": {"description": "2 to 4 cubic ft glass pack box", "unit": "EA"},
    "CPS BXGLE": {"description": "Glasspack box w/dividers, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXLMP": {"description": "One lamp base box and one shade box, packaging tape, and packing paper", "unit": "EA"},

    # Mattress boxes
    "CPS BXMATC": {"description": "Crib size mattress box and packaging tape", "unit": "EA"},
    "CPS BXMATD": {"description": "Double size mattress box and packaging tape", "unit": "EA"},
    "CPS BXMATK": {"description": "King size mattress box and packaging tape", "unit": "EA"},
    "CPS BXMATQ": {"description": "Queen size mattress box and packaging tape", "unit": "EA"},
    "CPS BXMATS": {"description": "Single size mattress box and packaging tape", "unit": "EA"},

    # Mirror and lamp boxes
    "CPS BXMIR": {"description": "2.5 to 4 cubic ft mirror box", "unit": "EA"},

    # More box variations with labor
    "CPS BXMLE": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXMLE<": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXMLE>": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXMME": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXMME<": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXMME>": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXMSE": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXMSE<": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXMSE>": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXMXE": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXMXE<": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXMXE>": {"description": "Box, packaging tape, packing paper, and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},

    # Picture frame boxes
    "CPS BXPF": {"description": "Picture-frame box, packaging tape, and packing paper", "unit": "EA"},
    "CPS BXPF<": {"description": "Picture-frame box, packaging tape, and packing paper", "unit": "EA"},
    "CPS BXPF>": {"description": "Picture-frame box, packaging tape, and packing paper", "unit": "EA"},

    # Pack and evaluate boxes
    "CPS BXPPE": {"description": "Box, packaging tape and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXPPE<": {"description": "Box, packaging tape and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXPPE>": {"description": "Box, packaging tape and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},
    "CPS BXPPE>>": {"description": "Box, packaging tape and labor to evaluate, pack and inventory items on a per box basis", "unit": "EA"},

    # TV and wardrobe boxes
    "CPS BXTV": {"description": "8 to 10 cubic ft TV box", "unit": "EA"},
    "CPS BXWDR": {"description": "7 to 10 cubic ft wardrobe box", "unit": "EA"},
    "CPS BXWDR<": {"description": "3 to 6 cubic ft wardrobe box", "unit": "EA"},
    "CPS BXWDR>": {"description": "11 to 15 cubic ft wardrobe box", "unit": "EA"},

    # Covers
    "CPS CVCH": {"description": "Chair-size plastic cover and packaging tape", "unit": "EA"},
    "CPS CVCH>": {"description": "Plastic cover for couch or sofa, and packaging tape", "unit": "EA"},
    "CPS CVMTF": {"description": "Plastic cover for mattress or boxspring, and packaging tape", "unit": "EA"},
    "CPS CVMTK": {"description": "Plastic cover for mattress or boxspring, and packaging tape", "unit": "EA"},
    "CPS CVMTQ": {"description": "Plastic cover for mattress or boxspring, and packaging tape", "unit": "EA"},
    "CPS CVMTT": {"description": "Plastic cover for mattress or boxspring, and packaging tape", "unit": "EA"},

    # Labor
    "CPS LAB": {"description": "Hourly rate for content inventory, packing, boxing, and moving", "unit": "HR"},
    "CPS LABA": {"description": "After hours hourly rate for content inventory, packing, boxing, and moving", "unit": "HR"},
    "CPS LABS": {"description": "Hourly rate for an on-site supervisory/administrative cleaning and/or cleaning supervisor technician for content evaluation", "unit": "HR"},
    "CPS LABSA": {"description": "After hours hourly rate for an on-site supervisory/administrative cleaning and/or cleaning supervisor technician for content evaluation", "unit": "HR"},

    # Furniture pads
    "CPS PAD": {"description": "One-time use light-weight furniture pad and packaging tape", "unit": "EA"},
    "CPS PAD+": {"description": "One-time use heavy-weight furniture pad and packaging tape", "unit": "EA"},

    # Miscellaneous
    "CPS PDB": {"description": "Note: Bid item.  No life expectancy data", "unit": "EA"},
    "CPS PEANUT": {"description": "Loose fill packaging peanuts", "unit": "CF"},
    "CPS PIANO": {"description": "Monthly equipment charge for a piano skid board", "unit": "MO"},

    # Storage containers
    "CPS STOPC": {"description": "Monthly rental of job-site storage container", "unit": "MO"},
    "CPS STOPC<": {"description": "Monthly rental of job-site storage container", "unit": "MO"},
    "CPS STOPC>": {"description": "Monthly rental of job-site storage container", "unit": "MO"},
    "CPS STOPCD": {"description": "Trucking fee for job-site storage containers", "unit": "EA"},
    "CPS STOPM": {"description": "Monthly rental of job-site storage container", "unit": "MO"},
    "CPS STOPM<": {"description": "Monthly rental of job-site storage container", "unit": "MO"},
    "CPS STOPM<<": {"description": "Monthly rental of job-site storage container", "unit": "MO"},
    "CPS STOPMD": {"description": "Trucking fee for job-site storage containers", "unit": "EA"},
    "CPS STOPP": {"description": "Padlock/disc lock", "unit": "EA"},

    # Storage facilities
    "CPS STOR": {"description": "Monthly rental of off-site protected storage", "unit": "SF"},
    "CPS STORH": {"description": "Monthly rental of off-site (climate controlled) protected storage", "unit": "SF"},
    "CPS STORV": {"description": "Monthly rental of a wooden storage vault", "unit": "EA"},

    # Tagging and trucks
    "CPS TAG": {"description": "Labor to evaluate, to tag/label, and to inventory non-boxable items", "unit": "EA"},
    "CPS TR": {"description": "Daily equipment charge for 16'-20' moving van (4-5 rooms), mileage charge (up to 50 miles/day), taxes, insurance, and loading equipment (hand-truck)", "unit": "DA"},
    "CPS TR<": {"description": "Daily equipment charge for 14'-15' moving van (2-3 rooms), mileage charge (up to 50 miles/day), taxes, insurance, and loading equipment (hand-truck)", "unit": "DA"},
    "CPS TR>": {"description": "Daily equipment charge for 21'-27' moving van (6-8 rooms), mileage charge (up to 50 miles/day), taxes, insurance, and loading equipment (hand-truck)", "unit": "DA"},
    "CPS TRCV": {"description": "Daily equipment charge for a cargo van, mileage charge (up to 50 miles/day), taxes, insurance, and loading equipment (hand-truck)", "unit": "DA"},

    # Wrap
    "CPS WRAP": {"description": "Stretch film wrap", "unit": "LF"},
    "CPS WRAP<": {"description": "Stretch film wrap", "unit": "LF"},

    # === Additional commonly used codes ===
    # Box size aliases (for internal ITEM_MAPPINGS compatibility)
    "CPS BX SML": {"description": "1.25 to 1.6 cubic ft box (small)", "unit": "EA"},  # Alias for CPS BX<
    "CPS BX MED": {"description": "1.7 to 3.5 cubic ft box (medium)", "unit": "EA"},  # Alias for CPS BX
    "CPS BX LRG": {"description": "3.3 to 4.5 cubic ft box (large)", "unit": "EA"},   # Alias for CPS BX>
    "CPS BX XL": {"description": "4.6 to 6.25 cubic ft box (extra-large)", "unit": "EA"},  # Alias for CPS BX>>

    # Mattress covers (legacy codes for backward compatibility)
    "CPS CVMT": {"description": "Mattress cover - twin", "unit": "EA"},
    "CPS CVMF": {"description": "Mattress cover - full", "unit": "EA"},
    "CPS CVMQ": {"description": "Mattress cover - queen", "unit": "EA"},
    "CPS CVMK": {"description": "Mattress cover - king", "unit": "EA"},

    # Packing materials
    "CPS TAPE": {"description": "Packing tape", "unit": "RL"},
    "CPS STRWRAP": {"description": "Stretch wrap", "unit": "RL"},
    "CPS PKPPR": {"description": "Packing paper", "unit": "LB"},

    # Additional furniture pads
    "CPS PAD HVY": {"description": "Heavy duty furniture pad", "unit": "EA"},

    # === TMC Category - Temporary Moving & Contents ===
    # Plastic sheeting
    "TMC PLAS2": {"description": "2 mil plastic, 9' x 400' roll", "unit": "RL"},
    "TMC PLAS4": {"description": "4 mil plastic, 12' x 100' roll", "unit": "RL"},
    "TMC PLAS6": {"description": "6 mil plastic, 20' x 100' roll", "unit": "RL"},
    "TMC PLAS6<": {"description": "6 mil polyethylene, 8' x 100' roll", "unit": "RL"},

    # Packing peanuts
    "TMC PN14": {"description": "Loose fill packing peanuts, 14 cubic foot bag", "unit": "EA"},
    "TMC PN20": {"description": "Loose fill packing peanuts, 20 cubic foot bag", "unit": "EA"},

    # Packing paper
    "TMC PPB": {"description": "Packing paper, 24\" x 36\", 625 sheet bundle", "unit": "EA"},

    # Bags and barriers
    "TMC BAG<": {"description": "42 to 45 gallon, 3 to 4 mil plastic contractor grade debris/trash bags, box of 50", "unit": "EA"},
    "TMC BARRZ": {"description": "Peel & seal zippers for temporary partition, box of 2", "unit": "EA"},
    "TMC BARRZ+": {"description": "Heavy duty peel & seal zippers for temporary partition, box of 2", "unit": "EA"},

    # Furniture protection
    "TMC BLK": {"description": "Foam furniture blocks, box of 1008", "unit": "EA"},

    # Bubble wrap
    "TMC BW12": {"description": "3/16\" economy grade bubble wrap in 12\" wide by 250' roll with perforation every 12\" for easy tear off", "unit": "LF"},
    "TMC BW24": {"description": "3/16\" economy grade bubble wrap in 24\" wide by 250' roll with perforation every 12\" for easy tear off", "unit": "LF"},
    "TMC BW48": {"description": "3/16\" economy grade bubble wrap in 48\" wide by 250' roll with perforation every 12\" for easy tear off", "unit": "LF"},

    # Standard boxes
    "TMC BX": {"description": "1.7 to 3.5 cubic foot box", "unit": "EA"},
    "TMC BX<": {"description": "1.25 to 1.6 cubic foot box", "unit": "EA"},
    "TMC BX>": {"description": "3.3 to 4.5 cubic foot box", "unit": "EA"},
    "TMC BX>>": {"description": "4.6 to 6.25 cubic foot box", "unit": "EA"},
    "TMC BXBK": {"description": "1.25 to 1.6 cubic foot book box", "unit": "EA"},

    # Specialty boxes
    "TMC BXDISH": {"description": "5 to 5.25 cubic foot dish-pack box with separators", "unit": "EA"},
    "TMC BXGL": {"description": "2 to 4 cubic foot glass-pack box w/dividers", "unit": "EA"},
    "TMC BXLMP": {"description": "3.34 to 4 cubic foot lamp/golf bag box", "unit": "EA"},
    "TMC BXMIR": {"description": "2.5 to 4 cubic foot mirror/picture box", "unit": "EA"},

    # Picture frame boxes
    "TMC BXPF": {"description": "Picture-frame box up to 36\" x 5\" x 30\"", "unit": "EA"},
    "TMC BXPF<": {"description": "Picture-frame box up to 24\" x 5\" x 18\"", "unit": "EA"},
    "TMC BXPF>": {"description": "Picture-frame box up to 36\" x 5\" x 48\"", "unit": "EA"},

    # Wardrobe boxes
    "TMC BXWDR": {"description": "7 to 10 cubic foot wardrobe box", "unit": "EA"},
    "TMC BXWDR<": {"description": "3 to 6 cubic foot wardrobe box", "unit": "EA"},
    "TMC BXWDR>": {"description": "11 to 15 cubic foot wardrobe box", "unit": "EA"},

    # Testing and covering
    "TMC CALC": {"description": "Calcium Chloride moisture test kit (per test sample)", "unit": "EA"},
    "TMC CC": {"description": "Cardboard / Paperboard covering, 36\" to 38\" wide x 100' roll", "unit": "RL"},
    "TMC CCC": {"description": "Corrugated cardboard covering, 48\" x 250' roll", "unit": "RL"},

    # Storage (legacy)
    "TMC STRG": {"description": "Storage - per month", "unit": "MO"},

    # CON - Construction Protection (legacy codes)
    "CON PLYWL": {"description": "Plywood wall protection", "unit": "SF"},
    "CON RAMBD": {"description": "Ramboard floor protection", "unit": "SF"},
    "CON PLSTC": {"description": "Plastic sheeting", "unit": "SF"},

    # === DMO Category - Demolition & Debris Disposal ===
    # Pickup and disposal
    "DMO PU": {"description": "Pickup truck, dumping fees, and labor (1/2 ton of waste)", "unit": "EA"},

    # Disposal fees
    "DMO CAR": {"description": "Landfill or disposal site fees for dumping construction debris", "unit": "CY"},

    # Debris chute equipment
    "DMO DCHUT": {"description": "Equipment charge for debris chute hopper", "unit": "MO"},
    "DMO DCHUTH": {"description": "Equipment charge for debris chute section", "unit": "MO"},
    "DMO DCHUTM": {"description": "Equipment charge for debris chute mounting hardware", "unit": "MO"},

    # Debris disposal bid item
    "DMO DD": {"description": "Debris disposal (Bid Item)", "unit": "EA"},

    # Dump trailer and truck
    "DMO DTRLR": {"description": "Tandem axle dump trailer, dumping fees, and labor (1.67 tons, 4-5 yard capacity)", "unit": "EA"},
    "DMO DTRUCK": {"description": "Single axle dump truck, dumping fees, and labor (2 tons, 5-6 yard capacity)", "unit": "EA"},

    # Dumpster services
    "DMO DUMP": {"description": "Dumpster delivery, rental, transportation and dumping fees (20 yards, ~4 tons)", "unit": "EA"},
    "DMO DUMP<": {"description": "Small dumpster delivery, rental, transportation and dumping fees (10-15 yards, 1-3 tons)", "unit": "EA"},
    "DMO DUMP>": {"description": "Large dumpster delivery, rental, transportation and dumping fees (30 yards, 5-7 tons)", "unit": "EA"},
    "DMO DUMP>>": {"description": "Extra-large dumpster delivery, rental, transportation and dumping fees (40 yards, 7-8 tons)", "unit": "EA"},

    # HMR - Haul away & Debris removal & Protection
    "HMR HAULBOX": {"description": "Cardboard box haul away", "unit": "CF"},
    "HMR DEBRIS": {"description": "General debris haul away", "unit": "CY"},
    "HMR BARR": {"description": "Stair barrier protection material", "unit": "SF"},
}


# Floor multipliers for labor calculations
FLOOR_MULTIPLIERS = {
    "BASEMENT": {
        "packing": 1.0,
        "moving_down": 1.2,
        "moving_up": 1.5,
    },
    "MAIN_LEVEL": {
        "packing": 1.0,
        "moving": 1.0,
    },
    "SECOND_FLOOR": {
        "packing": 1.0,
        "moving_down": 1.3,
        "moving_up": 1.6,
    },
    "THIRD_FLOOR": {
        "packing": 1.0,
        "moving_down": 1.5,
        "moving_up": 2.0,
    },
    "FOURTH_FLOOR": {
        "packing": 1.0,
        "moving_down": 1.7,
        "moving_up": 2.5,
    },
    "FIFTH_FLOOR_PLUS": {
        "packing": 1.0,
        "moving_down": 2.0,
        "moving_up": 3.0,
    },
}


# Protection estimation factors
PROTECTION_FACTORS = {
    "house": {
        "base_sf": 100,  # Entry, main hallway
        "per_floor_sf": 60,  # Internal stairs
    },
    "apartment": {
        "base_sf": 50,  # Hallway to unit
        "per_floor_sf": 40,  # External stairs
    },
    "townhouse": {
        "base_sf": 75,
        "per_floor_sf": 50,
    },
    "condo": {
        "base_sf": 60,
        "per_floor_sf": 45,
    },
    "commercial": {
        "base_sf": 150,
        "per_floor_sf": 80,
    },
}


# Debris calculation factors (per material type)
DEBRIS_FACTORS = {
    "cardboard_lb_per_box": 2.0,  # lbs per box when flattened
    "plastic_lb_per_ft_wrap": 0.02,  # lbs per foot of bubble wrap
    "plastic_lb_per_roll_stretch": 5.0,  # lbs per roll of stretch film
    "paper_lb_per_box": 0.5,  # estimate for packing paper
}
