"""
Contents Estimation System
Intelligent estimation of box quantities and materials for furniture contents
Based on fuzzy user input + furniture type + size indicators
"""

from typing import Dict, Tuple, Optional
import re


class ContentsEstimator:
    """
    Estimate contents and calculate appropriate line items
    Handles real-world fuzzy inputs like:
    - "Medium bookshelves + contents"
    - "Extra extra extra large shelves and too much other stuff"
    - "Garage - full of boxes and tools"
    """

    # Furniture types and their typical contents
    FURNITURE_CONTENTS_PROFILES = {
        'bookshelf': {
            'contents_type': 'books',
            'box_type': 'CPS BXBK',  # Book box - best for heavy items
            'base_boxes': {'small': 2, 'medium': 3, 'large': 4, 'xl': 6},
            'items_per_box': 15,  # ~15 books per box
            'packing_minutes_per_box': 9,  # 0.15 hours
            'additional_materials': {
                'TMC PPB': 0.1,  # Packing paper (10% of bundle per box)
            }
        },
        'dresser': {
            'contents_type': 'clothes',
            'box_type': 'CPS BX MED',
            'base_boxes': {'small': 2, 'medium': 3, 'large': 4, 'xl': 5},
            'items_per_box': 20,  # ~20 folded items
            'packing_minutes_per_box': 8,
            'additional_materials': {
                'CPS BWRAP': 5,  # Bubble wrap for delicate items
            }
        },
        'wardrobe': {
            'contents_type': 'hanging_clothes',
            'box_type': 'CPS BXWDR',  # Wardrobe box
            'base_boxes': {'small': 1, 'medium': 2, 'large': 3, 'xl': 4},
            'items_per_box': 24,  # ~24 hanging items
            'packing_minutes_per_box': 6,  # Faster - just hang
            'additional_materials': {}
        },
        'cabinet': {
            'contents_type': 'dishes',
            'box_type': 'TMC BXDISH',  # Dish-pack with separators
            'base_boxes': {'small': 2, 'medium': 3, 'large': 4, 'xl': 5},
            'items_per_box': 12,  # ~12 dishes/plates
            'packing_minutes_per_box': 15,  # More careful packing
            'additional_materials': {
                'TMC PPB': 0.2,
                'TMC BW24': 10,  # Bubble wrap for dishes
            }
        },
        'desk': {
            'contents_type': 'office_supplies',
            'box_type': 'CPS BX MED',
            'base_boxes': {'small': 1, 'medium': 2, 'large': 3, 'xl': 4},
            'items_per_box': 25,
            'packing_minutes_per_box': 8,
            'additional_materials': {
                'CPS BWRAP': 5,
            }
        },
        'shelf': {
            'contents_type': 'general',
            'box_type': 'CPS BX MED',
            'base_boxes': {'small': 2, 'medium': 3, 'large': 5, 'xl': 7},
            'items_per_box': 20,
            'packing_minutes_per_box': 10,
            'additional_materials': {
                'CPS BWRAP': 8,
            }
        },
    }

    # Quantity/fullness indicators
    QUANTITY_MULTIPLIERS = {
        # Explicit quantity words
        'empty': 0.0,
        'few': 0.3,
        'some': 0.5,
        'half': 0.5,
        'mostly': 0.7,
        'full': 1.0,
        'packed': 1.2,
        'stuffed': 1.3,
        'overflowing': 1.5,

        # Intensity words
        'little': 0.4,
        'bit': 0.4,
        'lot': 1.2,
        'lots': 1.2,
        'many': 1.2,
        'tons': 1.4,
        'bunch': 1.2,

        # Vague descriptors
        'stuff': 1.0,
        'things': 1.0,
        'items': 1.0,
    }

    # Size indicators (handle "extra extra large", "xl", etc.)
    SIZE_PATTERNS = {
        'small': r'\b(small|compact|mini|tiny|short)\b',
        'medium': r'\b(medium|standard|regular|mid|average)\b',
        'large': r'\b(large|big|tall)\b',
        'xl': r'\b(xl|x-large|extra\s*large|huge|massive)\b',
    }

    @classmethod
    def estimate_contents(
        cls,
        item_name: str,
        furniture_type: Optional[str] = None,
    ) -> Dict:
        """
        Main estimation function

        Args:
            item_name: Raw user input like "Medium bookshelves + contents"
            furniture_type: Detected furniture type (bookshelf, dresser, etc.)

        Returns:
            {
                'boxes_needed': int,
                'line_items': {code: quantity},
                'packing_hours': float,
                'contents_type': str,
                'confidence': float,
            }
        """
        item_lower = item_name.lower()

        # 1. Detect furniture type if not provided
        if not furniture_type:
            furniture_type = cls._detect_furniture_type(item_lower)

        if not furniture_type or furniture_type not in cls.FURNITURE_CONTENTS_PROFILES:
            return cls._default_estimation(item_name)

        profile = cls.FURNITURE_CONTENTS_PROFILES[furniture_type]

        # 2. Detect size
        size = cls._detect_size(item_lower)

        # 3. Detect quantity/fullness indicators
        quantity_multiplier = cls._detect_quantity_multiplier(item_lower)

        # 4. Calculate boxes needed
        base_boxes = profile['base_boxes'].get(size, profile['base_boxes']['medium'])
        boxes_needed = max(1, round(base_boxes * quantity_multiplier))

        # 5. Calculate line items
        line_items = {
            profile['box_type']: boxes_needed
        }

        # Add additional materials per box
        for material, qty_per_box in profile['additional_materials'].items():
            line_items[material] = round(qty_per_box * boxes_needed, 2)

        # 6. Calculate packing labor
        packing_hours = (profile['packing_minutes_per_box'] * boxes_needed) / 60.0

        # 7. Calculate confidence
        confidence = cls._calculate_confidence(item_name, furniture_type, size, quantity_multiplier)

        return {
            'boxes_needed': boxes_needed,
            'line_items': line_items,
            'packing_hours': round(packing_hours, 2),
            'contents_type': profile['contents_type'],
            'confidence': confidence,
            'reasoning': f"{furniture_type} ({size}) with {quantity_multiplier:.1f}x contents → {boxes_needed} {profile['box_type']} boxes"
        }

    @classmethod
    def _detect_furniture_type(cls, item_lower: str) -> Optional[str]:
        """Detect furniture type from input string"""
        # Priority order - more specific first
        type_keywords = {
            'bookshelf': ['bookshelf', 'bookshelves', 'bookcase', 'bookcases'],
            'wardrobe': ['wardrobe', 'armoire', 'closet'],
            'dresser': ['dresser', 'chest of drawers', 'drawer'],
            'cabinet': ['cabinet', 'cupboard', 'hutch'],
            'desk': ['desk', 'workstation', 'workspace'],
            'shelf': ['shelf', 'shelves', 'shelving', 'rack'],  # Generic, check last
        }

        for furniture_type, keywords in type_keywords.items():
            if any(kw in item_lower for kw in keywords):
                return furniture_type

        return None

    @classmethod
    def _detect_size(cls, item_lower: str) -> str:
        """
        Detect size from input, handling variations like:
        - "extra large"
        - "extra extra large"
        - "xl"
        - "x-large"
        """
        # Count "extra" occurrences
        extra_count = item_lower.count('extra')

        # Check each size pattern
        for size, pattern in cls.SIZE_PATTERNS.items():
            if re.search(pattern, item_lower):
                # Upgrade size based on "extra" count
                if size == 'large' and extra_count >= 1:
                    return 'xl'
                return size

        # Default to medium
        return 'medium'

    @classmethod
    def _detect_quantity_multiplier(cls, item_lower: str) -> float:
        """
        Detect how full/packed the furniture is
        Examples:
        - "full of stuff" → 1.0
        - "packed with books" → 1.2
        - "too much stuff" → 1.3
        - "some items" → 0.5
        """
        multiplier = 1.0  # Default: assume full

        # Check for explicit quantity words
        for word, mult in cls.QUANTITY_MULTIPLIERS.items():
            if word in item_lower:
                multiplier = max(multiplier, mult)  # Take highest

        # Special cases
        if 'too much' in item_lower or 'way too' in item_lower:
            multiplier = max(multiplier, 1.4)

        if 'barely' in item_lower or 'hardly' in item_lower:
            multiplier = min(multiplier, 0.3)

        return multiplier

    @classmethod
    def _calculate_confidence(
        cls,
        item_name: str,
        furniture_type: Optional[str],
        size: str,
        quantity_mult: float
    ) -> float:
        """
        Calculate confidence score (0.0 - 1.0)
        Higher confidence = more explicit information in input
        """
        confidence = 0.5  # Base confidence

        # Bonus for explicit furniture type
        if furniture_type:
            confidence += 0.2

        # Bonus for explicit size
        if size != 'medium':  # Not default
            confidence += 0.1

        # Bonus for explicit quantity indicators
        item_lower = item_name.lower()
        if any(word in item_lower for word in ['full', 'packed', 'empty', 'few', 'lots']):
            confidence += 0.15

        # Penalty for vague terms
        if 'stuff' in item_lower or 'things' in item_lower:
            confidence -= 0.1

        return max(0.3, min(1.0, confidence))  # Clamp between 0.3 and 1.0

    @classmethod
    def _default_estimation(cls, item_name: str) -> Dict:
        """Fallback for unknown furniture types"""
        return {
            'boxes_needed': 2,
            'line_items': {'CPS BX MED': 2, 'CPS BWRAP': 10},
            'packing_hours': 0.3,
            'contents_type': 'general',
            'confidence': 0.3,
            'reasoning': f"Unknown furniture type → default estimation"
        }


# Example usage
if __name__ == "__main__":
    test_cases = [
        "Medium bookshelves + contents",
        "Extra extra extra large shelves and too much other stuff",
        "Small dresser with some clothes",
        "Office desk full of papers",
        "Kitchen cabinet packed with dishes",
        "Wardrobe barely used",
    ]

    for case in test_cases:
        result = ContentsEstimator.estimate_contents(case)
        print(f"\nInput: {case}")
        print(f"→ {result['reasoning']}")
        print(f"  Boxes: {result['boxes_needed']}, Hours: {result['packing_hours']}, Confidence: {result['confidence']:.0%}")
        print(f"  Line items: {result['line_items']}")
