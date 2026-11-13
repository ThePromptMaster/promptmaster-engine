/**
 * The database's time, as near as this device can tell it (13 Nov).
 *
 * A step's start is stamped by the database and its finish used to be stamped
 * by the browser. On a device whose clock ran 31 seconds fast, a routine
 * approval refused before a repair carried a finish time later than the
 * repaired version, so it read as a refusal of that version and the repaired
 * work was never checked again: the user was asked instead. Whatever is
 * compared with a time the database wrote has to be on the database's clock.
 *
 * The difference is measured whenever a row comes back with a time the
 * database has just stamped, and applied to the times this device writes.
 */

let offsetMs = 0;

/** A time the database stamped a moment ago, and when this device sent and received the request. */
export function noteServerTime(serverIso: string | null | undefined, sentMs: number, receivedMs: number): void {
  const server = Date.parse(serverIso ?? '');
  if (Number.isNaN(server)) return;
  // The database stamped it somewhere between sending and receiving: take the middle.
  offsetMs = server - (sentMs + receivedMs) / 2;
}

/** Now, on the database's clock. */
export function serverNow(localMs: number = Date.now()): string {
  return new Date(localMs + offsetMs).toISOString();
}

/** For tests. */
export function resetServerClock(): void {
  offsetMs = 0;
}
