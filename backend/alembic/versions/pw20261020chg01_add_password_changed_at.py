"""add staff.password_changed_at and clear must_change_password

A password change or an admin reset signs out every session started before
it: tokens issued before staff.password_changed_at stop working.

staff.must_change_password now means an admin reset the password and the
person picks their own at the next sign-in. Nothing read it before and new
rows defaulted to true, so existing rows are cleared instead of making
everyone change their password.

Revision ID: pw20261020chg01
Revises: sa20261020scr01
Create Date: 2026-10-20
"""
from alembic import op
import sqlalchemy as sa

revision = 'pw20261020chg01'
down_revision = 'sa20261020scr01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    existing = {c['name'] for c in inspector.get_columns('staff')}
    if 'password_changed_at' not in existing:
        op.add_column(
            'staff',
            sa.Column(
                'password_changed_at', sa.DateTime(), nullable=True,
                comment="Sessions issued before this are signed out",
            ),
        )

    op.execute("UPDATE staff SET must_change_password = FALSE")


def downgrade() -> None:
    op.drop_column('staff', 'password_changed_at')
