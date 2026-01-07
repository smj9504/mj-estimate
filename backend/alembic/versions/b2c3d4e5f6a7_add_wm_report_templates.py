"""Add water mitigation report templates

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2025-01-06

This migration adds tables for reusable report templates:
- wm_report_templates: Template definitions with name, type, and default flag
- wm_report_template_sections: Sections within templates with layout and content
- Adds template_id foreign key to wm_report_configs for template tracking

The template system allows:
- Creating reusable report structures
- Defining sections with prefilled descriptions
- Dynamic placeholder support for content like monitoring dates
- Template cloning/duplication
- One default template per type per company
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'b2c3d4e5f6a7'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # =========================================================================
    # Create wm_report_templates table
    # =========================================================================
    op.create_table(
        'wm_report_templates',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('template_type', sa.String(50), nullable=False, server_default='photo_report'),
        sa.Column('is_default', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default='true'),
        sa.Column(
            'company_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('companies.id', ondelete='CASCADE'),
            nullable=True,
            comment='Company that owns this template (NULL for system templates)'
        ),
        sa.Column('created_by_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('staff.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.func.now(), nullable=True),
    )

    # Indexes for wm_report_templates
    op.create_index('ix_wm_report_templates_type', 'wm_report_templates', ['template_type'])
    op.create_index('ix_wm_report_templates_company', 'wm_report_templates', ['company_id'])
    op.create_index('ix_wm_report_templates_default', 'wm_report_templates', ['template_type', 'is_default'])

    # =========================================================================
    # Create wm_report_template_sections table
    # =========================================================================
    op.create_table(
        'wm_report_template_sections',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column(
            'template_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('wm_report_templates.id', ondelete='CASCADE'),
            nullable=False
        ),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('summary', sa.Text, nullable=True),
        sa.Column('photo_layout', sa.String(20), nullable=False, server_default='four'),
        sa.Column('default_photos_per_page', sa.Integer, nullable=False, server_default='2'),
        sa.Column('display_order', sa.Integer, nullable=False, server_default='0'),
        sa.Column('placeholders', postgresql.JSONB, nullable=True, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.func.now(), nullable=True),
    )

    # Indexes for wm_report_template_sections
    op.create_index('ix_wm_template_sections_template', 'wm_report_template_sections', ['template_id'])
    op.create_index('ix_wm_template_sections_order', 'wm_report_template_sections', ['template_id', 'display_order'])

    # =========================================================================
    # Add template_id to wm_report_configs
    # =========================================================================
    op.add_column(
        'wm_report_configs',
        sa.Column(
            'template_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('wm_report_templates.id', ondelete='SET NULL'),
            nullable=True,
            comment='Template this config was created from (for tracking/updates)'
        )
    )

    # Index for template lookup in configs
    op.create_index('ix_wm_report_configs_template', 'wm_report_configs', ['template_id'])

    # =========================================================================
    # Insert default "Water Mitigation Photo Report" template
    # =========================================================================
    # Create connection for data manipulation
    connection = op.get_bind()

    # Insert default template
    connection.execute(sa.text("""
        INSERT INTO wm_report_templates (
            id, name, description, template_type, is_default, is_active, company_id
        ) VALUES (
            gen_random_uuid(),
            'Water Mitigation Photo Report',
            'Standard water mitigation photo report template with common sections for documenting water damage mitigation work.',
            'photo_report',
            true,
            true,
            NULL
        )
    """))

    # Get the default template ID
    result = connection.execute(sa.text("""
        SELECT id FROM wm_report_templates
        WHERE name = 'Water Mitigation Photo Report' AND is_default = true
        LIMIT 1
    """))
    template_row = result.fetchone()

    if template_row:
        template_id = template_row[0]

        # Insert default sections (8 sections with 2 photos per page layout)
        default_sections = [
            ('Wet Area', 'Areas affected by water damage.', 'two', 2, 1),
            ('Pre-Mitigation Moving', 'Photos of items and furniture before being moved for mitigation.', 'two', 2, 2),
            ('Demolition', 'Photos of demolition work performed during mitigation.', 'two', 2, 3),
            ('Containment', 'Photos of containment barriers and isolation measures.', 'two', 2, 4),
            ('Drying Process', 'Photos of drying equipment and dehumidification setup.', 'two', 2, 5),
            ('Monitoring - Day 1', 'Monitoring completed on {{start_date}}', 'two', 2, 6),
            ('Monitoring - Day 2', 'Monitoring completed on {{start_date_plus_one}}', 'two', 2, 7),
            ('Monitoring - Day 3', 'Monitoring completed on {{end_date}}', 'two', 2, 8),
        ]

        for title, summary, layout, photos_per_page, order in default_sections:
            connection.execute(sa.text("""
                INSERT INTO wm_report_template_sections (
                    id, template_id, title, summary, photo_layout, default_photos_per_page, display_order
                ) VALUES (
                    gen_random_uuid(),
                    :template_id,
                    :title,
                    :summary,
                    :layout,
                    :photos_per_page,
                    :display_order
                )
            """), {
                'template_id': template_id,
                'title': title,
                'summary': summary,
                'layout': layout,
                'photos_per_page': photos_per_page,
                'display_order': order
            })


def downgrade() -> None:
    # Remove index from wm_report_configs
    op.drop_index('ix_wm_report_configs_template', table_name='wm_report_configs')

    # Remove template_id column from wm_report_configs
    op.drop_column('wm_report_configs', 'template_id')

    # Drop indexes for wm_report_template_sections
    op.drop_index('ix_wm_template_sections_order', table_name='wm_report_template_sections')
    op.drop_index('ix_wm_template_sections_template', table_name='wm_report_template_sections')

    # Drop wm_report_template_sections table
    op.drop_table('wm_report_template_sections')

    # Drop indexes for wm_report_templates
    op.drop_index('ix_wm_report_templates_default', table_name='wm_report_templates')
    op.drop_index('ix_wm_report_templates_company', table_name='wm_report_templates')
    op.drop_index('ix_wm_report_templates_type', table_name='wm_report_templates')

    # Drop wm_report_templates table
    op.drop_table('wm_report_templates')
