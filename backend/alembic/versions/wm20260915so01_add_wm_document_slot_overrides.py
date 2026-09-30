"""add wm_document_slot_overrides table

Lets a user manually map one of the job's documents to a required
adjuster-email slot (photo_report, invoice, w9, cos, ewa, sketch) when the
automatic document_type matching doesn't find it.

Revision ID: wm20260915so01
Revises: neg20260914eo01
Create Date: 2026-09-15
"""
from alembic import op
import sqlalchemy as sa

revision = 'wm20260915so01'
down_revision = 'neg20260914eo01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    result = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_name='wm_document_slot_overrides'"
    ))
    if result.fetchone():
        return

    op.create_table(
        'wm_document_slot_overrides',
        sa.Column('id', sa.dialects.postgresql.UUID(as_uuid=True),
                  primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('job_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('water_mitigation_jobs.id'),
                  nullable=False),
        sa.Column('slot_key', sa.String(30), nullable=False,
                  comment='photo_report | invoice | w9 | cos | ewa | sketch'),
        sa.Column('document_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('wm_documents.id'),
                  nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column('is_active', sa.Boolean(), server_default=sa.text('true')),
    )

    # One override per (job, slot) - setting a slot again replaces it.
    op.create_index(
        'ix_wm_doc_slot_override_job_slot',
        'wm_document_slot_overrides',
        ['job_id', 'slot_key'],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        'ix_wm_doc_slot_override_job_slot',
        table_name='wm_document_slot_overrides',
    )
    op.drop_table('wm_document_slot_overrides')
