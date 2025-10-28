"""
Google Sheets integration module

This module handles:
- Reading data from Google Sheets
- Syncing Google Sheets data with Water Mitigation jobs
- Webhook handling for real-time updates
"""

from .api import router
from .client import GoogleSheetsClient, WM_HEADER_MAPPING
from .sync_service import GoogleSheetsSyncService
from .utils import addresses_match, normalize_address

__all__ = [
    "router",
    "GoogleSheetsClient",
    "GoogleSheetsSyncService",
    "WM_HEADER_MAPPING",
    "addresses_match",
    "normalize_address"
]
