/**
 * Xactimate Helper — Scope Configuration
 *
 * Hierarchical scope tree: Major Category → Sub-options → Item Codes
 * Each selection maps to Xactimate line item codes.
 * Auto-include rules add dependent items automatically.
 *
 * ⚠️ VERIFIED = code exists in xact_line_items DB (from parsed JSON)
 * ⚠️ CUSTOM   = code NOT found in DB — marked with _CUSTOM suffix for UI display
 *
 * Verification source: backend/uploads/xactimate_data/parsed_json/*.json
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FinishOption {
  value: string;
  label: string;
  itemCodes: string[];       // Paint/Stain item codes to add alongside install
  unit?: string;
  qtyField?: 'LF' | 'SF';
}

export interface ScopeOption {
  value: string;
  label: string;
  itemCodes: string[];       // Xactimate item codes to add (install)
  unit?: string;             // LF, SF, EA
  qtyField?: 'LF' | 'SF';   // Which room dimension to use for qty
  isCustom?: boolean;        // true if item code is not from official Xactimate DB
  finishOptions?: FinishOption[];  // Per-item finish: paint / stain / none
}

export interface ScopeSubCategory {
  key: string;
  label: string;
  multiple?: boolean;        // Allow multiple selections
  options: ScopeOption[];
  dependsOn?: string;        // Only show if this sub-category key is selected
  dependsOnValues?: string[]; // Only show if parent has one of these values
}

export interface AutoIncludeItem {
  label: string;
  itemCodes: string[];
  unit: string;
  qtyField?: 'LF' | 'SF';
  reason: string;
}

export interface ScopeCategory {
  key: string;
  label: string;
  icon: string;              // Ant Design icon name
  subCategories: ScopeSubCategory[];
  autoIncludes?: AutoIncludeItem[];  // Items auto-added when this category is selected
  applicableRooms?: string[];        // If set, only show for these room types (e.g. ['bathroom'])
}

// ─── Scope Tree ──────────────────────────────────────────────────────────────

export const SCOPE_CATEGORIES: ScopeCategory[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // FLOOR — REPLACE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    key: 'floor_replace',
    label: 'Floor — Replace',
    icon: 'AppstoreOutlined',
    subCategories: [
      {
        key: 'floor_type',
        label: 'Floor Type',
        options: [
          // ✅ VERIFIED: FCCAV = Carpet (SF $8.10)
          { value: 'carpet', label: 'Carpet', itemCodes: ['FCCAV'], unit: 'SF', qtyField: 'SF' },
          // ── Hardwood ──
          // ✅ VERIFIED: FCWAVPF = Pre-finished solid wood flooring (SF)
          { value: 'hardwood_prefinished', label: 'Hardwood — Pre-finished Solid', itemCodes: ['FCWAVPF'], unit: 'SF', qtyField: 'SF' },
          // ✅ VERIFIED: FCWAV = Oak flooring - no finish (SF)
          { value: 'hardwood_oak_unfinished', label: 'Hardwood — Oak (Unfinished)', itemCodes: ['FCWAV'], unit: 'SF', qtyField: 'SF' },
          // ✅ VERIFIED: FCWEXPF = Pre-finished exotic species (SF)
          { value: 'hardwood_exotic', label: 'Hardwood — Exotic Species (Pre-finished)', itemCodes: ['FCWEXPF'], unit: 'SF', qtyField: 'SF' },
          // ✅ VERIFIED: FCWLAMTF = Engineered wood flooring - floating (SF)
          { value: 'engineered_floating', label: 'Engineered Wood — Floating', itemCodes: ['FCWLAMTF'], unit: 'SF', qtyField: 'SF' },
          // ✅ VERIFIED: FCWLAMTD = Engineered wood flooring (SF)
          { value: 'engineered_gluedown', label: 'Engineered Wood — Glue Down', itemCodes: ['FCWLAMTD'], unit: 'SF', qtyField: 'SF' },
          // ✅ VERIFIED: FCWBAME = Bamboo flooring - engineered (SF)
          { value: 'bamboo', label: 'Bamboo — Engineered (Pre-finished)', itemCodes: ['FCWBAME'], unit: 'SF', qtyField: 'SF' },
          // ── Other ──
          // ✅ VERIFIED: FCWLAM = Snaplock Laminate flooring (SF $9.10)
          { value: 'laminate', label: 'Laminate (Snaplock)', itemCodes: ['FCWLAM'], unit: 'SF', qtyField: 'SF' },
          // ✅ VERIFIED: FCVPLK = Vinyl plank flooring (SF)
          { value: 'lvp', label: 'Luxury Vinyl Plank (LVP)', itemCodes: ['FCVPLK'], unit: 'SF', qtyField: 'SF' },
          // ✅ VERIFIED: FCVAV = Vinyl floor covering sheet goods (SF $7.87)
          { value: 'vinyl_sheet', label: 'Vinyl Sheet', itemCodes: ['FCVAV'], unit: 'SF', qtyField: 'SF' },
          // ✅ VERIFIED: FCTAV = Tile floor covering (SF $24.06)
          { value: 'tile', label: 'Ceramic/Porcelain Tile', itemCodes: ['FCTAV'], unit: 'SF', qtyField: 'SF' },
        ],
      },
      {
        // Carpet pad: Not legally required (IRC), but required by most manufacturers
        // for warranty. CRI 105 standard strongly recommends. Xactimate always lists
        // as separate line item.
        key: 'carpet_pad',
        label: 'Carpet Pad',
        dependsOn: 'floor_type',
        dependsOnValues: ['carpet'],
        options: [
          // ✅ VERIFIED: FCCPAD = Carpet pad - High grade (SF $1.00)
          { value: 'pad_include', label: 'Include Carpet Pad (CRI 105 standard, required for warranty)', itemCodes: ['FCCPAD'], unit: 'SF', qtyField: 'SF' },
          { value: 'pad_exclude', label: 'No Carpet Pad (commercial/glue-down only)', itemCodes: [] },
        ],
      },
      {
        // Underlayment for hard-surface flooring: vapor barrier, sound membrane, etc.
        key: 'underlayment',
        label: 'Underlayment / Vapor Barrier',
        dependsOn: 'floor_type',
        dependsOnValues: ['hardwood_prefinished', 'hardwood_oak_unfinished', 'hardwood_exotic', 'engineered_floating', 'engineered_gluedown', 'bamboo', 'laminate', 'lvp'],
        options: [
          { value: 'none', label: 'None', itemCodes: [] },
          // ✅ VERIFIED: FCWBARR = Vapor barrier - 15# felt (SF $0.29)
          { value: 'felt_15', label: 'Vapor Barrier — 15# Felt', itemCodes: ['FCWBARR'], unit: 'SF', qtyField: 'SF' },
          // ✅ VERIFIED: FCWBARRV = Vapor barrier - visqueen 6mil (SF $0.41)
          { value: 'visqueen', label: 'Vapor Barrier — Visqueen 6mil', itemCodes: ['FCWBARRV'], unit: 'SF', qtyField: 'SF' },
          // ✅ VERIFIED: FCWUS = Underlayment - sound/crack membrane (SF)
          { value: 'sound_membrane', label: 'Sound/Crack Membrane Underlayment', itemCodes: ['FCWUS'], unit: 'SF', qtyField: 'SF' },
          // ✅ VERIFIED: FCWUC1 = Underlayment - 1/4" cork (SF)
          { value: 'cork', label: 'Cork Underlayment (1/4")', itemCodes: ['FCWUC1'], unit: 'SF', qtyField: 'SF' },
          // ✅ VERIFIED: FCWFS = Felt and sleepers/underlay - over concrete (SF)
          { value: 'sleepers_concrete', label: 'Felt + Sleepers (Over Concrete)', itemCodes: ['FCWFS'], unit: 'SF', qtyField: 'SF' },
        ],
      },
      {
        // Sand & finish for unfinished hardwood
        key: 'sand_finish',
        label: 'Sand & Finish',
        dependsOn: 'floor_type',
        dependsOnValues: ['hardwood_oak_unfinished'],
        options: [
          // ✅ VERIFIED: FCWFIN = Sand & finish wood floor (SF)
          { value: 'sand_finish_natural', label: 'Sand & Finish (Natural)', itemCodes: ['FCWFIN'], unit: 'SF', qtyField: 'SF' },
          // ✅ VERIFIED: FCWFINP = Additional cost to pre-stain (SF)
          { value: 'stain_add', label: '+ Stain (Additional)', itemCodes: ['FCWFINP'], unit: 'SF', qtyField: 'SF' },
        ],
      },
      {
        key: 'baseboard',
        label: 'Baseboard',
        options: [
          { value: 'none', label: 'None', itemCodes: [] },
          // ── MDF (Paint Grade) — finish: paint only ──
          { value: 'bs_mdf_2', label: 'MDF 2¼"', itemCodes: ['FNCB2M'], unit: 'LF', qtyField: 'LF',
            finishOptions: [
              { value: 'none', label: 'No Finish', itemCodes: [] },
              { value: 'seal_1', label: 'Seal + Paint 1 coat', itemCodes: ['PNTB1SP'], unit: 'LF', qtyField: 'LF' },
              { value: 'seal_2', label: 'Seal + Paint 2 coats', itemCodes: ['PNTB2SP'], unit: 'LF', qtyField: 'LF' },
            ],
          },
          { value: 'bs_mdf_3', label: 'MDF 3¼"', itemCodes: ['FNCB3M'], unit: 'LF', qtyField: 'LF',
            finishOptions: [
              { value: 'none', label: 'No Finish', itemCodes: [] },
              { value: 'seal_1', label: 'Seal + Paint 1 coat', itemCodes: ['PNTB1SP'], unit: 'LF', qtyField: 'LF' },
              { value: 'seal_2', label: 'Seal + Paint 2 coats', itemCodes: ['PNTB2SP'], unit: 'LF', qtyField: 'LF' },
            ],
          },
          { value: 'bs_mdf_5', label: 'MDF 5¼"', itemCodes: ['FNCB5M'], unit: 'LF', qtyField: 'LF',
            finishOptions: [
              { value: 'none', label: 'No Finish', itemCodes: [] },
              { value: 'seal_1', label: 'Seal + Paint 1 coat', itemCodes: ['PNTB1SP'], unit: 'LF', qtyField: 'LF' },
              { value: 'seal_2', label: 'Seal + Paint 2 coats', itemCodes: ['PNTB2SP'], unit: 'LF', qtyField: 'LF' },
            ],
          },
          // ── Wood — Stain Grade — finish: paint OR stain ──
          { value: 'bs_stain_3', label: 'Wood 3¼" (Stain Grade)', itemCodes: ['FNCB3'], unit: 'LF', qtyField: 'LF',
            finishOptions: [
              { value: 'none', label: 'No Finish', itemCodes: [] },
              { value: 'seal_1', label: 'Seal + Paint 1 coat', itemCodes: ['PNTB1SP'], unit: 'LF', qtyField: 'LF' },
              { value: 'seal_2', label: 'Seal + Paint 2 coats', itemCodes: ['PNTB2SP'], unit: 'LF', qtyField: 'LF' },
              { value: 'stain', label: 'Stain & Finish', itemCodes: ['PNTBS'], unit: 'LF', qtyField: 'LF' },
              { value: 'finish_1', label: 'Finish only — 1 coat urethane', itemCodes: ['PNTBS1'], unit: 'LF', qtyField: 'LF' },
            ],
          },
          { value: 'bs_stain_5', label: 'Wood 5¼" (Stain Grade)', itemCodes: ['FNCB5'], unit: 'LF', qtyField: 'LF',
            finishOptions: [
              { value: 'none', label: 'No Finish', itemCodes: [] },
              { value: 'seal_1', label: 'Seal + Paint 1 coat', itemCodes: ['PNTB1SP'], unit: 'LF', qtyField: 'LF' },
              { value: 'seal_2', label: 'Seal + Paint 2 coats', itemCodes: ['PNTB2SP'], unit: 'LF', qtyField: 'LF' },
              { value: 'stain', label: 'Stain & Finish', itemCodes: ['PNTBS'], unit: 'LF', qtyField: 'LF' },
              { value: 'finish_1', label: 'Finish only — 1 coat urethane', itemCodes: ['PNTBS1'], unit: 'LF', qtyField: 'LF' },
            ],
          },
          // ── Hardwood — finish: stain OR paint ──
          { value: 'bs_hw_3', label: 'Hardwood 3¼" (plain — grade varies in Xactimate)', itemCodes: ['FNCB3H'], unit: 'LF', qtyField: 'LF',
            finishOptions: [
              { value: 'none', label: 'No Finish', itemCodes: [] },
              { value: 'stain', label: 'Stain & Finish', itemCodes: ['PNTBS'], unit: 'LF', qtyField: 'LF' },
              { value: 'finish_1', label: 'Finish only — 1 coat urethane', itemCodes: ['PNTBS1'], unit: 'LF', qtyField: 'LF' },
              { value: 'seal_2', label: 'Seal + Paint 2 coats', itemCodes: ['PNTB2SP'], unit: 'LF', qtyField: 'LF' },
            ],
          },
          { value: 'bs_hw_5', label: 'Hardwood 5¼" (plain — grade varies in Xactimate)', itemCodes: ['FNCB5H'], unit: 'LF', qtyField: 'LF',
            finishOptions: [
              { value: 'none', label: 'No Finish', itemCodes: [] },
              { value: 'stain', label: 'Stain & Finish', itemCodes: ['PNTBS'], unit: 'LF', qtyField: 'LF' },
              { value: 'finish_1', label: 'Finish only — 1 coat urethane', itemCodes: ['PNTBS1'], unit: 'LF', qtyField: 'LF' },
              { value: 'seal_2', label: 'Seal + Paint 2 coats', itemCodes: ['PNTB2SP'], unit: 'LF', qtyField: 'LF' },
            ],
          },
          // ── Wood Flooring Specific ──
          { value: 'bs_wood_floor', label: 'Baseboard (Wood/Laminate Flooring)', itemCodes: ['FCWLAMB'], unit: 'LF', qtyField: 'LF' },
        ],
      },
      {
        key: 'quarter_round',
        label: 'Quarter Round / Shoe Molding',
        options: [
          { value: 'none', label: 'None', itemCodes: [] },
          { value: 'qr_wood', label: 'Quarter Round (Wood/Laminate)', itemCodes: ['FCWLAMQ'], unit: 'LF', qtyField: 'LF',
            finishOptions: [
              { value: 'none', label: 'No Finish (pre-finished)', itemCodes: [] },
              { value: 'seal_2', label: 'Seal + Paint 2 coats', itemCodes: ['PNTB2SP'], unit: 'LF', qtyField: 'LF' },
              { value: 'stain', label: 'Stain & Finish', itemCodes: ['PNTBS'], unit: 'LF', qtyField: 'LF' },
            ],
          },
          { value: 'qr_pine', label: 'Shoe Molding (Pine)', itemCodes: ['FNC1'], unit: 'LF', qtyField: 'LF',
            finishOptions: [
              { value: 'none', label: 'No Finish', itemCodes: [] },
              { value: 'seal_2', label: 'Seal + Paint 2 coats', itemCodes: ['PNTB2SP'], unit: 'LF', qtyField: 'LF' },
              { value: 'stain', label: 'Stain & Finish', itemCodes: ['PNTBS'], unit: 'LF', qtyField: 'LF' },
            ],
          },
        ],
      },
      {
        key: 'transition',
        label: 'Transitions',
        multiple: true,
        options: [
          // ✅ VERIFIED: FCWLAMR = Reducer strip - for wood flooring (LF $8.98)
          { value: 'reducer', label: 'Reducer Strip', itemCodes: ['FCWLAMR'], unit: 'LF' },
          // ✅ VERIFIED: FCWLAME = End molding - for wood flooring (LF $8.30)
          { value: 'end_mold', label: 'End Molding', itemCodes: ['FCWLAME'], unit: 'LF' },
          // ✅ VERIFIED: FCWLAMS = Stair nosing - for wood flooring (LF $10.11)
          { value: 'stair_nose', label: 'Stair Nosing', itemCodes: ['FCWLAMS'], unit: 'LF' },
          // ✅ VERIFIED: FCVPLKT = T-molding for vinyl plank (LF)
          { value: 't_mold_lvp', label: 'T-Molding (LVP)', itemCodes: ['FCVPLKT'], unit: 'LF' },
          // ✅ VERIFIED: FCVPLKR = Reducer strip for vinyl plank (LF)
          { value: 'reducer_lvp', label: 'Reducer Strip (LVP)', itemCodes: ['FCVPLKR'], unit: 'LF' },
        ],
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // WALL — Repair (drywall/panel repair → texture → paint → molding)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    key: 'wall_repair',
    label: 'Wall — Repair',
    icon: 'BorderOuterOutlined',
    subCategories: [
      {
        key: 'wall_material',
        label: 'Wall Material (Install)',
        options: [
          // ✅ VERIFIED
          { value: 'drywall_half', label: 'Drywall ½" (hung, taped, smooth finish)', itemCodes: ['DRY1'], unit: 'SF', qtyField: 'SF' },
          { value: 'drywall_five_eight', label: 'Drywall ⅝" (hung, taped, smooth finish)', itemCodes: ['DRY5'], unit: 'SF', qtyField: 'SF' },
          { value: 'drywall_patch', label: 'Drywall Patch (small repair, ready for paint)', itemCodes: ['DRYPATCH'], unit: 'EA' },
        ],
      },
      {
        key: 'wall_texture',
        label: 'Wall Texture (after drywall)',
        dependsOn: 'wall_material',
        dependsOnValues: ['drywall_half', 'drywall_five_eight'],
        options: [
          { value: 'smooth', label: 'Smooth (included in drywall install)', itemCodes: [] },
          // ✅ VERIFIED: DRYTEX = Texture drywall - light hand / orange peel (SF $1.86)
          { value: 'orange_peel', label: 'Orange Peel / Light Hand Texture', itemCodes: ['DRYTEX'], unit: 'SF', qtyField: 'SF' },
          // ✅ VERIFIED: DRYTEXMK = Texture drywall - machine knockdown (SF $1.20)
          { value: 'knockdown', label: 'Knockdown Texture', itemCodes: ['DRYTEXMK'], unit: 'SF', qtyField: 'SF' },
        ],
      },
      {
        // Insulation: Required by IRC R401.3 when cavities are exposed during repair.
        // Exterior walls MUST have insulation per climate zone R-value requirements.
        // Water-damaged insulation (Cat 2/3 or >48hrs) must be replaced per IICRC S500.
        key: 'wall_insulation',
        label: 'Insulation (if cavity exposed)',
        options: [
          { value: 'none', label: 'None (interior wall / insulation intact)', itemCodes: [] },
          // ── Fiberglass Batt (most common for walls) ──
          // ✅ VERIFIED
          { value: 'batt_r11', label: 'Fiberglass Batt R-11 (3½" / 2x4 wall)', itemCodes: ['INSBT4'], unit: 'SF', qtyField: 'SF' },
          { value: 'batt_r13', label: 'Fiberglass Batt R-13 (3½" / 2x4 wall)', itemCodes: ['INSBT4'], unit: 'SF', qtyField: 'SF' },
          { value: 'batt_r13_faced', label: 'Fiberglass Batt R-13 Faced (exterior wall)', itemCodes: ['INSBTF4'], unit: 'SF', qtyField: 'SF' },
          { value: 'batt_r19', label: 'Fiberglass Batt R-19 (5½" / 2x6 wall)', itemCodes: ['INSBT6'], unit: 'SF', qtyField: 'SF' },
          { value: 'batt_r21_faced', label: 'Fiberglass Batt R-21 Faced (2x6 ext wall)', itemCodes: ['INSBTF6'], unit: 'SF', qtyField: 'SF' },
          // ── Spray Foam ──
          { value: 'spray_closed', label: 'Spray Foam — Closed Cell (per inch)', itemCodes: ['INSSPF'], unit: 'SF', qtyField: 'SF' },
          { value: 'spray_open_4', label: 'Spray Foam — Open Cell 4"', itemCodes: ['INSSPFOC4'], unit: 'SF', qtyField: 'SF' },
          // ── Rigid Foam Board ──
          { value: 'rigid_1', label: 'Rigid Foam Board 1"', itemCodes: ['INSRBD1'], unit: 'SF', qtyField: 'SF' },
          { value: 'rigid_2', label: 'Rigid Foam Board 2"', itemCodes: ['INSRBD2'], unit: 'SF', qtyField: 'SF' },
        ],
      },
      {
        key: 'wall_paint',
        label: 'Wall Paint',
        options: [
          { value: 'none', label: 'No Paint', itemCodes: [] },
          // ✅ VERIFIED
          { value: 'paint_1coat', label: 'Paint Wall — 1 coat', itemCodes: ['PNTEPXW'], unit: 'SF', qtyField: 'SF' },
          { value: 'paint_2coat', label: 'Paint Wall — 2 coats', itemCodes: ['PNTEPXW2'], unit: 'SF', qtyField: 'SF' },
        ],
      },
      {
        key: 'wall_floor_protection',
        label: 'Floor Protection',
        options: [
          { value: 'none', label: 'None', itemCodes: [] },
          // ✅ VERIFIED: DMOMASKFLP = Cloth, leak-proof, skid-resistant (페인트/드라이월 작업 — 가장 일반적)
          { value: 'cloth', label: 'Cloth — leak-proof, skid-resistant (일반적)', itemCodes: ['DMOMASKFLP'], unit: 'SF', qtyField: 'SF' },
          // ✅ VERIFIED: DMOMASKFP+ = Pro cloth, cleanable (고급/장기 작업)
          { value: 'cloth_pro', label: 'Cloth Pro — cleanable (고급/장기 작업)', itemCodes: ['DMOMASKFP+'], unit: 'SF', qtyField: 'SF' },
          // ✅ VERIFIED: DMOMASKFPB = Breathable cloth (새 하드우드/타일 위)
          { value: 'breathable', label: 'Breathable cloth (새 하드우드/타일 바닥용)', itemCodes: ['DMOMASKFPB'], unit: 'SF', qtyField: 'SF' },
          // ✅ VERIFIED: DMOMASKFL = Self-adhesive film (카펫/비닐 바닥용)
          { value: 'adhesive_film', label: 'Self-adhesive film (카펫/비닐 바닥용)', itemCodes: ['DMOMASKFL'], unit: 'SF', qtyField: 'SF' },
          // ✅ VERIFIED: DMOMASKSFP = Heavy brown masking paper (드라이월/페인트)
          { value: 'paper', label: 'Heavy brown masking paper', itemCodes: ['DMOMASKSFP'], unit: 'SF', qtyField: 'SF' },
          // ✅ VERIFIED: DMOMASKSFC = Cardboard (데몰리션/통행 보호)
          { value: 'cardboard', label: 'Cardboard (데몰리션/통행 보호)', itemCodes: ['DMOMASKSFC'], unit: 'SF', qtyField: 'SF' },
        ],
      },
      {
        key: 'wall_masking',
        label: 'Masking / Dust Cover',
        options: [
          { value: 'none', label: 'None', itemCodes: [] },
          // ✅ VERIFIED: DMOMASKSF = 6 mil plastic sheet (일반 방진 커버)
          { value: 'plastic', label: '6 mil plastic sheet (방진 커버)', itemCodes: ['DMOMASKSF'], unit: 'SF', qtyField: 'SF' },
        ],
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CEILING — Repair (drywall → texture/scrape → paint)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    key: 'ceiling_repair',
    label: 'Ceiling — Repair',
    icon: 'ColumnHeightOutlined',
    subCategories: [
      {
        key: 'ceiling_material',
        label: 'Ceiling Material (Install)',
        options: [
          // ✅ VERIFIED
          { value: 'drywall_half', label: 'Drywall ½"', itemCodes: ['DRY1'], unit: 'SF', qtyField: 'SF' },
          { value: 'drywall_five_eight', label: 'Drywall ⅝"', itemCodes: ['DRY5'], unit: 'SF', qtyField: 'SF' },
        ],
      },
      {
        key: 'ceiling_insulation',
        label: 'Ceiling / Attic Insulation',
        options: [
          { value: 'none', label: 'None (insulation intact or not applicable)', itemCodes: [] },
          // ── Blown-In (most common for attics) ──
          // ✅ VERIFIED
          { value: 'blown_r19', label: 'Blown-in R-19 (8" depth)', itemCodes: ['INSBI8'], unit: 'SF', qtyField: 'SF' },
          { value: 'blown_r30', label: 'Blown-in R-30 (12" depth)', itemCodes: ['INSBI12'], unit: 'SF', qtyField: 'SF' },
          { value: 'blown_r38', label: 'Blown-in R-38 (14" depth)', itemCodes: ['INSBI14'], unit: 'SF', qtyField: 'SF' },
          { value: 'blown_r50', label: 'Blown-in R-50 (20" depth)', itemCodes: ['INSBI20'], unit: 'SF', qtyField: 'SF' },
          // ── Cellulose Blown-In ──
          { value: 'cellulose_r30', label: 'Cellulose Blown-in R-30 (8" depth)', itemCodes: ['INSBIC8'], unit: 'SF', qtyField: 'SF' },
          { value: 'cellulose_r44', label: 'Cellulose Blown-in R-44 (12" depth)', itemCodes: ['INSBIC12'], unit: 'SF', qtyField: 'SF' },
          // ── Fiberglass Batt (cathedral ceilings) ──
          { value: 'batt_r30', label: 'Fiberglass Batt R-30 (10")', itemCodes: ['INSBT10'], unit: 'SF', qtyField: 'SF' },
          { value: 'batt_r38', label: 'Fiberglass Batt R-38 (12")', itemCodes: ['INSBT12'], unit: 'SF', qtyField: 'SF' },
          // ── Spray Foam (cathedral ceilings, unvented attics) ──
          { value: 'spray_open_6', label: 'Spray Foam — Open Cell 6"', itemCodes: ['INSSPFOC6'], unit: 'SF', qtyField: 'SF' },
        ],
      },
      {
        key: 'ceiling_texture',
        label: 'New Ceiling Texture',
        options: [
          { value: 'smooth', label: 'Smooth Finish (included in drywall)', itemCodes: [] },
          // ── Popcorn / Acoustic — 기존 ceiling texture 두께에 맞춰 선택 ──
          // ✅ VERIFIED: DRYAC- = Popcorn - Light coverage (얇은 texture)
          { value: 'popcorn_light', label: 'Popcorn — Light (얇은 기존 texture 매칭)', itemCodes: ['DRYAC-'], unit: 'SF', qtyField: 'SF' },
          // ✅ VERIFIED: DRYAC = Popcorn - Average coverage (일반적)
          { value: 'popcorn', label: 'Popcorn — Average (일반적인 texture)', itemCodes: ['DRYAC'], unit: 'SF', qtyField: 'SF' },
          // ✅ VERIFIED: DRYAC+ = Popcorn - Heavy coverage (두꺼운 texture)
          { value: 'popcorn_heavy', label: 'Popcorn — Heavy (두꺼운 texture 매칭)', itemCodes: ['DRYAC+'], unit: 'SF', qtyField: 'SF' },
          // ── Other textures ──
          // ✅ VERIFIED: DRYTEXMK = Machine knockdown texture (SF $1.20)
          { value: 'knockdown', label: 'Knockdown Texture', itemCodes: ['DRYTEXMK'], unit: 'SF', qtyField: 'SF' },
          // ✅ VERIFIED: DRYTEX = Skim coat / light hand texture (SF $1.86)
          { value: 'skim_coat', label: 'Skim Coat / Light Texture', itemCodes: ['DRYTEX'], unit: 'SF', qtyField: 'SF' },
        ],
      },
      {
        key: 'ceiling_paint',
        label: 'Ceiling Paint',
        options: [
          { value: 'none', label: 'No Paint', itemCodes: [] },
          // ✅ VERIFIED: PNTAC = Seal & paint acoustic ceiling (SF $1.44)
          { value: 'seal_paint', label: 'Seal + Paint (popcorn/textured)', itemCodes: ['PNTAC'], unit: 'SF', qtyField: 'SF' },
          // ✅ VERIFIED: PNTACP = Paint acoustic ceiling - 1 coat (SF $0.96)
          { value: 'paint_1coat', label: 'Paint — 1 coat', itemCodes: ['PNTACP'], unit: 'SF', qtyField: 'SF' },
        ],
      },
      {
        key: 'ceiling_floor_protection',
        label: 'Floor Protection',
        options: [
          { value: 'none', label: 'None', itemCodes: [] },
          { value: 'cloth', label: 'Cloth — leak-proof, skid-resistant (일반적)', itemCodes: ['DMOMASKFLP'], unit: 'SF', qtyField: 'SF' },
          { value: 'cloth_pro', label: 'Cloth Pro — cleanable (고급/장기 작업)', itemCodes: ['DMOMASKFP+'], unit: 'SF', qtyField: 'SF' },
          { value: 'breathable', label: 'Breathable cloth (새 하드우드/타일 바닥용)', itemCodes: ['DMOMASKFPB'], unit: 'SF', qtyField: 'SF' },
          { value: 'adhesive_film', label: 'Self-adhesive film (카펫/비닐 바닥용)', itemCodes: ['DMOMASKFL'], unit: 'SF', qtyField: 'SF' },
          { value: 'paper', label: 'Heavy brown masking paper', itemCodes: ['DMOMASKSFP'], unit: 'SF', qtyField: 'SF' },
          { value: 'cardboard', label: 'Cardboard (데몰리션/통행 보호)', itemCodes: ['DMOMASKSFC'], unit: 'SF', qtyField: 'SF' },
        ],
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TRIM / CASING — Repair & Paint
  // Covers: baseboard repaint after floor work, trim repair, casing paint
  // ═══════════════════════════════════════════════════════════════════════════
  {
    key: 'trim_repair',
    label: 'Trim / Casing — Repair & Paint',
    icon: 'FormatPainterOutlined',
    subCategories: [
      {
        key: 'trim_install',
        label: 'Trim / Molding — Install',
        multiple: true,
        options: [
          // ── Crown Molding Install ──
          { value: 'crown_wood_3', label: 'Crown Molding Wood 3¼"', itemCodes: ['SFGCWNW'], unit: 'LF', qtyField: 'LF',
            finishOptions: [
              { value: 'none', label: 'No Finish', itemCodes: [] },
              { value: 'seal_2', label: 'Seal + Paint 2 coats', itemCodes: ['PNTCWN2SP'], unit: 'LF', qtyField: 'LF' },
              { value: 'stain', label: 'Stain & Finish', itemCodes: ['PNTCWNS'], unit: 'LF', qtyField: 'LF' },
            ],
          },
          { value: 'crown_wood_5', label: 'Crown Molding Wood 5¼"', itemCodes: ['SFGCWNW5'], unit: 'LF', qtyField: 'LF',
            finishOptions: [
              { value: 'none', label: 'No Finish', itemCodes: [] },
              { value: 'seal_2', label: 'Seal + Paint 2 coats', itemCodes: ['PNTCWN2SP'], unit: 'LF', qtyField: 'LF' },
              { value: 'stain', label: 'Stain & Finish', itemCodes: ['PNTCWNS'], unit: 'LF', qtyField: 'LF' },
            ],
          },
          { value: 'crown_pvc', label: 'Crown Molding PVC 4"', itemCodes: ['SFGPCWN4'], unit: 'LF', qtyField: 'LF' },
        ],
      },
      {
        key: 'trim_detach_reset',
        label: 'Trim — Detach & Reset',
        multiple: true,
        options: [
          // ✅ VERIFIED
          { value: 'baseboard_reset', label: 'Baseboard — Detach & Reset', itemCodes: ['FNCBRS'], unit: 'LF', qtyField: 'LF' },
          { value: 'trim_reset', label: 'Trim Board — Detach & Reset', itemCodes: ['FNC1XRS'], unit: 'LF', qtyField: 'LF' },
          { value: 'lvp_trim_reset', label: 'LVP Flooring Trim — Detach & Reset', itemCodes: ['FCVTRIMRS'], unit: 'LF', qtyField: 'LF' },
          { value: 'wood_trim_reset', label: 'Wood Flooring Trim — Detach & Reset', itemCodes: ['FCWTRIMRS'], unit: 'LF', qtyField: 'LF' },
          // ⚠️ CUSTOM: Door Casing D&R — wood floor 교체 시 필수 (바닥 두께 변경)
          { value: 'door_casing_reset', label: 'Door Casing — Detach & Reset (per side)', itemCodes: ['FNCDORCRS_CUSTOM'], unit: 'EA', isCustom: true },
        ],
      },
      {
        key: 'trim_paint_items',
        label: 'Trim / Casing Paint',
        multiple: true,
        options: [
          // ── Baseboard Paint ──
          // ✅ VERIFIED
          { value: 'bs_seal_1', label: 'Baseboard — Seal + Paint 1 coat', itemCodes: ['PNTB1SP'], unit: 'LF', qtyField: 'LF' },
          { value: 'bs_seal_2', label: 'Baseboard — Seal + Paint 2 coats', itemCodes: ['PNTB2SP'], unit: 'LF', qtyField: 'LF' },
          { value: 'bs_paint_2', label: 'Baseboard — Paint 2 coats (no seal)', itemCodes: ['PNTB2'], unit: 'LF', qtyField: 'LF' },
          // ── Door/Window Casing Paint ──
          // ✅ VERIFIED
          { value: 'casing_seal_1', label: 'Casing — Seal + Paint 1 coat', itemCodes: ['PNTC1SP'], unit: 'LF' },
          { value: 'casing_seal_2', label: 'Casing — Seal + Paint 2 coats', itemCodes: ['PNTC2SP'], unit: 'LF' },
          // ── Door Trim + Jamb (per side) ──
          // ✅ VERIFIED
          { value: 'door_trim_sp', label: 'Door/Window Trim + Jamb — Seal + Paint (per side)', itemCodes: ['PNTDORTSP'], unit: 'EA' },
          { value: 'door_trim_2', label: 'Door/Window Trim + Jamb — Paint 2 coats (per side)', itemCodes: ['PNTDORT'], unit: 'EA' },
          // ── Crown Molding Paint ──
          // ✅ VERIFIED
          { value: 'crown_seal_1', label: 'Crown Molding — Seal + Paint 1 coat', itemCodes: ['PNTCWN1SP'], unit: 'LF', qtyField: 'LF' },
          { value: 'crown_seal_2', label: 'Crown Molding — Seal + Paint 2 coats', itemCodes: ['PNTCWN2SP'], unit: 'LF', qtyField: 'LF' },
          // ── Chair Rail ──
          // ✅ VERIFIED
          { value: 'chair_seal_2', label: 'Chair Rail — Seal + Paint 2 coats', itemCodes: ['PNTCHR2SP'], unit: 'LF', qtyField: 'LF' },
          { value: 'chair_stain', label: 'Chair Rail — Stain & Finish', itemCodes: ['PNTCHRS'], unit: 'LF', qtyField: 'LF' },
          // ── Corner Trim ──
          // ✅ VERIFIED
          { value: 'corner_trim_sp', label: 'Corner Trim — Seal + Paint 1 coat', itemCodes: ['PNTCNRSP'], unit: 'LF', qtyField: 'LF' },
        ],
      },
      {
        key: 'trim_floor_protection',
        label: 'Floor Protection',
        options: [
          { value: 'none', label: 'None', itemCodes: [] },
          { value: 'cloth', label: 'Cloth — leak-proof, skid-resistant (일반적)', itemCodes: ['DMOMASKFLP'], unit: 'SF', qtyField: 'SF' },
          { value: 'cloth_pro', label: 'Cloth Pro — cleanable (고급/장기 작업)', itemCodes: ['DMOMASKFP+'], unit: 'SF', qtyField: 'SF' },
          { value: 'breathable', label: 'Breathable cloth (새 하드우드/타일 바닥용)', itemCodes: ['DMOMASKFPB'], unit: 'SF', qtyField: 'SF' },
          { value: 'adhesive_film', label: 'Self-adhesive film (카펫/비닐 바닥용)', itemCodes: ['DMOMASKFL'], unit: 'SF', qtyField: 'SF' },
          { value: 'paper', label: 'Heavy brown masking paper', itemCodes: ['DMOMASKSFP'], unit: 'SF', qtyField: 'SF' },
          { value: 'cardboard', label: 'Cardboard (데몰리션/통행 보호)', itemCodes: ['DMOMASKSFC'], unit: 'SF', qtyField: 'SF' },
        ],
      },
      {
        key: 'trim_masking',
        label: 'Masking / Dust Cover',
        options: [
          { value: 'none', label: 'None', itemCodes: [] },
          { value: 'plastic', label: '6 mil plastic sheet (방진 커버)', itemCodes: ['DMOMASKSF'], unit: 'SF', qtyField: 'SF' },
        ],
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BATHROOM — 통합 카테고리
  // Cheat sheet 순서: D&R Fixtures → Tile Demo → Substrate → Tile Install →
  //   Shower Pan → Fixtures R&R → Drywall → Paint → Accessories
  // ═══════════════════════════════════════════════════════════════════════════
  {
    key: 'bathroom',
    label: 'Bathroom',
    icon: 'ExperimentOutlined',
    applicableRooms: ['bathroom'],
    subCategories: [
      // ── Tile Substrate ──
      {
        key: 'tile_substrate',
        label: 'Substrate / Backer Board',
        multiple: true,
        options: [
          // ✅ VERIFIED: TILBCEM1/2 = 1/2" cement board (wall) (SF $7.22)
          { value: 'cement_board', label: 'Cement Board ½" (wall)', itemCodes: ['TILBCEM1/2'], unit: 'SF' },
          // ✅ VERIFIED: TILBFB1/2T = 1/2" foam backer board w/ thinset (tub/shower) (SF $8~$9.30)
          { value: 'foam_backer', label: 'Foam Backer Board ½" (tub/shower)', itemCodes: ['TILBFB1/2T'], unit: 'SF' },
        ],
      },
      // ── Tub Surround / Shower Package ──
      {
        key: 'tile_package',
        label: 'Tub Surround / Shower (Package)',
        options: [
          { value: 'none', label: 'None (use individual tile below)', itemCodes: [] },
          // ✅ VERIFIED: TILTUB = Tile tub surround - up to 60 SF (EA $1,735~$2,070)
          { value: 'tub_surround_std', label: 'Tub Surround — up to 60 SF (Std)', itemCodes: ['TILTUB'], unit: 'EA' },
          // ✅ VERIFIED: TILTUB+ = Tile tub surround - feature strip
          { value: 'tub_surround_high', label: 'Tub Surround — up to 60 SF (w/ feature strip)', itemCodes: ['TILTUB+'], unit: 'EA' },
          // ✅ VERIFIED: TILTUB> = Tile tub surround - 60-75 SF
          { value: 'tub_surround_lg', label: 'Tub Surround — 60-75 SF (Std)', itemCodes: ['TILTUB>'], unit: 'EA' },
          // ✅ VERIFIED: TILSWR = Tile shower - up to 60 SF (EA $2,012~$3,297)
          { value: 'shower_std', label: 'Shower — up to 60 SF (Std)', itemCodes: ['TILSWR'], unit: 'EA' },
          // ✅ VERIFIED: TILSWR> = Tile shower - 61-100 SF
          { value: 'shower_lg', label: 'Shower — 61-100 SF (Std)', itemCodes: ['TILSWR>'], unit: 'EA' },
        ],
      },
      // ── Wall Tile (Individual) ──
      {
        key: 'tile_wall_items',
        label: 'Wall Tile (Individual)',
        multiple: true,
        options: [
          // ✅ VERIFIED: TILAV = Ceramic/porcelain wall tile (SF $15~$26.54)
          { value: 'tile_wall', label: 'Ceramic/Porcelain Wall Tile', itemCodes: ['TILAV'], unit: 'SF' },
          // ✅ VERIFIED: TILAVB = Bullnose tile edge trim (LF $11.95~$18.56)
          { value: 'bullnose', label: 'Bullnose Edge Trim', itemCodes: ['TILAVB'], unit: 'LF' },
          // ✅ VERIFIED: TILNICHE = Wall niche add-on (EA $252.06)
          { value: 'niche', label: 'Wall Niche (shampoo niche)', itemCodes: ['TILNICHE'], unit: 'EA' },
          // ✅ VERIFIED: TILBENCH = Bench seat add-on (EA $187.79)
          { value: 'bench', label: 'Shower Bench Seat', itemCodes: ['TILBENCH'], unit: 'EA' },
          // ✅ VERIFIED: TILSEALG = Seal grout on tile wall (SF $1.74) — 자주 빠짐!
          { value: 'grout_sealer', label: 'Seal Grout (tile wall)', itemCodes: ['TILSEALG'], unit: 'SF' },
        ],
      },
      // ── Shower Pan ──
      {
        key: 'shower_pan_items',
        label: 'Shower Pan',
        multiple: true,
        options: [
          // ✅ VERIFIED: TILSWRPM = Waterproof membrane (SF $7.90) — shower 필수!
          { value: 'membrane', label: 'Waterproof Membrane (shower 필수!)', itemCodes: ['TILSWRPM'], unit: 'SF' },
          // ✅ VERIFIED: TILSWRPMD = Shower drain (EA $220.01) — 자주 빠짐!
          { value: 'shower_drain', label: 'Shower Drain', itemCodes: ['TILSWRPMD'], unit: 'EA' },
          // ✅ VERIFIED: TILSWRCC = Tile concrete shower curb (LF $150.19)
          { value: 'curb', label: 'Concrete Shower Curb (tile)', itemCodes: ['TILSWRCC'], unit: 'LF' },
        ],
      },
      // ── Shower Door / Tub Enclosure ──
      {
        key: 'door_type',
        label: 'Shower Door / Tub Enclosure',
        options: [
          { value: 'none', label: 'None', itemCodes: [] },
          // ✅ VERIFIED: MSDSDOR = Shower door - Std (EA $483~$1,281)
          { value: 'shower_door_std', label: 'Shower Door — Standard', itemCodes: ['MSDSDOR'], unit: 'EA' },
          // ✅ VERIFIED: MSDSDOR+ = Shower door - High grade
          { value: 'shower_door_high', label: 'Shower Door — High Grade', itemCodes: ['MSDSDOR+'], unit: 'EA' },
          // ✅ VERIFIED: MSDSDOR> = Shower door - corner package
          { value: 'shower_door_corner_pkg', label: 'Shower Door — Corner Package (up to 60")', itemCodes: ['MSDSDOR>'], unit: 'EA' },
          // ✅ VERIFIED: MSDSDORC = Shower door corner unit (EA $1,016~$1,797)
          { value: 'shower_door_corner', label: 'Shower Door — Corner (36")', itemCodes: ['MSDSDORC'], unit: 'EA' },
          // ✅ VERIFIED: MSDTUBDR = Bathtub sliding doors (EA $438~$778)
          { value: 'tub_sliding', label: 'Bathtub Sliding Doors', itemCodes: ['MSDTUBDR'], unit: 'EA' },
          // ✅ VERIFIED: MSDTUBDR+ = Bathtub sliding doors - High
          { value: 'tub_sliding_high', label: 'Bathtub Sliding Doors — High Grade', itemCodes: ['MSDTUBDR+'], unit: 'EA' },
        ],
      },
      {
        key: 'door_dr',
        label: 'Shower Door / Enclosure — D&R',
        multiple: true,
        options: [
          // ✅ VERIFIED: MSDSDOR-RS = Shower door D&R
          { value: 'shower_door_dr', label: 'Shower Door — D&R', itemCodes: ['MSDSDOR-RS'], unit: 'EA' },
          // ✅ VERIFIED: MSDTUBDRRS = Tub enclosure sliding doors D&R
          { value: 'tub_enclosure_dr', label: 'Tub Enclosure Sliding Doors — D&R', itemCodes: ['MSDTUBDRRS'], unit: 'EA' },
        ],
      },
      // ── Plumbing — Toilet ──
      {
        key: 'toilet',
        label: 'Toilet',
        multiple: true,
        options: [
          // ⚠️ CUSTOM: Toilet R&R — 코드는 Xactimate에서 직접 검색
          { value: 'toilet_rr', label: 'Toilet R&R', itemCodes: ['PLMTL_CUSTOM'], unit: 'EA', isCustom: true },
          // ⚠️ CUSTOM: Toilet Seat — 가장 많이 빠짐!
          { value: 'toilet_seat', label: 'Toilet Seat (별도 — 가장 많이 빠짐!)', itemCodes: ['PLMTLSEAT_CUSTOM'], unit: 'EA', isCustom: true },
        ],
      },
      // ── Plumbing — Bathtub ──
      {
        key: 'bathtub',
        label: 'Bathtub / Plumbing',
        multiple: true,
        options: [
          // ⚠️ CUSTOM: Bathtub R&R (acrylic/fiberglass)
          { value: 'bathtub_rr', label: 'Bathtub R&R (acrylic/fiberglass)', itemCodes: ['PLMBTUB_CUSTOM'], unit: 'EA', isCustom: true },
          // ⚠️ CUSTOM: Waste & overflow drain — 거의 항상 빠짐!
          { value: 'waste_overflow', label: 'Waste & Overflow Drain (거의 항상 빠짐!)', itemCodes: ['PLMWO_CUSTOM'], unit: 'EA', isCustom: true },
          // ⚠️ CUSTOM: Tub/shower faucet R&R
          { value: 'tub_faucet', label: 'Tub/Shower Faucet R&R', itemCodes: ['PLMTSFAU_CUSTOM'], unit: 'EA', isCustom: true },
          // ⚠️ CUSTOM: Plumbing supply line (hot+cold) — 자주 빠짐!
          { value: 'supply_line', label: 'Plumbing Supply Line (hot+cold, x2)', itemCodes: ['PLMSUP_CUSTOM'], unit: 'EA', isCustom: true },
          // ⚠️ CUSTOM: P-trap assembly — 자주 빠짐!
          { value: 'ptrap', label: 'P-trap Assembly (자주 빠짐!)', itemCodes: ['PLMPTRAP_CUSTOM'], unit: 'EA', isCustom: true },
        ],
      },
      // ── Plumbing — Sink Faucet ──
      {
        key: 'sink_faucet',
        label: 'Sink Faucet (Bathroom)',
        options: [
          { value: 'none', label: 'None', itemCodes: [] },
          // ✅ VERIFIED: PLMFAUBA = Bathroom sink faucet w/ drain assembly - Std
          { value: 'faucet_std', label: 'Sink Faucet — Standard (chrome)', itemCodes: ['PLMFAUBA'], unit: 'EA' },
          // ✅ VERIFIED: PLMFAUBA+ = High grade
          { value: 'faucet_high', label: 'Sink Faucet — High Grade', itemCodes: ['PLMFAUBA+'], unit: 'EA' },
          // ✅ VERIFIED: PLMFAUBA++ = Premium
          { value: 'faucet_premium', label: 'Sink Faucet — Premium', itemCodes: ['PLMFAUBA++'], unit: 'EA' },
          // ✅ VERIFIED: PLMFAURS = Faucet D&R
          { value: 'faucet_dr', label: 'Sink Faucet — D&R (tile 작업시)', itemCodes: ['PLMFAURS'], unit: 'EA' },
        ],
      },
      // ── Vanity ──
      {
        key: 'vanity_cabinet',
        label: 'Vanity Cabinet',
        options: [
          { value: 'none', label: 'None', itemCodes: [] },
          // ⚠️ CUSTOM: Vanity cabinet R&R
          { value: 'vanity_rr', label: 'Vanity Cabinet R&R', itemCodes: ['CABVAN_CUSTOM'], unit: 'LF', isCustom: true },
        ],
      },
      {
        key: 'vanity_top',
        label: 'Vanity Top',
        options: [
          { value: 'none', label: 'None', itemCodes: [] },
          // ✅ VERIFIED: MBLVTSNK = Cultured marble vanity top w/ sink (LF $112~$167)
          { value: 'marble_std', label: 'Cultured Marble Top w/ Sink — Standard', itemCodes: ['MBLVTSNK'], unit: 'LF' },
          // ✅ VERIFIED: MBLVTSNK+ = Custom colors
          { value: 'marble_custom', label: 'Cultured Marble Top w/ Sink — Custom Color', itemCodes: ['MBLVTSNK+'], unit: 'LF' },
          // ✅ VERIFIED: MBLVTSNK> = Double sink
          { value: 'marble_double', label: 'Cultured Marble Top w/ Double Sink', itemCodes: ['MBLVTSNK>'], unit: 'LF' },
          // ✅ VERIFIED: MBLVTSNKRS = Vanity top D&R
          { value: 'vanity_top_dr', label: 'Vanity Top — D&R', itemCodes: ['MBLVTSNKRS'], unit: 'LF' },
        ],
      },
      // ── Accessories ──
      {
        key: 'accessory_rr',
        label: 'Accessories — Replace (R&R)',
        multiple: true,
        options: [
          // ✅ VERIFIED: FNHBAC = Bath accessory (towel bar, TP holder, etc.) - Std (EA)
          { value: 'accessory_std', label: 'Bath Accessory — Standard (per piece)', itemCodes: ['FNHBAC'], unit: 'EA' },
          // ✅ VERIFIED: FNHBAC+ = High grade
          { value: 'accessory_high', label: 'Bath Accessory — High Grade (per piece)', itemCodes: ['FNHBAC+'], unit: 'EA' },
          // ✅ VERIFIED: FNHTBAR = Towel bar - Std (EA)
          { value: 'towel_bar', label: 'Towel Bar — Standard', itemCodes: ['FNHTBAR'], unit: 'EA' },
          // ✅ VERIFIED: FNHTP = Toilet paper holder (EA)
          { value: 'tp_holder', label: 'Toilet Paper Holder', itemCodes: ['FNHTP'], unit: 'EA' },
        ],
      },
      {
        key: 'accessory_dr',
        label: 'Accessories — D&R',
        multiple: true,
        options: [
          // ✅ VERIFIED: FNHTBARRS = Towel bar D&R
          { value: 'towel_bar_dr', label: 'Towel Bar — D&R', itemCodes: ['FNHTBARRS'], unit: 'EA' },
          // ✅ VERIFIED: FNHTPRS = TP holder D&R
          { value: 'tp_holder_dr', label: 'Toilet Paper Holder — D&R', itemCodes: ['FNHTPRS'], unit: 'EA' },
        ],
      },
      // ── Mirror ──
      {
        key: 'mirror',
        label: 'Mirror',
        options: [
          { value: 'none', label: 'None', itemCodes: [] },
          // ✅ VERIFIED: MSDAV = Mirror plate glass (SF $6.17/SF)
          { value: 'mirror_rr', label: 'Mirror — Replace (plate glass)', itemCodes: ['MSDAV'], unit: 'SF' },
          // ✅ VERIFIED: MSDAVRS = Mirror D&R
          { value: 'mirror_dr', label: 'Mirror — D&R', itemCodes: ['MSDAVRS'], unit: 'SF' },
        ],
      },
      // ── Light Bar ──
      {
        key: 'light_bar',
        label: 'Vanity Light Bar',
        options: [
          { value: 'none', label: 'None', itemCodes: [] },
          // ✅ VERIFIED: LITBAR2 = 2 bulb light bar (EA)
          { value: 'bar_2', label: 'Light Bar — 2 Bulb', itemCodes: ['LITBAR2'], unit: 'EA' },
          // ✅ VERIFIED: LITBAR3 = 3 bulb light bar (EA)
          { value: 'bar_3', label: 'Light Bar — 3 Bulb', itemCodes: ['LITBAR3'], unit: 'EA' },
          // ✅ VERIFIED: LITBAR4 = 4 bulb light bar (EA)
          { value: 'bar_4', label: 'Light Bar — 4 Bulb', itemCodes: ['LITBAR4'], unit: 'EA' },
        ],
      },
      // ── Electrical ──
      {
        key: 'exhaust_fan',
        label: 'Exhaust Fan',
        options: [
          { value: 'none', label: 'None', itemCodes: [] },
          // ✅ VERIFIED: ELEBFANV = Bathroom ventilation fan R&R — Premium (EA $370.28)
          { value: 'fan_rr', label: 'Exhaust Fan R&R (ventilation only)', itemCodes: ['ELEBFANV'], unit: 'EA' },
          // ✅ VERIFIED: ELEBFANL = Bath fan with light R&R — Premium (EA $441.07)
          { value: 'fan_light_rr', label: 'Exhaust Fan + Light R&R', itemCodes: ['ELEBFANL'], unit: 'EA' },
          // ✅ VERIFIED: ELEBFANVRS = Bath fan D&R (EA $85.43) — tile 작업시
          { value: 'fan_dr', label: 'Exhaust Fan — D&R (tile 작업시)', itemCodes: ['ELEBFANVRS'], unit: 'EA' },
        ],
      },
      {
        key: 'gfi_outlet',
        label: 'GFI Outlet',
        options: [
          { value: 'none', label: 'None', itemCodes: [] },
          // ✅ VERIFIED: ELE110G = GFI outlet w/ wiring + box (EA)
          { value: 'gfi_new', label: 'GFI Outlet — New (wiring + box)', itemCodes: ['ELE110G'], unit: 'EA' },
          // ✅ VERIFIED: ELEGFITR = GFI outlet tamper resistant (replace only)
          { value: 'gfi_replace', label: 'GFI Outlet — Replace (tamper resistant)', itemCodes: ['ELEGFITR'], unit: 'EA' },
        ],
      },
    ],
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Flatten all selected item codes from scope selections.
 *
 * `selections` keys are sub-category keys.
 * Finish selections use the convention: `{subKey}__finish__{optionValue}` → finish value
 * Example: baseboard = 'bs_mdf_3', baseboard__finish__bs_mdf_3 = 'seal_2'
 */
export function resolveItemCodes(
  categoryKey: string,
  selections: Record<string, string | string[]>,
  dimensions: { LF?: number; SF?: number },
): Array<{ itemCode: string; qty: number; unit: string; source: string }> {
  const category = SCOPE_CATEGORIES.find((c) => c.key === categoryKey);
  if (!category) return [];

  const result: Array<{ itemCode: string; qty: number; unit: string; source: string }> = [];

  // Process user selections
  for (const sub of category.subCategories) {
    const selected = selections[sub.key];
    if (!selected) continue;

    const values = Array.isArray(selected) ? selected : [selected];
    for (const val of values) {
      const option = sub.options.find((o) => o.value === val);
      if (!option || option.itemCodes.length === 0) continue;

      const qty = option.qtyField ? (dimensions[option.qtyField] || 1) : 1;

      // Add the install item codes
      for (const code of option.itemCodes) {
        result.push({ itemCode: code, qty, unit: option.unit || 'EA', source: sub.label });
      }

      // Check for finish selection
      if (option.finishOptions) {
        const finishKey = `${sub.key}__finish__${val}`;
        const finishVal = selections[finishKey] as string | undefined;
        if (finishVal) {
          const finish = option.finishOptions.find((f) => f.value === finishVal);
          if (finish && finish.itemCodes.length > 0) {
            const finishQty = finish.qtyField ? (dimensions[finish.qtyField] || 1) : qty;
            for (const code of finish.itemCodes) {
              result.push({
                itemCode: code,
                qty: finishQty,
                unit: finish.unit || option.unit || 'EA',
                source: `${sub.label} → ${finish.label}`,
              });
            }
          }
        }
      }
    }
  }

  // Process auto-includes
  if (category.autoIncludes && result.length > 0) {
    for (const ai of category.autoIncludes) {
      const qty = ai.qtyField ? (dimensions[ai.qtyField] || 1) : 1;
      for (const code of ai.itemCodes) {
        result.push({ itemCode: code, qty, unit: ai.unit, source: `Auto: ${ai.label}` });
      }
    }
  }

  return result;
}
