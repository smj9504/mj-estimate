/**
 * IndexedDB-based upload queue for resilient file uploads.
 * Tracks upload progress so uploads can resume after interruption.
 */
import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'crew-upload-queue';
const DB_VERSION = 1;
const STORE_NAME = 'queue';

export interface QueueItem {
  fingerprint: string;   // unique ID: name_size_lastModified
  fileName: string;
  fileSize: number;
  status: 'queued' | 'uploading' | 'completed' | 'failed';
  token: string;         // upload link token
  addedAt: number;       // timestamp
  error?: string;
}

let dbInstance: IDBPDatabase | null = null;

async function getDB(): Promise<IDBPDatabase> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'fingerprint' });
        store.createIndex('status', 'status');
        store.createIndex('token', 'token');
      }
    },
  });

  return dbInstance;
}

/** Add files to the upload queue */
export async function enqueueFiles(
  files: File[],
  token: string,
  alreadyCompleted: string[] = [],
): Promise<QueueItem[]> {
  const db = await getDB();
  const items: QueueItem[] = [];

  const tx = db.transaction(STORE_NAME, 'readwrite');

  for (const file of files) {
    const fingerprint = `${file.name}_${file.size}_${file.lastModified}`;
    const status = alreadyCompleted.includes(fingerprint) ? 'completed' : 'queued';

    const item: QueueItem = {
      fingerprint,
      fileName: file.name,
      fileSize: file.size,
      status,
      token,
      addedAt: Date.now(),
    };

    await tx.store.put(item);
    items.push(item);
  }

  await tx.done;
  return items;
}

/** Mark a file as completed */
export async function markCompleted(fingerprint: string): Promise<void> {
  const db = await getDB();
  const item = await db.get(STORE_NAME, fingerprint);
  if (item) {
    item.status = 'completed';
    await db.put(STORE_NAME, item);
  }
}

/** Mark a file as failed */
export async function markFailed(fingerprint: string, error: string): Promise<void> {
  const db = await getDB();
  const item = await db.get(STORE_NAME, fingerprint);
  if (item) {
    item.status = 'failed';
    item.error = error;
    await db.put(STORE_NAME, item);
  }
}

/** Get all pending (queued + failed) items for a token */
export async function getPendingItems(token: string): Promise<QueueItem[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex(STORE_NAME, 'token', token);
  return all.filter(item => item.status === 'queued' || item.status === 'failed');
}

/** Get upload stats for a token */
export async function getQueueStats(token: string): Promise<{
  total: number;
  completed: number;
  failed: number;
  pending: number;
}> {
  const db = await getDB();
  const all = await db.getAllFromIndex(STORE_NAME, 'token', token);

  return {
    total: all.length,
    completed: all.filter(i => i.status === 'completed').length,
    failed: all.filter(i => i.status === 'failed').length,
    pending: all.filter(i => i.status === 'queued' || i.status === 'failed').length,
  };
}

/** Clear all items for a token */
export async function clearQueue(token: string): Promise<void> {
  const db = await getDB();
  const all = await db.getAllFromIndex(STORE_NAME, 'token', token);
  const tx = db.transaction(STORE_NAME, 'readwrite');
  for (const item of all) {
    await tx.store.delete(item.fingerprint);
  }
  await tx.done;
}
