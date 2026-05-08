"""Add unique index on wm jobs (google_sheet_row_number, google_sheet_name)

Revision ID: 9f105c157914
Revises: 67e9b12e4a99
Create Date: 2026-05-08

Cleans up duplicate WM jobs and prevents future duplicates.
"""

from alembic import op
from sqlalchemy import text


revision = '9f105c157914'
down_revision = '67e9b12e4a99'
branch_labels = None
depends_on = None


def upgrade():
    # Step 1: Deactivate duplicate jobs (keep most recently updated)
    conn = op.get_bind()
    result = conn.execute(text("""
        UPDATE water_mitigation_jobs
        SET active = false, google_sheet_row_number = NULL
        WHERE id IN (
            SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY google_sheet_row_number, google_sheet_name
                           ORDER BY updated_at DESC
                       ) as rn
                FROM water_mitigation_jobs
                WHERE google_sheet_row_number IS NOT NULL
                  AND google_sheet_name IS NOT NULL
            ) ranked
            WHERE rn > 1
        )
    """))
    if result.rowcount > 0:
        print(f"  Cleaned up {result.rowcount} duplicate job(s)")

    # Step 2: Create unique index
    op.create_index(
        'uq_wm_jobs_sheet_row',
        'water_mitigation_jobs',
        ['google_sheet_row_number', 'google_sheet_name'],
        unique=True,
        postgresql_where='google_sheet_row_number IS NOT NULL',
    )


def downgrade():
    op.drop_index('uq_wm_jobs_sheet_row', table_name='water_mitigation_jobs')
