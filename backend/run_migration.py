"""
Run database migration to add separated address fields
"""
import sys
from pathlib import Path

# Add parent directory to path
sys.path.append(str(Path(__file__).parent))

from sqlalchemy import create_engine, text
from app.core.config import settings

def run_migration():
    """Execute migration SQL file"""
    print("Running database migration...")
    print(f"   Database: {settings.DATABASE_TYPE}")

    # Create engine
    engine = create_engine(settings.DATABASE_URL)

    # Read migration SQL
    migration_file = Path(__file__).parent / "migrations" / "20250125_add_separated_address_fields.sql"

    if not migration_file.exists():
        print(f"ERROR: Migration file not found: {migration_file}")
        return False

    with open(migration_file, 'r', encoding='utf-8') as f:
        migration_sql = f.read()

    # Execute migration
    try:
        with engine.connect() as conn:
            # Split SQL statements by semicolon and execute each one
            statements = [stmt.strip() for stmt in migration_sql.split(';') if stmt.strip() and not stmt.strip().startswith('--')]

            for i, statement in enumerate(statements, 1):
                # Skip empty statements and comments
                if not statement or statement.startswith('--'):
                    continue

                print(f"   Executing statement {i}/{len(statements)}...")
                conn.execute(text(statement))
                conn.commit()

        print("SUCCESS: Migration completed successfully!")
        return True

    except Exception as e:
        print(f"ERROR: Migration failed: {e}")
        return False
    finally:
        engine.dispose()

if __name__ == "__main__":
    success = run_migration()
    sys.exit(0 if success else 1)
