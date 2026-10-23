"""add matched_wm_job_id to received_emails

Before following up on a water mitigation job, staff need to see whether
the adjuster already wrote back. Adjuster mail often matches no claim - the
job may not be linked to one, and the matcher only knew the homeowner's
address - so inbound mail can now point at the WM job itself.

Revision ID: ei20261023wmj01
Revises: wm20261023dw401
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'ei20261023wmj01'
down_revision = 'wm20261023dw401'
branch_labels = None
depends_on = None

TABLE = 'received_emails'
COLUMN = 'matched_wm_job_id'
FK_NAME = 'fk_received_emails_matched_wm_job_id'
INDEX_NAME = 'ix_received_emails_wm_job_id'


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    # A fresh database gets the table from create_all at startup, already in this shape
    if not inspector.has_table(TABLE):
        return

    # The app's startup column check may have added the column already,
    # without the foreign key or index
    columns = {c['name'] for c in inspector.get_columns(TABLE)}
    foreign_keys = {fk['name'] for fk in inspector.get_foreign_keys(TABLE)}
    indexes = {ix['name'] for ix in inspector.get_indexes(TABLE)}
    if COLUMN not in columns:
        op.add_column(TABLE, sa.Column(COLUMN, postgresql.UUID(as_uuid=True), nullable=True))
    if FK_NAME not in foreign_keys:
        op.create_foreign_key(
            FK_NAME, TABLE, 'water_mitigation_jobs', [COLUMN], ['id'], ondelete='SET NULL'
        )
    if INDEX_NAME not in indexes:
        op.create_index(INDEX_NAME, TABLE, [COLUMN])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(TABLE):
        return
    foreign_keys = {fk['name'] for fk in inspector.get_foreign_keys(TABLE)}
    if FK_NAME in foreign_keys:
        op.drop_constraint(FK_NAME, TABLE, type_='foreignkey')
    op.execute(f"DROP INDEX IF EXISTS {INDEX_NAME}")
    op.drop_column(TABLE, COLUMN)
