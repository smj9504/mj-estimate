"""Add crew upload tables and WMPhoto crew fields

Revision ID: n6o7p8q9r0s1
Revises: m5n6o7p8q9r0
Create Date: 2026-04-07

Creates:
  - upload_links: Shareable upload links for field crews
  - upload_sessions: Tracks upload progress per device/visit
Adds to wm_photos:
  - latitude, longitude, device_model, upload_link_id
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = 'n6o7p8q9r0s1'
down_revision = 'm5n6o7p8q9r0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create upload_links table
    op.create_table(
        'upload_links',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('token', sa.String(100), nullable=False, unique=True),
        sa.Column('context', sa.String(50), nullable=False, server_default='water-mitigation'),
        sa.Column('context_id', UUID(as_uuid=True), nullable=False),
        sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id'), nullable=False),
        sa.Column('label', sa.String(200), nullable=True),
        sa.Column('crew_name', sa.String(100), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('max_files', sa.Integer(), server_default='1000'),
        sa.Column('max_file_size_mb', sa.Integer(), server_default='500'),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('upload_count', sa.Integer(), server_default='0', nullable=False),
        sa.Column('total_size_bytes', sa.Integer(), server_default='0', nullable=False),
        sa.Column('last_accessed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by_id', UUID(as_uuid=True), sa.ForeignKey('staff.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_upload_links_token', 'upload_links', ['token'])
    op.create_index('ix_upload_links_context', 'upload_links', ['context', 'context_id'])
    op.create_index('ix_upload_links_active', 'upload_links', ['is_active'])

    # Create upload_sessions table
    op.create_table(
        'upload_sessions',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('link_id', UUID(as_uuid=True), sa.ForeignKey('upload_links.id', ondelete='CASCADE'), nullable=False),
        sa.Column('session_token', sa.String(100), nullable=False, unique=True),
        sa.Column('total_files', sa.Integer(), server_default='0'),
        sa.Column('completed_files', sa.Integer(), server_default='0'),
        sa.Column('failed_files', sa.Integer(), server_default='0'),
        sa.Column('completed_fingerprints', JSONB, server_default='[]'),
        sa.Column('status', sa.String(20), server_default='active'),
        sa.Column('device_info', sa.String(500), nullable=True),
        sa.Column('last_activity_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_upload_sessions_link', 'upload_sessions', ['link_id'])
    op.create_index('ix_upload_sessions_token', 'upload_sessions', ['session_token'])

    # Add crew upload fields to wm_photos
    op.add_column('wm_photos', sa.Column('latitude', sa.Float(), nullable=True))
    op.add_column('wm_photos', sa.Column('longitude', sa.Float(), nullable=True))
    op.add_column('wm_photos', sa.Column('device_model', sa.String(200), nullable=True))
    op.add_column('wm_photos', sa.Column('upload_link_id', UUID(as_uuid=True),
                                          sa.ForeignKey('upload_links.id'), nullable=True))


def downgrade() -> None:
    # Remove crew upload fields from wm_photos
    op.drop_column('wm_photos', 'upload_link_id')
    op.drop_column('wm_photos', 'device_model')
    op.drop_column('wm_photos', 'longitude')
    op.drop_column('wm_photos', 'latitude')

    # Drop tables
    op.drop_table('upload_sessions')
    op.drop_table('upload_links')
