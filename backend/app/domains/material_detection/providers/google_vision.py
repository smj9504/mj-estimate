"""
Google Cloud Vision Material Detection Provider

Integrates with Google Cloud Vision API for material detection (fallback provider).
"""

from .base import MaterialDetectionProvider
from app.core.config import settings
import logging
import time
from typing import Dict, Any, Optional
from pathlib import Path

logger = logging.getLogger(__name__)


class GoogleVisionProvider(MaterialDetectionProvider):
    """
    Google Cloud Vision API provider for material detection.

    Uses label detection and object localization as a fallback provider.
    Note: Google Vision provides general object detection, not specialized
    construction material detection, so results may be less accurate.
    """

    def __init__(self):
        """Initialize Google Vision provider with credentials."""
        if not settings.GOOGLE_CLOUD_VISION_KEY:
            raise ValueError("GOOGLE_CLOUD_VISION_KEY not configured")

        try:
            from google.cloud import vision
            import os

            # Set credentials path
            credentials_path = Path(settings.GOOGLE_CLOUD_VISION_KEY)
            if credentials_path.exists():
                os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = str(credentials_path)
            else:
                logger.warning(f"Google Cloud credentials file not found: {credentials_path}")

            self.client = vision.ImageAnnotatorClient()
            logger.info("Google Vision provider initialized")

        except ImportError:
            logger.error("google-cloud-vision package not installed")
            raise ValueError("google-cloud-vision package required")
        except Exception as e:
            logger.error(f"Failed to initialize Google Vision client: {e}")
            raise

    async def detect(
        self,
        image_path: str,
        confidence_threshold: float = 0.7,
        options: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Detect materials using Google Cloud Vision API.

        Args:
            image_path: Path to image file (local only, URLs not supported)
            confidence_threshold: Minimum confidence score (0.0-1.0)
            options: Additional options (max_results)

        Returns:
            Detection results with materials list
        """
        if not self.validate_image_path(image_path):
            raise ValueError(f"Invalid image path: {image_path}")

        if image_path.startswith(('http://', 'https://')):
            raise ValueError("Google Vision provider only supports local files")

        if not self.validate_confidence_threshold(confidence_threshold):
            raise ValueError(f"Invalid confidence threshold: {confidence_threshold}")

        start_time = time.time()

        try:
            from google.cloud import vision

            # Read image file
            with open(image_path, 'rb') as image_file:
                content = image_file.read()

            image = vision.Image(content=content)

            # Perform label detection and object localization
            label_response = self.client.label_detection(image=image)
            object_response = self.client.object_localization(image=image)

            # Parse responses
            materials = self._parse_google_vision_response(
                label_response,
                object_response,
                confidence_threshold
            )

            processing_time = int((time.time() - start_time) * 1000)

            return {
                "materials": materials,
                "processing_time_ms": processing_time,
                "raw_response": {
                    "labels": [
                        {"description": label.description, "score": label.score}
                        for label in label_response.label_annotations
                    ],
                    "objects": [
                        {
                            "name": obj.name,
                            "score": obj.score,
                            "bounding_box": [
                                {"x": vertex.x, "y": vertex.y}
                                for vertex in obj.bounding_poly.normalized_vertices
                            ]
                        }
                        for obj in object_response.localized_object_annotations
                    ]
                }
            }

        except Exception as e:
            logger.error(f"Google Vision detection failed: {e}")
            raise

    def _parse_google_vision_response(
        self,
        label_response,
        object_response,
        confidence_threshold: float
    ) -> list:
        """
        Parse Google Vision API responses into standardized format.

        Args:
            label_response: Label detection response
            object_response: Object localization response
            confidence_threshold: Minimum confidence score

        Returns:
            List of detected materials
        """
        materials = []

        # Material keywords mapping
        material_keywords = {
            "wood": ["Hardwood Flooring", "Wood"],
            "floor": ["Flooring", None],
            "tile": ["Tile Flooring", "Tile"],
            "carpet": ["Carpet", None],
            "concrete": ["Concrete", None],
            "brick": ["Brick", None],
            "drywall": ["Drywall", None],
            "metal": ["Metal", None],
            "stone": ["Stone", None],
            "glass": ["Glass", None]
        }

        # Process object localizations (with bounding boxes)
        for obj in object_response.localized_object_annotations:
            if obj.score < confidence_threshold:
                continue

            category, type_info = self._map_to_material_category(obj.name, material_keywords)

            if category:
                # Convert normalized vertices to pixel coordinates
                vertices = obj.bounding_poly.normalized_vertices
                x_coords = [v.x for v in vertices]
                y_coords = [v.y for v in vertices]

                material = {
                    "category": category,
                    "type": type_info,
                    "grade": None,
                    "finish": None,
                    "confidence": obj.score,
                    "bounding_box": {
                        "x": int(min(x_coords) * 1000),  # Normalized to pixels (estimate)
                        "y": int(min(y_coords) * 1000),
                        "width": int((max(x_coords) - min(x_coords)) * 1000),
                        "height": int((max(y_coords) - min(y_coords)) * 1000)
                    }
                }
                materials.append(material)

        # Process labels (without bounding boxes) if no objects found
        if not materials:
            for label in label_response.label_annotations[:5]:  # Top 5 labels
                if label.score < confidence_threshold:
                    continue

                category, type_info = self._map_to_material_category(
                    label.description,
                    material_keywords
                )

                if category:
                    material = {
                        "category": category,
                        "type": type_info,
                        "grade": None,
                        "finish": None,
                        "confidence": label.score,
                        "bounding_box": None  # Labels don't have bounding boxes
                    }
                    materials.append(material)

        return materials

    def _map_to_material_category(
        self,
        label: str,
        material_keywords: Dict[str, list]
    ) -> tuple:
        """
        Map Google Vision label to material category.

        Args:
            label: Label from Google Vision
            material_keywords: Mapping of keywords to material categories

        Returns:
            Tuple of (category, type)
        """
        label_lower = label.lower()

        for keyword, (category, type_info) in material_keywords.items():
            if keyword in label_lower:
                return category, type_info

        # Default: return label as category if it seems relevant
        construction_related = ["floor", "wall", "ceiling", "material", "surface"]
        if any(word in label_lower for word in construction_related):
            return label.title(), None

        return None, None

    def get_provider_name(self) -> str:
        """Return provider name."""
        return "google_vision"

    async def health_check(self) -> bool:
        """
        Check if Google Vision API is accessible.

        Returns:
            True if API is available, False otherwise
        """
        try:
            # Verify client is initialized
            if not hasattr(self, 'client'):
                return False

            # Optionally, make a test request
            # For now, just verify client exists
            return True

        except Exception as e:
            logger.error(f"Google Vision health check failed: {e}")
            return False

    def get_capabilities(self) -> Dict[str, Any]:
        """Get Google Vision provider capabilities."""
        return {
            "max_image_size_mb": 20,
            "max_batch_size": 1,
            "supports_bounding_boxes": True,  # Via object localization
            "supports_fine_grained_classification": False,
            "rate_limit_per_minute": 1800,  # 1800 requests/minute (free tier)
            "supported_materials": [
                "wood", "floor", "tile", "carpet", "concrete",
                "brick", "drywall", "metal", "stone", "glass"
            ]
        }
