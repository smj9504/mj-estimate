"""add material detection tables

Revision ID: 5ee6d678e8cd
Revises:
Create Date: 2025-10-29 01:21:52.833831

"""
import sqlalchemy as sa
from alembic import op
from app.core.database_types import UUIDType

# revision identifiers, used by Alembic.
revision = '5ee6d678e8cd'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create JobStatus enum only if it doesn't exist
    conn = op.get_bind()
    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'jobstatus')"
    ))
    enum_exists = result.scalar()

    if not enum_exists:
        # Create the ENUM type using raw SQL
        # to avoid SQLAlchemy auto-creation
        conn.execute(sa.text(
            "CREATE TYPE jobstatus AS ENUM "
            "('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')"
        ))
        conn.commit()

    # Create material_detection_jobs table
    # Use PostgreSQL's native type reference
    # to avoid re-creating the ENUM
    op.create_table(
        'material_detection_jobs',
        sa.Column('job_name', sa.String(length=255), nullable=True),
        sa.Column('status', sa.Text(), nullable=False),
        sa.Column(
            'reconstruction_estimate_id',
            UUIDType(length=36),
            nullable=True
        ),
        sa.Column('provider', sa.String(length=50), nullable=True),
        sa.Column(
            'confidence_threshold',
            sa.DECIMAL(precision=3, scale=2),
            nullable=True
        ),
        sa.Column('total_images', sa.Integer(), nullable=False),
        sa.Column('processed_images', sa.Integer(), nullable=False),
        sa.Column('total_materials_detected', sa.Integer(), nullable=False),
        sa.Column(
            'avg_confidence',
            sa.DECIMAL(precision=5, scale=4),
            nullable=True
        ),
        sa.Column('processing_time_ms', sa.Integer(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_by_id', UUIDType(length=36), nullable=False),
        sa.Column('updated_by_id', UUIDType(length=36), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('id', UUIDType(length=36), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False
        ),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['created_by_id'], ['staff.id'], ),
        sa.ForeignKeyConstraint(['updated_by_id'], ['staff.id'], ),
        sa.PrimaryKeyConstraint('id')
    )

    # Alter the status column to use the jobstatus enum
    conn.execute(sa.text(
        "ALTER TABLE material_detection_jobs "
        "ALTER COLUMN status TYPE jobstatus "
        "USING status::jobstatus"
    ))
    conn.commit()

    # Create indexes for material_detection_jobs
    op.create_index(
        'ix_material_detection_jobs_created',
        'material_detection_jobs',
        ['created_at'],
        unique=False
    )
    op.create_index(
        'ix_material_detection_jobs_estimate',
        'material_detection_jobs',
        ['reconstruction_estimate_id'],
        unique=False
    )
    op.create_index(
        op.f('ix_material_detection_jobs_id'),
        'material_detection_jobs',
        ['id'],
        unique=False
    )
    op.create_index(
        'ix_material_detection_jobs_status',
        'material_detection_jobs',
        ['status'],
        unique=False
    )
    op.create_index(
        'ix_material_detection_jobs_user',
        'material_detection_jobs',
        ['created_by_id'],
        unique=False
    )

    # Note: detected_materials table is created
    # in the next migration (5fa2df040a3d)


def downgrade() -> None:
    # Note: detected_materials table is handled
    # in the next migration (5fa2df040a3d)

    # Drop material_detection_jobs table and indexes
    op.drop_index(
        'ix_material_detection_jobs_user',
        table_name='material_detection_jobs'
    )
    op.drop_index(
        'ix_material_detection_jobs_status',
        table_name='material_detection_jobs'
    )
    op.drop_index(
        op.f('ix_material_detection_jobs_id'),
        table_name='material_detection_jobs'
    )
    op.drop_index(
        'ix_material_detection_jobs_estimate',
        table_name='material_detection_jobs'
    )
    op.drop_index(
        'ix_material_detection_jobs_created',
        table_name='material_detection_jobs'
    )
    op.drop_table('material_detection_jobs')

    # Drop JobStatus enum
    op.execute("DROP TYPE IF EXISTS jobstatus")
