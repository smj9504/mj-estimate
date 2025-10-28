"""
Roboflow Material Detection Provider

Integrates with Roboflow API for construction material detection.
"""

from .base import MaterialDetectionProvider
from app.core.config import settings
import logging
import time
from typing import Dict, Any, Optional
import httpx

logger = logging.getLogger(__name__)


class RoboflowProvider(MaterialDetectionProvider):
    """
    Roboflow API provider for material detection.

    Uses pre-trained construction materials detection models from Roboflow Universe.
    """

    def __init__(self):
        """Initialize Roboflow provider with API credentials."""
        if not settings.ROBOFLOW_API_KEY:
            raise ValueError("ROBOFLOW_API_KEY not configured in environment")

        self.api_key = settings.ROBOFLOW_API_KEY
        self.workspace = settings.ROBOFLOW_WORKSPACE
        self.model_id = settings.ROBOFLOW_MODEL_ID
        self.model_version = getattr(settings, 'ROBOFLOW_MODEL_VERSION', '1')

        # Roboflow API endpoint
        self.api_url = f"https://detect.roboflow.com/{self.workspace}/{self.model_id}/{self.model_version}"

        logger.info(f"Roboflow provider initialized: {self.workspace}/{self.model_id}/v{self.model_version}")

    async def detect(
        self,
        image_path: str,
        confidence_threshold: float = 0.7,
        options: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Detect materials using Roboflow API.

        Args:
            image_path: Path to image file or URL
            confidence_threshold: Minimum confidence score (0.0-1.0)
            options: Additional options (overlap_threshold, max_predictions)

        Returns:
            Detection results with materials list and metadata
        """
        if not self.validate_image_path(image_path):
            raise ValueError(f"Invalid image path: {image_path}")

        if not self.validate_confidence_threshold(confidence_threshold):
            raise ValueError(f"Invalid confidence threshold: {confidence_threshold}")

        start_time = time.time()

        try:
            # Prepare request parameters
            params = {
                "api_key": self.api_key,
                "confidence": int(confidence_threshold * 100),  # Roboflow uses 0-100
            }

            # Add optional parameters
            if options:
                if "overlap_threshold" in options:
                    params["overlap"] = int(options["overlap_threshold"] * 100)
                if "max_predictions" in options:
                    params["max_objects"] = options["max_predictions"]

            # Make API request
            async with httpx.AsyncClient(timeout=30.0) as client:
                if image_path.startswith(('http://', 'https://')):
                    # Image URL
                    params["image"] = image_path
                    response = await client.post(self.api_url, params=params)
                else:
                    # Local file upload
                    with open(image_path, 'rb') as image_file:
                        files = {'file': image_file}
                        response = await client.post(self.api_url, params=params, files=files)

            response.raise_for_status()
            result = response.json()

            # Parse Roboflow response
            materials = self._parse_roboflow_response(result, confidence_threshold)

            processing_time = int((time.time() - start_time) * 1000)

            return {
                "materials": materials,
                "processing_time_ms": processing_time,
                "raw_response": result
            }

        except httpx.HTTPError as e:
            logger.error(f"Roboflow API request failed: {e}")
            raise ConnectionError(f"Roboflow API error: {e}")
        except Exception as e:
            logger.error(f"Roboflow detection failed: {e}")
            raise

    def _parse_roboflow_response(
        self,
        result: Dict[str, Any],
        confidence_threshold: float
    ) -> list:
        """
        Parse Roboflow API response into standardized format.

        Args:
            result: Raw Roboflow API response
            confidence_threshold: Filter predictions below this threshold

        Returns:
            List of detected materials
        """
        materials = []

        predictions = result.get('predictions', [])

        for prediction in predictions:
            confidence = prediction.get('confidence', 0)

            # Filter by confidence threshold
            if confidence < confidence_threshold:
                continue

            # Extract material information
            class_name = prediction.get('class', 'Unknown')

            # Parse class name for material details
            # Roboflow typically returns: "material_category" or "category-subcategory"
            category, type_info = self._parse_class_name(class_name)

            material = {
                "category": category,
                "type": type_info,  # May be None
                "grade": None,  # Roboflow doesn't provide grade by default
                "finish": None,  # Roboflow doesn't provide finish by default
                "confidence": confidence,
                "bounding_box": {
                    "x": int(prediction.get('x', 0)),
                    "y": int(prediction.get('y', 0)),
                    "width": int(prediction.get('width', 0)),
                    "height": int(prediction.get('height', 0))
                }
            }

            materials.append(material)

        return materials

    def _parse_class_name(self, class_name: str) -> tuple:
        """
        Parse Roboflow class name into category and type.

        Args:
            class_name: Class name from Roboflow (e.g., "hardwood-flooring", "oak-flooring")

        Returns:
            Tuple of (category, type)
        """
        # Common separators
        separators = ['-', '_', ' ']

        for sep in separators:
            if sep in class_name:
                parts = class_name.split(sep)
                if len(parts) >= 2:
                    category = ' '.join(parts[:-1]).title()
                    type_info = parts[-1].title()
                    return category, type_info

        # No separator found, return as category only
        return class_name.title(), None

    def get_provider_name(self) -> str:
        """Return provider name."""
        return "roboflow"

    async def health_check(self) -> bool:
        """
        Check if Roboflow API is accessible.

        Returns:
            True if API is available, False otherwise
        """
        try:
            # Simple health check - verify API key format
            if not self.api_key or len(self.api_key) < 10:
                logger.error("Invalid Roboflow API key")
                return False

            # Optionally, make a test request to verify API access
            # For now, just verify configuration
            return True

        except Exception as e:
            logger.error(f"Roboflow health check failed: {e}")
            return False

    def get_capabilities(self) -> Dict[str, Any]:
        """Get Roboflow provider capabilities."""
        return {
            "max_image_size_mb": 10,
            "max_batch_size": 1,  # Roboflow processes one image per request
            "supports_bounding_boxes": True,
            "supports_fine_grained_classification": False,  # Limited to class names
            "rate_limit_per_minute": 60,  # Depends on plan
            "supported_materials": [
                "hardwood", "tile", "carpet", "vinyl", "laminate",
                "concrete", "brick", "drywall", "wood", "metal"
            ]
        }
