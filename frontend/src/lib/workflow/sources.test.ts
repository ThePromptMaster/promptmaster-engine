import { describe, expect, it } from 'vitest';

import {
  citedNumbers,
  currentSources,
  MAX_SOURCES_SENT,
  renumberCitations,
  savedNumbers,
  sourcesCitedIn,
  sourcesForRequest,
  sourcesSection,
  withoutSourcesList,
} from './sources';
import { keepUnasked, structureDropped } from './preservation';
import { renumberResponse } from './web-found';
import type { ProjectSource } from '@/types/project';

function src(i: number, extra: Partial<ProjectSource> = {}): ProjectSource {
  return {
    id: `s${i}`, seq: 1000 + i, project_id: 'p', user_id: 'u', url: `https://example.org/${i}`, title: `Source ${i}`,
    excerpt: '', query: 'q', stage_id: null, provider: 'openrouter_web', origin: 'agent', agent_run_id: null,
    retrieved_at: '2026-10-29T10:00:00Z', retired_at: null, ...extra,
  } as ProjectSource;
}
const many = (n: number) => Array.from({ length: n }, (_, i) => src(i + 1));

describe('saved sources past forty (31 Oct, Sean: S41–S45 cited, S1–S40 listed)', () => {
  it('the panel lists every current source', () => {
    expect(currentSources(many(45))).toHaveLength(45);
    expect(currentSources([src(1), src(2, { retired_at: '2026-10-30' })])).toHaveLength(1);
  });

  it('sends all of a small project, numbered by position', () => {
    expect(sourcesForRequest(many(3)).map((s) => s.n)).toEqual([1, 2, 3]);
  });

  it('past forty sends what the text cites, then the newest, each with its true number', () => {
    const sent = sourcesForRequest(many(60), 'As shown [S3] and [S12], and [S99].');
    expect(sent).toHaveLength(MAX_SOURCES_SENT);
    const ns = sent.map((s) => s.n);
    expect(ns).toContain(3);
    expect(ns).toContain(12);
    expect(ns).toContain(60); // the newest, so new finds follow it
    expect(ns).toEqual([...ns].sort((a, b) => a - b));
    expect(sent.find((s) => s.n === 12)?.url).toBe('https://example.org/12');
  });

  it('always sends the newest even when the text cites more than forty', () => {
    const citing = Array.from({ length: 50 }, (_, i) => `[S${i + 1}]`).join(' ');
    const ns = sourcesForRequest(many(60), citing).map((s) => s.n);
    expect(ns).toHaveLength(MAX_SOURCES_SENT);
    expect(ns).toContain(60);
  });

  it('cites in order of first citation', () => {
    expect(citedNumbers('[S4] then [S2] then [S4]')).toEqual([4, 2]);
  });
});

describe('a search numbered as saved', () => {
  it('a find the project already held keeps its number; the ones after move up', () => {
    const before = many(45);
    // The backend called these S46, S47, S48; /10 was already saved as S10.
    const found = [{ url: 'https://example.org/new-a' }, { url: 'https://example.org/10' }, { url: 'https://example.org/new-b' }];
    const saved = [src(46, { url: 'https://example.org/new-a' }), src(47, { url: 'https://example.org/new-b' })];
    const map = savedNumbers(before, found, saved);
    expect([...map]).toEqual([[47, 10], [48, 47]]);
    expect(renumberCitations('A [S46], B [S47], C [S48], D [S5].', map)).toBe('A [S46], B [S10], C [S47], D [S5].');
  });

  it('swaps in one pass', () => {
    expect(renumberCitations('[S41] [S43]', new Map([[41, 43], [43, 41]]))).toBe('[S43] [S41]');
  });

  it('renumbers every text in a response, not its search fields', () => {
    const res = { content: 'x [S41]', items: [{ note: 'y [S41]' }], iteration: { output: 'z [S41]' }, web_query: '[S41]' };
    renumberResponse(res, new Map([[41, 7]]));
    expect(res).toEqual({ content: 'x [S7]', items: [{ note: 'y [S7]' }], iteration: { output: 'z [S7]' }, web_query: '[S41]' });
  });
});

const BOOK = `## Chapter 3

Illinois earned an upgrade [S40].

## Sources

| # | Source | Retrieved |
|---|---|---|
| S39 | Pension report | 2026-10-28 |
| S40 | Illinois Earns Credit Rating Upgrad`;

describe('withoutSourcesList (31 Oct, Sean: a 40-row table, more than once)', () => {
  it('drops a sources table the model wrote', () => {
    expect(withoutSourcesList(BOOK)).toBe('## Chapter 3\n\nIllinois earned an upgrade [S40].');
  });

  it('drops every repeated list, in lists and bold headings too', () => {
    const text = `Intro [S1].\n\n**Sources:**\n- [S1] A — https://a.org\n\n## Chapter 2\n\nMore [S2].\n\n---\n\n### References\n1. [S2] B — https://b.org\n2. [S1] A`;
    expect(withoutSourcesList(text)).toBe('Intro [S1].\n\n## Chapter 2\n\nMore [S2].');
  });

  it('leaves a list with anything else in it, and text with no list', () => {
    const mine = `Body.\n\n## References\n- Smith, J. (2020). A book.\n- [S1] A`;
    expect(withoutSourcesList(mine)).toBe(mine);
    expect(withoutSourcesList('No sources here.')).toBe('No sources here.');
    const notAList = `## Sources of growth\n\nExports [S1] rose.`;
    expect(withoutSourcesList(notAList)).toBe(notAList);
  });

  it('a repair is not told it dropped the Sources heading, nor given its rows back', () => {
    const after = '## Chapter 3\n\nIllinois earned an upgrade in 2025 [S40].';
    expect(structureDropped(BOOK, after)).toEqual([]);
    expect(keepUnasked(BOOK, after, 'Tighten the prose.').text).not.toMatch(/\| S39/);
  });
});

describe('the sources a text cites, as PromptMaster lists them', () => {
  it('in number order, unknown numbers left out', () => {
    const cited = sourcesCitedIn('B [S2], A [S1], ghost [S9]', many(3));
    expect(cited.map((c) => c.n)).toEqual([1, 2]);
    expect(sourcesSection('B [S2]', many(3))).toBe('## Sources\n\n- [S2] Source 2 — https://example.org/2 (retrieved 2026-10-29)\n');
    expect(sourcesSection('nothing', many(3))).toBe('');
  });
});
