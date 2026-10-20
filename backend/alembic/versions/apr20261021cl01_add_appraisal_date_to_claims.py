"""add appraisal_date to claims

A claim can leave negotiation for appraisal, sometimes after one or more
supplements. Appraisal is settled outside the supplement process, so the
claim's status becomes 'appraisal' and appraisal_date records when it moved.
The date stays after the claim settles so its history still shows it.

Revision ID: apr20261021cl01
Revises: dt20261021own01
Create Date: 2026-10-21
"""
from alembic import op
import sqlalchemy as sa

revision = 'apr20261021cl01'
down_revision = 'dt20261021own01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    result = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='claims' AND column_name='appraisal_date'"
    ))
    if not result.fetchone():
        op.add_column(
            'claims',
            sa.Column(
                'appraisal_date',
                sa.DateTime(timezone=True),
                nullable=True,
                comment='When the claim moved from negotiation to appraisal',
            ),
        )


def downgrade() -> None:
    op.drop_column('claims', 'appraisal_date')
