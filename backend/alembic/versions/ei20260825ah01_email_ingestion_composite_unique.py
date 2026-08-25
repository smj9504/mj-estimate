"""Make email_ingestion_logs uniqueness per-attachment, not per-email

Revision ID: ei20260825ah01
Revises: eo20260825ot01
Create Date: 2026-08-25

Previously message_id alone was unique, so if an email had multiple PDF
attachments and only one failed to process, the whole email (including the
already-succeeded attachments) would be permanently skipped on the next poll
- poll_account checked exists_by_message_id before even looking at
attachments. Switching to a composite (message_id, attachment_hash) unique
index lets each attachment be retried independently.

Note: the original table was created with Column(..., unique=True), which
Postgres backs with an auto-named UNIQUE CONSTRAINT
(email_ingestion_logs_message_id_key), not the ix_email_ingestion_logs_*
index alembic created alongside it. Both must be dropped.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'ei20260825ah01'
down_revision = 'eo20260825ot01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint('email_ingestion_logs_message_id_key', 'email_ingestion_logs', type_='unique')
    op.create_index(
        'ix_email_ingestion_logs_msgid_hash',
        'email_ingestion_logs',
        ['message_id', 'attachment_hash'],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index('ix_email_ingestion_logs_msgid_hash', table_name='email_ingestion_logs')
    op.create_unique_constraint(
        'email_ingestion_logs_message_id_key',
        'email_ingestion_logs',
        ['message_id'],
    )
