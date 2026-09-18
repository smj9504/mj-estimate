"""persist roofing contingency and the material/labor split

Three gaps this closes:

1. contingency was folded into the grand total but never stored, so a
   saved estimate could not be reconciled line by line — the PDF total
   was short by contingency_pct with nothing to point at.

2. roofing_subtotal / gutter_subtotal were calculated and returned but
   never written, so both columns sat at 0 on every saved estimate.

3. The material share of an installed price was a single hardcoded 0.50
   for the whole estimate. It is now per line item (see MATERIAL_PORTIONS
   in pricing.py), with material_portion_pct as a per-estimate override,
   and the resulting totals are stored so markup and tax are auditable.

Revision ID: rfg20260917ml02
Revises: rfg20260917mc01
Create Date: 2026-09-17
"""
from alembic import op
import sqlalchemy as sa

revision = 'rfg20260917ml02'
down_revision = 'rfg20260917mc01'
branch_labels = None
depends_on = None


ESTIMATE_COLUMNS = (
    ('contingency_amount', lambda: sa.Column(
        'contingency_amount', sa.Float(), nullable=True,
        server_default='0')),
    ('material_cost_total', lambda: sa.Column(
        'material_cost_total', sa.Float(), nullable=True,
        server_default='0')),
    ('labor_cost_total', lambda: sa.Column(
        'labor_cost_total', sa.Float(), nullable=True, server_default='0')),
    # Null means "use the per-category ratios"; a value overrides them all.
    ('material_portion_pct', lambda: sa.Column(
        'material_portion_pct', sa.Float(), nullable=True)),
)

LINE_ITEM_COLUMNS = (
    ('material_portion', lambda: sa.Column(
        'material_portion', sa.Float(), nullable=True)),
    ('material_cost', lambda: sa.Column(
        'material_cost', sa.Float(), nullable=True)),
    ('labor_cost', lambda: sa.Column(
        'labor_cost', sa.Float(), nullable=True)),
)


def _has_column(conn, table: str, column: str) -> bool:
    if conn.dialect.name == 'sqlite':
        rows = conn.execute(sa.text(f"PRAGMA table_info({table})")).fetchall()
        return any(r[1] == column for r in rows)
    result = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name=:t AND column_name=:c"
    ), {"t": table, "c": column})
    return result.fetchone() is not None


def upgrade() -> None:
    conn = op.get_bind()

    for name, make in ESTIMATE_COLUMNS:
        if not _has_column(conn, 'roofing_estimates', name):
            op.add_column('roofing_estimates', make())

    for name, make in LINE_ITEM_COLUMNS:
        if not _has_column(conn, 'roofing_estimate_line_items', name):
            op.add_column('roofing_estimate_line_items', make())

    # Existing rows were priced at the old flat 50% material assumption.
    # Backfill the split so previously saved line items still reconcile
    # instead of reading as "no material at all"; recalculating an
    # estimate overwrites these with the per-category values.
    if _has_column(conn, 'roofing_estimate_line_items', 'material_cost'):
        conn.execute(sa.text(
            "UPDATE roofing_estimate_line_items "
            "SET material_portion = 0.5, "
            "    material_cost = ROUND(CAST(total * 0.5 AS numeric), 2), "
            "    labor_cost = ROUND(CAST(total * 0.5 AS numeric), 2) "
            "WHERE material_portion IS NULL"
        ) if conn.dialect.name != 'sqlite' else sa.text(
            "UPDATE roofing_estimate_line_items "
            "SET material_portion = 0.5, "
            "    material_cost = ROUND(total * 0.5, 2), "
            "    labor_cost = ROUND(total * 0.5, 2) "
            "WHERE material_portion IS NULL"
        ))


def downgrade() -> None:
    conn = op.get_bind()

    for name, _ in reversed(LINE_ITEM_COLUMNS):
        if _has_column(conn, 'roofing_estimate_line_items', name):
            op.drop_column('roofing_estimate_line_items', name)

    for name, _ in reversed(ESTIMATE_COLUMNS):
        if _has_column(conn, 'roofing_estimates', name):
            op.drop_column('roofing_estimates', name)
