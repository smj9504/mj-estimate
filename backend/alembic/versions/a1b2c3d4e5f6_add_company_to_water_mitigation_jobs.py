"""Add company assignment to water_mitigation_jobs

Revision ID: a1b2c3d4e5f6
Revises: 363ad6f0697d
Create Date: 2025-01-06

This migration adds an optional company_id foreign key to water_mitigation_jobs
to track which company is responsible for/assigned to each job.

Note: This is separate from client_id which represents the customer/homeowner.
company_id represents the service provider company handling the job.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f6'
down_revision = '363ad6f0697d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add company_id column (nullable - optional assignment)
    op.add_column(
        'water_mitigation_jobs',
        sa.Column(
            'company_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('companies.id', ondelete='SET NULL'),
            nullable=True,
            comment='Company responsible for/assigned to this job'
        )
    )

    # Add index for efficient queries by company
    op.create_index(
        'ix_wm_jobs_company',
        'water_mitigation_jobs',
        ['company_id'],
        unique=False
    )

    # Add composite index for common query pattern: company + status
    op.create_index(
        'ix_wm_jobs_company_status',
        'water_mitigation_jobs',
        ['company_id', 'status'],
        unique=False
    )


def downgrade() -> None:
    # Remove indexes first
    op.drop_index('ix_wm_jobs_company_status', table_name='water_mitigation_jobs')
    op.drop_index('ix_wm_jobs_company', table_name='water_mitigation_jobs')

    # Remove column
    op.drop_column('water_mitigation_jobs', 'company_id')
