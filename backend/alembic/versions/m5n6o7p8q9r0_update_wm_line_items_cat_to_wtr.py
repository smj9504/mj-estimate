"""Update WM-mapped line items category to WTR

Revision ID: m5n6o7p8q9r0
Revises: l4m5n6o7p8q9
Create Date: 2026-04-06

Sets cat='WTR' on all line_items that are referenced by:
  - wm_standard_scope_items.line_item_id
  - wm_scope_items.line_item_id
  - wm_invoice_item_configs.line_item_id
"""

from alembic import op

revision = 'm5n6o7p8q9r0'
down_revision = 'l4m5n6o7p8q9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Update line items referenced by WM standard scope items
    op.execute("""
        UPDATE line_items
        SET cat = 'WTR'
        WHERE id IN (
            SELECT DISTINCT line_item_id
            FROM wm_standard_scope_items
            WHERE line_item_id IS NOT NULL
        )
    """)

    # Update line items referenced by WM scope items (per-job)
    op.execute("""
        UPDATE line_items
        SET cat = 'WTR'
        WHERE id IN (
            SELECT DISTINCT line_item_id
            FROM wm_scope_items
            WHERE line_item_id IS NOT NULL
        )
    """)

    # Update line items referenced by WM invoice item configs
    op.execute("""
        UPDATE line_items
        SET cat = 'WTR'
        WHERE id IN (
            SELECT DISTINCT line_item_id
            FROM wm_invoice_item_configs
            WHERE line_item_id IS NOT NULL
        )
    """)


def downgrade() -> None:
    # No reliable way to restore original categories
    pass
