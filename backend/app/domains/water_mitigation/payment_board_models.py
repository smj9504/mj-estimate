"""
WM Payment Board public-link token.

One non-expiring token lets a manager open the payment board without
logging in and flip payment_received on a job - nothing else. Revoke by
setting is_active=False and issuing a new row (regenerate).
"""

import secrets

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType


def generate_board_token() -> str:
    """Generate a URL-safe token for WM payment board links"""
    return secrets.token_urlsafe(48)  # 64-char URL-safe string


class WMPaymentBoardToken(Base, BaseModel):
    """Non-expiring public link to the WM payment board. Revoked via is_active."""

    __tablename__ = "wm_payment_board_tokens"
    __table_args__ = (
        Index('ix_wm_payment_board_tokens_token', 'token', unique=True),
        Index('ix_wm_payment_board_tokens_active', 'is_active'),
        {'extend_existing': True}
    )

    token = Column(
        String(100), unique=True, nullable=False,
        default=generate_board_token, index=True
    )
    label = Column(String(200), comment="e.g. 'Manager - John'")
    is_active = Column(Boolean, default=True, nullable=False)

    # Usage tracking
    view_count = Column(Integer, default=0, nullable=False)
    confirm_count = Column(Integer, default=0, nullable=False)
    last_accessed_at = Column(DateTime(timezone=True))

    created_by_id = Column(UUIDType(), ForeignKey("staff.id"), nullable=False)
