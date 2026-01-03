"""Add photo_analysis_cache table

Revision ID: add_photo_analysis_cache
Revises:
Create Date: 2024-12-11 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'add_photo_analysis_cache'
down_revision: Union[str, None] = None  # Set this to the latest migration hash
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create photo_analysis_cache table"""
    op.create_table(
        'photo_analysis_cache',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('cache_key', sa.String(length=255), nullable=False),
        sa.Column('room_type', sa.String(length=50), nullable=False),
        sa.Column('photo_urls', sa.JSON(), nullable=False),
        sa.Column('analysis_result', sa.JSON(), nullable=False),
        sa.Column('confidence_score', sa.Float(), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )

    # Create indexes
    op.create_index('ix_photo_analysis_cache_key', 'photo_analysis_cache', ['cache_key'], unique=True)
    op.create_index('ix_photo_analysis_cache_user_id', 'photo_analysis_cache', ['user_id'], unique=False)
    op.create_index('ix_photo_analysis_cache_expires_at', 'photo_analysis_cache', ['expires_at'], unique=False)


def downgrade() -> None:
    """Drop photo_analysis_cache table"""
    op.drop_index('ix_photo_analysis_cache_expires_at', table_name='photo_analysis_cache')
    op.drop_index('ix_photo_analysis_cache_user_id', table_name='photo_analysis_cache')
    op.drop_index('ix_photo_analysis_cache_key', table_name='photo_analysis_cache')
    op.drop_table('photo_analysis_cache')
