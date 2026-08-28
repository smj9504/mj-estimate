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


# ---------------------------------------------------------------------------
# Reading files back out of storage
# ---------------------------------------------------------------------------

# Provider prefixes that appear in stored `url` / `file_path` columns.
_CLOUD_PREFIXES = ("gs://", "b2://", "s3://")

# Which provider a bare prefix implies, for legacy rows written before the
# storage_provider column existed.
_PREFIX_PROVIDERS = {"gs://": "gcs", "b2://": "b2", "s3://": "s3"}


def strip_storage_prefix(file_ref: str) -> str:
    """Reduce a stored reference to the bare object key.

    "gs://mj-estimate-storage/company/x/w9/W9.pdf" -> "company/x/w9/W9.pdf"

    Object keys are preserved across a bucket-to-bucket migration, so the bare
    key is what lets a row written by one provider resolve against another.
    """
    for prefix in _CLOUD_PREFIXES:
        if file_ref.startswith(prefix):
            parts = file_ref[len(prefix):].split("/", 1)
            return parts[1] if len(parts) == 2 else parts[0]
    return file_ref


def is_cloud_ref(file_ref: str) -> bool:
    """True if the reference points at cloud storage rather than local disk."""
    return bool(file_ref) and file_ref.startswith(
        _CLOUD_PREFIXES + ("http://", "https://")
    )


def download_from_storage(
    file_ref: str,
    storage_provider: Optional[str] = None,
) -> bytes:
    """Download a stored file, tolerating a storage-provider migration.

    Rows written under an older provider keep that provider's URL forever
    (e.g. a "gs://" W-9 uploaded before the move to B2), so handing the raw
    URL to today's provider fails: "gs://bucket/key" is not a valid B2 key.

    Resolution order:
      1. the record's own provider (explicit column, else inferred from the
         URL prefix) with the URL as stored - correct while the old provider
         is still configured;
      2. the currently-configured provider with the bare object key - correct
         once the objects have been copied into the new bucket, which keeps
         their keys.

    Raises:
        FileNotFoundError: if no attempt produced the file.
    """
    if not file_ref:
        raise FileNotFoundError("No file reference to download")

    default_provider = os.getenv("STORAGE_PROVIDER", "local").lower()
    record_provider = (storage_provider or "").lower()
    if not record_provider:
        for prefix, provider in _PREFIX_PROVIDERS.items():
            if file_ref.startswith(prefix):
                record_provider = provider
                break

    bare_key = strip_storage_prefix(file_ref)

    attempts = []
    if record_provider and record_provider != "local":
        attempts.append((record_provider, file_ref))
    if default_provider != "local":
        attempts.append((default_provider, bare_key))

    errors = []
    tried = set()
    for provider_type, key in attempts:
        if (provider_type, key) in tried:
            continue
        tried.add((provider_type, key))
        try:
            if provider_type == default_provider:
                # Reuse the cached singleton for the common case.
                storage = StorageFactory.get_instance()
            else:
                # Build a throwaway instance so a one-off cross-provider read
                # doesn't swap out the cached default for everyone else.
                storage = StorageFactory.create(provider_type)
            return storage.download(key)
        except Exception as e:
            errors.append(f"{provider_type}:{key} ({e})")
            logger.warning(f"Storage download attempt failed - {provider_type}: {key} ({e})")

    raise FileNotFoundError(
        f"Could not download {file_ref} from storage. Tried: {'; '.join(errors) or 'nothing'}"
    )
