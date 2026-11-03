"""
ffmpeg for job videos: what a file holds, a poster frame, and a copy any browser plays.

iPhones record HEVC by default, which plenty of browsers can't decode, so an
HEVC video needs an H.264 copy to be watchable everywhere. The binary comes with
the imageio-ffmpeg package: the same one on Render and on a developer's machine,
with nothing to install on the system.

Everything here blocks, so call it from a worker thread. ffmpeg only ever gets a
local file: the Linux build in that package crashes on any URL (a static binary and
DNS don't mix), and encoding a long clip shouldn't depend on a connection staying up.
"""

import logging
import os
import re
import shutil
import struct
import subprocess
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import BinaryIO, Dict, List, Optional, Set
from urllib.parse import urlsplit

import httpx

logger = logging.getLogger(__name__)

# Long side of a poster and of the copy made for browsers
POSTER_MAX_SIDE = 800
PLAYBACK_MAX_SIDE = 1280

# Render kills the whole container at 512MB, which takes the app with it. ffmpeg is
# stopped well before that and tried again later: a video that isn't ready yet beats
# a server restart. In a 512MB Linux container on half a CPU these flags take a 1080p
# HEVC clip at about 65MB over the app (ffmpeg's defaults: more than double) and 3.5
# times its length.
MIN_MEMORY_HEADROOM = 30 * 1024 * 1024
SINGLE_THREAD = ['-threads', '1']
LOW_MEMORY_H264 = [
    '-c:v', 'libx264', '-preset', 'superfast', '-crf', '26',
    '-x264-params', 'rc-lookahead=0:ref=1:bframes=0:sync-lookahead=0',
]

# Everything the browsers decode as it is: the MP4 family carrying these
MP4_FAMILY = 'mov'
PLAYABLE_PIXEL_FORMATS = {'yuv420p', 'yuvj420p'}
PLAYABLE_AUDIO = {None, 'aac', 'mp3'}
HDR_TRANSFERS = ('arib-std-b67', 'smpte2084')

DOWNLOAD_ATTEMPTS = 3
DOWNLOAD_CHUNK = 1024 * 1024
DOWNLOAD_TIMEOUT = httpx.Timeout(60.0, read=120.0)

_SIGNED_URL = re.compile(r'https?://\S+')


class VideoToolError(Exception):
    """ffmpeg couldn't do it"""


class VideoLowMemory(VideoToolError):
    """Stopped to protect the server; worth trying again later"""


@dataclass
class VideoInfo:
    container: Optional[str] = None
    codec: Optional[str] = None
    pixel_format: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    duration_seconds: Optional[float] = None
    audio_codec: Optional[str] = None
    hdr: bool = False
    created_at: Optional[datetime] = None

    @property
    def plays_in_browsers(self) -> bool:
        return (
            self.container == MP4_FAMILY
            and self.codec == 'h264'
            and self.pixel_format in PLAYABLE_PIXEL_FORMATS
            and self.audio_codec in PLAYABLE_AUDIO
        )

    @property
    def video_needs_encoding(self) -> bool:
        """Else only the container or the audio is the problem, which costs next to nothing to fix"""
        return self.codec != 'h264' or self.pixel_format not in PLAYABLE_PIXEL_FORMATS


def ffmpeg_path() -> Optional[str]:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as e:
        logger.warning(f"Bundled ffmpeg unavailable: {e}")
    return shutil.which('ffmpeg')


def _read_int(path: Path) -> Optional[int]:
    try:
        return int(path.read_text().strip())
    except (OSError, ValueError):
        return None


def _container_memory() -> Optional[tuple[int, int]]:
    """(in use, limit) from the container's cgroup, or None off Linux or with no limit set.
    File cache the kernel can drop on demand doesn't count as in use."""
    for root, limit_name, usage_name, inactive_key in (
        ('/sys/fs/cgroup', 'memory.max', 'memory.current', 'inactive_file'),
        ('/sys/fs/cgroup/memory', 'memory.limit_in_bytes', 'memory.usage_in_bytes', 'total_inactive_file'),
    ):
        limit = _read_int(Path(root, limit_name))
        usage = _read_int(Path(root, usage_name))
        if limit is None or usage is None or limit >= 2 ** 60:
            continue
        inactive = 0
        try:
            for line in Path(root, 'memory.stat').read_text().splitlines():
                key, _, value = line.partition(' ')
                if key == inactive_key:
                    inactive = int(value)
                    break
        except (OSError, ValueError):
            pass
        return usage - inactive, limit
    return None


def memory_headroom() -> Optional[int]:
    """Bytes this container can still use; None when there's no limit to go by"""
    container = _container_memory()
    if container:
        return container[1] - container[0]

    # No cgroup to read: compare this process and its children with a stated limit
    limit_mb = int(os.getenv('VIDEO_MEMORY_LIMIT_MB') or (512 if os.getenv('RENDER') else 0))
    if not limit_mb:
        return None
    try:
        import psutil
        process = psutil.Process()
        used = process.memory_info().rss + sum(
            child.memory_info().rss for child in process.children(recursive=True)
        )
    except Exception:
        return None
    return limit_mb * 1024 * 1024 - used


def _decoded_frame_bytes(info: Optional[VideoInfo]) -> int:
    pixels = ((info.width or 1920) * (info.height or 1080)) if info else 1920 * 1080
    deep_color = bool(info and re.search(r'p1[02]', info.pixel_format or ''))
    return int(pixels * (3 if deep_color else 1.5))


def _require_room(needed: int) -> None:
    """Won't start what wouldn't fit. A 4K clip is why: the watchdog checks twice a
    second, and in that time ffmpeg can run the container into its limit."""
    headroom = memory_headroom()
    if headroom is not None and headroom - needed < MIN_MEMORY_HEADROOM:
        raise VideoLowMemory('Not enough memory free for this video right now')


def _clean_error(text: str) -> str:
    """ffmpeg quotes its input, and a signed URL is as good as a password"""
    return _SIGNED_URL.sub('<url>', text).strip()[-500:]


def _run(args: List[str], timeout: float) -> None:
    executable = ffmpeg_path()
    if not executable:
        raise VideoToolError('ffmpeg is not available')

    command = [executable, '-hide_banner', '-loglevel', 'error', '-y', *args]
    # The site stays responsive: encoding only gets what requests leave over
    if os.name == 'posix' and shutil.which('nice'):
        command = ['nice', '-n', '19', *command]

    with tempfile.TemporaryFile() as stderr:
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=stderr)
        deadline = time.monotonic() + timeout
        try:
            while True:
                try:
                    code = process.wait(timeout=0.5)
                    break
                except subprocess.TimeoutExpired:
                    pass
                if time.monotonic() > deadline:
                    raise VideoToolError(f'Timed out after {int(timeout)}s')
                headroom = memory_headroom()
                if headroom is not None and headroom < MIN_MEMORY_HEADROOM:
                    raise VideoLowMemory('Stopped: the server was running out of memory')
        except BaseException:
            process.kill()
            process.wait()
            raise

        if code != 0:
            stderr.seek(0)
            raise VideoToolError(_clean_error(stderr.read().decode('utf-8', 'replace')) or f'ffmpeg exited {code}')


def _parse_probe(output: str) -> VideoInfo:
    info = VideoInfo()

    container = re.search(r'Input #0, ([\w,]+), from', output)
    if container:
        names = container.group(1).split(',')
        info.container = names[0] if names[0] != 'matroska' else 'webm' if 'webm' in names else 'matroska'

    duration = re.search(r'Duration: (\d+):(\d+):(\d+(?:\.\d+)?)', output)
    if duration:
        hours, minutes, seconds = duration.groups()
        info.duration_seconds = int(hours) * 3600 + int(minutes) * 60 + float(seconds)

    created = re.search(r'creation_time\s*:\s*(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)', output)
    if created:
        try:
            parsed = datetime.fromisoformat(created.group(1).replace('Z', '+00:00'))
            # An unset clock reads as 1904 or 1970
            info.created_at = parsed if parsed.year >= 2000 else None
        except ValueError:
            pass

    for line in output.splitlines():
        if 'Stream #' not in line:
            continue
        video = re.search(r'Video: (\w+)', line)
        # A cover image counts as a video stream too
        if video and not info.codec and 'attached pic' not in line:
            info.codec = video.group(1)
            pixel = re.search(r', (\w*(?:yuv|rgb|gray|nv)\w*)(\(([^)]*)\))?', line)
            if pixel:
                info.pixel_format = pixel.group(1)
                info.hdr = any(transfer in (pixel.group(3) or '') for transfer in HDR_TRANSFERS)
            size = re.search(r', (\d{2,5})x(\d{2,5})', line)
            if size:
                info.width, info.height = int(size.group(1)), int(size.group(2))
        audio = re.search(r'Audio: (\w+)', line)
        if audio and not info.audio_codec:
            info.audio_codec = audio.group(1)
    return info


def probe(source: str) -> VideoInfo:
    executable = ffmpeg_path()
    if not executable:
        raise VideoToolError('ffmpeg is not available')
    # With no output named ffmpeg lists the input and exits non-zero, which is all this needs
    result = subprocess.run(
        [executable, '-hide_banner', '-i', source],
        stdin=subprocess.DEVNULL, capture_output=True, text=True, errors='replace', timeout=120,
    )
    info = _parse_probe(result.stderr)
    if not info.codec:
        raise VideoToolError(_clean_error(result.stderr) or 'No video stream found')
    return info


def starts_slowly(path: str) -> bool:
    """Whether a browser has to go looking for this MP4's index before it can play. A phone's
    recording comes in pieces, each with its own index, and Chrome asks storage for every
    one: 85 seconds for a 60-second clip with storage answering in 1.2s. A camera's file has
    its one index at the end, which is one extra trip. With it at the front there are none."""
    size = os.path.getsize(path)
    with open(path, 'rb') as file:
        position = 0
        while position + 8 <= size:
            file.seek(position)
            header = file.read(16)
            length, kind = struct.unpack('>I4s', header[:8])
            if length == 1 and len(header) == 16:
                length = struct.unpack('>Q', header[8:16])[0]
            elif length == 0:
                length = size - position
            if kind in (b'moof', b'mdat'):
                return True
            if kind == b'moov':
                # Declares that pieces follow
                return b'mvex' in _child_kinds(file, position + 8, position + length)
            if length < 8:
                return False
            position += length
    return False


def _child_kinds(file: BinaryIO, start: int, end: int) -> Set[bytes]:
    kinds = set()
    position = start
    while position + 8 <= end:
        file.seek(position)
        length, kind = struct.unpack('>I4s', file.read(8))
        kinds.add(kind)
        if length < 8:
            break
        position += length
    return kinds


def _fit(max_side: int) -> str:
    return (
        f"scale=w='min({max_side},iw)':h='min({max_side},ih)'"
        ":force_original_aspect_ratio=decrease:force_divisible_by=2"
    )


# HDR, the iPhone's default on recent models, looks washed out shown as ordinary video
_HDR_TO_SDR = (
    'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,'
    'tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv'
)


def _sdr_filter(info: Optional[VideoInfo], max_side: int) -> str:
    parts = [_fit(max_side)]
    if info and info.hdr:
        parts.append(_HDR_TO_SDR)
    parts.append('format=yuv420p')
    return ','.join(parts)


def make_poster(source: str, dest: Path, info: Optional[VideoInfo] = None) -> None:
    """A frame a second in, past the shake of pressing record. A clip shorter than that gets its first.
    Only keyframes are decoded, which takes far less memory than playing the video to that point."""
    _require_room(_decoded_frame_bytes(info) * 3 + 30 * 1024 * 1024)
    frame = ['-frames:v', '1', '-vf', _sdr_filter(info, POSTER_MAX_SIDE), '-q:v', '4', str(dest)]
    for seek in (['-ss', '1'], []):
        try:
            _run([*SINGLE_THREAD, '-skip_frame', 'nokey', *seek, '-i', source, '-an', *frame], timeout=180)
        except VideoLowMemory:
            raise
        except VideoToolError as e:
            logger.info(f"Poster attempt failed: {e}")
            continue
        if dest.exists() and dest.stat().st_size > 0:
            return
    raise VideoToolError('Could not take a frame from this video')


def make_playback_copy(source: str, dest: Path, info: VideoInfo) -> None:
    """An H.264 MP4, starting to play before it has fully loaded. The original is kept."""
    # A dozen decoded frames, measured against a 1080p clip, plus the program itself
    if info.video_needs_encoding:
        _require_room(_decoded_frame_bytes(info) * 12 + 35 * 1024 * 1024)

    video = (
        ['-vf', _sdr_filter(info, PLAYBACK_MAX_SIDE), *LOW_MEMORY_H264, *SINGLE_THREAD]
        if info.video_needs_encoding else ['-c:v', 'copy']
    )
    audio = ['-c:a', 'aac', '-b:a', '128k', '-ac', '2'] if info.audio_codec not in {None, 'aac'} else ['-c:a', 'copy']
    # Half a CPU on a small server: give a long clip all the time it needs
    timeout = max(1800.0, (info.duration_seconds or 0) * 60)
    _run(
        [
            *SINGLE_THREAD, '-i', source,
            '-map', '0:v:0', '-map', '0:a:0?', *video, *audio,
            '-movflags', '+faststart', str(dest),
        ],
        timeout=timeout,
    )


def download_to_file(url: str, dest: Path, headers: Optional[Dict[str, str]] = None) -> int:
    """Save a provider's photo or video to disk without holding it in memory; returns
    its size. A signed URL needs no login, and shouldn't be sent our API key."""
    # CompanyCam's docs describe a stream for a processed video, but what it serves is
    # the uploaded file. Saved as it is a playlist would pass for a broken video.
    if urlsplit(url).path.lower().endswith('.m3u8'):
        raise VideoToolError('The provider served a stream rather than a video file')

    last_error: Optional[Exception] = None
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        try:
            with httpx.stream('GET', url, headers=headers, timeout=DOWNLOAD_TIMEOUT, follow_redirects=True) as response:
                response.raise_for_status()
                with open(dest, 'wb') as out:
                    for chunk in response.iter_bytes(DOWNLOAD_CHUNK):
                        out.write(chunk)
            return dest.stat().st_size
        except httpx.HTTPStatusError as e:
            last_error = e
            if e.response.status_code != 429 and e.response.status_code < 500:
                break
        except httpx.TransportError as e:
            last_error = e
        if attempt < DOWNLOAD_ATTEMPTS:
            time.sleep(2 ** attempt)

    # The exception text would carry the signed URL
    detail = getattr(getattr(last_error, 'response', None), 'status_code', type(last_error).__name__)
    raise VideoToolError(f'Download failed: {detail}')
