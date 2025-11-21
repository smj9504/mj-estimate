"""merge performance indexes heads

Revision ID: 51d09a09ed63
Revises: c8d9e2f4a5b6, 5fbe050fb10a
Create Date: 2025-11-22 03:30:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '51d09a09ed63'
down_revision = ('c8d9e2f4a5b6', '5fbe050fb10a')
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Merge two heads - both migrations create the same indexes"""
    # Both migrations create the same indexes, so no additional work needed
    # The indexes are already created by one of the parent migrations
    pass


def downgrade() -> None:
    """Merge two heads - both migrations create the same indexes"""
    # Both migrations create the same indexes, so no additional work needed
    pass

