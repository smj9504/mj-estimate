"""merge cabinet, roofing, wm payment board heads

Revision ID: mrg20260919hd01
Revises: cab20260918pb02, rfg20260918sr12, wm20260918pb01
Create Date: 2026-09-19 01:32:27.418161

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'mrg20260919hd01'
down_revision = ('cab20260918pb02', 'rfg20260918sr12', 'wm20260918pb01')
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
