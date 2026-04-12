"""
Xactimate Helper Tool - Data Migration Script

Imports Line Item JSON data from parsed_json/ into xact_line_items table.
Also handles is_active filtering and initial Assembly seeding.

Usage:
    cd backend
    python -m app.domains.xactimate_helper.migrate_json
"""

import json
import logging
import sys
from pathlib import Path
from typing import Any, Dict, List

# Add backend to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))

from app.core.database_factory import get_database

# Import all models to ensure SQLAlchemy relationship resolution (mirrors main.py)
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

from app.domains.xactimate_helper.models import (
    XactAssembly,
    XactAssemblyItem,
    XactLineItem,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Path to parsed JSON files
PARSED_JSON_DIR = Path(__file__).resolve().parent.parent.parent.parent / "uploads" / "xactimate_data" / "parsed_json"

# Codes/patterns that should be marked is_active=False
INACTIVE_PATTERNS = ["AGP", "BID", "MISC", "LABA"]


def should_be_inactive(item: Dict[str, Any]) -> bool:
    """Determine if a line item should be inactive."""
    code = item.get("item_code", "")
    price = item.get("price_data", {}).get("untaxed_unit_price", 0)

    # Zero price items
    if price == 0 or price == 0.0:
        return True

    # Pattern matching
    for pattern in INACTIVE_PATTERNS:
        if pattern in code.upper():
            return True

    return False


def load_json_files() -> List[Dict[str, Any]]:
    """Load all parsed JSON files."""
    all_items = []
    json_dir = PARSED_JSON_DIR

    if not json_dir.exists():
        logger.error(f"Directory not found: {json_dir}")
        return []

    for json_file in sorted(json_dir.glob("*.json")):
        if json_file.name in ("all_items.json", "parsing_stats.json"):
            continue

        try:
            with open(json_file, "r", encoding="utf-8") as f:
                items = json.load(f)
            if isinstance(items, list):
                all_items.extend(items)
                logger.info(f"Loaded {len(items)} items from {json_file.name}")
            else:
                logger.warning(f"Skipping {json_file.name}: not a list")
        except Exception as e:
            logger.error(f"Error loading {json_file.name}: {e}")

    logger.info(f"Total items loaded: {len(all_items)}")
    return all_items


def migrate_line_items():
    """Migrate JSON line items to xact_line_items table."""
    items = load_json_files()
    if not items:
        logger.error("No items to migrate")
        return

    db = get_database()
    session = db.get_session()

    try:
        # Check existing count
        existing = session.query(XactLineItem).count()
        if existing > 0:
            logger.warning(f"xact_line_items already has {existing} rows. Skipping migration.")
            logger.info("To force re-migration, truncate the table first.")
            return

        created = 0
        skipped = 0
        inactive = 0
        seen_codes = set()

        for item in items:
            code = item.get("item_code", "")
            if not code or code in seen_codes:
                skipped += 1
                continue
            seen_codes.add(code)

            is_active = not should_be_inactive(item)
            if not is_active:
                inactive += 1

            price_data = item.get("price_data", {})
            definition = item.get("definition", {})

            li = XactLineItem(
                item_code=code,
                category=item.get("category", ""),
                description=item.get("description", ""),
                unit=_extract_unit(item),
                unit_price=price_data.get("untaxed_unit_price", 0.0),
                definition=definition if definition else None,
                is_active=is_active,
                embedding=None,  # Will be populated by /embed/sync
            )
            session.add(li)
            created += 1

            # Flush every 500 to avoid memory buildup
            if created % 500 == 0:
                session.flush()
                logger.info(f"Progress: {created} items created...")

        session.commit()
        logger.info(
            f"Migration complete: {created} created, {skipped} skipped (duplicates), "
            f"{inactive} marked inactive"
        )

    except Exception as e:
        session.rollback()
        logger.error(f"Migration failed: {e}", exc_info=True)
        raise
    finally:
        session.close()


def _extract_unit(item: Dict[str, Any]) -> str:
    """Extract measurement unit from components or description."""
    components = item.get("components", [])
    for comp in components:
        yield_unit = comp.get("yield_unit", "")
        if yield_unit:
            # yield_unit format: "SF/HR", "LF/HR", etc.
            parts = yield_unit.split("/")
            if parts:
                return parts[0]  # Take the first part (SF, LF, EA, etc.)

    # Fallback: try to detect from description
    desc = (item.get("description", "") or "").lower()
    if "per hour" in desc or "/hr" in desc:
        return "HR"
    if "each" in desc:
        return "EA"
    if "linear" in desc or "per lf" in desc:
        return "LF"
    if "square" in desc or "per sf" in desc:
        return "SF"

    return "EA"  # Default


def seed_initial_assemblies():
    """Create initial assembly templates."""
    db = get_database()
    session = db.get_session()

    try:
        existing = session.query(XactAssembly).count()
        if existing > 0:
            logger.info(f"Assemblies already seeded ({existing} exist). Skipping.")
            return

        assemblies = [
            {
                "name": "Water Damage - Baseboard R&R",
                "damage_type": "water",
                "room_type": "any",
                "trigger_keywords": ["baseboard", "water", "remove", "replace", "LF"],
                "items": [
                    {"item_code": "BSRD", "qty_formula": "LF * 1", "sort_order": 1},
                    {"item_code": "BSRH", "qty_formula": "LF * 1", "sort_order": 2},
                ],
            },
            {
                "name": "Water Damage - Drywall R&R",
                "damage_type": "water",
                "room_type": "any",
                "trigger_keywords": ["drywall", "water", "remove", "replace", "SF"],
                "items": [
                    {"item_code": "DRY1", "qty_formula": "SF * 1", "sort_order": 1},
                    {"item_code": "DRYR", "qty_formula": "SF * 1", "sort_order": 2},
                ],
            },
            {
                "name": "Water Damage - Carpet R&R",
                "damage_type": "water",
                "room_type": "any",
                "trigger_keywords": ["carpet", "water", "remove", "replace", "SF"],
                "items": [
                    {"item_code": "CPTD", "qty_formula": "SF * 1", "sort_order": 1},
                    {"item_code": "CPTR", "qty_formula": "SF * 1", "sort_order": 2},
                ],
            },
            {
                "name": "Water Damage - Electrical Inspection",
                "damage_type": "water",
                "room_type": "any",
                "trigger_keywords": ["electrical", "inspect", "water", "EA"],
                "items": [
                    {"item_code": "ELEII", "qty_formula": "1", "sort_order": 1},
                ],
            },
            {
                "name": "General - Paint Interior Wall",
                "damage_type": "general",
                "room_type": "any",
                "trigger_keywords": ["paint", "wall", "interior", "SF"],
                "items": [
                    {"item_code": "PNTAC", "qty_formula": "SF * 1", "sort_order": 1},
                ],
            },
        ]

        for asm_data in assemblies:
            items_data = asm_data.pop("items", [])
            assembly = XactAssembly(
                name=asm_data["name"],
                damage_type=asm_data.get("damage_type"),
                room_type=asm_data.get("room_type"),
                trigger_keywords=asm_data.get("trigger_keywords"),
            )
            session.add(assembly)
            session.flush()

            for item_d in items_data:
                # Only add if the item_code exists in xact_line_items
                exists = session.query(XactLineItem).filter(
                    XactLineItem.item_code == item_d["item_code"]
                ).first()
                if exists:
                    ai = XactAssemblyItem(
                        assembly_id=assembly.id,
                        item_code=item_d["item_code"],
                        qty_formula=item_d.get("qty_formula"),
                        sort_order=item_d.get("sort_order", 0),
                    )
                    session.add(ai)
                else:
                    logger.warning(
                        f"Assembly '{asm_data['name']}': item_code '{item_d['item_code']}' "
                        f"not found in xact_line_items, skipping"
                    )

        session.commit()
        logger.info(f"Seeded {len(assemblies)} initial assemblies")

    except Exception as e:
        session.rollback()
        logger.error(f"Assembly seeding failed: {e}", exc_info=True)
        raise
    finally:
        session.close()


if __name__ == "__main__":
    logger.info("=== Xactimate Helper Tool - Data Migration ===")

    logger.info("\n--- Step 1: Migrate Line Items from JSON ---")
    migrate_line_items()

    logger.info("\n--- Step 2: Seed Initial Assemblies ---")
    seed_initial_assemblies()

    logger.info("\n=== Migration Complete ===")
    logger.info("Next steps:")
    logger.info("  1. Start the backend server")
    logger.info("  2. Call POST /api/xactimate/embed/sync to generate embeddings")
    logger.info("  3. (Requires OPENAI_API_KEY in .env)")
