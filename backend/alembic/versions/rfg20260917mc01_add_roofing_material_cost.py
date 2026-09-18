"""add internal material cost fields to roofing_estimates

The customer-facing estimate prices work at installed rates, where
material and labor are a single number. These two columns hold the
internal side of that: what the material actually costs us, so gross
profit can be reasoned about. Neither is ever exported to a customer.

material_cost_overrides stores only the materials whose real supplier
price differs from the default table in material_cost.py, so leaving it
NULL simply means "defaults are accurate". material_tax_rate NULL means
"derive from the property state" (MD/DC 6%, VA 5.3%).

Revision ID: rfg20260917mc01
Revises: eo20260915px01
Create Date: 2026-09-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'rfg20260917mc01'
down_revision = 'eo20260915px01'
branch_labels = None
depends_on = None


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
    json_type = (
        sa.JSON() if conn.dialect.name == 'sqlite'
        else postgresql.JSONB(astext_type=sa.Text())
    )

    if not _has_column(conn, 'roofing_estimates', 'material_cost_overrides'):
        op.add_column(
            'roofing_estimates',
            sa.Column('material_cost_overrides', json_type, nullable=True),
        )

    if not _has_column(conn, 'roofing_estimates', 'material_tax_rate'):
        op.add_column(
            'roofing_estimates',
            sa.Column('material_tax_rate', sa.Float(), nullable=True),
        )


def downgrade() -> None:
    conn = op.get_bind()

    if _has_column(conn, 'roofing_estimates', 'material_tax_rate'):
        op.drop_column('roofing_estimates', 'material_tax_rate')

    if _has_column(conn, 'roofing_estimates', 'material_cost_overrides'):
        op.drop_column('roofing_estimates', 'material_cost_overrides')
