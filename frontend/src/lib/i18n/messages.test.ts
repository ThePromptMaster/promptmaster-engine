import { describe, expect, it } from 'vitest';

import { LOCALES, resolveLocale, localeFromCookie } from './locales';
import { en } from './messages/en';
import { DICTIONARIES, placeholders, translate } from './translate';
import { relativeTime } from './format';

/**
 * Every language has every message, with the same blanks to fill (client,
 * 21 Oct: "pick your language"). A missing key is already a type error; these
 * catch what the type cannot: an empty string, a dropped `{name}`, half a
 * plural pair.
 */
describe('the dictionaries', () => {
  const keys = Object.keys(en).sort();

  it.each(LOCALES.map((l) => l.code))('%s has exactly the English keys, none empty', (code) => {
    const dict = DICTIONARIES[code] as Record<string, string>;
    expect(Object.keys(dict).sort()).toEqual(keys);
    for (const k of keys) expect(dict[k].trim(), `${code} ${k}`).not.toBe('');
  });

  it.each(LOCALES.map((l) => l.code))('%s keeps every {placeholder}', (code) => {
    const dict = DICTIONARIES[code] as Record<string, string>;
    for (const k of keys) {
      expect(placeholders(dict[k]), `${code} ${k}`).toEqual(placeholders((en as Record<string, string>)[k]));
    }
  });

  it('pairs every plural', () => {
    for (const k of keys) {
      if (k.endsWith('_one')) expect(keys, k).toContain(k.replace(/_one$/, '_other'));
      if (k.endsWith('_other')) expect(keys, k).toContain(k.replace(/_other$/, '_one'));
    }
  });
});

describe('translate', () => {
  it('fills the blanks and falls back to English', () => {
    expect(translate('es', 'colours.swatch.accent', { name: 'Teal' })).toBe('Color principal: Teal');
    expect(translate('fr', 'header.signOut')).toBe('Se déconnecter');
    expect(translate('es', 'no.such.key')).toBe('no.such.key');
  });

  it('reads a locale from a browser or cookie value', () => {
    expect(resolveLocale('pt-BR')).toBe('pt');
    expect(resolveLocale('de')).toBe('en');
    expect(localeFromCookie(undefined)).toBeNull();
    expect(localeFromCookie('fr')).toBe('fr');
  });

  it('writes relative times in the language', () => {
    const now = Date.parse('2026-10-23T12:00:00Z');
    expect(relativeTime('2026-10-23T11:59:50Z', 'es', now)).toBe('ahora mismo');
    expect(relativeTime('2026-10-23T09:00:00Z', 'es', now)).toMatch(/hace\s3\sh/);
    expect(relativeTime('2026-10-21T12:00:00Z', 'fr', now)).toMatch(/il\sy\sa\s2\sj/);
  });
});
