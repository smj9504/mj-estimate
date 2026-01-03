"""
Base Provider Interface

Abstract base class for photo analysis providers.
"""

from abc import ABC, abstractmethod
from typing import List

from app.domains.photo_analysis.schemas import SinglePhotoAnalysisResult
from app.domains.pack_calculation.templates.base_template import RoomType


class PhotoAnalysisProvider(ABC):
    """Abstract base class for photo analysis providers"""

    @abstractmethod
    async def analyze_photo(
        self,
        photo_url: str,
        room_type: RoomType,
        prompt: str
    ) -> SinglePhotoAnalysisResult:
        """
        Analyze a single photo and return detected items.

        Args:
            photo_url: URL of the photo to analyze
            room_type: Type of room being analyzed
            prompt: Analysis prompt to use

        Returns:
            SinglePhotoAnalysisResult with detected items
        """
        pass

    @abstractmethod
    async def analyze_batch(
        self,
        photo_urls: List[str],
        room_type: RoomType,
        prompt: str
    ) -> List[SinglePhotoAnalysisResult]:
        """
        Analyze multiple photos in batch (more efficient).

        Args:
            photo_urls: List of photo URLs to analyze
            room_type: Type of room being analyzed
            prompt: Analysis prompt to use

        Returns:
            List of SinglePhotoAnalysisResult for each photo
        """
        pass

    @abstractmethod
    def get_provider_name(self) -> str:
        """Get the name of this provider"""
        pass

    @abstractmethod
    def is_available(self) -> bool:
        """Check if this provider is properly configured and available"""
        pass
