import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANGUAGES, resolveLanguage } from './languages';

const PY = readFileSync(join(process.cwd(), '..', 'backend', 'promptmaster', 'language.py'), 'utf8');

describe('the offered languages', () => {
  it('match the backend list exactly', () => {
    const py = [...PY.matchAll(/^\s+"([a-z]{2}(?:-[a-z]+)?)": \("([^"]+)", "([^"]+)"\),$/gm)].map((m) => ({ code: m[1], name: m[2], own: m[3] }));
    expect(py).toEqual(LANGUAGES.map((l) => ({ ...l })));
  });

  it('read anything unknown as English', () => {
    expect(resolveLanguage('es-MX')).toBe('es');
    expect(resolveLanguage('ja')).toBe('en');
    expect(resolveLanguage(undefined)).toBe('en');
    // African American English was withdrawn on 27 Oct (L-110): a project saved with it writes in English.
    expect(resolveLanguage('en-aave')).toBe('en');
    expect(resolveLanguage('en-GB')).toBe('en');
    expect(resolveLanguage('zh-CN')).toBe('zh');
  });
});
