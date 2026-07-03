"""Seed data for default repair conditions and templates (company_id=NULL)."""

import logging

from sqlalchemy.orm import Session

from app.domains.repair_spec.models import (
    RepairCondition,
    RepairConditionSuggestion,
    RepairTemplate,
    RepairTemplateCondition,
    RepairTemplateItem,
)

logger = logging.getLogger(__name__)

# fmt: off
DEFAULT_CONDITIONS = [
    # damage (scope=damaged)
    {"name": "Drywall cut",            "category": "damage",       "scope": "damaged", "sort_order": 1},
    {"name": "Drywall water damage",   "category": "damage",       "scope": "damaged", "sort_order": 2},
    {"name": "Ceiling water stain",    "category": "damage",       "scope": "damaged", "sort_order": 3},
    {"name": "Fire damage",            "category": "damage",       "scope": "damaged", "sort_order": 4},
    {"name": "Smoke damage",           "category": "damage",       "scope": "damaged", "sort_order": 5},
    # work_type (scope=damaged)
    {"name": "Paint",                  "category": "work_type",    "scope": "damaged", "sort_order": 10},
    {"name": "Texture",                "category": "work_type",    "scope": "damaged", "sort_order": 11},
    {"name": "Insulation",             "category": "work_type",    "scope": "damaged", "sort_order": 12},
    {"name": "Demolition",             "category": "work_type",    "scope": "damaged", "sort_order": 13},
    {"name": "Floor protection",       "category": "work_type",    "scope": "damaged", "sort_order": 14},
    {"name": "Mask & prep",            "category": "work_type",    "scope": "damaged", "sort_order": 15},
    # material (scope=damaged)
    {"name": "Drywall",                "category": "material",     "scope": "damaged", "sort_order": 20},
    {"name": "Wood panel",             "category": "material",     "scope": "damaged", "sort_order": 21},
    {"name": "Tile",                   "category": "material",     "scope": "damaged", "sort_order": 22},
    {"name": "Hardwood",               "category": "material",     "scope": "damaged", "sort_order": 23},
    {"name": "Snaplock",               "category": "material",     "scope": "damaged", "sort_order": 24},
    {"name": "Carpet",                 "category": "material",     "scope": "damaged", "sort_order": 25},
    {"name": "Vinyl/LVP",              "category": "material",     "scope": "damaged", "sort_order": 26},
    {"name": "Concrete subfloor",      "category": "material",     "scope": "damaged", "sort_order": 27},
    {"name": "Plywood subfloor",       "category": "material",     "scope": "damaged", "sort_order": 28},
    {"name": "Popcorn ceiling",        "category": "surface_type", "scope": "damaged", "sort_order": 30},
    {"name": "Smooth ceiling",         "category": "surface_type", "scope": "damaged", "sort_order": 31},
    # scope=damaged - other
    {"name": "Cabinet detach & reset", "category": "work_type",    "scope": "damaged", "sort_order": 40},
    {"name": "Baseboard remove & replace", "category": "work_type","scope": "damaged", "sort_order": 41},
    {"name": "Quarter round remove & replace","category":"work_type","scope":"damaged","sort_order": 42},
    {"name": "Baseboard paint only",   "category": "work_type",    "scope": "damaged", "sort_order": 43},
    # scope=affected
    {"name": "Baseboard detach & reset (affected)", "category": "work_type", "scope": "affected", "sort_order": 50},
    {"name": "Floor color match",      "category": "work_type",    "scope": "affected", "sort_order": 51},
    {"name": "Paint match adjacent wall","category": "work_type",  "scope": "affected", "sort_order": 52},
    {"name": "Trim detach & reset (affected)","category":"work_type","scope":"affected","sort_order": 53},
    {"name": "Quarter round detach & reset (affected)","category":"work_type","scope":"affected","sort_order": 54},
]
# fmt: on


def seed_default_data(db: Session) -> None:
    """Create default conditions and templates if they don't exist."""
    existing = db.query(RepairCondition).filter(RepairCondition.company_id.is_(None)).count()
    if existing > 0:
        logger.info("Repair spec seed data already exists (%d conditions), skipping.", existing)
        return

    logger.info("Seeding default repair conditions (%d)...", len(DEFAULT_CONDITIONS))
    condition_map = {}
    for c_data in DEFAULT_CONDITIONS:
        cond = RepairCondition(company_id=None, **c_data)
        db.add(cond)
        db.flush()
        condition_map[c_data["name"]] = str(cond.id)

    # Helper
    def cid(name: str) -> str:
        return condition_map[name]

    # ── Template 1: Drywall Wall Repair ──
    t1 = RepairTemplate(
        company_id=None, name="Drywall Wall Repair", surface="wall",
        description="Standard drywall wall repair with optional texture and insulation",
        tags=["drywall", "wall", "interior"],
    )
    db.add(t1)
    db.flush()

    for cname in ["Drywall cut", "Paint", "Texture", "Insulation"]:
        db.add(RepairTemplateCondition(template_id=t1.id, condition_id=cid(cname)))

    db.add(RepairConditionSuggestion(
        template_id=t1.id, from_condition_id=cid("Drywall cut"), to_condition_id=cid("Paint"),
    ))

    for sort, (cname, code, desc) in enumerate([
        ("Drywall cut", "DRY", '1/2" drywall - hung, taped, floated, ready for paint'),
        ("Paint", "PNT", "Seal/prime (1 coat) then paint (1 coat) the surface area"),
        ("Paint", "FLP", "Floor protection - self-adhesive plastic film"),
        ("Paint", "MSK", "Mask and prep for paint - tape only (per LF)"),
        ("Texture", "ACT", "Acoustic ceiling (popcorn) texture - light"),
        ("Insulation", "INS", "Insulation - fiberglass batt R-13"),
    ]):
        db.add(RepairTemplateItem(
            template_id=t1.id, condition_id=cid(cname),
            xactimate_item_code=code, description_override=desc,
            sort_order=sort,
        ))

    # ── Template 2: Drywall Ceiling Repair ──
    t2 = RepairTemplate(
        company_id=None, name="Drywall Ceiling Repair", surface="ceiling",
        description="Standard drywall ceiling repair",
        tags=["drywall", "ceiling", "interior"],
    )
    db.add(t2)
    db.flush()

    for cname in ["Drywall cut", "Paint", "Popcorn ceiling", "Insulation"]:
        db.add(RepairTemplateCondition(template_id=t2.id, condition_id=cid(cname)))

    db.add(RepairConditionSuggestion(
        template_id=t2.id, from_condition_id=cid("Drywall cut"), to_condition_id=cid("Paint"),
    ))

    for sort, (cname, code, desc) in enumerate([
        ("Drywall cut", "DRY", '5/8" drywall - hung, taped, floated (ceiling)'),
        ("Paint", "PNT", "Seal/prime then paint ceiling"),
        ("Popcorn ceiling", "ACT", "Acoustic ceiling (popcorn) texture"),
        ("Insulation", "INS", "Insulation - blown-in"),
    ]):
        db.add(RepairTemplateItem(
            template_id=t2.id, condition_id=cid(cname),
            xactimate_item_code=code, description_override=desc,
            sort_order=sort,
        ))

    # ── Template 3: Hardwood Floor Replace ──
    t3 = RepairTemplate(
        company_id=None, name="Hardwood Floor Replace", surface="floor",
        description="Hardwood floor replacement with subfloor options",
        tags=["hardwood", "floor"],
    )
    db.add(t3)
    db.flush()

    for cname in ["Hardwood", "Concrete subfloor", "Plywood subfloor", "Baseboard remove & replace", "Quarter round remove & replace"]:
        db.add(RepairTemplateCondition(template_id=t3.id, condition_id=cid(cname)))

    for sort, (cname, code, desc) in enumerate([
        ("Hardwood", "HWD", "Hardwood flooring - install"),
        ("Baseboard remove & replace", "BSB", "Baseboard - remove & replace"),
        ("Quarter round remove & replace", "QTR", "Quarter round - remove & replace"),
        ("Concrete subfloor", "UND", "Underlayment - concrete grade"),
        ("Plywood subfloor", "UND", "Underlayment - plywood grade"),
    ]):
        db.add(RepairTemplateItem(
            template_id=t3.id, condition_id=cid(cname),
            xactimate_item_code=code, description_override=desc,
            sort_order=sort,
        ))

    # ── Template 4: Snaplock Floor Replace ──
    t4 = RepairTemplate(
        company_id=None, name="Snaplock Floor Replace", surface="floor",
        description="Snaplock/click-lock floor replacement",
        tags=["snaplock", "floor"],
    )
    db.add(t4)
    db.flush()

    for cname in ["Snaplock", "Concrete subfloor", "Plywood subfloor", "Quarter round remove & replace", "Baseboard paint only"]:
        db.add(RepairTemplateCondition(template_id=t4.id, condition_id=cid(cname)))

    for sort, (cname, code, desc) in enumerate([
        ("Snaplock", "SNP", "Snaplock flooring - install"),
        ("Quarter round remove & replace", "QTR", "Quarter round - remove & replace"),
        ("Baseboard paint only", "PNT", "Baseboard - paint only (2 coats)"),
        ("Concrete subfloor", "UND", "Underlayment - moisture barrier"),
        ("Plywood subfloor", "UND", "Underlayment - foam"),
    ]):
        db.add(RepairTemplateItem(
            template_id=t4.id, condition_id=cid(cname),
            xactimate_item_code=code, description_override=desc,
            sort_order=sort,
        ))

    # ── Template 5: Carpet Replace ──
    t5 = RepairTemplate(
        company_id=None, name="Carpet Replace", surface="floor",
        description="Carpet replacement",
        tags=["carpet", "floor"],
    )
    db.add(t5)
    db.flush()

    db.add(RepairTemplateCondition(template_id=t5.id, condition_id=cid("Carpet")))

    for sort, (code, desc) in enumerate([
        ("CPT", "Carpet - install"),
        ("CPP", "Carpet pad"),
        ("TCK", "Tack strip"),
    ]):
        db.add(RepairTemplateItem(
            template_id=t5.id, condition_id=cid("Carpet"),
            xactimate_item_code=code, description_override=desc,
            sort_order=sort,
        ))

    db.flush()
    logger.info("Seeded %d default conditions and 5 default templates.", len(DEFAULT_CONDITIONS))
