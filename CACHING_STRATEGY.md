# Multi-Level Caching Strategy for Line Item Categories

## Overview

This document describes the comprehensive multi-level caching strategy implemented for line item categories in the MJ Estimate application. The strategy optimizes for frequently accessed, infrequently changed data with a focus on performance and user experience.

## Architecture

### Cache Levels

```
┌─────────────────┐
│   Browser       │
│  Memory Cache   │ <-- Level 1: Instant access (0ms)
└────────┬────────┘
         │
┌────────▼────────┐
│  Local Storage  │ <-- Level 2: Offline support (1-5ms)
└────────┬────────┘
         │
┌────────▼────────┐
│  React Query    │ <-- Level 3: Server state management (stale-while-revalidate)
└────────┬────────┘
         │ HTTP
┌────────▼────────┐
│  FastAPI Cache  │ <-- Level 4: Backend endpoint caching
└────────┬────────┘
         │
┌────────▼────────┐
│  Redis Cache    │ <-- Level 5: Distributed cache (1-10ms)
└────────┬────────┘
         │
┌────────▼────────┐
│   PostgreSQL    │ <-- Level 6: Source of truth
└─────────────────┘
```

## Implementation Details

### 1. Frontend Caching

#### Memory Cache (Level 1)
- **Location**: `frontend/src/hooks/useCategories.ts`
- **Strategy**: LRU (Least Recently Used) eviction
- **Capacity**: 100 categories maximum
- **Access Time**: <1ms
- **Use Case**: Instant access for dropdown selections

```typescript
// Usage example
import { useCategories } from './hooks/useCategories';

function MyComponent() {
  const { getCategoryByCode, getCategoryName } = useCategories();
  
  // Instant lookup from memory cache
  const categoryName = getCategoryName('PLUMB');
}
```

#### Local Storage (Level 2)
- **Strategy**: Version-controlled persistence
- **TTL**: 24 hours
- **Size Limit**: ~5MB
- **Use Case**: Offline support, initial load optimization

#### React Query (Level 3)
- **Stale Time**: 30 minutes
- **Cache Time**: 60 minutes
- **Strategy**: Stale-while-revalidate
- **Features**: Background refetching, optimistic updates

### 2. Backend Caching

#### FastAPI Endpoint Cache (Level 4)
- **Location**: `backend/app/domains/line_items/api.py`
- **Decorator-based**: `@cache_result(ttl=1800)`
- **Background warming**: Preloads related data

```python
# Endpoint with caching
@router.get("/categories")
async def get_categories(
    cache: CacheService = Depends(get_cache)
):
    # Automatic cache check and update
    cache_key = "categories:all"
    cached = await cache.get(cache_key)
    if cached:
        return json.loads(cached)
    # ... fetch and cache
```

#### Redis Cache (Level 5)
- **Location**: `backend/app/core/cache.py`
- **TTL Configuration**:
  - Full category list: 30 minutes
  - Individual categories: 1 hour
  - Search results: 15 minutes
  - Modal formats: 30 minutes
- **Fallback**: In-memory cache when Redis unavailable

#### Cache Service (Level 6)
- **Location**: `backend/app/domains/line_items/cache_service.py`
- **Features**:
  - Cache warming
  - Intelligent invalidation
  - Performance metrics
  - Hierarchical caching

## Cache Management

### Cache Invalidation Strategy

#### Automatic Invalidation
- On category create/update/delete
- Pattern-based invalidation
- Cascade invalidation for dependent data

```python
# Decorator for automatic invalidation
@invalidate_category_cache(codes={'PLUMB', 'ELEC'})
async def update_category(code: str, updates: dict):
    # Update logic
    # Cache automatically invalidated after execution
```

#### Manual Invalidation
- Admin dashboard controls
- API endpoints for cache management
- Selective or complete cache clearing

### Cache Warming

#### Startup Warming
```python
# Application startup
async def startup_event():
    cache_service = get_category_cache_service()
    await cache_service.preload_common_categories(db)
```

#### On-Demand Warming
- Background tasks after cache miss
- Predictive warming based on usage patterns
- Bulk warming via admin interface

### Performance Monitoring

#### Metrics Tracked
- Cache hit/miss rates
- Response times
- Memory usage
- TTL effectiveness

#### Monitoring Dashboard
- **Location**: `frontend/src/components/admin/CacheMonitor.tsx`
- Real-time metrics
- Cache management tools
- Performance recommendations

## Configuration

### Frontend Configuration
```typescript
// frontend/src/hooks/useCategories.ts
const CACHE_CONFIG = {
  STALE_TIME: 30 * 60 * 1000,     // 30 minutes
  CACHE_TIME: 60 * 60 * 1000,     // 1 hour
  LOCAL_STORAGE_KEY: 'mj_categories_cache',
  MAX_MEMORY_CACHE_SIZE: 100,
};
```

### Backend Configuration
```python
# backend/app/domains/line_items/cache_service.py
TTL_CONFIG = {
    'categories_all': 1800,      # 30 minutes
    'category_individual': 3600,  # 1 hour
    'search_results': 900,       # 15 minutes
    'modal_format': 1800,       # 30 minutes
}
```

### Redis Configuration
```python
# backend/app/core/config.py
REDIS_HOST = 'localhost'
REDIS_PORT = 6379
REDIS_DB = 0
```

## API Endpoints

### Cache Management Endpoints
- `GET /api/admin/cache/metrics` - Get cache performance metrics
- `POST /api/admin/cache/clear` - Clear cache (pattern-based)
- `POST /api/admin/cache/warm` - Warm cache with common data
- `GET /api/admin/cache/keys` - List cached keys
- `GET /api/admin/cache/stats` - Detailed cache statistics

## Performance Benchmarks

### Expected Performance
| Operation | Cold Cache | Warm Cache | Improvement |
|-----------|------------|------------|-------------|
| Get All Categories | 50-100ms | 1-5ms | 95% |
| Get Single Category | 20-30ms | <1ms | 97% |
| Search Categories | 30-50ms | 5-10ms | 80% |
| Modal Load | 100-150ms | 10-20ms | 87% |

### Cache Hit Rates (Target)
- Memory Cache: >90%
- Redis Cache: >80%
- Overall System: >85%

## Migration Strategy

### Phase 1: Backend Implementation (Completed)
1. ✅ Implement Redis cache service
2. ✅ Add caching to category endpoints
3. ✅ Create cache management service
4. ✅ Add monitoring endpoints

### Phase 2: Frontend Implementation (Completed)
1. ✅ Create useCategories hook
2. ✅ Implement memory cache
3. ✅ Add local storage persistence
4. ✅ Integrate React Query

### Phase 3: Monitoring & Optimization
1. ✅ Create monitoring dashboard
2. ⏳ Collect performance metrics
3. ⏳ Optimize cache TTLs based on usage
4. ⏳ Implement predictive warming

### Phase 4: Database Migration
1. ⏳ Move hardcoded categories to database
2. ⏳ Create admin UI for category management
3. ⏳ Implement data migration scripts
4. ⏳ Update all references to use cached data

## Usage Examples

### Frontend Usage
```typescript
// Using the categories hook
import { useCategories, useCategoryModal } from './hooks/useCategories';

function EstimateForm() {
  const { categories, getCategoryName, isLoading } = useCategories();
  const { modalCategories, searchTerm, setSearchTerm } = useCategoryModal();
  
  // Categories are automatically cached and synchronized
  return (
    <Select>
      {categories.map(cat => (
        <Option key={cat.code} value={cat.code}>
          {cat.name}
        </Option>
      ))}
    </Select>
  );
}
```

### Backend Usage
```python
# Using the cache service
from app.domains.line_items.cache_service import get_category_cache_service

async def get_categories_optimized(db: Session):
    cache_service = get_category_cache_service()
    
    # Automatically uses cache with fallback to database
    categories = await cache_service.get_or_fetch_categories(db)
    return categories
```

## Troubleshooting

### Common Issues

#### Low Cache Hit Rate
- Check TTL configuration
- Verify Redis connectivity
- Review access patterns
- Consider cache warming

#### Memory Issues
- Adjust MAX_MEMORY_CACHE_SIZE
- Review Redis maxmemory policy
- Implement more aggressive eviction

#### Stale Data
- Check invalidation logic
- Verify TTL settings
- Review update patterns
- Consider shorter TTLs

### Monitoring Commands
```bash
# Check Redis status
redis-cli ping

# Monitor Redis commands
redis-cli monitor

# Check memory usage
redis-cli info memory

# List category keys
redis-cli keys "categories:*"
```

## Best Practices

1. **Always check cache first** - Reduces database load
2. **Use appropriate TTLs** - Balance freshness vs performance
3. **Implement fallbacks** - Handle cache failures gracefully
4. **Monitor performance** - Track metrics and adjust
5. **Warm critical data** - Preload frequently accessed items
6. **Invalidate precisely** - Clear only affected cache entries
7. **Version cache keys** - Prevent stale data issues
8. **Document changes** - Keep cache strategy updated

## Future Enhancements

1. **Predictive Caching** - Use ML to predict access patterns
2. **Edge Caching** - CDN integration for global performance
3. **GraphQL Integration** - Cache GraphQL query results
4. **WebSocket Updates** - Real-time cache invalidation
5. **Cache Analytics** - Detailed usage analytics
6. **Auto-tuning** - Self-adjusting TTLs based on usage

## Conclusion

This multi-level caching strategy provides:
- ✅ Sub-millisecond category access
- ✅ Offline support
- ✅ Automatic synchronization
- ✅ Performance monitoring
- ✅ Easy cache management
- ✅ Scalable architecture

The implementation significantly improves user experience while reducing backend load and infrastructure costs.