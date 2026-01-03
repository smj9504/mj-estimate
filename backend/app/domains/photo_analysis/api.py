"""
Photo Analysis API Endpoints

REST API for AI-powered photo analysis.
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import JSONResponse

from app.domains.photo_analysis.service import PhotoAnalysisService
from app.domains.photo_analysis.schemas import (
    PhotoAnalysisRequest,
    PhotoAnalysisResponse
)

logger = logging.getLogger(__name__)

# Create router
router = APIRouter()

# Service instance (singleton)
_service: Optional[PhotoAnalysisService] = None


def get_service() -> PhotoAnalysisService:
    """
    Dependency to get photo analysis service instance.

    Returns:
        PhotoAnalysisService instance
    """
    global _service
    if _service is None:
        _service = PhotoAnalysisService()
    return _service


@router.post(
    "/analyze",
    response_model=PhotoAnalysisResponse,
    summary="Analyze room photos",
    description=(
        "Analyze 1-10 photos of a room using AI to detect items for pack calculation. "
        "Supports caching for faster repeated analyses."
    ),
    tags=["Photo Analysis"]
)
async def analyze_photos(
    request: PhotoAnalysisRequest,
    service: PhotoAnalysisService = Depends(get_service)
) -> PhotoAnalysisResponse:
    """
    Analyze room photos with AI vision.

    Args:
        request: PhotoAnalysisRequest with room_type and photo_urls
        service: PhotoAnalysisService dependency

    Returns:
        PhotoAnalysisResponse with detected items and metadata

    Raises:
        HTTPException: If analysis fails
    """
    try:
        logger.info(f"Received photo analysis request for {request.room_type}")
        logger.debug(f"Request details: {request.model_dump()}")

        result = await service.analyze_photos(request)

        logger.info(f"Analysis successful: {len(result.items)} items detected")
        return result

    except ValueError as e:
        logger.error(f"Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

    except Exception as e:
        logger.error(f"Error analyzing photos: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Photo analysis failed: {str(e)}"
        )


@router.get(
    "/cache/{cache_key}",
    response_model=PhotoAnalysisResponse,
    summary="Get cached analysis",
    description="Retrieve a previously cached photo analysis result by cache key.",
    tags=["Photo Analysis"]
)
async def get_cached_analysis(
    cache_key: str,
    service: PhotoAnalysisService = Depends(get_service)
) -> PhotoAnalysisResponse:
    """
    Retrieve cached analysis result.

    Args:
        cache_key: Cache key to lookup
        service: PhotoAnalysisService dependency

    Returns:
        PhotoAnalysisResponse if found

    Raises:
        HTTPException: If cache entry not found or expired
    """
    try:
        logger.info(f"Looking up cached analysis: {cache_key}")

        result = service.get_cached_analysis(cache_key)

        if not result:
            raise HTTPException(
                status_code=404,
                detail="Cache entry not found or expired"
            )

        logger.info(f"Cache entry found: {cache_key}")
        return result

    except HTTPException:
        raise

    except Exception as e:
        logger.error(f"Error retrieving cache entry: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve cache entry: {str(e)}"
        )


@router.delete(
    "/cache/cleanup",
    summary="Cleanup expired cache",
    description="Remove all expired cache entries to free up database space.",
    tags=["Photo Analysis"]
)
async def cleanup_expired_cache(
    service: PhotoAnalysisService = Depends(get_service)
) -> JSONResponse:
    """
    Clean up expired cache entries.

    Args:
        service: PhotoAnalysisService dependency

    Returns:
        JSON response with count of deleted entries
    """
    try:
        logger.info("Starting cache cleanup")

        deleted_count = service.cleanup_expired_cache()

        logger.info(f"Cache cleanup complete: {deleted_count} entries deleted")

        return JSONResponse(
            status_code=200,
            content={
                "message": "Cache cleanup successful",
                "deleted_count": deleted_count
            }
        )

    except Exception as e:
        logger.error(f"Error during cache cleanup: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Cache cleanup failed: {str(e)}"
        )


@router.get(
    "/info",
    summary="Get service information",
    description="Get information about the photo analysis service configuration and status.",
    tags=["Photo Analysis"]
)
async def get_service_info(
    service: PhotoAnalysisService = Depends(get_service)
) -> JSONResponse:
    """
    Get service information and status.

    Args:
        service: PhotoAnalysisService dependency

    Returns:
        JSON response with service metadata
    """
    try:
        info = service.get_service_info()

        return JSONResponse(
            status_code=200,
            content=info
        )

    except Exception as e:
        logger.error(f"Error getting service info: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get service info: {str(e)}"
        )


@router.get(
    "/health",
    summary="Health check",
    description="Check if the photo analysis service is healthy and operational.",
    tags=["Photo Analysis"]
)
async def health_check(
    service: PhotoAnalysisService = Depends(get_service)
) -> JSONResponse:
    """
    Health check endpoint.

    Args:
        service: PhotoAnalysisService dependency

    Returns:
        JSON response with health status
    """
    try:
        info = service.get_service_info()

        # Check if at least one provider is available
        providers_available = any(
            provider["available"]
            for provider in info["providers"].values()
        )

        status = "healthy" if providers_available else "degraded"

        return JSONResponse(
            status_code=200 if providers_available else 503,
            content={
                "status": status,
                "service": "photo_analysis",
                "providers_available": providers_available,
                "cache_enabled": info["cache_enabled"]
            }
        )

    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "service": "photo_analysis",
                "error": str(e)
            }
        )
