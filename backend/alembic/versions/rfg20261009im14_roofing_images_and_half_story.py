"""roofing estimate photos + 1.5-story buildings

roofing_estimate_images: photos printed at the end of the estimate PDF.
One address often has several structures, and a marked-up aerial or a
photo of the existing roof shows the customer which roof is quoted.
Bytes are stored on the row, as wm_floor_sketches does.

roofing_estimates.stories: integer -> float so a 1.5-story house (Cape
Cod, bonus room) can be entered. Existing 1/2/3 values convert as-is.

Revision ID: rfg20261009im14
Revises: rfg20261008pp13
Create Date: 2026-10-09
"""

from alembic import op
import sqlalchemy as sa

revision = 'rfg20261009im14'
down_revision = 'rfg20261008pp13'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    is_pg = bind.dialect.name == "postgresql"

    if "roofing_estimate_images" not in inspector.get_table_names():
        uuid_type = sa.String(36)
        if is_pg:
            from sqlalchemy.dialects import postgresql
            uuid_type = postgresql.UUID(as_uuid=False)
        op.create_table(
            "roofing_estimate_images",
            sa.Column("id", uuid_type, primary_key=True),
            sa.Column("created_at", sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True)),
            sa.Column("estimate_id", uuid_type,
                      sa.ForeignKey("roofing_estimates.id",
                                    ondelete="CASCADE"),
                      nullable=False),
            sa.Column("image_data", sa.LargeBinary(), nullable=False),
            sa.Column("content_type", sa.String(100), nullable=False),
            sa.Column("file_name", sa.String(255), nullable=True),
            sa.Column("caption", sa.String(500), nullable=True),
            sa.Column("display_order", sa.Integer(), server_default="0"),
        )
        op.create_index("ix_roof_images_estimate_id",
                        "roofing_estimate_images", ["estimate_id"])

    cols = {c["name"]: c for c in inspector.get_columns("roofing_estimates")}
    stories = cols.get("stories")
    if stories is not None and isinstance(stories["type"], sa.Integer):
        op.alter_column(
            "roofing_estimates", "stories",
            type_=sa.Float(), existing_type=sa.Integer(),
            postgresql_using="stories::double precision",
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    op.alter_column(
        "roofing_estimates", "stories",
        type_=sa.Integer(), existing_type=sa.Float(),
        postgresql_using="round(stories)::integer",
    )
    if "roofing_estimate_images" in inspector.get_table_names():
        op.drop_index("ix_roof_images_estimate_id",
                      table_name="roofing_estimate_images")
        op.drop_table("roofing_estimate_images")
