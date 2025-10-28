"""
Password reset token models
"""
from sqlalchemy import Column, String, DateTime
from datetime import datetime

from app.core.database_factory import Base
from app.core.database_types import UUIDType, generate_uuid


class PasswordResetToken(Base):
    """Password reset token model"""
    __tablename__ = "password_reset_tokens"
    __table_args__ = {'extend_existing': True}

    id = Column(UUIDType(), primary_key=True, default=generate_uuid, index=True)

    # Token Information
    email = Column(String(200), nullable=False, index=True)
    token = Column(String(255), unique=True, nullable=False, index=True)

    # Timing
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    used_at = Column(DateTime)

    # Status
    is_used = Column(String(10), default="false")  # Store as string for SQLite compatibility

    def __str__(self):
        return f"Password Reset Token for {self.email}"

    def __repr__(self):
        return f"<PasswordResetToken(email={self.email}, expires_at={self.expires_at})>"
