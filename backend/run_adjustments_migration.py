"""
Run migration to add adjustments column to invoices and estimates tables
"""
import sys
from pathlib import Path

# Add backend directory to path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from app.core.database_factory import get_database
from sqlalchemy import text


def run_migration():
    """Run the migration to add adjustments fields"""

    # Get database connection
    database = get_database()

    try:
        with database.get_session() as session:
            # Execute migration
            print("Running migration: add_adjustments_to_invoice_and_estimate")
            print("-" * 60)

            # Check if adjustments column already exists
            check_invoices = text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'invoices' AND column_name = 'adjustments'
            """)
            result = session.execute(check_invoices)
            if result.fetchone():
                print("[OK] Column 'adjustments' already exists in 'invoices' table")
            else:
                print("Adding 'adjustments' column to 'invoices' table...")
                add_invoices = text("""
                    ALTER TABLE invoices 
                    ADD COLUMN adjustments JSON DEFAULT '[]'::json
                """)
                session.execute(add_invoices)
                print("[OK] Added 'adjustments' column to 'invoices' table")

            # Check if adjustments column already exists in estimates
            check_estimates = text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'estimates' AND column_name = 'adjustments'
            """)
            result = session.execute(check_estimates)
            if result.fetchone():
                print("[OK] Column 'adjustments' already exists in 'estimates' table")
            else:
                print("Adding 'adjustments' column to 'estimates' table...")
                add_estimates = text("""
                    ALTER TABLE estimates 
                    ADD COLUMN adjustments JSON DEFAULT '[]'::json
                """)
                session.execute(add_estimates)
                print("[OK] Added 'adjustments' column to 'estimates' table")

            # Update existing rows to have empty array as default
            print("Updating existing rows...")
            update_invoices = text("""
                UPDATE invoices 
                SET adjustments = '[]'::json 
                WHERE adjustments IS NULL
            """)
            session.execute(update_invoices)
            
            update_estimates = text("""
                UPDATE estimates 
                SET adjustments = '[]'::json 
                WHERE adjustments IS NULL
            """)
            session.execute(update_estimates)

            session.commit()
            print("\n" + "=" * 60)
            print("[SUCCESS] Migration completed successfully!")
            print("=" * 60)

    except Exception as e:
        print(f"\n[ERROR] Migration failed: {e}")
        import traceback
        traceback.print_exc()
        raise

if __name__ == "__main__":
    run_migration()

