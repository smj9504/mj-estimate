"""
Material Detection Provider Base Interface

Abstract base class for all material detection providers.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional
from pathlib import Path
import logging

logger = logging.getLogger(__name__)


class MaterialDetectionProvider(ABC):
    """
    Abstract base class for material detection providers.

    All material detection providers (Roboflow, Google Vision, Custom models)
    must implement this interface.
    """

    @abstractmethod
    async def detect(
        self,
        image_path: str,
        confidence_threshold: float = 0.7,
        options: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Detect materials in an image.

        Args:
            image_path: Path to image file (local or URL)
            confidence_threshold: Minimum confidence score (0.0-1.0)
            options: Provider-specific options

        Returns:
            {
                "materials": [
                    {
                        "category": "Hardwood Flooring",
                        "type": "White Oak",  # Optional, may be None
                        "grade": "Natural #1",  # Optional, may be None
                        "finish": "Solid",  # Optional, may be None
                        "confidence": 0.91,
                        "bounding_box": {
                            "x": 100,
                            "y": 200,
                            "width": 300,
                            "height": 400
                        }
                    },
                    ...
                ],
                "processing_time_ms": 250,
                "raw_response": {...}  # Full provider response for debugging
            }

        Raises:
            ValueError: If image path is invalid or options are incorrect
            ConnectionError: If provider API is unavailable
            TimeoutError: If detection times out
        """
        pass

    @abstractmethod
    def get_provider_name(self) -> str:
        """
        Get the name of this provider.

        Returns:
            Provider name (e.g., 'roboflow', 'google_vision', 'custom_vit')
        """
        pass

    @abstractmethod
    async def health_check(self) -> bool:
        """
        Check if the provider is available and healthy.

        Returns:
            True if provider is available, False otherwise
        """
        pass

    def validate_image_path(self, image_path: str) -> bool:
        """
        Validate that image path exists and is accessible.

        Args:
            image_path: Path to image file

        Returns:
            True if valid, False otherwise
        """
        if image_path.startswith(('http://', 'https://')):
            # URL validation - assume valid if properly formatted
            return True

        # Local file validation
        path = Path(image_path)
        if not path.exists():
            logger.error(f"Image file not found: {image_path}")
            return False

        if not path.is_file():
            logger.error(f"Path is not a file: {image_path}")
            return False

        # Check file extension
        valid_extensions = {'.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.webp'}
        if path.suffix.lower() not in valid_extensions:
            logger.error(f"Invalid image format: {path.suffix}")
            return False

        return True

    def validate_confidence_threshold(self, threshold: float) -> bool:
        """
        Validate confidence threshold value.

        Args:
            threshold: Confidence threshold (0.0-1.0)

        Returns:
            True if valid, False otherwise
        """
        if not isinstance(threshold, (int, float)):
            logger.error(f"Confidence threshold must be numeric, got {type(threshold)}")
            return False

        if not (0.0 <= threshold <= 1.0):
            logger.error(f"Confidence threshold must be between 0.0 and 1.0, got {threshold}")
            return False

        return True

    async def batch_detect(
        self,
        image_paths: List[str],
        confidence_threshold: float = 0.7,
        options: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Detect materials in multiple images (sequential by default).

        Subclasses can override for parallel processing if supported.

        Args:
            image_paths: List of image paths
            confidence_threshold: Minimum confidence score
            options: Provider-specific options

        Returns:
            List of detection results, one per image
        """
        results = []
        for image_path in image_paths:
            try:
                result = await self.detect(image_path, confidence_threshold, options)
                results.append(result)
            except Exception as e:
                logger.error(f"Detection failed for {image_path}: {e}")
                results.append({
                    "error": str(e),
                    "image_path": image_path,
                    "materials": [],
                    "processing_time_ms": 0
                })

        return results

    def get_supported_formats(self) -> List[str]:
        """
        Get list of supported image formats.

        Returns:
            List of supported file extensions (e.g., ['.jpg', '.png'])
        """
        return ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.webp']

    def get_capabilities(self) -> Dict[str, Any]:
        """
        Get provider capabilities and limitations.

        Returns:
            {
                "max_image_size_mb": 10,
                "max_batch_size": 10,
                "supports_bounding_boxes": True,
                "supports_fine_grained_classification": False,
                "rate_limit_per_minute": 60
            }
        """
        return {
            "max_image_size_mb": 10,
            "max_batch_size": 10,
            "supports_bounding_boxes": True,
            "supports_fine_grained_classification": False,
            "rate_limit_per_minute": 60
        }
