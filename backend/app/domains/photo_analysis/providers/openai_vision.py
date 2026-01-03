"""
OpenAI GPT-4 Vision Provider

Implementation using OpenAI's GPT-4 Vision API for photo analysis.
"""

import asyncio
import logging
import json
from typing import List, Dict, Any
from io import BytesIO

from PIL import Image
import requests
from openai import OpenAI, AsyncOpenAI

from app.core.config import settings
from app.domains.photo_analysis.providers.base import PhotoAnalysisProvider
from app.domains.photo_analysis.schemas import SinglePhotoAnalysisResult, DetectedItem
from app.domains.pack_calculation.templates.base_template import RoomType, DensityLevel

logger = logging.getLogger(__name__)


class OpenAIVisionProvider(PhotoAnalysisProvider):
    """OpenAI GPT-4 Vision provider for photo analysis"""

    def __init__(self, api_key: str = None, model: str = None):
        """
        Initialize OpenAI Vision provider.

        Args:
            api_key: OpenAI API key (defaults to settings.OPENAI_API_KEY)
            model: Model to use (defaults to settings.PHOTO_ANALYSIS_MODEL or gpt-4-vision-preview)
        """
        self.api_key = api_key or getattr(settings, 'OPENAI_API_KEY', None)
        self.model = model or getattr(settings, 'PHOTO_ANALYSIS_MODEL', 'gpt-4-vision-preview')

        if not self.api_key:
            logger.warning("OpenAI API key not configured")
            self.client = None
            self.async_client = None
        else:
            self.client = OpenAI(api_key=self.api_key)
            self.async_client = AsyncOpenAI(api_key=self.api_key)

        # Configuration
        self.max_tokens = 1500
        self.target_image_size = (512, 512)  # Cost optimization
        self.max_retries = 3
        self.retry_delay = 1.0  # seconds

    def get_provider_name(self) -> str:
        """Get provider name"""
        return "OpenAI GPT-4 Vision"

    def is_available(self) -> bool:
        """Check if provider is available"""
        return self.api_key is not None and self.client is not None

    async def _optimize_image(self, photo_url: str) -> str:
        """
        Optimize image for cost efficiency by resizing to 512x512.

        Args:
            photo_url: URL of the image to optimize

        Returns:
            Optimized image data URL or original URL if optimization fails
        """
        try:
            # Download image
            response = requests.get(photo_url, timeout=10)
            response.raise_for_status()

            # Open and resize image
            img = Image.open(BytesIO(response.content))
            img.thumbnail(self.target_image_size, Image.Resampling.LANCZOS)

            # Convert to RGB if necessary (remove alpha channel)
            if img.mode in ('RGBA', 'LA', 'P'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
                img = background

            # For now, return original URL as OpenAI accepts URLs directly
            # In production, you might want to upload optimized image to storage
            logger.debug(f"Image optimized from {response.content.__sizeof__()} bytes")
            return photo_url

        except Exception as e:
            logger.warning(f"Image optimization failed, using original: {e}")
            return photo_url

    async def _parse_json_response(self, content: str) -> Dict[str, Any]:
        """
        Parse JSON response from OpenAI, handling various formats.

        Args:
            content: Response content from OpenAI

        Returns:
            Parsed JSON dictionary
        """
        try:
            # Try direct JSON parse
            return json.loads(content)
        except json.JSONDecodeError:
            # Try to extract JSON from markdown code blocks
            if "```json" in content:
                start = content.find("```json") + 7
                end = content.find("```", start)
                json_str = content[start:end].strip()
                return json.loads(json_str)
            elif "```" in content:
                start = content.find("```") + 3
                end = content.find("```", start)
                json_str = content[start:end].strip()
                return json.loads(json_str)
            else:
                # Last resort: try to find any JSON-like structure
                start = content.find("{")
                end = content.rfind("}") + 1
                if start >= 0 and end > start:
                    json_str = content[start:end]
                    return json.loads(json_str)
                raise

    async def analyze_photo(
        self,
        photo_url: str,
        room_type: RoomType,
        prompt: str
    ) -> SinglePhotoAnalysisResult:
        """
        Analyze a single photo using OpenAI GPT-4 Vision.

        Args:
            photo_url: URL of the photo to analyze
            room_type: Type of room being analyzed
            prompt: Analysis prompt to use

        Returns:
            SinglePhotoAnalysisResult with detected items
        """
        if not self.is_available():
            raise ValueError("OpenAI Vision provider not available - API key not configured")

        # Optimize image (currently just validates URL)
        optimized_url = await self._optimize_image(photo_url)

        # Retry logic with exponential backoff
        last_exception = None
        for attempt in range(self.max_retries):
            try:
                logger.info(f"Analyzing photo with OpenAI Vision (attempt {attempt + 1}/{self.max_retries})")

                response = await self.async_client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": prompt},
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": optimized_url,
                                        "detail": "low"  # Cost optimization
                                    }
                                }
                            ]
                        }
                    ],
                    max_tokens=self.max_tokens,
                    temperature=0.2,  # Low temperature for more consistent results
                )

                # Extract response
                content = response.choices[0].message.content
                logger.debug(f"OpenAI raw response: {content[:200]}...")

                # Parse JSON response
                result_data = await self._parse_json_response(content)

                # Convert to SinglePhotoAnalysisResult
                items = [
                    DetectedItem(**item) for item in result_data.get("items", [])
                ]

                result = SinglePhotoAnalysisResult(
                    items=items,
                    density_level=DensityLevel(result_data.get("density_level", "moderate")),
                    detected_features=result_data.get("detected_features", []),
                    total_boxes_estimate=result_data.get("total_boxes_estimate", 0),
                    confidence_score=result_data.get("confidence_score", 0.5)
                )

                logger.info(f"Successfully analyzed photo: {len(items)} items detected")
                return result

            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse JSON response: {e}")
                logger.error(f"Response content: {content}")
                last_exception = e

            except Exception as e:
                logger.error(f"Error analyzing photo (attempt {attempt + 1}): {e}")
                last_exception = e

                # Exponential backoff
                if attempt < self.max_retries - 1:
                    wait_time = self.retry_delay * (2 ** attempt)
                    logger.info(f"Retrying in {wait_time} seconds...")
                    await asyncio.sleep(wait_time)

        # All retries failed
        logger.error(f"Failed to analyze photo after {self.max_retries} attempts")
        raise Exception(f"Photo analysis failed: {last_exception}")

    async def analyze_batch(
        self,
        photo_urls: List[str],
        room_type: RoomType,
        prompt: str
    ) -> List[SinglePhotoAnalysisResult]:
        """
        Analyze multiple photos in batch.

        For OpenAI Vision, we analyze each photo independently as the API
        doesn't support true batch processing of multiple images in one call.

        Args:
            photo_urls: List of photo URLs to analyze
            room_type: Type of room being analyzed
            prompt: Analysis prompt to use

        Returns:
            List of SinglePhotoAnalysisResult for each photo
        """
        logger.info(f"Analyzing batch of {len(photo_urls)} photos")

        # Analyze photos concurrently
        tasks = [
            self.analyze_photo(url, room_type, prompt)
            for url in photo_urls
        ]

        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Handle any failures
        successful_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Failed to analyze photo {i + 1}: {result}")
                # Create empty result for failed analysis
                successful_results.append(
                    SinglePhotoAnalysisResult(
                        items=[],
                        density_level=DensityLevel.MODERATE,
                        detected_features=[],
                        total_boxes_estimate=0,
                        confidence_score=0.0
                    )
                )
            else:
                successful_results.append(result)

        logger.info(f"Batch analysis complete: {len(successful_results)} results")
        return successful_results
