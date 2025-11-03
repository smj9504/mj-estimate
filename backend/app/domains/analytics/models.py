"""
Analytics domain models
"""

from sqlalchemy import Column, String, DateTime, Float, Integer, Index
from sqlalchemy.dialects.postgresql import JSONB
from app.core.database_factory import Base
from app.core.database_types import UUIDType
from app.core.base_models import BaseModel
from sqlalchemy.sql import func


class ApiUsageLog(Base, BaseModel):
    """
    Records external API usage (e.g., OpenAI) for cost and volume analytics
    """
    __tablename__ = "api_usage_logs"
    __table_args__ = (
        Index('ix_api_usage_created_at', 'created_at'),
        Index('ix_api_usage_service', 'service_name'),
        Index('ix_api_usage_provider', 'provider'),
        {'extend_existing': True}
    )

    provider = Column(String(50), nullable=False)  # e.g., 'openai'
    service_name = Column(String(100), nullable=False)  # e.g., 'material_detection_auto_label'
    model = Column(String(100), nullable=True)  # e.g., 'gpt-4o'
    usage_type = Column(String(50), nullable=True)  # 'image' | 'chat'

    # Counts and tokens
    input_count = Column(Integer, nullable=True)  # images or requests
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    total_tokens = Column(Integer, nullable=True)

    # Cost
    cost_usd = Column(Float, nullable=True)

    # Link to user if known
    user_id = Column(UUIDType(), nullable=True)

    # Extra metadata (dataset id, job id, etc.)
    meta = Column('metadata', JSONB)

    # Timestamps
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


