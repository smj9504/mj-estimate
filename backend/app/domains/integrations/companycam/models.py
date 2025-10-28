"""
Shared database models for integrations

These models are shared between integration-server and main backend
"""

from sqlalchemy import Column, String, Text, DateTime, Boolean, JSON, Index
from datetime import datetime
import uuid

from app.core.database import Base


def generate_uuid():
    """Generate UUID for primary keys"""
    return str(uuid.uuid4())


class WebhookEvent(Base):
    """
    Generic webhook event log for all external services
    """
    __tablename__ = "webhook_events"
    __table_args__ = (
        Index('ix_webhook_service_type', 'service_name', 'event_type'),
        Index('ix_webhook_created', 'created_at'),
        {'extend_existing': True}
    )

    id = Column(String(36), primary_key=True, default=generate_uuid, index=True)

    # Service identification
    service_name = Column(String(50), nullable=False)
    event_type = Column(String(100), nullable=False)
    event_id = Column(String(200), index=True)

    # Event data
    payload = Column(JSON, nullable=False)
    headers = Column(JSON)

    # Processing status
    status = Column(String(20), default="pending")
    error_message = Column(Text)
    processed_at = Column(DateTime)

    # Related entity
    related_entity_type = Column(String(50))
    related_entity_id = Column(String(36))

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

    id = Column(String(36), primary_key=True, default=generate_uuid, index=True)

    # CompanyCam references
    companycam_photo_id = Column(String(100), nullable=False, unique=True)
    companycam_project_id = Column(String(100), nullable=False, index=True)
    companycam_project_name = Column(String(500))

    # Water Mitigation Job relationship
    water_mitigation_job_id = Column(String(36), nullable=True, index=True)

    # Photo metadata
    photo_url = Column(String(1000), nullable=False)
    thumbnail_url = Column(String(1000))
    original_filename = Column(String(500))

    # Photo details
    description = Column(Text)
    tags = Column(JSON)
    coordinates = Column(JSON)

    # Photo properties
    width = Column(String(20))
    height = Column(String(20))
    file_size = Column(String(20))
    content_type = Column(String(100))

    # Address information
    project_address = Column(String(500))
    project_city = Column(String(100))
    project_state = Column(String(50))
    project_zipcode = Column(String(20))

    # Status
    is_synced = Column(Boolean, default=False)
    sync_error = Column(Text)

    # User who uploaded
    uploaded_by_name = Column(String(200))
    uploaded_by_email = Column(String(200))

    # Timestamps
    companycam_created_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    synced_at = Column(DateTime)

    def __repr__(self):
        return f"<CompanyCamPhoto(id={self.companycam_photo_id}, job={self.water_mitigation_job_id})>"
