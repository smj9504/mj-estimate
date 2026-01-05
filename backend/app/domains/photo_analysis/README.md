# Photo Analysis Domain

AI-powered room photo analysis using OpenAI GPT-4 Vision for pack-in/out item estimation.

## Overview

The Photo Analysis domain provides intelligent analysis of room photos to automatically detect and count items for pack calculation. It uses OpenAI's GPT-4 Vision API to analyze 1-10 photos of a room and return detailed item inventories.

## Features

- **Multi-Photo Analysis**: Analyze 1-10 photos of the same room for comprehensive coverage
- **Room-Specific Intelligence**: Custom prompts for each room type (kitchen, bedroom, bathroom, etc.)
- **Item Deduplication**: Smart aggregation when same items appear in multiple photos
- **Confidence Scoring**: AI confidence scores for each detected item and overall analysis
- **Result Caching**: 30-day cache to avoid redundant API calls and reduce costs
- **Mock Provider**: Testing without API costs using realistic mock data
- **Cost Optimization**: Image resizing and batch processing for efficient API usage

## Architecture

```
photo_analysis/
├── models.py           # Database models (PhotoAnalysisCache)
├── schemas.py          # Pydantic request/response schemas
├── repository.py       # Data access layer with caching
├── service.py          # Main orchestrator (workflow logic)
├── api.py              # FastAPI REST endpoints
├── aggregator.py       # Multi-photo deduplication logic
├── providers/
│   ├── base.py        # Abstract provider interface
│   ├── openai_vision.py  # OpenAI GPT-4 Vision implementation
│   └── mock.py        # Mock provider for testing
└── prompts/
    └── room_prompts.py   # Room-specific prompt templates
```

## API Endpoints

### POST /api/photo-analysis/analyze

Analyze room photos with AI vision.

**Request:**
```json
{
  "room_type": "KITCHEN",
  "photo_urls": [
    "https://example.com/photo1.jpg",
    "https://example.com/photo2.jpg"
  ],
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "use_cache": true,
  "provider": "openai"
}
```

**Response:**
```json
{
  "items": [
    {
      "category": "Kitchen Items",
      "subcategory": "Pots & Pans",
      "quantity": 8,
      "confidence": 0.85,
      "pack_size": 1,
      "storage_type": "cabinet"
    }
  ],
  "density_level": "MODERATE",
  "confidence_score": 0.82,
  "total_boxes": 12,
  "processing_time": 3.2,
  "detected_features": ["crowded_counters", "full_cabinets"],
  "cache_used": false,
  "cache_key": "abc123def456"
}
```

### GET /api/photo-analysis/cache/{cache_key}

Retrieve cached analysis result.

### DELETE /api/photo-analysis/cache/cleanup

Clean up expired cache entries.

### GET /api/photo-analysis/info

Get service configuration and status.

### GET /api/photo-analysis/health

Health check for photo analysis service.

## Configuration

Add to your `.env` file:

```bash
# OpenAI API Configuration
OPENAI_API_KEY=sk-your-api-key-here

# Photo Analysis Settings
PHOTO_ANALYSIS_CACHE_ENABLED=true
PHOTO_ANALYSIS_CACHE_TTL_DAYS=30
PHOTO_ANALYSIS_MODEL=gpt-4-vision-preview
```

## Usage Examples

### Python Client

```python
import requests

# Analyze photos
response = requests.post(
    "http://localhost:8000/api/photo-analysis/analyze",
    json={
        "room_type": "KITCHEN",
        "photo_urls": [
            "https://example.com/kitchen1.jpg",
            "https://example.com/kitchen2.jpg"
        ],
        "use_cache": True,
        "provider": "openai"
    }
)

result = response.json()
print(f"Detected {len(result['items'])} items")
print(f"Estimated {result['total_boxes']} boxes needed")
print(f"Confidence: {result['confidence_score']:.2%}")
```

### Frontend Integration

```typescript
// TypeScript/React example
const analyzePhotos = async (roomType: string, photoUrls: string[]) => {
  const response = await fetch('/api/photo-analysis/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      room_type: roomType,
      photo_urls: photoUrls,
      use_cache: true,
      provider: 'openai'
    })
  });

  const result = await response.json();
  return result;
};
```

## Supported Room Types

- **KITCHEN**: Appliances, dishes, pantry items, utensils
- **BEDROOM**: Clothing, shoes, bedding, accessories
- **LIVING_ROOM**: Electronics, books, decorative items
- **BATHROOM**: Toiletries, linens, cleaning supplies
- **GARAGE**: Tools, sports equipment, seasonal items
- **OFFICE**: Furniture, electronics, books, files
- **DINING_ROOM**: Dishes, glassware, serving pieces
- **BASEMENT**: Storage boxes, furniture, equipment
- **ATTIC**: Storage boxes, seasonal decorations
- **CLOSET**: Hanging/folded clothes, shoes, accessories
- **LAUNDRY**: Appliances, supplies, linens

## AI Prompts

Each room type has a specialized prompt that guides GPT-4 Vision to:

1. **Identify visible items**: Count items directly visible in photos
2. **Estimate hidden items**: Use visual clues (cabinet count, drawer count) to estimate contents
3. **Assess density**: Categorize room fullness (MINIMAL/MODERATE/FULL/PACKED)
4. **Return structured JSON**: Consistent output format for all rooms

Example prompt structure:
```
Analyze this [ROOM_TYPE] photo carefully.

VISIBLE ITEMS TO COUNT:
- [Category 1]: [specific items]
- [Category 2]: [specific items]

ESTIMATED HIDDEN ITEMS:
- [Storage location]: [estimated contents]

DENSITY INDICATORS:
- MINIMAL: [description]
- MODERATE: [description]
- FULL: [description]
- PACKED: [description]

PACKING GUIDELINES:
- [Item type]: [items per box]
```

## Multi-Photo Aggregation

When multiple photos are provided, the aggregator:

1. **Deduplicates items**: Same item in multiple photos → highest confidence + averaged quantity
2. **Combines different angles**: Different items visible → sum all items
3. **Confidence boost**: More photos = higher confidence (up to 1.25x multiplier)
4. **Density voting**: Weighted voting based on confidence scores

## Caching Strategy

- **Cache key**: SHA256 hash of (room_type + photo_urls + model_version)
- **TTL**: 30 days (configurable)
- **Storage**: PostgreSQL/Supabase database
- **Cleanup**: Automatic cleanup endpoint for expired entries

Benefits:
- Avoid duplicate API calls for same photos
- Reduce OpenAI API costs
- Faster response for repeated analyses
- User-specific cache isolation

## Cost Optimization

1. **Image Resizing**: Photos resized to 512x512 before API call
2. **Detail Level**: Using "low" detail mode for cost efficiency
3. **Caching**: 30-day cache reduces redundant API calls
4. **Batch Processing**: Multiple photos analyzed concurrently
5. **Mock Provider**: Free testing without API costs

**Estimated Costs (OpenAI GPT-4 Vision):**
- Single photo: ~$0.01-0.02
- 3 photos: ~$0.03-0.06
- 10 photos: ~$0.10-0.20

With caching, repeated analyses are free.

## Error Handling

- **Retry Logic**: 3 attempts with exponential backoff
- **Graceful Degradation**: Falls back to mock provider on failure
- **JSON Parsing**: Handles various response formats (JSON, markdown code blocks)
- **Timeout Protection**: 30-second timeout per API call

## Testing

### Unit Tests

```bash
cd backend
pytest app/domains/photo_analysis/tests/
```

### Mock Provider

For development and testing without API costs:

```python
response = requests.post(
    "http://localhost:8000/api/photo-analysis/analyze",
    json={
        "room_type": "KITCHEN",
        "photo_urls": ["https://example.com/photo.jpg"],
        "provider": "mock"  # Use mock provider
    }
)
```

### Integration Test

```bash
# Test with real OpenAI API
curl -X POST http://localhost:8000/api/photo-analysis/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "room_type": "KITCHEN",
    "photo_urls": ["https://example.com/kitchen.jpg"],
    "provider": "openai"
  }'
```

## Database Schema

### photo_analysis_cache

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| cache_key | String(255) | Unique cache key (SHA256 hash) |
| room_type | String(50) | Room type analyzed |
| photo_urls | JSON | Array of photo URLs |
| analysis_result | JSON | Full PhotoAnalysisResponse |
| confidence_score | Float | Overall confidence score |
| user_id | UUID (nullable) | User who created this cache |
| expires_at | DateTime(TZ) | Cache expiration time |
| created_at | DateTime(TZ) | Creation timestamp |
| updated_at | DateTime(TZ) | Last update timestamp |

**Indexes:**
- `ix_photo_analysis_cache_key` (unique)
- `ix_photo_analysis_cache_user_id`
- `ix_photo_analysis_cache_expires_at`

## Performance

- **Single photo**: ~2-4 seconds
- **3 photos**: ~6-10 seconds (concurrent processing)
- **10 photos**: ~15-25 seconds (concurrent processing)
- **Cached result**: <100ms

## Security Considerations

1. **API Key Protection**: OpenAI API key stored in environment variables
2. **Rate Limiting**: Implement rate limiting on analyze endpoint
3. **Photo URL Validation**: Validate photo URLs before processing
4. **Cache Isolation**: Optional user_id for cache entry isolation

## Future Enhancements

- [ ] Support for additional AI providers (Claude Vision, Gemini Vision)
- [ ] Real-time photo streaming analysis
- [ ] Image quality validation and suggestions
- [ ] Automated photo angle suggestions
- [ ] Integration with storage providers (S3, GCS) for photo uploads
- [ ] Webhook notifications for long-running analyses
- [ ] Analytics dashboard for usage tracking

## Troubleshooting

### OpenAI API Errors

**Problem**: "OpenAI API key not configured"
**Solution**: Set `OPENAI_API_KEY` in your `.env` file

**Problem**: Rate limit errors
**Solution**: Implement rate limiting or request quota increase from OpenAI

### Cache Issues

**Problem**: Cache not working
**Solution**: Check `PHOTO_ANALYSIS_CACHE_ENABLED=true` in config

**Problem**: Stale cache entries
**Solution**: Call `/api/photo-analysis/cache/cleanup` endpoint

### Image Processing Errors

**Problem**: "Image optimization failed"
**Solution**: Ensure photo URLs are publicly accessible and valid image formats

## References

- [OpenAI Vision API Documentation](https://platform.openai.com/docs/guides/vision)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Pack Calculation Domain](../pack_calculation/README.md)

## Support

For issues or questions, contact the development team or create an issue in the project repository.
