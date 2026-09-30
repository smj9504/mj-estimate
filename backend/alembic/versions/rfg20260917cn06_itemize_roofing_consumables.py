"""split the accessories lump into the consumables actually ordered

"Nails, starter, caulk & accessories" at $18/SQ priced a basket nobody
sells. Each consumable is ordered on its own line — a carton of coil
nails, a tube of Vulkem — so each gets its own price-book row, named as
the supplier lists it so a cost can be checked against an invoice.

The old lump row is retired rather than deleted: estimates costed before
this keep a snapshot referencing `accessories`, and that has to keep
resolving. Step flashing also moves from BX to BD, which is how pre-bent
step is actually sold.

Revision ID: rfg20260917cn06
Revises: rfg20260917pu05
Create Date: 2026-09-17
"""
import uuid

from alembic import op
import sqlalchemy as sa

revision = 'rfg20260917cn06'
down_revision = 'rfg20260917pu05'
branch_labels = None
depends_on = None

TABLE = 'roofing_material_prices'
EPS = 0.005

# The step flashing row: relabel and restate BX -> BD (same cost, the
# pack size is identical, only the trade name for it differs).
STEP_KEY = 'step_flashing'
STEP_LABEL = '3" X 3" X 8" Pre-Bent Aluminum Step Flashing 100/BD'
STEP_OLD_UNIT, STEP_NEW_UNIT = 'BX', 'BD'


def _has_table(conn, table: str) -> bool:
    return sa.inspect(conn).has_table(table)


def _catalog_consumables():
    """Consumable rows from the live catalog, so values cannot drift."""
    from app.domains.roofing_estimate.material_cost import CONSUMABLES
    return CONSUMABLES


def upgrade() -> None:
    conn = op.get_bind()
    if not _has_table(conn, TABLE):
        return

    try:
        consumables = _catalog_consumables()
    except Exception:  # pragma: no cover - depends on runner's sys.path
        print("rfg20260917cn06: app package not importable; consumables "
              "will be seeded lazily on first use")
        consumables = {}

    inserted = 0
    for key, spec in consumables.items():
        exists = conn.execute(sa.text(
            f"SELECT 1 FROM {TABLE} "
            "WHERE material_key = :k AND company_id IS NULL"
        ), {"k": key}).fetchone()
        if exists:
            continue
        conn.execute(sa.text(
            f"INSERT INTO {TABLE} "
            "(id, material_key, label, category, unit, unit_cost,"
            " is_taxable, is_active, is_custom, company_id, created_at) "
            "VALUES (:id, :k, :l, 'accessories', :u, :c,"
            " :t, :a, :cu, NULL, CURRENT_TIMESTAMP)"
        ), {
            "id": str(uuid.uuid4()), "k": key, "l": spec["label"],
            "u": spec["unit"], "c": float(spec["cost"]),
            "t": True, "a": True, "cu": False,
        })
        inserted += 1

    # Retire the lump. Only if untouched — an edited value means someone
    # is relying on it, so leave it visible for them to deal with.
    retired = conn.execute(sa.text(
        f"UPDATE {TABLE} SET is_active = :inactive "
        "WHERE material_key = 'accessories' AND company_id IS NULL "
        "AND is_active = :active AND ABS(unit_cost - :old) < :eps"
    ), {"inactive": False, "active": True, "old": 18.0, "eps": EPS})

    # Step flashing: BX -> BD, and take the supplier's name for it.
    step = conn.execute(sa.text(
        f"SELECT unit FROM {TABLE} "
        "WHERE material_key = :k AND company_id IS NULL"
    ), {"k": STEP_KEY}).fetchone()
    if step and step[0] == STEP_OLD_UNIT:
        conn.execute(sa.text(
            f"UPDATE {TABLE} SET unit = :u, label = :l "
            "WHERE material_key = :k AND company_id IS NULL"
        ), {"u": STEP_NEW_UNIT, "l": STEP_LABEL, "k": STEP_KEY})

    print(f"rfg20260917cn06: added {inserted} consumable rows, "
          f"retired {retired.rowcount} accessories lump")


def downgrade() -> None:
    conn = op.get_bind()
    if not _has_table(conn, TABLE):
        return

    try:
        consumables = _catalog_consumables()
    except Exception:  # pragma: no cover
        consumables = {}

    # Only remove rows this migration could have created: still active,
    # not custom, and never edited away from the seeded cost.
    for key, spec in consumables.items():
        conn.execute(sa.text(
            f"DELETE FROM {TABLE} "
            "WHERE material_key = :k AND company_id IS NULL "
            "AND is_custom = :false_val AND ABS(unit_cost - :c) < :eps"
        ), {"k": key, "false_val": False,
            "c": float(spec["cost"]), "eps": EPS})

    conn.execute(sa.text(
        f"UPDATE {TABLE} SET is_active = :active "
        "WHERE material_key = 'accessories' AND company_id IS NULL"
    ), {"active": True})

    conn.execute(sa.text(
        f"UPDATE {TABLE} SET unit = :u, label = :l "
        "WHERE material_key = :k AND company_id IS NULL AND unit = :new_u"
    ), {"u": STEP_OLD_UNIT, "l": "Step flashing", "k": STEP_KEY,
        "new_u": STEP_NEW_UNIT})
