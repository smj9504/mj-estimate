"""
Run database migration for packing estimate fields
"""
import sys
from pathlib import Path

backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from app.core.database_factory import get_database
from sqlalchemy import text


def run_migration():
    migration_file = Path(__file__).parent / "add_packing_estimate_fields.sql"
    with open(migration_file, 'r') as f:
        sql = f.read()

    database = get_database()

    try:
        with database.get_session() as session:
            print("Running migration: add_packing_estimate_fields")
            print("-" * 60)

            statements = [
                s.strip() for s in sql.split(';')
                if s.strip() and not s.strip().startswith('--')
            ]

            for i, statement in enumerate(statements, 1):
                if statement:
                    preview = statement[:100]
                    print(f"\n[{i}] {preview}...")
                    session.execute(text(statement))

            session.commit()
            print("\n" + "=" * 60)
            print("Migration completed successfully!")
            print("=" * 60)

    except Exception as e:
        print(f"\nMigration failed: {e}")
        raise


if __name__ == "__main__":
    run_migration()
