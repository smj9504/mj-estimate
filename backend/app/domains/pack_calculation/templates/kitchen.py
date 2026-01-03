"""
Kitchen Room Template
Standard residential kitchen with cabinets, appliances, and pantry
"""

from .base_template import (
    RoomTemplate,
    TemplateItem,
    StorageMultiplier,
    DensityModifier,
    RoomType,
    DensityLevel
)


KITCHEN_TEMPLATE = RoomTemplate(
    id="kitchen_standard",
    room_type=RoomType.KITCHEN,
    name="Standard Kitchen",
    description="Typical residential kitchen with cabinets, appliances, and pantry",

    base_items=[
        # Visible items (countertop, table)
        TemplateItem(
            category="Kitchen Items",
            subcategory="Small Appliances",
            base_quantity=3,  # toaster, coffee maker, mixer
            variance_range=(2, 6),
            pack_size=1,
            is_optional=False,
            storage_type="visible"
        ),
        TemplateItem(
            category="Kitchen Items",
            subcategory="Pots & Pans",
            base_quantity=8,
            variance_range=(5, 15),
            pack_size=1,
            is_optional=False,
            storage_type="cabinet"
        ),
        TemplateItem(
            category="Dishes",
            subcategory="Plates",
            base_quantity=12,
            variance_range=(8, 24),
            pack_size=4,  # 4 plates per box
            is_optional=False,
            storage_type="cabinet"
        ),
        TemplateItem(
            category="Dishes",
            subcategory="Bowls",
            base_quantity=12,
            variance_range=(6, 20),
            pack_size=4,
            is_optional=False,
            storage_type="cabinet"
        ),
        TemplateItem(
            category="Dishes",
            subcategory="Glasses & Cups",
            base_quantity=16,
            variance_range=(8, 32),
            pack_size=4,
            is_optional=False,
            storage_type="cabinet"
        ),
        TemplateItem(
            category="Kitchen Items",
            subcategory="Utensils & Silverware",
            base_quantity=24,
            variance_range=(16, 40),
            pack_size=8,  # bundle utensils
            is_optional=False,
            storage_type="drawer"
        ),
        TemplateItem(
            category="Kitchen Items",
            subcategory="Cooking Utensils",
            base_quantity=15,
            variance_range=(10, 25),
            pack_size=4,
            is_optional=False,
            storage_type="drawer"
        ),
        TemplateItem(
            category="Food Items",
            subcategory="Pantry Contents",
            base_quantity=30,
            variance_range=(15, 60),
            pack_size=8,
            is_optional=False,
            storage_type="cabinet"
        ),
    ],

    storage_multipliers=[
        StorageMultiplier(
            storage_type="kitchen_cabinets",
            base_count=10,  # typical kitchen has 10-15 cabinets
            items_per_unit=8,  # REDUCED: was 12, average items per cabinet (already accounts for packing efficiency)
            density_impact={
                DensityLevel.MINIMAL: 0.3,
                DensityLevel.MODERATE: 0.75,
                DensityLevel.FULL: 1.0,
                DensityLevel.PACKED: 1.3
            }
        ),
        StorageMultiplier(
            storage_type="pantry",
            base_count=1,
            items_per_unit=25,  # REDUCED: was 40, pantry holds more (pre-packed efficiency)
            density_impact={
                DensityLevel.MINIMAL: 0.2,
                DensityLevel.MODERATE: 0.7,
                DensityLevel.FULL: 1.0,
                DensityLevel.PACKED: 1.5
            }
        ),
        StorageMultiplier(
            storage_type="drawers",
            base_count=6,
            items_per_unit=10,  # REDUCED: was 15, items per drawer (bundled packing)
            density_impact={
                DensityLevel.MINIMAL: 0.3,
                DensityLevel.MODERATE: 0.7,
                DensityLevel.FULL: 1.0,
                DensityLevel.PACKED: 1.2
            }
        ),
    ],

    density_modifiers=[
        DensityModifier(
            density_level=DensityLevel.MINIMAL,
            quantity_multiplier=0.4,
            additional_categories=[]  # no extras
        ),
        DensityModifier(
            density_level=DensityLevel.MODERATE,
            quantity_multiplier=1.0,
            additional_categories=["Food Storage Containers", "Baking Supplies"]
        ),
        DensityModifier(
            density_level=DensityLevel.FULL,
            quantity_multiplier=1.3,
            additional_categories=[
                "Food Storage Containers",
                "Baking Supplies",
                "Specialty Appliances",
                "Extra Dishes"
            ]
        ),
        DensityModifier(
            density_level=DensityLevel.PACKED,
            quantity_multiplier=1.7,
            additional_categories=[
                "Food Storage Containers",
                "Baking Supplies",
                "Specialty Appliances",
                "Extra Dishes",
                "Collectibles",
                "Bulk Food Storage"
            ]
        ),
    ]
)
