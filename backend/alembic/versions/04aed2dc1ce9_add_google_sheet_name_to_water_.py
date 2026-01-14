"""Add google_sheet_name to water_mitigation_jobs

Revision ID: 04aed2dc1ce9
Revises: 3c4d5e6f7a8b
Create Date: 2026-01-14 21:35:27.754614

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '04aed2dc1ce9'
down_revision = '3c4d5e6f7a8b'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add google_sheet_name column to water_mitigation_jobs
    op.add_column('water_mitigation_jobs', sa.Column('google_sheet_name', sa.String(length=100), nullable=True))
    op.create_index(op.f('ix_water_mitigation_jobs_google_sheet_name'), 'water_mitigation_jobs', ['google_sheet_name'], unique=False)


def downgrade() -> None:
    # Remove google_sheet_name column from water_mitigation_jobs
    op.drop_index(op.f('ix_water_mitigation_jobs_google_sheet_name'), table_name='water_mitigation_jobs')
    op.drop_column('water_mitigation_jobs', 'google_sheet_name')
