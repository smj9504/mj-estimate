"""
Script to create the default Water Mitigation Photo Report template
"""
from app.core.database_factory import get_database
from sqlalchemy import text


def main():
    db = get_database()
    with db.engine.begin() as conn:
        # Delete existing template sections
        conn.execute(text('DELETE FROM wm_report_template_sections'))
        # Delete existing templates
        conn.execute(text('DELETE FROM wm_report_templates'))
        print('Deleted existing templates')

        # Insert new default template
        conn.execute(text("""
            INSERT INTO wm_report_templates (
                id, name, description, template_type, is_default, is_active, company_id
            ) VALUES (
                gen_random_uuid(),
                'Water Mitigation Photo Report',
                'Standard water mitigation photo report template with 8 sections for documenting water damage mitigation work.',
                'photo_report',
                true,
                true,
                NULL
            )
        """))

        # Get template ID
        result = conn.execute(text("""
            SELECT id FROM wm_report_templates
            WHERE name = 'Water Mitigation Photo Report' AND is_default = true
            LIMIT 1
        """))
        template_id = result.fetchone()[0]
        print(f'Created template: {template_id}')

        # Insert 8 sections
        sections = [
            ('Wet Area', 'Areas affected by water damage.', 'two', 2, 1),
            ('Pre-Mitigation Moving', 'Photos of items and furniture before being moved for mitigation.', 'two', 2, 2),
            ('Demolition', 'Photos of demolition work performed during mitigation.', 'two', 2, 3),
            ('Containment', 'Photos of containment barriers and isolation measures.', 'two', 2, 4),
            ('Drying Process', 'Photos of drying equipment and dehumidification setup.', 'two', 2, 5),
            ('Monitoring - Day 1', 'Monitoring completed on {{start_date}}', 'two', 2, 6),
            ('Monitoring - Day 2', 'Monitoring completed on {{start_date_plus_one}}', 'two', 2, 7),
            ('Monitoring - Day 3', 'Monitoring completed on {{end_date}}', 'two', 2, 8),
        ]

        for title, summary, layout, photos_per_page, order in sections:
            conn.execute(text("""
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
                'template_id': str(template_id),
                'title': title,
                'summary': summary,
                'layout': layout,
                'photos_per_page': photos_per_page,
                'display_order': order
            })
            print(f'  Created section {order}: {title}')

        print('\nSuccessfully created default template with 8 sections!')

if __name__ == '__main__':
    main()
