"""cabinet estimates: add under-sink plumbing flags

The plumbing scope used to be two lump sums (disconnect + a $500 reconnect
that absorbed P-trap, disposal, DW hookup and faucet lines). Those parts are
now itemized at marginal labor, and the ones that depend on the specific
kitchen are per-estimate flags.

P-trap, supply lines and angle stops are not flags - they always come with
the plumbing scope. The dishwasher's and disposer's own detach/reset stay in
APPLIANCE_RR_PRICING, so only the DW's supply line and angle stop are here.

All default false, so existing estimates keep their current scope.

Revision ID: cab20260910pl01
Revises: cab20260910rb01
"""
from alembic import op
import sqlalchemy as sa

revision = "cab20260910pl01"
down_revision = "cab20260910rb01"
branch_labels = None
depends_on = None

_TABLE = "cabinet_estimates"
_COLUMNS = (
    "include_aav",
    "include_air_gap",
    "include_soap_dispenser",
    "include_instant_hot",
    "include_dw_hookup",
)


def _existing(conn) -> set:
    return {c["name"] for c in sa.inspect(conn).get_columns(_TABLE)}


def upgrade() -> None:
    conn = op.get_bind()
    if not sa.inspect(conn).has_table(_TABLE):
        return
    have = _existing(conn)
    for col in _COLUMNS:
        if col in have:
            continue
        op.add_column(
            _TABLE,
            sa.Column(
                col,
                sa.Boolean(),
                nullable=True,
                server_default=sa.false(),
            ),
        )


def downgrade() -> None:
    conn = op.get_bind()
    if not sa.inspect(conn).has_table(_TABLE):
        return
    have = _existing(conn)
    for col in _COLUMNS:
        if col in have:
            op.drop_column(_TABLE, col)
