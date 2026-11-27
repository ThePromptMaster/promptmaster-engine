/**
 * A send's reason, as the reader sees it. The job runner writes its reasons on the server, where
 * the reader's clock and locale are unknown, so a time in one is written as an ISO instant; this
 * shows each in the reader's own local format.
 */
const INSTANT = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z\b/g;

export function localTimes(reason: string, format: (d: Date) => string = (d) => d.toLocaleString()): string {
  return reason.replace(INSTANT, (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : format(d);
  });
}

/** A scheduled send the runner is holding back for now (Pause all, today's limit). */
export function isWaiting(reason: string): boolean {
  return reason.startsWith('Waiting:');
}
