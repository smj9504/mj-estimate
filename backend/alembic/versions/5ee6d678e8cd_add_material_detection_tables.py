"""add material detection tables

Revision ID: 5ee6d678e8cd
Revises:
Create Date: 2025-10-29 01:21:52.833831

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from app.core.database_types import UUIDType


# revision identifiers, used by Alembic.
revision = '5ee6d678e8cd'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create JobStatus enum if it doesn't exist
    jobstatus_enum = postgresql.ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', name='jobstatus', create_type=False)
    jobstatus_enum.create(op.get_bind(), checkfirst=True)

    # Create material_detection_jobs table
    op.create_table(
        'material_detection_jobs',
        sa.Column('job_name', sa.String(length=255), nullable=True),
        sa.Column('status', sa.Enum('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', name='jobstatus', create_type=False), nullable=False),
        sa.Column('reconstruction_estimate_id', UUIDType(length=36), nullable=True),
        sa.Column('provider', sa.String(length=50), nullable=True),
        sa.Column('confidence_threshold', sa.DECIMAL(precision=3, scale=2), nullable=True),
        sa.Column('total_images', sa.Integer(), nullable=False),
        sa.Column('processed_images', sa.Integer(), nullable=False),
        sa.Column('total_materials_detected', sa.Integer(), nullable=False),
        sa.Column('avg_confidence', sa.DECIMAL(precision=5, scale=4), nullable=True),
        sa.Column('processing_time_ms', sa.Integer(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_by_id', UUIDType(length=36), nullable=False),
        sa.Column('updated_by_id', UUIDType(length=36), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('id', UUIDType(length=36), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['created_by_id'], ['staff.id'], ),
        sa.ForeignKeyConstraint(['updated_by_id'], ['staff.id'], ),
        sa.PrimaryKeyConstraint('id')
    )

    # Create indexes for material_detection_jobs
    op.create_index('ix_material_detection_jobs_created', 'material_detection_jobs', ['created_at'], unique=False)
    op.create_index('ix_material_detection_jobs_estimate', 'material_detection_jobs', ['reconstruction_estimate_id'], unique=False)
    op.create_index(op.f('ix_material_detection_jobs_id'), 'material_detection_jobs', ['id'], unique=False)
    op.create_index('ix_material_detection_jobs_status', 'material_detection_jobs', ['status'], unique=False)
    op.create_index('ix_material_detection_jobs_user', 'material_detection_jobs', ['created_by_id'], unique=False)

    # Create detected_materials table
    op.create_table(
        'detected_materials',
        sa.Column('job_id', UUIDType(length=36), nullable=False),
        sa.Column('image_id', sa.String(), nullable=False),
        sa.Column('image_url', sa.String(length=1000), nullable=True),
        sa.Column('material_category', sa.String(length=100), nullable=False),
        sa.Column('material_type', sa.String(length=100), nullable=True),
        sa.Column('material_grade', sa.String(length=100), nullable=True),
        sa.Column('material_finish', sa.String(length=100), nullable=True),
        sa.Column('material_description', sa.Text(), nullable=True),
        sa.Column('confidence_score', sa.DECIMAL(precision=5, scale=4), nullable=False),
        sa.Column('provider_used', sa.String(length=50), nullable=False),
        sa.Column('bounding_box', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('quantity_estimate', sa.DECIMAL(precision=10, scale=2), nullable=True),
        sa.Column('unit_type', sa.String(length=10), nullable=True),
        sa.Column('unit_price', sa.DECIMAL(precision=10, scale=2), nullable=True),
        sa.Column('total_estimate', sa.DECIMAL(precision=12, scale=2), nullable=True),
        sa.Column('detection_time_ms', sa.Integer(), nullable=True),
        sa.Column('raw_response', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('needs_review', sa.Integer(), nullable=False),
        sa.Column('reviewed_by_id', UUIDType(length=36), nullable=True),
        sa.Column('review_notes', sa.Text(), nullable=True),
        sa.Column('id', UUIDType(length=36), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['image_id'], ['files.id'], ),
        sa.ForeignKeyConstraint(['job_id'], ['material_detection_jobs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['reviewed_by_id'], ['staff.id'], ),
        sa.PrimaryKeyConstraint('id')
    )

    # Create indexes for detected_materials
    op.create_index('ix_detected_materials_category', 'detected_materials', ['material_category'], unique=False)
    op.create_index('ix_detected_materials_confidence', 'detected_materials', ['confidence_score'], unique=False)
    op.create_index(op.f('ix_detected_materials_id'), 'detected_materials', ['id'], unique=False)
    op.create_index('ix_detected_materials_image', 'detected_materials', ['image_id'], unique=False)
    op.create_index('ix_detected_materials_job', 'detected_materials', ['job_id'], unique=False)


def downgrade() -> None:
    # Drop detected_materials table and indexes
    op.drop_index('ix_detected_materials_job', table_name='detected_materials')
    op.drop_index('ix_detected_materials_image', table_name='detected_materials')
    op.drop_index(op.f('ix_detected_materials_id'), table_name='detected_materials')
    op.drop_index('ix_detected_materials_confidence', table_name='detected_materials')
    op.drop_index('ix_detected_materials_category', table_name='detected_materials')
    op.drop_table('detected_materials')

    # Drop material_detection_jobs table and indexes
    op.drop_index('ix_material_detection_jobs_user', table_name='material_detection_jobs')
    op.drop_index('ix_material_detection_jobs_status', table_name='material_detection_jobs')
    op.drop_index(op.f('ix_material_detection_jobs_id'), table_name='material_detection_jobs')
    op.drop_index('ix_material_detection_jobs_estimate', table_name='material_detection_jobs')
    op.drop_index('ix_material_detection_jobs_created', table_name='material_detection_jobs')
    op.drop_table('material_detection_jobs')

    # Drop JobStatus enum
    op.execute("DROP TYPE IF EXISTS jobstatus")
