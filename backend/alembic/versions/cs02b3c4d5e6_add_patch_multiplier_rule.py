"""Add patch SF multiplier rule to Paint section

Revision ID: cs02b3c4d5e6
Revises: cs01a2b3c4d5
Create Date: 2026-04-28
"""

import json
import uuid
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "cs02b3c4d5e6"
down_revision = "cs01a2b3c4d5"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()

    # Find the paint section by section_key
    result = conn.execute(
        sa.text("SELECT id FROM xact_cs_sections WHERE section_key = 'paint'")
    ).fetchone()
    if not result:
        return

    paint_section_id = result[0]

    # Get current max sort_order for rules in paint section
    max_sort = conn.execute(
        sa.text("SELECT COALESCE(MAX(sort_order), -1) FROM xact_cs_rules WHERE section_id = :sid"),
        {"sid": paint_section_id},
    ).scalar()

    # Insert the patch multiplier rule
    items = json.dumps([
        "Drywall 패치 후 Seal+Paint 면적은 **패치 SF보다 넓게** 적용",
        "패치 주변 블렌딩 영역까지 Seal/Paint 필요 → Multiplier 적용",
        "**1~2 SF** → × 4 (패치 4배 면적)",
        "**3~5 SF** → × 3",
        "**6~10 SF** → × 2.5",
        "**11~20 SF** → × 2.2",
        "**21~32 SF** → × 2",
        "**33~50 SF** → × 1.7",
        "**50+ SF** → × 1.5",
        "예: 10 SF 패치 → Seal/Paint 수량 = 10 × 2.5 = **25 SF**",
        "⚠ 전체 벽면 도장(WC SF) 시에는 Multiplier 불필요",
    ], ensure_ascii=False)
    conn.execute(
        sa.text("""
            INSERT INTO xact_cs_rules (id, section_id, rule_type, title, items, sort_order)
            VALUES (:id, :sid, :rtype, :title, CAST(:items AS jsonb), :sort)
        """),
        {
            "id": str(uuid.uuid4()),
            "sid": paint_section_id,
            "rtype": "purple",
            "title": "Drywall Patch — Seal/Paint 수량 Multiplier",
            "items": items,
            "sort": max_sort + 1,
        },
    )


def downgrade():
    conn = op.get_bind()
    conn.execute(
        sa.text("DELETE FROM xact_cs_rules WHERE title = 'Drywall Patch — Seal/Paint 수량 Multiplier'")
    )
