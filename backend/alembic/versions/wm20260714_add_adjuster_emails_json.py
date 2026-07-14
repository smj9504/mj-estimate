"""Add adjuster_emails JSONB column to water_mitigation_jobs

Revision ID: wm20260714ae01
Revises: wm20260711sp01
Create Date: 2026-07-14

Adds:
  - adjuster_emails: JSONB array for multiple adjuster/insurance
    email contacts [{name, email, role}]
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = 'wm20260714ae01'
down_revision = 'cab20260713cb01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'water_mitigation_jobs',
        sa.Column(
            'adjuster_emails',
            JSONB,
            nullable=True,
            comment=(
                'Additional adjuster/insurance emails '
                '[{name, email, role}]'
            ),
        ),
    )


def downgrade() -> None:
    op.drop_column('water_mitigation_jobs', 'adjuster_emails')
