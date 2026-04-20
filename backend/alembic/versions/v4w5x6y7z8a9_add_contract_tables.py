"""Add Contract, ClaimCompany tables and plumber_report_id to claims

Revision ID: v4w5x6y7z8a9
Revises: u3v4w5x6y7z8
Create Date: 2026-04-20

Creates:
  - contract_templates table
  - contract_instances table
  - contract_signatures table
  - claim_companies table
  - Adds plumber_report_id to claims
"""

from alembic import op
from sqlalchemy import text


revision = "v4w5x6y7z8a9"
down_revision = "u3v4w5x6y7z8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # =========================================================
    # 1. contract_templates
    # =========================================================
    op.execute(text("""
        CREATE TABLE IF NOT EXISTS contract_templates (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            company_id UUID NOT NULL REFERENCES companies(id),
            name VARCHAR(500) NOT NULL,
            document_type VARCHAR(100) DEFAULT 'authorization',
            description TEXT,
            file_url TEXT NOT NULL,
            file_name VARCHAR(500),
            file_size INTEGER,
            storage_provider VARCHAR(50),
            requires_signature BOOLEAN DEFAULT TRUE,
            signature_roles TEXT,
            is_active BOOLEAN DEFAULT TRUE,
            version INTEGER DEFAULT 1,
            created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            updated_at TIMESTAMPTZ
        )
    """))
    op.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_contract_templates_company ON contract_templates (company_id)"
    ))

    # =========================================================
    # 2. contract_instances
    # =========================================================
    op.execute(text("""
        CREATE TABLE IF NOT EXISTS contract_instances (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            template_id UUID NOT NULL REFERENCES contract_templates(id),
            claim_id UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
            client_id UUID NOT NULL REFERENCES clients(id),
            company_id UUID NOT NULL REFERENCES companies(id),
            contract_number VARCHAR(100),
            title VARCHAR(500),
            notes TEXT,
            prefill_data TEXT,
            signing_token VARCHAR(100) UNIQUE,
            token_expires_at TIMESTAMPTZ,
            status VARCHAR(50) DEFAULT 'draft',
            sent_at TIMESTAMPTZ,
            viewed_at TIMESTAMPTZ,
            signed_at TIMESTAMPTZ,
            voided_at TIMESTAMPTZ,
            signed_pdf_url TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            updated_at TIMESTAMPTZ
        )
    """))
    op.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_contract_instances_claim ON contract_instances (claim_id)"
    ))
    op.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_contract_instances_client ON contract_instances (client_id)"
    ))
    op.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_contract_instances_token ON contract_instances (signing_token)"
    ))

    # =========================================================
    # 3. contract_signatures
    # =========================================================
    op.execute(text("""
        CREATE TABLE IF NOT EXISTS contract_signatures (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            contract_instance_id UUID NOT NULL REFERENCES contract_instances(id) ON DELETE CASCADE,
            signer_name VARCHAR(255) NOT NULL,
            signer_role VARCHAR(50) DEFAULT 'homeowner',
            signature_image TEXT NOT NULL,
            signed_at TIMESTAMPTZ DEFAULT NOW(),
            ip_address VARCHAR(100),
            user_agent TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            updated_at TIMESTAMPTZ
        )
    """))
    op.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_contract_signatures_instance ON contract_signatures (contract_instance_id)"
    ))

    # =========================================================
    # 4. claim_companies
    # =========================================================
    op.execute(text("""
        CREATE TABLE IF NOT EXISTS claim_companies (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            claim_id UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
            company_id UUID NOT NULL REFERENCES companies(id),
            role VARCHAR(50) NOT NULL,
            is_primary BOOLEAN DEFAULT FALSE,
            notes TEXT,
            assigned_at TIMESTAMPTZ DEFAULT NOW(),
            created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            updated_at TIMESTAMPTZ
        )
    """))
    op.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_claim_companies_claim ON claim_companies (claim_id)"
    ))
    op.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_claim_companies_unique ON claim_companies (claim_id, company_id, role)"
    ))

    # =========================================================
    # 5. Add plumber_report_id to claims
    # =========================================================
    op.execute(text("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'claims' AND column_name = 'plumber_report_id'
            ) THEN
                ALTER TABLE claims ADD COLUMN plumber_report_id UUID
                    REFERENCES plumber_reports(id) ON DELETE SET NULL;
            END IF;
        END $$
    """))


def downgrade() -> None:
    op.execute(text("ALTER TABLE claims DROP COLUMN IF EXISTS plumber_report_id"))
    op.execute(text("DROP TABLE IF EXISTS contract_signatures CASCADE"))
    op.execute(text("DROP TABLE IF EXISTS contract_instances CASCADE"))
    op.execute(text("DROP TABLE IF EXISTS contract_templates CASCADE"))
    op.execute(text("DROP TABLE IF EXISTS claim_companies CASCADE"))
