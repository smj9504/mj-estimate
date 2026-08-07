/**
 * Persists photo files that failed to upload (after in-flight retries were
 * exhausted) so they survive a page reload, tab close, or navigation instead
 * of being lost from memory - the previous behavior when a field worker's
 * connection dropped mid-upload.
 */

const DB_NAME = 'mj-pending-uploads';
const DB_VERSION = 1;
const STORE_NAME = 'photos';

export interface PendingUploadRecord {
  id: string;
  jobId: string;
  category?: string;
  fileName: string;
  fileType: string;
  blob: Blob;
  addedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('jobId', 'jobId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function addPendingUpload(jobId: string, file: File, category?: string): Promise<void> {
  const db = await openDb();
  try {
    const record: PendingUploadRecord = {
      id: `${jobId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      jobId,
      category,
      fileName: file.name,
      fileType: file.type,
      blob: file,
      addedAt: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function getPendingUploads(jobId: string): Promise<PendingUploadRecord[]> {
  const db = await openDb();
  try {
    return await new Promise<PendingUploadRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const index = tx.objectStore(STORE_NAME).index('jobId');
      const request = index.getAll(jobId);
      request.onsuccess = () => resolve(request.result as PendingUploadRecord[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function removePendingUpload(id: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function pendingUploadToFile(record: PendingUploadRecord): File {
  return new File([record.blob], record.fileName, { type: record.fileType });
}
