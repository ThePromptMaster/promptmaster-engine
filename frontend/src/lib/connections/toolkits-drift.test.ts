/**
 * The connected accounts are listed twice: here for the settings page and the
 * logos, in backend/promptmaster/connections.py for linking and reading. An
 * account the page offers that the backend refuses is a dead button; a kind of
 * item the backend returns that the browser does not know is dropped without a
 * word (`isItem`). So the two lists, and the kinds, are compared.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { KINDS, TOOLKITS } from './items';
import { en } from '@/lib/i18n/messages/areas/conn';

const backend = (file: string) => readFileSync(join(process.cwd(), '..', 'backend', 'promptmaster', file), 'utf8');
const CONNECTIONS = backend('connections.py');

/** `GMAIL = "gmail"` and the rest: the constants the registry is keyed by. */
function slugConstants(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of CONNECTIONS.matchAll(/^([A-Z_]+) = "([a-z_]+)"$/gm)) out[m[1]] = m[2];
  return out;
}

function pythonToolkits(): { slug: string; label: string; reads: string }[] {
  const slugs = slugConstants();
  const block = /TOOLKITS: dict\[str, Toolkit\] = \{([\s\S]*?)\n\}/.exec(CONNECTIONS)?.[1] ?? '';
  return [...block.matchAll(/^\s+([A-Z_]+): Toolkit\(\1, "([^"]+)", "([^"]+)"\),$/gm)].map((m) => ({ slug: slugs[m[1]], label: m[2], reads: m[3] }));
}

function literal(source: string, pattern: RegExp): string[] {
  return [...(pattern.exec(source)?.[1] ?? '').matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

describe('connected accounts: the browser and the backend list the same ones', () => {
  it('parses the Python registry', () => {
    expect(pythonToolkits().length).toBeGreaterThanOrEqual(7);
    expect(pythonToolkits().every((t) => t.slug && t.label)).toBe(true);
  });

  it('has the same accounts, in the same order, under the same names', () => {
    expect(TOOLKITS.map(({ slug, label }) => ({ slug, label }))).toEqual(pythonToolkits().map(({ slug, label }) => ({ slug, label })));
  });

  it('says on screen what the backend says each one reads', () => {
    const words = en as Record<string, string>;
    for (const t of pythonToolkits()) expect(words[`conn.reads.${t.slug}`]).toBe(t.reads);
  });

  it('knows every kind of item the backend can return, and a project can hold', () => {
    const read = literal(CONNECTIONS, /^Kind = Literal\[([^\]]+)\]/m);
    const held = literal(backend('schemas.py'), /class ThirdPartyItem\(BaseModel\):[\s\S]*?kind: Literal\[([^\]]+)\]/);
    expect(read.length).toBeGreaterThanOrEqual(4);
    expect([...KINDS].sort()).toEqual([...read].sort());
    expect([...held].sort()).toEqual([...read].sort());
  });
});
