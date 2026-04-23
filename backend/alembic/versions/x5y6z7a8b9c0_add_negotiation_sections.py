"""Add sections_data, extraction_status, extraction_metadata to claim_negotiations

Revision ID: x5y6z7a8b9c0
Revises: w5x6y7z8a9b0
Create Date: 2026-04-23

Adds PDF extraction and section-level financial tracking to claim negotiations:
  - sections_data JSONB: Array of summary section objects (Dwelling, Water Mitigation, etc.)
  - extraction_status VARCHAR(50): null | extracting | completed | failed
  - extraction_metadata JSONB: AI extraction metadata (model, pages, confidence)
"""

from alembic import op
from sqlalchemy import text

revision = 'x5y6z7a8b9c0'
down_revision = 'w5x6y7z8a9b0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(text("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'claim_negotiations' AND column_name = 'sections_data'
            ) THEN
                ALTER TABLE claim_negotiations
                    ADD COLUMN sections_data JSONB DEFAULT NULL;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'claim_negotiations' AND column_name = 'extraction_status'
            ) THEN
                ALTER TABLE claim_negotiations
                    ADD COLUMN extraction_status VARCHAR(50) DEFAULT NULL;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'claim_negotiations' AND column_name = 'extraction_metadata'
            ) THEN
                ALTER TABLE claim_negotiations
                    ADD COLUMN extraction_metadata JSONB DEFAULT NULL;
            END IF;
        END $$;
    """))


def downgrade() -> None:
    op.execute(text("""
        ALTER TABLE claim_negotiations
            DROP COLUMN IF EXISTS sections_data,
            DROP COLUMN IF EXISTS extraction_status,
            DROP COLUMN IF EXISTS extraction_metadata;
    """))
