"""restate seeded price-book rows in purchase units

Migration pb03 seeded the price book while the catalog still priced
materials per SQ/SF/LF. The costing code now buys in packages — bundles,
rolls, sticks — so those rows are not merely mislabelled, they are wrong
by the pack size: a shingle row saying 135.00/SQ would be multiplied by
85 bundles instead of 28.25 squares, tripling the material cost.

`seed_material_prices` cannot fix this because it deliberately never
overwrites an existing row (that is what protects a user's edited
price), so the correction has to happen here.

Only rows that still hold exactly the old seeded value are touched. A
row whose cost has been edited is left alone and reported, because we
cannot tell whether the user typed a per-SQ or a per-BD number — that
one needs a human. Custom rows and company-specific rows are never
touched.

Revision ID: rfg20260917pu05
Revises: rfg20260917pd04
Create Date: 2026-09-17
"""
from alembic import op
import sqlalchemy as sa

revision = 'rfg20260917pu05'
down_revision = 'rfg20260917pd04'
branch_labels = None
depends_on = None

TABLE = 'roofing_material_prices'

# material_key -> (old unit, old cost, new unit, new cost)
# Old values are the pb03-era catalog; new values are the current one.
RESTATE = {
    "shingle:three_tab": ("SQ", 105.0, "BD", 35.00),
    "shingle:architectural_std": ("SQ", 135.0, "BD", 45.00),
    "shingle:architectural_premium": ("SQ", 175.0, "BD", 58.33),
    "shingle:designer": ("SQ", 290.0, "BD", 96.67),
    "shingle:impact_resistant": ("SQ", 210.0, "BD", 70.00),
    "ridge_cap": ("LF", 4.40, "BD", 132.00),
    "underlayment:felt_15": ("SF", 0.09, "RL", 90.00),
    "underlayment:felt_30": ("SF", 0.13, "RL", 130.00),
    "underlayment:synthetic": ("SF", 0.18, "RL", 180.00),
    "ice_water": ("SF", 0.95, "RL", 136.80),
    "drip_edge": ("LF", 1.55, "PC", 15.50),
    "step_flashing": ("LF", 3.20, "BX", 213.33),
    "ridge_vent:shingle_over": ("LF", 4.80, "PC", 19.20),
    "ridge_vent:aluminum": ("LF", 6.50, "PC", 26.00),
    "gutter:k_style_5": ("LF", 1.85, "PC", 18.50),
    "gutter:k_style_6": ("LF", 2.40, "PC", 24.00),
    "gutter:half_round_5": ("LF", 4.10, "PC", 41.00),
    "gutter:half_round_6": ("LF", 5.20, "PC", 52.00),
    "gutter:copper_k_style_5": ("LF", 16.50, "PC", 165.00),
    "gutter:copper_k_style_6": ("LF", 20.00, "PC", 200.00),
    "downspout:2x3": ("LF", 1.95, "PC", 19.50),
    "downspout:3x4": ("LF", 2.75, "PC", 27.50),
    "gutter_guard:mesh": ("LF", 1.20, "PC", 4.80),
    "gutter_guard:micro_mesh": ("LF", 4.30, "PC", 17.20),
    "gutter_guard:foam": ("LF", 0.85, "PC", 3.40),
    "gutter_guard:reverse_curve": ("LF", 3.40, "PC", 13.60),
}

# Tolerance for "still the seeded value" — these are stored as floats.
EPS = 0.005


def _has_table(conn, table: str) -> bool:
    return sa.inspect(conn).has_table(table)


def upgrade() -> None:
    conn = op.get_bind()
    if not _has_table(conn, TABLE):
        return

    updated = 0
    skipped = []
    for key, (old_unit, old_cost, new_unit, new_cost) in RESTATE.items():
        row = conn.execute(sa.text(
            f"SELECT unit, unit_cost FROM {TABLE} "
            "WHERE material_key = :k AND company_id IS NULL"
        ), {"k": key}).fetchone()
        if not row:
            continue

        unit, cost = row[0], float(row[1] or 0)
        if unit == new_unit:
            continue                      # already restated
        if unit != old_unit or abs(cost - old_cost) > EPS:
            # Edited by hand under the old units: converting would put
            # words in the user's mouth. Leave it and say so.
            skipped.append(f"{key} ({cost:g}/{unit})")
            continue

        conn.execute(sa.text(
            f"UPDATE {TABLE} SET unit = :u, unit_cost = :c "
            "WHERE material_key = :k AND company_id IS NULL"
        ), {"u": new_unit, "c": new_cost, "k": key})
        updated += 1

    print(f"rfg20260917pu05: restated {updated} price-book rows "
          "in purchase units")
    if skipped:
        print("rfg20260917pu05: LEFT UNCHANGED (edited since seeding, "
              "check the unit by hand): " + ", ".join(skipped))


def downgrade() -> None:
    conn = op.get_bind()
    if not _has_table(conn, TABLE):
        return

    for key, (old_unit, old_cost, new_unit, new_cost) in RESTATE.items():
        conn.execute(sa.text(
            f"UPDATE {TABLE} SET unit = :u, unit_cost = :c "
            "WHERE material_key = :k AND company_id IS NULL "
            "AND unit = :new_u AND ABS(unit_cost - :new_c) < :eps"
        ), {"u": old_unit, "c": old_cost, "k": key,
            "new_u": new_unit, "new_c": new_cost, "eps": EPS})
