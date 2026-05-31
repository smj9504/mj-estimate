"""add request_type and our_estimate_amount to supplement_requests

Revision ID: g7h8i9j0k1l2
Revises: f5g6h7i8j9k0
Create Date: 2025-05-29

"""
from alembic import op
import sqlalchemy as sa

revision = 'g6h7i8j9k0l2'
down_revision = 'g6h7i8j9k0l1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Add request_type column
    result = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='supplement_requests' "
        "AND column_name='request_type'"
    ))
    if not result.fetchone():
        op.add_column(
            'supplement_requests',
            sa.Column(
                'request_type',
                sa.String(50),
                nullable=False,
                server_default='supplement',
                comment='supplement | estimate_request',
            ),
        )

    # Add our_estimate_amount column
    result = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='supplement_requests' "
        "AND column_name='our_estimate_amount'"
    ))
    if not result.fetchone():
        op.add_column(
            'supplement_requests',
            sa.Column(
                'our_estimate_amount',
                sa.DECIMAL(15, 2),
                nullable=True,
                server_default='0',
                comment='Contractor estimate amount '
                        '(for estimate_request type)',
            ),
        )


def downgrade() -> None:
    op.drop_column('supplement_requests', 'our_estimate_amount')
    op.drop_column('supplement_requests', 'request_type')
