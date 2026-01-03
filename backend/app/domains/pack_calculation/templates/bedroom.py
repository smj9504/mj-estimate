"""
Bedroom Room Template
Standard bedroom with closet, dresser, and personal items
"""

from .base_template import (
    RoomTemplate,
    TemplateItem,
    StorageMultiplier,
    DensityModifier,
    RoomType,
    DensityLevel
)


BEDROOM_TEMPLATE = RoomTemplate(
    id="bedroom_standard",
    room_type=RoomType.BEDROOM,
    name="Standard Bedroom",
    description="Typical bedroom with closet, dresser, and personal items",

    base_items=[
        # Clothing items
        TemplateItem(
            category="Clothing",
            subcategory="Hanging Clothes",
            base_quantity=30,
            variance_range=(15, 60),
            pack_size=10,  # 10 hanging items per box
            is_optional=False,
            storage_type="closet"
        ),
        TemplateItem(
            category="Clothing",
            subcategory="Folded Clothes",
            base_quantity=40,
            variance_range=(20, 80),
            pack_size=10,
            is_optional=False,
            storage_type="drawer"
        ),
        TemplateItem(
            category="Shoes",
            subcategory="Pairs of Shoes",
            base_quantity=12,
            variance_range=(6, 30),
            pack_size=2,  # 2 pairs per box
            is_optional=False,
            storage_type="closet"
        ),
        TemplateItem(
            category="Linens",
            subcategory="Bed Sheets & Pillowcases",
            base_quantity=4,
            variance_range=(2, 8),
            pack_size=2,
            is_optional=False,
            storage_type="closet"
        ),
        TemplateItem(
            category="Linens",
            subcategory="Blankets & Comforters",
            base_quantity=3,
            variance_range=(2, 6),
            pack_size=1,
            is_optional=False,
            storage_type="closet"
        ),
        TemplateItem(
            category="Personal Items",
            subcategory="Accessories",
            base_quantity=20,
            variance_range=(10, 40),
            pack_size=8,
            is_optional=True,
            storage_type="drawer"
        ),
    ],

    storage_multipliers=[
        StorageMultiplier(
            storage_type="closet",
            base_count=1,  # typical bedroom has 1 closet
            items_per_unit=50,
            density_impact={
                DensityLevel.MINIMAL: 0.3,
                DensityLevel.MODERATE: 0.8,
                DensityLevel.FULL: 1.0,
                DensityLevel.PACKED: 1.4
            }
        ),
        StorageMultiplier(
            storage_type="dresser_drawers",
            base_count=6,  # typical dresser has 6 drawers
            items_per_unit=12,
            density_impact={
                DensityLevel.MINIMAL: 0.3,
                DensityLevel.MODERATE: 0.7,
                DensityLevel.FULL: 1.0,
                DensityLevel.PACKED: 1.3
            }
        ),
        StorageMultiplier(
            storage_type="nightstand_drawers",
            base_count=2,  # 2 nightstands with drawers
            items_per_unit=8,
            density_impact={
                DensityLevel.MINIMAL: 0.2,
                DensityLevel.MODERATE: 0.6,
                DensityLevel.FULL: 1.0,
                DensityLevel.PACKED: 1.2
            }
        ),
    ],

    density_modifiers=[
        DensityModifier(
            density_level=DensityLevel.MINIMAL,
            quantity_multiplier=0.4,
            additional_categories=[]
        ),
        DensityModifier(
            density_level=DensityLevel.MODERATE,
            quantity_multiplier=1.0,
            additional_categories=["Books", "Personal Care Items"]
        ),
        DensityModifier(
            density_level=DensityLevel.FULL,
            quantity_multiplier=1.4,
            additional_categories=[
                "Books",
                "Personal Care Items",
                "Electronics",
                "Decorations"
            ]
        ),
        DensityModifier(
            density_level=DensityLevel.PACKED,
            quantity_multiplier=1.8,
            additional_categories=[
                "Books",
                "Personal Care Items",
                "Electronics",
                "Decorations",
                "Collectibles",
                "Storage Bins"
            ]
        ),
    ]
)
