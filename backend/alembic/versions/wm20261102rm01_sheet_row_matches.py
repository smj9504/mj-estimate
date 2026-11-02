"""wm_sheet_row_matches: ask before a sheet row joins something entered by hand

The Google Sheet sync linked a row to any manual job at the same address and
merged homeowners into any client with the same name, phone or email. Now a row
at the address of a manual job or client waits in this table until someone says
whether they are the same, and sheet clients only match sheet clients.

Clients the sync made earlier are told from the ones entered here by the sync
itself, the first time it runs (client_sync_service.mark_sheet_clients), not here:
a local server on the same database can run it before this migration has.

Revision ID: wm20261102rm01
Revises: vr20261101ta01
Create Date: 2026-11-02
"""

from alembic import op
import sqlalchemy as sa

from app.core.database_types import UUIDType

revision = "wm20261102rm01"
down_revision = "vr20261101ta01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Startup's create_all may already have made the table
    if "wm_sheet_row_matches" not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(
            "wm_sheet_row_matches",
            sa.Column("id", UUIDType(), primary_key=True),
            sa.Column("sheet_name", sa.String(100), nullable=False),
            sa.Column("row_number", sa.Integer(), nullable=False),
            sa.Column("address", sa.String(500), nullable=False),
            sa.Column("row_data", sa.JSON(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
            sa.Column("matched_type", sa.String(20)),
            sa.Column("job_id", UUIDType(), sa.ForeignKey("water_mitigation_jobs.id", ondelete="SET NULL")),
            sa.Column("client_id", UUIDType(), sa.ForeignKey("clients.id", ondelete="SET NULL")),
            sa.Column("decided_by_id", UUIDType(), sa.ForeignKey("staff.id", ondelete="SET NULL")),
            sa.Column("decided_at", sa.DateTime(timezone=True)),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True)),
        )
        op.create_index("ix_wm_sheet_row_matches_job", "wm_sheet_row_matches", ["job_id"])
        op.create_index(
            "uq_wm_sheet_row_matches_pending",
            "wm_sheet_row_matches",
            ["sheet_name", "row_number"],
            unique=True,
            postgresql_where=sa.text("status = 'pending'"),
        )


def downgrade() -> None:
    op.execute("UPDATE clients SET source = NULL WHERE source = 'google_sheets'")
    op.drop_table("wm_sheet_row_matches")
