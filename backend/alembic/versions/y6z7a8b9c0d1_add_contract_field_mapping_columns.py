"""Add field_mappings, filled_pdf_url, signature_type columns to contract tables

Revision ID: y6z7a8b9c0d1
Revises: x5y6z7a8b9c0
Create Date: 2026-04-23

Adds:
  - field_mappings TEXT to contract_templates
  - filled_pdf_url TEXT to contract_instances
  - signature_type VARCHAR(20) to contract_signatures
  - typed_name VARCHAR(255) to contract_signatures
"""

from alembic import op
from sqlalchemy import text


revision = "y6z7a8b9c0d1"
down_revision = "x5y6z7a8b9c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. field_mappings on contract_templates
    op.execute(text("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'contract_templates' AND column_name = 'field_mappings'
            ) THEN
                ALTER TABLE contract_templates ADD COLUMN field_mappings TEXT;
            END IF;
        END $$
    """))

    # 2. filled_pdf_url on contract_instances
    op.execute(text("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'contract_instances' AND column_name = 'filled_pdf_url'
            ) THEN
                ALTER TABLE contract_instances ADD COLUMN filled_pdf_url TEXT;
            END IF;
        END $$
    """))

    # 3. signature_type on contract_signatures
    op.execute(text("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'contract_signatures' AND column_name = 'signature_type'
            ) THEN
                ALTER TABLE contract_signatures
                    ADD COLUMN signature_type VARCHAR(20) DEFAULT 'drawn';
            END IF;
        END $$
    """))

    # 4. typed_name on contract_signatures
    op.execute(text("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'contract_signatures' AND column_name = 'typed_name'
            ) THEN
                ALTER TABLE contract_signatures ADD COLUMN typed_name VARCHAR(255);
            END IF;
        END $$
    """))


def downgrade() -> None:
    op.execute(text("ALTER TABLE contract_signatures DROP COLUMN IF EXISTS typed_name"))
    op.execute(text("ALTER TABLE contract_signatures DROP COLUMN IF EXISTS signature_type"))
    op.execute(text("ALTER TABLE contract_instances DROP COLUMN IF EXISTS filled_pdf_url"))
    op.execute(text("ALTER TABLE contract_templates DROP COLUMN IF EXISTS field_mappings"))
