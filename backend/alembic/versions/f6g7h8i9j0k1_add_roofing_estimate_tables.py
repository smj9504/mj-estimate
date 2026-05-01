"""Add roofing estimate tables

Revision ID: f6g7h8i9j0k1
Revises: e5f6g7h8i9j0
Create Date: 2026-04-30

Creates:
  - roofing_estimates (main estimate table)
  - roofing_estimate_line_items (calculated line items with 8-phase structure)
  - roofing_estimate_history (version snapshots)
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'f6g7h8i9j0k1'
down_revision = 'e5f6g7h8i9j0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    uuid_type = sa.String(36)
    json_type = sa.JSON()

    if is_pg:
        try:
            uuid_type = postgresql.UUID(as_uuid=False)
        except Exception:
            pass
        try:
            json_type = postgresql.JSONB
        except Exception:
            pass

    # ── roofing_estimates ──
    op.create_table(
        'roofing_estimates',
        sa.Column('id', uuid_type, primary_key=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), onupdate=sa.func.now()),

        # Relationships
        sa.Column('claim_id', uuid_type, sa.ForeignKey('claims.id', ondelete='SET NULL'), nullable=True),
        sa.Column('company_id', uuid_type, sa.ForeignKey('companies.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_by_id', uuid_type, sa.ForeignKey('staff.id', ondelete='SET NULL'), nullable=True),

        sa.Column('status', sa.String(50), nullable=False, server_default='draft'),

        # Project meta
        sa.Column('property_address', sa.String(500), nullable=True),
        sa.Column('city', sa.String(100), nullable=True),
        sa.Column('state', sa.String(5), nullable=True),
        sa.Column('zip_code', sa.String(10), nullable=True),
        sa.Column('building_type', sa.String(50), nullable=True),
        sa.Column('year_built', sa.Integer(), nullable=True),
        sa.Column('stories', sa.Integer(), server_default='1'),
        sa.Column('hoa', sa.Boolean(), server_default='false'),
        sa.Column('roof_access', sa.String(50), nullable=True),

        # Measurement
        sa.Column('measurement_source', sa.String(50), nullable=True),
        sa.Column('total_sf', sa.Float(), server_default='0'),
        sa.Column('squares', sa.Float(), server_default='0'),
        sa.Column('predominant_pitch', sa.String(10), nullable=True),
        sa.Column('pitch_multiplier', sa.Float(), server_default='1.0'),
        sa.Column('ridge_lf', sa.Float(), server_default='0'),
        sa.Column('hip_lf', sa.Float(), server_default='0'),
        sa.Column('valley_lf', sa.Float(), server_default='0'),
        sa.Column('eave_lf', sa.Float(), server_default='0'),
        sa.Column('rake_lf', sa.Float(), server_default='0'),
        sa.Column('step_flashing_lf', sa.Float(), server_default='0'),
        sa.Column('penetration_count', sa.Integer(), server_default='0'),
        sa.Column('skylight_count', sa.Integer(), server_default='0'),
        sa.Column('chimney_count', sa.Integer(), server_default='0'),
        sa.Column('waste_factor', sa.Float(), server_default='0.12'),
        sa.Column('roof_complexity', sa.String(50), nullable=True),

        # EagleView
        sa.Column('eagleview_data', json_type, nullable=True),
        sa.Column('selected_faces', json_type, nullable=True),

        # Scope
        sa.Column('full_tearoff', sa.Boolean(), server_default='true'),
        sa.Column('layer_count', sa.Integer(), server_default='1'),
        sa.Column('overlay', sa.Boolean(), server_default='false'),
        sa.Column('existing_material', sa.String(50), nullable=True),
        sa.Column('insurance_job', sa.Boolean(), server_default='false'),

        # Component specs (JSONB)
        sa.Column('shingle_spec', json_type, nullable=True),
        sa.Column('decking_spec', json_type, nullable=True),
        sa.Column('underlayment_spec', json_type, nullable=True),
        sa.Column('ice_water_spec', json_type, nullable=True),
        sa.Column('drip_edge_spec', json_type, nullable=True),
        sa.Column('ventilation_spec', json_type, nullable=True),
        sa.Column('flashing_spec', json_type, nullable=True),
        sa.Column('ridge_cap_spec', json_type, nullable=True),
        sa.Column('gutter_spec', json_type, nullable=True),
        sa.Column('hidden_costs', json_type, nullable=True),
        sa.Column('insurance_info', json_type, nullable=True),

        # Pricing
        sa.Column('pricing_method', sa.String(50), server_default='hybrid'),
        sa.Column('material_markup_pct', sa.Float(), server_default='0.25'),
        sa.Column('labor_markup_pct', sa.Float(), server_default='0.20'),
        sa.Column('include_overhead_profit', sa.Boolean(), server_default='false'),
        sa.Column('overhead_pct', sa.Float(), server_default='0.10'),
        sa.Column('profit_pct', sa.Float(), server_default='0.10'),
        sa.Column('contingency_pct', sa.Float(), server_default='0.05'),

        # Totals
        sa.Column('subtotal', sa.Float(), server_default='0'),
        sa.Column('markup_amount', sa.Float(), server_default='0'),
        sa.Column('overhead_amount', sa.Float(), server_default='0'),
        sa.Column('profit_amount', sa.Float(), server_default='0'),
        sa.Column('tax_amount', sa.Float(), server_default='0'),
        sa.Column('permit_fee', sa.Float(), server_default='0'),
        sa.Column('total', sa.Float(), server_default='0'),

        # Documentation
        sa.Column('overview_text', sa.Text(), nullable=True),
        sa.Column('methodology_notes', sa.Text(), nullable=True),
        sa.Column('warning_flags', json_type, nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
    )

    op.create_index('ix_roofing_estimates_claim_id', 'roofing_estimates', ['claim_id'])
    op.create_index('ix_roofing_estimates_company_id', 'roofing_estimates', ['company_id'])
    op.create_index('ix_roofing_estimates_status', 'roofing_estimates', ['status'])

    # ── roofing_estimate_line_items ──
    op.create_table(
        'roofing_estimate_line_items',
        sa.Column('id', uuid_type, primary_key=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), onupdate=sa.func.now()),

        sa.Column('estimate_id', uuid_type,
                  sa.ForeignKey('roofing_estimates.id', ondelete='CASCADE'),
                  nullable=False),

        sa.Column('phase', sa.Integer(), nullable=False),
        sa.Column('description', sa.String(500), nullable=False),
        sa.Column('quantity', sa.Float(), nullable=False),
        sa.Column('unit', sa.String(10), nullable=False),
        sa.Column('unit_price', sa.Float(), nullable=False),
        sa.Column('total', sa.Float(), nullable=False),
        sa.Column('category', sa.String(50), nullable=True),
        sa.Column('xactimate_code', sa.String(20), nullable=True),
        sa.Column('notes', sa.String(500), nullable=True),
        sa.Column('display_order', sa.Integer(), server_default='0'),
    )

    op.create_index('ix_roof_line_items_estimate_id', 'roofing_estimate_line_items', ['estimate_id'])

    # ── roofing_estimate_history ──
    op.create_table(
        'roofing_estimate_history',
        sa.Column('id', uuid_type, primary_key=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), onupdate=sa.func.now()),

        sa.Column('estimate_id', uuid_type,
                  sa.ForeignKey('roofing_estimates.id', ondelete='CASCADE'),
                  nullable=False),

        sa.Column('version_number', sa.Integer(), nullable=False),
        sa.Column('snapshot_data', json_type, nullable=False),
        sa.Column('changed_by_id', uuid_type,
                  sa.ForeignKey('staff.id', ondelete='SET NULL'),
                  nullable=True),
        sa.Column('change_description', sa.String(500), nullable=True),
    )

    op.create_index('ix_roof_history_estimate_id', 'roofing_estimate_history', ['estimate_id'])


def downgrade() -> None:
    op.drop_table('roofing_estimate_history')
    op.drop_table('roofing_estimate_line_items')
    op.drop_table('roofing_estimates')
