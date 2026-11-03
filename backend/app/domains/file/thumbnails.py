"""
The small pictures in a photo grid. B2 makes none, so a grid cell used to download the
whole photo, every time. Each photo now gets one: made once, kept in storage because this
server's disk goes with every deploy, and on that disk as well for whoever asks next.

Everything here blocks, so call it from a worker thread.
"""

import io
import logging
from pathlib import Path
from typing import Any, Dict, Optional

from PIL import Image, ImageOps

from app.common.services.media_types import is_heic
from app.core.config import settings
from app.domains.storage.factory import StorageFactory

logger = logging.getLogger(__name__)

# Sharp in a grid cell on a high-density screen, and about 30KB
LONG_SIDE = 400
QUALITY = 75

STORAGE_CONTEXT = 'file-thumbnails'
STORAGE_NAME = 'thumbnail.jpg'


def stored_in_cloud(record: Dict[str, Any]) -> bool:
    """Prefer the authoritative storage_provider column - falls back to sniffing the url
    prefix only for legacy rows written before this column existed (a url missing its
    provider prefix would otherwise be misread as a local path even though it's genuinely
    in the cloud, which is exactly the bug this column exists to prevent)."""
    provider = record.get('storage_provider')
    if provider:
        return provider != 'local'
    return (record.get('url') or '').startswith(('gs://', 'b2://', 'https://', 'http://'))


def cache_path(file_id: str) -> Path:
    return Path(settings.STORAGE_BASE_DIR) / '.cache' / 'previews' / 'file-thumbnails' / f'{file_id}.jpg'


def _write_cache(file_id: str, thumbnail: bytes) -> None:
    path = cache_path(file_id)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix('.tmp')
        temporary.write_bytes(thumbnail)
        temporary.replace(path)
    except OSError as e:
        logger.warning(f"Couldn't cache thumbnail for {file_id}: {e}")


def render(photo: bytes) -> bytes:
    with Image.open(io.BytesIO(photo)) as image:
        # A JPEG can be decoded at a fraction of its size, which saves most of the time and memory
        image.draft('RGB', (LONG_SIDE * 2, LONG_SIDE * 2))
        upright = ImageOps.exif_transpose(image)
        upright.thumbnail((LONG_SIDE, LONG_SIDE))
        output = io.BytesIO()
        upright.convert('RGB').save(output, 'JPEG', quality=QUALITY)
    return output.getvalue()


def keep(file_id: str, provider: Optional[str], thumbnail: bytes) -> None:
    """Failing only means it gets made again"""
    _write_cache(file_id, thumbnail)
    try:
        StorageFactory.get_instance(provider).upload(
            file_data=io.BytesIO(thumbnail),
            filename=STORAGE_NAME,
            context=STORAGE_CONTEXT,
            context_id=file_id,
            content_type='image/jpeg',
            optimize=False,
            replace=True,
        )
    except Exception as e:
        logger.warning(f"Couldn't store thumbnail for {file_id}: {e}")


def keep_from_photo(file_id: str, provider: Optional[str], photo: bytes) -> None:
    """Made as a photo arrives, so nobody waits for it"""
    try:
        thumbnail = render(photo)
    except Exception as e:
        logger.info(f"No thumbnail for {file_id}: {e}")
        return
    keep(file_id, provider, thumbnail)


def read_kept(record: Dict[str, Any]) -> Optional[bytes]:
    """The one in storage, if it has been made. Its address doesn't depend on where the
    photo is filed, which changes when a field visit goes on a claim."""
    if not stored_in_cloud(record):
        return None
    file_id = str(record['id'])
    try:
        thumbnail = StorageFactory.get_instance(record.get('storage_provider')).download(
            f'{STORAGE_CONTEXT}/{file_id}/{STORAGE_NAME}'
        )
    except Exception:
        return None
    _write_cache(file_id, thumbnail)
    return thumbnail


def make(record: Dict[str, Any]) -> Optional[bytes]:
    """From the photo itself. None when it can't be read as a picture."""
    url = record.get('url') or ''
    try:
        if stored_in_cloud(record):
            photo = StorageFactory.get_instance(record.get('storage_provider')).download(url)
        else:
            photo = Path(url).read_bytes()
        # Stored before uploads were converted
        if is_heic(record.get('content_type')):
            from app.domains.storage.optimization import heic_to_jpeg
            photo = heic_to_jpeg(photo)
        return render(photo)
    except Exception as e:
        logger.warning(f"Couldn't make a thumbnail for {record.get('id')}: {e}")
        return None
