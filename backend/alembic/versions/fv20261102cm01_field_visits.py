"""field visits: a client made on site from an address, and photos taken room by room

- field_visits: one visit to a client's property, with where it was started. The
  altitude taken there counts as the first floor.
- field_rooms: a floor and a named room in it. The id is made by the phone.
- field_shots: one photo or video in a room, with what the phone knew when it was
  taken. The id is made by the phone, so a retried upload isn't saved twice. The
  picture is a row of files, so file_id has no foreign key: it may be a claim's.

Revision ID: fv20261102cm01
Revises: wm20261102rm01
Create Date: 2026-11-02
"""

from alembic import op
import sqlalchemy as sa

from app.core.database_types import UUIDType

revision = "fv20261102cm01"
down_revision = "wm20261102rm01"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'field_visits',
        sa.Column('id', UUIDType(), primary_key=True),
        sa.Column('client_id', UUIDType(), sa.ForeignKey('clients.id', ondelete='CASCADE'), nullable=False),
        sa.Column('claim_id', UUIDType(), sa.ForeignKey('claims.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_by_id', UUIDType(), sa.ForeignKey('staff.id', ondelete='SET NULL'), nullable=True),
        sa.Column('latitude', sa.Float()),
        sa.Column('longitude', sa.Float()),
        sa.Column('gps_accuracy', sa.Float()),
        sa.Column('ground_altitude', sa.Float()),
        sa.Column('ground_altitude_accuracy', sa.Float()),
        sa.Column('last_activity_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True)),
    )
    op.create_index('ix_field_visits_id', 'field_visits', ['id'])
    op.create_index('ix_field_visits_client_id', 'field_visits', ['client_id'])
    op.create_index('ix_field_visits_last_activity_at', 'field_visits', ['last_activity_at'])

    op.create_table(
        'field_rooms',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('visit_id', UUIDType(), sa.ForeignKey('field_visits.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('name_source', sa.String(10), nullable=False, server_default='default'),
        sa.Column('floor', sa.String(2), nullable=False, server_default='1'),
        sa.Column('floor_source', sa.String(10), nullable=False, server_default='default'),
        sa.Column('room_type', sa.String(30)),
        sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True)),
    )
    op.create_index('ix_field_rooms_visit_id', 'field_rooms', ['visit_id'])

    op.create_table(
        'field_shots',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('visit_id', UUIDType(), sa.ForeignKey('field_visits.id', ondelete='CASCADE'), nullable=False),
        sa.Column('room_id', sa.String(36), sa.ForeignKey('field_rooms.id', ondelete='CASCADE'), nullable=False),
        sa.Column('file_id', sa.String(36), nullable=False),
        sa.Column('kind', sa.String(10), nullable=False, server_default='wall'),
        sa.Column('wall', sa.Integer()),
        sa.Column('captured_at', sa.DateTime(timezone=True)),
        sa.Column('latitude', sa.Float()),
        sa.Column('longitude', sa.Float()),
        sa.Column('gps_accuracy', sa.Float()),
        sa.Column('altitude', sa.Float()),
        sa.Column('altitude_accuracy', sa.Float()),
        sa.Column('heading', sa.Float()),
        sa.Column('pitch', sa.Float()),
        sa.Column('steps', sa.Integer()),
        sa.Column('moved', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('ai_room_type', sa.String(30)),
        sa.Column('ai_basement', sa.Boolean()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_field_shots_visit_id', 'field_shots', ['visit_id'])
    op.create_index('ix_field_shots_room_id', 'field_shots', ['room_id'])
    op.create_index('ix_field_shots_file_id', 'field_shots', ['file_id'])


def downgrade():
    op.drop_table('field_shots')
    op.drop_table('field_rooms')
    op.drop_table('field_visits')
