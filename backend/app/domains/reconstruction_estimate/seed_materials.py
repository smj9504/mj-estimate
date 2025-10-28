"""
Seed material database with default materials from reference data
"""

from decimal import Decimal
from sqlalchemy.orm import Session
from typing import Dict, List

from .models import MaterialCategory, MaterialWeight, UnitType
from .repository import MaterialCategoryRepository, MaterialWeightRepository


# Material data from reference/estimator/debris/materials.py
SEED_DATA = {
    'flooring': [
        {'type': 'hardwood_floor', 'desc': '3/4" solid hardwood flooring', 'weight': '2.5', 'unit': 'SF', 'damp': '1.3', 'wet': '1.6', 'sat': '2.0'},
        {'type': 'engineered_hardwood', 'desc': 'Engineered hardwood flooring', 'weight': '2.0', 'unit': 'SF', 'damp': '1.3', 'wet': '1.5', 'sat': '1.8'},
        {'type': 'carpet_with_pad', 'desc': 'Carpet with 8lb pad', 'weight': '1.8', 'unit': 'SF', 'damp': '1.5', 'wet': '2.5', 'sat': '3.0'},
        {'type': 'vinyl_plank', 'desc': 'Luxury vinyl plank (LVP)', 'weight': '1.5', 'unit': 'SF', 'damp': '1.1', 'wet': '1.2', 'sat': '1.3'},
        {'type': 'tile_floor_ceramic', 'desc': 'Ceramic tile with thinset', 'weight': '4.0', 'unit': 'SF', 'damp': '1.1', 'wet': '1.2', 'sat': '1.3'},
        {'type': 'tile_floor_porcelain', 'desc': 'Porcelain tile with thinset', 'weight': '4.5', 'unit': 'SF', 'damp': '1.1', 'wet': '1.2', 'sat': '1.3'},
        {'type': 'laminate_flooring', 'desc': 'Laminate flooring with underlayment', 'weight': '1.5', 'unit': 'SF', 'damp': '1.4', 'wet': '1.8', 'sat': '2.2'},
    ],
    'trim': [
        {'type': 'baseboard', 'desc': 'Standard wood baseboard (3-5")', 'weight': '0.8', 'unit': 'LF', 'damp': '1.3', 'wet': '1.5', 'sat': '1.8'},
        {'type': 'quarter_round', 'desc': 'Quarter round molding', 'weight': '0.15', 'unit': 'LF', 'damp': '1.3', 'wet': '1.5', 'sat': '1.8'},
        {'type': 'crown_molding', 'desc': 'Crown molding (4-6")', 'weight': '1.2', 'unit': 'LF', 'damp': '1.2', 'wet': '1.4', 'sat': '1.6'},
        {'type': 'door_casing', 'desc': 'Door casing trim', 'weight': '0.9', 'unit': 'LF', 'damp': '1.3', 'wet': '1.5', 'sat': '1.8'},
        {'type': 'window_casing', 'desc': 'Window casing trim', 'weight': '0.9', 'unit': 'LF', 'damp': '1.3', 'wet': '1.5', 'sat': '1.8'},
    ],
    'fixtures': [
        {'type': 'toilet', 'desc': 'Standard toilet (ceramic)', 'weight': '85', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'sink_bathroom', 'desc': 'Bathroom sink (ceramic/porcelain)', 'weight': '25', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'bathtub_standard', 'desc': 'Standard bathtub (cast iron or acrylic)', 'weight': '250', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
        {'type': 'shower_base', 'desc': 'Shower base/pan (fiberglass or acrylic)', 'weight': '65', 'unit': 'EA', 'damp': '1.0', 'wet': '1.0', 'sat': '1.0'},
    ],
    'cabinet': [
        {'type': 'kitchen_base_cabinet', 'desc': 'Kitchen base cabinet (3ft avg)', 'weight': '65', 'unit': 'EA', 'damp': '1.15', 'wet': '1.3', 'sat': '1.5'},
        {'type': 'kitchen_wall_cabinet', 'desc': 'Kitchen wall cabinet (3ft avg)', 'weight': '45', 'unit': 'EA', 'damp': '1.15', 'wet': '1.3', 'sat': '1.5'},
        {'type': 'vanity_cabinet_24', 'desc': '24" bathroom vanity with countertop', 'weight': '55', 'unit': 'EA', 'damp': '1.2', 'wet': '1.4', 'sat': '1.7'},
        {'type': 'vanity_cabinet_36', 'desc': '36" bathroom vanity with countertop', 'weight': '75', 'unit': 'EA', 'damp': '1.2', 'wet': '1.4', 'sat': '1.7'},
        {'type': 'vanity_cabinet_48', 'desc': '48" bathroom vanity with countertop', 'weight': '95', 'unit': 'EA', 'damp': '1.2', 'wet': '1.4', 'sat': '1.7'},
        {'type': 'vanity_cabinet_60', 'desc': '60" double vanity with countertop', 'weight': '115', 'unit': 'EA', 'damp': '1.2', 'wet': '1.4', 'sat': '1.7'},
        {'type': 'linen_cabinet', 'desc': 'Linen cabinet (18"x84" avg)', 'weight': '85', 'unit': 'EA', 'damp': '1.2', 'wet': '1.35', 'sat': '1.6'},
        {'type': 'medicine_cabinet', 'desc': 'Medicine cabinet', 'weight': '15', 'unit': 'EA', 'damp': '1.1', 'wet': '1.2', 'sat': '1.3'},
        {'type': 'pantry_cabinet', 'desc': 'Full-height pantry cabinet (24"x84" avg)', 'weight': '120', 'unit': 'EA', 'damp': '1.15', 'wet': '1.3', 'sat': '1.5'},
        {'type': 'kitchen_island', 'desc': 'Kitchen island with cabinets (4ft x 3ft avg)', 'weight': '200', 'unit': 'EA', 'damp': '1.15', 'wet': '1.3', 'sat': '1.5'},
        {'type': 'builtin_bookcase', 'desc': 'Built-in bookcase/shelving per LF', 'weight': '35', 'unit': 'LF', 'damp': '1.15', 'wet': '1.25', 'sat': '1.4'},
        {'type': 'closet_organizer', 'desc': 'Wire or laminate closet organizer', 'weight': '25', 'unit': 'LF', 'damp': '1.2', 'wet': '1.3', 'sat': '1.5'},
        {'type': 'countertop_laminate', 'desc': 'Laminate countertop with particleboard', 'weight': '3.5', 'unit': 'SF', 'damp': '1.1', 'wet': '1.2', 'sat': '1.3'},
        {'type': 'countertop_granite', 'desc': 'Granite countertop (3cm thick)', 'weight': '18', 'unit': 'SF', 'damp': '1.05', 'wet': '1.1', 'sat': '1.15'},
        {'type': 'countertop_quartz', 'desc': 'Quartz countertop (3cm thick)', 'weight': '17', 'unit': 'SF', 'damp': '1.05', 'wet': '1.1', 'sat': '1.15'},
    ],
    'drywall': [
        {'type': 'drywall_half_inch', 'desc': '1/2" gypsum drywall', 'weight': '2.0', 'unit': 'SF', 'damp': '1.3', 'wet': '1.8', 'sat': '2.5'},
        {'type': 'drywall_five_eighths', 'desc': '5/8" gypsum drywall', 'weight': '2.5', 'unit': 'SF', 'damp': '1.3', 'wet': '1.8', 'sat': '2.5'},
    ],
    'insulation': [
        {'type': 'insulation_fiberglass', 'desc': 'Fiberglass batt insulation (R-13 to R-19)', 'weight': '0.5', 'unit': 'SF', 'damp': '2.0', 'wet': '3.0', 'sat': '4.0'},
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
        # Check if category already exists
        existing = category_repo.get_by_name(category_name)
        if existing:
            category_map[category_name] = existing
            continue

        # Create category
        category = MaterialCategory(
            category_name=category_name.title(),
            display_order=display_order,
            active=True
        )
        category = category_repo.create(category)
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
            material_repo.create(material)
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
