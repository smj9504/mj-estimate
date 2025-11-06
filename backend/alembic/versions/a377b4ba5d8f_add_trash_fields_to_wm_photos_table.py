"""Add trash fields to wm_photos table

Revision ID: a377b4ba5d8f
Revises: 7748559566bd
Create Date: 2025-11-06 19:23:27.228046

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a377b4ba5d8f'
down_revision = '7748559566bd'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add trash/deletion tracking fields to wm_photos table
    op.add_column('wm_photos', sa.Column('is_trashed', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('wm_photos', sa.Column('trashed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('wm_photos', sa.Column('trashed_by_id', sa.dialects.postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('wm_photos', sa.Column('trash_reason', sa.String(length=100), nullable=True))

    # Add foreign key constraint for trashed_by_id
    op.create_foreign_key(
        'fk_wm_photos_trashed_by',
        'wm_photos',
        'staff',
        ['trashed_by_id'],
        ['id']
    )


def downgrade() -> None:
    # Remove foreign key constraint
    op.drop_constraint('fk_wm_photos_trashed_by', 'wm_photos', type_='foreignkey')

    # Remove trash fields
    op.drop_column('wm_photos', 'trash_reason')
    op.drop_column('wm_photos', 'trashed_by_id')
    op.drop_column('wm_photos', 'trashed_at')
    op.drop_column('wm_photos', 'is_trashed')
