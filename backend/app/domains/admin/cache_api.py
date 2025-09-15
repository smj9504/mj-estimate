"""
Cache Management API Endpoints

Provides administrative endpoints for cache monitoring and management
"""

from typing import Dict, Any
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
import json
import redis
from datetime import datetime

from app.core.database_factory import get_db_session as get_db
from app.domains.auth.dependencies import get_current_user, require_admin
from app.domains.staff.models import Staff
from app.core.cache import CacheService, get_cache
from app.domains.line_items.cache_service import get_category_cache_service
from app.core.config import settings

router = APIRouter(prefix="/api/admin/cache", tags=["Admin - Cache"])


@router.get("/metrics", response_model=Dict[str, Any])
async def get_cache_metrics(
    db: Session = Depends(get_db),
    current_user: Staff = Depends(require_admin),
    cache: CacheService = Depends(get_cache)
):
    """
    Get comprehensive cache metrics for monitoring
    
    Returns:
        Dictionary containing cache performance metrics
    """
    try:
        # Get category cache metrics
        category_service = get_category_cache_service(cache)
        category_metrics = category_service.get_metrics()
        
        # Get Redis metrics if available
        redis_metrics = await get_redis_metrics(cache)
        
        # Get category-specific metrics
        categories_info = await get_categories_cache_info(cache)
        
        return {
            "redis": redis_metrics,
            "categories": categories_info,
            "performance": category_metrics,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch metrics: {str(e)}")


@router.post("/clear")
async def clear_cache(
    pattern: str = "*",
    db: Session = Depends(get_db),
    current_user: Staff = Depends(require_admin),
    cache: CacheService = Depends(get_cache)
):
    """
    Clear cache entries matching pattern
    
    Args:
        pattern: Redis pattern to match keys (default: * for all)
        
    Returns:
        Number of keys deleted
    """
    try:
        # Clear matching keys
        deleted = await cache.delete_pattern(f"*{pattern}*")
        
        # Clear category-specific caches
        if pattern == "*" or "categor" in pattern.lower():
            category_service = get_category_cache_service(cache)
            await category_service.invalidate_category_caches()
        
        return {
            "deleted": deleted,
            "pattern": pattern,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear cache: {str(e)}")


@router.post("/warm")
async def warm_cache(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(require_admin),
    cache: CacheService = Depends(get_cache)
):
    """
    Warm up cache with commonly accessed data
    
    Returns:
        Status of cache warming operation
    """
    try:
        category_service = get_category_cache_service(cache)
        
        # Warm categories in background
        background_tasks.add_task(
            warm_all_caches,
            db,
            cache,
            category_service
        )
        
        return {
            "status": "warming",
            "message": "Cache warming initiated in background",
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to warm cache: {str(e)}")


@router.get("/keys")
async def list_cache_keys(
    pattern: str = "*",
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(require_admin),
    cache: CacheService = Depends(get_cache)
):
    """
    List cache keys matching pattern
    
    Args:
        pattern: Pattern to match
        limit: Maximum number of keys to return
        
    Returns:
        List of cache keys with metadata
    """
    try:
        # This depends on Redis being available
        if not isinstance(cache.redis_client, redis.Redis):
            return {
                "keys": [],
                "message": "Redis not available, using in-memory cache"
            }
        
        # Get matching keys
        keys = cache.redis_client.keys(f"*{pattern}*")[:limit]
        
        # Get metadata for each key
        key_info = []
        for key in keys:
            try:
                # Decode key if bytes
                key_str = key.decode() if isinstance(key, bytes) else key
                
                # Get TTL
                ttl = cache.redis_client.ttl(key_str)
                
                # Get type and size (approximate)
                key_type = cache.redis_client.type(key_str)
                key_type_str = key_type.decode() if isinstance(key_type, bytes) else key_type
                
                # Get value size (approximate)
                if key_type_str == "string":
                    value = cache.redis_client.get(key_str)
                    size = len(value) if value else 0
                else:
                    size = 0  # Complex types need different handling
                
                key_info.append({
                    "key": key_str,
                    "type": key_type_str,
                    "ttl": ttl if ttl > 0 else None,
                    "size": size,
                })
                
            except Exception as e:
                # Skip problematic keys
                continue
        
        return {
            "keys": key_info,
            "total": len(key_info),
            "pattern": pattern,
            "limit": limit
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list keys: {str(e)}")


@router.get("/stats")
async def get_cache_statistics(
    db: Session = Depends(get_db),
    current_user: Staff = Depends(require_admin),
    cache: CacheService = Depends(get_cache)
):
    """
    Get detailed cache statistics
    
    Returns:
        Comprehensive cache statistics
    """
    try:
        stats = {
            "backend": "redis" if isinstance(cache.redis_client, redis.Redis) else "memory",
            "connected": True,
            "categories": {},
            "memory": {},
            "configuration": {}
        }
        
        # Get Redis info if available
        if isinstance(cache.redis_client, redis.Redis):
            try:
                info = cache.redis_client.info()
                stats["memory"] = {
                    "used_memory": info.get("used_memory_human", "N/A"),
                    "used_memory_peak": info.get("used_memory_peak_human", "N/A"),
                    "total_system_memory": info.get("total_system_memory_human", "N/A"),
                }
                stats["configuration"] = {
                    "maxmemory": cache.redis_client.config_get("maxmemory").get("maxmemory", "0"),
                    "maxmemory_policy": cache.redis_client.config_get("maxmemory-policy").get("maxmemory-policy", "noeviction"),
                    "save": cache.redis_client.config_get("save").get("save", ""),
                }
                stats["uptime"] = info.get("uptime_in_seconds", 0)
                stats["connected_clients"] = info.get("connected_clients", 0)
                stats["total_commands_processed"] = info.get("total_commands_processed", 0)
                
            except Exception as e:
                stats["error"] = str(e)
        
        # Get category cache stats
        category_service = get_category_cache_service(cache)
        stats["categories"] = category_service.get_metrics()
        
        return stats
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get statistics: {str(e)}")


async def get_redis_metrics(cache: CacheService) -> Dict[str, Any]:
    """
    Get Redis-specific metrics
    
    Args:
        cache: Cache service instance
        
    Returns:
        Redis metrics dictionary
    """
    metrics = {
        "hits": 0,
        "misses": 0,
        "hitRate": "0%",
        "keys": 0,
        "memory": "0 MB",
        "uptime": 0,
        "connected": False
    }
    
    try:
        if isinstance(cache.redis_client, redis.Redis):
            info = cache.redis_client.info()
            stats = cache.redis_client.info("stats")
            
            # Calculate hit rate
            hits = stats.get("keyspace_hits", 0)
            misses = stats.get("keyspace_misses", 0)
            total = hits + misses
            hit_rate = (hits / total * 100) if total > 0 else 0
            
            metrics.update({
                "hits": hits,
                "misses": misses,
                "hitRate": f"{hit_rate:.2f}%",
                "keys": cache.redis_client.dbsize(),
                "memory": info.get("used_memory_human", "0 MB"),
                "uptime": info.get("uptime_in_seconds", 0),
                "connected": True
            })
            
    except Exception as e:
        # Redis not available or error
        pass
    
    return metrics


async def get_categories_cache_info(cache: CacheService) -> Dict[str, Any]:
    """
    Get category-specific cache information
    
    Args:
        cache: Cache service instance
        
    Returns:
        Category cache information
    """
    info = {
        "totalCached": 0,
        "ttl": 1800,  # Default TTL in seconds
        "lastUpdate": None
    }
    
    try:
        # Check if categories are cached
        cached_all = await cache.get("categories:all:inactive_False")
        if cached_all:
            categories = json.loads(cached_all)
            info["totalCached"] = len(categories)
            
            # Get TTL of the key
            if isinstance(cache.redis_client, redis.Redis):
                ttl = cache.redis_client.ttl("categories:all:inactive_False")
                if ttl > 0:
                    info["ttl"] = ttl
        
        # Check last update time (would need to track this)
        info["lastUpdate"] = datetime.utcnow().isoformat()
        
    except Exception:
        pass
    
    return info


async def warm_all_caches(db: Session, cache: CacheService, category_service):
    """
    Warm all caches with commonly accessed data
    
    Args:
        db: Database session
        cache: Cache service
        category_service: Category cache service
    """
    try:
        # Warm category caches
        await category_service.preload_common_categories(db)
        
        # Could warm other caches here (line items, templates, etc.)
        
        import logging
        logging.info("Cache warming completed successfully")
        
    except Exception as e:
        import logging
        logging.error(f"Cache warming failed: {e}")