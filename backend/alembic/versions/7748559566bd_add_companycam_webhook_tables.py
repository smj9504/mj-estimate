"""add_companycam_webhook_tables

Revision ID: 7748559566bd
Revises: 5fa2df040a3d
Create Date: 2025-11-04 02:13:48.578288

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '7748559566bd'
down_revision = '5fa2df040a3d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create webhook_events table
    op.create_table(
        'webhook_events',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('service_name', sa.String(50), nullable=False),
        sa.Column('event_type', sa.String(100), nullable=False),
        sa.Column('event_id', sa.String(200)),
        sa.Column('payload', postgresql.JSON, nullable=False),
        sa.Column('headers', postgresql.JSON),
        sa.Column('status', sa.String(20), default='pending'),
        sa.Column('error_message', sa.Text()),
        sa.Column('processed_at', sa.DateTime()),
        sa.Column('related_entity_type', sa.String(50)),
        sa.Column('related_entity_id', postgresql.UUID(as_uuid=True)),
        sa.Column('ip_address', sa.String(50)),
        sa.Column('user_agent', sa.String(500)),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime())
    )

    # Create indexes for webhook_events
    op.create_index('ix_webhook_events_id', 'webhook_events', ['id'])
    op.create_index('ix_webhook_service_type', 'webhook_events', ['service_name', 'event_type'])
    op.create_index('ix_webhook_event_id', 'webhook_events', ['event_id'])
    op.create_index('ix_webhook_created', 'webhook_events', ['created_at'])

    # Create companycam_photos table
    op.create_table(
        'companycam_photos',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('companycam_photo_id', sa.String(100), nullable=False, unique=True),
        sa.Column('companycam_project_id', sa.String(100), nullable=False),
        sa.Column('companycam_project_name', sa.String(500)),
        sa.Column('water_mitigation_job_id', postgresql.UUID(as_uuid=True)),
        sa.Column('photo_url', sa.String(1000), nullable=False),
        sa.Column('thumbnail_url', sa.String(1000)),
        sa.Column('original_filename', sa.String(500)),
        sa.Column('description', sa.Text()),
        sa.Column('tags', postgresql.JSON),
        sa.Column('coordinates', postgresql.JSON),
        sa.Column('width', sa.String(20)),
        sa.Column('height', sa.String(20)),
        sa.Column('file_size', sa.String(20)),
        sa.Column('content_type', sa.String(100)),
        sa.Column('project_address', sa.String(500)),
        sa.Column('project_city', sa.String(100)),
        sa.Column('project_state', sa.String(50)),
        sa.Column('project_zipcode', sa.String(20)),
        sa.Column('is_synced', sa.Boolean(), default=False),
        sa.Column('sync_error', sa.Text()),
        sa.Column('uploaded_by_name', sa.String(200)),
        sa.Column('uploaded_by_email', sa.String(200)),
        sa.Column('companycam_created_at', sa.DateTime()),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime()),
        sa.Column('synced_at', sa.DateTime())
    )

    # Create indexes for companycam_photos
    op.create_index('ix_companycam_photos_id', 'companycam_photos', ['id'])
    op.create_index('ix_companycam_photo_job', 'companycam_photos', ['water_mitigation_job_id'])
    op.create_index('ix_companycam_photo_external', 'companycam_photos', ['companycam_photo_id'])
    op.create_index('ix_companycam_project_id', 'companycam_photos', ['companycam_project_id'])


def downgrade() -> None:
    # Drop companycam_photos table and indexes
    op.drop_index('ix_companycam_project_id', 'companycam_photos')
    op.drop_index('ix_companycam_photo_external', 'companycam_photos')
    op.drop_index('ix_companycam_photo_job', 'companycam_photos')
    op.drop_index('ix_companycam_photos_id', 'companycam_photos')
    op.drop_table('companycam_photos')

    # Drop webhook_events table and indexes
    op.drop_index('ix_webhook_created', 'webhook_events')
    op.drop_index('ix_webhook_event_id', 'webhook_events')
    op.drop_index('ix_webhook_service_type', 'webhook_events')
    op.drop_index('ix_webhook_events_id', 'webhook_events')
    op.drop_table('webhook_events')
