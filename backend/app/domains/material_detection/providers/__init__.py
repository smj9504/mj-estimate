"""
Material Detection Providers

Abstraction layer for different material detection APIs and models.
"""

from .base import MaterialDetectionProvider
from .roboflow import RoboflowProvider
from .google_vision import GoogleVisionProvider
from .custom_vit import CustomViTProvider
from .ensemble import EnsembleProvider

__all__ = [
    "MaterialDetectionProvider",
    "RoboflowProvider",
    "GoogleVisionProvider",
    "CustomViTProvider",
    "EnsembleProvider"
]
