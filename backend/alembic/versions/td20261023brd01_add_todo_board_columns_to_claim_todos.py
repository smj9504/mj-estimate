"""add todo board columns to claim_todos

The todo board replaces the dashboard. Each person has their own board: a
todo belongs to whoever added it (owner_id), can belong to a client without a
claim or to nothing at all, and sits in one of three columns (To do,
In progress, Done) in an order set by drag and drop. Claim todos are the same
records. Existing ones have no owner, so they stay on the client page only,
where they were before.

Revision ID: td20261023brd01
Revises: neg20261023rcv01
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'td20261023brd01'
down_revision = 'neg20261023rcv01'
branch_labels = None
depends_on = None

TABLE = 'claim_todos'

# column, referenced table, ON DELETE
LINKS = [
    ('client_id', 'clients', 'SET NULL'),
    ('owner_id', 'staff', 'SET NULL'),
]


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    # A fresh database gets the table from create_all at startup, already in this shape
    if not inspector.has_table(TABLE):
        return

    op.alter_column(TABLE, 'claim_id', existing_type=postgresql.UUID(as_uuid=True), nullable=True)

    # The app's startup column check may have added these already, without
    # the foreign key or index
    columns = {c['name'] for c in inspector.get_columns(TABLE)}
    foreign_keys = {fk['name'] for fk in inspector.get_foreign_keys(TABLE)}
    indexes = {ix['name'] for ix in inspector.get_indexes(TABLE)}
    for column, target, on_delete in LINKS:
        if column not in columns:
            op.add_column(TABLE, sa.Column(column, postgresql.UUID(as_uuid=True), nullable=True))
        if f'fk_{TABLE}_{column}_{target}' not in foreign_keys:
            op.create_foreign_key(
                f'fk_{TABLE}_{column}_{target}', TABLE, target, [column], ['id'], ondelete=on_delete
            )
        if f'ix_{TABLE}_{column}' not in indexes:
            op.create_index(f'ix_{TABLE}_{column}', TABLE, [column])

    if 'status' not in columns:
        op.add_column(TABLE, sa.Column('status', sa.String(20), nullable=False, server_default='todo'))
    if 'sort_order' not in columns:
        op.add_column(TABLE, sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'))

    # Existing claim todos: the claim's client, done when completed, and the
    # order the claim's todo list showed them in
    conn.execute(sa.text(
        "UPDATE claim_todos t SET client_id = c.client_id "
        "FROM claims c WHERE t.claim_id = c.id AND t.client_id IS NULL"
    ))
    conn.execute(sa.text(
        "UPDATE claim_todos SET status = 'done' WHERE is_completed = TRUE"
    ))
    conn.execute(sa.text(
        "UPDATE claim_todos t SET sort_order = r.rn FROM ("
        "  SELECT id, ROW_NUMBER() OVER ("
        "    PARTITION BY status"
        "    ORDER BY completed_at DESC NULLS LAST, due_date ASC NULLS LAST, created_at DESC"
        "  ) - 1 AS rn FROM claim_todos"
        ") r WHERE t.id = r.id"
    ))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(TABLE):
        return
    op.execute("DELETE FROM claim_todos WHERE claim_id IS NULL")
    foreign_keys = {fk['name'] for fk in inspector.get_foreign_keys(TABLE)}
    for column, target, _ in LINKS:
        if f'fk_{TABLE}_{column}_{target}' in foreign_keys:
            op.drop_constraint(f'fk_{TABLE}_{column}_{target}', TABLE, type_='foreignkey')
        op.execute(f"DROP INDEX IF EXISTS ix_{TABLE}_{column}")
        op.drop_column(TABLE, column)
    op.drop_column(TABLE, 'sort_order')
    op.drop_column(TABLE, 'status')
    op.alter_column(TABLE, 'claim_id', existing_type=postgresql.UUID(as_uuid=True), nullable=False)
