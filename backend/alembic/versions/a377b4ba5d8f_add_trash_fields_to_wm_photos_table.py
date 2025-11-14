"""Add trash fields to wm_photos table

Revision ID: a377b4ba5d8f
Revises: 7748559566bd
Create Date: 2025-11-06 19:23:27.228046

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = 'a377b4ba5d8f'
down_revision = '7748559566bd'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add trash/deletion tracking fields to wm_photos table
    # Check if columns exist before adding (idempotent migration)
    conn = op.get_bind()

    # Check if is_trashed column exists
    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
        "WHERE table_name = 'wm_photos' AND column_name = 'is_trashed')"
    ))
    is_trashed_exists = result.scalar()

    if not is_trashed_exists:
        op.add_column(
            'wm_photos',
            sa.Column(
                'is_trashed',
                sa.Boolean(),
                nullable=False,
                server_default='false'
            )
        )

    # Check if trashed_at column exists
    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
        "WHERE table_name = 'wm_photos' AND column_name = 'trashed_at')"
    ))
    trashed_at_exists = result.scalar()

    if not trashed_at_exists:
        op.add_column(
            'wm_photos',
            sa.Column('trashed_at', sa.DateTime(timezone=True), nullable=True)
        )

    # Check if trashed_by_id column exists
    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
        "WHERE table_name = 'wm_photos' AND column_name = 'trashed_by_id')"
    ))
    trashed_by_id_exists = result.scalar()

    if not trashed_by_id_exists:
        op.add_column(
            'wm_photos',
            sa.Column(
                'trashed_by_id',
                sa.dialects.postgresql.UUID(as_uuid=True),
                nullable=True
            )
        )

    # Check if trash_reason column exists
    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
        "WHERE table_name = 'wm_photos' AND column_name = 'trash_reason')"
    ))
    trash_reason_exists = result.scalar()

    if not trash_reason_exists:
        op.add_column(
            'wm_photos',
            sa.Column('trash_reason', sa.String(length=100), nullable=True)
        )

    # Add foreign key constraint for trashed_by_id (if it doesn't exist)
    # Check if column exists now (may have been just added)
    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
        "WHERE table_name = 'wm_photos' AND column_name = 'trashed_by_id')"
    ))
    trashed_by_id_exists_now = result.scalar()

    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.table_constraints "
        "WHERE constraint_name = 'fk_wm_photos_trashed_by' "
        "AND table_name = 'wm_photos')"
    ))
    fk_exists = result.scalar()

    if not fk_exists and trashed_by_id_exists_now:
        op.create_foreign_key(
            'fk_wm_photos_trashed_by',
            'wm_photos',
            'staff',
            ['trashed_by_id'],
            ['id']
        )


def downgrade() -> None:
    # Remove foreign key constraint
    op.drop_constraint(
        'fk_wm_photos_trashed_by', 'wm_photos', type_='foreignkey'
    )

    # Remove trash fields
    op.drop_column('wm_photos', 'trash_reason')
    op.drop_column('wm_photos', 'trashed_by_id')
    op.drop_column('wm_photos', 'trashed_at')
    op.drop_column('wm_photos', 'is_trashed')
