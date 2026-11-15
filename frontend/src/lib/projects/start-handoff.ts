/**
 * Files attached before the start screen, handed to it once (15 Nov, Sean: an
 * attachment "doesn't cross over from the homepage … to the project"). The
 * questionnaire on the projects page and on /examples has its own attach
 * button, and its Start carried only the typed words; the files were dropped.
 *
 * Kept in this browser's IndexedDB, not sessionStorage: a File cannot be
 * written to sessionStorage, and a suggestion's Start is a full page load (so
 * the proxy sees a guest session that may have just begun), which clears
 * anything held in memory. Taken once and deleted; nothing leaves the browser.
 */

import type { PreparedFile } from '@/lib/data/attachments';

const DB = 'pm-start';
const STORE = 'handoff';
const KEY = 'files';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = act(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      })
  );
}

/** Hand files to the start screen. A browser without IndexedDB just starts without them. */
export async function handOverStartFiles(files: readonly PreparedFile[]): Promise<void> {
  if (!files.length || typeof indexedDB === 'undefined') return;
  try {
    await run('readwrite', (s) => s.put(files.map((f) => ({ file: f.file, preview: f.preview, text: f.text, textOnly: f.textOnly })), KEY));
  } catch {
    // Storage blocked (a private window): the start box simply has no files.
  }
}

/** The files handed over, once; deleted as they are read. */
export async function takeStartFiles(): Promise<PreparedFile[]> {
  if (typeof indexedDB === 'undefined') return [];
  try {
    const files = await run<PreparedFile[] | undefined>('readonly', (s) => s.get(KEY) as IDBRequest<PreparedFile[] | undefined>);
    if (!files?.length) return [];
    await run('readwrite', (s) => s.delete(KEY));
    return files.filter((f) => f && f.file instanceof Blob);
  } catch {
    return [];
  }
}
