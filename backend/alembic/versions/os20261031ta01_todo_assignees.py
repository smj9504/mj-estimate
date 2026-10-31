"""a todo can be assigned to several people, and the copies of one become one

Until now a todo had one owner, so something for several people (a contract to
put on a claim, the company's signature) was made as a copy per admin, and the
client page, which lists everyone's todos, showed the same todo several times.
Now a todo is one row with its assignees beside it. Its status and content are
shared; each assignee keeps their own place for it on their board.

- claim_todo_assignees(todo_id, staff_id, sort_order): every todo with an
  owner gets its owner as an assignee, at the place it had on their board.
- The copies made for a contract (same contract and task) become one todo:
  an open copy is kept (the oldest, if none is open), the other copies' owners
  are assigned to it, and the other copies are removed.

Revision ID: os20261031ta01
Revises: os20261031td01
Create Date: 2026-10-31
"""

from collections import defaultdict

from alembic import op
import sqlalchemy as sa

from app.core.database_types import UUIDType

revision = "os20261031ta01"
down_revision = "os20261031td01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "claim_todo_assignees",
        sa.Column("todo_id", UUIDType(), sa.ForeignKey("claim_todos.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("staff_id", UUIDType(), sa.ForeignKey("staff.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_claim_todo_assignees_staff_id", "claim_todo_assignees", ["staff_id"])
    op.execute(
        """
        INSERT INTO claim_todo_assignees (todo_id, staff_id, sort_order)
        SELECT id, owner_id, sort_order FROM claim_todos WHERE owner_id IS NOT NULL
        """
    )

    bind = op.get_bind()
    copies = defaultdict(list)
    for row in bind.execute(sa.text(
        """
        SELECT id, owner_id, contract_id, contract_task, status, created_at
        FROM claim_todos
        WHERE contract_id IS NOT NULL AND contract_task IS NOT NULL
        ORDER BY created_at, id
        """
    )):
        copies[(str(row.contract_id), row.contract_task)].append(row)

    for rows in copies.values():
        if len(rows) < 2:
            continue
        keep = next((r for r in rows if r.status != 'done'), rows[0])
        assigned = {str(keep.owner_id)} if keep.owner_id else set()
        for row in rows:
            if row.id == keep.id:
                continue
            if row.owner_id and str(row.owner_id) not in assigned:
                assigned.add(str(row.owner_id))
                bind.execute(
                    sa.text(
                        "UPDATE claim_todo_assignees SET todo_id = :keep "
                        "WHERE todo_id = :copy AND staff_id = :staff"
                    ),
                    {"keep": str(keep.id), "copy": str(row.id), "staff": str(row.owner_id)},
                )
            # Ids go back as text, which the database reads as a uuid whatever the driver
            bind.execute(sa.text("DELETE FROM claim_todo_assignees WHERE todo_id = :copy"), {"copy": str(row.id)})
            bind.execute(sa.text("DELETE FROM claim_todos WHERE id = :copy"), {"copy": str(row.id)})


def downgrade() -> None:
    op.drop_index("ix_claim_todo_assignees_staff_id", table_name="claim_todo_assignees")
    op.drop_table("claim_todo_assignees")
