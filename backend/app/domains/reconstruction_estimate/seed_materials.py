"""
Seed material database with default materials from reference data
"""

from decimal import Decimal
from sqlalchemy.orm import Session
from typing import Dict, List

from .models import MaterialCategory, MaterialWeight, UnitType
from .repository import MaterialCategoryRepository, MaterialWeightRepository


# Residential construction material data with realistic weights and moisture absorption rates
# Weight sources: Industry standards, building codes, manufacturer specifications
# Moisture multipliers based on material porosity and water absorption characteristics
SEED_DATA = {
    'flooring': [
        # Wood Flooring - High absorption (25-30% moisture content at saturation)
        {'type': 'hardwood_floor_3_4', 'desc': '3/4" solid hardwood flooring (oak, maple)', 'weight': '2.3', 'unit': 'SF', 'damp': '1.15', 'wet': '1.35', 'sat': '1.6'},
        {'type': 'hardwood_floor_1', 'desc': '1" solid hardwood flooring', 'weight': '3.1', 'unit': 'SF', 'damp': '1.15', 'wet': '1.35', 'sat': '1.6'},
        {'type': 'engineered_hardwood', 'desc': 'Engineered hardwood flooring (3/8"-5/8")', 'weight': '2.0', 'unit': 'SF', 'damp': '1.12', 'wet': '1.25', 'sat': '1.4'},
        {'type': 'parquet_flooring', 'desc': 'Parquet wood flooring', 'weight': '2.4', 'unit': 'SF', 'damp': '1.15', 'wet': '1.35', 'sat': '1.6'},

        # Carpet - Very high absorption (acts as sponge with pad)
        {'type': 'carpet_residential', 'desc': 'Residential carpet (0.5-1 lb/SF)', 'weight': '0.8', 'unit': 'SF', 'damp': '1.4', 'wet': '2.0', 'sat': '2.8'},
        {'type': 'carpet_commercial', 'desc': 'Commercial carpet (heavier weight)', 'weight': '1.2', 'unit': 'SF', 'damp': '1.4', 'wet': '2.0', 'sat': '2.8'},
        {'type': 'carpet_pad_6lb', 'desc': '6lb density carpet pad', 'weight': '0.4', 'unit': 'SF', 'damp': '1.8', 'wet': '2.8', 'sat': '4.0'},
        {'type': 'carpet_pad_8lb', 'desc': '8lb density carpet pad (standard)', 'weight': '0.5', 'unit': 'SF', 'damp': '1.8', 'wet': '2.8', 'sat': '4.0'},
        {'type': 'carpet_with_pad', 'desc': 'Carpet with 8lb pad (combined)', 'weight': '1.7', 'unit': 'SF', 'damp': '1.5', 'wet': '2.2', 'sat': '3.2'},

        # Vinyl - Low absorption (waterproof/water-resistant)
        {'type': 'vinyl_sheet', 'desc': 'Sheet vinyl flooring', 'weight': '1.2', 'unit': 'SF', 'damp': '1.0', 'wet': '1.02', 'sat': '1.05'},
        {'type': 'vinyl_tile', 'desc': 'Vinyl composition tile (VCT)', 'weight': '1.5', 'unit': 'SF', 'damp': '1.0', 'wet': '1.02', 'sat': '1.05'},
        {'type': 'lvp_standard', 'desc': 'Luxury vinyl plank (standard)', 'weight': '1.5', 'unit': 'SF', 'damp': '1.0', 'wet': '1.05', 'sat': '1.08'},
        {'type': 'lvp_thick', 'desc': 'Luxury vinyl plank (thick/premium)', 'weight': '2.0', 'unit': 'SF', 'damp': '1.0', 'wet': '1.05', 'sat': '1.08'},

        # Tile - Very low absorption (non-porous, only grout absorbs)
        {'type': 'ceramic_tile', 'desc': 'Ceramic tile (12x12) with thinset', 'weight': '4.0', 'unit': 'SF', 'damp': '1.05', 'wet': '1.08', 'sat': '1.12'},
        {'type': 'porcelain_tile', 'desc': 'Porcelain tile (12x12) with thinset', 'weight': '4.5', 'unit': 'SF', 'damp': '1.03', 'wet': '1.05', 'sat': '1.08'},
        {'type': 'natural_stone_tile', 'desc': 'Natural stone tile (marble, travertine)', 'weight': '5.5', 'unit': 'SF', 'damp': '1.08', 'wet': '1.15', 'sat': '1.25'},
        {'type': 'tile_grout_only', 'desc': 'Tile grout (1/8" joints)', 'weight': '0.3', 'unit': 'SF', 'damp': '1.2', 'wet': '1.5', 'sat': '1.8'},

        # Laminate - Moderate absorption (core is wood-based)
        {'type': 'laminate_flooring', 'desc': 'Laminate flooring with underlayment', 'weight': '1.5', 'unit': 'SF', 'damp': '1.3', 'wet': '1.8', 'sat': '2.3'},
        {'type': 'laminate_underlayment', 'desc': 'Foam underlayment', 'weight': '0.2', 'unit': 'SF', 'damp': '1.4', 'wet': '2.0', 'sat': '2.8'},

        # Subfloor materials
        {'type': 'plywood_3_4', 'desc': '3/4" plywood subfloor', 'weight': '2.2', 'unit': 'SF', 'damp': '1.15', 'wet': '1.35', 'sat': '1.6'},
        {'type': 'osb_3_4', 'desc': '3/4" OSB subfloor', 'weight': '2.3', 'unit': 'SF', 'damp': '1.2', 'wet': '1.4', 'sat': '1.7'},
        {'type': 'concrete_slab_4', 'desc': '4" concrete slab', 'weight': '50', 'unit': 'SF', 'damp': '1.02', 'wet': '1.05', 'sat': '1.08'},
    ],

    'drywall': [
        # Drywall - High absorption (porous gypsum core)
        {'type': 'drywall_1_4', 'desc': '1/4" gypsum drywall', 'weight': '1.2', 'unit': 'SF', 'damp': '1.3', 'wet': '1.8', 'sat': '2.4'},
        {'type': 'drywall_3_8', 'desc': '3/8" gypsum drywall', 'weight': '1.5', 'unit': 'SF', 'damp': '1.3', 'wet': '1.8', 'sat': '2.4'},
        {'type': 'drywall_1_2', 'desc': '1/2" gypsum drywall (standard)', 'weight': '2.0', 'unit': 'SF', 'damp': '1.3', 'wet': '1.8', 'sat': '2.5'},
        {'type': 'drywall_5_8', 'desc': '5/8" gypsum drywall (fire-rated)', 'weight': '2.5', 'unit': 'SF', 'damp': '1.3', 'wet': '1.8', 'sat': '2.5'},
        {'type': 'drywall_greenboard', 'desc': '1/2" moisture-resistant drywall (green board)', 'weight': '2.1', 'unit': 'SF', 'damp': '1.25', 'wet': '1.6', 'sat': '2.1'},
        {'type': 'drywall_purple', 'desc': '1/2" mold-resistant drywall (purple board)', 'weight': '2.1', 'unit': 'SF', 'damp': '1.2', 'wet': '1.5', 'sat': '1.9'},
        {'type': 'cement_board', 'desc': '1/2" cement backer board', 'weight': '3.0', 'unit': 'SF', 'damp': '1.1', 'wet': '1.2', 'sat': '1.35'},
    ],

    'insulation': [
        # Insulation - Very high absorption (acts as sponge)
        {'type': 'fiberglass_r13', 'desc': 'Fiberglass batt R-13 (3.5")', 'weight': '0.4', 'unit': 'SF', 'damp': '2.0', 'wet': '3.2', 'sat': '4.5'},
        {'type': 'fiberglass_r19', 'desc': 'Fiberglass batt R-19 (6")', 'weight': '0.6', 'unit': 'SF', 'damp': '2.0', 'wet': '3.2', 'sat': '4.5'},
        {'type': 'fiberglass_r30', 'desc': 'Fiberglass batt R-30 (10")', 'weight': '0.9', 'unit': 'SF', 'damp': '2.0', 'wet': '3.2', 'sat': '4.5'},
        {'type': 'cellulose_blown', 'desc': 'Blown cellulose insulation (R-3.5/inch)', 'weight': '0.5', 'unit': 'SF', 'damp': '2.5', 'wet': '4.0', 'sat': '5.5'},
        {'type': 'rockwool_batt', 'desc': 'Mineral wool (rockwool) batt insulation', 'weight': '1.7', 'unit': 'SF', 'damp': '1.8', 'wet': '2.8', 'sat': '4.0'},
        {'type': 'foam_board_1', 'desc': '1" rigid foam insulation board', 'weight': '0.3', 'unit': 'SF', 'damp': '1.05', 'wet': '1.1', 'sat': '1.15'},
        {'type': 'spray_foam_closed', 'desc': 'Closed-cell spray foam (per inch)', 'weight': '0.3', 'unit': 'SF', 'damp': '1.0', 'wet': '1.02', 'sat': '1.05'},
    ],

    'trim': [
        # Wood trim - Moderate absorption
        {'type': 'baseboard_3', 'desc': '3" wood baseboard', 'weight': '0.5', 'unit': 'LF', 'damp': '1.15', 'wet': '1.3', 'sat': '1.55'},
        {'type': 'baseboard_5', 'desc': '5" wood baseboard', 'weight': '0.9', 'unit': 'LF', 'damp': '1.15', 'wet': '1.3', 'sat': '1.55'},
        {'type': 'baseboard_7', 'desc': '7" wood baseboard', 'weight': '1.2', 'unit': 'LF', 'damp': '1.15', 'wet': '1.3', 'sat': '1.55'},
        {'type': 'quarter_round', 'desc': 'Quarter round molding (3/4")', 'weight': '0.15', 'unit': 'LF', 'damp': '1.15', 'wet': '1.3', 'sat': '1.55'},
        {'type': 'crown_molding_4', 'desc': '4" crown molding', 'weight': '0.9', 'unit': 'LF', 'damp': '1.12', 'wet': '1.25', 'sat': '1.45'},
        {'type': 'crown_molding_6', 'desc': '6" crown molding', 'weight': '1.4', 'unit': 'LF', 'damp': '1.12', 'wet': '1.25', 'sat': '1.45'},
        {'type': 'door_casing', 'desc': 'Door casing trim (2.5"-3.5")', 'weight': '0.9', 'unit': 'LF', 'damp': '1.15', 'wet': '1.3', 'sat': '1.55'},
        {'type': 'window_casing', 'desc': 'Window casing trim', 'weight': '0.9', 'unit': 'LF', 'damp': '1.15', 'wet': '1.3', 'sat': '1.55'},
        {'type': 'chair_rail', 'desc': 'Chair rail molding', 'weight': '0.7', 'unit': 'LF', 'damp': '1.15', 'wet': '1.3', 'sat': '1.55'},
        {'type': 'wainscoting_panel', 'desc': 'Wainscoting panel (per SF)', 'weight': '1.5', 'unit': 'SF', 'damp': '1.2', 'wet': '1.4', 'sat': '1.7'},
    ],

    'fixtures': [
        # Fixtures - No absorption (ceramic/porcelain/metal)
        {'type': 'toilet_standard', 'desc': 'Standard toilet (2-piece, ceramic)', 'weight': '85', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'toilet_onepiece', 'desc': 'One-piece toilet (ceramic)', 'weight': '95', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'sink_pedestal', 'desc': 'Pedestal bathroom sink (ceramic)', 'weight': '45', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'sink_undermount', 'desc': 'Undermount bathroom sink (ceramic)', 'weight': '20', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'sink_vessel', 'desc': 'Vessel sink (ceramic/glass)', 'weight': '15', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'sink_kitchen_single', 'desc': 'Single-bowl kitchen sink (stainless)', 'weight': '30', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'sink_kitchen_double', 'desc': 'Double-bowl kitchen sink (stainless)', 'weight': '45', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'bathtub_fiberglass', 'desc': 'Fiberglass bathtub', 'weight': '60', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'bathtub_acrylic', 'desc': 'Acrylic bathtub', 'weight': '75', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'bathtub_cast_iron', 'desc': 'Cast iron bathtub', 'weight': '350', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'shower_base_fiberglass', 'desc': 'Fiberglass shower base (32x32)', 'weight': '50', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'shower_base_tile', 'desc': 'Tile shower base (mortar bed)', 'weight': '150', 'unit': 'EA', 'damp': '1.05', 'wet': '1.1', 'sat': '1.15'},
        {'type': 'shower_door_glass', 'desc': 'Glass shower door', 'weight': '65', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'water_heater_40gal', 'desc': '40-gallon water heater', 'weight': '120', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'water_heater_50gal', 'desc': '50-gallon water heater', 'weight': '140', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
    ],

    'cabinet': [
        # Cabinets - Moderate absorption (wood/particleboard)
        {'type': 'kitchen_base_24', 'desc': '24" kitchen base cabinet', 'weight': '50', 'unit': 'EA', 'damp': '1.15', 'wet': '1.3', 'sat': '1.55'},
        {'type': 'kitchen_base_30', 'desc': '30" kitchen base cabinet', 'weight': '60', 'unit': 'EA', 'damp': '1.15', 'wet': '1.3', 'sat': '1.55'},
        {'type': 'kitchen_base_36', 'desc': '36" kitchen base cabinet (standard)', 'weight': '70', 'unit': 'EA', 'damp': '1.15', 'wet': '1.3', 'sat': '1.55'},
        {'type': 'kitchen_wall_24', 'desc': '24" kitchen wall cabinet', 'weight': '35', 'unit': 'EA', 'damp': '1.15', 'wet': '1.3', 'sat': '1.55'},
        {'type': 'kitchen_wall_30', 'desc': '30" kitchen wall cabinet', 'weight': '42', 'unit': 'EA', 'damp': '1.15', 'wet': '1.3', 'sat': '1.55'},
        {'type': 'kitchen_wall_36', 'desc': '36" kitchen wall cabinet (standard)', 'weight': '50', 'unit': 'EA', 'damp': '1.15', 'wet': '1.3', 'sat': '1.55'},
        {'type': 'vanity_cabinet_24', 'desc': '24" bathroom vanity with countertop', 'weight': '55', 'unit': 'EA', 'damp': '1.2', 'wet': '1.4', 'sat': '1.7'},
        {'type': 'vanity_cabinet_30', 'desc': '30" bathroom vanity with countertop', 'weight': '65', 'unit': 'EA', 'damp': '1.2', 'wet': '1.4', 'sat': '1.7'},
        {'type': 'vanity_cabinet_36', 'desc': '36" bathroom vanity with countertop', 'weight': '75', 'unit': 'EA', 'damp': '1.2', 'wet': '1.4', 'sat': '1.7'},
        {'type': 'vanity_cabinet_48', 'desc': '48" bathroom vanity with countertop', 'weight': '95', 'unit': 'EA', 'damp': '1.2', 'wet': '1.4', 'sat': '1.7'},
        {'type': 'vanity_cabinet_60', 'desc': '60" double vanity with countertop', 'weight': '115', 'unit': 'EA', 'damp': '1.2', 'wet': '1.4', 'sat': '1.7'},
        {'type': 'vanity_cabinet_72', 'desc': '72" double vanity with countertop', 'weight': '135', 'unit': 'EA', 'damp': '1.2', 'wet': '1.4', 'sat': '1.7'},
        {'type': 'linen_cabinet', 'desc': 'Linen cabinet (18"x84")', 'weight': '85', 'unit': 'EA', 'damp': '1.2', 'wet': '1.35', 'sat': '1.6'},
        {'type': 'medicine_cabinet', 'desc': 'Medicine cabinet (recessed)', 'weight': '15', 'unit': 'EA', 'damp': '1.1', 'wet': '1.2', 'sat': '1.3'},
        {'type': 'pantry_cabinet', 'desc': 'Pantry cabinet (24"x84")', 'weight': '120', 'unit': 'EA', 'damp': '1.15', 'wet': '1.3', 'sat': '1.5'},
        {'type': 'kitchen_island', 'desc': 'Kitchen island with cabinets (48"x36")', 'weight': '200', 'unit': 'EA', 'damp': '1.15', 'wet': '1.3', 'sat': '1.5'},
        {'type': 'builtin_bookcase', 'desc': 'Built-in bookcase/shelving (per LF)', 'weight': '35', 'unit': 'LF', 'damp': '1.15', 'wet': '1.25', 'sat': '1.4'},
        {'type': 'closet_organizer_wire', 'desc': 'Wire closet organizer system', 'weight': '15', 'unit': 'LF', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'closet_organizer_wood', 'desc': 'Wood/laminate closet organizer', 'weight': '30', 'unit': 'LF', 'damp': '1.2', 'wet': '1.3', 'sat': '1.5'},

        # Countertops
        {'type': 'countertop_laminate', 'desc': 'Laminate countertop with particleboard', 'weight': '3.5', 'unit': 'SF', 'damp': '1.2', 'wet': '1.5', 'sat': '1.9'},
        {'type': 'countertop_solid_surface', 'desc': 'Solid surface countertop (Corian)', 'weight': '7.5', 'unit': 'SF', 'damp': '1.02', 'wet': '1.05', 'sat': '1.08'},
        {'type': 'countertop_granite', 'desc': 'Granite countertop (3cm/1.25")', 'weight': '18', 'unit': 'SF', 'damp': '1.03', 'wet': '1.06', 'sat': '1.1'},
        {'type': 'countertop_quartz', 'desc': 'Quartz countertop (3cm/1.25")', 'weight': '17', 'unit': 'SF', 'damp': '1.02', 'wet': '1.04', 'sat': '1.06'},
        {'type': 'countertop_marble', 'desc': 'Marble countertop (3cm/1.25")', 'weight': '17', 'unit': 'SF', 'damp': '1.05', 'wet': '1.12', 'sat': '1.2'},
        {'type': 'countertop_butcher_block', 'desc': 'Butcher block wood countertop', 'weight': '5.5', 'unit': 'SF', 'damp': '1.15', 'wet': '1.35', 'sat': '1.6'},
    ],

    'doors': [
        # Doors - Moderate absorption for wood, minimal for metal/fiberglass
        {'type': 'door_interior_hollow', 'desc': 'Hollow core interior door (standard)', 'weight': '35', 'unit': 'EA', 'damp': '1.15', 'wet': '1.3', 'sat': '1.5'},
        {'type': 'door_interior_solid', 'desc': 'Solid core interior door', 'weight': '80', 'unit': 'EA', 'damp': '1.15', 'wet': '1.35', 'sat': '1.6'},
        {'type': 'door_exterior_wood', 'desc': 'Solid wood exterior door', 'weight': '85', 'unit': 'EA', 'damp': '1.15', 'wet': '1.35', 'sat': '1.6'},
        {'type': 'door_exterior_fiberglass', 'desc': 'Fiberglass exterior door', 'weight': '75', 'unit': 'EA', 'damp': '1.05', 'wet': '1.08', 'sat': '1.12'},
        {'type': 'door_exterior_steel', 'desc': 'Steel exterior door (insulated)', 'weight': '95', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'door_sliding_glass', 'desc': 'Sliding glass patio door', 'weight': '150', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'door_french', 'desc': 'French door (double, interior)', 'weight': '140', 'unit': 'EA', 'damp': '1.15', 'wet': '1.3', 'sat': '1.5'},
        {'type': 'door_bifold', 'desc': 'Bi-fold closet door (pair)', 'weight': '45', 'unit': 'EA', 'damp': '1.15', 'wet': '1.3', 'sat': '1.5'},
        {'type': 'door_pocket', 'desc': 'Pocket door with frame', 'weight': '55', 'unit': 'EA', 'damp': '1.15', 'wet': '1.3', 'sat': '1.5'},
        {'type': 'garage_door_single', 'desc': 'Single garage door (9x7)', 'weight': '185', 'unit': 'EA', 'damp': '1.05', 'wet': '1.1', 'sat': '1.15'},
        {'type': 'garage_door_double', 'desc': 'Double garage door (16x7)', 'weight': '325', 'unit': 'EA', 'damp': '1.05', 'wet': '1.1', 'sat': '1.15'},
    ],

    'windows': [
        # Windows - Minimal absorption (glass/metal/vinyl)
        {'type': 'window_double_hung', 'desc': 'Double-hung window (standard 3x4)', 'weight': '55', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'window_casement', 'desc': 'Casement window', 'weight': '50', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'window_sliding', 'desc': 'Sliding window', 'weight': '60', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'window_bay', 'desc': 'Bay window (3-section)', 'weight': '250', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'window_picture', 'desc': 'Picture window (fixed)', 'weight': '85', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'skylight', 'desc': 'Skylight (curb-mounted)', 'weight': '75', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
    ],

    'appliances': [
        # Appliances - No absorption (metal/plastic)
        {'type': 'refrigerator', 'desc': 'Refrigerator (standard)', 'weight': '250', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'range_electric', 'desc': 'Electric range/stove', 'weight': '150', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'range_gas', 'desc': 'Gas range/stove', 'weight': '135', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'dishwasher', 'desc': 'Built-in dishwasher', 'weight': '85', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'microwave', 'desc': 'Over-range microwave', 'weight': '65', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'washer_front_load', 'desc': 'Front-load washing machine', 'weight': '225', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'washer_top_load', 'desc': 'Top-load washing machine', 'weight': '180', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'dryer_electric', 'desc': 'Electric dryer', 'weight': '120', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'dryer_gas', 'desc': 'Gas dryer', 'weight': '130', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'garbage_disposal', 'desc': 'Garbage disposal unit', 'weight': '15', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
    ],

    'hvac': [
        # HVAC equipment - Minimal absorption (metal)
        {'type': 'furnace_gas', 'desc': 'Gas furnace (80% efficiency)', 'weight': '175', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'ac_condenser_2ton', 'desc': 'AC condenser unit (2-ton)', 'weight': '125', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'ac_condenser_3ton', 'desc': 'AC condenser unit (3-ton)', 'weight': '165', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'air_handler', 'desc': 'Air handler unit', 'weight': '95', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'ductwork', 'desc': 'Metal ductwork (per LF)', 'weight': '3.5', 'unit': 'LF', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
    ],
}


def seed_materials(db: Session) -> Dict[str, int]:
    """Seed material database with default materials

    Returns:
        Dictionary with counts of created categories and materials
    """
    category_repo = MaterialCategoryRepository(db)
    material_repo = MaterialWeightRepository(db)

    stats = {'categories': 0, 'materials': 0, 'skipped': 0}

    # Create categories with display order
    category_map = {}
    display_order = 0

    for category_name in SEED_DATA.keys():
        # Check if category already exists (with title case)
        category_title = category_name.title()
        existing = category_repo.get_by_name(category_title)
        if existing:
            category_map[category_name] = existing
            continue

        # Create category
        category = MaterialCategory(
            category_name=category_title,
            display_order=display_order,
            active=True
        )
        db.add(category)
        db.flush()  # Flush to get ID
        category_map[category_name] = category
        stats['categories'] += 1
        display_order += 1

    # Create materials
    for category_name, materials in SEED_DATA.items():
        category = category_map[category_name]

        for material_data in materials:
            # Check if material already exists
            existing = material_repo.get_by_material_type(material_data['type'])
            if existing:
                stats['skipped'] += 1
                continue

            # Create material
            material = MaterialWeight(
                material_type=material_data['type'],
                category_id=category.id,
                description=material_data['desc'],
                dry_weight_per_unit=Decimal(material_data['weight']),
                unit=UnitType[material_data['unit']],
                damp_multiplier=Decimal(material_data['damp']),
                wet_multiplier=Decimal(material_data['wet']),
                saturated_multiplier=Decimal(material_data['sat']),
                active=True
            )
            db.add(material)  # Add without committing
            stats['materials'] += 1

    return stats


def main():
    """Run seeding script"""
    from app.core.database_factory import get_database
    from sqlalchemy.orm import Session

    database = get_database()
    engine = database.engine
    db = Session(bind=engine)

    try:
        print("Starting material database seeding...")
        stats = seed_materials(db)
        print(f"Created {stats['categories']} categories")
        print(f"Created {stats['materials']} materials")
        if stats['skipped'] > 0:
            print(f"Skipped {stats['skipped']} existing materials")
        print("Seeding completed successfully!")
    except Exception as e:
        print(f"Error during seeding: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
