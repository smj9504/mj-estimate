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
import tempfile
import os
from pathlib import Path

logger = logging.getLogger(__name__)


class RoboflowProvider(MaterialDetectionProvider):
    """
    Roboflow API provider for material detection.

    Uses pre-trained construction materials detection models from Roboflow Universe.
    """

    def __init__(self):
        """Initialize Roboflow provider with Inference SDK."""
        if not settings.ROBOFLOW_API_KEY:
            raise ValueError("ROBOFLOW_API_KEY not configured in environment")

        self.api_key = settings.ROBOFLOW_API_KEY

        # Use a public pre-trained model from Roboflow Universe
        # Format: project-id/version (no workspace prefix)
        # Using Construction Site Safety model (717 images, v27 YOLOv8s, August 2024)
        self.model_id = "construction-site-safety/27"

        # Initialize Inference client
        from inference_sdk import InferenceHTTPClient
        self.client = InferenceHTTPClient(
            api_url="https://detect.roboflow.com",
            api_key=self.api_key
        )

        logger.info(f"Roboflow Inference provider initialized with model: {self.model_id}")

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
        temp_file = None

        try:
            # Download image if needed
            if image_path.startswith('gs://'):
                logger.info(f"Downloading from GCS: {image_path}")
                temp_file = await self._download_from_gcs(image_path)
                file_to_use = temp_file
            elif image_path.startswith(('http://', 'https://')):
                logger.info(f"Downloading from URL: {image_path}")
                import httpx
                async with httpx.AsyncClient(timeout=30.0) as client:
                    temp_file = await self._download_from_url(client, image_path)
                file_to_use = temp_file
            else:
                file_to_use = image_path

            # Use Inference SDK to infer
            logger.info(f"Running Roboflow inference on: {file_to_use}")

            # Convert async to sync for Inference SDK (SDK is synchronous)
            import asyncio
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                lambda: self.client.infer(
                    file_to_use,
                    model_id=self.model_id
                )
            )

            logger.info(f"Roboflow inference completed: {len(result.get('predictions', []))} detections")
            logger.debug(f"Roboflow raw response: {result}")

            # Parse Roboflow response
            materials = self._parse_roboflow_response(result, confidence_threshold)

            processing_time = int((time.time() - start_time) * 1000)

            return {
                "materials": materials,
                "processing_time_ms": processing_time,
                "raw_response": result
            }

        except Exception as e:
            logger.error(f"Roboflow detection failed: {e}", exc_info=True)
            raise
        finally:
            # Clean up temporary file if we created one
            if temp_file and os.path.exists(temp_file):
                try:
                    os.unlink(temp_file)
                    logger.debug(f"Cleaned up temporary file: {temp_file}")
                except Exception as cleanup_error:
                    logger.warning(f"Failed to clean up temp file {temp_file}: {cleanup_error}")

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

    async def _download_from_gcs(self, gcs_url: str) -> str:
        """
        Download image from Google Cloud Storage to temporary file.

        Args:
            gcs_url: GCS URL (gs://bucket-name/path/to/file)

        Returns:
            Path to temporary file
        """
        try:
            from google.cloud import storage
            from google.oauth2 import service_account

            # Parse GCS URL: gs://bucket-name/path/to/file
            url_parts = gcs_url.replace('gs://', '').split('/', 1)
            bucket_name = url_parts[0]
            blob_path = url_parts[1] if len(url_parts) > 1 else ''

            # Initialize GCS client with authentication
            service_account_file = settings.GCS_SERVICE_ACCOUNT_FILE
            if service_account_file and os.path.exists(service_account_file):
                credentials = service_account.Credentials.from_service_account_file(
                    service_account_file
                )
                storage_client = storage.Client(
                    credentials=credentials,
                    project=credentials.project_id
                )
                logger.debug(f"Using service account from {service_account_file}")
            else:
                # Fallback to default credentials
                storage_client = storage.Client()
                logger.debug("Using default GCS credentials")

            bucket = storage_client.bucket(bucket_name)
            blob = bucket.blob(blob_path)

            # Get file extension
            file_ext = Path(blob_path).suffix or '.jpg'

            # Create temporary file
            temp_fd, temp_path = tempfile.mkstemp(suffix=file_ext)
            os.close(temp_fd)

            # Download to temporary file
            blob.download_to_filename(temp_path)
            logger.info(f"Downloaded from GCS: {gcs_url} -> {temp_path}")

            return temp_path

        except Exception as e:
            logger.error(f"Failed to download from GCS {gcs_url}: {e}")
            raise ConnectionError(f"GCS download failed: {e}")

    async def _download_from_url(self, client: httpx.AsyncClient, url: str) -> str:
        """
        Download image from HTTP(S) URL to temporary file.

        Args:
            client: HTTPX client
            url: HTTP(S) URL

        Returns:
            Path to temporary file
        """
        try:
            # Download image
            response = await client.get(url)
            response.raise_for_status()

            # Get file extension from URL or content-type
            file_ext = Path(url).suffix or '.jpg'
            content_type = response.headers.get('content-type', '')
            if 'image/png' in content_type:
                file_ext = '.png'
            elif 'image/webp' in content_type:
                file_ext = '.webp'

            # Create temporary file
            temp_fd, temp_path = tempfile.mkstemp(suffix=file_ext)

            # Write content to temporary file
            with os.fdopen(temp_fd, 'wb') as f:
                f.write(response.content)

            logger.info(f"Downloaded from URL: {url} -> {temp_path}")

            return temp_path

        except Exception as e:
            logger.error(f"Failed to download from URL {url}: {e}")
            raise ConnectionError(f"URL download failed: {e}")
