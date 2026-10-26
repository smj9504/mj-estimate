"""staff belong to companies; a client can have cash jobs; claims get their companies

- staff_companies: the companies each staff member belongs to (several are
  fine). Someone who isn't an admin sees only the claims and cash jobs one
  of their companies is assigned to. staff.company_id carries over.
- claims.claim_type: insurance | cash. A cash job is a claim with no
  insurance details. Every existing claim is insurance.
- claim_companies is filled in from what already ties a company to a claim
  (claims.company_id and rebuild_estimate_company_id, and the claim's WM
  jobs, work orders, invoices and estimates), so people keep seeing the
  claims their company works.

Revision ID: sc20261027co01
Revises: ck20261026grp01
Create Date: 2026-10-27
"""

from alembic import op
import sqlalchemy as sa

from app.core.database_types import UUIDType

revision = "sc20261027co01"
down_revision = "ck20261026grp01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "staff_companies",
        sa.Column("id", UUIDType(), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("staff_id", UUIDType(),
                  sa.ForeignKey("staff.id", ondelete="CASCADE"), nullable=False),
        sa.Column("company_id", UUIDType(),
                  sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("NOW()")),
        sa.UniqueConstraint("staff_id", "company_id",
                            name="uq_staff_companies_staff_company"),
    )
    op.create_index("ix_staff_companies_staff_id", "staff_companies", ["staff_id"])
    op.create_index("ix_staff_companies_company_id", "staff_companies", ["company_id"])

    op.execute("""
        INSERT INTO staff_companies (id, staff_id, company_id, created_at)
        SELECT gen_random_uuid(), s.id, s.company_id, NOW()
        FROM staff s
        JOIN companies c ON c.id = s.company_id
        ON CONFLICT DO NOTHING
    """)

    op.add_column(
        "claims",
        sa.Column("claim_type", sa.String(20), nullable=False,
                  server_default="insurance"),
    )
    op.create_index("ix_claims_claim_type", "claims", ["claim_type"])

    # One row per (claim, company); the role comes from the source where it
    # is known, otherwise from the company's type
    op.execute("""
        INSERT INTO claim_companies (id, claim_id, company_id, role, is_primary, assigned_at, created_at)
        SELECT DISTINCT ON (src.claim_id, src.company_id)
            gen_random_uuid(), src.claim_id, src.company_id,
            COALESCE(src.role, CASE co.company_type
                WHEN 'water_mitigation' THEN 'water_mitigation'
                WHEN 'contractor' THEN 'reconstruction'
                WHEN 'roofing' THEN 'reconstruction'
                WHEN 'moving' THEN 'moving'
                WHEN 'plumber' THEN 'plumber'
                ELSE 'other' END),
            FALSE, NOW(), NOW()
        FROM (
            SELECT id AS claim_id, company_id, NULL AS role, 1 AS priority
              FROM claims WHERE company_id IS NOT NULL
            UNION ALL
            SELECT claim_id, company_id, 'water_mitigation', 0
              FROM water_mitigation_jobs WHERE claim_id IS NOT NULL AND company_id IS NOT NULL
            UNION ALL
            SELECT id, rebuild_estimate_company_id, 'reconstruction', 0
              FROM claims WHERE rebuild_estimate_company_id IS NOT NULL
            UNION ALL
            SELECT claim_id, company_id, NULL, 2
              FROM work_orders WHERE claim_id IS NOT NULL AND company_id IS NOT NULL
            UNION ALL
            SELECT claim_id, company_id, NULL, 3
              FROM invoices WHERE claim_id IS NOT NULL AND company_id IS NOT NULL
            UNION ALL
            SELECT claim_id, company_id, NULL, 3
              FROM estimates WHERE claim_id IS NOT NULL AND company_id IS NOT NULL
        ) src
        JOIN companies co ON co.id = src.company_id
        JOIN claims cl ON cl.id = src.claim_id
        WHERE NOT EXISTS (
            SELECT 1 FROM claim_companies cc
            WHERE cc.claim_id = src.claim_id AND cc.company_id = src.company_id
        )
        ORDER BY src.claim_id, src.company_id, src.priority
    """)


def downgrade() -> None:
    # The claim_companies rows filled in above stay; they are ordinary assignments
    op.drop_index("ix_claims_claim_type", table_name="claims")
    op.drop_column("claims", "claim_type")
    op.drop_index("ix_staff_companies_company_id", table_name="staff_companies")
    op.drop_index("ix_staff_companies_staff_id", table_name="staff_companies")
    op.drop_table("staff_companies")
