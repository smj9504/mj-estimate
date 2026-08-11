"""
AccuLynx sync service.

Collects files for a claim from the two supported sources (see
`__init__.py` for why only these two), fetches their bytes, uploads
each to the linked AccuLynx job, and records an audit row per file so
repeated sync calls only send new/failed files.

This module reads from `app.domains.file` and
`app.domains.water_mitigation` models but never writes to them - the
dependency is one-directional so this module can be deleted without
touching those domains.
"""

import asyncio
import logging
from pathlib import Path
from typing import List, Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.domains.file.models import File as GenericFile
from app.domains.water_mitigation.models import WaterMitigationJob, WMPhoto, WMDocument

from .client import AccuLynxClient, AccuLynxRateLimitError
from .models import AccuLynxJobLink, AccuLynxUpload
from .schemas import AccuLynxSyncFileResult, AccuLynxSyncResult

logger = logging.getLogger(__name__)

# Stay comfortably under AccuLynx's 10 req/sec per-key limit for sequential batch uploads.
_UPLOAD_INTERVAL_SECONDS = 0.15


class AccuLynxSyncError(Exception):
    """Raised when a claim isn't linked to an AccuLynx job yet, etc."""
    pass


def _get_generic_file_bytes(file_record: GenericFile) -> bytes:
    """
    Fetch bytes for a generic `files` table row.

    Mirrors the logic in app/domains/file/api.py's download_file endpoint:
    gs:// / http(s):// URLs go through the configured storage provider,
    anything else is treated as a local filesystem path.
    """
    from app.domains.file.service import get_storage_provider

    url = file_record.url or ""
    if url.startswith("gs://") or url.startswith("http://") or url.startswith("https://"):
        storage = get_storage_provider()
        return storage.download(url)

    path = Path(url)
    if not path.exists():
        raise FileNotFoundError(f"Local file not found: {url}")
    return path.read_bytes()


def _resolve_document_folder_id(source_table: str, document_type: Optional[str]) -> Optional[str]:
    """
    Pick which AccuLynx document folder a non-photo file goes into.

    AccuLynx folders are a fixed, company-wide taxonomy (see
    client.list_document_folders()) - there's no folder per claim/lead.
    We only have a rough type signal to work with (WMDocument.document_type
    is 'COS'|'EWA'|'Invoice'|'Sketch'|'Photo'|'Other'; generic claim files
    have no type at all), so the mapping is intentionally coarse:

    - WMDocument with document_type == 'Invoice' -> the Invoice folder
    - any other WMDocument (COS/EWA/Sketch/Photo/Other, incl. contracts and
      xactimate estimates, which don't have a dedicated AccuLynx folder) ->
      the Water Mitigation folder
    - generic claim files (context='claim', no domain-specific type) -> the
      default/fallback folder (AccuLynx's own catch-all is named "Other")

    Any per-type override left unset in settings falls back to
    ACCULYNX_DOCUMENT_FOLDER_ID.
    """
    if source_table == "wm_document" and document_type == "Invoice":
        return settings.ACCULYNX_DOCUMENT_FOLDER_ID_INVOICE or settings.ACCULYNX_DOCUMENT_FOLDER_ID
    if source_table == "wm_document":
        return settings.ACCULYNX_DOCUMENT_FOLDER_ID_WATER_MITIGATION or settings.ACCULYNX_DOCUMENT_FOLDER_ID
    return settings.ACCULYNX_DOCUMENT_FOLDER_ID


def _get_wm_file_bytes(storage_provider: Optional[str], storage_file_id: Optional[str], file_path: Optional[str]) -> bytes:
    """
    Fetch bytes for a WMPhoto/WMDocument row.

    Mirrors app/domains/water_mitigation/api.py's photo/document download
    endpoints: 'local' provider reads straight from disk, anything else
    goes through StorageFactory.
    """
    provider = storage_provider or "local"

    if provider == "local":
        if not file_path:
            raise FileNotFoundError("No file_path set for local-storage WM file")
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"Local file not found: {file_path}")
        return path.read_bytes()

    from app.domains.storage.factory import StorageFactory
    storage = StorageFactory.get_instance(provider)
    return storage.download(storage_file_id or file_path)


class AccuLynxSyncService:
    def __init__(self, db: Session):
        self.db = db

    def get_link(self, claim_id: str) -> Optional[AccuLynxJobLink]:
        return self.db.query(AccuLynxJobLink).filter(
            AccuLynxJobLink.claim_id == claim_id
        ).first()

    def _already_synced_source_ids(self, claim_id: str) -> set:
        rows = self.db.query(AccuLynxUpload.source_id).filter(
            AccuLynxUpload.claim_id == claim_id,
            AccuLynxUpload.status == "success"
        ).all()
        return {str(r[0]) for r in rows}

    def _record_result(
        self,
        claim_id: str,
        acculynx_job_id: str,
        source_table: str,
        source_id: str,
        filename: Optional[str],
        status: str,
        error_message: Optional[str] = None
    ) -> None:
        from datetime import datetime

        existing = self.db.query(AccuLynxUpload).filter(
            AccuLynxUpload.source_id == source_id
        ).first()

        if existing:
            existing.status = status
            existing.error_message = error_message
            existing.filename = filename
            if status == "success":
                existing.uploaded_at = datetime.utcnow()
        else:
            existing = AccuLynxUpload(
                claim_id=claim_id,
                acculynx_job_id=acculynx_job_id,
                source_table=source_table,
                source_id=source_id,
                filename=filename,
                status=status,
                error_message=error_message,
                uploaded_at=datetime.utcnow() if status == "success" else None
            )
            self.db.add(existing)

        self.db.commit()

    async def sync_claim_files(self, claim_id: str) -> AccuLynxSyncResult:
        link = self.get_link(claim_id)
        if not link:
            raise AccuLynxSyncError(f"Claim {claim_id} is not linked to an AccuLynx job")

        already_synced = self._already_synced_source_ids(claim_id)

        # ---- Collect candidates ----
        # 1. Generic claim files (photos + documents uploaded via the common FileGallery)
        generic_files = self.db.query(GenericFile).filter(
            GenericFile.context == "claim",
            GenericFile.context_id == str(claim_id),
            GenericFile.is_active == True  # noqa: E712
        ).all()

        # 2. Water mitigation dedicated tables (richer storage, includes contracts/xactimate docs)
        wm_job = self.db.query(WaterMitigationJob).filter(
            WaterMitigationJob.claim_id == claim_id
        ).first()

        wm_photos: List[WMPhoto] = []
        wm_documents: List[WMDocument] = []
        if wm_job:
            wm_photos = self.db.query(WMPhoto).filter(
                WMPhoto.job_id == wm_job.id,
                WMPhoto.is_trashed == False  # noqa: E712
            ).all()
            wm_documents = self.db.query(WMDocument).filter(
                WMDocument.job_id == wm_job.id,
                WMDocument.is_active == True  # noqa: E712
            ).all()

        results: List[AccuLynxSyncFileResult] = []
        succeeded = 0
        failed = 0
        already_synced_count = 0

        client = AccuLynxClient()

        async def upload_one(source_table: str, source_id: str, filename: str, content_type: str,
                              is_photo: bool, fetch_bytes, document_type: Optional[str] = None):
            nonlocal succeeded, failed
            folder_id = None if is_photo else _resolve_document_folder_id(source_table, document_type)
            try:
                file_bytes = fetch_bytes()
                if is_photo:
                    await client.upload_photo(link.acculynx_job_id, file_bytes, filename, content_type)
                else:
                    if not folder_id:
                        raise AccuLynxSyncError(
                            "No AccuLynx document folder configured (ACCULYNX_DOCUMENT_FOLDER_ID / "
                            "ACCULYNX_DOCUMENT_FOLDER_ID_INVOICE / ACCULYNX_DOCUMENT_FOLDER_ID_WATER_MITIGATION)"
                        )
                    await client.upload_document(
                        link.acculynx_job_id, file_bytes, filename, content_type, folder_id
                    )
                self._record_result(claim_id, link.acculynx_job_id, source_table, source_id, filename, "success")
                results.append(AccuLynxSyncFileResult(
                    source_table=source_table, source_id=source_id, filename=filename, status="success"
                ))
                succeeded += 1
            except AccuLynxRateLimitError as e:
                await asyncio.sleep(e.retry_after_seconds)
                # single retry after backing off
                try:
                    file_bytes = fetch_bytes()
                    if is_photo:
                        await client.upload_photo(link.acculynx_job_id, file_bytes, filename, content_type)
                    else:
                        await client.upload_document(
                            link.acculynx_job_id, file_bytes, filename, content_type, folder_id
                        )
                    self._record_result(claim_id, link.acculynx_job_id, source_table, source_id, filename, "success")
                    results.append(AccuLynxSyncFileResult(
                        source_table=source_table, source_id=source_id, filename=filename, status="success"
                    ))
                    succeeded += 1
                except Exception as e2:
                    logger.error(f"AccuLynx upload retry failed for {source_table}:{source_id}: {e2}")
                    self._record_result(claim_id, link.acculynx_job_id, source_table, source_id, filename, "failed", str(e2))
                    results.append(AccuLynxSyncFileResult(
                        source_table=source_table, source_id=source_id, filename=filename,
                        status="failed", error_message=str(e2)
                    ))
                    failed += 1
            except Exception as e:
                logger.error(f"AccuLynx upload failed for {source_table}:{source_id}: {e}")
                self._record_result(claim_id, link.acculynx_job_id, source_table, source_id, filename, "failed", str(e))
                results.append(AccuLynxSyncFileResult(
                    source_table=source_table, source_id=source_id, filename=filename,
                    status="failed", error_message=str(e)
                ))
                failed += 1

        total_candidates = 0

        for f in generic_files:
            total_candidates += 1
            if str(f.id) in already_synced:
                already_synced_count += 1
                continue
            is_photo = (f.content_type or "").startswith(("image/", "video/"))
            await upload_one(
                "file", str(f.id), f.original_name, f.content_type or "application/octet-stream",
                is_photo, lambda f=f: _get_generic_file_bytes(f)
            )
            await asyncio.sleep(_UPLOAD_INTERVAL_SECONDS)

        for p in wm_photos:
            total_candidates += 1
            if str(p.id) in already_synced:
                already_synced_count += 1
                continue
            await upload_one(
                "wm_photo", str(p.id), p.file_name, p.mime_type or "image/jpeg",
                True, lambda p=p: _get_wm_file_bytes(p.storage_provider, p.storage_file_id, p.file_path)
            )
            await asyncio.sleep(_UPLOAD_INTERVAL_SECONDS)

        for d in wm_documents:
            total_candidates += 1
            if str(d.id) in already_synced:
                already_synced_count += 1
                continue
            await upload_one(
                "wm_document", str(d.id), d.filename, d.mime_type or "application/pdf",
                False, lambda d=d: _get_wm_file_bytes(d.storage_provider, d.storage_file_id, d.file_path),
                document_type=d.document_type
            )
            await asyncio.sleep(_UPLOAD_INTERVAL_SECONDS)

        return AccuLynxSyncResult(
            claim_id=str(claim_id),
            acculynx_job_id=link.acculynx_job_id,
            total_candidates=total_candidates,
            already_synced=already_synced_count,
            succeeded=succeeded,
            failed=failed,
            results=results
        )
