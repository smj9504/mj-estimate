"""
Photo Analysis Repository

Data access layer for photo analysis caching.
"""

import logging
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID
import hashlib
import json

from app.core.database_factory import get_database
from app.common.base_repository import SQLAlchemyRepository, SupabaseRepository
from app.domains.photo_analysis.models import PhotoAnalysisCache
from app.domains.photo_analysis.schemas import AnalysisCacheEntry, PhotoAnalysisResponse
from app.domains.pack_calculation.templates.base_template import RoomType
from app.core.config import settings

logger = logging.getLogger(__name__)


class PhotoAnalysisCacheRepository:
    """Repository for photo analysis cache operations"""

    def __init__(self):
        """Initialize repository with appropriate database implementation"""
        self.db = get_database()
        self.session = self.db.get_session()
        self.repo = None
        self._cache_available = False

        # Choose repository implementation based on database type
        try:
            if self.db.provider_name in ["sqlite", "postgresql"]:
                self.repo = SQLAlchemyRepository(
                    self.session, PhotoAnalysisCache
                )
            else:  # supabase
                self.repo = SupabaseRepository(
                    self.session,
                    "photo_analysis_cache",
                    PhotoAnalysisCache
                )
            self._cache_available = True
        except Exception as e:
            logger.warning(f"Cache repository initialization failed: {e}")
            self._cache_available = False

    @staticmethod
    def generate_cache_key(
        room_type: RoomType,
        photo_urls: list[str],
        model_version: str = None
    ) -> str:
        """
        Generate a unique cache key for a set of photos.

        Args:
            room_type: Type of room
            photo_urls: List of photo URLs
            model_version: Model version (defaults to settings.PHOTO_ANALYSIS_MODEL)

        Returns:
            SHA256 hash as cache key
        """
        model = model_version or getattr(settings, 'PHOTO_ANALYSIS_MODEL', 'gpt-4-vision-preview')

        # Sort URLs for consistent hashing
        sorted_urls = sorted(photo_urls)

        # Create hash input
        hash_input = f"{room_type}|{model}|{'|'.join(sorted_urls)}"

        # Generate SHA256 hash
        cache_key = hashlib.sha256(hash_input.encode()).hexdigest()

        return cache_key

    def get_cached_analysis(self, cache_key: str) -> Optional[PhotoAnalysisResponse]:
        """
        Retrieve cached analysis result.

        Args:
            cache_key: Cache key to lookup

        Returns:
            PhotoAnalysisResponse if found and not expired, None otherwise
        """
        if not self._cache_available or not self.repo:
            logger.debug("Cache not available, skipping lookup")
            return None

        try:
            # Query cache entry
            cache_entries = self.repo.get_all(filters={"cache_key": cache_key})

            if not cache_entries:
                logger.debug(f"Cache miss for key: {cache_key}")
                return None

            cache_entry = cache_entries[0]

            # Check expiration
            expires_at_str = cache_entry.get("expires_at")
            if expires_at_str:
                # Parse datetime string
                if isinstance(expires_at_str, str):
                    expires_at = datetime.fromisoformat(expires_at_str.replace('Z', '+00:00'))
                else:
                    expires_at = expires_at_str

                if expires_at < datetime.utcnow():
                    logger.info(f"Cache entry expired: {cache_key}")
                    # Delete expired entry
                    self.delete_cache_entry(cache_key)
                    return None

            # Parse analysis result from JSON
            analysis_result = cache_entry.get("analysis_result")
            if isinstance(analysis_result, str):
                analysis_result = json.loads(analysis_result)

            # Convert to PhotoAnalysisResponse
            response = PhotoAnalysisResponse(**analysis_result)
            response.cache_used = True
            response.cache_key = cache_key

            logger.info(f"Cache hit for key: {cache_key}")
            return response

        except Exception as e:
            logger.error(f"Error retrieving cached analysis: {e}")
            return None

    def save_analysis(
        self,
        cache_key: str,
        room_type: RoomType,
        photo_urls: list[str],
        analysis_result: PhotoAnalysisResponse,
        user_id: Optional[UUID] = None,
        ttl_days: int = None
    ) -> bool:
        """
        Save analysis result to cache.

        Args:
            cache_key: Cache key
            room_type: Type of room
            photo_urls: List of photo URLs
            analysis_result: Analysis result to cache
            user_id: Optional user ID
            ttl_days: Time to live in days (defaults to settings.PHOTO_ANALYSIS_CACHE_TTL_DAYS)

        Returns:
            True if saved successfully, False otherwise
        """
        if not self._cache_available or not self.repo:
            logger.debug("Cache not available, skipping save")
            return False

        try:
            ttl = ttl_days or getattr(
                settings, 'PHOTO_ANALYSIS_CACHE_TTL_DAYS', 30
            )
            expires_at = datetime.utcnow() + timedelta(days=ttl)

            # Convert analysis result to dict
            result_dict = analysis_result.model_dump()

            # Create cache entry data
            cache_data = {
                "cache_key": cache_key,
                "room_type": room_type.value,
                "photo_urls": photo_urls if isinstance(photo_urls, list) else list(photo_urls),
                "analysis_result": result_dict,
                "confidence_score": analysis_result.confidence_score,
                "user_id": str(user_id) if user_id else None,
                "expires_at": expires_at.isoformat(),
            }

            # Check if entry already exists
            existing = self.repo.get_all(filters={"cache_key": cache_key})

            if existing:
                # Update existing entry
                self.repo.update(existing[0]["id"], cache_data)
                logger.info(f"Updated cache entry: {cache_key}")
            else:
                # Create new entry
                self.repo.create(cache_data)
                logger.info(f"Created cache entry: {cache_key} (expires in {ttl} days)")

            return True

        except Exception as e:
            logger.error(f"Error saving cache entry: {e}")
            return False

    def delete_cache_entry(self, cache_key: str) -> bool:
        """
        Delete a cache entry.

        Args:
            cache_key: Cache key to delete

        Returns:
            True if deleted successfully, False otherwise
        """
        if not self._cache_available or not self.repo:
            return False

        try:
            entries = self.repo.get_all(filters={"cache_key": cache_key})

            if entries:
                self.repo.delete(entries[0]["id"])
                logger.info(f"Deleted cache entry: {cache_key}")
                return True

            return False

        except Exception as e:
            logger.error(f"Error deleting cache entry: {e}")
            return False

    def cleanup_expired_entries(self) -> int:
        """
        Clean up all expired cache entries.

        Returns:
            Number of entries deleted
        """
        if not self._cache_available or not self.repo:
            return 0

        try:
            # This is a simplified version - for production use more efficient query
            all_entries = self.repo.get_all()
            deleted_count = 0

            for entry in all_entries:
                expires_at_str = entry.get("expires_at")
                if expires_at_str:
                    if isinstance(expires_at_str, str):
                        expires_at = datetime.fromisoformat(expires_at_str.replace('Z', '+00:00'))
                    else:
                        expires_at = expires_at_str

                    if expires_at < datetime.utcnow():
                        self.repo.delete(entry["id"])
                        deleted_count += 1

            if deleted_count > 0:
                logger.info(f"Cleaned up {deleted_count} expired cache entries")

            return deleted_count

        except Exception as e:
            logger.error(f"Error cleaning up expired entries: {e}")
            return 0
