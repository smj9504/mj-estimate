"""
Water Mitigation domain for Enter Construction
"""

# Import models to ensure they are registered with SQLAlchemy
from .models import (
    WaterMitigationJob,
    PhotoCategory,
    WMPhoto,
    WMPhotoCategory,
    WMJobStatusHistory,
    WMSyncLog
)

__all__ = [
    'WaterMitigationJob',
    'PhotoCategory',
    'WMPhoto',
    'WMPhotoCategory',
    'WMJobStatusHistory',
    'WMSyncLog'
]
