"""
Photo Analysis Database Models

Database models for caching photo analysis results.
"""

from sqlalchemy import Column, String, DateTime, JSON, Float, Index, Integer, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType


class PhotoAnalysisCache(Base, BaseModel):
    """Cache table for photo analysis results"""
    __tablename__ = "photo_analysis_cache"
    __table_args__ = (
        Index('ix_photo_analysis_cache_key', 'cache_key', unique=True),
        Index('ix_photo_analysis_cache_user_id', 'user_id'),
        Index('ix_photo_analysis_cache_expires_at', 'expires_at'),
        {'extend_existing': True}
    )

    cache_key = Column(String(255), unique=True, nullable=False)
    room_type = Column(String(50), nullable=False)
    photo_urls = Column(JSON, nullable=False)  # List of photo URLs
    analysis_result = Column(JSON, nullable=False)  # Full PhotoAnalysisResponse as JSON
    confidence_score = Column(Float, nullable=False)
    user_id = Column(UUIDType(), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)

    # Timestamps from BaseModel: created_at, updated_at

    def __repr__(self):
        return f"<PhotoAnalysisCache(cache_key={self.cache_key}, room_type={self.room_type})>"


class PhotoAnalysis(Base, BaseModel):
    """Main photo analysis record"""
    __tablename__ = "photo_analyses"
    __table_args__ = (
        Index('ix_photo_analyses_company_id', 'company_id'),
        Index('ix_photo_analyses_job_id', 'job_id'),
        {'extend_existing': True}
    )

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(UUIDType(), ForeignKey('companies.id'), nullable=False)
    job_id = Column(String(100), nullable=True)
    room_name = Column(String(100), nullable=True)
    photo_urls = Column(JSON, nullable=False)  # List of photo URLs
    analysis_type = Column(String(50), nullable=False)  # 'water_mitigation', 'packout', 'general'
    analysis_results = Column(JSON, nullable=False)  # Full analysis results
    confidence_score = Column(Float, nullable=False)
    user_id = Column(UUIDType(), nullable=True)

    # Relationships
    packout_analysis = relationship("PhotoAnalysisPackout", back_populates="photo_analysis", uselist=False)

    def __repr__(self):
        return f"<PhotoAnalysis(id={self.id}, job_id={self.job_id}, room_name={self.room_name})>"
