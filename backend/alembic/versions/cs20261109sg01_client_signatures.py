"""client_signatures: a client's signature and initials kept on file

The office can sign a client's lines on a new contract with the signature on
file instead of having the customer sign again. It is kept by the customer
while signing on site, or drawn, typed or uploaded by staff on the client
page. One signature and one set of initials per client; keeping a new one
replaces the old. A table of its own so the client lists never load images.

Revision ID: cs20261109sg01
Revises: xp20261108pl01
Create Date: 2026-11-09
"""

from alembic import op
import sqlalchemy as sa

from app.core.database_types import UUIDType

revision = "cs20261109sg01"
down_revision = "xp20261108pl01"
branch_labels = None
depends_on = None

_TABLE = "client_signatures"


def upgrade() -> None:
    if sa.inspect(op.get_bind()).has_table(_TABLE):
        return
    op.create_table(
        _TABLE,
        sa.Column("id", UUIDType(), primary_key=True),
        sa.Column("client_id", UUIDType(), sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False, comment="signature | initial"),
        sa.Column("signer_name", sa.String(255), nullable=False, comment="Whose signature it is"),
        sa.Column("image", sa.Text(), nullable=False, comment="PNG or JPEG data URL"),
        sa.Column(
            "source", sa.String(20), nullable=False,
            comment="onsite (the customer kept it while signing) | drawn | typed | uploaded (by staff)",
        ),
        sa.Column("consent_text", sa.Text(), nullable=True),
        sa.Column(
            "contract_id", UUIDType(),
            sa.ForeignKey("contract_instances.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("saved_by_id", UUIDType(), sa.ForeignKey("staff.id", ondelete="SET NULL"), nullable=True),
        sa.Column("saved_by_name", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_client_signatures_id", _TABLE, ["id"])
    op.create_index("ux_client_signatures_client_kind", _TABLE, ["client_id", "kind"], unique=True)


def downgrade() -> None:
    if not sa.inspect(op.get_bind()).has_table(_TABLE):
        return
    op.drop_index("ux_client_signatures_client_kind", table_name=_TABLE)
    op.drop_index("ix_client_signatures_id", table_name=_TABLE)
    op.drop_table(_TABLE)
