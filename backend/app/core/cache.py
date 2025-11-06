"""
Cache service for performance optimization
"""

import asyncio
import hashlib
import json
import logging
import pickle
from datetime import timedelta
from functools import wraps
from typing import Any, List, Optional

import redis
from redis.exceptions import RedisError

from app.core.config import settings

logger = logging.getLogger(__name__)


class CacheService:
    """Redis-based caching service"""
    
    def __init__(self):
        self.redis_client = None
        self.connect()
    
    def connect(self):
        """Connect to Redis"""
        try:
            # Use Redis if available, otherwise use in-memory cache
            # Priority: REDIS_URL > individual settings
            if settings.REDIS_URL:
                # Use Redis URL (e.g., from Upstash or other Redis services)
                self.redis_client = redis.from_url(
                    settings.REDIS_URL,
                    decode_responses=True,
                    socket_connect_timeout=2,
                    socket_timeout=2
                )
                logger.info("Connecting to Redis using REDIS_URL")
            else:
                # Use individual Redis settings
                self.redis_client = redis.Redis(
                    host=settings.REDIS_HOST,
                    port=settings.REDIS_PORT,
                    db=settings.REDIS_DB,
                    password=settings.REDIS_PASSWORD,
                    decode_responses=True,
                    socket_connect_timeout=2,
                    socket_timeout=2
                )
                logger.info(
                    f"Connecting to Redis at "
                    f"{settings.REDIS_HOST}:{settings.REDIS_PORT}"
                )
            
            # Test connection
            self.redis_client.ping()
            logger.info("Successfully connected to Redis cache")
        except (RedisError, ConnectionError) as e:
            logger.warning(
                f"Redis not available, using in-memory cache: {e}"
            )
            self.redis_client = InMemoryCache()
    
    async def get(self, key: str) -> Optional[str]:
        """Get value from cache"""
        try:
            if asyncio.iscoroutinefunction(self.redis_client.get):
                value = await self.redis_client.get(key)
            else:
                value = self.redis_client.get(key)
            return value
        except Exception as e:
            logger.error(f"Cache get error for key {key}: {e}")
            return None
    
    async def set(self, key: str, value: str, ttl: int = 3600) -> bool:
        """Set value in cache with TTL in seconds"""
        try:
            if asyncio.iscoroutinefunction(self.redis_client.setex):
                result = await self.redis_client.setex(key, ttl, value)
            else:
                result = self.redis_client.setex(key, ttl, value)
            return bool(result)
        except Exception as e:
            logger.error(f"Cache set error for key {key}: {e}")
            return False
    
    async def delete(self, key: str) -> bool:
        """Delete value from cache"""
        try:
            if asyncio.iscoroutinefunction(self.redis_client.delete):
                result = await self.redis_client.delete(key)
            else:
                result = self.redis_client.delete(key)
            return bool(result)
        except Exception as e:
            logger.error(f"Cache delete error for key {key}: {e}")
            return False
    
    async def delete_pattern(self, pattern: str) -> int:
        """Delete all keys matching pattern"""
        try:
            if isinstance(self.redis_client, InMemoryCache):
                return self.redis_client.delete_pattern(pattern)
            
            keys = self.redis_client.keys(pattern)
            if keys:
                return self.redis_client.delete(*keys)
            return 0
        except Exception as e:
            logger.error(f"Cache delete pattern error for {pattern}: {e}")
            return 0
    
    async def exists(self, key: str) -> bool:
        """Check if key exists in cache"""
        try:
            if asyncio.iscoroutinefunction(self.redis_client.exists):
                result = await self.redis_client.exists(key)
            else:
                result = self.redis_client.exists(key)
            return bool(result)
        except Exception as e:
            logger.error(f"Cache exists error for key {key}: {e}")
            return False
    
    def cache_key(self, *args, **kwargs) -> str:
        """Generate cache key from arguments"""
        key_parts = [str(arg) for arg in args]
        key_parts.extend([f"{k}:{v}" for k, v in sorted(kwargs.items())])
        key_string = ":".join(key_parts)
        
        # Hash if key is too long
        if len(key_string) > 200:
            key_hash = hashlib.md5(key_string.encode()).hexdigest()
            return f"hashed:{key_hash}"
        
        return key_string


class InMemoryCache:
    """Fallback in-memory cache when Redis is not available"""
    
    def __init__(self):
        self._cache = {}
        self._ttls = {}
        self._lock = asyncio.Lock()
    
    def get(self, key: str) -> Optional[str]:
        """Get value from in-memory cache"""
        import time
        
        if key in self._cache:
            if key in self._ttls:
                if time.time() < self._ttls[key]:
                    return self._cache[key]
                else:
                    # Expired
                    del self._cache[key]
                    del self._ttls[key]
            else:
                return self._cache[key]
        return None
    
    def setex(self, key: str, ttl: int, value: str) -> bool:
        """Set value with TTL"""
        import time
        
        self._cache[key] = value
        self._ttls[key] = time.time() + ttl
        
        # Cleanup old entries if cache is too large
        if len(self._cache) > 1000:
            self._cleanup()
        
        return True
    
    def delete(self, key: str) -> bool:
        """Delete value from cache"""
        if key in self._cache:
            del self._cache[key]
            if key in self._ttls:
                del self._ttls[key]
            return True
        return False
    
    def delete_pattern(self, pattern: str) -> int:
        """Delete all keys matching pattern"""
        import fnmatch
        
        pattern = pattern.replace('*', '.*')
        deleted = 0
        
        keys_to_delete = [
            key for key in self._cache.keys()
            if fnmatch.fnmatch(key, pattern)
        ]
        
        for key in keys_to_delete:
            self.delete(key)
            deleted += 1
        
        return deleted
    
    def exists(self, key: str) -> bool:
        """Check if key exists"""
        return key in self._cache
    
    def keys(self, pattern: str = "*") -> List[str]:
        """Get keys matching pattern"""
        import fnmatch
        
        pattern = pattern.replace('*', '.*')
        return [
            key for key in self._cache.keys()
            if fnmatch.fnmatch(key, pattern)
        ]
    
    def _cleanup(self):
        """Remove expired entries"""
        import time
        
        current_time = time.time()
        expired_keys = [
            key for key, ttl in self._ttls.items()
            if ttl < current_time
        ]
        
        for key in expired_keys:
            self.delete(key)


def cache_result(ttl: int = 3600, key_prefix: str = None):
    """Decorator to cache function results"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Generate cache key
            cache = CacheService()
            
            if key_prefix:
                cache_key = f"{key_prefix}:"
            else:
                cache_key = f"{func.__module__}.{func.__name__}:"
            
            # Add arguments to key
            cache_key += cache.cache_key(*args, **kwargs)
            
            # Try to get from cache
            cached = await cache.get(cache_key)
            if cached:
                try:
                    return json.loads(cached)
                except json.JSONDecodeError:
                    return cached
            
            # Call function and cache result
            result = await func(*args, **kwargs)
            
            # Cache the result
            try:
                if isinstance(result, (dict, list)):
                    await cache.set(cache_key, json.dumps(result), ttl)
                else:
                    await cache.set(cache_key, str(result), ttl)
            except Exception as e:
                logger.error(f"Failed to cache result: {e}")
            
            return result
        
        return wrapper
    return decorator


def invalidate_cache(patterns: List[str]):
    """Decorator to invalidate cache patterns after function execution"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            result = await func(*args, **kwargs)
            
            # Invalidate cache patterns
            cache = CacheService()
            for pattern in patterns:
                await cache.delete_pattern(pattern)
            
            return result
        
        return wrapper
    return decorator


# Dependency injection for FastAPI
_cache_instance = None

def get_cache() -> CacheService:
    """Get cache service instance (singleton)"""
    global _cache_instance
    if _cache_instance is None:
        _cache_instance = CacheService()
    return _cache_instance