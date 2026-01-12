"""Add photo_analysis_cache table

Revision ID: 2b768537a75c
Revises: 91aedb755312
Create Date: 2026-01-09 23:40:17.945196

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '2b768537a75c'
down_revision = '91aedb755312'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Modify photo_analysis_cache table for AI photo classification.

    Changes:
    - Remove old columns (room analysis cache)
    - Add new columns (photo classification cache)
    """
    # Add new columns
    op.add_column('photo_analysis_cache', sa.Column('photo_id', sa.UUID(), nullable=True))
    op.add_column('photo_analysis_cache', sa.Column('ai_result', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('photo_analysis_cache', sa.Column('user_corrected', sa.Boolean(), server_default='false', nullable=True))

    # Drop old indexes
    op.drop_index('ix_photo_analysis_cache_expires_at', table_name='photo_analysis_cache', if_exists=True)
    op.drop_index('ix_photo_analysis_cache_key', table_name='photo_analysis_cache', if_exists=True)
    op.drop_index('ix_photo_analysis_cache_user_id', table_name='photo_analysis_cache', if_exists=True)

    # Drop old unique constraint
    op.execute('ALTER TABLE photo_analysis_cache DROP CONSTRAINT IF EXISTS photo_analysis_cache_cache_key_key')

    # Create new indexes
    op.create_index('ix_photo_analysis_corrected', 'photo_analysis_cache', ['user_corrected'], unique=False)
    op.create_index('ix_photo_analysis_photo', 'photo_analysis_cache', ['photo_id'], unique=False)

    # Create unique constraint on photo_id
    op.create_unique_constraint('uq_photo_analysis_cache_photo_id', 'photo_analysis_cache', ['photo_id'])

    # Create foreign key to wm_photos
    op.create_foreign_key(
        'fk_photo_analysis_cache_photo_id',
        'photo_analysis_cache',
        'wm_photos',
        ['photo_id'],
        ['id'],
        ondelete='CASCADE'
    )

    # Drop old columns (if they exist)
    op.execute('ALTER TABLE photo_analysis_cache DROP COLUMN IF EXISTS photo_urls')
    op.execute('ALTER TABLE photo_analysis_cache DROP COLUMN IF EXISTS user_id')
    op.execute('ALTER TABLE photo_analysis_cache DROP COLUMN IF EXISTS expires_at')
    op.execute('ALTER TABLE photo_analysis_cache DROP COLUMN IF EXISTS cache_key')
    op.execute('ALTER TABLE photo_analysis_cache DROP COLUMN IF EXISTS analysis_result')
    op.execute('ALTER TABLE photo_analysis_cache DROP COLUMN IF EXISTS room_type')
    op.execute('ALTER TABLE photo_analysis_cache DROP COLUMN IF EXISTS confidence_score')

    # Make photo_id and ai_result NOT NULL after cleanup
    op.execute('DELETE FROM photo_analysis_cache WHERE photo_id IS NULL')
    op.alter_column('photo_analysis_cache', 'photo_id', nullable=False)
    op.alter_column('photo_analysis_cache', 'ai_result', nullable=False)


def downgrade() -> None:
    """Revert to old photo_analysis_cache structure"""
    # Drop new foreign key and constraints
    op.drop_constraint('fk_photo_analysis_cache_photo_id', 'photo_analysis_cache', type_='foreignkey')
    op.drop_constraint('uq_photo_analysis_cache_photo_id', 'photo_analysis_cache', type_='unique')

    # Drop new indexes
    op.drop_index('ix_photo_analysis_photo', table_name='photo_analysis_cache')
    op.drop_index('ix_photo_analysis_corrected', table_name='photo_analysis_cache')

    # Add back old columns
    op.add_column('photo_analysis_cache', sa.Column('confidence_score', sa.DOUBLE_PRECISION(), nullable=True))
    op.add_column('photo_analysis_cache', sa.Column('room_type', sa.VARCHAR(length=50), nullable=True))
    op.add_column('photo_analysis_cache', sa.Column('analysis_result', postgresql.JSON(), nullable=True))
    op.add_column('photo_analysis_cache', sa.Column('cache_key', sa.VARCHAR(length=255), nullable=True))
    op.add_column('photo_analysis_cache', sa.Column('expires_at', postgresql.TIMESTAMP(timezone=True), nullable=True))
    op.add_column('photo_analysis_cache', sa.Column('user_id', sa.UUID(), nullable=True))
    op.add_column('photo_analysis_cache', sa.Column('photo_urls', postgresql.JSON(), nullable=True))

    # Recreate old indexes
    op.create_unique_constraint('photo_analysis_cache_cache_key_key', 'photo_analysis_cache', ['cache_key'])
    op.create_index('ix_photo_analysis_cache_user_id', 'photo_analysis_cache', ['user_id'], unique=False)
    op.create_index('ix_photo_analysis_cache_key', 'photo_analysis_cache', ['cache_key'], unique=True)
    op.create_index('ix_photo_analysis_cache_expires_at', 'photo_analysis_cache', ['expires_at'], unique=False)

    # Drop new columns
    op.drop_column('photo_analysis_cache', 'user_corrected')
    op.drop_column('photo_analysis_cache', 'ai_result')
    op.drop_column('photo_analysis_cache', 'photo_id')
