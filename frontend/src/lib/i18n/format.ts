import type { Locale } from './locales';
import { translate } from './translate';

/** "5 min ago", "il y a 3 h", "hace 2 días" — or a short date past a month. */
export function relativeTime(iso: string, locale: Locale, now: number = Date.now()): string {
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return translate(locale, 'time.justNow');
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always', style: 'short' });
  if (mins < 60) return rtf.format(-mins, 'minute');
  const hours = Math.round(mins / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  if (days < 30) return rtf.format(-days, 'day');
  return new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

/** A number as the language writes it: 1,234.5 / 1.234,5 / 1 234,5. */
export function formatNumber(n: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(n);
}
