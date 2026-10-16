"""add wm_floor_sketches.pdf_include_background

Lets a floor in Image mode leave its imported image out of the sketch PDF,
for floors where the plan was drawn over the image.

Revision ID: wm20261017pdfbg01
Revises: ei20261016rx01
Create Date: 2026-10-17
"""
from alembic import op


revision = 'wm20261017pdfbg01'
down_revision = 'ei20261016rx01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE wm_floor_sketches ADD COLUMN IF NOT EXISTS "
        "pdf_include_background BOOLEAN NOT NULL DEFAULT TRUE"
    )


def downgrade() -> None:
    op.drop_column('wm_floor_sketches', 'pdf_include_background')
