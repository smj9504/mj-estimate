"""one todo per on-site signing: the contracts a todo is about

An on-site signing can make several contracts at once (water mitigation signs
the authorization and the sign-off together). It now gives one todo, to whoever
collected the signature, about all of them, instead of one per admin per
contract, which showed on the client page as copies of the same todo.

- claim_todos.contract_ids: every contract the todo is about, as a JSON list.
  NULL for todos about one contract (contract_id) or none.

Revision ID: os20261031td01
Revises: wm20261030rld01
Create Date: 2026-10-31
"""

from alembic import op
import sqlalchemy as sa

revision = "os20261031td01"
down_revision = "wm20261030rld01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("claim_todos", sa.Column("contract_ids", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("claim_todos", "contract_ids")
