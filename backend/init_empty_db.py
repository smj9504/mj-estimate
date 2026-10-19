"""
Build the schema for an empty database and mark it as migrated.

The migration history starts after the first tables (staff, companies, ...)
already existed - they came from create_all - so `alembic upgrade head` cannot
run on an empty database. For a new local or test database run this once,
then use `alembic upgrade head` as usual:

    cd backend
    python init_empty_db.py

It only touches a database that has no tables at all, and it creates the
tables and the alembic_version row in one transaction, so it can never mark a
database as migrated without its schema (see the note in start.sh). Reference
rows that migrations insert - line items, WM report templates, the roofing
price book and so on - are not loaded.
"""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))

from alembic.config import Config  # noqa: E402
from alembic.script import ScriptDirectory  # noqa: E402
from sqlalchemy import create_engine, inspect, text  # noqa: E402

import app.main  # noqa: E402,F401  registers every model the app uses
from app.core.config import settings  # noqa: E402
from app.core.database_factory import Base  # noqa: E402


def main() -> int:
    engine = create_engine(settings.DATABASE_URL)
    print(f"Database: {engine.url.render_as_string(hide_password=True)}")
    if engine.dialect.name != "postgresql":
        print("Only PostgreSQL is supported.")
        return 1

    heads = ScriptDirectory.from_config(Config(str(BACKEND_DIR / "alembic.ini"))).get_heads()

    with engine.begin() as conn:
        tables = inspect(conn).get_table_names()
        if tables:
            print(f"It already has {len(tables)} tables - nothing to do. Use `alembic upgrade head`.")
            return 0

        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        Base.metadata.create_all(bind=conn)
        conn.execute(text(
            "CREATE TABLE alembic_version ("
            "version_num VARCHAR(32) NOT NULL, "
            "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
        ))
        for head in heads:
            conn.execute(text("INSERT INTO alembic_version (version_num) VALUES (:head)"), {"head": head})

    print(f"Created {len(Base.metadata.tables)} tables and marked the database at {', '.join(heads)}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
