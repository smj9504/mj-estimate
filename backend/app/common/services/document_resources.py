"""Shared memory budget for synchronous document and mail work.

The production server runs one worker. A reentrant lock also covers nested
renders triggered by an email, without deadlocking or overlapping their peaks.
"""

from contextlib import contextmanager
from functools import wraps
from pathlib import Path
import logging
import sys
import threading

logger = logging.getLogger(__name__)

MIB = 1024 * 1024
DOCUMENT_LOCK = threading.RLock()


class DocumentResourceError(ValueError):
    """A document cannot be processed within the instance's memory budget."""


def memory_headroom():
    """Return container headroom, including children; None outside cgroups.

    The kernel reclaims file cache (active and inactive; shmem is not on the
    file LRUs) before it OOM-kills, so count it as available. Counting only
    inactive pages made the mapped libraries of an idle app look unavailable
    and refused even small sketch reports on the 512MB instance. Do not use
    host RAM as a container's available RAM.
    """
    for root, limit_name, usage_name, file_keys in (
        (Path('/sys/fs/cgroup'), 'memory.max', 'memory.current',
         ('active_file', 'inactive_file')),
        (Path('/sys/fs/cgroup/memory'), 'memory.limit_in_bytes',
         'memory.usage_in_bytes', ('total_active_file', 'total_inactive_file')),
    ):
        try:
            limit = int((root / limit_name).read_text().strip())
            if limit > 1 << 60:
                continue
            used = int((root / usage_name).read_text().strip())
            stats = dict(line.split() for line in (root / 'memory.stat').read_text().splitlines())
            reclaimable = sum(int(stats.get(key, 0)) for key in file_keys)
            return limit - max(0, used - reclaimable)
        except (OSError, ValueError):
            continue
    return None


def release_memory() -> None:
    """Return freed heap pages to the OS after a memory-heavy job.

    glibc keeps freed memory in its arenas, so RSS stays at the peak of the
    last render and the next request starts from there. malloc_trim only
    exists on glibc (Linux); elsewhere this is just a gc pass.
    """
    import gc
    gc.collect()
    if sys.platform.startswith('linux'):
        try:
            import ctypes
            ctypes.CDLL("libc.so.6").malloc_trim(0)
        except Exception:
            pass


def require_memory(working_bytes=64 * MIB):
    # Reserve room for health checks, DB activity and allocator overhead.
    needed = working_bytes + 48 * MIB
    available = memory_headroom()
    if available is None or available >= needed:
        return
    # Heap freed by earlier requests still counts as used until trimmed.
    release_memory()
    available = memory_headroom()
    if available is None or available >= needed:
        return
    logger.warning(
        'Refusing document work: %d MiB headroom, %d MiB needed',
        available // MIB, needed // MIB,
    )
    raise DocumentResourceError(
        'The server has insufficient memory for this document right now. '
        'Please retry later or use a smaller document.'
    )


@contextmanager
def document_guard():
    """Fail fast when busy; never accumulate waiting jobs holding DB sessions."""
    if not DOCUMENT_LOCK.acquire(blocking=False):
        raise DocumentResourceError(
            'Another document or email is being processed. Please retry when it finishes.'
        )
    try:
        require_memory()
        yield
    finally:
        try:
            release_memory()
        finally:
            DOCUMENT_LOCK.release()


def document_job(func):
    @wraps(func)
    def guarded(*args, **kwargs):
        with document_guard():
            return func(*args, **kwargs)
    return guarded


def check_size(size, maximum):
    if size > maximum:
        raise DocumentResourceError(
            f'Document exceeds the safe {maximum // MIB} MB processing limit. '
            'Use Compress when generating the report, or split the document. Email was not sent.'
        )


def read_bounded(path, maximum):
    """Check before allocation and bound the read even if the file changes."""
    check_size(Path(path).stat().st_size, maximum)
    require_memory(2 * maximum)
    with open(path, 'rb') as source:
        data = source.read(maximum + 1)
    check_size(len(data), maximum)
    return data


class DiskPDFWriter:
    """Append one rendered page at a time, releasing image streams each time.

    Reopen after each incremental save so the PDF library cannot retain all
    prior pages' compressed image streams until the end of a long report.
    """
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.started = False

    def append(self, page_buffer):
        import fitz as pymupdf
        require_memory(32 * MIB)
        with pymupdf.open(stream=page_buffer, filetype='pdf') as page:
            if not self.started:
                page.save(str(self.path))
                self.started = True
            else:
                with pymupdf.open(str(self.path)) as output:
                    output.insert_pdf(page)
                    output.saveIncr()
