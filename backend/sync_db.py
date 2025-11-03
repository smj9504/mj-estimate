"""
Complete Database Schema Synchronization Script

This script safely synchronizes your database schema with code changes:
1. Backs up current database
2. Detects all schema differences
3. Generates migration if needed
4. Applies migration
5. Verifies the result

Usage:
    python sync_db.py                    # Interactive mode
    python sync_db.py --auto             # Auto apply (careful!)
    python sync_db.py --check-only       # Only check, don't apply
    python sync_db.py --force-recreate   # Drop and recreate (DEV ONLY!)
"""

import sys
import os
import subprocess
from pathlib import Path
from datetime import datetime
import argparse

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from app.core.database_factory import get_database
from app.core.config import settings
from sqlalchemy import inspect, text


class Colors:
    """Terminal colors for better readability"""
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'


def print_header(message):
    print(f"\n{Colors.HEADER}{Colors.BOLD}{'='*60}{Colors.ENDC}")
    print(f"{Colors.HEADER}{Colors.BOLD}{message:^60}{Colors.ENDC}")
    print(f"{Colors.HEADER}{Colors.BOLD}{'='*60}{Colors.ENDC}\n")


def print_success(message):
    print(f"{Colors.GREEN}[OK] {message}{Colors.ENDC}")


def print_warning(message):
    print(f"{Colors.YELLOW}[WARN] {message}{Colors.ENDC}")


def print_error(message):
    print(f"{Colors.RED}[ERROR] {message}{Colors.ENDC}")


def print_info(message):
    print(f"{Colors.BLUE}[INFO] {message}{Colors.ENDC}")


def run_command(cmd, capture_output=True):
    """Run shell command and return result"""
    try:
        if capture_output:
            result = subprocess.run(
                cmd,
                shell=True,
                capture_output=True,
                text=True,
                check=True
            )
            return result.stdout.strip()
        else:
            subprocess.run(cmd, shell=True, check=True)
            return ""
    except subprocess.CalledProcessError as e:
        print_error(f"Command failed: {cmd}")
        if capture_output:
            print_error(f"Error: {e.stderr}")
        return None


def get_current_alembic_version():
    """Get current Alembic migration version"""
    try:
        result = run_command("python -m alembic current")
        if result and result.strip():
            # Extract version hash
            version = result.split()[0]
            return version
        return None
    except Exception as e:
        print_warning(f"Could not get Alembic version: {e}")
        return None


def get_database_tables():
    """Get list of all tables in database"""
    try:
        db = get_database()
        inspector = inspect(db.engine)
        return sorted(inspector.get_table_names())
    except Exception as e:
        print_error(f"Failed to get database tables: {e}")
        return []


def check_database_connection():
    """Verify database connection"""
    print_header("Database Connection Check")

    try:
        db = get_database()
        with db.engine.connect() as conn:
            result = conn.execute(text("SELECT 1"))
            result.fetchone()

        print_success("Database connection successful")
        print_info(f"Database: {settings.DATABASE_TYPE}")
        print_info(f"URL: {settings.DATABASE_URL.split('@')[1] if '@' in settings.DATABASE_URL else 'SQLite'}")
        return True
    except Exception as e:
        print_error(f"Database connection failed: {e}")
        return False


def show_current_state():
    """Show current database and migration state"""
    print_header("Current State")

    # Alembic version
    version = get_current_alembic_version()
    if version:
        print_info(f"Alembic version: {version}")
    else:
        print_warning("No Alembic version found (fresh database?)")

    # Database tables
    tables = get_database_tables()
    print_info(f"Total tables: {len(tables)}")

    # Show some important tables
    important_tables = [
        'companies', 'invoices', 'estimates', 'work_orders',
        'water_mitigation_jobs', 'webhook_events', 'companycam_photos'
    ]

    print("\n[Key tables]")
    for table in important_tables:
        status = "[OK]" if table in tables else "[MISSING]"
        print(f"  {status} {table}")


def backup_database():
    """Create database backup (PostgreSQL only)"""
    if settings.DATABASE_TYPE != "postgresql":
        print_warning("Backup only available for PostgreSQL")
        return None

    print_header("Database Backup")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = f"backup_{timestamp}.sql"

    # Extract connection details
    db_url = settings.DATABASE_URL
    if "postgresql://" in db_url:
        # Parse postgresql://user:pass@host:port/dbname
        parts = db_url.replace("postgresql://", "").split("@")
        user_pass = parts[0].split(":")
        host_port_db = parts[1].split("/")
        host_port = host_port_db[0].split(":")

        user = user_pass[0]
        password = user_pass[1] if len(user_pass) > 1 else ""
        host = host_port[0]
        port = host_port[1] if len(host_port) > 1 else "5432"
        dbname = host_port_db[1]

        # Check if using Docker
        if host == "localhost" and port in ["5433", "5432"]:
            # Try Docker backup
            container = "mjestimate-postgres"
            cmd = f'docker exec {container} pg_dump -U {user} {dbname} > {backup_file}'
            print_info(f"Creating backup via Docker: {backup_file}")

            result = run_command(cmd, capture_output=False)
            if result is not None:
                print_success(f"Backup created: {backup_file}")
                return backup_file

    print_warning("Could not create automatic backup")
    print_info("Manual backup recommended:")
    print_info("  docker exec mjestimate-postgres pg_dump -U mjestimate mjestimate_dev > backup.sql")
    return None


def generate_migration(message="auto_sync_schema"):
    """Generate Alembic migration"""
    print_header("Generating Migration")

    print_info("Scanning SQLAlchemy models...")
    print_info("Comparing with database schema...")

    cmd = f'python -m alembic revision --autogenerate -m "{message}"'
    result = run_command(cmd, capture_output=True)

    if result is None:
        print_error("Failed to generate migration")
        return False

    if "Generating" in result:
        print_success("Migration generated successfully")
        print(result)

        # Find generated file
        lines = result.split("\n")
        for line in lines:
            if "Generating" in line and ".py" in line:
                file_path = line.split("Generating")[1].strip().split("...")[0].strip()
                print_info(f"Generated file: {file_path}")

        return True
    elif "No changes" in result or "nothing to do" in result.lower():
        print_success("No schema changes detected - database is already in sync!")
        return None  # None means no changes needed
    else:
        print_warning("Migration generation completed with warnings")
        print(result)
        return True


def review_migration():
    """Show latest migration for review"""
    print_header("Migration Review")

    # Find latest migration file
    versions_dir = Path("alembic/versions")
    if not versions_dir.exists():
        print_error("Alembic versions directory not found")
        return False

    py_files = sorted(versions_dir.glob("*.py"), key=lambda x: x.stat().st_mtime, reverse=True)

    if not py_files:
        print_warning("No migration files found")
        return False

    latest = py_files[0]
    print_info(f"Latest migration: {latest.name}")

    # Show summary
    with open(latest, 'r', encoding='utf-8') as f:
        content = f.read()

        # Extract docstring
        if '"""' in content:
            doc_start = content.find('"""') + 3
            doc_end = content.find('"""', doc_start)
            docstring = content[doc_start:doc_end].strip()
            print(f"\n{Colors.CYAN}{docstring}{Colors.ENDC}\n")

        # Look for operations
        if "op.create_table" in content:
            print_info("Creates new tables")
        if "op.drop_table" in content:
            print_warning("⚠️  DROPS tables - review carefully!")
        if "op.add_column" in content:
            print_info("Adds columns")
        if "op.drop_column" in content:
            print_warning("⚠️  DROPS columns - data may be lost!")

    return True


def apply_migration():
    """Apply pending migrations"""
    print_header("Applying Migration")

    print_info("Running: alembic upgrade head")

    cmd = "python -m alembic upgrade head"
    result = run_command(cmd, capture_output=True)

    if result is None:
        print_error("Migration failed!")
        return False

    print(result)

    if "Running upgrade" in result:
        print_success("Migration applied successfully!")
        return True
    elif "already at head" in result.lower():
        print_success("Database already up to date!")
        return True
    else:
        print_warning("Migration completed with warnings")
        return True


def verify_sync():
    """Verify database is in sync"""
    print_header("Verification")

    # Check Alembic version
    version = get_current_alembic_version()
    if version:
        print_success(f"Alembic version: {version}")
    else:
        print_warning("Could not verify Alembic version")

    # Check important tables
    tables = get_database_tables()

    required_tables = [
        'companies', 'invoices', 'estimates',
        'water_mitigation_jobs', 'webhook_events', 'companycam_photos'
    ]

    all_good = True
    print("\n[Checking required tables]")
    for table in required_tables:
        if table in tables:
            print_success(f"{table}")
        else:
            print_error(f"{table} - MISSING!")
            all_good = False

    if all_good:
        print_success("\nDatabase sync verified successfully!")
    else:
        print_error("\nSome tables are missing - sync may have failed")

    return all_good


def force_recreate():
    """Drop and recreate database (DEVELOPMENT ONLY)"""
    print_header("!!! FORCE RECREATE DATABASE !!!")

    print_error("This will DELETE ALL DATA!")
    print_error("Only use in development environment!")

    response = input(f"\n{Colors.RED}Type 'DELETE ALL DATA' to confirm: {Colors.ENDC}")

    if response != "DELETE ALL DATA":
        print_info("Cancelled.")
        return False

    if settings.DATABASE_TYPE == "postgresql":
        print_info("Dropping PostgreSQL database...")

        # Extract dbname
        db_url = settings.DATABASE_URL
        dbname = db_url.split("/")[-1]

        # Drop and recreate
        commands = [
            f'docker exec mjestimate-postgres psql -U mjestimate -c "DROP DATABASE IF EXISTS {dbname};"',
            f'docker exec mjestimate-postgres psql -U mjestimate -c "CREATE DATABASE {dbname} OWNER mjestimate;"'
        ]

        for cmd in commands:
            result = run_command(cmd, capture_output=False)
            if result is None:
                print_error("Database recreation failed")
                return False

        print_success("Database recreated")

    elif settings.DATABASE_TYPE == "sqlite":
        print_info("Deleting SQLite database file...")
        db_file = settings.DATABASE_URL.replace("sqlite:///", "")
        if os.path.exists(db_file):
            os.remove(db_file)
            print_success(f"Deleted: {db_file}")

    # Apply all migrations
    print_info("Applying all migrations...")
    return apply_migration()


def interactive_sync():
    """Interactive synchronization wizard"""
    print_header("Database Synchronization Wizard")

    # Step 1: Check connection
    if not check_database_connection():
        return False

    # Step 2: Show current state
    show_current_state()

    # Step 3: Ask about backup
    print("\n")
    response = input(f"{Colors.YELLOW}Create backup before proceeding? (y/n): {Colors.ENDC}")
    if response.lower() == 'y':
        backup_database()

    # Step 4: Generate migration
    print("\n")
    result = generate_migration()

    if result is None:
        # No changes needed
        verify_sync()
        return True

    if not result:
        # Generation failed
        return False

    # Step 5: Review
    review_migration()

    # Step 6: Ask to apply
    print("\n")
    response = input(f"{Colors.CYAN}Apply this migration? (y/n): {Colors.ENDC}")

    if response.lower() != 'y':
        print_info("Migration not applied. You can apply later with: alembic upgrade head")
        return False

    # Step 7: Apply
    if not apply_migration():
        return False

    # Step 8: Verify
    return verify_sync()


def main():
    parser = argparse.ArgumentParser(description="Database synchronization tool")
    parser.add_argument('--auto', action='store_true', help='Automatic mode (no prompts)')
    parser.add_argument('--check-only', action='store_true', help='Only check, don\'t apply')
    parser.add_argument('--force-recreate', action='store_true', help='Drop and recreate DB (DEV ONLY!)')

    args = parser.parse_args()

    if args.force_recreate:
        success = force_recreate()
        sys.exit(0 if success else 1)

    if args.check_only:
        check_database_connection()
        show_current_state()
        sys.exit(0)

    if args.auto:
        print_header("Automatic Synchronization")

        if not check_database_connection():
            sys.exit(1)

        result = generate_migration("auto_sync")
        if result is False:
            sys.exit(1)

        if result is None:
            # No changes
            print_success("Database already in sync!")
            sys.exit(0)

        if apply_migration():
            verify_sync()
            sys.exit(0)
        else:
            sys.exit(1)

    # Interactive mode
    success = interactive_sync()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
