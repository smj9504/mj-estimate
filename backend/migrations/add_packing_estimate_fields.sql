-- Migration: Add packing estimate fields to pack_calculations, pack_rooms, pack_items
-- Also create packing_prices table

-- ============================================
-- pack_calculations: new columns
-- ============================================

ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS claim_id UUID REFERENCES claims(id);
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS mode VARCHAR(20) DEFAULT 'quick';
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'draft';
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS crew_size INTEGER DEFAULT 4;
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS region VARCHAR(50) DEFAULT 'mid_atlantic';
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS staging_type VARCHAR(20) DEFAULT 'off_site';
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS include_packback BOOLEAN DEFAULT TRUE;
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS storage_months INTEGER DEFAULT 1;
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS include_op BOOLEAN DEFAULT TRUE;
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS op_rate INTEGER DEFAULT 20;
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS include_contingency BOOLEAN DEFAULT FALSE;
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS contingency_rate INTEGER DEFAULT 0;
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS sections JSONB;
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS section_details JSONB;
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS materials_summary JSONB;
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS material_details JSONB;
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS supplements JSONB;
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS subtotal FLOAT;
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS op_amount FLOAT;
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS contingency_amount FLOAT;
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS supplements_total FLOAT DEFAULT 0;
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS grand_total FLOAT;
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS storage_sf INTEGER DEFAULT 0;
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS total_hours FLOAT;
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS total_items INTEGER;
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS special_items JSONB;
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS custom_special_items JSONB;
ALTER TABLE pack_calculations ADD COLUMN IF NOT EXISTS room_summaries JSONB;

-- Indexes
CREATE INDEX IF NOT EXISTS ix_pack_calculations_client ON pack_calculations(client_id);
CREATE INDEX IF NOT EXISTS ix_pack_calculations_company ON pack_calculations(company_id);
CREATE INDEX IF NOT EXISTS ix_pack_calculations_status ON pack_calculations(status);

-- ============================================
-- pack_rooms: new columns
-- ============================================

ALTER TABLE pack_rooms ADD COLUMN IF NOT EXISTS preset_key VARCHAR(100);
ALTER TABLE pack_rooms ADD COLUMN IF NOT EXISTS density VARCHAR(20) DEFAULT 'normal';
ALTER TABLE pack_rooms ADD COLUMN IF NOT EXISTS contamination VARCHAR(20) DEFAULT 'clean';
ALTER TABLE pack_rooms ADD COLUMN IF NOT EXISTS hints JSONB;
ALTER TABLE pack_rooms ADD COLUMN IF NOT EXISTS hint_volume JSONB;
ALTER TABLE pack_rooms ADD COLUMN IF NOT EXISTS hint_qty JSONB;
ALTER TABLE pack_rooms ADD COLUMN IF NOT EXISTS room_special_items JSONB;
ALTER TABLE pack_rooms ADD COLUMN IF NOT EXISTS custom_special_items JSONB;
ALTER TABLE pack_rooms ADD COLUMN IF NOT EXISTS photos JSONB;

-- ============================================
-- pack_items: new columns
-- ============================================

ALTER TABLE pack_items ADD COLUMN IF NOT EXISTS is_high_value BOOLEAN DEFAULT FALSE;
ALTER TABLE pack_items ADD COLUMN IF NOT EXISTS packing_method VARCHAR(100);
ALTER TABLE pack_items ADD COLUMN IF NOT EXISTS required_materials JSONB;
ALTER TABLE pack_items ADD COLUMN IF NOT EXISTS base_labor_hours FLOAT;
ALTER TABLE pack_items ADD COLUMN IF NOT EXISTS per_unit_labor_hours FLOAT;
ALTER TABLE pack_items ADD COLUMN IF NOT EXISTS estimated_labor_hours FLOAT;
ALTER TABLE pack_items ADD COLUMN IF NOT EXISTS estimator_flags JSONB;

-- ============================================
-- packing_prices: new table
-- ============================================

CREATE TABLE IF NOT EXISTS packing_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    unit VARCHAR(50),
    unit_price FLOAT NOT NULL DEFAULT 0,
    category VARCHAR(100),
    is_taxable BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    company_id UUID REFERENCES companies(id),
    created_by_id UUID REFERENCES staff(id),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_packing_prices_company ON packing_prices(company_id);
CREATE INDEX IF NOT EXISTS ix_packing_prices_code ON packing_prices(code);
CREATE INDEX IF NOT EXISTS ix_packing_prices_category ON packing_prices(category);
