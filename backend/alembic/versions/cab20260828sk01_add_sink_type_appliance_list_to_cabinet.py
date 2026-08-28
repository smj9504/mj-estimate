"""Add sink_type and appliance_list to cabinet_estimates

Revision ID: cab20260828sk01
Revises: ei20260825ah01
Create Date: 2026-08-28

Both columns are declared on the CabinetEstimate model but were never
added to the table by a migration, so on any database built from the
migration chain every SELECT against cabinet_estimates fails with
UndefinedColumn - the cabinet estimate list/detail screens return 500.
"""
from alembic import op
import sqlalchemy as sa

revision = 'cab20260828sk01'
down_revision = 'ei20260825ah01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = [
        c["name"]
        for c in sa.inspect(bind).get_columns("cabinet_estimates")
    ]

    # Databases created by metadata.create_all already carry both columns,
    # so only add what is actually missing.
    if 'sink_type' not in columns:
        op.add_column(
            'cabinet_estimates',
            sa.Column(
                'sink_type', sa.String(20),
                nullable=True, server_default='single',
            ),
        )
    if 'appliance_list' not in columns:
        op.add_column(
            'cabinet_estimates',
            sa.Column('appliance_list', sa.JSON(), nullable=True),
        )


def downgrade() -> None:
    op.drop_column('cabinet_estimates', 'appliance_list')
    op.drop_column('cabinet_estimates', 'sink_type')
