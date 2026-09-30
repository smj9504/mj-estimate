"""seed the estimator's own quantity formulas

Transcribed from the working spreadsheet. Cell references map as:

    F3  roof_area_waste   F7  rake       F10 step_flashing
    F4  ridge             F8  eave
    F5  hip               F9  wall_flashing
    F6  valley

Two of the sheet's formulas are not seeded here because they reference
cells whose meaning is still unconfirmed:

    Roofing felt   =ROUND((F3-(L8*2)/100)/10)      -- L8 unknown
    Trim coil      =IF(B9>=1,ROUNDUP(F9/50),0)     -- B9 unknown

Those keep the rule they already had until the missing inputs are
defined. Everything else below is the sheet's formula verbatim, only
with cell addresses swapped for names.

Revision ID: rfg20260917sf09
Revises: rfg20260917fx08
Create Date: 2026-09-17
"""
from alembic import op
import sqlalchemy as sa

revision = 'rfg20260917sf09'
down_revision = 'rfg20260917fx08'
branch_labels = None
depends_on = None

TABLE = 'roofing_material_prices'

# material_key -> formula. Keys ending in ":" apply to every grade.
FORMULAS = {
    # =ROUNDUP((F8+F7)/116)
    "starter_shingle": "ROUNDUP((eave + rake) / 116)",

    # =ROUNDUP(3*(F6+F8+F9+F10)/200)
    "ice_water":
        "ROUNDUP(3 * (valley + eave + wall_flashing + step_flashing) / 200)",

    # =ROUNDUP((F7+F8)/10)
    "drip_edge": "ROUNDUP((rake + eave) / 10)",

    # =ROUND((F3/10)+1)  -- the sheet rounds rather than rounding up
    "caulk": "ROUND((roof_area_waste / 10) + 1)",

    # =ROUNDUP(F3/15)
    "staples": "ROUNDUP(roof_area_waste / 15)",

    # =IF((F6+F5)>20, ROUNDUP(F3/19)+1, ROUNDUP(F3/19))
    "coil_nails":
        "IF((valley + hip) > 20, ROUNDUP(roof_area_waste / 19) + 1,"
        " ROUNDUP(roof_area_waste / 19))",

    # =IF(L15>=2, L15-1, L15)  -- L15 is the coil nail count
    "hand_nails":
        "IF(qty_coil_nails >= 2, qty_coil_nails - 1, qty_coil_nails)",

    # =ROUND((F10*12/5+2)/100)
    "step_flashing": "ROUND((step_flashing * 12 / 5 + 2) / 100)",

    # =IF(B9>=1, ROUNDUP(F9/50), 0) -- B9 is the valley run.
    # Trim coil is only ordered when there are valleys to line.
    "trim_coil":
        "IF(valley >= 1, ROUNDUP(wall_flashing / 50), 0)",
}

# Grade-bearing materials: one formula for every variant.
PREFIX_FORMULAS = {
    # =ROUNDUP(F4/4)
    "ridge_vent:": "ROUNDUP(ridge / 4)",

    # Roofing felt =ROUND((F3-(L8*2)/100)/10), L8 being the ice & water
    # roll count. One IWS roll covers 2 SQ and felt is not laid over it,
    # so that area comes off the roof first. Every felt grade shares the
    # rule; the ice barrier is costed before this, so qty_ice_water is
    # already known.
    "underlayment:":
        "ROUND((roof_area_waste - qty_ice_water * 2) / 10)",
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
    if not _has_table(conn, TABLE) or not _has_column(
            conn, TABLE, 'qty_formula'):
        return

    # Starter strip is its own line on the sheet but was never in the
    # catalog; it is a real ordered material, so add it.
    exists = conn.execute(sa.text(
        f"SELECT 1 FROM {TABLE} WHERE material_key = 'starter_shingle'"
        " AND company_id IS NULL"
    )).fetchone()
    if not exists:
        import uuid
        conn.execute(sa.text(
            f"INSERT INTO {TABLE} "
            "(id, material_key, label, category, unit, unit_cost,"
            " is_taxable, is_active, is_custom, company_id, created_at) "
            "VALUES (:id, 'starter_shingle',"
            " 'Starter Strip Shingle', 'shingle', 'BD', :cost,"
            " :t, :a, :cu, NULL, CURRENT_TIMESTAMP)"
        ), {"id": str(uuid.uuid4()), "cost": 58.00,
            "t": True, "a": True, "cu": False})

    applied = 0
    for key, expression in FORMULAS.items():
        result = conn.execute(sa.text(
            f"UPDATE {TABLE} SET qty_formula = :f "
            "WHERE material_key = :k AND company_id IS NULL "
            "AND (qty_formula IS NULL OR qty_formula = '')"
        ), {"f": expression, "k": key})
        applied += result.rowcount or 0

    for prefix, expression in PREFIX_FORMULAS.items():
        result = conn.execute(sa.text(
            f"UPDATE {TABLE} SET qty_formula = :f "
            "WHERE material_key LIKE :p AND company_id IS NULL "
            "AND (qty_formula IS NULL OR qty_formula = '')"
        ), {"f": expression, "p": f"{prefix}%"})
        applied += result.rowcount or 0

    print(f"rfg20260917sf09: applied {applied} estimator formulas")


def downgrade() -> None:
    conn = op.get_bind()
    if not _has_table(conn, TABLE) or not _has_column(
            conn, TABLE, 'qty_formula'):
        return

    for key, expression in FORMULAS.items():
        conn.execute(sa.text(
            f"UPDATE {TABLE} SET qty_formula = NULL "
            "WHERE material_key = :k AND qty_formula = :f"
        ), {"k": key, "f": expression})
    for prefix, expression in PREFIX_FORMULAS.items():
        conn.execute(sa.text(
            f"UPDATE {TABLE} SET qty_formula = NULL "
            "WHERE material_key LIKE :p AND qty_formula = :f"
        ), {"p": f"{prefix}%", "f": expression})
    conn.execute(sa.text(
        f"DELETE FROM {TABLE} WHERE material_key = 'starter_shingle'"
        " AND is_custom = :false_val"
    ), {"false_val": False})
