"""
Integrations database models for webhook events and external service data
"""

from sqlalchemy import Column, String, Text, DateTime, Boolean, JSON, Index
from datetime import datetime

from app.core.database_factory import Base
from app.core.database_types import UUIDType, generate_uuid


class WebhookEvent(Base):
    """
    Generic webhook event log for all external services
    Stores audit trail of all incoming webhook events
    """
    __tablename__ = "webhook_events"
    __table_args__ = (
        Index('ix_webhook_service_type', 'service_name', 'event_type'),
        Index('ix_webhook_created', 'created_at'),
        {'extend_existing': True}
    )

    id = Column(UUIDType(), primary_key=True, default=generate_uuid, index=True)

    # Service identification
    service_name = Column(String(50), nullable=False)  # companycam, slack, google_sheets
    event_type = Column(String(100), nullable=False)   # photo.created, message.sent, etc.
    event_id = Column(String(200), index=True)         # External event ID if available

    # Event data
    payload = Column(JSON, nullable=False)             # Full webhook payload
    headers = Column(JSON)                             # Request headers

    # Processing status
    status = Column(String(20), default="pending")     # pending, processed, failed, ignored
    error_message = Column(Text)                       # Error details if failed
    processed_at = Column(DateTime)

    # Related entity (optional)
    related_entity_type = Column(String(50))           # work_order, water_mitigation, etc.
    related_entity_id = Column(UUIDType())             # UUID of related entity

    # Metadata
    ip_address = Column(String(50))
    user_agent = Column(String(500))

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f"<WebhookEvent(service={self.service_name}, type={self.event_type}, status={self.status})>"


class CompanyCamPhoto(Base):
    """
    CompanyCam photo metadata linked to water mitigation jobs
    """
    __tablename__ = "companycam_photos"
    __table_args__ = (
        Index('ix_companycam_photo_job', 'water_mitigation_job_id'),
        Index('ix_companycam_photo_external', 'companycam_photo_id'),
        {'extend_existing': True}
    )

    id = Column(UUIDType(), primary_key=True, default=generate_uuid, index=True)

    # CompanyCam references
    companycam_photo_id = Column(String(100), nullable=False, unique=True)
    companycam_project_id = Column(String(100), nullable=False, index=True)
    companycam_project_name = Column(String(500))

    # Water Mitigation Job relationship
    water_mitigation_job_id = Column(UUIDType(), nullable=True, index=True)  # Nullable for unmatched photos

    # Photo metadata
    photo_url = Column(String(1000), nullable=False)
    thumbnail_url = Column(String(1000))
    original_filename = Column(String(500))

    # Photo details
    description = Column(Text)
    tags = Column(JSON)                                # Array of tags
    coordinates = Column(JSON)                         # {lat, lon, accuracy}

    # Photo properties
    width = Column(String(20))
    height = Column(String(20))
    file_size = Column(String(20))
    content_type = Column(String(100))

    # Address information from CompanyCam project
    project_address = Column(String(500))
    project_city = Column(String(100))
    project_state = Column(String(50))
    project_zipcode = Column(String(20))

    # Status
    is_synced = Column(Boolean, default=False)         # Synced to water mitigation job photos
    sync_error = Column(Text)                          # Error if sync failed

    # User who uploaded (from CompanyCam)
    uploaded_by_name = Column(String(200))
    uploaded_by_email = Column(String(200))

    # Timestamps
    companycam_created_at = Column(DateTime)           # When photo was created in CompanyCam
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    synced_at = Column(DateTime)

    def __repr__(self):
        return f"<CompanyCamPhoto(id={self.companycam_photo_id}, job={self.water_mitigation_job_id})>"
