"""
System-wide settings storage (simple key-value table).

Distinct from per-domain config (e.g. company/email account settings) -
this holds global toggles an admin can flip at runtime without a
deployment, such as ROUTE_PERSONAL_ACCOUNTS_THROUGH_FALLBACK.
"""

from sqlalchemy import Column, String, Text, DateTime
from sqlalchemy.sql import func

from app.core.database_factory import Base


class SystemSetting(Base):
    """Single key-value row per global setting. Key is the primary key -
    there's exactly one row per setting, not a history of versions."""
    __tablename__ = "system_settings"
    __table_args__ = ({"extend_existing": True},)

    key = Column(String(100), primary_key=True)
    value = Column(Text, nullable=False)
    updated_at = Column(
        DateTime(timezone=True), onupdate=func.now(), server_default=func.now()
    )
