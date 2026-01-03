"""
Multi-Photo Aggregator

Logic for combining and deduplicating results from multiple photos of the same room.
"""

import logging
from typing import List, Dict
from collections import defaultdict

from app.domains.photo_analysis.schemas import SinglePhotoAnalysisResult, DetectedItem
from app.domains.pack_calculation.templates.base_template import DensityLevel

logger = logging.getLogger(__name__)


class PhotoResultAggregator:
    """Aggregates results from multiple photos of the same room"""

    @staticmethod
    def _create_item_key(item: DetectedItem) -> str:
        """
        Create a unique key for an item to enable deduplication.

        Args:
            item: DetectedItem to create key for

        Returns:
            String key for deduplication
        """
        # Use category and subcategory as the key
        return f"{item.category}|{item.subcategory or 'none'}"

    @staticmethod
    def aggregate_results(results: List[SinglePhotoAnalysisResult]) -> Dict:
        """
        Combine results from multiple photos into a single aggregated result.

        Deduplication logic:
        - Same item in multiple photos → keep highest confidence, average quantity
        - Different items → combine all
        - Density level → use most common or highest
        - Features → deduplicate and combine
        - Total boxes → recalculate from aggregated items

        Args:
            results: List of SinglePhotoAnalysisResult from individual photos

        Returns:
            Dictionary with aggregated results
        """
        if not results:
            logger.warning("No results to aggregate")
            return {
                "items": [],
                "density_level": DensityLevel.MODERATE,
                "detected_features": [],
                "total_boxes": 0,
                "confidence_score": 0.0
            }

        if len(results) == 1:
            # Single photo - no aggregation needed
            result = results[0]
            return {
                "items": result.items,
                "density_level": result.density_level,
                "detected_features": result.detected_features,
                "total_boxes": result.total_boxes_estimate,
                "confidence_score": result.confidence_score
            }

        logger.info(f"Aggregating {len(results)} photo analysis results")

        # Aggregate items by category/subcategory
        item_groups: Dict[str, List[DetectedItem]] = defaultdict(list)
        all_features = set()
        density_votes = []
        confidence_scores = []

        for result in results:
            # Group items by key
            for item in result.items:
                key = PhotoResultAggregator._create_item_key(item)
                item_groups[key].append(item)

            # Collect features
            all_features.update(result.detected_features)

            # Collect density votes
            density_votes.append(result.density_level)

            # Collect confidence scores
            confidence_scores.append(result.confidence_score)

        # Aggregate items
        aggregated_items = []
        for key, items in item_groups.items():
            # Take the highest confidence item as the base
            best_item = max(items, key=lambda x: x.confidence)

            # Average the quantities (some items may appear in multiple photos)
            # Use weighted average based on confidence
            total_confidence = sum(item.confidence for item in items)
            weighted_quantity = sum(
                item.quantity * (item.confidence / total_confidence)
                for item in items
            )

            # Round to nearest integer
            aggregated_quantity = max(1, round(weighted_quantity))

            # Average confidence
            avg_confidence = sum(item.confidence for item in items) / len(items)

            aggregated_items.append(
                DetectedItem(
                    category=best_item.category,
                    subcategory=best_item.subcategory,
                    quantity=aggregated_quantity,
                    confidence=round(avg_confidence, 2),
                    pack_size=best_item.pack_size,
                    storage_type=best_item.storage_type
                )
            )

        # Determine overall density level
        # Use weighted voting based on confidence scores
        density_weights = {
            DensityLevel.MINIMAL: 0,
            DensityLevel.MODERATE: 0,
            DensityLevel.FULL: 0,
            DensityLevel.PACKED: 0
        }

        for i, density in enumerate(density_votes):
            weight = confidence_scores[i]
            density_weights[density] += weight

        aggregated_density = max(density_weights.items(), key=lambda x: x[1])[0]

        # Calculate total boxes from aggregated items
        total_boxes = sum(
            (item.quantity + item.pack_size - 1) // item.pack_size
            for item in aggregated_items
        )

        # Average confidence score
        aggregated_confidence = sum(confidence_scores) / len(confidence_scores)

        # Sort items by category for consistent output
        aggregated_items.sort(key=lambda x: (x.category, x.subcategory or ""))

        logger.info(
            f"Aggregation complete: {len(aggregated_items)} unique items, "
            f"{total_boxes} boxes, density={aggregated_density}"
        )

        return {
            "items": aggregated_items,
            "density_level": aggregated_density,
            "detected_features": sorted(list(all_features)),
            "total_boxes": total_boxes,
            "confidence_score": round(aggregated_confidence, 2)
        }

    @staticmethod
    def calculate_confidence_boost(num_photos: int) -> float:
        """
        Calculate confidence boost from multiple photos.

        More photos = higher confidence in results.

        Args:
            num_photos: Number of photos analyzed

        Returns:
            Confidence multiplier (1.0 - 1.3)
        """
        if num_photos == 1:
            return 1.0
        elif num_photos == 2:
            return 1.05
        elif num_photos == 3:
            return 1.10
        elif num_photos <= 5:
            return 1.15
        elif num_photos <= 7:
            return 1.20
        else:
            return 1.25  # Max boost for 8+ photos

    @staticmethod
    def adjust_confidence(base_confidence: float, num_photos: int) -> float:
        """
        Adjust confidence score based on number of photos.

        Args:
            base_confidence: Base confidence from aggregation
            num_photos: Number of photos used

        Returns:
            Adjusted confidence score (capped at 0.98)
        """
        boost = PhotoResultAggregator.calculate_confidence_boost(num_photos)
        adjusted = base_confidence * boost
        return min(0.98, adjusted)  # Cap at 0.98 to indicate AI uncertainty
