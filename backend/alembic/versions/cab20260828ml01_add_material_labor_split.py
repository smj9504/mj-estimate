"""Add material/labor split columns to cabinet_estimate_line_items

Revision ID: cab20260828ml01
Revises: ei20260825ah01
Create Date: 2026-08-28

unit_price and total stay the combined figures the estimate and its PDF quote;
these four columns carry the breakdown behind them.
"""
from alembic import op
import sqlalchemy as sa

revision = 'cab20260828ml01'
down_revision = 'ei20260825ah01'
branch_labels = None
depends_on = None

COLUMNS = [
    'material_unit_price',
    'labor_unit_price',
    'material_total',
    'labor_total',
]


def upgrade() -> None:
    bind = op.get_bind()
    existing = [
        c["name"]
        for c in sa.inspect(bind).get_columns(
            "cabinet_estimate_line_items"
        )
    ]
    # A database built by metadata.create_all already has them.
    for col in COLUMNS:
        if col not in existing:
            op.add_column(
                'cabinet_estimate_line_items',
                sa.Column(
                    col, sa.Float(),
                    nullable=True, server_default='0',
                ),
            )


def downgrade() -> None:
    for col in reversed(COLUMNS):
        op.drop_column('cabinet_estimate_line_items', col)
