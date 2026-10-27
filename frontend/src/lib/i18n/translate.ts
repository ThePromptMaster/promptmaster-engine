import { en, type MessageKey, type Messages } from './messages/en';
import { es } from './messages/es';
import { fr } from './messages/fr';
import { pt } from './messages/pt';
import { hi } from './messages/hi';
import { zh } from './messages/zh';
import { ar } from './messages/ar';
import { sw } from './messages/sw';
import { aave } from './messages/en-aave';
import type { Locale } from './locales';

export const DICTIONARIES: Record<Locale, Messages> = { en, es, fr, pt, hi, zh, ar, sw, 'en-aave': aave };

export type Vars = Record<string, string | number>;

/** The plural form's key for `count`, when the dictionary has one (`key_one`, `key_other`). */
function pluralKey(locale: Locale, key: string, count: number): string {
  const form = new Intl.PluralRules(locale).select(count);
  const exact = `${key}_${form}`;
  if (exact in en) return exact;
  return `${key}_other` in en ? `${key}_other` : key;
}

/**
 * The words for `key` in `locale`, with `{name}` filled from `vars`. A key
 * with `_one` / `_other` forms is chosen by `vars.count`. Anything missing
 * falls back to English, and an unknown key comes back as itself — visible,
 * never blank.
 */
export function translate(locale: Locale, key: MessageKey | string, vars?: Vars): string {
  const k = vars && typeof vars.count === 'number' && !(key in en) ? pluralKey(locale, key, vars.count) : key;
  const dict = DICTIONARIES[locale] as Record<string, string>;
  const text = dict[k] || (en as Record<string, string>)[k] || k;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** The `{placeholders}` a message uses, for the parity test. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}
