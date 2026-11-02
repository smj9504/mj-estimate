"""Split the cheat sheet into common and occasional items

Revision ID: cs20261102ti01
Revises: fv20261102cm01
Create Date: 2026-11-02

Adds is_common to xact_cs_rows and xact_cs_rules (true for everything by
default), then sorts what is there and adds what was missing.

The sort comes from counting line items across 965 real estate PDFs in the
AccuLynx archive (372 jobs). Those jobs are mostly roofing and exterior, so a
low count on interior work is weak evidence: a row flagged [miss] stays common
whatever its count, because being easy to forget is why it is on the sheet.

New rows come from xact_line_items (code, description, unit and price) and were
seen on real estimates, except where a row has no code because the catalog has
no such item.

Rows are matched by section and key, so a row someone has since deleted or
re-keyed is skipped instead of failing the deploy.
"""

import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "cs20261102ti01"
down_revision = "fv20261102cm01"
branch_labels = None
depends_on = None


OCCASIONAL_ROWS = {
    "carpet": ["c8"],
    "lvp": ["l5b", "l7", "l8", "l12"],
    "wood": ["w3", "w11", "w12", "w13"],
    "tile-floor": ["t2b", "t4b", "t4c", "t6", "t8"],
    "drywall": ["d2", "d7", "d8", "d11", "d13"],
    "texture": ["tx2", "tx6", "tx7", "tx8"],
    "paint": ["p3", "p11", "p15"],
    "trim": ["tr5", "tr6", "tr9", "tr11", "tf7", "tf9"],
    "room-general": ["rg7"],
    "bathroom": ["b3", "b5", "b8", "b10", "b12", "b14", "b15", "b16", "b19", "b20", "b33"],
    "kitchen": ["k2", "k3", "k6", "k8", "k9", "k10", "k11", "ka2", "ka4", "ka5", "ka9"],
    "stairs": ["s2", "s5", "s7"],
    "electrical": ["e5", "e6", "e7", "e9", "e10", "e11", "e13", "e14", "e15", "e16", "e17"],
    "qty": ["q9", "q12", "q13"],
}

OCCASIONAL_RULES = {
    "waste": ["Drywall 부분 교체 Waste 규칙", "Waste 계산 예시"],
    "paint-rules": ["Scrape & Prep for Paint — 언제 추가하나"],
    "trim": ["Paint Grade vs Stain Grade 판단"],
    "electrical": ["Megohmmeter — 무엇을 검사하나", "Megohmmeter — 필요 없는 경우"],
    "qty": ["부분 작업 시 Qty 계산법"],
}


def _item(group_key, group, item, unit, price="—", note=""):
    return {group_key: group, "item": item, "unit": unit, "price": price, "note": note}


def _named(name, item, unit, price="—", note=""):
    return {"item_name": name, "item": item, "unit": unit, "price": price, "note": note}


def _general(group, item, unit, note=""):
    return {"category": group, "item": item, "unit": unit, "note": note}


# (section_key, table_index, row_key, insert after this key or None for the end, is_common, data)
NEW_ROWS = [
    # Common: on many real estimates and missing from the sheet
    ("room-general", 0, "rgx1", "rg9", True, _general("Debris", "`DMO PU` Haul debris - per pickup truck load - including dump fees", "EA", "demo 잔해 처리")),
    ("paint", 0, "px1", "p1", True, _named("Seal the surface area w/PVA primer - 1 coat", "`PNT` seal PVA primer", "SF", note="Seal만 따로 잡을 때")),
    ("paint", 0, "px2", "p5", True, _named("Paint the ceiling - 1 coat", "`PNT` ceiling 1 coat", "SF", note="C SF 사용")),
    ("paint", 0, "px3", "px2", True, _named("Paint the ceiling - 2 coats", "`PNT` ceiling 2 coats", "SF", note="C SF 사용")),
    ("paint", 0, "px4", "px3", True, _named("Paint walls & ceiling - 1 coat", "`PNT` walls+ceiling 1 coat", "SF", note="WC SF 사용")),
    ("bathroom", 0, "bx1", "b25", True, _item("step", "", "Toilet - Detach & reset", "EA")),
    ("wood", 0, "wx1", "w5", True, _item("mode", "", "`FCW NFCP` Wood floor - per specs from independent wood analysis", "SF", "$5.88", "analysis 있을 때")),
    # Occasional
    ("carpet", 0, "cx1", None, False, _item("situation", "기타", "`FCC AVRS` Carpet - Detach & relay", "SF", "$0.91", "기존 카펫 재사용")),
    ("carpet", 0, "cx2", None, False, _item("situation", "", "`FCC AVB` Additional labor for Berber or patterned carpets", "SF", "$0.24")),
    ("carpet", 0, "cx3", None, False, _item("situation", "", "`FCC BIND` Carpet binding", "LF", "$3.70")),
    ("carpet", 0, "cx4", None, False, _item("situation", "", "`FCC GD` Glue down carpet - Premium grade", "SF", "$5.34")),
    ("carpet", 0, "cx5", None, False, _item("situation", "", "`FCC FP` Floor prep (scrape rubber back residue)", "SF", "$0.66")),
    ("lvp", 0, "lx1", None, False, _item("type", "Vinyl", "`FCV NFCPPLK` Vinyl plank - per specs from ind. vinyl analysis", "SF", "$3.90")),
    ("lvp", 0, "lx2", None, False, _item("type", "", "`FCV PLKGDC` Add for glued down vinyl plank over concrete", "SF", "$2.06")),
    ("lvp", 0, "lx3", None, False, _item("type", "", "`FCV AV` Vinyl floor covering (sheet goods) - Premium grade", "SF", "$7.87", "+ 10~15% waste")),
    ("lvp", 0, "lx4", None, False, _item("type", "", "`FCV V` Vinyl tile - Premium grade", "SF", "$9.33")),
    ("lvp", 0, "lx5", None, False, _item("type", "", "`FCV CB4` Cove base molding - rubber or vinyl, 4\" high", "LF", "$2.86")),
    ("lvp", 0, "lx6", None, False, _item("type", "Eng. Wood", "`FCW LAMTD` Engineered wood flooring - High grade", "SF", "$14.25")),
    ("lvp", 0, "lx7", None, False, _item("type", "", "`FCW NFCPENF` Engineered floating - specs from ind analysis", "SF", "$4.70")),
    ("lvp", 0, "lx8", None, False, _item("type", "", "`FCW NFCPENG` Engineered wood - specs from independent analysis", "SF", "$5.69")),
    ("lvp", 0, "lx9", None, False, _item("type", "", "`FCW GADDC` Add for glued down wood flooring over concrete", "SF", "$2.91")),
    ("lvp", 0, "lx10", None, False, _item("type", "Trim", "`FCW LAME` End molding - High grade", "LF", "$8.30")),
    ("tile-floor", 0, "tx-b", None, False, _item("step", "기타", "`FCT B` Tile base - Premium grade", "LF", "$27.57")),
    ("tile-floor", 0, "tx-u", None, False, _item("step", "", "`FCT UC1` Underlayment - 1/4\" cork", "SF", "$3.72")),
    ("tile-floor", 0, "tx-g", None, False, _item("step", "", "`FCT GROUT` Regrout tile floor", "SF", "$4.74")),
    ("drywall", 0, "dx1", None, False, _item("type", "Minimum", "`DRY MN` Drywall - Labor Minimum", "EA", "$511.45")),
    ("drywall", 0, "dx2", None, False, _item("type", "", "`DRY MNRP` Drywall Repair - Minimum Charge - Labor and Material", "EA", "$535.19")),
    ("drywall", 0, "dx3", None, False, _item("type", "기타", "`DRY CBEAD` Corner bead - per LF", "LF", "$8.48")),
    ("drywall", 0, "dx4", None, False, _item("type", "", "`DRY BARR` Dust control barrier per square foot", "SF", "$1.64")),
    ("drywall", 0, "dx5", None, False, _item("type", "", "`DRY LAB` Drywall Installer / Finisher - per hour", "HR", "$113.54")),
    ("paint", 0, "px5", None, False, _named("Paint crown molding - 1 coat", "`PNT CWN`", "LF", "$1.15")),
    ("paint", 0, "px6", None, False, _named("Paint chair rail - 1 coat", "`PNT CHR`", "LF", "$1.11")),
    ("paint", 0, "px7", None, False, _named("[Stain] Stain & finish casing", "`PNT CS`", "LF", "$1.79")),
    ("paint", 0, "px8", None, False, _named("Seal & paint door slab only", "`PNT DORSP`", "EA/side", "$43.18")),
    ("paint", 0, "px9", None, False, _named("Seal & paint door/window trim & jamb", "`PNT DORTSP`", "EA/side", "$35.93")),
    ("paint", 0, "px10", None, False, _named("Paint bifold door set - slab only - 2 coats", "`PNT BF`", "EA/side", "$57.96")),
    ("paint", 0, "px11", None, False, _named("Paint French door slab only - 2 coats", "`PNT FR`", "EA/side", "$81.27")),
    ("paint", 0, "px12", None, False, _named("Seal & paint closet shelving - single shelf", "`PNT CLOS`", "EA", "$58.63")),
    ("paint", 0, "px13", None, False, _named("Seal & paint acoustic ceiling (popcorn) texture", "`PNT AC`", "SF", "$1.44")),
    ("trim", 0, "trx1", None, False, {"grade": "기타", "item_name": "Baseboard - Detach & reset", "item": "`FNC BRS`", "unit": "LF", "price": "$2.99", "note": ""}),
    ("trim", 0, "trx2", None, False, {"grade": "", "item_name": "Baseboard - 5 1/4\" stain grade", "item": "`FNC B5`", "unit": "LF", "price": "$7.26", "note": ""}),
    ("trim", 0, "trx3", None, False, {"grade": "", "item_name": "Trim board - 1\" x 4\" (pine)", "item": "`FNC 1X4`", "unit": "LF", "price": "$4.58", "note": ""}),
    ("trim", 0, "trx4", None, False, {"grade": "", "item_name": "Plinth block - hardwood", "item": "`FNC BLKP`", "unit": "EA", "price": "$15.46", "note": ""}),
    ("room-general", 0, "rgx2", None, False, _general("Contents", "`CON PROT` Protect contents - Cover with plastic", "SF")),
    ("room-general", 0, "rgx3", None, False, _general("Floor Protection", "`DMO MASKSFP` Floor protection - heavy paper and tape", "SF")),
    ("room-general", 0, "rgx4", None, False, _general("", "`DMO MASKSFC` Floor protection - cardboard and tape", "SF")),
    ("room-general", 0, "rgx5", None, False, _general("Debris", "`DMO DUMP` Dumpster load - Approx. 20 yards, 4 tons of debris", "EA")),
    ("room-general", 0, "rgx6", None, False, _general("Cleaning", "`CLN F` Clean floor", "SF")),
    ("room-general", 0, "rgx7", None, False, _general("D&R", "`DOR DOR-RS` Interior door - Detach & reset - slab only", "EA")),
    ("room-general", 0, "rgx8", None, False, _general("", "`LIT RCRS` Recessed light fixture - Detach & reset entire unit", "EA")),
    ("room-general", 0, "rgx9", None, False, _general("", "`LIT CHANRS` Chandelier - Detach & reset", "EA")),
    ("room-general", 0, "rgx10", None, False, _general("", "`HVC CARS` Cold air return cover - Detach & reset", "EA")),
    ("room-general", 0, "rgx11", None, False, _general("", "`APP DRYRS` Dryer - Remove & reset", "EA")),
    ("bathroom", 0, "bx2", None, False, _item("step", "Tile", "`TIL GROUT` Regrout tile", "SF", "$4.73")),
    ("bathroom", 0, "bx3", None, False, _item("step", "", "`TIL BMUD` Mortar bed for tile", "SF", "$11.49")),
    ("bathroom", 0, "bx4", None, False, _item("step", "", "`TIL FSTRIP` Add-on for tile feature strip - High grade", "LF", "$12.37")),
    ("bathroom", 0, "bx5", None, False, _item("step", "Shower Door", "`MSD SDORRS` Shower door system - Detach & reset", "EA", "$212.15")),
    ("bathroom", 0, "bx6", None, False, _item("step", "Plumbing", "Angle stop valve R&R", "EA")),
    ("bathroom", 0, "bx7", None, False, _item("step", "Vanity", "`MBL VTSNKRS` Vanity top - Detach & reset", "LF", "$56.52")),
    ("bathroom", 0, "bx8", None, False, _item("step", "Accessories", "`FNH TBARRS` Towel bar - Detach & reset", "EA", "$16.88")),
    ("bathroom", 0, "bx9", None, False, _item("step", "", "`FNH TPRS` Toilet paper holder - Detach & reset", "EA", "$17.82")),
    ("bathroom", 0, "bx10", None, False, _item("step", "", "`FNH SRODRS` Shower curtain rod - Detach & reset", "EA", "$16.04")),
    ("bathroom", 0, "bx11", None, False, _item("step", "", "`TBA MIRRS` Bathroom mirror - Detach & reset", "SF", "$9.32")),
    ("bathroom", 0, "bx12", None, False, _item("step", "", "`CAB MC` Medicine cabinet - Premium grade", "EA", "$461.87")),
    ("kitchen", 1, "kax1", None, False, _item("category", "CT Add-ons", "`CAB CTGMS` Undermount sink cutout & polish - single basin", "EA", "$167.61")),
    ("kitchen", 1, "kax2", None, False, _item("category", "", "`CAB CTGMSD` Undermount sink cutout & polish - double basin", "EA", "$252.08")),
    ("kitchen", 1, "kax3", None, False, _item("category", "Cabinet", "`CAB PLY` Cabinet panels - side, end, or back - Premium grade", "SF", "$23.52")),
    ("kitchen", 1, "kax4", None, False, _item("category", "", "`CAB REF` Cabinet refacing - Deluxe grade", "SF", "$49.17")),
    ("kitchen", 1, "kax5", None, False, _item("category", "Appliances", "`APP FRZRS` Freezer - Remove & reset", "EA", "$45.83")),
    ("stairs", 0, "sx1", None, False, _item("category", "Carpet", "`FCC SS` Stairway skirt board charge for carpet", "LF", "$6.09")),
    ("stairs", 0, "sx2", None, False, _item("category", "Vinyl", "`FCV STP` Step charge for vinyl installation", "EA", "$23.95")),
    ("stairs", 0, "sx3", None, False, _item("category", "Wood/Laminate", "`FCW LAMS` Stair nosing - for wood flooring", "LF", "$10.11")),
    ("stairs", 0, "sx4", None, False, _item("category", "Handrail", "`PNT HRS` Stain & finish handrail - wall mounted", "LF", "$2.47")),
    ("stairs", 0, "sx5", None, False, _item("category", "Balustrade", "`FNC BAL-RS` Balustrade - Detach & reset", "LF", "$63.55")),
    ("stairs", 0, "sx6", None, False, _item("category", "", "`PNT BALS` Stain & finish balustrade", "LF", "$33.64")),
    ("electrical", 0, "ex1", None, False, _item("category", "Labor", "`ELE LAB` Electrician - per hour", "HR", "$146.83")),
    ("electrical", 0, "ex2", None, False, _item("category", "욕실/주방", "`ELE BFCRS` Bathroom ventilation fan cover - Detach & reset", "EA", "$12.87")),
    ("electrical", 0, "ex3", None, False, _item("category", "", "`ELE FANRS` Exhaust fan - Detach & reset", "EA", "$284.76")),
]


def _table_id(conn, section_key, table_index):
    return conn.execute(
        sa.text(
            "SELECT t.id FROM xact_cs_tables t JOIN xact_cs_sections s ON s.id = t.section_id "
            "WHERE s.section_key = :key ORDER BY t.sort_order, t.id LIMIT 1 OFFSET :index"
        ),
        {"key": section_key, "index": table_index},
    ).scalar()


def _insert_row(conn, rows_t, section_key, table_index, row_key, after_key, is_common, data):
    table_id = _table_id(conn, section_key, table_index)
    if table_id is None:
        return
    exists = conn.execute(
        sa.text("SELECT 1 FROM xact_cs_rows WHERE table_id = :t AND row_key = :k"),
        {"t": table_id, "k": row_key},
    ).first()
    if exists:
        return

    after_order = None
    if after_key:
        after_order = conn.execute(
            sa.text("SELECT sort_order FROM xact_cs_rows WHERE table_id = :t AND row_key = :k"),
            {"t": table_id, "k": after_key},
        ).scalar()

    if after_order is None:
        sort_order = conn.execute(
            sa.text("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM xact_cs_rows WHERE table_id = :t"),
            {"t": table_id},
        ).scalar()
    else:
        sort_order = after_order + 1
        conn.execute(
            sa.text("UPDATE xact_cs_rows SET sort_order = sort_order + 1 WHERE table_id = :t AND sort_order >= :o"),
            {"t": table_id, "o": sort_order},
        )

    conn.execute(rows_t.insert().values(
        id=str(uuid.uuid4()), table_id=table_id, row_key=row_key,
        data=data, is_common=is_common, sort_order=sort_order,
    ))


def upgrade():
    op.add_column("xact_cs_rows", sa.Column("is_common", sa.Boolean, nullable=False, server_default="true"))
    op.add_column("xact_cs_rules", sa.Column("is_common", sa.Boolean, nullable=False, server_default="true"))

    conn = op.get_bind()

    for section_key, row_keys in OCCASIONAL_ROWS.items():
        for row_key in row_keys:
            conn.execute(
                sa.text(
                    "UPDATE xact_cs_rows SET is_common = false "
                    "WHERE row_key = :k AND table_id IN ("
                    "  SELECT t.id FROM xact_cs_tables t JOIN xact_cs_sections s ON s.id = t.section_id"
                    "  WHERE s.section_key = :s)"
                ),
                {"k": row_key, "s": section_key},
            )

    for section_key, titles in OCCASIONAL_RULES.items():
        for title in titles:
            conn.execute(
                sa.text(
                    "UPDATE xact_cs_rules SET is_common = false "
                    "WHERE title = :title AND section_id IN ("
                    "  SELECT id FROM xact_cs_sections WHERE section_key = :s)"
                ),
                {"title": title, "s": section_key},
            )

    rows_t = sa.table(
        "xact_cs_rows",
        sa.column("id", UUID), sa.column("table_id", UUID),
        sa.column("row_key", sa.Text), sa.column("data", JSONB),
        sa.column("is_common", sa.Boolean), sa.column("sort_order", sa.Integer),
    )
    for section_key, table_index, row_key, after_key, is_common, data in NEW_ROWS:
        _insert_row(conn, rows_t, section_key, table_index, row_key, after_key, is_common, data)


def downgrade():
    conn = op.get_bind()
    for section_key, table_index, row_key, _after, _common, _data in NEW_ROWS:
        table_id = _table_id(conn, section_key, table_index)
        if table_id is not None:
            conn.execute(
                sa.text("DELETE FROM xact_cs_rows WHERE table_id = :t AND row_key = :k"),
                {"t": table_id, "k": row_key},
            )
    op.drop_column("xact_cs_rules", "is_common")
    op.drop_column("xact_cs_rows", "is_common")
