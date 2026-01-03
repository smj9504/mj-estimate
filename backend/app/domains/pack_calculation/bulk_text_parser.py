"""
Bulk Text Parser for Pack Calculation

Parses various text formats into structured pack items with intelligent
category inference and pack size calculation.

Supports multiple quantity formats:
- "5 plates", "5x plates"
- "plates x5", "plates (5)"
- "coffee maker" (default quantity 1)

Features:
- Smart category inference based on keywords
- Intelligent pack size calculation
- Error handling for unparseable lines
- Confidence scoring for parsed results
"""

import re
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass


@dataclass
class ParsedItem:
    """Structured representation of a parsed item"""
    category: str
    subcategory: str
    quantity: int
    pack_size: int
    original_text: str
    confidence: float


class BulkTextParser:
    """
    Robust bulk text parser for pack calculation.

    Handles various text formats and infers categories and pack sizes
    based on item keywords and characteristics.
    """

    # Category inference keywords
    CATEGORY_KEYWORDS = {
        "kitchen": {
            "keywords": [
                "pot", "pan", "dish", "plate", "bowl", "cup", "glass", "mug",
                "utensil", "fork", "knife", "knives", "spoon", "spoons", "forks",
                "spatula", "ladle", "pitcher", "platter", "saucer", "coffee maker",
                "blender", "toaster", "kettle", "cookware", "dinnerware", "glassware",
                "cutting board", "whisk", "measuring cup", "colander", "plates",
                "bowls", "cups", "glasses", "dishes"
            ],
            "subcategories": {
                "dishes": ["dish", "dishes", "plate", "plates", "bowl", "bowls", "saucer", "platter"],
                "glassware": ["glass", "glasses", "cup", "cups", "mug", "pitcher"],
                "cookware": ["pot", "pan", "skillet", "wok", "dutch oven"],
                "utensils": ["fork", "forks", "knife", "knives", "spoon", "spoons", "spatula", "ladle", "whisk"],
                "appliances": ["coffee maker", "blender", "toaster", "kettle", "microwave"]
            }
        },
        "clothing": {
            "keywords": [
                "shirt", "pants", "dress", "jacket", "coat", "sweater",
                "jeans", "blouse", "skirt", "suit", "uniform", "hoodie",
                "t-shirt", "polo", "shorts", "slacks", "blazer"
            ],
            "subcategories": {
                "tops": ["shirt", "blouse", "sweater", "hoodie", "t-shirt", "polo", "blazer"],
                "bottoms": ["pants", "jeans", "shorts", "slacks", "skirt"],
                "outerwear": ["jacket", "coat"],
                "formal": ["dress", "suit", "uniform"]
            }
        },
        "shoes": {
            "keywords": [
                "shoe", "boot", "sneaker", "sandal", "slipper", "heel",
                "loafer", "oxford", "pump", "flip-flop", "athletic shoe",
                "dress shoe", "running shoe"
            ],
            "subcategories": {
                "casual": ["sneaker", "sandal", "slipper", "flip-flop"],
                "formal": ["heel", "loafer", "oxford", "pump", "dress shoe"],
                "athletic": ["running shoe", "athletic shoe"],
                "boots": ["boot"]
            }
        },
        "electronics": {
            "keywords": [
                "tv", "television", "computer", "laptop", "monitor", "tablet",
                "phone", "speaker", "headphones", "camera", "printer", "router",
                "gaming console", "keyboard", "mouse", "charger", "cable"
            ],
            "subcategories": {
                "displays": ["tv", "television", "monitor"],
                "computers": ["computer", "laptop", "tablet"],
                "peripherals": ["keyboard", "mouse", "printer", "router"],
                "entertainment": ["gaming console", "speaker", "headphones", "camera"]
            }
        },
        "books": {
            "keywords": [
                "book", "novel", "textbook", "magazine", "journal",
                "encyclopedia", "dictionary", "cookbook", "manual"
            ],
            "subcategories": {
                "books": ["book", "novel", "textbook", "encyclopedia", "dictionary"],
                "periodicals": ["magazine", "journal"]
            }
        },
        "linens": {
            "keywords": [
                "towel", "towels", "sheet", "sheets", "blanket", "pillow", "pillows",
                "pillowcase", "comforter", "duvet", "bedspread", "tablecloth", "napkin",
                "bath mat", "washcloth"
            ],
            "subcategories": {
                "bedding": ["sheet", "blanket", "comforter", "duvet", "bedspread", "pillow", "pillowcase"],
                "bath": ["towel", "bath mat", "washcloth"],
                "table": ["tablecloth", "napkin"]
            }
        },
        "toys": {
            "keywords": [
                "toy", "doll", "action figure", "puzzle", "game", "lego",
                "stuffed animal", "board game", "video game", "ball"
            ],
            "subcategories": {
                "toys": ["toy", "doll", "action figure", "stuffed animal"],
                "games": ["puzzle", "game", "board game", "video game", "lego"]
            }
        },
        "office": {
            "keywords": [
                "pen", "pencil", "notebook", "paper", "folder", "binder",
                "stapler", "scissors", "tape", "file", "document"
            ],
            "subcategories": {
                "supplies": ["pen", "pencil", "paper", "stapler", "scissors", "tape"],
                "organization": ["notebook", "folder", "binder", "file"]
            }
        },
        "toiletries": {
            "keywords": [
                "shampoo", "soap", "toothbrush", "toothpaste", "lotion",
                "deodorant", "razor", "cosmetic", "makeup", "perfume",
                "cologne", "brush", "comb"
            ],
            "subcategories": {
                "bath": ["shampoo", "soap", "lotion"],
                "dental": ["toothbrush", "toothpaste"],
                "grooming": ["razor", "brush", "comb", "deodorant"],
                "cosmetics": ["makeup", "cosmetic", "perfume", "cologne"]
            }
        },
        "miscellaneous": {
            "keywords": [],  # Catch-all category
            "subcategories": {
                "general": []
            }
        }
    }

    # Pack size inference rules (items per box)
    PACK_SIZE_RULES = {
        # Small items (pack more per box)
        "small": {
            "pack_size": 8,
            "keywords": [
                "utensil", "fork", "knife", "spoon", "cup", "glass", "mug",
                "pen", "pencil", "toy", "cosmetic", "toiletry"
            ]
        },
        # Medium items (moderate packing)
        "medium": {
            "pack_size": 4,
            "keywords": [
                "plate", "bowl", "dish", "book", "shoe", "towel",
                "shirt", "pants", "pillow"
            ]
        },
        # Large items (pack fewer per box)
        "large": {
            "pack_size": 2,
            "keywords": [
                "blanket", "comforter", "jacket", "coat", "laptop",
                "tablet", "monitor"
            ]
        },
        # XL items (one per box or special handling)
        "xl": {
            "pack_size": 1,
            "keywords": [
                "tv", "television", "computer", "printer", "gaming console"
            ]
        }
    }

    # Quantity parsing patterns (in order of priority)
    QUANTITY_PATTERNS = [
        # "5 plates", "5x plates", "5 x plates" (number first with optional x)
        (r'^(\d+)\s*x\s+(.+)$', lambda m: (int(m.group(1)), m.group(2).strip())),
        (r'^(\d+)\s+(.+)$', lambda m: (int(m.group(1)), m.group(2).strip())),
        # "plates x5", "plates (5)", "plates - 5" (number last with separator)
        (r'^(.+?)\s+x\s*(\d+)$', lambda m: (int(m.group(2)), m.group(1).strip())),
        (r'^(.+?)\s*[\(\-]\s*(\d+)\s*\)?$', lambda m: (int(m.group(2)), m.group(1).strip())),
        # "plates 5", "towels 6" (item name followed by space and number)
        (r'^([a-zA-Z\s]+)\s+(\d+)$', lambda m: (int(m.group(2)), m.group(1).strip())),
    ]

    def __init__(self):
        """Initialize the bulk text parser"""
        self._compile_patterns()

    def _compile_patterns(self) -> None:
        """Compile regex patterns for efficiency"""
        self.compiled_patterns = [
            (re.compile(pattern, re.IGNORECASE), parser)
            for pattern, parser in self.QUANTITY_PATTERNS
        ]

    def parse(self, text: str) -> Dict:
        """
        Parse bulk text into structured pack items.

        Args:
            text: Multi-line text with item descriptions

        Returns:
            Dictionary with parsed items, unparsed lines, warnings, and confidence
        """
        lines = [line.strip() for line in text.split('\n') if line.strip()]

        parsed_items: List[ParsedItem] = []
        unparsed_lines: List[str] = []
        warnings: List[str] = []

        for line_num, line in enumerate(lines, 1):
            try:
                parsed_item = self._parse_line(line)
                if parsed_item:
                    parsed_items.append(parsed_item)

                    # Add warning for low confidence items
                    if parsed_item.confidence < 0.7:
                        warnings.append(
                            f"Line {line_num}: Low confidence ({parsed_item.confidence:.0%}) "
                            f"for '{line}' → {parsed_item.category}/{parsed_item.subcategory}"
                        )
                else:
                    unparsed_lines.append(line)
                    warnings.append(f"Line {line_num}: Unable to parse '{line}'")

            except Exception as e:
                unparsed_lines.append(line)
                warnings.append(f"Line {line_num}: Error parsing '{line}': {str(e)}")

        # Calculate overall confidence
        if parsed_items:
            avg_confidence = sum(item.confidence for item in parsed_items) / len(parsed_items)
        else:
            avg_confidence = 0.0

        return {
            "items": [
                {
                    "category": item.category,
                    "subcategory": item.subcategory,
                    "quantity": item.quantity,
                    "pack_size": item.pack_size,
                    "original_text": item.original_text,
                    "confidence": item.confidence
                }
                for item in parsed_items
            ],
            "unparsed_lines": unparsed_lines,
            "warnings": warnings,
            "confidence": avg_confidence,
            "summary": {
                "total_lines": len(lines),
                "parsed_count": len(parsed_items),
                "unparsed_count": len(unparsed_lines),
                "total_quantity": sum(item.quantity for item in parsed_items)
            }
        }

    def _parse_line(self, line: str) -> Optional[ParsedItem]:
        """
        Parse a single line into a ParsedItem.

        Args:
            line: Single line of text

        Returns:
            ParsedItem or None if unable to parse
        """
        # Try to extract quantity and item name
        quantity, item_name = self._extract_quantity(line)

        if not item_name:
            return None

        # Infer category and subcategory
        category, subcategory, category_confidence = self._infer_category(item_name)

        # Infer pack size
        pack_size, pack_size_confidence = self._infer_pack_size(item_name, category)

        # Calculate overall confidence (weighted average)
        confidence = (category_confidence * 0.7 + pack_size_confidence * 0.3)

        return ParsedItem(
            category=category,
            subcategory=subcategory,
            quantity=quantity,
            pack_size=pack_size,
            original_text=line,
            confidence=confidence
        )

    def _extract_quantity(self, line: str) -> Tuple[int, str]:
        """
        Extract quantity and item name from line.

        Args:
            line: Input line

        Returns:
            Tuple of (quantity, item_name)
        """
        # Try each pattern in order
        for pattern, parser in self.compiled_patterns:
            match = pattern.match(line)
            if match:
                try:
                    return parser(match)
                except (ValueError, IndexError):
                    continue

        # No quantity found, default to 1
        return (1, line)

    def _infer_category(self, item_name: str) -> Tuple[str, str, float]:
        """
        Infer category and subcategory from item name.

        Args:
            item_name: Name of the item

        Returns:
            Tuple of (category, subcategory, confidence)
        """
        item_lower = item_name.lower()

        best_category = "miscellaneous"
        best_subcategory = "general"
        best_score = 0.0

        # Check each category
        for category, category_data in self.CATEGORY_KEYWORDS.items():
            if category == "miscellaneous":
                continue  # Check this last

            # Check main category keywords
            for keyword in category_data["keywords"]:
                if keyword in item_lower:
                    # Calculate confidence based on keyword length and position
                    keyword_len = len(keyword)
                    item_len = len(item_lower)

                    # Exact match = 1.0, partial match scaled by length ratio
                    if item_lower == keyword:
                        score = 1.0
                    else:
                        score = min(0.95, keyword_len / item_len * 0.8 + 0.2)

                    # Check if this is the best match so far
                    if score > best_score:
                        best_score = score
                        best_category = category

                        # Find best subcategory
                        best_subcategory = self._find_subcategory(
                            item_lower, category_data["subcategories"]
                        )

        # If no match found, use miscellaneous with low confidence
        if best_score == 0.0:
            best_score = 0.3  # Low confidence for miscellaneous

        return (best_category, best_subcategory, best_score)

    def _find_subcategory(self, item_lower: str, subcategories: Dict[str, List[str]]) -> str:
        """
        Find the best matching subcategory.

        Args:
            item_lower: Lowercase item name
            subcategories: Dictionary of subcategory keywords

        Returns:
            Best matching subcategory name
        """
        best_subcategory = list(subcategories.keys())[0]  # Default to first
        best_score = 0.0

        for subcategory, keywords in subcategories.items():
            for keyword in keywords:
                if keyword in item_lower:
                    keyword_len = len(keyword)
                    score = keyword_len / len(item_lower)

                    if score > best_score:
                        best_score = score
                        best_subcategory = subcategory

        return best_subcategory

    def _infer_pack_size(self, item_name: str, category: str) -> Tuple[int, float]:
        """
        Infer pack size (items per box) based on item characteristics.

        Args:
            item_name: Name of the item
            category: Item category

        Returns:
            Tuple of (pack_size, confidence)
        """
        item_lower = item_name.lower()

        # Check pack size rules
        for size_category, size_data in self.PACK_SIZE_RULES.items():
            for keyword in size_data["keywords"]:
                if keyword in item_lower:
                    return (size_data["pack_size"], 0.9)

        # Category-based defaults
        category_defaults = {
            "kitchen": 4,      # Medium packing
            "clothing": 10,    # More items per box
            "shoes": 4,        # Moderate packing
            "electronics": 2,  # Careful packing
            "books": 6,        # Medium-heavy packing
            "linens": 8,       # Compress well
            "toys": 6,         # Varies by size
            "office": 8,       # Small items
            "toiletries": 8,   # Small items
            "miscellaneous": 5 # Conservative default
        }

        pack_size = category_defaults.get(category, 5)
        confidence = 0.6  # Moderate confidence for category-based inference

        return (pack_size, confidence)

    def get_category_suggestions(self) -> List[str]:
        """Get list of supported categories"""
        return list(self.CATEGORY_KEYWORDS.keys())

    def get_subcategory_suggestions(self, category: str) -> List[str]:
        """Get list of subcategories for a given category"""
        if category in self.CATEGORY_KEYWORDS:
            return list(self.CATEGORY_KEYWORDS[category]["subcategories"].keys())
        return []


def demo_parser():
    """Demonstrate the bulk text parser with example inputs"""
    parser = BulkTextParser()

    # Example input text
    example_text = """
    5 plates
    10x forks
    knives x8
    coffee maker
    3 shirts
    shoes (4)
    2 laptops
    books - 15
    towels 6
    unknown item xyz
    """

    print("=" * 60)
    print("BULK TEXT PARSER DEMO")
    print("=" * 60)
    print("\nInput Text:")
    print(example_text)
    print("\n" + "=" * 60)

    result = parser.parse(example_text)

    print("\nParsed Items:")
    print("-" * 60)
    for item in result["items"]:
        print(f"  {item['quantity']:>3}x {item['original_text']:<20} → "
              f"{item['category']:>15} / {item['subcategory']:<15} "
              f"(pack: {item['pack_size']}, conf: {item['confidence']:.0%})")

    print("\n" + "=" * 60)
    print("\nSummary:")
    print(f"  Total Lines:     {result['summary']['total_lines']}")
    print(f"  Parsed:          {result['summary']['parsed_count']}")
    print(f"  Unparsed:        {result['summary']['unparsed_count']}")
    print(f"  Total Quantity:  {result['summary']['total_quantity']}")
    print(f"  Confidence:      {result['confidence']:.0%}")

    if result["unparsed_lines"]:
        print("\nUnparsed Lines:")
        for line in result["unparsed_lines"]:
            print(f"  - {line}")

    if result["warnings"]:
        print("\nWarnings:")
        for warning in result["warnings"]:
            print(f"  [!] {warning}")

    print("\n" + "=" * 60)


if __name__ == "__main__":
    demo_parser()
