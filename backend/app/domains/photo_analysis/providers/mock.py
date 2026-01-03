"""
Mock Photo Analysis Provider

Mock implementation for testing and development without API costs.
"""

import logging
import random
from typing import List

from app.domains.photo_analysis.providers.base import PhotoAnalysisProvider
from app.domains.photo_analysis.schemas import SinglePhotoAnalysisResult, DetectedItem
from app.domains.pack_calculation.templates.base_template import RoomType, DensityLevel

logger = logging.getLogger(__name__)


class MockPhotoAnalysisProvider(PhotoAnalysisProvider):
    """Mock provider that generates realistic fake data for testing"""

    def __init__(self):
        """Initialize mock provider"""
        self.call_count = 0

    def get_provider_name(self) -> str:
        """Get provider name"""
        return "Mock Provider (Testing)"

    def is_available(self) -> bool:
        """Mock provider is always available"""
        return True

    def _generate_mock_items(self, room_type: RoomType) -> List[DetectedItem]:
        """
        Generate realistic mock items for a given room type.

        Args:
            room_type: Type of room

        Returns:
            List of mock DetectedItem objects
        """
        mock_data = {
            RoomType.KITCHEN: [
                DetectedItem(category="Kitchen Items", subcategory="Pots & Pans", quantity=8, confidence=0.85, pack_size=1, storage_type="cabinet"),
                DetectedItem(category="Kitchen Items", subcategory="Dishes", quantity=24, confidence=0.90, pack_size=12, storage_type="cabinet"),
                DetectedItem(category="Appliances", subcategory="Small Appliances", quantity=5, confidence=0.95, pack_size=1, storage_type="visible"),
                DetectedItem(category="Kitchen Items", subcategory="Utensils", quantity=40, confidence=0.80, pack_size=20, storage_type="drawer"),
                DetectedItem(category="Pantry Items", subcategory="Canned Goods", quantity=30, confidence=0.75, pack_size=15, storage_type="pantry"),
            ],
            RoomType.BEDROOM: [
                DetectedItem(category="Clothing", subcategory="Hanging Clothes", quantity=50, confidence=0.85, pack_size=15, storage_type="closet"),
                DetectedItem(category="Clothing", subcategory="Folded Clothes", quantity=60, confidence=0.80, pack_size=20, storage_type="drawer"),
                DetectedItem(category="Shoes", subcategory="Footwear", quantity=15, confidence=0.90, pack_size=6, storage_type="closet"),
                DetectedItem(category="Bedding", subcategory="Sheets & Blankets", quantity=8, confidence=0.85, pack_size=2, storage_type="closet"),
                DetectedItem(category="Personal Items", subcategory="Accessories", quantity=20, confidence=0.70, pack_size=10, storage_type="drawer"),
            ],
            RoomType.LIVING_ROOM: [
                DetectedItem(category="Electronics", subcategory="TV & Components", quantity=3, confidence=0.95, pack_size=1, storage_type="visible"),
                DetectedItem(category="Books & Media", subcategory="Books", quantity=80, confidence=0.90, pack_size=15, storage_type="visible"),
                DetectedItem(category="Decorative Items", subcategory="Decor", quantity=25, confidence=0.85, pack_size=10, storage_type="visible"),
                DetectedItem(category="Furniture Accessories", subcategory="Pillows & Throws", quantity=12, confidence=0.80, pack_size=4, storage_type="visible"),
            ],
            RoomType.BATHROOM: [
                DetectedItem(category="Toiletries", subcategory="Personal Care", quantity=40, confidence=0.80, pack_size=20, storage_type="cabinet"),
                DetectedItem(category="Linens", subcategory="Towels", quantity=15, confidence=0.90, pack_size=8, storage_type="closet"),
                DetectedItem(category="Cleaning Supplies", subcategory="Bathroom Cleaners", quantity=10, confidence=0.85, pack_size=10, storage_type="cabinet"),
                DetectedItem(category="Medications", subcategory="Medicine Cabinet", quantity=20, confidence=0.75, pack_size=15, storage_type="cabinet"),
            ],
            RoomType.GARAGE: [
                DetectedItem(category="Tools", subcategory="Hand Tools", quantity=50, confidence=0.85, pack_size=15, storage_type="cabinet"),
                DetectedItem(category="Sports Equipment", subcategory="Sports Gear", quantity=8, confidence=0.90, pack_size=3, storage_type="visible"),
                DetectedItem(category="Seasonal Items", subcategory="Holiday Decorations", quantity=20, confidence=0.70, pack_size=5, storage_type="cabinet"),
                DetectedItem(category="Automotive", subcategory="Car Care Products", quantity=15, confidence=0.80, pack_size=10, storage_type="cabinet"),
            ],
        }

        # Return items for room type, or default to living room
        items = mock_data.get(room_type, mock_data[RoomType.LIVING_ROOM])

        # Add some randomization to quantities
        randomized_items = []
        for item in items:
            # Vary quantity by ±20%
            variance = random.uniform(0.8, 1.2)
            new_quantity = max(1, int(item.quantity * variance))

            randomized_items.append(
                DetectedItem(
                    category=item.category,
                    subcategory=item.subcategory,
                    quantity=new_quantity,
                    confidence=item.confidence,
                    pack_size=item.pack_size,
                    storage_type=item.storage_type
                )
            )

        return randomized_items

    async def analyze_photo(
        self,
        photo_url: str,
        room_type: RoomType,
        prompt: str
    ) -> SinglePhotoAnalysisResult:
        """
        Generate mock analysis result.

        Args:
            photo_url: URL of the photo (ignored)
            room_type: Type of room being analyzed
            prompt: Analysis prompt (ignored)

        Returns:
            Mock SinglePhotoAnalysisResult
        """
        self.call_count += 1
        logger.info(f"Mock analysis #{self.call_count} for {room_type} (photo: {photo_url[:50]}...)")

        # Generate mock items
        items = self._generate_mock_items(room_type)

        # Random density level
        density_levels = [DensityLevel.MINIMAL, DensityLevel.MODERATE, DensityLevel.FULL, DensityLevel.PACKED]
        density_level = random.choice(density_levels)

        # Calculate total boxes
        total_boxes = sum((item.quantity + item.pack_size - 1) // item.pack_size for item in items)

        # Mock detected features
        features = [
            f"{room_type}_feature_1",
            f"{room_type}_feature_2",
            "organized_storage" if random.random() > 0.5 else "cluttered_space"
        ]

        result = SinglePhotoAnalysisResult(
            items=items,
            density_level=density_level,
            detected_features=features,
            total_boxes_estimate=total_boxes,
            confidence_score=random.uniform(0.75, 0.95)
        )

        logger.debug(f"Mock result: {len(items)} items, {total_boxes} boxes, density={density_level}")
        return result

    async def analyze_batch(
        self,
        photo_urls: List[str],
        room_type: RoomType,
        prompt: str
    ) -> List[SinglePhotoAnalysisResult]:
        """
        Generate mock batch analysis results.

        Args:
            photo_urls: List of photo URLs (ignored)
            room_type: Type of room being analyzed
            prompt: Analysis prompt (ignored)

        Returns:
            List of mock SinglePhotoAnalysisResult
        """
        logger.info(f"Mock batch analysis for {len(photo_urls)} photos")

        results = []
        for url in photo_urls:
            result = await self.analyze_photo(url, room_type, prompt)
            results.append(result)

        return results
