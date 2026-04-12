"""
Seed initial justification descriptions for insulation line items.

Usage:
    cd backend
    python -m app.domains.xactimate_helper.seed_descriptions
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))

# Import all models for SQLAlchemy relationship resolution
from app.domains.staff.models import *  # noqa
from app.domains.water_mitigation.models import *  # noqa
from app.domains.company.models import *  # noqa
from app.domains.packout.models import *  # noqa
from app.domains.photo_analysis.models import *  # noqa
from app.domains.receipt.models import *  # noqa
from app.domains.reconstruction_estimate.models import *  # noqa
from app.domains.sketch.models import *  # noqa
from app.domains.crew_upload.models import *  # noqa
from app.domains.insurance_extraction.models import *  # noqa
from app.domains.water_mitigation.sketch_models import *  # noqa

import logging
from app.core.database_factory import get_database
from app.domains.xactimate_helper.models import XactItemDescription, XactLineItem

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DESCRIPTIONS = [
    # ─── Insulation — Building Code ────────────────────────────────────────
    {
        "item_code": "INSBT4",
        "description_type": "building_code",
        "title": "Insulation Required — IRC R401.3 (Exposed Cavity)",
        "body": (
            "Per IRC Section R401.3 and IECC Chapter 4, when existing wall cavities are "
            "exposed during repair or alteration, they must be filled with insulation meeting "
            "the minimum R-value for the applicable climate zone. For 2x4 exterior walls, "
            "R-13 fiberglass batt insulation is the standard requirement in Climate Zones 1-5. "
            "This is not an upgrade but a code-mandated restoration requirement when cavities "
            "are opened during the repair process."
        ),
        "trigger_condition": {"damage_type": "water"},
        "source_reference": "IRC R401.3, IECC Chapter 4",
    },
    {
        "item_code": "INSBT6",
        "description_type": "building_code",
        "title": "R-19 Insulation Required — 2x6 Exterior Wall",
        "body": (
            "Per IRC Section R401.3, exposed cavities in 2x6 exterior wall framing must be "
            "filled with R-19 (or R-20/R-21 in Climate Zones 6+) insulation. The existing "
            "insulation was removed due to water damage and must be replaced to meet minimum "
            "building energy code requirements. This applies regardless of whether insulation "
            "existed prior to the loss, as cavity exposure triggers current code compliance."
        ),
        "trigger_condition": {"damage_type": "water"},
        "source_reference": "IRC R401.3, IECC Table R402.1.2",
    },
    {
        "item_code": "INSBTF4",
        "description_type": "building_code",
        "title": "Faced Batt Insulation — Exterior Wall Vapor Barrier",
        "body": (
            "Paper/foil faced fiberglass batt insulation is required for exterior wall cavities "
            "to provide an integrated vapor barrier. Per IRC Section R702.7, a Class I or II "
            "vapor retarder is required on the warm-in-winter side of frame walls in Climate "
            "Zones 5 and higher. Faced batts serve as the vapor retarder, eliminating the need "
            "for a separate polyethylene sheet."
        ),
        "trigger_condition": {"damage_type": "water"},
        "source_reference": "IRC R702.7, IECC R402.1.2",
    },
    # ─── Insulation — Water Damage / IICRC ─────────────────────────────────
    {
        "item_code": "TCRINSS",
        "description_type": "scope_of_work",
        "title": "Insulation Removal — Water Damage (IICRC S500)",
        "body": (
            "Per IICRC S500 Standard for Professional Water Damage Restoration, insulation "
            "exposed to Category 2 or Category 3 water must be removed and replaced regardless "
            "of exposure duration. For Category 1 water, insulation saturated for more than "
            "48 hours poses unacceptable mold colonization risk and must be removed. "
            "The removed insulation cannot be salvaged due to structural degradation and "
            "potential microbial contamination."
        ),
        "trigger_condition": {"damage_type": "water"},
        "source_reference": "IICRC S500, Section 12",
    },
    {
        "item_code": "HMRINSS",
        "description_type": "scope_of_work",
        "title": "Cat 3 Insulation Removal — Mandatory Replacement",
        "body": (
            "Category 3 (blackwater/sewage) contaminated insulation requires mandatory removal "
            "and disposal per IICRC S500. No salvage or drying protocol exists for insulation "
            "exposed to Category 3 water. All affected insulation must be removed, bagged for "
            "disposal, and the cavity must be decontaminated before new insulation is installed. "
            "This includes insulation in areas adjacent to the primary damage zone where "
            "moisture wicking has occurred."
        ),
        "trigger_condition": {"damage_type": "water"},
        "source_reference": "IICRC S500, Category 3 Protocol",
    },
    # ─── Insulation — Like Kind and Quality ────────────────────────────────
    {
        "item_code": "INSBT4",
        "description_type": "industry_standard",
        "title": "Like Kind and Quality — Insulation Replacement",
        "body": (
            "The removed insulation was fiberglass batt, R-13. Per the insurance policy's "
            "'like kind and quality' provision, the replacement insulation matches the original "
            "specification to restore the property to pre-loss condition. Per IRC R401.3, "
            "exposed cavities must be filled with insulation meeting minimum R-value "
            "requirements, making this a necessary restoration cost, not an upgrade."
        ),
        "trigger_condition": {"damage_type": "water"},
        "source_reference": "IRC R401.3, Policy LKQ Provision",
    },
    # ─── Insulation — Adding New Where None Existed ────────────────────────
    {
        "item_code": "INSBT4",
        "description_type": "building_code",
        "title": "New Insulation — Cavity Exposed During Repair (No Prior Insulation)",
        "body": (
            "During the repair process, wall cavities were opened that contained no prior "
            "insulation. Per IRC Section R401.3 and the International Energy Conservation Code "
            "(IECC), when existing cavities are exposed during alterations, they must be filled "
            "with insulation meeting current energy code requirements for the applicable climate "
            "zone. This requirement applies regardless of whether insulation existed before the "
            "loss, as the cavity exposure during repair triggers current code compliance. "
            "The minimum requirement for 2x4 exterior walls is R-13 in Climate Zones 1-5."
        ),
        "trigger_condition": {"damage_type": "general"},
        "source_reference": "IRC R401.3, IECC Section C503.1",
    },
    # ─── Blown-In / Attic ──────────────────────────────────────────────────
    {
        "item_code": "INSBI12",
        "description_type": "building_code",
        "title": "Attic Insulation — R-30 Minimum (Blown-In)",
        "body": (
            "Blown-in attic insulation at R-30 (12\" depth) is required per IRC Table "
            "R402.1.2 for Climate Zones 1-3. For Climate Zones 4-8, higher R-values (R-49 to "
            "R-60) are required. The water-damaged blown-in insulation was removed and must be "
            "replaced to the minimum standard. Blown-in fiberglass is the industry standard "
            "for open attic spaces due to superior coverage around obstructions and minimal "
            "thermal bridging."
        ),
        "trigger_condition": {"damage_type": "water"},
        "source_reference": "IRC Table R402.1.2, IECC Chapter 4",
    },
    # ─── Spray Foam ────────────────────────────────────────────────────────
    {
        "item_code": "INSSPF",
        "description_type": "industry_standard",
        "title": "Closed-Cell Spray Foam — Moisture-Prone Areas",
        "body": (
            "Closed-cell spray polyurethane foam (ccSPF) is specified for this application "
            "due to its superior moisture resistance (acts as its own vapor barrier) and high "
            "R-value per inch (R-6.0 to R-7.0). Per ASHRAE 90.1 and IRC R702.7, closed-cell "
            "spray foam is the industry-recommended insulation for basements, crawl spaces, "
            "and areas with recurring moisture exposure. The material also serves as an air "
            "barrier, reducing energy loss and preventing future moisture intrusion."
        ),
        "trigger_condition": {"damage_type": "water"},
        "source_reference": "ASHRAE 90.1, IRC R702.7",
    },
    # ─── Carpet Pad — CRI 105 ─────────────────────────────────────────────
    {
        "item_code": "FCCPAD",
        "description_type": "industry_standard",
        "title": "Carpet Pad — CRI 105 Standard / Manufacturer Warranty",
        "body": (
            "Carpet pad is included as a separate line item per Xactimate estimating standards "
            "and CRI (Carpet and Rug Institute) Installation Standard CRI 105. Nearly all "
            "residential carpet manufacturers require specific carpet pad specifications "
            "(minimum 6 lbs/cf density, 1/4\" to 7/16\" thickness) to maintain warranty "
            "coverage. Installing carpet without pad voids the manufacturer warranty and "
            "results in accelerated wear, buckling, and seam failure. The pad specification "
            "matches the carpet type installed per CRI 105 guidelines."
        ),
        "trigger_condition": {"damage_type": "general"},
        "source_reference": "CRI 105 Residential Installation Standard",
    },
]


def seed():
    db = get_database()
    session = db.get_session()
    try:
        created = 0
        skipped = 0
        for desc_data in DESCRIPTIONS:
            # Check if this exact description already exists
            existing = (
                session.query(XactItemDescription)
                .filter(
                    XactItemDescription.item_code == desc_data["item_code"],
                    XactItemDescription.title == desc_data["title"],
                )
                .first()
            )
            if existing:
                skipped += 1
                continue

            # Check if item_code exists in xact_line_items
            li = (
                session.query(XactLineItem)
                .filter(XactLineItem.item_code == desc_data["item_code"])
                .first()
            )
            if not li:
                logger.warning(f"item_code '{desc_data['item_code']}' not in xact_line_items, skipping")
                skipped += 1
                continue

            d = XactItemDescription(
                item_code=desc_data["item_code"],
                description_type=desc_data["description_type"],
                title=desc_data["title"],
                body=desc_data["body"],
                trigger_condition=desc_data.get("trigger_condition"),
                source_reference=desc_data.get("source_reference"),
                is_ai_generated=False,
                approved=True,  # Pre-approved since manually written
            )
            session.add(d)
            created += 1

        session.commit()
        logger.info(f"Seeded {created} descriptions, skipped {skipped}")
    except Exception as e:
        session.rollback()
        logger.error(f"Seeding failed: {e}", exc_info=True)
    finally:
        session.close()


if __name__ == "__main__":
    logger.info("=== Seeding Insulation & Carpet Pad Descriptions ===")
    seed()
