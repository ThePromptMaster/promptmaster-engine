/**
 * When this viewer last had a project open, in this browser (26 Nov, L-290).
 *
 * A per-viewer convenience: it says where "since your last visit" starts, and
 * nothing depends on it. In browser storage, wrapped, so a blocked or empty
 * store means no "since your last visit", never an error.
 */
const key = (projectId: string) => `pm.seen.${projectId}`;

export function readLastSeen(projectId: string): string | null {
  try {
    const at = window.localStorage.getItem(key(projectId));
    return at && !Number.isNaN(Date.parse(at)) ? at : null;
  } catch {
    return null;
  }
}

export function writeLastSeen(projectId: string, at = new Date().toISOString()): void {
  try {
    window.localStorage.setItem(key(projectId), at);
  } catch {
    // Storage blocked: the next visit shows no summary.
  }
}
