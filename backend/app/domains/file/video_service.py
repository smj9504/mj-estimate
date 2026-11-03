"""
Videos stored on jobs and claims: making them watchable and serving them.

A job's videos sit in wm_photos and a claim's in files, beside their photos. The
original goes to storage straight away and is never touched. A worker then makes a
poster and, when the browsers can't all play the original, an H.264 copy, one video
at a time because the server is small. Until that copy exists the original is served,
which most browsers can play anyway.

A video that was never processed, or whose processing a restart cut short, gets queued
again the next time someone looks at it, so nothing has to run at startup.
"""

import logging
import queue
import shutil
import tempfile
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, BinaryIO, Dict, Iterator, List, Optional, Tuple

from fastapi import HTTPException, Request
from fastapi.responses import RedirectResponse, Response, StreamingResponse

from app.common.services import video_tools
from app.common.services.media_types import browser_video_type, is_video
from app.core.config import settings
from app.core.database_factory import get_database
from app.domains.storage.factory import StorageFactory

from .models import File, VideoRendition

logger = logging.getLogger(__name__)

OWNER_WM_PHOTO = 'wm_photo'
OWNER_FILE = 'file'

# Largest video accepted by hand. The body spools to disk and goes on to storage in
# chunks, so this is about patience and disk rather than memory.
MAX_VIDEO_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024

RENDITION_CATEGORY = 'video-renditions'
READ_CHUNK = 1024 * 1024

# How long to leave a video someone else may still be working on, and how often a
# failed one gets another go
STALE_PROCESSING = timedelta(minutes=45)
RETRY_FAILED_AFTER = timedelta(minutes=15)
MAX_ATTEMPTS = 3

PLACEHOLDER_POSTER = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">'
    '<rect width="400" height="300" fill="#37352f"/>'
    '<circle cx="200" cy="150" r="42" fill="#ffffff" fill-opacity="0.16"/>'
    '<path d="M186 128v44l36-22z" fill="#ffffff"/></svg>'
).encode()


@dataclass
class VideoSource:
    owner_type: str
    owner_id: str
    provider: str
    file_id: str
    filename: str
    content_type: str
    size: Optional[int]
    context: str
    context_id: str
    # Set when the provider gave us one (CompanyCam), so none is made
    poster_url: Optional[str] = None


def _wm_source(photo: Any) -> VideoSource:
    thumbnail = photo.storage_thumbnail_url or ''
    return VideoSource(
        owner_type=OWNER_WM_PHOTO,
        owner_id=str(photo.id),
        provider=photo.storage_provider or 'local',
        file_id=photo.storage_file_id or photo.file_path,
        filename=photo.file_name,
        content_type=photo.mime_type or 'video/mp4',
        size=photo.file_size,
        context='water-mitigation',
        context_id=str(photo.job_id),
        poster_url=thumbnail if thumbnail.startswith('http') else None,
    )


def _file_source(record: Any) -> VideoSource:
    thumbnail = record.thumbnail_url or ''
    return VideoSource(
        owner_type=OWNER_FILE,
        owner_id=str(record.id),
        provider=record.storage_provider or settings.STORAGE_PROVIDER.lower(),
        file_id=record.url,
        filename=record.original_name,
        content_type=record.content_type or 'video/mp4',
        size=record.size,
        context=record.context,
        context_id=str(record.context_id),
        poster_url=thumbnail if thumbnail.startswith('http') else None,
    )


def load_source(session: Any, owner_type: str, owner_id: str) -> Optional[VideoSource]:
    if owner_type == OWNER_WM_PHOTO:
        from app.domains.water_mitigation.models import WMPhoto

        photo = session.query(WMPhoto).filter(WMPhoto.id == str(owner_id)).first()
        return _wm_source(photo) if photo and is_video(photo.mime_type) else None
    record = session.query(File).filter(File.id == str(owner_id)).first()
    return _file_source(record) if record and is_video(record.content_type) else None


def read_source(owner_type: str, owner_id: str) -> Tuple[Optional[VideoSource], Optional[Dict[str, Any]]]:
    """The video and how its processing stands, off a session that's gone again at
    once: serving a video can take minutes and a pool connection is too dear for that.
    Call this on a worker thread."""
    session = get_database().get_session()
    try:
        source = load_source(session, owner_type, owner_id)
        if not source:
            return None, None
        return source, _rendition_dict(_find_rendition(session, owner_type, owner_id))
    finally:
        session.close()


# ── Storing ───────────────────────────────────

def store_video(
    file_data: BinaryIO,
    filename: str,
    content_type: str,
    context: str,
    context_id: str,
    category: str,
    storage: Any = None,
) -> Tuple[Any, int]:
    """Send a video to storage as it is, without reading it into memory; returns
    (upload result, size). Blocks: call it on a worker thread."""
    storage = storage or StorageFactory.get_instance()
    file_data.seek(0, 2)
    size = file_data.tell()
    file_data.seek(0)
    result = storage.upload(
        file_data=file_data,
        filename=filename,
        context=context,
        context_id=context_id,
        category=category,
        content_type=browser_video_type(content_type),
        optimize=False,
    )
    return result, size


# ── The worker ────────────────────────────────

_queue: 'queue.Queue[Tuple[str, str]]' = queue.Queue()
_queued: set = set()
_queue_lock = threading.Lock()
_worker: Optional[threading.Thread] = None


def queue_processing(owner_type: str, owner_id: Any) -> None:
    """Make a stored video's poster and playable copy in the background. Call it once
    the record is committed, or the worker won't find it."""
    global _worker
    key = (owner_type, str(owner_id))
    with _queue_lock:
        if key in _queued:
            return
        _queued.add(key)
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_work, name='video-worker', daemon=True)
            _worker.start()
    _queue.put(key)


def _work() -> None:
    while True:
        owner_type, owner_id = _queue.get()
        try:
            process_video(owner_type, owner_id)
        except Exception as e:
            logger.error(f"Video processing crashed for {owner_type} {owner_id}: {e}", exc_info=True)
        finally:
            with _queue_lock:
                _queued.discard((owner_type, owner_id))


def _find_rendition(session: Any, owner_type: str, owner_id: Any) -> Optional[VideoRendition]:
    return session.query(VideoRendition).filter(
        VideoRendition.owner_type == owner_type,
        VideoRendition.owner_id == str(owner_id),
    ).first()


def _update_rendition(owner_type: str, owner_id: str, **values: Any) -> None:
    """Saved a piece at a time on a short session: no connection is held while ffmpeg runs"""
    session = get_database().get_session()
    try:
        row = _find_rendition(session, owner_type, owner_id)
        if not row:
            row = VideoRendition(owner_type=owner_type, owner_id=owner_id, attempts=0)
            session.add(row)
        for name, value in values.items():
            setattr(row, name, value)
        # The worker's own rewrites have to read as recent too
        row.updated_at = datetime.now(timezone.utc)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _begin(owner_type: str, owner_id: str) -> Optional[VideoSource]:
    session = get_database().get_session()
    try:
        source = load_source(session, owner_type, owner_id)
        if not source:
            return None
        row = _find_rendition(session, owner_type, owner_id)
        if not row:
            row = VideoRendition(owner_type=owner_type, owner_id=owner_id, attempts=0)
            session.add(row)
        row.status = 'processing'
        row.attempts = (row.attempts or 0) + 1
        row.storage_provider = source.provider
        row.error = None
        row.updated_at = datetime.now(timezone.utc)
        session.commit()
        return source
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _copy_to_disk(storage: Any, source: VideoSource, workdir: Path) -> str:
    """A local copy for ffmpeg to work from, a piece at a time"""
    path = workdir / f"source{Path(source.filename).suffix or '.mp4'}"
    size = source.size or storage.file_size(source.file_id)
    if not size or not storage.supports_range:
        path.write_bytes(storage.download(source.file_id))
        return str(path)
    with open(path, 'wb') as out:
        for chunk in iter_stored_bytes(storage, source.file_id, 0, size - 1):
            out.write(chunk)
    return str(path)


def _upload_rendition(storage: Any, source: VideoSource, path: Path, suffix: str, content_type: str) -> str:
    with open(path, 'rb') as data:
        result = storage.upload(
            file_data=data,
            filename=f"{Path(source.filename).stem}_{suffix}",
            context=source.context,
            context_id=source.context_id,
            category=RENDITION_CATEGORY,
            content_type=content_type,
            optimize=False,
        )
    return result.file_id


def _record_capture_date(source: VideoSource, created_at: Optional[datetime]) -> None:
    """A video uploaded by hand dates from the upload until its own timestamp is read.
    One a provider dated, or that someone has since changed, keeps its date."""
    if not created_at:
        return
    session = get_database().get_session()
    try:
        if source.owner_type == OWNER_WM_PHOTO:
            from app.domains.water_mitigation.models import WMPhoto

            photo = session.query(WMPhoto).filter(WMPhoto.id == source.owner_id).first()
            if photo and photo.source in ('manual_upload', 'crew_upload') and _still_upload_date(photo.captured_date, photo.created_at):
                photo.captured_date = created_at
        else:
            record = session.query(File).filter(File.id == source.owner_id).first()
            if record and _still_upload_date(record.upload_date, record.created_at):
                record.upload_date = created_at
        session.commit()
    except Exception as e:
        session.rollback()
        logger.warning(f"Couldn't date video {source.owner_id}: {e}")
    finally:
        session.close()


def _still_upload_date(shown: Optional[datetime], created: Optional[datetime]) -> bool:
    if shown is None or created is None:
        return True
    shown = shown if shown.tzinfo else shown.replace(tzinfo=timezone.utc)
    created = created if created.tzinfo else created.replace(tzinfo=timezone.utc)
    return abs((shown - created).total_seconds()) < 600


def process_video(owner_type: str, owner_id: str) -> None:
    source = _begin(owner_type, owner_id)
    if not source:
        return

    storage = StorageFactory.get_instance(source.provider)
    workdir = Path(tempfile.mkdtemp(prefix='video-'))
    try:
        media = _copy_to_disk(storage, source, workdir)
        info = video_tools.probe(media)
        _update_rendition(
            owner_type, owner_id,
            codec=info.codec, width=info.width, height=info.height, duration_seconds=info.duration_seconds,
        )
        _record_capture_date(source, info.created_at)

        if not source.poster_url and not _has_poster(owner_type, owner_id):
            poster = workdir / 'poster.jpg'
            video_tools.make_poster(media, poster, info)
            # Saved now: the gallery can show it while the copy below takes its minutes
            _update_rendition(
                owner_type, owner_id,
                poster_file_id=_upload_rendition(storage, source, poster, 'poster.jpg', 'image/jpeg'),
            )

        needs_copy = not info.plays_in_browsers or video_tools.starts_slowly(media)
        if needs_copy:
            copy = workdir / 'playback.mp4'
            video_tools.make_playback_copy(media, copy, info)
            _update_rendition(
                owner_type, owner_id,
                playback_file_id=_upload_rendition(storage, source, copy, 'playback.mp4', 'video/mp4'),
                playback_size=copy.stat().st_size,
            )

        _update_rendition(owner_type, owner_id, status='ready', error=None)
        logger.info(f"Video {owner_id} ready ({info.codec}, copy: {needs_copy})")
    except video_tools.VideoLowMemory as e:
        # Not this video's fault, so it doesn't use up an attempt
        logger.warning(f"Video {owner_id} put off: {e}")
        session_attempts = max(_attempts(owner_type, owner_id) - 1, 0)
        _update_rendition(owner_type, owner_id, status='failed', attempts=session_attempts, error=str(e))
    except Exception as e:
        logger.warning(f"Video {owner_id} failed: {e}")
        _update_rendition(owner_type, owner_id, status='failed', error=str(e)[:500])
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
        _forget_list_cache()


def _attempts(owner_type: str, owner_id: str) -> int:
    session = get_database().get_session()
    try:
        row = _find_rendition(session, owner_type, owner_id)
        return (row.attempts or 0) if row else 0
    finally:
        session.close()


def _has_poster(owner_type: str, owner_id: str) -> bool:
    session = get_database().get_session()
    try:
        row = _find_rendition(session, owner_type, owner_id)
        return bool(row and row.poster_file_id)
    finally:
        session.close()


def _forget_list_cache() -> None:
    """The job's photo list is cached for a moment and now has a new poster to show"""
    try:
        from app.domains.water_mitigation.api import _invalidate_photo_list_cache
        _invalidate_photo_list_cache()
    except Exception:
        pass


# ── What the galleries show ───────────────────

def _rendition_dict(row: Optional[VideoRendition]) -> Optional[Dict[str, Any]]:
    if row is None:
        return None
    return {
        'status': row.status,
        'attempts': row.attempts or 0,
        'updated_at': row.updated_at,
        'storage_provider': row.storage_provider,
        'poster_file_id': row.poster_file_id,
        'playback_file_id': row.playback_file_id,
        'playback_size': row.playback_size,
        'duration_seconds': row.duration_seconds,
    }


def _needs_processing(rendition: Optional[Dict[str, Any]]) -> bool:
    if rendition is None:
        return True
    status = rendition['status']
    if status == 'ready':
        return False
    updated = rendition.get('updated_at')
    if updated is not None and updated.tzinfo is None:
        updated = updated.replace(tzinfo=timezone.utc)
    age = datetime.now(timezone.utc) - updated if updated else STALE_PROCESSING
    if status == 'failed':
        return rendition['attempts'] < MAX_ATTEMPTS and age >= RETRY_FAILED_AFTER
    return age >= STALE_PROCESSING


def _older_phone_clip(source: VideoSource, rendition: Optional[Dict[str, Any]]) -> bool:
    """A field visit's clip marked ready before copies were made of what starts slowly,
    which all of those do. Looked at once more, and the attempts count ends it."""
    return bool(
        rendition
        and rendition['status'] == 'ready'
        and not rendition['playback_file_id']
        and rendition['attempts'] <= 1
        and source.filename.startswith('field-')
    )


def video_fields(owner_type: str, owner_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """What a gallery needs to know about these videos, keyed by id. Any that have
    never been processed, or got stuck, go back in the queue."""
    if not owner_ids:
        return {}
    session = get_database().get_session()
    try:
        rows = session.query(VideoRendition).filter(
            VideoRendition.owner_type == owner_type,
            VideoRendition.owner_id.in_([str(owner_id) for owner_id in owner_ids]),
        ).all()
        by_owner = {row.owner_id: _rendition_dict(row) for row in rows}
    except Exception as e:
        # Code ahead of its migration, say: a video without a poster still plays
        logger.warning(f"Couldn't read video renditions: {e}")
        session.rollback()
        return {}
    finally:
        session.close()

    fields = {}
    for owner_id in owner_ids:
        rendition = by_owner.get(str(owner_id))
        if _needs_processing(rendition):
            queue_processing(owner_type, owner_id)
        fields[str(owner_id)] = {
            'video_status': rendition['status'] if rendition else 'pending',
            'duration_seconds': rendition['duration_seconds'] if rendition else None,
        }
    return fields


def delete_renditions(session: Any, owner_type: str, owner_ids: List[Any]) -> None:
    """Remove what was made from these videos. Nothing shares these files, and a file
    that won't delete is no reason to fail. Call it before the commit."""
    if not owner_ids:
        return
    rows = session.query(VideoRendition).filter(
        VideoRendition.owner_type == owner_type,
        VideoRendition.owner_id.in_([str(owner_id) for owner_id in owner_ids]),
    ).all()
    for row in rows:
        for file_id in (row.poster_file_id, row.playback_file_id):
            if not file_id:
                continue
            try:
                StorageFactory.get_instance(row.storage_provider).delete(file_id)
            except Exception as e:
                logger.warning(f"Couldn't delete video rendition {file_id}: {e}")
        session.delete(row)


# ── Serving ───────────────────────────────────

def parse_range(header: Optional[str], size: int) -> Optional[Tuple[int, int]]:
    """The one range a media element asks for, or None for the whole file.
    Raises 416 for a range past the end."""
    if not header or not header.startswith('bytes=') or ',' in header:
        return None
    first, _, last = header[len('bytes='):].strip().partition('-')
    try:
        if first == '':
            # The last N bytes
            start, end = max(size - int(last), 0), size - 1
        else:
            start = int(first)
            end = min(int(last), size - 1) if last else size - 1
    except ValueError:
        return None
    if size == 0 or start >= size or start > end:
        raise HTTPException(
            status_code=416, detail="Range not satisfiable", headers={'Content-Range': f'bytes */{size}'}
        )
    return start, end


def iter_stored_bytes(storage: Any, file_id: str, start: int, end: int) -> Iterator[bytes]:
    position = start
    while position <= end:
        data = storage.read_range(file_id, position, min(position + READ_CHUNK - 1, end))
        if not data:
            return
        yield data
        position += len(data)


def _stream(
    request: Request,
    storage: Any,
    file_id: str,
    size: Optional[int],
    media_type: str,
    disposition: str,
) -> Response:
    size = size or storage.file_size(file_id)
    if not size or not storage.supports_range:
        # This storage reads files whole, or won't say how big this one is
        return Response(
            content=storage.download(file_id),
            media_type=media_type,
            headers={'Content-Disposition': disposition},
        )

    wanted = parse_range(request.headers.get('range'), size)
    start, end = wanted or (0, size - 1)
    headers = {
        'Accept-Ranges': 'bytes',
        'Content-Length': str(end - start + 1),
        'Content-Disposition': disposition,
        'Cache-Control': 'private, max-age=3600',
    }
    if wanted:
        headers['Content-Range'] = f'bytes {start}-{end}/{size}'
    return StreamingResponse(
        iter_stored_bytes(storage, file_id, start, end),
        status_code=206 if wanted else 200,
        media_type=media_type,
        headers=headers,
    )


def _serve_video(request: Request, source: VideoSource, rendition: Optional[Dict[str, Any]]) -> Response:
    playback = (rendition or {}).get('playback_file_id')
    provider = (rendition or {}).get('storage_provider') or source.provider if playback else source.provider
    storage = StorageFactory.get_instance(provider)
    file_id = playback or source.file_id
    size = (rendition or {}).get('playback_size') if playback else source.size
    media_type = 'video/mp4' if playback else browser_video_type(source.content_type)

    # The browser reads straight from storage where it can: a long video through this
    # one small server would hold up everyone else
    url = storage.signed_media_url(file_id)
    if url:
        # Once nothing more is coming the address can be reused, well inside what it's signed
        # for. Safari asks this route again for each range of a video it plays.
        settled = (rendition or {}).get('status') == 'ready' and not _older_phone_clip(source, rendition)
        return RedirectResponse(
            url=url,
            status_code=302,
            headers={'Cache-Control': 'private, max-age=3600' if settled else 'no-store'},
        )
    return _stream(request, storage, file_id, size, media_type, 'inline')


def video_response(request: Request, owner_type: str, owner_id: str) -> Response:
    """Plays in a browser. Blocking: sync routes run it on a worker thread for us."""
    source, rendition = read_source(owner_type, owner_id)
    if not source:
        raise HTTPException(status_code=404, detail="Video not found")
    if _needs_processing(rendition) or _older_phone_clip(source, rendition):
        queue_processing(owner_type, owner_id)
    return _serve_video(request, source, rendition)


def download_response(request: Request, owner_type: str, owner_id: str) -> Response:
    """The original as a download, read in chunks however long it is"""
    source, _ = read_source(owner_type, owner_id)
    if not source:
        raise HTTPException(status_code=404, detail="Video not found")
    storage = StorageFactory.get_instance(source.provider)
    safe_name = source.filename.replace('"', '')
    return _stream(
        request, storage, source.file_id, source.size, source.content_type,
        f'attachment; filename="{safe_name}"',
    )


def poster_bytes(source: VideoSource, rendition: Optional[Dict[str, Any]]) -> Optional[bytes]:
    """The poster we made, kept on disk: thumbnails are asked for far more often than they change"""
    file_id = (rendition or {}).get('poster_file_id')
    if not file_id:
        return None
    cache_file = Path(settings.STORAGE_BASE_DIR) / '.cache' / 'video-posters' / f'{source.owner_id}.jpg'
    if cache_file.exists():
        return cache_file.read_bytes()
    storage = StorageFactory.get_instance((rendition or {}).get('storage_provider') or source.provider)
    data = storage.download(file_id)
    try:
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        temporary = cache_file.with_suffix('.tmp')
        temporary.write_bytes(data)
        temporary.replace(cache_file)
    except OSError as e:
        logger.warning(f"Couldn't cache poster for {source.owner_id}: {e}")
    return data


def poster_response(owner_type: str, owner_id: str) -> Response:
    """The picture to show for a video: CompanyCam's, ours, or a stand-in until ours is made"""
    source, rendition = read_source(owner_type, owner_id)
    if not source:
        raise HTTPException(status_code=404, detail="Video not found")
    # A grid of them is the moment before someone presses play
    if _older_phone_clip(source, rendition):
        queue_processing(owner_type, owner_id)
    if source.poster_url:
        return RedirectResponse(
            url=source.poster_url, status_code=302, headers={'Cache-Control': 'public, max-age=86400'}
        )
    try:
        poster = poster_bytes(source, rendition)
    except Exception as e:
        logger.warning(f"Couldn't read poster for {owner_id}: {e}")
        poster = None
    if poster:
        return Response(
            content=poster,
            media_type='image/jpeg',
            headers={'Content-Disposition': 'inline', 'Cache-Control': 'public, max-age=604800, immutable'},
        )
    if _needs_processing(rendition):
        queue_processing(owner_type, owner_id)
    return Response(content=PLACEHOLDER_POSTER, media_type='image/svg+xml', headers={'Cache-Control': 'no-store'})
