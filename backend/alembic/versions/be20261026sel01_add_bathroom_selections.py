"""bathroom selections: the products an option is built from

A bathroom option can name a real product for each slot (the vanity, the
floor tile, the toilet…) from the shared product library. The estimate
keeps a copy of each, so it stays as it was sent; its price becomes the
option's material cost. Restorations never have any.

Revision ID: be20261026sel01
Revises: pl20261026pr01
Create Date: 2026-10-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "be20261026sel01"
down_revision = "pl20261026pr01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "bathroom_estimates",
        sa.Column("selections", JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("bathroom_estimates", "selections")
