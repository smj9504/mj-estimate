"""
Script to import Xactimate data from JSON files into the database.
Run this after applying the migration.
"""
import sys
import os
from pathlib import Path

# Add the backend directory to the Python path
backend_dir = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(backend_dir))

import logging
from sqlalchemy.orm import Session

from app.core.database_factory import get_database

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def import_xactimate_data():
    """Import all Xactimate JSON files into the database."""

    # Import XactimateService inside function to avoid circular imports
    from app.domains.packout.xactimate_service import XactimateService

    # Get database and create session
    db = get_database()
    session = db.get_session()

    try:
        service = XactimateService(session)

        # Import all default files
        logger.info("Starting Xactimate data import...")
        results = service.import_all_default_files()

        # Log results
        for category, result in results.items():
            if result.success:
                logger.info(
                    f"{category}: Successfully imported {result.codes_imported} codes, "
                    f"updated {result.codes_updated}, skipped {result.codes_skipped}"
                )
            else:
                logger.error(f"{category}: Import failed - {result.errors}")

        logger.info("Xactimate data import completed!")

        # Print summary
        total_imported = sum(r.codes_imported for r in results.values())
        total_updated = sum(r.codes_updated for r in results.values())
        total_skipped = sum(r.codes_skipped for r in results.values())

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