"""add_detected_materials_table

Revision ID: 5fa2df040a3d
Revises: 5ee6d678e8cd
Create Date: 2025-10-30 07:26:01.210169

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = '5fa2df040a3d'
down_revision = '5ee6d678e8cd'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop detected_materials table if it exists
    # (from previous migration)
    conn = op.get_bind()
    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
        "WHERE table_name = 'detected_materials')"
    ))
    table_exists = result.scalar()

    if table_exists:
        # Drop existing table and its dependencies
        conn.execute(sa.text(
            "DROP TABLE IF EXISTS detected_materials CASCADE"
        ))
        conn.commit()

    # Create detected_materials table
    op.create_table(
        'detected_materials',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False
        ),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'training_image_id',
            sa.String(length=36),
            nullable=False
        ),
        sa.Column(
            'material_order',
            sa.Integer(),
            nullable=True,
            server_default='1'
        ),
        sa.Column('coverage_percentage', sa.Integer(), nullable=True),
        sa.Column('location_in_image', sa.String(length=50), nullable=True),

        # Classification
        sa.Column('category', sa.String(length=100), nullable=True),
        sa.Column('subcategory', sa.String(length=100), nullable=True),
        sa.Column('material_type', sa.String(length=100), nullable=True),
        sa.Column('species', sa.String(length=100), nullable=True),

        # Specifications
        sa.Column('grade', sa.String(length=100), nullable=True),
        sa.Column('width', sa.String(length=50), nullable=True),
        sa.Column('thickness', sa.String(length=50), nullable=True),
        sa.Column('finish', sa.String(length=100), nullable=True),
        sa.Column('color', sa.String(length=100), nullable=True),

        # Critical pricing factors
        sa.Column('density', sa.String(length=100), nullable=True),
        sa.Column('pattern', sa.String(length=100), nullable=True),
        sa.Column('condition', sa.String(length=100), nullable=True),
        sa.Column('additional_specs', sa.Text(), nullable=True),

        # Confidence scores
        sa.Column('category_confidence', sa.Integer(), nullable=True),
        sa.Column('subcategory_confidence', sa.Integer(), nullable=True),
        sa.Column('grade_confidence', sa.Integer(), nullable=True),
        sa.Column('density_confidence', sa.Integer(), nullable=True),
        sa.Column('pattern_confidence', sa.Integer(), nullable=True),

        # Metadata
        sa.Column('pricing_notes', sa.Text(), nullable=True),
        sa.Column('gpt4_response', sa.JSON(), nullable=True),

        sa.ForeignKeyConstraint(
            ['training_image_id'],
            ['training_images.id'],
        ),
        sa.PrimaryKeyConstraint('id')
    )

    # Create indexes
    op.create_index(
        'idx_detected_materials_image_id',
        'detected_materials',
        ['training_image_id'],
        unique=False
    )
    op.create_index(
        'idx_detected_materials_category',
        'detected_materials',
        ['category'],
        unique=False
    )


def downgrade() -> None:
    # Drop indexes
    op.drop_index(
        'idx_detected_materials_category',
        table_name='detected_materials'
    )
    op.drop_index(
        'idx_detected_materials_image_id',
        table_name='detected_materials'
    )

    # Drop table
    op.drop_table('detected_materials')
