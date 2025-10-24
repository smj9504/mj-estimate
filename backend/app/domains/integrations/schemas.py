"""
Common schemas for integrations domain
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, Dict, Any, List
from datetime import datetime
from uuid import UUID


class WebhookEventBase(BaseModel):
    """Base schema for webhook events"""
    service_name: str
    event_type: str
    event_id: Optional[str] = None
    payload: Dict[str, Any]
    headers: Optional[Dict[str, str]] = None


class WebhookEventCreate(WebhookEventBase):
    """Schema for creating webhook event"""
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None


class WebhookEventResponse(WebhookEventBase):
    """Schema for webhook event response"""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    status: str
    error_message: Optional[str] = None
    processed_at: Optional[datetime] = None
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime


class WebhookEventUpdate(BaseModel):
    """Schema for updating webhook event"""
    status: Optional[str] = None
    error_message: Optional[str] = None
    processed_at: Optional[datetime] = None
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[UUID] = None


class IntegrationHealthCheck(BaseModel):
    """Health check response for integration services"""
    service_name: str
    is_configured: bool
    is_healthy: bool
    last_event: Optional[datetime] = None
    error_message: Optional[str] = None
    event_count_24h: int = 0


class IntegrationStats(BaseModel):
    """Statistics for integration service"""
    service_name: str
    total_events: int
    successful_events: int
    failed_events: int
    pending_events: int
    last_event_at: Optional[datetime] = None
