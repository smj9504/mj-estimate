"""add WM payment board columns and public link token table

The payment screen needs four values per job that water_mitigation_jobs
did not carry: the insurance-approved amount, the negotiated-down final
amount, who the check was made out to, and a plain yes/no for whether
the money arrived. invoice_amount already exists and is written by the
scope invoice sync, so it is reused read-only rather than duplicated.

payment_received is a dedicated boolean rather than another value in the
payment_status string because a no-login public link writes it. Keeping
that write down to one boolean column means the manager's link can never
overwrite a 'lost' or 'reissued' lifecycle state.

wm_payment_board_tokens is the link itself: one non-expiring token that
an admin retires (is_active=False) by regenerating.

Revision ID: wm20260918pb01
Revises: rfg20260917ps10
Create Date: 2026-09-18
"""
from alembic import op
import sqlalchemy as sa

revision = 'wm20260918pb01'
down_revision = 'rfg20260917ps10'
branch_labels = None
depends_on = None


NULLABLE_COLUMNS = [
    ('approved_amount', sa.DECIMAL(10, 2), 'Amount approved by the insurance company'),
    ('final_amount', sa.DECIMAL(10, 2),
     'Final amount after negotiating down from approved_amount (optional)'),
    ('check_recipient', sa.String(20), 'Who the check went to: contractor | customer'),
    ('payment_received_at', sa.DateTime(timezone=True),
     'When payment_received was last set true'),
    ('payment_received_by', sa.String(100),
     "Who confirmed: 'admin:<staff_id>' or 'public_link'"),
]


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    is_pg = conn.dialect.name == 'postgresql'

    existing = {c['name'] for c in inspector.get_columns('water_mitigation_jobs')}

    for name, coltype, comment in NULLABLE_COLUMNS:
        if name in existing:
            continue
        op.add_column(
            'water_mitigation_jobs',
            sa.Column(name, coltype, nullable=True, comment=comment),
        )

    if 'payment_received' not in existing:
        op.add_column(
            'water_mitigation_jobs',
            sa.Column(
                'payment_received', sa.Boolean(),
                nullable=False, server_default=sa.false(),
                comment='Has the payment been received (binary)',
            ),
        )
        op.create_index(
            'ix_wm_jobs_payment_received',
            'water_mitigation_jobs', ['payment_received'],
        )

    if 'wm_payment_board_tokens' in inspector.get_table_names():
        return

    uuid_type = sa.dialects.postgresql.UUID(as_uuid=True) if is_pg else sa.String(36)

    op.create_table(
        'wm_payment_board_tokens',
        sa.Column(
            'id', uuid_type, primary_key=True,
            server_default=sa.text('gen_random_uuid()') if is_pg else None,
        ),
        sa.Column('token', sa.String(100), nullable=False),
        sa.Column('label', sa.String(200), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('view_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('confirm_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_accessed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by_id', uuid_type, nullable=False),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.text('now()'), nullable=False,
        ),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['created_by_id'], ['staff.id']),
        sa.UniqueConstraint('token', name='uq_wm_payment_board_tokens_token'),
    )
    op.create_index(
        'ix_wm_payment_board_tokens_token',
        'wm_payment_board_tokens', ['token'], unique=True,
    )
    op.create_index(
        'ix_wm_payment_board_tokens_active',
        'wm_payment_board_tokens', ['is_active'],
    )


def downgrade() -> None:
    op.drop_index('ix_wm_payment_board_tokens_active', table_name='wm_payment_board_tokens')
    op.drop_index('ix_wm_payment_board_tokens_token', table_name='wm_payment_board_tokens')
    op.drop_table('wm_payment_board_tokens')

    op.drop_index('ix_wm_jobs_payment_received', table_name='water_mitigation_jobs')
    op.drop_column('water_mitigation_jobs', 'payment_received')
    for name, _, _ in NULLABLE_COLUMNS:
        op.drop_column('water_mitigation_jobs', name)
