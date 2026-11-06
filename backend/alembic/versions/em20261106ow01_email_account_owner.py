"""email_accounts: add owner_staff_id

Whose mailbox an account is, so My Profile can show each person their own
email accounts whatever their role. Accounts added from My Profile get the
person who added them. Existing accounts go to the staff member whose login
email is the account's address (case aside); the rest, such as shared
inboxes, stay with no owner and show only on the Email Ingestion page.

Revision ID: em20261106ow01
Revises: ex20261106pt01
"""
from alembic import op
import sqlalchemy as sa

revision = "em20261106ow01"
down_revision = "ex20261106pt01"
branch_labels = None
depends_on = None

_TABLE = "email_accounts"
_COLUMN = "owner_staff_id"
_INDEX = "ix_email_accounts_owner_staff_id"


def _has_column(conn, table: str, col: str) -> bool:
    return col in {c["name"] for c in sa.inspect(conn).get_columns(table)}


def _backfill(conn) -> None:
    if not sa.inspect(conn).has_table("staff"):
        return
    accounts = sa.table(
        _TABLE, sa.column("id"), sa.column("email_address"), sa.column(_COLUMN),
    )
    staff = sa.table("staff", sa.column("id"), sa.column("email"))

    by_email = {}
    for staff_id, email in conn.execute(sa.select(staff.c.id, staff.c.email)).all():
        if email:
            by_email.setdefault(email.strip().lower(), []).append(staff_id)

    rows = conn.execute(
        sa.select(accounts.c.id, accounts.c.email_address).where(accounts.c[_COLUMN].is_(None))
    ).all()
    for account_id, address in rows:
        owners = by_email.get((address or "").strip().lower(), [])
        if len(owners) == 1:
            conn.execute(
                accounts.update().where(accounts.c.id == account_id).values({_COLUMN: owners[0]})
            )


def upgrade() -> None:
    conn = op.get_bind()
    if not sa.inspect(conn).has_table(_TABLE):
        return
    if not _has_column(conn, _TABLE, _COLUMN):
        op.add_column(
            _TABLE,
            sa.Column(
                _COLUMN, sa.UUID(), nullable=True,
                comment="Staff member whose mailbox this is; shown on their My Profile",
            ),
        )
        op.create_index(_INDEX, _TABLE, [_COLUMN])
    _backfill(conn)


def downgrade() -> None:
    conn = op.get_bind()
    if not sa.inspect(conn).has_table(_TABLE) or not _has_column(conn, _TABLE, _COLUMN):
        return
    op.drop_index(_INDEX, table_name=_TABLE)
    op.drop_column(_TABLE, _COLUMN)
