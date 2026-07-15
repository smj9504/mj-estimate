"""add depreciation_phase column to followup_tasks

Revision ID: dep20260716dp01
Revises: cli20260715fk01
Create Date: 2026-07-16
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = 'dep20260716dp01'
down_revision = 'cli20260715fk01'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'followup_tasks',
        sa.Column(
            'depreciation_phase',
            sa.String(50),
            nullable=True,
            comment='in_construction | construction_done | preparing_docs | docs_sent_pa | docs_sent_insurance | following_up | payment_received',
        ),
    )
    op.create_index(
        'ix_followup_tasks_dep_phase',
        'followup_tasks',
        ['task_type', 'depreciation_phase'],
    )


def downgrade():
    op.drop_index('ix_followup_tasks_dep_phase', table_name='followup_tasks')
    op.drop_column('followup_tasks', 'depreciation_phase')
