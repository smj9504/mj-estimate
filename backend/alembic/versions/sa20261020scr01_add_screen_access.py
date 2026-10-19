"""add screen access for staff and roles

Admins choose which sidebar screens each role sees (role_screen_access) and
can give one staff member their own list (staff.screen_access). Both start
empty, which means everyone keeps seeing every screen.

Revision ID: sa20261020scr01
Revises: alx20261018rm01
Create Date: 2026-10-20
"""
from alembic import op
import sqlalchemy as sa

revision = 'sa20261020scr01'
down_revision = 'alx20261018rm01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    existing = {c['name'] for c in inspector.get_columns('staff')}
    if 'screen_access' not in existing:
        op.add_column(
            'staff',
            sa.Column(
                'screen_access', sa.JSON(), nullable=True,
                comment="Screen keys this person may open; NULL = role defaults",
            ),
        )

    if 'role_screen_access' not in inspector.get_table_names():
        op.create_table(
            'role_screen_access',
            sa.Column('role', sa.String(50), primary_key=True),
            sa.Column('screens', sa.JSON(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )


def downgrade() -> None:
    op.drop_table('role_screen_access')
    op.drop_column('staff', 'screen_access')
