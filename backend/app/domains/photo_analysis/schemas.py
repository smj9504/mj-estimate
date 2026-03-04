"""
Photo Analysis Pydantic Schemas

Request/response schemas for AI-powered photo analysis.
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel, Field, HttpUrl

from app.domains.pack_calculation.templates.base_template import RoomType, DensityLevel


class DetectedItem(BaseModel):
    """Individual item detected in photo analysis"""
    category: str = Field(..., description="Item category (e.g., 'Kitchen Items', 'Appliances')")
    subcategory: Optional[str] = Field(None, description="Item subcategory (e.g., 'Pots & Pans')")
    quantity: int = Field(..., ge=0, description="Estimated quantity of items")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence score (0.0-1.0)")
    pack_size: int = Field(1, ge=1, description="How many items fit in one box")
    storage_type: Optional[str] = Field(None, description="Where stored: visible|cabinet|closet|drawer")
    packing_method: Optional[str] = Field(None, description="Detailed packing instructions for this item")
    box_type: Optional[str] = Field(None, description="Recommended box type: SMALL_BOX|MEDIUM_BOX|LARGE_BOX|WARDROBE_BOX|DISH_PACK_BOX|PICTURE_BOX|LONG_BOX|LAMP_BOX|TV_BOX|TUBE_BOX|N/A")
    special_handling: List[str] = Field(default_factory=list, description="Special handling requirements: FRAGILE|HEAVY|TWO_PERSON_LIFT|ELECTRICAL|DISASSEMBLY|VALUABLE|FABRIC_PROTECTION")

    class Config:
        json_schema_extra = {
            "example": {
                "category": "Kitchen Items",
                "subcategory": "Pots & Pans",
                "quantity": 8,
                "confidence": 0.85,
                "pack_size": 1,
                "storage_type": "cabinet",
                "packing_method": "Wrap each item in packing paper, layer in dish pack box",
                "box_type": "DISH_PACK_BOX",
                "special_handling": ["FRAGILE"]
            }
        }


class PhotoAnalysisRequest(BaseModel):
    """Request for photo analysis"""
    room_type: RoomType = Field(..., description="Type of room being analyzed")
    photo_urls: List[HttpUrl] = Field(..., min_length=1, max_length=10, description="1-10 photo URLs")
    user_id: Optional[UUID] = Field(None, description="User ID for caching/tracking")
    use_cache: bool = Field(True, description="Whether to use cached results if available")
    provider: Optional[str] = Field("openai", description="Analysis provider (openai, mock)")

    class Config:
        json_schema_extra = {
            "example": {
                "room_type": "KITCHEN",
                "photo_urls": [
                    "https://example.com/photo1.jpg",
                    "https://example.com/photo2.jpg"
                ],
                "user_id": "550e8400-e29b-41d4-a716-446655440000",
                "use_cache": True,
                "provider": "openai"
            }
        }


class PhotoAnalysisResponse(BaseModel):
    """Response from photo analysis"""
    items: List[DetectedItem] = Field(..., description="Detected items with quantities")
    density_level: DensityLevel = Field(..., description="Overall room density (MINIMAL/MODERATE/FULL/PACKED)")
    confidence_score: float = Field(..., ge=0.0, le=1.0, description="Overall confidence (0.0-1.0)")
    total_boxes: int = Field(..., ge=0, description="Estimated total boxes needed")
    processing_time: float = Field(..., ge=0.0, description="Processing time in seconds")
    detected_features: List[str] = Field(default_factory=list, description="Visual features detected")
    cache_used: bool = Field(False, description="Whether cached result was used")
    cache_key: Optional[str] = Field(None, description="Cache key for this analysis")

    class Config:
        json_schema_extra = {
            "example": {
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
                "cache_used": False,
                "cache_key": "abc123def456"
            }
        }


class AnalysisCacheEntry(BaseModel):
    """Cache entry for analysis results"""
    cache_key: str = Field(..., description="Unique cache key")
    room_type: RoomType = Field(..., description="Room type analyzed")
    photo_urls: List[str] = Field(..., description="Photo URLs used")
    analysis_result: PhotoAnalysisResponse = Field(..., description="Cached analysis result")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Cache creation time")
    expires_at: datetime = Field(..., description="Cache expiration time")
    user_id: Optional[UUID] = Field(None, description="User who created this cache entry")

    class Config:
        json_schema_extra = {
            "example": {
                "cache_key": "abc123def456",
                "room_type": "KITCHEN",
                "photo_urls": ["https://example.com/photo1.jpg"],
                "analysis_result": {},
                "created_at": "2024-12-11T10:00:00Z",
                "expires_at": "2025-01-10T10:00:00Z",
                "user_id": "550e8400-e29b-41d4-a716-446655440000"
            }
        }


class SinglePhotoAnalysisResult(BaseModel):
    """Result from analyzing a single photo"""
    items: List[DetectedItem]
    density_level: DensityLevel
    detected_features: List[str]
    total_boxes_estimate: int
    confidence_score: float

    class Config:
        json_schema_extra = {
            "example": {
                "items": [],
                "density_level": "MODERATE",
                "detected_features": ["crowded_counters"],
                "total_boxes_estimate": 6,
                "confidence_score": 0.85
            }
        }
