"""
Room Template System
Provides pre-built room configurations for quick pack calculation
"""

from .base_template import (
    RoomTemplate,
    TemplateItem,
    StorageMultiplier,
    DensityModifier,
    RoomType,
    DensityLevel
)
from .registry import TemplateRegistry, template_registry
from .kitchen import KITCHEN_TEMPLATE
from .bedroom import BEDROOM_TEMPLATE

__all__ = [
    'RoomTemplate',
    'TemplateItem',
    'StorageMultiplier',
    'DensityModifier',
    'RoomType',
    'DensityLevel',
    'TemplateRegistry',
    'template_registry',
    'KITCHEN_TEMPLATE',
    'BEDROOM_TEMPLATE',
]
