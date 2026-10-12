"""add payment_note_updated_at to water_mitigation_jobs

The payment board shows when a note was last written under the note.
Existing notes keep NULL (no reliable date to backfill from), so they
show no date until they are next edited.

Revision ID: wm20261013pn01
Revises: rfg20261009im14
Create Date: 2026-10-13
"""
from alembic import op
import sqlalchemy as sa

revision = 'wm20261013pn01'
down_revision = 'rfg20261009im14'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = {c['name'] for c in inspector.get_columns('water_mitigation_jobs')}
    if 'payment_note_updated_at' not in existing:
        op.add_column(
            'water_mitigation_jobs',
            sa.Column(
                'payment_note_updated_at', sa.DateTime(timezone=True), nullable=True,
                comment='When payment_note was last written',
            ),
        )


def downgrade() -> None:
    op.drop_column('water_mitigation_jobs', 'payment_note_updated_at')
