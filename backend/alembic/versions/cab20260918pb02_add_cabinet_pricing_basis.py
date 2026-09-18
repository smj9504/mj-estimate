"""add pricing_basis to cabinet estimates

An insurance claim and a retail remodel price the same physical work
differently. The clearest case is appliance detach & reset: a carrier
pays crew time against published line items, while an installer charges
a homeowner a trip minimum on top. The two differ by 2-3x on the same
appliance, and neither is wrong.

Without this column the estimator had no way to say which world it was
quoting in, so the appliance table ended up holding rows drawn from
both. Two separate price reviews then "corrected" it in opposite
directions, because each compared against a different basis.

Defaults to INSURANCE_DR: these estimates are claim-linked and the UI
has always described the scope as detach & reset.

Revision ID: cab20260918pb02
Revises: cab20260918tp01
Create Date: 2026-09-18
"""

from alembic import op
import sqlalchemy as sa

revision = "cab20260918pb02"
down_revision = "cab20260918tp01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cabinet_estimates",
        sa.Column(
            "pricing_basis",
            sa.String(30),
            nullable=True,
            server_default="INSURANCE_DR",
        ),
    )
    # Existing rows were priced on the insurance basis, so state it
    # rather than leaving them ambiguous.
    op.execute(
        "UPDATE cabinet_estimates SET pricing_basis = 'INSURANCE_DR' "
        "WHERE pricing_basis IS NULL"
    )


def downgrade() -> None:
    op.drop_column("cabinet_estimates", "pricing_basis")
