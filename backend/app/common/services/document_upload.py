"""Send an already-spooled document to storage without full-file RAM copies."""

import asyncio

from app.common.services.document_resources import document_job


async def upload_document_file(storage, source, **kwargs):
    task = asyncio.create_task(asyncio.to_thread(upload_document_stream, storage, source, **kwargs))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        # A worker thread cannot be cancelled. Wait until it stops using the
        # spool before FastAPI closes the request's UploadFile on cancellation.
        try:
            await task
        finally:
            raise


@document_job
def upload_document_stream(storage, source, **kwargs):
    source.seek(0, 2)
    size = source.tell()
    source.seek(0)
    # Documents must preserve their original bytes/MIME. In particular, do not
    # decode images or gzip text into another full in-memory buffer here.
    result = storage.upload(file_data=source, optimize=False, **kwargs)
    return result, size
