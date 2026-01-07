"""Add Personal Properties section to report template

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-01-07

This migration adds the "Personal Properties" section to the default
water mitigation photo report template, positioned after "Wet Area".
"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = 'c3d4e5f6a7b8'
down_revision = 'b2c3d4e5f6a7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    
    # Get the default template ID
    result = connection.execute(sa.text("""
        SELECT id FROM wm_report_templates
        WHERE name = 'Water Mitigation Photo Report' AND is_default = true
        LIMIT 1
    """))
    template_row = result.fetchone()
    
    if template_row:
        template_id = template_row[0]
        
        # First, increment display_order for all sections with order >= 2
        # This makes room for "Personal Properties" at position 2
        connection.execute(sa.text("""
            UPDATE wm_report_template_sections
            SET display_order = display_order + 1
            WHERE template_id = :template_id
            AND display_order >= 2
        """), {'template_id': template_id})
        
        # Insert "Personal Properties" section at position 2 (after "Wet Area")
        connection.execute(sa.text("""
            INSERT INTO wm_report_template_sections (
                id, template_id, title, summary, photo_layout, default_photos_per_page, display_order
            ) VALUES (
                gen_random_uuid(),
                :template_id,
                'Personal Properties',
                'Photos of personal property items affected by water damage.',
                'two',
                2,
                2
            )
        """), {'template_id': template_id})


def downgrade() -> None:
    connection = op.get_bind()
    
    # Get the default template ID
    result = connection.execute(sa.text("""
        SELECT id FROM wm_report_templates
        WHERE name = 'Water Mitigation Photo Report' AND is_default = true
        LIMIT 1
    """))
    template_row = result.fetchone()
    
    if template_row:
        template_id = template_row[0]
        
        # Remove the "Personal Properties" section
        connection.execute(sa.text("""
            DELETE FROM wm_report_template_sections
            WHERE template_id = :template_id
            AND title = 'Personal Properties'
        """), {'template_id': template_id})
        
        # Decrement display_order for sections with order > 2
        connection.execute(sa.text("""
            UPDATE wm_report_template_sections
            SET display_order = display_order - 1
            WHERE template_id = :template_id
            AND display_order > 2
        """), {'template_id': template_id})

