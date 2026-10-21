"""add rebuild_estimate_company_id to claims

Some carriers ask the contractor to write the rebuild estimate. It must then
come from a company other than the one that did the water mitigation, so the
claim records which company writes and sends it.

Revision ID: rbe20261021cl01
Revises: apr20261021cl01
Create Date: 2026-10-21
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'rbe20261021cl01'
down_revision = 'apr20261021cl01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    result = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='claims' AND column_name='rebuild_estimate_company_id'"
    ))
    if not result.fetchone():
        op.add_column(
            'claims',
            sa.Column(
                'rebuild_estimate_company_id',
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey('companies.id', ondelete='SET NULL'),
                nullable=True,
                comment='Company that writes the rebuild estimate when the carrier asks the contractor',
            ),
        )


def downgrade() -> None:
    op.drop_column('claims', 'rebuild_estimate_company_id')
