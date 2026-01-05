"""
Rate limiting configuration for the API

This module provides rate limiting functionality to protect the API from:
- Brute force password attacks
- API abuse/DoS attacks
- Webhook endpoint flooding

Usage:
    from app.core.rate_limiter import limiter, RATE_LIMITS

    @router.post("/login")
    @limiter.limit(RATE_LIMITS["auth"])
    async def login(request: Request, ...):
        pass

Note: The `request: Request` parameter must be the first parameter
in rate-limited endpoints for the limiter to work correctly.
"""

import logging
from typing import Optional

from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

logger = logging.getLogger(__name__)


def get_client_ip(request: Request) -> str:
    """
    Get the real client IP address, accounting for reverse proxies.

    Checks X-Forwarded-For header first (for requests behind load balancers),
    then falls back to the direct client address.
    """
    # Check for X-Forwarded-For header (used by reverse proxies)
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        # X-Forwarded-For can contain multiple IPs, take the first (original client)
        client_ip = forwarded_for.split(",")[0].strip()
        return client_ip

    # Check for X-Real-IP header (used by some proxies)
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()

    # Fall back to direct client address
    return get_remote_address(request)


# Create limiter instance with custom key function
# Default limit: 100 requests per minute for general endpoints
limiter = Limiter(
    key_func=get_client_ip,
    default_limits=["100/minute"],
    enabled=True,
    headers_enabled=True,  # Add rate limit headers to responses
    strategy="fixed-window"  # Use fixed window strategy
)


async def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """
    Custom handler for rate limit exceeded errors.

    Returns a JSON response with:
    - 429 status code
    - Error details
    - Retry-After information
    """
    # Log the rate limit violation
    client_ip = get_client_ip(request)
    logger.warning(
        f"Rate limit exceeded for {client_ip} on {request.method} {request.url.path}: {exc.detail}"
    )

    # Parse retry-after from the exception detail
    # Format is typically like "5 per 1 minute"
    retry_after = "60"  # Default to 60 seconds
    if exc.detail:
        detail_str = str(exc.detail)
        # Try to extract the time window
        if "minute" in detail_str.lower():
            retry_after = "60"
        elif "hour" in detail_str.lower():
            retry_after = "3600"
        elif "second" in detail_str.lower():
            retry_after = "1"

    return JSONResponse(
        status_code=429,
        content={
            "detail": "Rate limit exceeded. Please try again later.",
            "error": "rate_limit_exceeded",
            "retry_after": retry_after,
            "limit_info": str(exc.detail) if exc.detail else None
        },
        headers={
            "Retry-After": retry_after
        }
    )


# Rate limit presets for different endpoint types
# These can be used with @limiter.limit(RATE_LIMITS["auth"])
RATE_LIMITS = {
    # Authentication endpoints - strict limits to prevent brute force
    "auth": "5/minute",

    # Password reset - very strict to prevent abuse
    "password_reset": "3/minute",

    # External webhooks - moderate limits
    "webhook": "30/minute",

    # File uploads - prevent abuse of storage
    "upload": "10/minute",

    # General API calls - reasonable default
    "api": "60/minute",

    # Heavy operations (PDF generation, AI analysis, etc.)
    "heavy": "10/minute",

    # Admin operations - slightly more lenient for legitimate admin work
    "admin": "30/minute",

    # Public endpoints (health check, etc.) - very lenient
    "public": "200/minute",

    # Search/listing endpoints - moderate limits
    "search": "30/minute",

    # Init admin endpoint - very strict (should only be called once)
    "init": "1/minute"
}


def get_rate_limit(endpoint_type: str) -> str:
    """
    Get the rate limit string for a given endpoint type.

    Args:
        endpoint_type: One of the keys in RATE_LIMITS

    Returns:
        Rate limit string (e.g., "5/minute")
    """
    return RATE_LIMITS.get(endpoint_type, RATE_LIMITS["api"])
