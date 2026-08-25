"""
Storage helper utilities for uploading generated files (PDFs, images) to cloud storage.

Provides a unified pattern for:
1. Upload bytes to the configured storage provider (GCS/local/etc.)
2. Return storage metadata (file_path, storage_provider, storage_file_id)

This replaces the old pattern of writing to local filesystem paths
which breaks on ephemeral hosting (e.g., Render).
"""

import logging
import os
from io import BytesIO
from typing import Any, Dict, Optional

from app.domains.storage.factory import StorageFactory

logger = logging.getLogger(__name__)


def upload_bytes_to_storage(
    file_bytes: bytes,
    filename: str,
    context: str,
    context_id: str,
    category: str = "documents",
    content_type: str = "application/pdf",
) -> Dict[str, Any]:
    """Upload raw bytes to the configured storage provider.

    Args:
        file_bytes: Raw file content
        filename: Display filename (e.g., "Photo Report - 123 Main St.pdf")
        context: Storage context (e.g., "water-mitigation", "contracts", "rebuild")
        context_id: Entity ID (e.g., job_id, template_id)
        category: Sub-category (e.g., "documents", "reports", "filled")
        content_type: MIME type

    Returns:
        Dict with keys:
            file_path: prefix-less blob path (e.g. "water-mitigation/job/reports/x.pdf") -
                       kept for callers that already store storage_provider separately
                       and resolve it via that column.
            file_url: same path WITH the provider prefix (e.g. "b2://bucket/water-mitigation/...")
                      or a plain "gs://"/"b2://"-free local path when STORAGE_PROVIDER=local.
                      Callers that only have a single free-text URL/path column (no dedicated
                      storage_provider column) MUST store this instead of file_path, since
                      downstream preview/download code detects cloud storage by checking for
                      this prefix.
            storage_provider, storage_file_id, file_size
    """
    storage = StorageFactory.get_instance()
    storage_provider_type = os.getenv("STORAGE_PROVIDER", "local").lower()

    file_stream = BytesIO(file_bytes)
    upload_result = storage.upload(
        file_data=file_stream,
        filename=filename,
        context=context,
        context_id=context_id,
        category=category,
        content_type=content_type,
    )

    logger.info(
        f"Uploaded {filename} to {storage_provider_type}: "
        f"{upload_result.file_path} (id={upload_result.file_id})"
    )

    return {
        "file_path": upload_result.file_path,
        "file_url": upload_result.file_url,
        "storage_provider": storage_provider_type,
        "storage_file_id": upload_result.file_id,
        "file_size": len(file_bytes),
    }
