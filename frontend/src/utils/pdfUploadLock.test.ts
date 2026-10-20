import { afterEach, describe, expect, it } from 'vitest';
import {
  acquirePdfUploadLock,
  bodyHasPdf,
  getPdfUploadLockState,
  subscribePdfUploadLock,
  withPdfUploadLock,
  type PdfUploadHold,
} from './pdfUploadLock';

const pdf = (name = 'estimate.pdf', type = 'application/pdf') => new File(['%PDF-1.7'], name, { type });

describe('bodyHasPdf', () => {
  it('spots a PDF among the fields of a multipart form', () => {
    const form = new FormData();
    form.append('context', 'negotiation');
    form.append('files', pdf());
    expect(bodyHasPdf(form)).toBe(true);
  });

  it('goes by the file name when the browser left the type empty', () => {
    const form = new FormData();
    form.append('file', pdf('ESTIMATE.PDF', ''));
    expect(bodyHasPdf(form)).toBe(true);
  });

  it('counts a bare PDF blob sent as the body', () => {
    expect(bodyHasPdf(new Blob(['%PDF-1.7'], { type: 'application/pdf' }))).toBe(true);
  });

  it('ignores forms carrying only photos or plain fields, and JSON bodies', () => {
    const photos = new FormData();
    photos.append('files', new File(['jpeg'], 'kitchen.jpg', { type: 'image/jpeg' }));
    photos.append('note', 'report.pdf');
    expect(bodyHasPdf(photos)).toBe(false);
    expect(bodyHasPdf({ file_name: 'report.pdf' })).toBe(false);
    expect(bodyHasPdf(undefined)).toBe(false);
  });
});

describe('PDF upload lock', () => {
  const open: PdfUploadHold[] = [];
  const acquire = () => {
    const hold = acquirePdfUploadLock();
    open.push(hold);
    return hold;
  };

  afterEach(() => {
    open.splice(0).forEach(hold => hold.release());
  });

  it('stays held until every upload has released it', () => {
    const first = acquire();
    const second = acquire();
    expect(getPdfUploadLockState().active).toBe(true);

    first.release();
    first.release();
    expect(getPdfUploadLockState().active).toBe(true);

    second.release();
    expect(getPdfUploadLockState()).toEqual({ active: false, percent: null });
  });

  it('reports progress summed over the uploads in flight', () => {
    const first = acquire();
    const second = acquire();
    expect(getPdfUploadLockState().percent).toBeNull();

    first.progress(50, 100);
    second.progress(0, 300);
    expect(getPdfUploadLockState().percent).toBe(13);

    second.progress(300, 300);
    expect(getPdfUploadLockState().percent).toBe(88);
  });

  it('ignores progress from an upload that already let go', () => {
    const done = acquire();
    const pending = acquire();
    done.release();

    done.progress(100, 100);
    expect(getPdfUploadLockState().percent).toBeNull();
    pending.progress(25, 100);
    expect(getPdfUploadLockState().percent).toBe(25);
  });

  it('notifies subscribers only when what the overlay shows changes', () => {
    let calls = 0;
    const unsubscribe = subscribePdfUploadLock(() => { calls += 1; });
    const hold = acquire();
    hold.progress(10, 1000);
    hold.progress(11, 1000);
    hold.release();
    unsubscribe();
    expect(calls).toBe(3);
  });

  it('holds the lock for a whole chained flow and lets go when it fails', async () => {
    let heldDuringTask = false;
    await expect(withPdfUploadLock(async () => {
      heldDuringTask = getPdfUploadLockState().active;
      throw new Error('replace failed');
    })).rejects.toThrow('replace failed');
    expect(heldDuringTask).toBe(true);
    expect(getPdfUploadLockState().active).toBe(false);
  });
});
