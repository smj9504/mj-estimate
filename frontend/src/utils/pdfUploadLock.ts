/**
 * App-wide lock held while a PDF is uploading.
 *
 * A PDF upload - and the server-side parse that often rides on the same
 * request - can take several seconds. If the user keeps working meanwhile
 * (closes the modal, saves the form, opens another claim), the result lands
 * on a screen that is gone or a form that was already saved without it.
 * While the lock is held, <PdfUploadBlocker /> covers the whole app.
 *
 * The axios instances in services/api.ts take the lock on their own for any
 * request whose body carries a PDF, so upload call sites need nothing. Use
 * `withPdfUploadLock` only when a flow chains more requests after the upload
 * that must also finish before the user moves on.
 *
 * Other waits the user must not walk away from (sending an email, which can
 * take a while to build and attach PDFs) hold the same lock with a title,
 * e.g. `withPdfUploadLock(() => send(), 'Sending email…')`.
 */

export interface PdfUploadLockState {
  active: boolean;
  /** Bytes sent across in-flight uploads, 0-100; null until a size is known */
  percent: number | null;
  /** Shown on the blocker in place of "Uploading PDF…"; the newest titled hold wins */
  title: string | null;
}

export interface PdfUploadHold {
  progress: (loaded: number, total?: number) => void;
  /** Safe to call more than once */
  release: () => void;
}

interface Hold {
  loaded: number;
  total: number;
  title?: string;
}

const holds = new Set<Hold>();
const listeners = new Set<() => void>();
let state: PdfUploadLockState = { active: false, percent: null, title: null };

function publish() {
  let loaded = 0;
  let total = 0;
  let title: string | null = null;
  holds.forEach(hold => {
    loaded += hold.loaded;
    total += hold.total;
    if (hold.title) title = hold.title;
  });
  const next: PdfUploadLockState = {
    active: holds.size > 0,
    percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null,
    title,
  };
  // Progress events fire many times a second; only re-render on a visible change
  if (
    next.active === state.active
    && next.percent === state.percent
    && next.title === state.title
  ) return;
  state = next;
  listeners.forEach(listener => listener());
}

export function acquirePdfUploadLock(title?: string): PdfUploadHold {
  const hold: Hold = { loaded: 0, total: 0, title };
  holds.add(hold);
  publish();
  return {
    progress: (loaded, total) => {
      if (!holds.has(hold) || !total) return;
      hold.loaded = loaded;
      hold.total = total;
      publish();
    },
    release: () => {
      if (holds.delete(hold)) publish();
    },
  };
}

export async function withPdfUploadLock<T>(task: () => Promise<T>, title?: string): Promise<T> {
  const hold = acquirePdfUploadLock(title);
  try {
    return await task();
  } finally {
    hold.release();
  }
}

export function subscribePdfUploadLock(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPdfUploadLockState(): PdfUploadLockState {
  return state;
}

function isPdf(value: unknown): boolean {
  if (typeof Blob === 'undefined' || !(value instanceof Blob)) return false;
  if (value.type === 'application/pdf') return true;
  // Some browsers leave `type` empty for files picked from certain sources
  const name = (value as Partial<File>).name;
  return typeof name === 'string' && name.toLowerCase().endsWith('.pdf');
}

/** Whether a request body sends a PDF: a multipart form with a PDF field, or a bare PDF */
export function bodyHasPdf(data: unknown): boolean {
  if (typeof FormData !== 'undefined' && data instanceof FormData) {
    for (const value of Array.from(data.values())) {
      if (isPdf(value)) return true;
    }
    return false;
  }
  return isPdf(data);
}
