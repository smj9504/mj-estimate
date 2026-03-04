"""
Room-Specific Prompt Templates for GPT-4 Vision

Each room type has a specialized prompt that guides the AI to:
1. Identify visible items
2. Estimate hidden items (cabinets, closets, drawers)
3. Return structured JSON output
4. Provide realistic quantity estimates
"""

from app.domains.pack_calculation.templates.base_template import RoomType

# JSON schema that all prompts should return
JSON_SCHEMA = """
{
  "items": [
    {
      "category": "string (main category like 'Kitchen Appliances', 'Electronics', 'Furniture')",
      "subcategory": "string (optional, specific item like 'Microwave', 'TV', 'Sofa')",
      "quantity": number,
      "confidence": number (0.0-1.0),
      "pack_size": number (how many items fit in one box),
      "storage_type": "visible|cabinet|closet|drawer|pantry",
      "packing_method": "string (detailed instructions like 'Wrap in bubble wrap, place in medium box with padding')",
      "box_type": "SMALL_BOX|MEDIUM_BOX|LARGE_BOX|EXTRA_LARGE_BOX|WARDROBE_BOX|DISH_PACK_BOX|PICTURE_BOX|LONG_BOX|LAMP_BOX|TV_BOX|TUBE_BOX|N/A (for items not boxed)",
      "special_handling": ["FRAGILE", "HEAVY", "TWO_PERSON_LIFT", "ELECTRICAL", "DISASSEMBLY", "VALUABLE", "FABRIC_PROTECTION"] (array, include all that apply)
    }
  ],
  "density_level": "MINIMAL|MODERATE|FULL|PACKED",
  "detected_features": ["string array of visual features"],
  "total_boxes_estimate": number,
  "confidence_score": number (0.0-1.0)
}

BOX TYPE GUIDELINES:
- SMALL_BOX: Books, small electronics, utensils, small decorations (1.5 cu ft)
- MEDIUM_BOX: Kitchen items, toys, office supplies, clothing (3 cu ft)
- LARGE_BOX: Bedding, pillows, lamps, bulky soft items (4.5 cu ft)
- EXTRA_LARGE_BOX: Comforters, pillows, very light/bulky items (6 cu ft)
- WARDROBE_BOX: Hanging clothes (includes bar)
- DISH_PACK_BOX: Dishes, glassware, fragile kitchen items (extra padding)
- PICTURE_BOX: Artwork, mirrors, framed photos
- LONG_BOX: Golf clubs, skis, curtain rods
- LAMP_BOX: Table lamps, vases (tall items)
- TV_BOX: TVs, monitors
- TUBE_BOX: Rolled items (posters, blueprints)
- N/A: Items that don't need boxes (furniture, appliances)
"""

KITCHEN_PROMPT = f"""
Analyze this kitchen photo carefully. Count ALL visible items and estimate hidden items in cabinets/drawers.

VISIBLE ITEMS TO COUNT:
- Major appliances (refrigerator, microwave, stove, dishwasher, toaster, coffee maker)
- Countertop small appliances
- Dishes and glassware (visible on counters or open shelves)
- Pots, pans, cooking utensils (visible)
- Food items and pantry goods (visible)

ESTIMATED HIDDEN ITEMS (based on visible clues and kitchen size):
- Cabinet contents: dishes (plates, bowls, cups), glassware, food storage containers
- Drawer contents: utensils (forks, spoons, knives), cooking tools, gadgets
- Pantry items: canned goods, dry goods, spices
- Under-sink items: cleaning supplies, trash bags

DENSITY INDICATORS:
- MINIMAL: Sparse counters, mostly empty cabinets, new/minimal kitchen
- MODERATE: Normal lived-in kitchen, some counter items, cabinets 50-70% full
- FULL: Busy counters, cabinets 80%+ full, well-stocked pantry
- PACKED: Crowded counters, overflowing cabinets, extensive collections

PACKING GUIDELINES:
- Small appliances: 1 per box
- Dishes/glassware: 8-12 pieces per box
- Pots/pans: 4-6 per box
- Pantry items: 15-20 items per box
- Utensils/tools: Bundle by category

Return a JSON object with this exact structure:
{JSON_SCHEMA}

Be thorough and realistic in your estimates. Consider:
1. Kitchen size and number of cabinets visible
2. Evidence of cooking frequency (well-used vs pristine)
3. Hidden storage (estimate 70% of total items are hidden)
"""

BEDROOM_PROMPT = f"""
Analyze this bedroom photo carefully. Count visible items and estimate closet/drawer contents.

VISIBLE ITEMS TO COUNT:
- Furniture (bed, dresser, nightstands, desk, chairs)
- Visible clothing (on bed, chairs, floor)
- Visible shoes and accessories
- Decorative items (lamps, artwork, mirrors)
- Electronics (TV, computer, gaming systems)
- Books and personal items

ESTIMATED HIDDEN ITEMS (based on closet/dresser size):
- Closet clothing: shirts, pants, dresses, jackets, coats
- Drawer clothing: underwear, socks, t-shirts, accessories
- Shoes in closet: estimate based on visible shoes
- Bedding and linens: sheets, blankets, pillows (in closet)
- Seasonal clothing storage

DENSITY INDICATORS:
- MINIMAL: Sparse furnishings, empty closet space, minimal belongings
- MODERATE: Normal bedroom, closet 50-70% full, typical wardrobe
- FULL: Well-furnished, closet 80%+ full, extensive wardrobe
- PACKED: Crowded room, overflowing closet, maximum storage usage

PACKING GUIDELINES:
- Hanging clothes: 10-15 items per wardrobe box
- Folded clothes: 20-25 items per box
- Shoes: 6-8 pairs per box
- Bedding: 1-2 sets per box
- Books: 15-20 per box

Return a JSON object with this exact structure:
{JSON_SCHEMA}

Consider:
1. Closet size visible (standard, walk-in, small)
2. Evidence of organization vs clutter
3. Hidden items are typically 80% of total bedroom belongings
"""

LIVING_ROOM_PROMPT = f"""
Analyze this living room photo carefully. Count visible items and estimate storage contents.

VISIBLE ITEMS TO COUNT:
- Furniture (sofas, chairs, tables, TV stand, bookshelves)
- Electronics (TV, sound system, gaming consoles, cables)
- Decorative items (artwork, photos, vases, plants)
- Books and media (visible on shelves)
- Window treatments (curtains, blinds)
- Lighting fixtures (lamps, floor lamps)

ESTIMATED HIDDEN ITEMS:
- Cabinet/drawer contents: remotes, cables, DVDs, games
- Under-furniture storage: blankets, pillows, storage boxes
- Bookshelf contents not clearly visible
- Entertainment center storage

DENSITY INDICATORS:
- MINIMAL: Sparse furniture, minimal decor, empty shelves
- MODERATE: Typical lived-in room, normal furniture, some decorations
- FULL: Well-furnished, many decorative items, full shelves
- PACKED: Crowded, extensive collections, maximum display items

PACKING GUIDELINES:
- Books/media: 15-20 items per box
- Decorative items: 10-15 per box (with wrapping)
- Electronics: 1-2 items per box (with cables)
- Pillows/blankets: 4-6 per box

Return a JSON object with this exact structure:
{JSON_SCHEMA}

Consider:
1. Room size and furniture density
2. Collections visible (books, media, decor)
3. Hidden storage typically 40% of total items
"""

BATHROOM_PROMPT = f"""
Analyze this bathroom photo carefully. Count visible items and estimate cabinet/drawer contents.

VISIBLE ITEMS TO COUNT:
- Fixtures (toilet, sink, shower/tub, mirror, lighting)
- Visible toiletries (on counters, in shower)
- Towels and linens (visible)
- Decorative items
- Bathroom accessories (soap dispensers, holders, organizers)

ESTIMATED HIDDEN ITEMS:
- Medicine cabinet: medications, first aid, personal care items
- Under-sink cabinet: cleaning supplies, extra toiletries, paper products
- Drawer contents: makeup, grooming tools, small items
- Linen closet: towels, washcloths, toilet paper, tissues

DENSITY INDICATORS:
- MINIMAL: Basic toiletries, few products, minimal storage
- MODERATE: Normal bathroom, medicine cabinet 50-70% full
- FULL: Well-stocked, cabinets 80%+ full, many products
- PACKED: Overflowing cabinets, extensive product collections

PACKING GUIDELINES:
- Toiletries/cosmetics: 20-30 items per box
- Towels/linens: 8-10 per box
- Cleaning supplies: 15-20 items per box
- Medications: bundle carefully, separate box

Return a JSON object with this exact structure:
{JSON_SCHEMA}

Consider:
1. Number of people using bathroom (indicators: toothbrushes, products)
2. Cabinet and drawer count visible
3. Hidden items typically 85% of total bathroom contents
"""

GARAGE_PROMPT = f"""
Analyze this garage photo carefully. Count visible items and estimate shelving/storage contents.

VISIBLE ITEMS TO COUNT:
- Vehicles (cars, motorcycles, bicycles)
- Tools (visible on walls, workbenches)
- Storage units (shelves, cabinets, bins)
- Sports equipment (visible)
- Lawn/garden equipment
- Seasonal items (visible)
- Boxes and containers

ESTIMATED HIDDEN ITEMS:
- Tool cabinets/drawers: hand tools, power tools, hardware
- Shelving contents: paint, supplies, holiday decorations
- Storage bin contents: seasonal items, sporting goods
- Overhead storage: rarely-used items, seasonal decorations

DENSITY INDICATORS:
- MINIMAL: Empty garage, minimal storage, mostly open space
- MODERATE: Typical garage, some shelving, organized storage
- FULL: Well-utilized space, full shelving, many items stored
- PACKED: Maximum capacity, stacked boxes, minimal open space

PACKING GUIDELINES:
- Tools: 15-20 hand tools per box
- Paint/chemicals: 8-10 containers per box
- Sports equipment: 3-5 items per box
- Holiday decorations: 1 season per 2-3 boxes

Return a JSON object with this exact structure:
{JSON_SCHEMA}

Consider:
1. Garage size (1-car, 2-car, 3-car)
2. Organization level and storage solutions visible
3. Hidden items in bins/boxes typically 60% of total
"""

OFFICE_PROMPT = f"""
Analyze this office photo carefully. Count visible items and estimate desk/storage contents.

VISIBLE ITEMS TO COUNT:
- Furniture (desk, chair, filing cabinets, bookshelves)
- Electronics (computer, monitor, printer, phone)
- Visible books and files
- Office supplies (visible on desk)
- Decorative items

ESTIMATED HIDDEN ITEMS:
- Desk drawers: office supplies, paperwork, small items
- Filing cabinet contents: files, documents, folders
- Bookshelf contents not clearly visible
- Closet storage: office supplies, extra equipment

DENSITY INDICATORS:
- MINIMAL: Basic desk setup, minimal papers, few books
- MODERATE: Active office, organized files, typical supplies
- FULL: Well-stocked office, full filing system, many books
- PACKED: Crowded desk, overflowing files, extensive library

PACKING GUIDELINES:
- Books: 15-20 per box
- Files/documents: file box or 1 drawer per box
- Office supplies: consolidate small items
- Electronics: 1-2 items per box with protection

Return a JSON object with this exact structure:
{JSON_SCHEMA}

Consider:
1. Office type (home office, professional, student)
2. Filing cabinet and drawer count visible
3. Hidden items typically 70% of total office contents
"""

DINING_ROOM_PROMPT = f"""
Analyze this dining room photo carefully. Count visible items and estimate cabinet/hutch contents.

VISIBLE ITEMS TO COUNT:
- Furniture (dining table, chairs, china cabinet, hutch, sideboard)
- Visible dishes and glassware (display)
- Decorative items (centerpieces, artwork, lighting)
- Table linens (visible)

ESTIMATED HIDDEN ITEMS:
- China cabinet/hutch: dishes, serving pieces, glassware
- Sideboard/buffet drawers: silverware, table linens, serving utensils
- Storage closet: additional table settings, seasonal items

DENSITY INDICATORS:
- MINIMAL: Basic dining set, minimal display items
- MODERATE: Complete dining set, some china/glassware
- FULL: Extensive dishware, multiple sets, many serving pieces
- PACKED: Full china cabinet, extensive collections, formal sets

PACKING GUIDELINES:
- Dishes: 8-12 pieces per box
- Glassware: 8-12 pieces per box
- Serving pieces: 6-8 per box
- Table linens: 6-8 per box

Return a JSON object with this exact structure:
{JSON_SCHEMA}

Consider:
1. Storage furniture visible (china cabinet, hutch, sideboard)
2. Formality indicators (fine china vs everyday dishes)
3. Hidden items typically 75% of total dining room contents
"""

BASEMENT_PROMPT = f"""
Analyze this basement photo carefully. Count visible items and estimate storage contents.

VISIBLE ITEMS TO COUNT:
- Storage boxes and bins (count stacks)
- Furniture (storage or living)
- Visible equipment (HVAC, water heater, utilities)
- Recreation items (visible)
- Laundry appliances (if present)

ESTIMATED HIDDEN ITEMS:
- Storage bin contents: seasonal items, keepsakes, archived items
- Shelving contents: tools, supplies, stored goods
- Under-stair storage: miscellaneous items
- Utility closet contents

DENSITY INDICATORS:
- MINIMAL: Empty or sparse, minimal storage boxes
- MODERATE: Some boxes, organized storage areas
- FULL: Well-utilized, many storage boxes, full shelving
- PACKED: Maximum capacity, stacked boxes everywhere

PACKING GUIDELINES:
- Already boxed items: count and transport as-is
- Loose items: consolidate similar items
- Tools/supplies: 15-20 items per box
- Seasonal decorations: 1 season per 2-3 boxes

Return a JSON object with this exact structure:
{JSON_SCHEMA}

Consider:
1. Basement size and ceiling height
2. Primary use (storage, living space, utility)
3. Box count visible - estimate 40% are visible
"""

ATTIC_PROMPT = f"""
Analyze this attic photo carefully. Count visible items and estimate storage contents.

VISIBLE ITEMS TO COUNT:
- Storage boxes and bins (count visible)
- Furniture stored
- Seasonal decorations (visible)
- Trunks, suitcases, containers

ESTIMATED HIDDEN ITEMS:
- Contents of closed boxes and bins
- Items behind visible stacks
- Under-eave storage not visible
- Insulation and building materials (if storing)

DENSITY INDICATORS:
- MINIMAL: Few boxes, mostly empty space
- MODERATE: Some storage, organized stacks
- FULL: Well-utilized, most floor space used
- PACKED: Maximum capacity, difficult to navigate

PACKING GUIDELINES:
- Already boxed items: count and transport
- Loose seasonal items: consolidate
- Furniture: wrap and protect
- Fragile items: extra padding

Return a JSON object with this exact structure:
{JSON_SCHEMA}

Consider:
1. Attic size and accessibility
2. Storage organization level
3. Hidden items in sealed boxes typically 80% of contents
"""

CLOSET_PROMPT = f"""
Analyze this closet photo carefully. Count visible items and estimate total contents.

VISIBLE ITEMS TO COUNT:
- Hanging clothing (count by type)
- Visible shoes
- Folded items on shelves
- Accessories (bags, belts, hats)
- Storage bins and boxes

ESTIMATED HIDDEN ITEMS:
- Clothing behind visible items
- Drawer contents (if drawers present)
- Storage bin contents
- Top shelf items partially obscured
- Floor-level storage

DENSITY INDICATORS:
- MINIMAL: Sparse, mostly empty space, few items
- MODERATE: Normal closet, half to two-thirds full
- FULL: Well-utilized, most space occupied
- PACKED: Jammed full, double-hanging, difficult to access

PACKING GUIDELINES:
- Hanging clothes: 10-15 items per wardrobe box
- Folded clothes: 20-25 items per box
- Shoes: 6-8 pairs per box
- Accessories: consolidate by type

Return a JSON object with this exact structure:
{JSON_SCHEMA}

Consider:
1. Closet size (reach-in, walk-in, small)
2. Organization level (organized vs crammed)
3. Hidden items typically 50% of visible items
"""

LAUNDRY_PROMPT = f"""
Analyze this laundry room photo carefully. Count visible items and estimate storage contents.

VISIBLE ITEMS TO COUNT:
- Appliances (washer, dryer)
- Visible laundry supplies (detergent, softener, stain removers)
- Laundry baskets and hampers
- Cleaning supplies (visible)
- Storage furniture (shelves, cabinets)
- Ironing equipment

ESTIMATED HIDDEN ITEMS:
- Cabinet contents: extra supplies, cleaning products, paper goods
- Shelf contents not clearly visible
- Under-sink storage: extra detergents, cleaning supplies
- Closet storage: linens, cleaning tools, vacuum accessories

DENSITY INDICATORS:
- MINIMAL: Basic appliances, minimal supplies
- MODERATE: Normal supplies, some extra inventory
- FULL: Well-stocked, bulk supplies, organized storage
- PACKED: Maximum capacity, extensive supply inventory

PACKING GUIDELINES:
- Cleaning supplies: 15-20 items per box
- Laundry products: 8-10 bottles/boxes per box
- Linens: 8-10 items per box
- Cleaning tools: bundle by type

Return a JSON object with this exact structure:
{JSON_SCHEMA}

Consider:
1. Room size and storage furniture visible
2. Bulk buying indicators (large containers, multiples)
3. Hidden items typically 60% of total contents
"""

# Mapping of room types to prompts
ROOM_PROMPTS = {
    RoomType.KITCHEN: KITCHEN_PROMPT,
    RoomType.BEDROOM: BEDROOM_PROMPT,
    RoomType.LIVING_ROOM: LIVING_ROOM_PROMPT,
    RoomType.BATHROOM: BATHROOM_PROMPT,
    RoomType.GARAGE: GARAGE_PROMPT,
    RoomType.OFFICE: OFFICE_PROMPT,
    RoomType.DINING_ROOM: DINING_ROOM_PROMPT,
    RoomType.BASEMENT: BASEMENT_PROMPT,
    RoomType.ATTIC: ATTIC_PROMPT,
    RoomType.CLOSET: CLOSET_PROMPT,
    RoomType.LAUNDRY: LAUNDRY_PROMPT,
}


def get_room_prompt(room_type: RoomType) -> str:
    """
    Get the appropriate prompt for a given room type.

    Args:
        room_type: The type of room to analyze

    Returns:
        Prompt string for GPT-4 Vision
    """
    return ROOM_PROMPTS.get(room_type, LIVING_ROOM_PROMPT)  # Default to living room
