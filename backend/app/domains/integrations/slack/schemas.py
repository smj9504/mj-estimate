"""
Slack notification schemas
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from enum import Enum


class SlackMessageType(str, Enum):
    """Types of Slack messages"""
    WORK_ORDER_CREATED = "work_order_created"
    PHOTO_UPLOADED = "photo_uploaded"
    WORK_ORDER_UPDATED = "work_order_updated"
    SYSTEM_ALERT = "system_alert"


class SlackNotificationRequest(BaseModel):
    """Request to send Slack notification"""
    message_type: SlackMessageType
    title: str
    message: str
    fields: Optional[Dict[str, str]] = {}
    image_url: Optional[str] = None
    link_url: Optional[str] = None
    link_text: Optional[str] = "View Details"
    color: Optional[str] = "#36a64f"  # Green by default


class SlackBlockField(BaseModel):
    """Slack block field"""
    type: str = "mrkdwn"
    text: str


class SlackBlock(BaseModel):
    """Slack message block"""
    type: str
    text: Optional[Dict[str, Any]] = None
    fields: Optional[List[SlackBlockField]] = None
    image_url: Optional[str] = None
    alt_text: Optional[str] = None
    elements: Optional[List[Dict[str, Any]]] = None


class SlackMessage(BaseModel):
    """Complete Slack message payload"""
    text: Optional[str] = None  # Fallback text
    blocks: List[SlackBlock] = []
    attachments: Optional[List[Dict[str, Any]]] = None
