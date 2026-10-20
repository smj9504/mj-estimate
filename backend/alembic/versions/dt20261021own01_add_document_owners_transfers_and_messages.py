"""add estimate/invoice owners, document transfers and staff messages

Each person now manages their own estimates and invoices: estimates.owner_id
and invoices.owner_id say whose they are, and only the owner (or a super
admin) sees them. Everything made before this belongs to the admin account
(username 'admin', or the first super admin if there is none).

document_transfers holds offers of an estimate or invoice to someone else;
the recipient gets their own copy when they accept.

conversations, conversation_participants and messages hold one-to-one and
group messages between staff.

Revision ID: dt20261021own01
Revises: ft20261021ttl01
Create Date: 2026-10-21
"""
from alembic import op
import sqlalchemy as sa

revision = 'dt20261021own01'
down_revision = 'ft20261021ttl01'
branch_labels = None
depends_on = None

OWNED_TABLES = ('estimates', 'invoices')


def _id_column():
    return sa.Column('id', sa.UUID(), primary_key=True, server_default=sa.text('gen_random_uuid()'))


def _timestamps():
    return [
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    ]


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    # Owners. The app's startup column check may have added owner_id already,
    # without the foreign key or index.
    for table in OWNED_TABLES:
        columns = {c['name'] for c in inspector.get_columns(table)}
        if 'owner_id' not in columns:
            op.add_column(
                table,
                sa.Column(
                    'owner_id', sa.UUID(), nullable=True,
                    comment='Who manages it; only they and super admins see it',
                ),
            )
        foreign_keys = {fk['name'] for fk in inspector.get_foreign_keys(table)}
        if f'fk_{table}_owner_id_staff' not in foreign_keys:
            op.create_foreign_key(
                f'fk_{table}_owner_id_staff', table, 'staff', ['owner_id'], ['id'], ondelete='SET NULL'
            )
        indexes = {ix['name'] for ix in inspector.get_indexes(table)}
        if f'ix_{table}_owner_id' not in indexes:
            op.create_index(f'ix_{table}_owner_id', table, ['owner_id'])

    admin_id = conn.execute(sa.text("SELECT id FROM staff WHERE username = 'admin'")).scalar()
    if admin_id is None:
        admin_id = conn.execute(sa.text(
            "SELECT id FROM staff WHERE role = 'super_admin' ORDER BY created_at LIMIT 1"
        )).scalar()
    if admin_id is not None:
        for table in OWNED_TABLES:
            conn.execute(
                sa.text(f"UPDATE {table} SET owner_id = :admin WHERE owner_id IS NULL"),
                {'admin': admin_id},
            )

    # Document transfers
    if 'document_transfers' not in tables:
        op.create_table(
            'document_transfers',
            _id_column(),
            sa.Column('document_type', sa.String(20), nullable=False, comment='estimate or invoice'),
            sa.Column('source_id', sa.UUID(), nullable=False, comment="The sender's document"),
            sa.Column('document_number', sa.String(50), nullable=True),
            sa.Column('client_name', sa.String(255), nullable=True),
            sa.Column('from_staff_id', sa.UUID(), sa.ForeignKey('staff.id', ondelete='SET NULL'), nullable=True),
            sa.Column('to_staff_id', sa.UUID(), sa.ForeignKey('staff.id', ondelete='CASCADE'), nullable=False),
            sa.Column('note', sa.Text(), nullable=True),
            sa.Column(
                'status', sa.String(20), nullable=False, server_default='pending',
                comment='pending, accepted, declined or cancelled',
            ),
            sa.Column('copy_id', sa.UUID(), nullable=True, comment="The recipient's copy, once accepted"),
            sa.Column('responded_at', sa.DateTime(timezone=True), nullable=True),
            *_timestamps(),
        )
        op.create_index('ix_document_transfers_id', 'document_transfers', ['id'])
        op.create_index('ix_document_transfers_source_id', 'document_transfers', ['source_id'])
        op.create_index('ix_document_transfers_to_staff_id', 'document_transfers', ['to_staff_id'])
        op.create_index('ix_document_transfers_status', 'document_transfers', ['status'])

    # Messages
    if 'conversations' not in tables:
        op.create_table(
            'conversations',
            _id_column(),
            sa.Column('title', sa.String(200), nullable=True, comment="A group's name"),
            sa.Column('is_group', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('created_by_id', sa.UUID(), sa.ForeignKey('staff.id', ondelete='SET NULL'), nullable=True),
            sa.Column('last_message_at', sa.DateTime(timezone=True), nullable=True),
            *_timestamps(),
        )
        op.create_index('ix_conversations_id', 'conversations', ['id'])
        op.create_index('ix_conversations_last_message_at', 'conversations', ['last_message_at'])

    if 'conversation_participants' not in tables:
        op.create_table(
            'conversation_participants',
            _id_column(),
            sa.Column(
                'conversation_id', sa.UUID(),
                sa.ForeignKey('conversations.id', ondelete='CASCADE'), nullable=False,
            ),
            sa.Column('staff_id', sa.UUID(), sa.ForeignKey('staff.id', ondelete='CASCADE'), nullable=False),
            sa.Column(
                'last_read_at', sa.DateTime(timezone=True), nullable=True,
                comment='Messages after this are unread for this person',
            ),
            *_timestamps(),
            sa.UniqueConstraint('conversation_id', 'staff_id', name='uq_conversation_participant'),
        )
        op.create_index('ix_conversation_participants_id', 'conversation_participants', ['id'])
        op.create_index(
            'ix_conversation_participants_conversation_id', 'conversation_participants', ['conversation_id']
        )
        op.create_index('ix_conversation_participants_staff_id', 'conversation_participants', ['staff_id'])

    if 'messages' not in tables:
        op.create_table(
            'messages',
            _id_column(),
            sa.Column(
                'conversation_id', sa.UUID(),
                sa.ForeignKey('conversations.id', ondelete='CASCADE'), nullable=False,
            ),
            sa.Column('sender_id', sa.UUID(), sa.ForeignKey('staff.id', ondelete='SET NULL'), nullable=True),
            sa.Column(
                'kind', sa.String(30), nullable=False, server_default='text',
                comment='text, document_transfer, transfer_reply or notice',
            ),
            sa.Column('body', sa.Text(), nullable=False),
            sa.Column('related_type', sa.String(30), nullable=True),
            sa.Column('related_id', sa.UUID(), nullable=True),
            *_timestamps(),
        )
        op.create_index('ix_messages_id', 'messages', ['id'])
        op.create_index('ix_messages_conversation_created', 'messages', ['conversation_id', 'created_at'])


def downgrade() -> None:
    op.drop_table('messages')
    op.drop_table('conversation_participants')
    op.drop_table('conversations')
    op.drop_table('document_transfers')
    for table in OWNED_TABLES:
        op.drop_index(f'ix_{table}_owner_id', table_name=table)
        op.drop_constraint(f'fk_{table}_owner_id_staff', table, type_='foreignkey')
        op.drop_column(table, 'owner_id')
