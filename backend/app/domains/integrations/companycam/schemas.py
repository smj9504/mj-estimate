"""
CompanyCam-specific schemas for webhook payloads and API responses
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime
from uuid import UUID


# CompanyCam API Response Models

class CompanyCamUser(BaseModel):
    """CompanyCam user information"""
    id: int
    name: str
    email_address: Optional[str] = None


class CompanyCamCoordinates(BaseModel):
    """Photo GPS coordinates"""
    lat: Optional[float] = None
    lon: Optional[float] = None
    accuracy: Optional[float] = None


class CompanyCamPhotoUris(BaseModel):
    """Photo URLs from CompanyCam"""
    original: str
    large: Optional[str] = None
    medium: Optional[str] = None
    small: Optional[str] = None
    thumbnail: Optional[str] = None


class CompanyCamProject(BaseModel):
    """CompanyCam project information"""
    id: int
    name: str
    address: Optional[Dict[str, Any]] = None  # {street, city, state, zip}
    coordinates: Optional[CompanyCamCoordinates] = None


class CompanyCamPhoto(BaseModel):
    """CompanyCam photo object from API/webhook"""
    id: int
    project_id: int
    creator_id: int
    photo_description: Optional[str] = None
    uris: CompanyCamPhotoUris
    coordinates: Optional[CompanyCamCoordinates] = None
    captured_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    tags: Optional[List[str]] = []


# Webhook Event Models

class PhotoCreatedWebhook(BaseModel):
    """
    CompanyCam photo.created webhook payload

    Example payload:
    {
        "type": "photo.created",
        "photo": {...},
        "project": {...},
        "user": {...}
    }
    """
    type: str = Field(..., description="Event type: photo.created")
    photo: CompanyCamPhoto
    project: CompanyCamProject
    user: CompanyCamUser


class CompanyCamWebhookPayload(BaseModel):
    """Generic webhook payload wrapper"""
    type: str
    data: Dict[str, Any]


# Internal Processing Models

class AddressInfo(BaseModel):
    """Parsed address information"""
    street: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zipcode: Optional[str] = None

    @property
    def full_address(self) -> str:
        """Get full address string"""
        parts = [p for p in [self.street, self.city, self.state, self.zipcode] if p]
        return ", ".join(parts)

    @property
    def is_complete(self) -> bool:
        """Check if address has minimum required fields"""
        return bool(self.street and self.city and self.state)


class WorkOrderMatch(BaseModel):
    """Result of work order matching"""
    matched: bool
    work_order_id: Optional[UUID] = None
    work_order_number: Optional[str] = None
    confidence: float = 0.0  # 0.0 to 1.0
    match_type: Optional[str] = None  # exact, fuzzy, new


class PhotoProcessingResult(BaseModel):
    """Result of photo webhook processing"""
    success: bool
    photo_id: int
    work_order_match: WorkOrderMatch
    work_order_created: bool = False
    photo_downloaded: bool = False
    slack_notified: bool = False
    error_message: Optional[str] = None


# CompanyCam API Request Models

class CompanyCamPhotoDownload(BaseModel):
    """Request to download and attach photo to work order"""
    photo_id: int
    work_order_id: UUID
    use_original: bool = True  # Download original or optimized version


class CompanyCamSyncRequest(BaseModel):
    """Manual sync request for CompanyCam project"""
    project_id: int
    force_sync: bool = False  # Re-sync even if already synced


# Response Models

class CompanyCamPhotoResponse(BaseModel):
    """Response for CompanyCam photo in our system"""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    companycam_photo_id: str
    companycam_project_id: str
    companycam_project_name: Optional[str]
    work_order_id: Optional[UUID]
    photo_url: str
    thumbnail_url: Optional[str]
    description: Optional[str]
    project_address: Optional[str]
    is_synced: bool
    companycam_created_at: Optional[datetime]
    created_at: datetime


class CompanyCamStatsResponse(BaseModel):
    """Statistics for CompanyCam integration"""
    total_photos: int
    synced_photos: int
    unmatched_photos: int
    work_orders_created: int
    last_webhook_at: Optional[datetime]
