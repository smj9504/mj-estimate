"""field_visits: add company_id

Whose visit it is. Only that company's people see and change a visit and its
photos; admins see every visit, and a visit with no company is theirs alone.

Visits already taken go to the company of the person who took it that works the
client (the client's own company first, then the companies on its claims), else
to that person's first company. One taken by an admin, or by someone with no
company, goes to a company working the client.

Revision ID: fv20261106co01
Revises: em20261106ow01
"""
from alembic import op
import sqlalchemy as sa

from app.core.database_types import UUIDType

revision = "fv20261106co01"
down_revision = "em20261106ow01"
branch_labels = None
depends_on = None

_TABLE = "field_visits"
_COLUMN = "company_id"
_INDEX = "ix_field_visits_company_id"
_ADMIN_ROLES = {"admin", "super_admin"}


def _has_column(conn, table: str, col: str) -> bool:
    return col in {c["name"] for c in sa.inspect(conn).get_columns(table)}


def _role_name(role) -> str:
    return str(getattr(role, "value", role) or "").lower()


def _backfill(conn) -> None:
    visits = sa.table(
        _TABLE, sa.column("id"), sa.column("client_id"), sa.column("created_by_id"), sa.column(_COLUMN),
    )
    clients = sa.table("clients", sa.column("id"), sa.column("company_id"))
    claims = sa.table("claims", sa.column("id"), sa.column("client_id"), sa.column("created_at"))
    claim_companies = sa.table("claim_companies", sa.column("claim_id"), sa.column("company_id"))
    staff = sa.table("staff", sa.column("id"), sa.column("role"), sa.column("all_companies"))
    staff_companies = sa.table("staff_companies", sa.column("staff_id"), sa.column("company_id"))

    rows = conn.execute(
        sa.select(visits.c.id, visits.c.client_id, visits.c.created_by_id).where(visits.c[_COLUMN].is_(None))
    ).all()
    for visit_id, client_id, creator_id in rows:
        working = []
        client_company = conn.execute(
            sa.select(clients.c.company_id).where(clients.c.id == client_id)
        ).scalar()
        if client_company:
            working.append(str(client_company))
        on_claims = conn.execute(
            sa.select(claim_companies.c.company_id)
            .select_from(claim_companies.join(claims, claims.c.id == claim_companies.c.claim_id))
            .where(claims.c.client_id == client_id)
            .order_by(claims.c.created_at.desc())
        ).all()
        for (company_id,) in on_claims:
            if str(company_id) not in working:
                working.append(str(company_id))

        admin = every_company = False
        theirs = []
        if creator_id:
            creator = conn.execute(
                sa.select(staff.c.role, staff.c.all_companies).where(staff.c.id == creator_id)
            ).first()
            if creator is not None:
                admin = _role_name(creator[0]) in _ADMIN_ROLES
                every_company = bool(creator[1])
                theirs = [str(r[0]) for r in conn.execute(
                    sa.select(staff_companies.c.company_id).where(staff_companies.c.staff_id == creator_id)
                ).all()]

        # The order the app picks one in for a new visit
        if admin:
            mine = working
        elif every_company:
            mine = working or theirs
        elif theirs:
            mine = [company for company in working if company in theirs] or theirs
        else:
            mine = working
        if mine:
            conn.execute(visits.update().where(visits.c.id == visit_id).values({_COLUMN: mine[0]}))


def upgrade() -> None:
    conn = op.get_bind()
    if not sa.inspect(conn).has_table(_TABLE):
        return
    if not _has_column(conn, _TABLE, _COLUMN):
        # SQLite can't add a constraint to a table that exists
        link = [] if conn.dialect.name == "sqlite" else [sa.ForeignKey("companies.id", ondelete="SET NULL")]
        op.add_column(
            _TABLE,
            sa.Column(
                _COLUMN, UUIDType(), *link, nullable=True,
                comment="Company whose people see this visit; admins see all",
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
