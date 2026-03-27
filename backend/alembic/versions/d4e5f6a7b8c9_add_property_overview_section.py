"""Add Property Overview section to report template

Revision ID: d4e5f6a7b8c9
Revises: h1a2b3c4d5e7, 4cfe38439ba8
Create Date: 2026-03-26

This migration adds the "Property Overview" section to the default
water mitigation photo report template, positioned as the first section
(between Cover Page and Wet Area).
"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = 'd4e5f6a7b8c9'
down_revision = ('h1a2b3c4d5e7', '4cfe38439ba8')
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

        # Increment display_order for all existing sections (shift everything down by 1)
        connection.execute(sa.text("""
            UPDATE wm_report_template_sections
            SET display_order = display_order + 1
            WHERE template_id = :template_id
        """), {'template_id': template_id})

        # Insert "Property Overview" section at position 1 (first section, after Cover Page)
        connection.execute(sa.text("""
            INSERT INTO wm_report_template_sections (
                id, template_id, title, summary, photo_layout, default_photos_per_page, display_order
            ) VALUES (
                gen_random_uuid(),
                :template_id,
                'Property Overview',
                'Overview photos of the property and affected areas.',
                'two',
                2,
                1
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

        # Remove the "Property Overview" section
        connection.execute(sa.text("""
            DELETE FROM wm_report_template_sections
            WHERE template_id = :template_id
            AND title = 'Property Overview'
        """), {'template_id': template_id})

        # Decrement display_order for sections with order > 1
        connection.execute(sa.text("""
            UPDATE wm_report_template_sections
            SET display_order = display_order - 1
            WHERE template_id = :template_id
            AND display_order > 1
        """), {'template_id': template_id})
