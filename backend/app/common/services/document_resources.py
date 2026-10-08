"""Shared memory budget for synchronous document and mail work.

The production server runs one worker. A reentrant lock also covers nested
renders triggered by an email, without deadlocking or overlapping their peaks.
"""

from functools import wraps
from pathlib import Path
import threading

MIB = 1024 * 1024
DOCUMENT_LOCK = threading.RLock()


class DocumentResourceError(ValueError):
    """A document cannot be processed within the instance's memory budget."""


def memory_headroom():
    """Return container headroom, including children; None outside cgroups.

    File cache is reclaimable, so subtract inactive file pages just as container
    working-set metrics do. Do not use host RAM as a container's available RAM.
    """
    for root, limit_name, usage_name, inactive_key in (
        (Path('/sys/fs/cgroup'), 'memory.max', 'memory.current', 'inactive_file'),
        (Path('/sys/fs/cgroup/memory'), 'memory.limit_in_bytes',
         'memory.usage_in_bytes', 'total_inactive_file'),
    ):
        try:
            limit = int((root / limit_name).read_text().strip())
            if limit > 1 << 60:
                continue
            used = int((root / usage_name).read_text().strip())
            stats = dict(line.split() for line in (root / 'memory.stat').read_text().splitlines())
            return limit - max(0, used - int(stats.get(inactive_key, 0)))
        except (OSError, ValueError):
            continue
    return None


def require_memory(working_bytes=64 * MIB):
    available = memory_headroom()
    # Reserve room for health checks, DB activity and allocator overhead.
    if available is not None and available < working_bytes + 48 * MIB:
        raise DocumentResourceError(
            'The server has insufficient memory for this document right now. '
            'Please retry later or use a smaller document.'
        )


def document_job(func):
    """Fail fast when busy; never accumulate waiting jobs holding DB sessions."""
    @wraps(func)
    def guarded(*args, **kwargs):
        if not DOCUMENT_LOCK.acquire(blocking=False):
            raise DocumentResourceError(
                'Another document or email is being processed. Please retry when it finishes.'
            )
        try:
            require_memory()
            return func(*args, **kwargs)
        finally:
            try:
                from app.common.services.pdf_service import release_memory
                release_memory()
            finally:
                DOCUMENT_LOCK.release()
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
