"""
Photo Analysis Service

Main orchestrator for AI-powered photo analysis workflow.
"""

import logging
import time
from typing import Optional

from app.domains.photo_analysis.schemas import (
    PhotoAnalysisRequest,
    PhotoAnalysisResponse,
    DetectedItem
)
from app.domains.photo_analysis.repository import PhotoAnalysisCacheRepository
from app.domains.photo_analysis.aggregator import PhotoResultAggregator
from app.domains.photo_analysis.providers import (
    OpenAIVisionProvider,
    GeminiVisionProvider,
    MockPhotoAnalysisProvider,
    PhotoAnalysisProvider
)
from app.domains.photo_analysis.prompts import get_room_prompt
from app.core.config import settings

logger = logging.getLogger(__name__)


class PhotoAnalysisService:
    """Service for analyzing room photos with AI"""

    def __init__(self):
        """Initialize photo analysis service"""
        self.cache_repo = PhotoAnalysisCacheRepository()
        self.cache_enabled = getattr(settings, 'PHOTO_ANALYSIS_CACHE_ENABLED', True)

        # Initialize providers
        self.providers = {
            "openai": OpenAIVisionProvider(),
            "gemini": GeminiVisionProvider(),
            "mock": MockPhotoAnalysisProvider()
        }

        # Determine default provider based on availability
        self.default_provider = self._determine_default_provider()

        logger.info("PhotoAnalysisService initialized")
        logger.info(f"Cache enabled: {self.cache_enabled}")
        logger.info(f"Available providers: {list(self.providers.keys())}")
        logger.info(f"Default provider: {self.default_provider}")

    def _determine_default_provider(self) -> str:
        """
        Determine the best available provider.

        Priority: openai > gemini

        Returns:
            Name of the default provider to use

        Raises:
            ValueError if no AI providers are available
        """
        # Check OpenAI first
        if self.providers["openai"].is_available():
            return "openai"

        # Fallback to Gemini (free tier available)
        if self.providers["gemini"].is_available():
            logger.info("OpenAI not available, using Gemini as default")
            return "gemini"

        # No providers available - will raise error when used
        logger.error(
            "No AI providers available! "
            "Please configure OPENAI_API_KEY or GEMINI_API_KEY"
        )
        return None

    def _get_provider(self, provider_name: str) -> PhotoAnalysisProvider:
        """
        Get analysis provider by name with automatic fallback.

        Args:
            provider_name: Name of provider (openai, gemini, mock)

        Returns:
            PhotoAnalysisProvider instance

        Raises:
            ValueError if no providers are available
        """
        # Use default provider if not specified or "auto"
        if not provider_name or provider_name == "auto":
            provider_name = self.default_provider

        # Check if any provider is available
        if provider_name is None:
            raise ValueError(
                "No AI providers available. "
                "Please configure OPENAI_API_KEY or GEMINI_API_KEY in your .env file. "
                "Get free Gemini API key at: https://aistudio.google.com/app/apikey"
            )

        provider = self.providers.get(provider_name)

        if not provider:
            raise ValueError(f"Unknown provider: {provider_name}")

        if not provider.is_available():
            # Try fallback chain: openai -> gemini (no mock)
            fallback_chain = ["openai", "gemini"]
            for fallback_name in fallback_chain:
                if fallback_name == provider_name:
                    continue
                fallback = self.providers.get(fallback_name)
                if fallback and fallback.is_available():
                    logger.warning(
                        f"Provider {provider_name} not available, "
                        f"falling back to {fallback_name}"
                    )
                    return fallback

            # No AI providers available - raise error
            raise ValueError(
                f"Provider '{provider_name}' is not available and no fallback found. "
                "Please check your API key configuration. "
                "OpenAI: https://platform.openai.com/api-keys | "
                "Gemini (free): https://aistudio.google.com/app/apikey"
            )

        return provider

    async def analyze_photos(
        self,
        request: PhotoAnalysisRequest
    ) -> PhotoAnalysisResponse:
        """
        Main entry point for photo analysis.

        Workflow:
        1. Check cache if enabled
        2. If not cached, analyze photos with AI provider
        3. Aggregate results from multiple photos
        4. Save to cache
        5. Return response

        Args:
            request: PhotoAnalysisRequest with room_type and photo_urls

        Returns:
            PhotoAnalysisResponse with detected items and metadata
        """
        start_time = time.time()

        # Convert HttpUrl objects to strings
        photo_urls = [str(url) for url in request.photo_urls]

        logger.info(
            f"Analyzing {len(photo_urls)} photos for {request.room_type} "
            f"(user_id: {request.user_id}, provider: {request.provider})"
        )

        # Generate cache key (can be done without DB)
        cache_key = PhotoAnalysisCacheRepository.generate_cache_key(
            request.room_type,
            photo_urls
        )

        # Check cache if enabled
        if self.cache_enabled and request.use_cache:
            try:
                cached_result = self.cache_repo.get_cached_analysis(cache_key)
                if cached_result:
                    processing_time = time.time() - start_time
                    cached_result.processing_time = processing_time
                    logger.info(f"Returning cached result (processing time: {processing_time:.2f}s)")
                    return cached_result
            except Exception as e:
                logger.warning(f"Cache lookup failed (continuing without cache): {e}")
                # Continue without cache - don't block analysis due to cache issues

        # Get provider
        provider = self._get_provider(request.provider or "openai")
        logger.info(f"Using provider: {provider.get_provider_name()}")

        # Get room-specific prompt
        prompt = get_room_prompt(request.room_type)

        # Analyze photos
        try:
            if len(photo_urls) == 1:
                # Single photo - direct analysis
                logger.info("Analyzing single photo")
                result = await provider.analyze_photo(
                    photo_urls[0],
                    request.room_type,
                    prompt
                )
                analysis_results = [result]
            else:
                # Multiple photos - batch analysis
                logger.info(f"Analyzing batch of {len(photo_urls)} photos")
                analysis_results = await provider.analyze_batch(
                    photo_urls,
                    request.room_type,
                    prompt
                )

        except Exception as e:
            logger.error(f"Error during photo analysis: {e}")
            # Fallback to mock provider if real provider fails
            if request.provider != "mock":
                logger.warning("Falling back to mock provider due to error")
                mock_provider = self.providers["mock"]
                analysis_results = await mock_provider.analyze_batch(
                    photo_urls,
                    request.room_type,
                    prompt
                )
            else:
                raise

        # Aggregate results
        logger.info("Aggregating results from multiple photos")
        aggregated = PhotoResultAggregator.aggregate_results(analysis_results)

        # Adjust confidence based on number of photos
        base_confidence = aggregated["confidence_score"]
        adjusted_confidence = PhotoResultAggregator.adjust_confidence(
            base_confidence,
            len(photo_urls)
        )

        # Create response
        processing_time = time.time() - start_time
        response = PhotoAnalysisResponse(
            items=aggregated["items"],
            density_level=aggregated["density_level"],
            confidence_score=adjusted_confidence,
            total_boxes=aggregated["total_boxes"],
            processing_time=processing_time,
            detected_features=aggregated["detected_features"],
            cache_used=False,
            cache_key=cache_key
        )

        # Save to cache if enabled
        if self.cache_enabled:
            try:
                self.cache_repo.save_analysis(
                    cache_key=cache_key,
                    room_type=request.room_type,
                    photo_urls=photo_urls,
                    analysis_result=response,
                    user_id=request.user_id
                )
            except Exception as e:
                logger.error(f"Failed to save to cache: {e}")
                # Continue anyway - caching failure shouldn't break the request

        logger.info(
            f"Analysis complete: {len(response.items)} items, "
            f"{response.total_boxes} boxes, "
            f"confidence={response.confidence_score:.2f}, "
            f"time={processing_time:.2f}s"
        )

        return response

    def get_cached_analysis(self, cache_key: str) -> Optional[PhotoAnalysisResponse]:
        """
        Retrieve cached analysis by cache key.

        Args:
            cache_key: Cache key to lookup

        Returns:
            PhotoAnalysisResponse if found, None otherwise
        """
        if not self.cache_enabled:
            logger.warning("Cache is disabled")
            return None

        return self.cache_repo.get_cached_analysis(cache_key)

    def cleanup_expired_cache(self) -> int:
        """
        Clean up expired cache entries.

        Returns:
            Number of entries deleted
        """
        if not self.cache_enabled:
            logger.warning("Cache is disabled")
            return 0

        return self.cache_repo.cleanup_expired_entries()

    def get_service_info(self) -> dict:
        """
        Get service information and status.

        Returns:
            Dictionary with service metadata
        """
        # Check provider availability
        provider_status = {}
        for name, provider in self.providers.items():
            provider_status[name] = {
                "name": provider.get_provider_name(),
                "available": provider.is_available()
            }

        return {
            "service": "Photo Analysis Service",
            "cache_enabled": self.cache_enabled,
            "providers": provider_status,
            "default_provider": self.default_provider,
            "fallback_chain": ["openai", "gemini", "mock"],
            "cache_ttl_days": getattr(
                settings, 'PHOTO_ANALYSIS_CACHE_TTL_DAYS', 30
            ),
            "openai_model": getattr(
                settings, 'PHOTO_ANALYSIS_MODEL', 'gpt-4o'
            ),
            "gemini_model": getattr(settings, 'GEMINI_MODEL', 'gemini-1.5-flash')
        }
