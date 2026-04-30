"""
Packing Tool Price Seeder

Seeds default moving/packing prices as PackingPrice records.
Prices are Xactimate-aligned (VAAR8X_MAR26).
"""

from sqlalchemy.orm import Session
from app.domains.pack_calculation.models import PackingPrice


CATEGORY_MAP = {
    "labor": "Moving - Labor",
    "room": "Moving - Room Rates",
    "box": "Moving - Boxes",
    "mattress": "Moving - Mattress",
    "protective": "Moving - Protective",
    "transport": "Moving - Transport",
    "storage": "Moving - Storage",
    "specialty": "Moving - Specialty",
    "debris": "Moving - Debris",
}


DEFAULT_PACKING_PRICES = [
    # Labor
    {"code": "2825", "name": "Pack-Out Labor",
     "cat": "labor", "unit": "HR", "price": 57.31},
    {"code": "2826", "name": "Pack-Back Labor",
     "cat": "labor", "unit": "HR", "price": 52.18},
    {"code": "2911", "name": "Supervisor / Fragile Specialist",
     "cat": "labor", "unit": "HR", "price": 87.14},
    {"code": "2912", "name": "Specialty Item Handler",
     "cat": "labor", "unit": "HR", "price": 124.02},

    # Room rates
    {"code": "2833", "name": "Room Rate - Small",
     "cat": "room", "unit": "EA", "price": 185.00},
    {"code": "2834", "name": "Room Rate - Standard",
     "cat": "room", "unit": "EA", "price": 285.00},
    {"code": "2835", "name": "Room Rate - Large",
     "cat": "room", "unit": "EA", "price": 415.00},

    # Transport
    {"code": "2932", "name": "Transport - Small Van",
     "cat": "transport", "unit": "EA", "price": 172.36},
    {"code": "2933", "name": "Transport - Medium Van",
     "cat": "transport", "unit": "EA", "price": 179.25},
    {"code": "2934", "name": "Transport - Large Van",
     "cat": "transport", "unit": "EA", "price": 197.36},

    # Storage
    {"code": "2840", "name": "Storage (per SF/month)",
     "cat": "storage", "unit": "SF", "price": 2.18},
    {"code": "2841", "name": "Storage Setup Fee",
     "cat": "storage", "unit": "EA", "price": 42.00},

    # Boxes
    {"code": "3026", "name": "Small Box (1.5 cu ft)",
     "cat": "box", "unit": "EA", "price": 4.82},
    {"code": "3025", "name": "Medium Box (3.0 cu ft)",
     "cat": "box", "unit": "EA", "price": 5.96},
    {"code": "3027", "name": "Large Box (4.5 cu ft)",
     "cat": "box", "unit": "EA", "price": 7.14},
    {"code": "3028", "name": "XL Box (6.0 cu ft)",
     "cat": "box", "unit": "EA", "price": 8.93},
    {"code": "3029", "name": "Book Box (1.5 cu ft)",
     "cat": "box", "unit": "EA", "price": 4.82},
    {"code": "3030", "name": "Dish Pack Box",
     "cat": "box", "unit": "EA", "price": 9.64},
    {"code": "3031", "name": "Lamp Box",
     "cat": "box", "unit": "EA", "price": 5.36},
    {"code": "3033", "name": "Mirror/Picture Box",
     "cat": "box", "unit": "EA", "price": 9.64},
    {"code": "3039", "name": "Wardrobe Box",
     "cat": "box", "unit": "EA", "price": 12.86},
    {"code": "3032", "name": "File Box",
     "cat": "box", "unit": "EA", "price": 3.57},
    {"code": "3039S", "name": "Wardrobe Box - Small",
     "cat": "box", "unit": "EA", "price": 7.14},
    {"code": "3039L", "name": "Wardrobe Box - Large",
     "cat": "box", "unit": "EA", "price": 10.71},
    {"code": "3899", "name": "TV Box",
     "cat": "box", "unit": "EA", "price": 14.29},

    # Mattress bags
    {"code": "3876", "name": "Mattress Bag - Twin",
     "cat": "mattress", "unit": "EA", "price": 8.93},
    {"code": "3905", "name": "Mattress Bag - Full",
     "cat": "mattress", "unit": "EA", "price": 10.71},
    {"code": "3877", "name": "Mattress Bag - Queen",
     "cat": "mattress", "unit": "EA", "price": 12.50},
    {"code": "3878", "name": "Mattress Bag - King",
     "cat": "mattress", "unit": "EA", "price": 14.29},

    # Protective
    {"code": "2915", "name": "Moving Blanket",
     "cat": "protective", "unit": "EA", "price": 14.29},
    {"code": "2916", "name": "Furniture Pad",
     "cat": "protective", "unit": "EA", "price": 8.57},
    {"code": "2917", "name": "Chair Cover",
     "cat": "protective", "unit": "EA", "price": 5.36},
    {"code": "2918", "name": "Sofa Cover",
     "cat": "protective", "unit": "EA", "price": 8.93},
    {"code": "3023", "name": "Bubble Wrap Roll 12in",
     "cat": "protective", "unit": "EA", "price": 8.93},
    {"code": "3018", "name": "Bubble Wrap Roll 24in",
     "cat": "protective", "unit": "EA", "price": 12.50},
    {"code": "3089", "name": "Packing Paper (50-lb bundle)",
     "cat": "protective", "unit": "EA", "price": 32.14},
    {"code": "3035", "name": "Packing Tape Roll",
     "cat": "protective", "unit": "EA", "price": 4.46},
    {"code": "2936", "name": "Stretch/Shrink Wrap Roll",
     "cat": "protective", "unit": "EA", "price": 8.93},
    {"code": "3022", "name": "Corner Protector Set",
     "cat": "protective", "unit": "EA", "price": 2.68},
    {"code": "3041", "name": "Foam Sheet",
     "cat": "protective", "unit": "EA", "price": 1.79},
    {"code": "3043", "name": "Dust Cover",
     "cat": "protective", "unit": "EA", "price": 3.21},

    # Specialty
    {"code": "3050", "name": "Anti-Static Wrap",
     "cat": "specialty", "unit": "EA", "price": 4.46},
    {"code": "3051", "name": "Acid-Free Tissue",
     "cat": "specialty", "unit": "EA", "price": 5.36},
    {"code": "3052", "name": "Wine Cell Box (12-cell)",
     "cat": "specialty", "unit": "EA", "price": 17.86},
    {"code": "3053", "name": "Electronics Box",
     "cat": "specialty", "unit": "EA", "price": 8.93},
    {"code": "3054", "name": "TV Box",
     "cat": "specialty", "unit": "EA", "price": 12.50},
    {"code": "3055", "name": "Lamp Box",
     "cat": "specialty", "unit": "EA", "price": 3.57},
    {"code": "3056", "name": "Rug Wrap",
     "cat": "specialty", "unit": "EA", "price": 5.36},
    {"code": "3057", "name": "Piano Board",
     "cat": "specialty", "unit": "EA", "price": 7.14},
    {"code": "3058", "name": "Marker/Label Set",
     "cat": "specialty", "unit": "EA", "price": 0.71},
    {"code": "3059", "name": "Hazmat Label",
     "cat": "specialty", "unit": "EA", "price": 2.14},
    {"code": "3060", "name": "Instrument Case Wrap",
     "cat": "specialty", "unit": "EA", "price": 16.07},
    {"code": "3061", "name": "Silica Gel Pack",
     "cat": "specialty", "unit": "EA", "price": 1.43},
    {"code": "3062", "name": "Gun Sleeve",
     "cat": "specialty", "unit": "EA", "price": 7.14},
    {"code": "3063", "name": "Tool Roll",
     "cat": "specialty", "unit": "EA", "price": 2.50},
    {"code": "3064", "name": "Bike Box/Bag",
     "cat": "specialty", "unit": "EA", "price": 3.57},
    {"code": "3065", "name": "Plant Pot Wrap",
     "cat": "specialty", "unit": "EA", "price": 7.14},

    # Debris / Cleaning
    {"code": "3080", "name": "Debris Hauling",
     "cat": "debris", "unit": "EA", "price": 250.00},
    {"code": "3081", "name": "Cleaning Fee",
     "cat": "debris", "unit": "HR", "price": 45.00},
]


def seed_packing_prices(
    db: Session,
    company_id=None,
    created_by_id=None,
) -> int:
    """
    Seed default packing prices. Idempotent: skips
    existing codes for the company.
    Returns count of newly created items.
    """
    existing_codes = set()
    query = db.query(PackingPrice.code).filter(
        PackingPrice.is_active.is_(True),
    )
    if company_id:
        query = query.filter(
            PackingPrice.company_id == company_id
        )
    else:
        query = query.filter(
            PackingPrice.company_id.is_(None)
        )
    existing_codes = {
        code for (code,) in query.all() if code
    }

    created = 0
    for data in DEFAULT_PACKING_PRICES:
        if data["code"] in existing_codes:
            continue

        item = PackingPrice(
            code=data["code"],
            name=data["name"],
            unit=data["unit"],
            unit_price=data["price"],
            category=CATEGORY_MAP[data["cat"]],
            is_taxable=True,
            company_id=company_id,
            created_by_id=created_by_id,
        )
        db.add(item)
        created += 1

    if created:
        db.commit()

    return created


def get_default_prices_dict() -> dict:
    """Return default prices as {code: {price, name, unit}} dict
    for fallback when DB prices are not seeded."""
    result = {}
    for data in DEFAULT_PACKING_PRICES:
        result[data["code"]] = {
            "price": data["price"],
            "name": data["name"],
            "unit": data["unit"],
        }
    return result
