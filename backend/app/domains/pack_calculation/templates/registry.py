"""
Template Registry
Central registry for all room templates
"""

from typing import Dict, List, Optional
from .base_template import RoomTemplate, RoomType
from .kitchen import KITCHEN_TEMPLATE
from .bedroom import BEDROOM_TEMPLATE


class TemplateRegistry:
    """Registry for managing room templates"""

    def __init__(self):
        self._templates: Dict[RoomType, RoomTemplate] = {}
        self._register_default_templates()

    def _register_default_templates(self):
        """Register all default templates"""
        self.register(KITCHEN_TEMPLATE)
        self.register(BEDROOM_TEMPLATE)

    def register(self, template: RoomTemplate):
        """Register a new template"""
        self._templates[template.room_type] = template

    def get(self, room_type: RoomType) -> Optional[RoomTemplate]:
        """Get template by room type"""
        return self._templates.get(room_type)

    def list_all(self) -> List[RoomTemplate]:
        """List all available templates"""
        return list(self._templates.values())

    def get_summary(self) -> List[Dict]:
        """Get summary of all templates (for API response)"""
        return [
            {
                "id": template.id,
                "room_type": template.room_type.value,
                "name": template.name,
                "description": template.description,
                "item_count": len(template.base_items),
                "has_storage_multipliers": len(template.storage_multipliers) > 0,
                "supported_density_levels": [
                    modifier.density_level.value
                    for modifier in template.density_modifiers
                ]
            }
            for template in self._templates.values()
        ]


# Global registry instance
template_registry = TemplateRegistry()
