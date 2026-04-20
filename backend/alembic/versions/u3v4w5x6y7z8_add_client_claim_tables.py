"""Add Client, Claim, ClaimNegotiation tables and FK columns

Revision ID: u3v4w5x6y7z8
Revises: t2u3v4w5x6y7
Create Date: 2026-04-20

Creates:
  - clients table (customer/homeowner management)
  - claims table (insurance claims per client)
  - claim_negotiations table (negotiation history per claim)
  - Adds client_id/claim_id FK columns to invoices, estimates, work_orders, water_mitigation_jobs
"""

from alembic import op
from sqlalchemy import text


revision = "u3v4w5x6y7z8"
down_revision = "t2u3v4w5x6y7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # =========================================================
    # 1. Create clients table
    # =========================================================
    op.execute(text("""
        CREATE TABLE IF NOT EXISTS clients (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            owners JSONB DEFAULT '[]'::jsonb NOT NULL,
            display_name VARCHAR(500) NOT NULL,
            address TEXT,
            city VARCHAR(100),
            state VARCHAR(50),
            zipcode VARCHAR(20),
            phone VARCHAR(50),
            email VARCHAR(255),
            insurance_company VARCHAR(255),
            insurance_policy_number VARCHAR(100),
            company_id UUID REFERENCES companies(id),
            notes TEXT,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            updated_at TIMESTAMPTZ
        )
    """))

    op.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_clients_display_name
        ON clients (display_name)
    """))
    op.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_clients_company_id
        ON clients (company_id)
    """))

    # =========================================================
    # 2. Create claims table
    # =========================================================
    op.execute(text("""
        CREATE TABLE IF NOT EXISTS claims (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
            company_id UUID REFERENCES companies(id),
            claim_number VARCHAR(100) NOT NULL,
            insurance_company VARCHAR(255),
            insurance_policy_number VARCHAR(100),
            insurance_deductible DECIMAL(15, 2),
            adjuster_name VARCHAR(255),
            adjuster_phone VARCHAR(50),
            adjuster_email VARCHAR(255),
            date_of_loss TIMESTAMPTZ,
            loss_description TEXT,
            current_acv DECIMAL(15, 2) DEFAULT 0,
            current_rcv DECIMAL(15, 2) DEFAULT 0,
            current_depreciation DECIMAL(15, 2) DEFAULT 0,
            our_estimate_amount DECIMAL(15, 2) DEFAULT 0,
            final_invoice_amount DECIMAL(15, 2) DEFAULT 0,
            status VARCHAR(50) DEFAULT 'open',
            notes TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            updated_at TIMESTAMPTZ
        )
    """))

    op.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_claims_claim_number
        ON claims (claim_number)
    """))
    op.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_claims_client_id
        ON claims (client_id)
    """))
    op.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_claims_status
        ON claims (status)
    """))

    # =========================================================
    # 3. Create claim_negotiations table
    # =========================================================
    op.execute(text("""
        CREATE TABLE IF NOT EXISTS claim_negotiations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            claim_id UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
            revision_number INTEGER NOT NULL DEFAULT 1,
            revision_type VARCHAR(50) NOT NULL DEFAULT 'initial',
            acv_amount DECIMAL(15, 2) DEFAULT 0,
            rcv_amount DECIMAL(15, 2) DEFAULT 0,
            depreciation_amount DECIMAL(15, 2) DEFAULT 0,
            deductible DECIMAL(15, 2) DEFAULT 0,
            date_received TIMESTAMPTZ,
            received_from VARCHAR(255),
            notes TEXT,
            document_url TEXT,
            document_name VARCHAR(500),
            created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            updated_at TIMESTAMPTZ
        )
    """))

    op.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_claim_negotiations_claim_id
        ON claim_negotiations (claim_id)
    """))
    op.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_claim_negotiations_revision
        ON claim_negotiations (claim_id, revision_number)
    """))

    # =========================================================
    # 4. Add client_id / claim_id FK columns to existing tables
    # =========================================================

    # --- invoices ---
    op.execute(text("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'invoices' AND column_name = 'client_id'
            ) THEN
                ALTER TABLE invoices ADD COLUMN client_id UUID
                    REFERENCES clients(id) ON DELETE SET NULL;
            END IF;
        END $$
    """))
    op.execute(text("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'invoices' AND column_name = 'claim_id'
            ) THEN
                ALTER TABLE invoices ADD COLUMN claim_id UUID
                    REFERENCES claims(id) ON DELETE SET NULL;
            END IF;
        END $$
    """))

    # --- estimates ---
    op.execute(text("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'estimates' AND column_name = 'client_id'
            ) THEN
                ALTER TABLE estimates ADD COLUMN client_id UUID
                    REFERENCES clients(id) ON DELETE SET NULL;
            END IF;
        END $$
    """))
    op.execute(text("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'estimates' AND column_name = 'claim_id'
            ) THEN
                ALTER TABLE estimates ADD COLUMN claim_id UUID
                    REFERENCES claims(id) ON DELETE SET NULL;
            END IF;
        END $$
    """))

    # --- work_orders ---
    op.execute(text("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'work_orders' AND column_name = 'client_id'
            ) THEN
                ALTER TABLE work_orders ADD COLUMN client_id UUID
                    REFERENCES clients(id) ON DELETE SET NULL;
            END IF;
        END $$
    """))
    op.execute(text("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'work_orders' AND column_name = 'claim_id'
            ) THEN
                ALTER TABLE work_orders ADD COLUMN claim_id UUID
                    REFERENCES claims(id) ON DELETE SET NULL;
            END IF;
        END $$
    """))

    # --- water_mitigation_jobs ---
    op.execute(text("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'water_mitigation_jobs' AND column_name = 'claim_id'
            ) THEN
                ALTER TABLE water_mitigation_jobs ADD COLUMN claim_id UUID
                    REFERENCES claims(id) ON DELETE SET NULL;
            END IF;
        END $$
    """))

    # =========================================================
    # 5. Add indexes on FK columns for query performance
    # =========================================================
    op.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_invoices_client_id ON invoices (client_id)"
    ))
    op.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_invoices_claim_id ON invoices (claim_id)"
    ))
    op.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_estimates_client_id ON estimates (client_id)"
    ))
    op.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_estimates_claim_id ON estimates (claim_id)"
    ))
    op.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_work_orders_client_id ON work_orders (client_id)"
    ))
    op.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_work_orders_claim_id ON work_orders (claim_id)"
    ))
    op.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_wm_jobs_claim_id ON water_mitigation_jobs (claim_id)"
    ))


def downgrade() -> None:
    # Drop FK columns from existing tables
    op.execute(text(
        "ALTER TABLE water_mitigation_jobs DROP COLUMN IF EXISTS claim_id"
    ))
    op.execute(text(
        "ALTER TABLE work_orders DROP COLUMN IF EXISTS claim_id"
    ))
    op.execute(text(
        "ALTER TABLE work_orders DROP COLUMN IF EXISTS client_id"
    ))
    op.execute(text(
        "ALTER TABLE estimates DROP COLUMN IF EXISTS claim_id"
    ))
    op.execute(text(
        "ALTER TABLE estimates DROP COLUMN IF EXISTS client_id"
    ))
    op.execute(text(
        "ALTER TABLE invoices DROP COLUMN IF EXISTS claim_id"
    ))
    op.execute(text(
        "ALTER TABLE invoices DROP COLUMN IF EXISTS client_id"
    ))

    # Drop tables in reverse dependency order
    op.execute(text("DROP TABLE IF EXISTS claim_negotiations CASCADE"))
    op.execute(text("DROP TABLE IF EXISTS claims CASCADE"))
    op.execute(text("DROP TABLE IF EXISTS clients CASCADE"))
