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
    Add new columns to photo_analysis_cache table for AI photo classification.

    MODIFIED: Keep existing columns (cache_key, room_type, etc.) for Pack Estimate cache.
    Only add new columns for WM photo classification.
    """
    # Add new columns (nullable to support both use cases)
    op.add_column('photo_analysis_cache', sa.Column('photo_id', sa.UUID(), nullable=True))
    op.add_column('photo_analysis_cache', sa.Column('ai_result', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('photo_analysis_cache', sa.Column('user_corrected', sa.Boolean(), server_default='false', nullable=True))

    # Create new indexes for WM photo classification
    op.create_index('ix_photo_analysis_corrected', 'photo_analysis_cache', ['user_corrected'], unique=False, if_not_exists=True)
    op.create_index('ix_photo_analysis_photo', 'photo_analysis_cache', ['photo_id'], unique=False, if_not_exists=True)

    # NOTE: Keeping existing columns and indexes for Pack Estimate cache functionality:
    # - cache_key, room_type, photo_urls, analysis_result, confidence_score, user_id, expires_at
    # - ix_photo_analysis_cache_key, ix_photo_analysis_cache_user_id, ix_photo_analysis_cache_expires_at


def downgrade() -> None:
    """Remove WM photo classification columns"""
    # Drop new indexes (if they exist)
    op.drop_index('ix_photo_analysis_photo', table_name='photo_analysis_cache', if_exists=True)
    op.drop_index('ix_photo_analysis_corrected', table_name='photo_analysis_cache', if_exists=True)

    # Drop new columns
    op.drop_column('photo_analysis_cache', 'user_corrected')
    op.drop_column('photo_analysis_cache', 'ai_result')
    op.drop_column('photo_analysis_cache', 'photo_id')
