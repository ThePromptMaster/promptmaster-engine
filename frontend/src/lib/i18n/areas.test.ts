import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { en as base } from './messages/en';

/**
 * The area dictionaries are spread into one per language, and a spread lets a
 * later key silently replace an earlier one. Every key is owned by one place.
 */
describe('message areas', () => {
  it('never share a key with each other or with the base dictionary', async () => {
    const dir = join(__dirname, 'messages', 'areas');
    const owner = new Map<string, string>();
    const source = readFileSync(join(__dirname, 'messages', 'en.ts'), 'utf8');
    const own = source.slice(source.indexOf('export const en = {'));
    for (const m of own.matchAll(/^\s+["']([^"']+)["']:/gm)) owner.set(m[1], 'en.ts');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      const mod = (await import(`./messages/areas/${file.replace(/\.ts$/, '')}`)) as { en: Record<string, string> };
      for (const key of Object.keys(mod.en)) {
        expect(owner.get(key), `${key} in ${file}`).toBeUndefined();
        owner.set(key, file);
      }
    }
    expect(owner.size).toBe(Object.keys(base).length);
  });
});
