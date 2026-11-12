"""the Flooring estimates screen

Flooring estimates get a screen of their own: flooring_estimates. So the
people who already build trade estimates can open it without an admin
granting it first, the key is added to every saved role list and personal
list that has bathroom_estimates. A list without it doesn't gain it, and a
role with no saved list already sees every screen.

Revision ID: flr20261112sc02
Revises: flr20261112tb01
Create Date: 2026-11-12
"""

from alembic import op
import sqlalchemy as sa

revision = "flr20261112sc02"
down_revision = "flr20261112tb01"
branch_labels = None
depends_on = None

_KEY = "flooring_estimates"
_ALONGSIDE = "bathroom_estimates"

_roles = sa.table(
    "role_screen_access",
    sa.column("role", sa.String),
    sa.column("screens", sa.JSON),
)
_staff = sa.table(
    "staff",
    sa.column("id"),
    sa.column("screen_access", sa.JSON),
)


def _with_key(screens):
    if not isinstance(screens, list) or _ALONGSIDE not in screens or _KEY in screens:
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
    inspector = sa.inspect(conn)
    if not inspector.has_table("role_screen_access") or not inspector.has_table("staff"):
        return
    _rewrite(conn, _with_key)


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if not inspector.has_table("role_screen_access") or not inspector.has_table("staff"):
        return
    _rewrite(conn, _without_key)
