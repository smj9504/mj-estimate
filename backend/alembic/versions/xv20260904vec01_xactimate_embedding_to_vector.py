"""xactimate embeddings: jsonb -> pgvector

The xact_line_items.embedding / xact_correction_feedback.situation_embedding
columns were created as JSONB, because models.py falls back to JSONB when the
pgvector package is not importable at class-definition time. pgvector IS in
requirements.txt, so deployed instances define these as Vector(1536) while the
database still held jsonb -- and vector_search() died with

    operator does not exist: jsonb <=> unknown

All existing values were JSON `null` (never real arrays), so the conversion
below discards nothing; embeddings are repopulated via the sync_embeddings
endpoint afterwards.

Revision ID: xv20260904vec01
Revises: wm20260902ph01
"""
from alembic import op
import sqlalchemy as sa

revision = "xv20260904vec01"
down_revision = "wm20260902ph01"
branch_labels = None
depends_on = None

_COLS = (
    ("xact_line_items", "embedding"),
    ("xact_correction_feedback", "situation_embedding"),
)


def _column_type(conn, table: str, col: str):
    return conn.execute(
        sa.text(
            "SELECT data_type FROM information_schema.columns "
            "WHERE table_name = :t AND column_name = :c"
        ),
        {"t": table, "c": col},
    ).scalar()


def upgrade() -> None:
    conn = op.get_bind()
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    for table, col in _COLS:
        if not sa.inspect(conn).has_table(table):
            continue
        if _column_type(conn, table, col) != "jsonb":
            continue

        # JSON `null` is not SQL NULL, and USING cannot cast it to vector,
        # so blank those out first. Real arrays (if any) are preserved.
        conn.execute(
            sa.text(
                f"UPDATE {table} SET {col} = NULL "
                f"WHERE {col} IS NOT NULL AND jsonb_typeof({col}) <> 'array'"
            )
        )
        conn.execute(
            sa.text(
                f"ALTER TABLE {table} ALTER COLUMN {col} TYPE vector(1536) "
                f"USING {col}::text::vector(1536)"
            )
        )


def downgrade() -> None:
    conn = op.get_bind()
    for table, col in _COLS:
        if not sa.inspect(conn).has_table(table):
            continue
        # a pgvector column reports as USER-DEFINED
        if _column_type(conn, table, col) != "USER-DEFINED":
            continue
        conn.execute(
            sa.text(
                f"ALTER TABLE {table} ALTER COLUMN {col} TYPE jsonb "
                f"USING to_jsonb({col}::text::float8[])"
            )
        )
