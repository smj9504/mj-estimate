"""
Material Detection Providers

Abstraction layer for different material detection APIs and models.
"""

from .base import MaterialDetectionProvider
from .roboflow import RoboflowProvider
from .google_vision import GoogleVisionProvider

__all__ = [
    "MaterialDetectionProvider",
    "RoboflowProvider",
    "GoogleVisionProvider"
]
