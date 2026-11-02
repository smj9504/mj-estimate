"""
CompanyCam import into a claim's own photos

A claim's water mitigation job imports through the job's endpoints, into the
job's photos. This is for the claim's own (Completion) photos, the only ones a
cash job or a rebuild-only claim has. A claim keeps no project of its own, so
each import finds one by the client's address.

A photo's CompanyCam id stays in its file name. A photo already on the claim, in
its own photos or one of its jobs', isn't imported again, and neither is one
deleted from here: deleting it says it isn't wanted. Videos go the same way, under
an id of their own.
"""

import asyncio
import json
import logging
import re
import tempfile
import uuid
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from fastapi import BackgroundTasks, HTTPException

from app.common.services import video_tools
from app.core.cache import get_cache
from app.core.database_factory import get_database
from app.domains.file.models import File
from app.domains.file.video_service import OWNER_FILE, queue_processing, store_video
from app.domains.storage import StorageFactory

from .models import Claim, Client

logger = logging.getLogger(__name__)

# Downloaded at once before saving, as the job import does
BATCH_SIZE = 15
RUNNING_TTL = 3600
RESULT_TTL = 300

CLAIM_CONTEXT = 'claim'
# Where a new upload lands too, until someone sorts it
IMPORT_CATEGORY = 'general'
IMPORT_UPLOADED_BY = 'CompanyCam'
IMPORTED_NAME = re.compile(r'^companycam_(\d+)\.jpg$')
IMPORTED_VIDEO_NAME = re.compile(r'^(companycam_video_\d+)\.\w+$')


def _status_key(claim_id: str) -> str:
    return f"companycam_sync:claim:{claim_id}"


def _imported_name(photo_id: str) -> str:
    return f"companycam_{photo_id}.jpg"


def _require_claim(session, claim_id: str) -> Claim:
    try:
        uuid.UUID(str(claim_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="Claim not found")
    claim = session.query(Claim).filter(Claim.id == str(claim_id)).first()
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    return claim


def _project_number(project_id: Optional[str]) -> int:
    value = (project_id or '').strip()
    if not value.isdigit():
        raise HTTPException(status_code=400, detail="CompanyCam project ID must be a number")
    return int(value)


def _imported_ids(session, claim_id: str) -> Set[str]:
    """CompanyCam ids already on the claim, deleted and trashed ones included"""
    from app.domains.water_mitigation.models import WaterMitigationJob, WMPhoto

    names = session.query(File.original_name).filter(
        File.context == CLAIM_CONTEXT,
        File.context_id == str(claim_id),
    ).all()
    ids = {
        m.group(1)
        for name, in names
        for m in (IMPORTED_NAME.match(name or ''), IMPORTED_VIDEO_NAME.match(name or ''))
        if m
    }

    job_photos = session.query(WMPhoto.external_id).join(
        WaterMitigationJob, WMPhoto.job_id == WaterMitigationJob.id
    ).filter(
        WaterMitigationJob.claim_id == str(claim_id),
        WMPhoto.source == 'companycam',
        WMPhoto.external_id.isnot(None),
    ).all()
    ids.update(str(external_id) for external_id, in job_photos)
    return ids


def _captured_at(cc_photo: Dict[str, Any]) -> Optional[datetime]:
    """When it was taken, so the claim's photos date from then rather than the import"""
    raw = cc_photo.get('captured_at') or cc_photo.get('created_at')
    try:
        if isinstance(raw, (int, float)):
            return datetime.fromtimestamp(raw, tz=timezone.utc)
        if isinstance(raw, str):
            return datetime.fromisoformat(raw.replace('Z', '+00:00'))
    except (ValueError, TypeError, OSError):
        pass
    return None


async def _read_status(cache, key: str) -> Optional[Dict[str, Any]]:
    raw = await cache.get(key)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError) as e:
        logger.warning(f"Failed to parse claim import status: {e}")
        return None


# ── What the claim page asks for ──────────────

async def search_projects(claim_id: str, query: Optional[str] = None) -> Dict[str, Any]:
    """CompanyCam projects matching the claim's client's address, best match first"""
    from app.domains.integrations.companycam.project_search import search_projects_by_address

    session = get_database().get_session()
    try:
        claim = _require_claim(session, claim_id)
        client = session.query(Client).filter(Client.id == claim.client_id).first()
        street = (client.address if client else '') or ''
        city = (client.city if client else '') or ''
        state = (client.state if client else '') or ''
        zipcode = (client.zipcode if client else '') or ''
    finally:
        session.close()

    try:
        return await search_projects_by_address(street, city, state, zipcode, query)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


async def photo_dates(claim_id: str, project_id: Optional[str]) -> Dict[str, Any]:
    """The project's photos grouped by capture date, no images downloaded"""
    from app.domains.integrations.companycam.client import CompanyCamClient
    from app.domains.integrations.companycam.utils import summarize_photo_dates

    project = _project_number(project_id)
    session = get_database().get_session()
    try:
        _require_claim(session, claim_id)
        imported = _imported_ids(session, claim_id)
    finally:
        session.close()

    async with CompanyCamClient() as client:
        photos = await client.get_project_photos(project)
        videos = await client.get_project_videos_as_media(project)

    return {
        'success': True,
        'project_id': str(project),
        **summarize_photo_dates(photos + videos, imported),
    }


async def start_import(
    claim_id: str,
    project_id: Optional[str],
    selected_dates: Optional[str],
    background_tasks: BackgroundTasks,
) -> Dict[str, Any]:
    """Start importing in the background; the page polls import_status"""
    project = _project_number(project_id)
    session = get_database().get_session()
    try:
        _require_claim(session, claim_id)
    finally:
        session.close()

    cache = get_cache()
    key = _status_key(claim_id)
    current = await _read_status(cache, key)
    if current and current.get('status') == 'running':
        return {'success': False, 'message': 'Sync already in progress', 'status': 'running'}

    await cache.set(key, json.dumps({
        'status': 'running',
        'synced_count': 0,
        'skipped_existing': 0,
        'skipped_trashed': 0,
        'skipped_date_filtered': 0,
        'total_companycam': 0,
        'current_page': 0,
        'errors': [],
        'message': 'Starting sync...',
    }), ttl=RUNNING_TTL)

    dates = [d.strip() for d in selected_dates.split(',') if d.strip()] if selected_dates else None
    background_tasks.add_task(run_import_in_background, str(claim_id), project, dates)
    return {'success': True, 'message': 'Sync started in background', 'status': 'running'}


async def import_status(claim_id: str) -> Dict[str, Any]:
    status = await _read_status(get_cache(), _status_key(claim_id))
    return status or {'status': 'idle', 'message': 'No sync in progress'}


async def cancel_import(claim_id: str) -> Dict[str, Any]:
    cache = get_cache()
    key = _status_key(claim_id)
    status = await _read_status(cache, key)
    if not status or status.get('status') != 'running':
        return {'success': False, 'message': 'No sync in progress to cancel'}

    status['status'] = 'cancelled'
    status['message'] = f"Sync cancelled. Imported {status.get('synced_count', 0)} photos and videos before cancellation."
    await cache.set(key, json.dumps(status), ttl=RUNNING_TTL)
    return {'success': True, 'message': 'Cancellation requested. Sync will stop after the current photos.'}


# ── The import itself ─────────────────────────

def run_import_in_background(claim_id: str, project: int, selected_dates: Optional[List[str]]) -> None:
    asyncio.run(run_import(claim_id, project, selected_dates))


async def _download(client, cc_photo: Dict[str, Any]) -> bytes:
    from app.domains.integrations.companycam.utils import photo_download_url

    url = photo_download_url(cc_photo)
    if not url:
        raise ValueError(f"No URL for {cc_photo.get('id')}")
    return await client.download_photo(url)


async def _store(session, storage, claim_id: str, cc_photo: Dict[str, Any], photo_bytes: bytes) -> None:
    name = _imported_name(str(cc_photo.get('id')))
    # Blocking network I/O - keep it off the event loop
    result = await asyncio.to_thread(
        storage.upload,
        file_data=BytesIO(photo_bytes),
        filename=name,
        context=CLAIM_CONTEXT,
        context_id=claim_id,
        category=IMPORT_CATEGORY,
        content_type='image/jpeg',
        metadata={},
    )
    session.add(File(
        filename=result.file_id,
        original_name=name,
        content_type='image/jpeg',
        size=len(photo_bytes),
        url=result.file_url,
        thumbnail_url=result.thumbnail_url,
        storage_provider=storage.provider_name,
        context=CLAIM_CONTEXT,
        context_id=claim_id,
        category=IMPORT_CATEGORY,
        description=cc_photo.get('description'),
        uploaded_by=IMPORT_UPLOADED_BY,
        upload_date=_captured_at(cc_photo) or datetime.now(timezone.utc),
    ))


async def _store_video(session, storage, claim_id: str, cc_video: Dict[str, Any]) -> File:
    """Through a file on disk and on to storage in chunks: these can be hundreds of MB"""
    from app.domains.integrations.companycam.utils import video_file_details

    _, name, content_type, url = video_file_details(cc_video)

    def fetch_and_store():
        with tempfile.TemporaryDirectory(prefix='cc-video-') as folder:
            local = Path(folder) / name
            video_tools.download_to_file(url, local)
            with open(local, 'rb') as data:
                return store_video(data, name, content_type, CLAIM_CONTEXT, claim_id, IMPORT_CATEGORY, storage)

    result, size = await asyncio.to_thread(fetch_and_store)
    thumbnails = cc_video.get('thumbnail_urls') or {}
    record = File(
        filename=result.file_id,
        original_name=name,
        content_type=content_type,
        size=size,
        url=result.file_url,
        thumbnail_url=thumbnails.get('medium') or thumbnails.get('small'),
        storage_provider=storage.provider_name,
        context=CLAIM_CONTEXT,
        context_id=claim_id,
        category=IMPORT_CATEGORY,
        uploaded_by=IMPORT_UPLOADED_BY,
        upload_date=_captured_at(cc_video) or datetime.now(timezone.utc),
    )
    session.add(record)
    return record


async def run_import(claim_id: str, project: int, selected_dates: Optional[List[str]] = None) -> None:
    from app.domains.integrations.companycam.client import CompanyCamClient
    from app.domains.integrations.companycam.utils import extract_captured_date

    cache = get_cache()
    key = _status_key(claim_id)
    wanted_dates = set(selected_dates) if selected_dates else None
    errors: List[str] = []
    progress: Dict[str, Any] = {
        'status': 'running',
        'synced_count': 0,
        'skipped_existing': 0,
        'skipped_trashed': 0,
        'skipped_date_filtered': 0,
        'total_companycam': 0,
        'current_page': 0,
        'errors': errors,
    }

    async def is_cancelled() -> bool:
        status = await _read_status(cache, key)
        return bool(status and status.get('status') == 'cancelled')

    cancelled = False
    session = get_database().get_session()
    try:
        imported = _imported_ids(session, claim_id)

        def still_wanted(item: Dict[str, Any]) -> bool:
            if str(item.get('id')) in imported:
                progress['skipped_existing'] += 1
                return False
            if wanted_dates is not None:
                item_date = extract_captured_date(item)
                if (item_date.isoformat() if item_date else 'unknown') not in wanted_dates:
                    progress['skipped_date_filtered'] += 1
                    return False
            return True

        async with CompanyCamClient() as client:
            photos = await client.get_project_photos(project)
            videos = await client.get_project_videos_as_media(project)
            progress['total_companycam'] = len(photos) + len(videos)

            to_import = [cc_photo for cc_photo in photos if still_wanted(cc_photo)]
            # CompanyCam still working on one: the next import picks it up
            videos_to_import = [
                cc_video for cc_video in videos
                if still_wanted(cc_video) and cc_video.get('status') == 'processed'
            ]

            storage = StorageFactory.get_instance()
            for start in range(0, len(to_import), BATCH_SIZE):
                if await is_cancelled():
                    cancelled = True
                    break

                batch = to_import[start:start + BATCH_SIZE]
                downloads = await asyncio.gather(
                    *[_download(client, cc_photo) for cc_photo in batch],
                    return_exceptions=True,
                )
                for cc_photo, download in zip(batch, downloads):
                    photo_id = cc_photo.get('id')
                    if isinstance(download, BaseException):
                        logger.error(f"Failed to download CompanyCam photo {photo_id}: {download}")
                        errors.append(f"Failed to download photo {photo_id}: {download}")
                        continue
                    try:
                        await _store(session, storage, claim_id, cc_photo, download)
                        progress['synced_count'] += 1
                    except Exception as e:
                        logger.error(f"Failed to save CompanyCam photo {photo_id}: {e}", exc_info=True)
                        errors.append(f"Failed to save photo {photo_id}: {e}")

                # Per batch, so a cancel or a crash keeps what's already in storage
                session.commit()

                if await is_cancelled():
                    cancelled = True
                    break
                await cache.set(key, json.dumps({**progress, 'errors': errors[:5]}), ttl=RUNNING_TTL)

            # One at a time and committed one at a time, since each takes a while
            for cc_video in videos_to_import:
                if cancelled or await is_cancelled():
                    cancelled = True
                    break
                video_id = cc_video.get('id')
                try:
                    record = await _store_video(session, storage, claim_id, cc_video)
                    session.commit()
                    queue_processing(OWNER_FILE, record.id)
                    progress['synced_count'] += 1
                except Exception as e:
                    session.rollback()
                    logger.error(f"Failed to import CompanyCam video {video_id}: {e}", exc_info=True)
                    errors.append(f"Failed to import video {video_id}: {e}")
                await cache.set(key, json.dumps({**progress, 'errors': errors[:5]}), ttl=RUNNING_TTL)

        synced = progress['synced_count']
        message = (
            f"Imported {synced} photos and videos. Skipped {progress['skipped_existing']} already on this claim."
        )
        if errors:
            message += f" {len(errors)} couldn't be imported."
        if cancelled:
            final = 'cancelled'
            message = f"Sync cancelled. {message}"
        elif errors and not synced:
            final = 'failed'
        else:
            final = 'completed'
    except Exception as e:
        logger.error(f"CompanyCam import failed for claim {claim_id}: {e}", exc_info=True)
        session.rollback()
        final = 'failed'
        message = f"CompanyCam import failed: {e}"
    finally:
        session.close()

    logger.info(f"CompanyCam import {final} for claim {claim_id}: {message}")
    await cache.set(key, json.dumps({
        **progress,
        'status': final,
        'errors': errors[:10],
        'message': message,
    }), ttl=RESULT_TTL)
