"""backfill insurance_estimate_received from negotiation revisions

Revisions added from the Client page didn't set the flag, so claims with a
carrier estimate in their negotiation history still read "Not received".

Revision ID: neg20261023rcv01
Revises: rbe20261021cl01
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa

revision = 'neg20261023rcv01'
down_revision = 'rbe20261021cl01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Received date: the earliest revision's, so the claim reads as it did
    # when the first carrier estimate came in
    op.get_bind().execute(sa.text(
        "UPDATE claims c SET "
        "  insurance_estimate_received = TRUE, "
        "  insurance_estimate_received_date = COALESCE("
        "    c.insurance_estimate_received_date, first_rev.received_at) "
        "FROM ("
        "  SELECT claim_id, MIN(created_at) AS received_at "
        "  FROM claim_negotiations GROUP BY claim_id"
        ") first_rev "
        "WHERE first_rev.claim_id = c.id "
        "AND (c.insurance_estimate_received IS NOT TRUE)"
    ))


def downgrade() -> None:
    # Data-only backfill; nothing to undo
    pass
