"""add estimate_origin and contractor_estimate_stage to claims

Revision ID: neg20260914eo01
Revises: cab20260910pl01
Create Date: 2026-09-14
"""
from alembic import op
import sqlalchemy as sa

revision = 'neg20260914eo01'
down_revision = 'cab20260910pl01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    result = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='claims' AND column_name='estimate_origin'"
    ))
    if not result.fetchone():
        op.add_column(
            'claims',
            sa.Column(
                'estimate_origin',
                sa.String(30),
                nullable=True,
                comment='carrier_provided | contractor_prepared',
            ),
        )

    result = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='claims' AND column_name='contractor_estimate_stage'"
    ))
    if not result.fetchone():
        op.add_column(
            'claims',
            sa.Column(
                'contractor_estimate_stage',
                sa.String(40),
                nullable=True,
                comment=(
                    'requested | estimate_sent | awaiting_approval '
                    '| approved_initial_received'
                ),
            ),
        )

    # Backfill: a claim that already has a carrier estimate on file, or any
    # negotiation revision recorded, came through the normal carrier path.
    # Claims with neither are left NULL (unknown) rather than guessed at.
    conn.execute(sa.text(
        "UPDATE claims SET estimate_origin = 'carrier_provided' "
        "WHERE estimate_origin IS NULL "
        "AND (insurance_estimate_received = TRUE "
        "     OR id IN (SELECT DISTINCT claim_id FROM claim_negotiations))"
    ))


def downgrade() -> None:
    op.drop_column('claims', 'contractor_estimate_stage')
    op.drop_column('claims', 'estimate_origin')
