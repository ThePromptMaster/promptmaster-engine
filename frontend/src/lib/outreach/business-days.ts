/** A follow-up's time: so many business days later, Saturday and Sunday skipped in the user's time zone (27 Nov). */
const DAY_MS = 86_400_000;
const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function weekdayIn(d: Date, timeZone: string): number {
  try {
    return NAMES.indexOf(new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone }).format(d));
  } catch {
    return d.getUTCDay();
  }
}

export function addBusinessDays(from: Date, days: number, timeZone = 'UTC'): Date {
  let at = from.getTime();
  let left = Math.max(0, Math.round(days));
  while (left > 0) {
    at += DAY_MS;
    const wd = weekdayIn(new Date(at), timeZone);
    if (wd !== 0 && wd !== 6) left -= 1;
  }
  return new Date(at);
}
