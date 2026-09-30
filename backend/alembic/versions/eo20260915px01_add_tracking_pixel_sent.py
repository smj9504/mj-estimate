"""add tracking_pixel_sent to sent_emails

Records whether the open-tracking pixel was actually embedded in the
outbound body. Without this, a row with no opens is ambiguous: it could
mean the recipient never opened the mail, or that the pixel was never
attached at all (BACKEND_PUBLIC_URL pointing somewhere recipients cannot
reach). Left NULL on existing rows, which is exactly that "unknown".

Revision ID: eo20260915px01
Revises: wm20260915so01
Create Date: 2026-09-15
"""
from alembic import op
import sqlalchemy as sa

revision = 'eo20260915px01'
down_revision = 'wm20260915so01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    result = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='sent_emails' "
        "AND column_name='tracking_pixel_sent'"
    ))
    if result.fetchone():
        return

    op.add_column(
        'sent_emails',
        sa.Column(
            'tracking_pixel_sent',
            sa.Boolean(),
            nullable=True,
            comment=(
                'True if the open-tracking pixel was embedded in the '
                'sent body; NULL for rows sent before this was recorded'
            ),
        ),
    )


def downgrade() -> None:
    op.drop_column('sent_emails', 'tracking_pixel_sent')
