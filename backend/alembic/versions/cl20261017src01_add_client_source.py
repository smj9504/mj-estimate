"""add source to clients

The client list splits clients created by the AccuLynx archive import from
the ones entered in this app. Clients the import matched to an existing
client keep NULL - they were entered here first.

Backfill: the importer wrote notes = 'Imported from AccuLynx' on every client
it created, and only those clients can have it together with an archived job.

Revision ID: cl20261017src01
Revises: alx20261017ar01
Create Date: 2026-10-17
"""
from alembic import op
import sqlalchemy as sa

revision = 'cl20261017src01'
down_revision = 'alx20261017ar01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = {c['name'] for c in inspector.get_columns('clients')}
    if 'source' not in existing:
        op.add_column(
            'clients',
            sa.Column(
                'source', sa.String(20), nullable=True,
                comment="NULL = entered in this app, 'acculynx' = AccuLynx archive import",
            ),
        )

    if 'acculynx_archived_jobs' in inspector.get_table_names():
        op.execute(
            """
            UPDATE clients SET source = 'acculynx'
            WHERE source IS NULL
              AND notes = 'Imported from AccuLynx'
              AND id IN (SELECT client_id FROM acculynx_archived_jobs)
            """
        )


def downgrade() -> None:
    op.drop_column('clients', 'source')
