"""
OpenAI GPT-4 Vision Provider

Implementation using OpenAI's GPT-4 Vision API for photo analysis.
"""

import asyncio
import logging
import json
import base64
import re
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
        # Note: gpt-4-vision-preview is deprecated, use gpt-4o which has vision capabilities
        self.model = model or getattr(settings, 'PHOTO_ANALYSIS_MODEL', 'gpt-4o')

        if not self.api_key:
            logger.warning("OpenAI API key not configured")
            self.client = None
            self.async_client = None
        else:
            self.client = OpenAI(api_key=self.api_key)
            self.async_client = AsyncOpenAI(api_key=self.api_key)

        # Configuration
        self.max_tokens = 2000
        self.target_image_size = (1024, 1024)  # Larger size for better analysis quality
        self.max_retries = 3
        self.retry_delay = 1.0  # seconds

    def get_provider_name(self) -> str:
        """Get provider name"""
        return "OpenAI GPT-4 Vision"

    def is_available(self) -> bool:
        """Check if provider is available"""
        return self.api_key is not None and self.client is not None

    def _is_localhost_url(self, url: str) -> bool:
        """Check if URL is a localhost/internal URL that OpenAI cannot access."""
        localhost_indicators = ['localhost', '127.0.0.1', '0.0.0.0', '192.168.', '10.', '172.']
        return any(indicator in url.lower() for indicator in localhost_indicators)

    async def _optimize_image(self, photo_url: str) -> str:
        """
        Optimize image and convert to base64 data URL for OpenAI Vision API.

        For localhost/internal URLs, reads file directly from storage to avoid
        HTTP deadlock where backend would call itself.

        Args:
            photo_url: URL of the image to optimize

        Returns:
            Base64 data URL (data:image/jpeg;base64,...) for local images,
            or original URL for publicly accessible images
        """
        try:
            # For localhost URLs, we MUST convert to base64 since OpenAI cannot access them
            is_localhost = self._is_localhost_url(photo_url)

            # Get image bytes
            if is_localhost:
                # Extract file_id from URL pattern: /api/files/preview/{file_id}
                file_id_match = re.search(r'/api/files/preview/([0-9a-f-]+)', photo_url)
                if not file_id_match:
                    raise ValueError(f"Cannot extract file_id from localhost URL: {photo_url}")

                file_id = file_id_match.group(1)
                logger.info(f"Localhost URL detected - reading file directly: file_id={file_id}")

                # Get file record from database to find actual storage path
                from app.domains.file.repository import FileRepository
                from app.core.database_factory import get_database
                from app.core.config import settings
                from pathlib import Path

                db = get_database()
                with db.get_session() as session:
                    file_repo = FileRepository(session)
                    file_record = file_repo.get_by_id(file_id)

                    if not file_record:
                        raise ValueError(f"File not found in database: {file_id}")

                    # Handle both dict and model object
                    relative_path = file_record['url'] if isinstance(file_record, dict) else file_record.url
                    logger.info(f"Found file path from database: {relative_path}")

                # Read file directly from filesystem
                # Construct full path: base_dir + relative_path
                storage_base = Path(settings.STORAGE_BASE_DIR or "uploads")
                full_path = storage_base / relative_path

                try:
                    if not full_path.exists():
                        raise FileNotFoundError(f"File not found at path: {full_path}")

                    with open(full_path, 'rb') as f:
                        image_bytes = f.read()
                    logger.info(f"Successfully read {len(image_bytes)} bytes from {full_path}")
                except Exception as file_error:
                    logger.error(f"File read failed: {file_error}")
                    raise ValueError(f"Cannot read file: {file_error}")
            else:
                # For external URLs, download via HTTP
                logger.info(f"External URL detected - downloading via HTTP: {photo_url}")
                response = requests.get(photo_url, timeout=30)
                response.raise_for_status()
                image_bytes = response.content

            # Open and resize image for cost optimization
            img = Image.open(BytesIO(image_bytes))
            original_size = img.size
            img.thumbnail(self.target_image_size, Image.Resampling.LANCZOS)

            # Convert to RGB if necessary (remove alpha channel)
            if img.mode in ('RGBA', 'LA', 'P'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
                img = background

            # Convert to base64 data URL
            buffer = BytesIO()
            img.save(buffer, format='JPEG', quality=85)
            buffer.seek(0)
            base64_data = base64.b64encode(buffer.read()).decode('utf-8')

            data_url = f"data:image/jpeg;base64,{base64_data}"

            logger.info(f"Image converted to base64: {original_size} -> {img.size}, "
                       f"data URL length: {len(data_url)} chars")

            return data_url

        except Exception as e:
            logger.error(f"Image optimization/base64 conversion failed: {e}")
            # If conversion fails and it's not a localhost URL, try returning original
            if not self._is_localhost_url(photo_url):
                logger.warning("Falling back to original URL (may fail if not publicly accessible)")
                return photo_url
            else:
                raise ValueError(f"Cannot process localhost image: {e}")

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

    async def analyze_photo_raw(
        self,
        photo_url: str,
        prompt: str
    ) -> str:
        """
        Analyze a photo and return raw JSON string response.

        Used for Pack Estimate Phase 1 analysis with custom prompts.

        Args:
            photo_url: URL of the photo to analyze
            prompt: Analysis prompt to use

        Returns:
            Raw JSON string from the model
        """
        if not self.is_available():
            raise ValueError("OpenAI Vision provider not available - API key not configured")

        optimized_url = await self._optimize_image(photo_url)

        # Log base64 data URL length for debugging
        if optimized_url.startswith("data:"):
            logger.info(f"Using base64 image data, length: {len(optimized_url)} chars")
        else:
            logger.info(f"Using external URL: {optimized_url[:100]}...")

        last_exception = None
        for attempt in range(self.max_retries):
            try:
                logger.info(f"Analyzing photo raw (attempt {attempt + 1}/{self.max_retries})")

                # Build enhanced prompt with explicit JSON instruction
                enhanced_prompt = f"""IMPORTANT: You MUST respond with ONLY valid JSON. No explanatory text, no markdown code blocks, just pure JSON.

{prompt}

Remember: Your entire response must be a valid JSON object. Start with {{ and end with }}."""

                response = await self.async_client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {
                            "role": "system",
                            "content": "You are an expert content pack-out inventory specialist. You analyze photos of rooms and items to create detailed packing inventories. You ALWAYS respond with valid JSON only - no explanations, no markdown, just the JSON object."
                        },
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": enhanced_prompt},
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": optimized_url,
                                        "detail": "high"  # Higher detail for inventory analysis
                                    }
                                }
                            ]
                        }
                    ],
                    max_tokens=4000,  # Increased for detailed inventory
                    temperature=0.2,
                )

                content = response.choices[0].message.content
                logger.info(f"Raw response length: {len(content)} chars")
                logger.debug(f"Raw response preview: {content[:500]}...")

                # Check if response indicates inability to analyze
                if "unable to" in content.lower() or "cannot analyze" in content.lower() or "can't analyze" in content.lower():
                    logger.error(f"Model reported inability to analyze image: {content[:200]}")
                    raise ValueError(f"Model could not analyze image: {content[:200]}")

                # Extract JSON from response
                parsed = await self._parse_json_response(content)
                logger.info(f"Successfully parsed JSON with {len(parsed.get('items', []))} items")
                return json.dumps(parsed)

            except json.JSONDecodeError as e:
                logger.error(f"JSON parse error (attempt {attempt + 1}): {e}")
                logger.error(f"Response content that failed to parse: {content[:500]}...")
                last_exception = e

            except Exception as e:
                logger.error(f"Error in raw analysis (attempt {attempt + 1}): {e}")
                last_exception = e

                if attempt < self.max_retries - 1:
                    wait_time = self.retry_delay * (2 ** attempt)
                    await asyncio.sleep(wait_time)

        raise Exception(f"Raw photo analysis failed: {last_exception}")

    async def generate_text(
        self,
        prompt: str,
        max_tokens: int = 2000
    ) -> str:
        """
        Generate text response (no image input).

        Used for Pack Estimate Phase 2 - generating line items from inventory data.

        Args:
            prompt: Text prompt for generation
            max_tokens: Maximum tokens in response

        Returns:
            Raw JSON string from the model
        """
        if not self.is_available():
            raise ValueError("OpenAI Vision provider not available - API key not configured")

        last_exception = None
        for attempt in range(self.max_retries):
            try:
                logger.info(f"Generating text (attempt {attempt + 1}/{self.max_retries})")

                # Use GPT-4 turbo for text-only generation (more cost-effective)
                # Note: gpt-4-turbo-preview is deprecated, use gpt-4-turbo or gpt-4o
                text_model = "gpt-4o"

                response = await self.async_client.chat.completions.create(
                    model=text_model,
                    messages=[
                        {
                            "role": "system",
                            "content": "You are an expert moving and pack-out services estimator. Always respond with valid JSON."
                        },
                        {
                            "role": "user",
                            "content": prompt
                        }
                    ],
                    max_tokens=max_tokens,
                    temperature=0.3,
                    response_format={"type": "json_object"}
                )

                content = response.choices[0].message.content
                logger.debug(f"Text generation response: {content[:300]}...")

                # Validate JSON
                parsed = json.loads(content)
                return json.dumps(parsed)

            except Exception as e:
                logger.error(f"Error in text generation (attempt {attempt + 1}): {e}")
                last_exception = e

                if attempt < self.max_retries - 1:
                    wait_time = self.retry_delay * (2 ** attempt)
                    await asyncio.sleep(wait_time)

        raise Exception(f"Text generation failed: {last_exception}")
