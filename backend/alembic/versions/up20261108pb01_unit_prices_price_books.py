"""company prices for bathroom and cabinet estimates, and price books

- unit_price_overrides: a company's own figure for one price, material and
  labor apart (NULL on a side follows the default in pricing.py).
- unit_price_changes: every change to those, with who made it.
- price_books: a whole set of prices, frozen. An estimate is pinned to one
  the first time it is calculated (bathroom_estimates / cabinet_estimates
  .price_book_id), so a later default update or company edit doesn't move it.

Every estimate already priced is pinned here to today's default prices, the
ones it was priced with, so the first company edit or default update after
this doesn't reprice it. Estimates never priced stay unpinned and take their
company's prices when first calculated.

Revision ID: up20261108pb01
Revises: nk20261108cl01
Create Date: 2026-11-08
"""

import hashlib
import json
import uuid

from alembic import op
import sqlalchemy as sa

from app.core.database_types import UUIDType

revision = "up20261108pb01"
down_revision = "nk20261108cl01"
branch_labels = None
depends_on = None

# estimate table, its line items table, price catalog
_ESTIMATES = (
    ("bathroom_estimates", "bathroom_estimate_line_items", "bathroom"),
    ("cabinet_estimates", "cabinet_estimate_line_items", "cabinet"),
)


def _has_table(conn, table: str) -> bool:
    return sa.inspect(conn).has_table(table)


def _has_column(conn, table: str, col: str) -> bool:
    return col in {c["name"] for c in sa.inspect(conn).get_columns(table)}


def _default_values(domain: str) -> dict:
    """Today's default prices, as the code that runs this migration has them."""
    from app.domains.unit_prices import catalog

    return {key: [m, l] for key, (m, l) in catalog.get_domain(domain).default_values().items()}


def _values_hash(values: dict) -> str:
    # Same as unit_prices.service.values_hash, so the app reuses these books
    canonical = json.dumps(
        {key: [round(float(m), 6), round(float(l), 6)] for key, (m, l) in sorted(values.items())},
        separators=(",", ":"), sort_keys=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def upgrade() -> None:
    conn = op.get_bind()

    if not _has_table(conn, "price_books"):
        op.create_table(
            "price_books",
            sa.Column("id", UUIDType(), primary_key=True),
            sa.Column("domain", sa.String(20), nullable=False),
            sa.Column("prices", sa.JSON(), nullable=False),
            sa.Column("values_hash", sa.String(64), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True)),
        )
        op.create_index("ix_price_books_id", "price_books", ["id"])
        op.create_index("ix_price_books_domain_hash", "price_books", ["domain", "values_hash"])

    if not _has_table(conn, "unit_price_overrides"):
        op.create_table(
            "unit_price_overrides",
            sa.Column("id", UUIDType(), primary_key=True),
            sa.Column("company_id", UUIDType(), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
            sa.Column("domain", sa.String(20), nullable=False),
            sa.Column("price_key", sa.String(200), nullable=False),
            sa.Column("material", sa.Float()),
            sa.Column("labor", sa.Float()),
            sa.Column("updated_by_id", UUIDType(), sa.ForeignKey("staff.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True)),
            sa.UniqueConstraint("company_id", "domain", "price_key", name="uq_unit_price_overrides_key"),
        )
        op.create_index("ix_unit_price_overrides_id", "unit_price_overrides", ["id"])
        op.create_index(
            "ix_unit_price_overrides_company_domain", "unit_price_overrides", ["company_id", "domain"],
        )

    if not _has_table(conn, "unit_price_changes"):
        op.create_table(
            "unit_price_changes",
            sa.Column("id", UUIDType(), primary_key=True),
            sa.Column("company_id", UUIDType(), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
            sa.Column("domain", sa.String(20), nullable=False),
            sa.Column("price_key", sa.String(200), nullable=False),
            sa.Column("old_material", sa.Float()),
            sa.Column("old_labor", sa.Float()),
            sa.Column("new_material", sa.Float()),
            sa.Column("new_labor", sa.Float()),
            sa.Column("changed_by_id", UUIDType(), sa.ForeignKey("staff.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True)),
        )
        op.create_index("ix_unit_price_changes_id", "unit_price_changes", ["id"])
        op.create_index(
            "ix_unit_price_changes_company_domain", "unit_price_changes",
            ["company_id", "domain", "created_at"],
        )

    books = sa.table(
        "price_books",
        sa.column("id", UUIDType()),
        sa.column("domain", sa.String()),
        sa.column("prices", sa.JSON()),
        sa.column("values_hash", sa.String()),
    )
    for table, line_items, domain in _ESTIMATES:
        if not _has_table(conn, table):
            continue
        if not _has_column(conn, table, "price_book_id"):
            # SQLite can't add a constraint to an existing table
            fk = [] if conn.dialect.name == "sqlite" else [
                sa.ForeignKey("price_books.id", name=f"fk_{table}_price_book_id", ondelete="SET NULL"),
            ]
            op.add_column(table, sa.Column("price_book_id", UUIDType(), *fk, nullable=True))

        # Pin what was already priced to the defaults it was priced with
        priced = conn.execute(sa.text(
            f"SELECT COUNT(*) FROM {table} e WHERE e.price_book_id IS NULL "
            f"AND EXISTS (SELECT 1 FROM {line_items} li WHERE li.estimate_id = e.id)"
        )).scalar()
        if not priced:
            continue
        values = _default_values(domain)
        digest = _values_hash(values)
        book_id = conn.execute(
            sa.select(books.c.id).where(books.c.domain == domain, books.c.values_hash == digest)
        ).scalar()
        if book_id is None:
            book_id = str(uuid.uuid4())
            op.bulk_insert(books, [{"id": book_id, "domain": domain, "prices": values, "values_hash": digest}])
        conn.execute(
            sa.text(
                f"UPDATE {table} SET price_book_id = :book WHERE price_book_id IS NULL "
                f"AND EXISTS (SELECT 1 FROM {line_items} li WHERE li.estimate_id = {table}.id)"
            ).bindparams(sa.bindparam("book", type_=UUIDType())),
            {"book": book_id},
        )


def downgrade() -> None:
    conn = op.get_bind()
    for table, _line_items, _domain in _ESTIMATES:
        if _has_table(conn, table) and _has_column(conn, table, "price_book_id"):
            if conn.dialect.name != "sqlite":
                op.drop_constraint(f"fk_{table}_price_book_id", table, type_="foreignkey")
            op.drop_column(table, "price_book_id")
    for table in ("unit_price_changes", "unit_price_overrides", "price_books"):
        if _has_table(conn, table):
            op.drop_table(table)
