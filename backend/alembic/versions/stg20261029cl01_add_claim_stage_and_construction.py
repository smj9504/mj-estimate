"""add stage_override and construction dates to claims

A claim's lifecycle stage (mitigation, WM docs, awaiting estimate,
supplement, follow-up, construction, depreciation, settlement) is worked
out from its records. stage_override lets staff set it by hand when those
records lag behind. construction_started_at / construction_completed_at
record the rebuild, which runs alongside the paperwork and opens
depreciation recovery when it finishes.

Revision ID: stg20261029cl01
Revises: iv20261027rev01
Create Date: 2026-10-29
"""
from alembic import op
import sqlalchemy as sa

revision = 'stg20261029cl01'
down_revision = 'iv20261027rev01'
branch_labels = None
depends_on = None

COLUMNS = [
    ('stage_override', sa.String(40),
     "Lifecycle stage set by hand; NULL = derived from the claim's records"),
    ('construction_started_at', sa.DateTime(timezone=True),
     'When rebuild construction started'),
    ('construction_completed_at', sa.DateTime(timezone=True),
     'When rebuild construction finished'),
]


def upgrade() -> None:
    conn = op.get_bind()
    for name, type_, comment in COLUMNS:
        result = conn.execute(sa.text(
            "SELECT 1 FROM information_schema.columns "
            f"WHERE table_name='claims' AND column_name='{name}'"
        ))
        if not result.fetchone():
            op.add_column('claims', sa.Column(name, type_, nullable=True, comment=comment))


def downgrade() -> None:
    for name, _, _ in reversed(COLUMNS):
        op.drop_column('claims', name)
