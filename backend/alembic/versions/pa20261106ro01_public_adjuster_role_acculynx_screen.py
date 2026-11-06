"""public adjuster role and the AccuLynx History screen

AccuLynx History (archived AccuLynx jobs, documents and messages on client
pages) becomes a screen admins grant: acculynx_archive. So nobody loses it
today, the key is added to every saved role list and personal list that has
clients. A list without clients doesn't gain it. A role with no saved list
already sees every screen.

Adds public_adjuster to the staff roles. It starts with AccuLynx History,
Clients, Supplements and Rebuild Projects, unless a list is already saved for
it.

Revision ID: pa20261106ro01
Revises: ibx20261105ck01
"""
from alembic import op
import sqlalchemy as sa

revision = "pa20261106ro01"
down_revision = "ibx20261105ck01"
branch_labels = None
depends_on = None

_KEY = "acculynx_archive"
_PA_SCREENS = ["rebuild_projects", "clients", _KEY, "supplements"]

_roles = sa.table(
    "role_screen_access",
    sa.column("role", sa.String),
    sa.column("screens", sa.JSON),
    sa.column("updated_at", sa.DateTime),
)
_staff = sa.table(
    "staff",
    sa.column("id"),
    sa.column("screen_access", sa.JSON),
)


def _with_key(screens):
    if not isinstance(screens, list) or "clients" not in screens or _KEY in screens:
        return None
    return screens + [_KEY]


def _without_key(screens):
    if not isinstance(screens, list) or _KEY not in screens:
        return None
    return [s for s in screens if s != _KEY]


def _rewrite(conn, change) -> None:
    for role, screens in conn.execute(sa.select(_roles.c.role, _roles.c.screens)).all():
        new = change(screens)
        if new is not None:
            conn.execute(_roles.update().where(_roles.c.role == role).values(screens=new))
    rows = conn.execute(
        sa.select(_staff.c.id, _staff.c.screen_access).where(_staff.c.screen_access.isnot(None))
    ).all()
    for staff_id, screens in rows:
        new = change(screens)
        if new is not None:
            conn.execute(_staff.update().where(_staff.c.id == staff_id).values(screen_access=new))


def upgrade() -> None:
    conn = op.get_bind()

    if conn.dialect.name == "postgresql":
        has_enum = conn.execute(sa.text("SELECT 1 FROM pg_type WHERE typname = 'staffrole'")).first()
        if has_enum:
            # ADD VALUE can't share a transaction with anything that uses it
            with op.get_context().autocommit_block():
                op.execute("ALTER TYPE staffrole ADD VALUE IF NOT EXISTS 'public_adjuster'")

    inspector = sa.inspect(conn)
    if not inspector.has_table("role_screen_access") or not inspector.has_table("staff"):
        return

    _rewrite(conn, _with_key)

    saved = conn.execute(
        sa.select(_roles.c.role).where(_roles.c.role == "public_adjuster")
    ).first()
    if saved is None:
        conn.execute(_roles.insert().values(
            role="public_adjuster", screens=_PA_SCREENS, updated_at=sa.func.now(),
        ))


def downgrade() -> None:
    # Postgres can't drop an enum value; public_adjuster stays in staffrole
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if not inspector.has_table("role_screen_access") or not inspector.has_table("staff"):
        return
    conn.execute(_roles.delete().where(_roles.c.role == "public_adjuster"))
    _rewrite(conn, _without_key)
