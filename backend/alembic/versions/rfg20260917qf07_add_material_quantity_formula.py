"""store each material's quantity formula as data

How many bundles a roof needs was hardcoded: a table in material_cost.py
for consumables, another in material_packaging.py for the rest. Changing
"one carton of coil nails per 20 squares" to 25 meant a code edit.

The rule is always the same shape — take a measurement, divide by what
one package covers, round up, never go below a minimum — so it is stored
per material instead, and the price-book screen can edit it.

qty_basis NULL means "keep using the built-in rule", so nothing changes
for a material until someone sets a formula on it. The rows this
migration seeds are exactly the rules the code already applies, so the
numbers do not move on upgrade.

Revision ID: rfg20260917qf07
Revises: rfg20260917cn06
Create Date: 2026-09-17
"""
from alembic import op
import sqlalchemy as sa

revision = 'rfg20260917qf07'
down_revision = 'rfg20260917cn06'
branch_labels = None
depends_on = None

TABLE = 'roofing_material_prices'

COLUMNS = (
    ('qty_basis', lambda: sa.Column(
        'qty_basis', sa.String(40), nullable=True)),
    ('qty_minimum', lambda: sa.Column(
        'qty_minimum', sa.Float(), nullable=True)),
)

# material_key -> (basis, measured units per package, minimum)
# These mirror what the code computes today, so seeding them is a no-op
# in terms of output — it just moves the rule into data.
SEED_FORMULAS = {
    # Consumables
    "caulk": ("penetrations", 3, 2),
    "staples": ("squares", 15, 0),
    "coil_nails": ("squares", 20, 0),
    "hand_nails": ("drip_edge_lf", 200, 1),
    "trim_coil": ("flashing_lf", 50, 0),
    # Field materials (CertainTeed/default packaging)
    "ridge_cap": ("ridge_hip_lf", 30, 0),
    "ice_water": ("eave_valley_lf", 48, 0),
    "drip_edge": ("drip_edge_lf", 10, 0),
    "step_flashing": ("flashing_lf", 100 / 1.5, 0),
}

# Shingle and underlayment come in grades; every grade shares a rule.
GRADE_FORMULAS = {
    "shingle:": ("squares", 1 / 3, 0),        # 3 BD per SQ
    "underlayment:": ("squares", 10, 0),      # 10 SQ per RL
    "ridge_vent:": ("ridge_lf", 4, 0),
    "gutter:": ("gutter_lf", 10, 0),
    "downspout:": ("downspout_lf", 10, 0),
    "gutter_guard:": ("gutter_lf", 4, 0),
}


def _has_table(conn, table: str) -> bool:
    return sa.inspect(conn).has_table(table)


def _has_column(conn, table: str, column: str) -> bool:
    if conn.dialect.name == 'sqlite':
        rows = conn.execute(sa.text(f"PRAGMA table_info({table})")).fetchall()
        return any(r[1] == column for r in rows)
    result = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name=:t AND column_name=:c"
    ), {"t": table, "c": column})
    return result.fetchone() is not None


def upgrade() -> None:
    conn = op.get_bind()
    if not _has_table(conn, TABLE):
        return

    for name, make in COLUMNS:
        if not _has_column(conn, TABLE, name):
            op.add_column(TABLE, make())

    def apply(key, basis, per, minimum):
        conn.execute(sa.text(
            f"UPDATE {TABLE} SET qty_basis = :b, coverage_per_unit = :p,"
            " qty_minimum = :m"
            " WHERE material_key = :k AND qty_basis IS NULL"
        ), {"b": basis, "p": float(per), "m": float(minimum), "k": key})

    for key, (basis, per, minimum) in SEED_FORMULAS.items():
        apply(key, basis, per, minimum)

    # Grade-bearing keys: one rule for every variant of the material.
    for prefix, (basis, per, minimum) in GRADE_FORMULAS.items():
        rows = conn.execute(sa.text(
            f"SELECT material_key FROM {TABLE} WHERE material_key LIKE :p"
        ), {"p": f"{prefix}%"}).fetchall()
        for (key,) in rows:
            apply(key, basis, per, minimum)

    total = conn.execute(sa.text(
        f"SELECT COUNT(*) FROM {TABLE} WHERE qty_basis IS NOT NULL"
    )).scalar()
    print(f"rfg20260917qf07: {total} materials now carry a quantity formula")


def downgrade() -> None:
    conn = op.get_bind()
    if not _has_table(conn, TABLE):
        return

    for name, _ in reversed(COLUMNS):
        if _has_column(conn, TABLE, name):
            op.drop_column(TABLE, name)
