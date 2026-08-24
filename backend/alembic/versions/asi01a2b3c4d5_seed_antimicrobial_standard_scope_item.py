"""Seed antimicrobial application standard scope item

Revision ID: asi01a2b3c4d5
Revises: am01a2b3c4d5
Create Date: 2026-08-23

Adds "Antimicrobial Application" as a system-wide WMStandardScopeItem
(item_type='standard') and maps it to the existing WTRGRM line item
(seeded in am01a2b3c4d5), so it appears in the Standard Scope Items
catalog with an invoice mapping already configured.
"""

import uuid

from alembic import op
from sqlalchemy import text

revision = "asi01a2b3c4d5"
down_revision = "am01a2b3c4d5"
branch_labels = None
depends_on = None

_ITEM_CODE = "WTRGRM"


def upgrade() -> None:
    conn = op.get_bind()

    line_item_id = conn.execute(
        text("SELECT id FROM line_items WHERE cat = 'WTR' AND item = :item"),
        {"item": _ITEM_CODE},
    ).scalar()

    if line_item_id is None:
        return

    exists = conn.execute(
        text(
            "SELECT 1 FROM wm_standard_scope_items "
            "WHERE name = 'Antimicrobial Application' AND company_id IS NULL"
        )
    ).scalar()

    if exists:
        return

    op.execute(
        text(
            """
            INSERT INTO wm_standard_scope_items
                (id, item_type, name, unit, line_item_id,
                 quantity_calc_type, default_invoice_note,
                 display_order, is_active)
            VALUES
                (:id, 'standard', 'Antimicrobial Application', 'SF', :line_item_id,
                 'fixed', :note,
                 :display_order, true)
            """
        ).bindparams(
            id=str(uuid.uuid4()),
            line_item_id=line_item_id,
            note=(
                "Apply EPA-registered antimicrobial/germicide agent to exposed "
                "framing, subfloor, and structural surfaces following drywall "
                "or floor demolition, to inhibit mold growth"
            ),
            display_order=len(
                [
                    "Floor Protection",
                    "Content Protection",
                    "Content Manipulation",
                    "Containment",
                    "Air Mover",
                    "Dehumidifier",
                    "Air Scrubber",
                ]
            ),
        )
    )


def downgrade() -> None:
    op.execute(
        text(
            "DELETE FROM wm_standard_scope_items "
            "WHERE name = 'Antimicrobial Application' AND company_id IS NULL"
        )
    )
