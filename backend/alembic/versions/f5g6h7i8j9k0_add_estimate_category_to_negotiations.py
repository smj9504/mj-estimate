"""add estimate_category to claim_negotiations

Revision ID: f5g6h7i8j9k0
Revises: d4e5f6g7h8i0
Create Date: 2026-05-28
"""
from alembic import op
import sqlalchemy as sa

revision = 'f5g6h7i8j9k0'
down_revision = 'd4e5f6g7h8i0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    result = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='claim_negotiations' AND column_name='estimate_category'"
    ))
    if not result.fetchone():
        op.add_column(
            'claim_negotiations',
            sa.Column(
                'estimate_category',
                sa.String(30),
                nullable=True,
                comment='reconstruction | water_mitigation | combined',
            ),
        )

    # Backfill existing records based on notes pattern
    conn.execute(sa.text(
        "UPDATE claim_negotiations SET estimate_category = 'water_mitigation' "
        "WHERE estimate_category IS NULL AND notes ILIKE '%Water Mitigation%'"
    ))
    conn.execute(sa.text(
        "UPDATE claim_negotiations SET estimate_category = 'reconstruction' "
        "WHERE estimate_category IS NULL AND notes ILIKE '%Reconstruction%'"
    ))
    conn.execute(sa.text(
        "UPDATE claim_negotiations SET estimate_category = 'combined' "
        "WHERE estimate_category IS NULL AND revision_type = 'initial'"
    ))


def downgrade() -> None:
    op.drop_column('claim_negotiations', 'estimate_category')
