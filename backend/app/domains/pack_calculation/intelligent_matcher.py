"""
Intelligent Item Name Matcher

Solves the scalability problem of hardcoded fuzzy rules by using:
1. Semantic keyword extraction
2. Category-based matching
3. String similarity algorithms
4. Learning from user corrections (future)
"""

from typing import Optional, Dict, Tuple, List
from difflib import SequenceMatcher
import re


class IntelligentItemMatcher:
    """
    Smart item name matcher that doesn't require exhaustive hardcoded rules
    """

    # === CATEGORY KEYWORDS ===
    CATEGORY_KEYWORDS = {
        # BEDROOM FURNITURE
        'bed': [
            'bed', 'mattress', 'bedframe', 'bed frame', 'headboard', 'footboard',
            'platform bed', 'sleigh bed', 'canopy bed', 'bunk bed', 'loft bed',
            'day bed', 'daybed', 'murphy bed', 'futon'
        ],
        'nightstand': [
            'nightstand', 'bedside', 'night stand', 'bedside table', 'night table',
            'end table', 'accent table'
        ],
        'dresser': [
            'dresser', 'drawer', 'chest', 'chest of drawers', 'bureau',
            'armoire dresser', 'tall dresser', 'low dresser', 'wide dresser',
            'tallboy', 'lowboy', 'chest drawer', 'drawer unit'
        ],
        'wardrobe': [
            'wardrobe', 'armoire', 'closet', 'clothing cabinet', 'clothes closet',
            'portable closet', 'freestanding closet', 'storage closet'
        ],

        # LIVING ROOM FURNITURE
        'couch': [
            'couch', 'sofa', 'loveseat', 'love seat', 'sectional', 'sectional sofa',
            'recliner', 'chaise', 'chaise lounge', 'settee', 'divan',
            'sleeper sofa', 'sofa bed', 'pull-out couch', 'futon',
            'ottoman', 'pouf', 'bench seating'
        ],
        'chair': [
            'chair', 'seat', 'armchair', 'arm chair', 'accent chair',
            'rocking chair', 'rocker', 'glider', 'recliner chair',
            'lounge chair', 'club chair', 'wing chair', 'wingback',
            'side chair', 'occasional chair', 'slipper chair',
            'gaming chair', 'bean bag', 'beanbag', 'poang'
        ],
        'table': [
            'table', 'dining table', 'kitchen table', 'dining set',
            'coffee table', 'cocktail table', 'center table',
            'side table', 'end table', 'console table', 'sofa table', 'sofa desk',
            'accent table', 'nesting table', 'occasional table'
        ],
        'tv_stand': [
            'tv stand', 'television stand', 'tv console', 'media console',
            'entertainment center', 'media unit', 'tv cabinet', 'tv table',
            'media center', 'av unit', 'entertainment unit'
        ],

        # STORAGE FURNITURE
        'bookshelf': [
            'bookshelf', 'bookshelves', 'bookcase', 'bookcases',
            'shelf', 'shelves', 'shelving', 'shelving unit',
            'wall shelf', 'floating shelf', 'cube shelf', 'ladder shelf',
            'etagere', 'display shelf', 'storage shelf', 'shelf unit',
            'billy', 'kallax', 'expedit'
        ],
        'cabinet': [
            'cabinet', 'storage cabinet', 'file cabinet', 'filing cabinet', 'shoe case',
            'display cabinet', 'china cabinet', 'curio cabinet',
            'liquor cabinet', 'bar cabinet', 'credenza', 'sideboard',
            'buffet', 'hutch', 'server'
        ],
        'rack': [
            'rack', 'shelving rack', 'storage rack', 'wine rack',
            'shoe rack', 'coat rack', 'hat rack', 'towel rack',
            'baker rack', "baker's rack", 'utility rack', 'metal rack'
        ],

        # OFFICE FURNITURE
        'desk': [
            'desk', 'workstation', 'workspace', 'work table', 'writing desk',
            'computer desk', 'office desk', 'secretary desk', 'executive desk',
            'standing desk', 'sit-stand desk', 'corner desk', 'l-shaped desk',
            'u-shaped desk', 'study table', 'vanity', 'makeup table'
        ],
        'office_chair': [
            'office chair', 'desk chair', 'task chair', 'ergonomic chair',
            'executive chair', 'computer chair', 'swivel chair',
            'drafting chair', 'stool', 'bar stool', 'counter stool'
        ],

        # KITCHEN & DINING
        'dining_set': [
            'dining set', 'dinette', 'table and chairs', 'breakfast set',
            'pub table', 'bistro set', 'bar set', 'kitchen set'
        ],
        'bar_cart': [
            'bar cart', 'cart', 'serving cart', 'kitchen cart',
            'rolling cart', 'utility cart', 'tea cart', 'beverage cart'
        ],
        'kitchen_island': [
            'kitchen island', 'island', 'butcher block', 'prep table',
            'work island', 'rolling island'
        ],

        # BEDROOM ACCESSORIES
        'mirror': [
            'mirror', 'wall mirror', 'floor mirror', 'standing mirror',
            'full length mirror', 'vanity mirror', 'dresser mirror',
            'decorative mirror', 'framed mirror'
        ],
        'picture': [
            'picture', 'painting', 'artwork', 'art', 'photo', 'photograph',
            'frame', 'picture frame', 'wall art', 'canvas', 'print',
            'poster', 'wall decor', 'wall hanging'
        ],

        # DECOR & LIGHTING
        'lamp': [
            'lamp', 'light', 'lighting', 'floor lamp', 'table lamp',
            'desk lamp', 'bedside lamp', 'reading lamp',
            'chandelier', 'pendant light', 'ceiling light', 'sconce',
            'wall light', 'torchiere', 'arc lamp'
        ],
        'rug': [
            'rug', 'carpet', 'mat', 'area rug', 'runner', 'floor mat',
            'door mat', 'bath mat', 'throw rug', 'shag rug', 'persian rug'
        ],
        'plant': [
            'plant', 'planter', 'pot', 'potted plant', 'tree',
            'indoor plant', 'house plant', 'plant stand', 'flower pot'
        ],
        'decor': [
            'vase', 'sculpture', 'statue', 'figurine', 'ornament',
            'decoration', 'decor', 'centerpiece', 'candle', 'candleholder'
        ],

        # APPLIANCES - KITCHEN
        'refrigerator': [
            'refrigerator', 'fridge', 'freezer', 'ice box', 'icebox',
            'mini fridge', 'compact fridge', 'wine fridge', 'beverage fridge'
        ],
        'stove': [
            'stove', 'oven', 'range', 'cooktop', 'electric range',
            'gas range', 'induction cooktop', 'cooking range'
        ],
        'dishwasher': [
            'dishwasher', 'dish washer'
        ],
        'microwave': [
            'microwave', 'microwave oven'
        ],
        'washer': [
            'washer', 'washing machine', 'laundry machine', 'clothes washer'
        ],
        'dryer': [
            'dryer', 'clothes dryer', 'laundry dryer'
        ],

        # APPLIANCES - OTHER
        'vacuum': [
            'vacuum', 'vacuum cleaner', 'hoover', 'shop vac', 'wet vac'
        ],
        'fan': [
            'fan', 'ceiling fan', 'tower fan', 'box fan', 'floor fan',
            'standing fan', 'desk fan', 'exhaust fan'
        ],
        'heater': [
            'heater', 'space heater', 'electric heater', 'radiator',
            'oil heater', 'baseboard heater'
        ],
        'air_conditioner': [
            'air conditioner', 'ac', 'a/c', 'window ac', 'portable ac',
            'air conditioning unit', 'cooling unit'
        ],
        'humidifier': [
            'humidifier', 'dehumidifier', 'air purifier'
        ],

        # ELECTRONICS
        'tv': [
            'tv', 'television', 'flatscreen', 'flat screen', 'smart tv',
            'led tv', 'lcd tv', 'oled', 'plasma tv', 'monitor tv'
        ],
        'computer': [
            'computer', 'pc', 'desktop', 'laptop', 'macbook', 'imac',
            'workstation', 'tower', 'all-in-one', 'tablet', 'ipad'
        ],
        'monitor': [
            'monitor', 'screen', 'display', 'computer monitor',
            'dual monitor', 'gaming monitor', 'ultrawide'
        ],
        'printer': [
            'printer', 'scanner', 'copier', 'fax machine', 'all-in-one printer',
            'laser printer', 'inkjet', 'multifunction printer'
        ],
        'speaker': [
            'speaker', 'speakers', 'sound system', 'stereo', 'home theater',
            'soundbar', 'subwoofer', 'bookshelf speaker', 'tower speaker'
        ],
        'game_console': [
            'playstation', 'ps5', 'ps4', 'xbox', 'nintendo', 'switch',
            'gaming console', 'game console', 'gaming system'
        ],

        # OUTDOOR & GARAGE
        'patio_furniture': [
            'patio furniture', 'outdoor furniture', 'patio set',
            'patio chair', 'patio table', 'outdoor chair', 'outdoor table',
            'deck furniture', 'garden furniture', 'lawn chair'
        ],
        'grill': [
            'grill', 'bbq', 'barbecue', 'gas grill', 'charcoal grill',
            'smoker', 'outdoor grill'
        ],
        'bike': [
            'bike', 'bicycle', 'cycle', 'mountain bike', 'road bike',
            'electric bike', 'ebike', 'exercise bike', 'stationary bike'
        ],
        'tool': [
            'tool', 'toolbox', 'tool chest', 'workbench', 'work bench',
            'tools', 'equipment', 'lawn mower', 'mower', 'trimmer'
        ],

        # MUSICAL INSTRUMENTS
        'piano': [
            'piano', 'grand piano', 'upright piano', 'electric piano',
            'keyboard', 'digital piano', 'baby grand'
        ],
        'instrument': [
            'guitar', 'drum', 'drums', 'drum set', 'instrument',
            'violin', 'cello', 'bass', 'saxophone', 'trumpet'
        ],

        # EXERCISE EQUIPMENT
        'exercise': [
            'treadmill', 'elliptical', 'exercise bike', 'rowing machine',
            'weight bench', 'weights', 'dumbbells', 'barbell',
            'exercise equipment', 'gym equipment', 'workout equipment',
            'exercise machine', 'peloton', 'nordictrack'
        ],

        # BABY & KIDS
        'crib': [
            'crib', 'baby crib', 'cradle', 'bassinet',
            'toddler bed', 'youth bed'
        ],
        'changing_table': [
            'changing table', 'changing station', 'diaper station'
        ],
        'high_chair': [
            'high chair', 'highchair', 'booster seat', 'feeding chair'
        ],
        'toy': [
            'toy', 'toys', 'toy box', 'toy chest', 'play set',
            'playhouse', 'slide', 'swing'
        ],

        # BATHROOM
        'bathroom_cabinet': [
            'medicine cabinet', 'bathroom cabinet', 'vanity cabinet',
            'linen cabinet', 'bathroom storage'
        ],
        'bathroom_furniture': [
            'bathroom vanity', 'vanity', 'bathroom shelving',
            'over-toilet storage', 'towel cabinet'
        ],

        # STORAGE & ORGANIZATION
        'box': [
            'box', 'container', 'bin', 'storage box', 'plastic bin',
            'tote', 'storage tote', 'crate', 'moving box'
        ],
        'organizer': [
            'organizer', 'storage organizer', 'closet organizer',
            'drawer organizer', 'shelf organizer'
        ],
        'trunk': [
            'trunk', 'chest', 'storage trunk', 'hope chest',
            'steamer trunk', 'footlocker'
        ],
        'safe': [
            'safe', 'gun safe', 'security safe', 'floor safe',
            'wall safe', 'fire safe', 'lockbox'
        ],

        # MISCELLANEOUS
        'ladder': [
            'ladder', 'step ladder', 'step stool', 'extension ladder'
        ],
        'ironing_board': [
            'ironing board', 'iron board'
        ],
        'suitcase': [
            'suitcase', 'luggage', 'travel bag', 'carry-on'
        ],
    }

    # === SIZE KEYWORDS ===
    SIZE_KEYWORDS = {
        'small': [
            'small', 'compact', 'mini', 'tiny', 'short', 'narrow', 'little',
            'twin', 'single', 'twin xl',
            'apartment size', 'studio size', 'space saving',
            'slim', 'petite', 'youth', 'child', 'kids',
            'under', 'less than', 'smaller',
            '2 drawer', 'two drawer', '3 drawer', 'three drawer',
            'end table', 'side table', 'nightstand',
        ],
        'medium': [
            'medium', 'standard', 'regular', 'normal', 'average',
            'full', 'double', 'full size',
            'mid-size', 'midsize', 'moderate',
            '4 drawer', 'four drawer', '5 drawer', 'five drawer',
            'loveseat', 'twin', 'double bed',
        ],
        'large': [
            'large', 'big', 'tall', 'wide', 'long', 'oversized', 'over-sized',
            'queen', 'king', 'california king', 'cal king',
            'sectional', 'l-shaped', 'u-shaped', 'corner',
            'set', 'suite', 'collection', 'ensemble', 'group', 'combo',
            'bunch', 'multiple', 'several', 'pair',
            'over', 'more than', 'larger', 'extra',
            '6 drawer', 'six drawer', '7 drawer', 'seven drawer',
            '8 drawer', 'eight drawer', '9 drawer', 'nine drawer',
            'entertainment center', 'wardrobe', 'armoire',
        ],
        'xl': [
            'xl', 'extra large', 'extra-large', 'xxl', 'jumbo',
            'super king', 'california king', 'huge', 'massive',
            'full set', 'complete set', 'entire', 'whole',
            'grand piano', 'pool table', 'ping pong table',
            'executive desk', 'conference table',
        ],
    }

    # === MATERIAL/STYLE KEYWORDS ===
    MATERIAL_KEYWORDS = {
        'wood': ['wood', 'wooden', 'oak', 'pine', 'maple', 'cherry', 'walnut', 'mahogany', 'teak', 'bamboo', 'mdf', 'particle board'],
        'metal': ['metal', 'steel', 'iron', 'aluminum', 'chrome', 'brass', 'copper'],
        'glass': ['glass', 'tempered glass', 'frosted glass', 'mirror'],
        'plastic': ['plastic', 'acrylic', 'polycarbonate'],
        'leather': ['leather', 'faux leather', 'vinyl', 'pleather'],
        'fabric': ['fabric', 'upholstered', 'cloth', 'microfiber', 'velvet', 'linen'],
        'wicker': ['wicker', 'rattan', 'cane'],
    }

    # === CONDITION/STATE KEYWORDS ===
    CONDITION_KEYWORDS = {
        'fragile': ['fragile', 'delicate', 'breakable', 'glass', 'china', 'porcelain', 'crystal', 'antique', 'vintage'],
        'heavy': ['heavy', 'solid', 'dense', 'weighted', 'cast iron', 'marble', 'granite'],
        'valuable': ['expensive', 'valuable', 'antique', 'heirloom', 'collectible'],
    }

    # === QUANTITY KEYWORDS ===
    QUANTITY_KEYWORDS = {
        'multiple': ['set of', 'pair of', 'group of', 'collection of', 'x', '×', 'and', '&', 'with', 'plus', 'including'],
        'numbers': r"\b(\d+)\s*(x|pieces?|pcs?|items?|units?)?\b",
    }

    # === ROOM KEYWORDS (for context) ===
    ROOM_KEYWORDS = {
        'bedroom': ['bedroom', 'master bedroom', 'guest room', 'bed room'],
        'living_room': ['living room', 'family room', 'sitting room', 'lounge'],
        'dining_room': ['dining room', 'dining area', 'breakfast nook'],
        'kitchen': ['kitchen', 'kitchenette'],
        'office': ['office', 'home office', 'study', 'den'],
        'bathroom': ['bathroom', 'bath', 'powder room', 'half bath'],
        'garage': ['garage', 'shed', 'workshop'],
        'basement': ['basement', 'cellar'],
        'attic': ['attic', 'loft'],
        'outdoor': ['patio', 'deck', 'balcony', 'yard', 'garden', 'outdoor'],
    }

    # === ASSEMBLY/DISASSEMBLY KEYWORDS ===
    ASSEMBLY_KEYWORDS = {
        'needs_disassembly': ['assembled', 'assembly required', 'put together', 'sectional', 'modular', 'wall unit'],
        'one_piece': ['one piece', 'solid', 'built-in', 'integrated'],
    }

    def __init__(self, seed_mappings: Dict):
        """
        Initialize matcher with seed data mappings

        Args:
            seed_mappings: Dictionary of item_key -> item_data from ITEM_MAPPINGS
        """
        self.seed_mappings = seed_mappings
        self._build_reverse_index()
        self.quantity_pattern = re.compile(self.QUANTITY_KEYWORDS['numbers'], re.IGNORECASE)

    def _build_reverse_index(self):
        """Build reverse index for fast category lookup"""
        self.category_to_keys = {}

        for seed_key in self.seed_mappings.keys():
            category = seed_key.split('_')[0]

            if category not in self.category_to_keys:
                self.category_to_keys[category] = []

            self.category_to_keys[category].append(seed_key)

    # --- Helper methods (new) ---
    def normalize_text(self, text: str) -> str:
        if not text:
            return ""
        text = text.lower().strip()
        text = re.sub(r'[-_/]', ' ', text)
        text = re.sub(r'\s+', ' ', text)
        return text

    def extract_quantity(self, text: str) -> int:
        matches = self.quantity_pattern.findall(text.lower())
        if matches:
            return int(matches[0][0])
        quantity_words = {
            'pair': 2, 'couple': 2, 'duo': 2,
            'trio': 3, 'three': 3,
            'set': 4,
            'several': 3, 'few': 3, 'multiple': 2,
        }
        for word, qty in quantity_words.items():
            if word in text.lower():
                return qty
        return 1

    def detect_category(self, text: str) -> Optional[str]:
        normalized = self.normalize_text(text)
        category_scores: Dict[str, int] = {}
        for category, keywords in self.CATEGORY_KEYWORDS.items():
            score = 0
            for keyword in keywords:
                if keyword in normalized:
                    if normalized == keyword:
                        score += 10
                    elif re.search(rf'\b{re.escape(keyword)}\b', normalized):
                        score += 5
                    else:
                        score += 1
            if score > 0:
                category_scores[category] = score
        if category_scores:
            return max(category_scores.items(), key=lambda x: x[1])[0]
        return None

    def detect_size(self, text: str, category: Optional[str] = None) -> str:
        normalized = self.normalize_text(text)
        size_scores = {'small': 0, 'medium': 0, 'large': 0, 'xl': 0}
        for size, keywords in self.SIZE_KEYWORDS.items():
            for keyword in keywords:
                if keyword in normalized:
                    if re.search(rf'\b{re.escape(keyword)}\b', normalized):
                        size_scores[size] += 5
                    else:
                        size_scores[size] += 1
        max_score = max(size_scores.values())
        if max_score == 0:
            if category:
                category_defaults = {
                    'nightstand': 'small',
                    'mirror': 'medium',
                    'lamp': 'small',
                    'picture': 'small',
                    'box': 'medium',
                    'piano': 'xl',
                    'refrigerator': 'xl',
                    'washer': 'large',
                    'dryer': 'large',
                }
                return category_defaults.get(category, 'medium')
            return 'medium'
        return max(size_scores.items(), key=lambda x: x[1])[0]

    def detect_material(self, text: str) -> List[str]:
        normalized = self.normalize_text(text)
        materials: List[str] = []
        for material, keywords in self.MATERIAL_KEYWORDS.items():
            for keyword in keywords:
                if keyword in normalized:
                    materials.append(material)
                    break
        return materials

    def is_fragile(self, text: str, category: Optional[str] = None) -> bool:
        normalized = self.normalize_text(text)
        for keyword in self.CONDITION_KEYWORDS['fragile']:
            if keyword in normalized:
                return True
        fragile_categories = ['mirror', 'picture', 'tv', 'monitor', 'lamp', 'piano']
        if category in fragile_categories:
            return True
        materials = self.detect_material(text)
        if 'glass' in materials:
            return True
        return False

    def requires_disassembly(self, text: str, category: Optional[str] = None, size: Optional[str] = None) -> bool:
        normalized = self.normalize_text(text)
        for keyword in self.ASSEMBLY_KEYWORDS['needs_disassembly']:
            if keyword in normalized:
                return True
        if category in ['bed', 'desk', 'wardrobe'] and size in ['large', 'xl']:
            return True
        if category in ['couch'] and 'sectional' in normalized:
            return True
        return False

    def map_to_seed_item(self, text: str) -> Dict:
        normalized = self.normalize_text(text)
        
        # Skip if has contents
        has_contents = any(keyword in normalized for keyword in [
            '+ contents', '+contents', 'with contents', '& contents', 'and contents', ' contents'
        ])
        if has_contents:
            return {
                'category': None,
                'size': None,
                'quantity': 1,
                'seed_item': None,
                'confidence': 0.0,
                'metadata': {
                    'materials': [],
                    'fragile': False,
                    'requires_disassembly': False,
                    'original_text': text,
                    'normalized_text': normalized,
                }
            }
        
        category = self.detect_category(normalized)
        size = self.detect_size(normalized, category)
        quantity = self.extract_quantity(normalized)
        materials = self.detect_material(normalized)
        fragile = self.is_fragile(normalized, category)
        needs_disassembly = self.requires_disassembly(normalized, category, size)
        seed_item = None
        if category:
            base_key = f"{category}_{size}"
            seed_item = base_key
        confidence = 0.0
        if category:
            confidence += 0.5
        if size != 'medium':
            confidence += 0.3
        if quantity > 1:
            confidence += 0.1
        if materials:
            confidence += 0.1
        confidence = min(confidence, 1.0)
        return {
            'category': category,
            'size': size,
            'quantity': quantity,
            'seed_item': seed_item,
            'confidence': confidence,
            'metadata': {
                'materials': materials,
                'fragile': fragile,
                'requires_disassembly': needs_disassembly,
                'original_text': text,
                'normalized_text': normalized,
            }
        }

    def match(self, item_name: str) -> Optional[str]:
        """
        Match item name to seed mapping key

        Returns:
            Matched seed key or None
        """
        normalized = item_name.lower().strip()
        
        # Skip matching if item has "contents" - contents should not match furniture
        has_contents = any(keyword in normalized for keyword in [
            '+ contents', '+contents', 'with contents', '& contents', 'and contents', ' contents'
        ])
        if has_contents:
            print(f"🚫 IntelligentMatcher: Skipping furniture matching for contents-only item: '{item_name}'")
            return None

        # New: Try rich mapper first
        map_result = self.map_to_seed_item(item_name)
        mapped_key = map_result.get('seed_item')
        if mapped_key and mapped_key in self.seed_mappings and map_result.get('confidence', 0) >= 0.5:
            print(
                f"🎯 Semantic match: '{item_name}' → category={map_result['category']}, "
                f"size={map_result['size']} → '{mapped_key}'"
            )
            return mapped_key

        # Existing flow
        category, size = self._extract_semantic_info(normalized)

        if category:
            matched_key = self._find_seed_key_by_category_size(category, size)
            if matched_key:
                print(f"🎯 Semantic match: '{item_name}' → category={category}, size={size} → '{matched_key}'")
                return matched_key

        matched_key, score = self._similarity_match(normalized)
        if matched_key and score >= 0.75:
            print(f"🔍 Similarity match: '{item_name}' → '{matched_key}' (score: {score:.2f})")
            return matched_key

        score_display = f"{score:.2f}" if matched_key else "0.00"
        print(
            f"⚠️ No confident match for '{item_name}' (best similarity: {score_display})"
        )
        return None

    def _extract_semantic_info(self, normalized_input: str) -> Tuple[Optional[str], Optional[str]]:
        detected_category = None
        detected_size = None
        for category, keywords in self.CATEGORY_KEYWORDS.items():
            for keyword in keywords:
                if keyword in normalized_input:
                    detected_category = category
                    break
            if detected_category:
                break
        for size, keywords in self.SIZE_KEYWORDS.items():
            for keyword in keywords:
                if re.search(r'\b' + re.escape(keyword) + r'\b', normalized_input):
                    detected_size = size
                    break
            if detected_size:
                break
        if not detected_size:
            for implied_size, modifiers in {'large': ['set', 'suite', 'collection', 'ensemble', 'group', 'bunch', 'multiple', 'several']}.items():
                for modifier in modifiers:
                    if re.search(r'\b' + re.escape(modifier) + r'\b', normalized_input):
                        detected_size = implied_size
                        print(f"🔍 Size modifier detected: '{modifier}' → implied size: {implied_size}")
                        break
                if detected_size:
                    break
        return detected_category, detected_size

    def _find_seed_key_by_category_size(self, category: str, size: Optional[str]) -> Optional[str]:
        candidate_keys = self.category_to_keys.get(category, [])
        if not candidate_keys:
            return None
        if size:
            size_map = {
                'small': ['small', 'compact', 'twin', 'single', 'short'],
                'medium': ['medium', 'standard', 'full', 'double', 'regular'],
                'large': ['large', 'big', 'king', 'queen', 'tall', 'xl'],
            }
            size_keywords = size_map.get(size, [])
            for key in candidate_keys:
                for size_keyword in size_keywords:
                    if size_keyword in key:
                        return key
        simple_keys = [k for k in candidate_keys if len(k.split('_')) == 2 and k.split('_')[1] in ['small', 'medium', 'large']]
        if simple_keys:
            for k in simple_keys:
                if 'small' in k:
                    return k
            return simple_keys[0]
        return candidate_keys[0] if candidate_keys else None

    def _similarity_match(self, normalized_input: str) -> Tuple[Optional[str], float]:
        best_match = None
        best_score = 0.0
        for seed_key in self.seed_mappings.keys():
            seed_readable = seed_key.replace('_', ' ')
            score = SequenceMatcher(None, normalized_input, seed_readable).ratio()
            input_words = normalized_input.split()
            seed_words = seed_readable.split()
            for input_word in input_words:
                if len(input_word) > 3:
                    for seed_word in seed_words:
                        word_sim = SequenceMatcher(None, input_word, seed_word).ratio()
                        if word_sim > 0.8:
                            score += 0.15
            if score > best_score:
                best_score = score
                best_match = seed_key
        return best_match, best_score


# Learning System (Future Enhancement)
class LearningMatcher:
    """
    Learns from user corrections to improve matching over time

    Usage:
    1. User corrects a match: "Large dresser" -> "dresser_large"
    2. System stores: correction_db["large dresser"] = "dresser_large"
    3. Next time: Direct lookup before semantic matching

    This eliminates need for hardcoded rules over time.
    """

    def __init__(self, db_session):
        self.db = db_session

    def learn_from_correction(self, original_input: str, corrected_key: str):
        """
        Store user correction for future use

        This gradually builds a custom mapping database
        that replaces hardcoded fuzzy_rules
        """
        pass

    def get_learned_match(self, input_name: str) -> Optional[str]:
        """Check if we have a learned match for this input"""
        pass
