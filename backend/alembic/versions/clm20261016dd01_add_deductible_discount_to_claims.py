"""add deductible_discount to claims

The homeowner legally owes the deductible, but the company sometimes
discounts part or all of it. That discount comes straight out of the
company's income, so it is recorded on the claim next to the deductible.
Existing claims default to 0 (no discount).

Revision ID: clm20261016dd01
Revises: wm20261013pn01
Create Date: 2026-10-16
"""
from alembic import op
import sqlalchemy as sa

revision = 'clm20261016dd01'
down_revision = 'wm20261013pn01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = {c['name'] for c in inspector.get_columns('claims')}
    if 'deductible_discount' not in existing:
        op.add_column(
            'claims',
            sa.Column(
                'deductible_discount', sa.DECIMAL(15, 2), nullable=False,
                server_default='0',
                comment='Part of the deductible the company waived for the homeowner',
            ),
        )


def downgrade() -> None:
    op.drop_column('claims', 'deductible_discount')
