"""What an uploaded photo or video really is.

A browser's word for it isn't enough: Windows reports an iPhone's .heic with no
type at all, which reaches the server as application/octet-stream.
"""

from pathlib import Path
from typing import Optional

GENERIC_TYPES = {'', 'application/octet-stream', 'binary/octet-stream'}

TYPE_BY_EXTENSION = {
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.mov': 'video/quicktime',
    '.qt': 'video/quicktime',
    '.mp4': 'video/mp4',
    '.m4v': 'video/x-m4v',
    '.3gp': 'video/3gpp',
    '.webm': 'video/webm',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.wmv': 'video/x-ms-wmv',
}

# QuickTime and MP4 are the same format to a browser, and calling it QuickTime stops
# some from trying. The real type stays on the record.
MP4_FAMILY_TYPES = {'video/quicktime', 'video/mp4', 'video/x-m4v'}


def media_type_of(filename: Optional[str], content_type: Optional[str]) -> str:
    """The type to go by: the browser's unless it doesn't know, then the file's extension"""
    declared = (content_type or '').split(';')[0].strip().lower()
    if declared not in GENERIC_TYPES:
        return declared
    return TYPE_BY_EXTENSION.get(Path(filename or '').suffix.lower(), declared or 'application/octet-stream')


def is_video(content_type: Optional[str]) -> bool:
    return (content_type or '').startswith('video/')


def is_heic(content_type: Optional[str]) -> bool:
    return (content_type or '') in ('image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence')


def browser_video_type(content_type: Optional[str]) -> str:
    """The type to serve a video under"""
    return 'video/mp4' if (content_type or '') in MP4_FAMILY_TYPES else (content_type or 'video/mp4')


def as_jpeg_name(filename: str) -> str:
    return f"{Path(filename).stem}.jpg"
