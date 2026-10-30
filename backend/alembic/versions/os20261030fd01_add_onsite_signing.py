"""on-site signing: what a template is signed for, a person's home screen, and
the todo asking for a signed contract to be put on a claim

- contract_templates.signing_purpose: which card a template shows under on the
  On-site Signing screen. Existing templates are sorted by what they already
  say they are: authorizations and certificates naming water mitigation go
  under Water Mitigation, the other certificates under Work Completion. Anything
  else stays off the screen until someone picks a purpose for it.
- staff.home_screen: what "/" opens for this person; NULL keeps the todo board.
- claim_todos.contract_id and contract_task: the contract a todo is asking about
  and what it asks, so doing that can finish the todo on every admin's board.
- contract_signatures.signed_field_ids: the lines a signature filled, so the
  company can sign its own lines later. Signatures already on record stay NULL:
  they may have filled any line, so their contracts count as finished.

Revision ID: os20261030fd01
Revises: ck20261029qr01
Create Date: 2026-10-30
"""

from alembic import op
import sqlalchemy as sa

from app.core.database_types import UUIDType

revision = "os20261030fd01"
down_revision = "ck20261029qr01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("contract_templates", sa.Column("signing_purpose", sa.String(50), nullable=True))
    op.add_column("staff", sa.Column("home_screen", sa.String(50), nullable=True))
    op.add_column(
        "claim_todos",
        sa.Column(
            "contract_id",
            UUIDType(),
            sa.ForeignKey("contract_instances.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index("ix_claim_todos_contract_id", "claim_todos", ["contract_id"])
    op.add_column("claim_todos", sa.Column("contract_task", sa.String(30), nullable=True))
    op.add_column("contract_signatures", sa.Column("signed_field_ids", sa.Text(), nullable=True))

    op.execute(
        """
        UPDATE contract_templates SET signing_purpose = 'water_mitigation'
        WHERE lower(name) LIKE '%water%'
          AND document_type IN ('authorization', 'certificate_of_satisfaction', 'certificate_of_completion')
        """
    )
    op.execute(
        """
        UPDATE contract_templates SET signing_purpose = 'work_completion'
        WHERE signing_purpose IS NULL
          AND document_type IN ('certificate_of_satisfaction', 'certificate_of_completion')
        """
    )


def downgrade() -> None:
    op.drop_column("contract_signatures", "signed_field_ids")
    op.drop_column("claim_todos", "contract_task")
    op.drop_index("ix_claim_todos_contract_id", table_name="claim_todos")
    op.drop_column("claim_todos", "contract_id")
    op.drop_column("staff", "home_screen")
    op.drop_column("contract_templates", "signing_purpose")
