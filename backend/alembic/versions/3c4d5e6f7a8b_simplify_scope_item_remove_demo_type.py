"""Simplify scope item - remove demolition_type_id and moisture_level, add material_weight_id

Revision ID: 3c4d5e6f7a8b
Revises: 2b768537a75c
Create Date: 2026-01-13 22:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '3c4d5e6f7a8b'
down_revision = '2b768537a75c'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add material_weight_id column to wm_scope_items
    op.add_column(
        'wm_scope_items',
        sa.Column(
            'material_weight_id',
            sa.UUID(),
            nullable=True,
            comment='Link to MaterialWeight for debris calculation'
        )
    )

    # Add foreign key constraint for material_weight_id
    op.create_foreign_key(
        'fk_wm_scope_items_material_weight',
        'wm_scope_items',
        'material_weights',
        ['material_weight_id'],
        ['id'],
        ondelete='SET NULL'
    )

    # Drop the foreign key constraint for demolition_type_id first
    op.drop_constraint(
        'wm_scope_items_demolition_type_id_fkey',
        'wm_scope_items',
        type_='foreignkey'
    )

    # Drop demolition_type_id column
    op.drop_column('wm_scope_items', 'demolition_type_id')

    # Drop moisture_level column
    op.drop_column('wm_scope_items', 'moisture_level')


def downgrade() -> None:
    # Add moisture_level column back
    op.add_column(
        'wm_scope_items',
        sa.Column(
            'moisture_level',
            sa.String(20),
            nullable=True,
            server_default="'dry'"
        )
    )

    # Add demolition_type_id column back
    op.add_column(
        'wm_scope_items',
        sa.Column('demolition_type_id', sa.UUID(), nullable=True)
    )

    # Add foreign key constraint back for demolition_type_id
    op.create_foreign_key(
        'wm_scope_items_demolition_type_id_fkey',
        'wm_scope_items',
        'wm_demolition_types',
        ['demolition_type_id'],
        ['id'],
        ondelete='SET NULL'
    )

    # Drop the foreign key constraint for material_weight_id
    op.drop_constraint(
        'fk_wm_scope_items_material_weight',
        'wm_scope_items',
        type_='foreignkey'
    )

    # Drop material_weight_id column
    op.drop_column('wm_scope_items', 'material_weight_id')
