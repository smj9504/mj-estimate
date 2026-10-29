"""Poster frames for water-mitigation videos.

The photo gallery shows every item as an image tile, so a video's
thumbnail/web preview is a still frame taken from the video itself.
"""

import asyncio
import logging
import tempfile
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


def is_video(photo) -> bool:
    """True for a video row of wm_photos (ORM object or dict). Image-only
    features (PDFs, AI, crops, fingerprints) must skip these.

    The MIME type decides when there is one: uploads have long set
    file_type='video' for any non-image/* content type, including images
    a browser sent as application/octet-stream.
    """
    get = photo.get if isinstance(photo, dict) else (lambda key: getattr(photo, key, None))
    mime_type = get("mime_type") or ""
    if mime_type:
        return mime_type.startswith("video/")
    return get("file_type") == "video"


def extract_poster_frame(video_path: str) -> Optional[bytes]:
    """JPEG bytes of a frame about 1s into the video, or None if unreadable.

    The very first frame of a phone video is often black or blurred, so it is
    only used when the video is too short to seek into.
    """
    import cv2

    cap = cv2.VideoCapture(video_path)
    try:
        if not cap.isOpened():
            return None
        fps = cap.get(cv2.CAP_PROP_FPS) or 0
        frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
        target = int(min(fps, frame_count / 2)) if fps > 0 and frame_count > 0 else 0
        if target:
            cap.set(cv2.CAP_PROP_POS_FRAMES, target)
        ok, frame = cap.read()
        if not ok and target:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ok, frame = cap.read()
        if not ok or frame is None:
            return None
        ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
        return encoded.tobytes() if ok else None
    finally:
        cap.release()


async def load_video_poster(
    file_path: str,
    storage_provider: Optional[str],
    storage_file_id: Optional[str],
) -> Optional[bytes]:
    """Poster frame for a stored video (local disk or cloud storage), or None."""
    from app.core.config import settings

    from ..storage.factory import StorageFactory

    if not storage_provider or storage_provider == "local":
        local_path = Path(file_path)
        if not local_path.exists():
            local_path = Path(settings.STORAGE_BASE_DIR) / file_path
        if local_path.exists():
            return await asyncio.to_thread(extract_poster_frame, str(local_path))
        # Same fallback as the photo preview: a local row whose file now lives
        # in the configured cloud storage
        storage_provider = settings.STORAGE_PROVIDER.lower()
        if storage_provider == "local" or not storage_file_id:
            return None

    storage = StorageFactory.get_instance(storage_provider)
    suffix = Path(file_path).suffix or ".mp4"
    # A directory rather than NamedTemporaryFile: OpenCV must reopen the file
    # by name, which Windows (local dev) refuses while it is held open.
    with tempfile.TemporaryDirectory() as tmp_dir:
        video_file = Path(tmp_dir) / f"video{suffix}"
        if storage_provider in ("gdrive", "gcs"):
            data = await asyncio.to_thread(storage.download, storage_file_id)
            await asyncio.to_thread(video_file.write_bytes, data)
            del data
        else:
            # S3-style providers: stream the signed URL to disk instead of
            # holding a whole video in memory
            url = await asyncio.to_thread(
                storage.get_url, storage_file_id or file_path, expires_in=600
            )
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream("GET", url) as response:
                    response.raise_for_status()
                    with open(video_file, "wb") as out:
                        async for chunk in response.aiter_bytes(1024 * 1024):
                            out.write(chunk)
        return await asyncio.to_thread(extract_poster_frame, str(video_file))
