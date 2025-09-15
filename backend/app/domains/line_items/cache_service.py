"""
Category Cache Management Service

Provides intelligent cache management for line item categories with:
- Multi-tier caching strategy
- Cache warming and invalidation
- Performance monitoring
- Automatic cache coherence
"""

import json
import asyncio
import logging
from typing import List, Dict, Any, Optional, Set
from datetime import datetime, timedelta
from app.core.cache import CacheService, get_cache
from app.domains.line_items.category_models import LineItemCategory
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class CategoryCacheService:
    """
    Manages category caching with multiple strategies:
    - Full list caching for common queries
    - Individual category caching for lookups
    - Search result caching
    - Modal format caching
    - Cache coherence management
    """
    
    # Cache TTL configurations (in seconds)
    TTL_CONFIG = {
        'categories_all': 1800,  # 30 minutes for full list
        'category_individual': 3600,  # 1 hour for individual categories
        'search_results': 900,  # 15 minutes for search results
        'modal_format': 1800,  # 30 minutes for modal data
        'statistics': 300,  # 5 minutes for stats
    }
    
    # Cache key patterns for invalidation
    CACHE_PATTERNS = {
        'all': 'categories:*',
        'list': 'categories:all:*',
        'individual': 'category:code:*',
        'search': 'categories:search:*',
        'modal': 'categories:modal:*',
    }
    
    def __init__(self, cache: CacheService):
        self.cache = cache
        self.metrics = {
            'hits': 0,
            'misses': 0,
            'invalidations': 0,
            'warm_ups': 0,
        }
    
    async def get_or_fetch_categories(
        self,
        db: Session,
        include_inactive: bool = False,
        force_refresh: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Get categories with intelligent caching
        
        Args:
            db: Database session
            include_inactive: Include inactive categories
            force_refresh: Force cache refresh
            
        Returns:
            List of category dictionaries
        """
        cache_key = f"categories:all:inactive_{include_inactive}"
        
        # Force refresh if requested
        if force_refresh:
            await self.invalidate_category_caches()
        
        # Try cache first
        if not force_refresh:
            cached = await self.cache.get(cache_key)
            if cached:
                try:
                    self.metrics['hits'] += 1
                    return json.loads(cached)
                except json.JSONDecodeError:
                    await self.cache.delete(cache_key)
        
        # Cache miss - fetch from database
        self.metrics['misses'] += 1
        
        query = db.query(LineItemCategory)
        if not include_inactive:
            query = query.filter(LineItemCategory.is_active == True)
        
        categories = query.order_by(LineItemCategory.display_order).all()
        
        # Convert to dict for caching
        result = [cat.to_dict() for cat in categories]
        
        # Cache the result
        await self.cache.set(
            cache_key,
            json.dumps(result),
            ttl=self.TTL_CONFIG['categories_all']
        )
        
        # Warm up related caches in background
        asyncio.create_task(self.warm_up_caches(categories))
        
        return result
    
    async def get_category_by_code(
        self,
        code: str,
        db: Session
    ) -> Optional[Dict[str, Any]]:
        """
        Get single category by code with caching
        
        Args:
            code: Category code
            db: Database session
            
        Returns:
            Category dictionary or None
        """
        cache_key = f"category:code:{code}"
        
        # Try cache first
        cached = await self.cache.get(cache_key)
        if cached:
            try:
                self.metrics['hits'] += 1
                return json.loads(cached)
            except json.JSONDecodeError:
                await self.cache.delete(cache_key)
        
        # Cache miss
        self.metrics['misses'] += 1
        
        category = db.query(LineItemCategory).filter(
            LineItemCategory.code == code
        ).first()
        
        if category:
            result = category.to_dict()
            await self.cache.set(
                cache_key,
                json.dumps(result),
                ttl=self.TTL_CONFIG['category_individual']
            )
            return result
        
        return None
    
    async def warm_up_caches(self, categories: List[LineItemCategory]):
        """
        Warm up various cache formats in background
        
        Args:
            categories: List of category objects
        """
        self.metrics['warm_ups'] += 1
        
        try:
            # Cache individual categories
            for cat in categories:
                cache_key = f"category:code:{cat.code}"
                await self.cache.set(
                    cache_key,
                    json.dumps(cat.to_dict()),
                    ttl=self.TTL_CONFIG['category_individual']
                )
            
            # Cache modal format
            modal_data = [
                {
                    "code": cat.code,
                    "description": cat.name,
                    "full_description": f"{cat.name} - {cat.description}" if cat.description else cat.name
                }
                for cat in categories if cat.is_active
            ]
            
            await self.cache.set(
                "categories:modal:all",
                json.dumps(modal_data),
                ttl=self.TTL_CONFIG['modal_format']
            )
            
            # Cache category hierarchy if needed
            hierarchy = self._build_hierarchy(categories)
            await self.cache.set(
                "categories:hierarchy",
                json.dumps(hierarchy),
                ttl=self.TTL_CONFIG['categories_all']
            )
            
            logger.info(f"Warmed up caches for {len(categories)} categories")
            
        except Exception as e:
            logger.error(f"Failed to warm up caches: {e}")
    
    async def invalidate_category_caches(self, codes: Optional[Set[str]] = None):
        """
        Invalidate category caches
        
        Args:
            codes: Specific category codes to invalidate, or None for all
        """
        self.metrics['invalidations'] += 1
        
        if codes:
            # Invalidate specific categories
            for code in codes:
                await self.cache.delete(f"category:code:{code}")
            
            # Also invalidate list caches since they contain these categories
            await self.cache.delete_pattern(self.CACHE_PATTERNS['list'])
            await self.cache.delete_pattern(self.CACHE_PATTERNS['modal'])
        else:
            # Invalidate all category caches
            for pattern in self.CACHE_PATTERNS.values():
                await self.cache.delete_pattern(pattern)
        
        logger.info(f"Invalidated category caches for codes: {codes or 'all'}")
    
    async def cache_search_results(
        self,
        search_term: str,
        results: List[Dict[str, Any]],
        filters: Dict[str, Any] = None
    ):
        """
        Cache search results with filters
        
        Args:
            search_term: Search query
            results: Search results
            filters: Additional filters applied
        """
        # Generate cache key from search parameters
        filter_str = json.dumps(filters or {}, sort_keys=True)
        cache_key = self.cache.cache_key(
            "categories",
            "search",
            search_term,
            filter_str
        )
        
        await self.cache.set(
            cache_key,
            json.dumps(results),
            ttl=self.TTL_CONFIG['search_results']
        )
    
    async def get_cached_search_results(
        self,
        search_term: str,
        filters: Dict[str, Any] = None
    ) -> Optional[List[Dict[str, Any]]]:
        """
        Get cached search results
        
        Args:
            search_term: Search query
            filters: Additional filters
            
        Returns:
            Cached results or None
        """
        filter_str = json.dumps(filters or {}, sort_keys=True)
        cache_key = self.cache.cache_key(
            "categories",
            "search",
            search_term,
            filter_str
        )
        
        cached = await self.cache.get(cache_key)
        if cached:
            try:
                self.metrics['hits'] += 1
                return json.loads(cached)
            except json.JSONDecodeError:
                await self.cache.delete(cache_key)
        
        self.metrics['misses'] += 1
        return None
    
    def _build_hierarchy(self, categories: List[LineItemCategory]) -> Dict[str, Any]:
        """
        Build category hierarchy for nested display
        
        Args:
            categories: List of category objects
            
        Returns:
            Hierarchical dictionary structure
        """
        hierarchy = {}
        cat_dict = {cat.code: cat for cat in categories}
        
        for cat in categories:
            if not cat.parent_code:
                # Root category
                hierarchy[cat.code] = {
                    'category': cat.to_dict(),
                    'children': self._get_children(cat.code, cat_dict)
                }
        
        return hierarchy
    
    def _get_children(
        self,
        parent_code: str,
        cat_dict: Dict[str, LineItemCategory]
    ) -> List[Dict[str, Any]]:
        """
        Recursively get child categories
        
        Args:
            parent_code: Parent category code
            cat_dict: Dictionary of all categories
            
        Returns:
            List of child category structures
        """
        children = []
        
        for cat in cat_dict.values():
            if cat.parent_code == parent_code:
                children.append({
                    'category': cat.to_dict(),
                    'children': self._get_children(cat.code, cat_dict)
                })
        
        return sorted(children, key=lambda x: x['category']['display_order'])
    
    def get_metrics(self) -> Dict[str, Any]:
        """
        Get cache performance metrics
        
        Returns:
            Dictionary of metrics
        """
        total_requests = self.metrics['hits'] + self.metrics['misses']
        hit_rate = (self.metrics['hits'] / total_requests * 100) if total_requests > 0 else 0
        
        return {
            'hits': self.metrics['hits'],
            'misses': self.metrics['misses'],
            'hit_rate': f"{hit_rate:.2f}%",
            'invalidations': self.metrics['invalidations'],
            'warm_ups': self.metrics['warm_ups'],
            'total_requests': total_requests,
        }
    
    async def preload_common_categories(self, db: Session):
        """
        Preload commonly used categories on startup
        
        Args:
            db: Database session
        """
        try:
            # Get all active categories
            categories = db.query(LineItemCategory).filter(
                LineItemCategory.is_active == True
            ).all()
            
            # Warm up all cache formats
            await self.warm_up_caches(categories)
            
            logger.info(f"Preloaded {len(categories)} categories into cache")
            
        except Exception as e:
            logger.error(f"Failed to preload categories: {e}")


# Singleton instance
_category_cache_service: Optional[CategoryCacheService] = None


def get_category_cache_service(cache: CacheService = None) -> CategoryCacheService:
    """
    Get singleton category cache service
    
    Args:
        cache: Cache service instance
        
    Returns:
        CategoryCacheService instance
    """
    global _category_cache_service
    
    if _category_cache_service is None:
        cache = cache or get_cache()
        _category_cache_service = CategoryCacheService(cache)
    
    return _category_cache_service


# Cache invalidation decorators
def invalidate_category_cache(codes: Optional[Set[str]] = None):
    """
    Decorator to invalidate category caches after function execution
    
    Args:
        codes: Specific category codes to invalidate
    """
    def decorator(func):
        async def wrapper(*args, **kwargs):
            result = await func(*args, **kwargs)
            
            # Invalidate caches
            cache_service = get_category_cache_service()
            await cache_service.invalidate_category_caches(codes)
            
            return result
        return wrapper
    return decorator