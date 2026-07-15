"""Add partial unique index to prevent duplicate active supplements per claim

Revision ID: sup20260715uq01
Revises: wm20260714ae01
Create Date: 2026-07-15

Adds:
  - Partial unique index on supplement_requests (claim_id, request_type)
    WHERE status NOT IN ('approved', 'denied', 'withdrawn')
  - Prevents race condition where multiple insurance estimate uploads
    create duplicate supplement requests for the same claim
"""

from alembic import op

revision = 'sup20260715uq01'
down_revision = 'wm20260714ae01'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_supplement_requests_active_per_claim
        ON supplement_requests (claim_id, request_type)
        WHERE status NOT IN ('approved', 'denied', 'withdrawn')
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS uq_supplement_requests_active_per_claim")
