"""
Script to import Xactimate data from JSON files into the database using raw SQL.
Run this after applying the migration.
"""
import sys
import os
from pathlib import Path
import json
import logging
from sqlalchemy import text

# Add the backend directory to the Python path
backend_dir = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(backend_dir))

from app.core.database_factory import get_database

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def import_xactimate_data():
    """Import all Xactimate JSON files into the database using raw SQL."""

    # Get database and create session
    db = get_database()
    session = db.get_session()

    try:
        # Import all default files
        logger.info("Starting Xactimate data import...")

        current_dir = Path(__file__).parent.parent.parent.parent
        base_path = current_dir / "uploads" / "xactimate_data"

        categories = {
            'CON': 'CON_.json',
            'CPS': 'CPS.json',
            'TMC': 'TMC.json'
        }

        total_imported = 0
        total_updated = 0
        total_skipped = 0

        for category, filename in categories.items():
            file_path = base_path / filename

            if not file_path.exists():
                logger.warning(f"File not found: {file_path}")
                continue

            logger.info(f"Importing {category} codes from {file_path}")

            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            imported = 0
            updated = 0
            skipped = 0

            for item in data:
                try:
                    # Extract code data
                    code_str = item.get('item_code', '').strip() or item.get('code', '').strip()
                    if not code_str:
                        continue

                    description = item.get('description', '') or item.get('name', '') or ''
                    price_data = item.get('price_data', {})
                    unit_price = float(price_data.get('untaxed_unit_price', 0.0) or price_data.get('material_cost', 0.0) or 0.0)
                    unit = item.get('unit', 'EA')

                    # Determine subcategory
                    subcategory = "General"
                    description_lower = description.lower()
                    if 'box' in description_lower:
                        subcategory = "Boxes"
                    elif 'bubble' in description_lower:
                        subcategory = "Bubble Wrap"
                    elif 'paper' in description_lower:
                        subcategory = "Packing Paper"
                    elif 'tape' in description_lower:
                        subcategory = "Tape"
                    elif 'lab' in code_str.lower():
                        subcategory = "Labor"
                    elif 'pack' in description_lower:
                        subcategory = "Packing"

                    # Check if code already exists
                    check_query = text("SELECT id FROM xactimate_codes WHERE code = :code")
                    result = session.execute(check_query, {"code": code_str})
                    existing = result.scalar_one_or_none()

                    if existing:
                        # Update existing
                        update_query = text("""
                            UPDATE xactimate_codes
                            SET description = :description,
                                unit = :unit,
                                unit_price = :unit_price,
                                subcategory = :subcategory,
                                category = :category
                            WHERE code = :code
                        """)
                        session.execute(update_query, {
                            "code": code_str,
                            "description": description,
                            "unit": unit,
                            "unit_price": unit_price,
                            "subcategory": subcategory,
                            "category": category
                        })
                        updated += 1
                    else:
                        # Insert new
                        insert_query = text("""
                            INSERT INTO xactimate_codes
                            (code, category, description, unit, unit_price, subcategory)
                            VALUES (:code, :category, :description, :unit, :unit_price, :subcategory)
                        """)
                        session.execute(insert_query, {
                            "code": code_str,
                            "category": category,
                            "description": description,
                            "unit": unit,
                            "unit_price": unit_price,
                            "subcategory": subcategory
                        })
                        imported += 1

                except Exception as e:
                    logger.error(f"Error processing item {code_str}: {e}")
                    continue

            session.commit()

            logger.info(f"{category}: Successfully imported {imported} codes, updated {updated}")
            total_imported += imported
            total_updated += updated
            total_skipped += skipped

        logger.info("Xactimate data import completed!")

        # Print summary
        print(f"\n=== Import Summary ===")
        print(f"Total codes imported: {total_imported}")
        print(f"Total codes updated: {total_updated}")
        print(f"Total codes skipped: {total_skipped}")

    except Exception as e:
        logger.error(f"Error during import: {e}")
        session.rollback()
        raise
    finally:
        session.close()


if __name__ == "__main__":
    import_xactimate_data()
