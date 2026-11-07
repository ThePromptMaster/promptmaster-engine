import { afterEach, describe, expect, it } from 'vitest';

import { cleanText } from './read-file';
import {
  MAX_HELD,
  MAX_TICKED,
  itemKey,
  mergeThirdParty,
  rememberStartItems,
  takeStartItems,
  titlesOnly,
  rememberReturn,
  relatedTo,
  shortWhen,
  takeReturn,
  toPicked,
  toSharedItems,
  toThirdParty,
  type ConnectedText,
  type PreviewItem,
} from './items';

function preview(over: Partial<PreviewItem>): PreviewItem {
  return { id: 'x', toolkit: 'gmail', kind: 'email', title: '', when: '', who: '', people: [], detail: '', ref: {}, readable: true, note: '', ...over };
}

const MEETING = preview({
  id: 'e1',
  toolkit: 'googlecalendar',
  kind: 'calendar_event',
  title: 'Cascadia renewal pricing',
  who: 'Dana Whitfield <dana@northwind.example>',
  people: ['dana@northwind.example', 'me@example.com', 'lee@cascadia.example'],
});

describe('connected items', () => {
  afterEach(() => sessionStorage.clear());

  it('sends exactly what was shown, and nothing else on the item', () => {
    const shown: ConnectedText = { id: 'm1', toolkit: 'gmail', kind: 'email', source: 'Gmail · Dana', title: 'Board pack', text: 'Edited by me.' };
    expect(toThirdParty([shown])).toEqual([{ kind: 'email', source: 'Gmail · Dana', title: 'Board pack', text: 'Edited by me.' }]);
    expect(toSharedItems([shown])).toEqual(toThirdParty([shown]));
  });

  it('asks for a read with only what the read needs', () => {
    expect(toPicked(preview({ id: 'f1', toolkit: 'googledrive', kind: 'file', title: 'Plan', who: 'Me', ref: { mime: 'text/plain' } }))).toEqual({
      id: 'f1',
      toolkit: 'googledrive',
      kind: 'file',
      title: 'Plan',
      ref: { mime: 'text/plain' },
    });
  });

  it('keys items by account, since ids repeat across accounts', () => {
    expect(itemKey({ toolkit: 'gmail', id: '1' })).not.toBe(itemKey({ toolkit: 'outlook', id: '1' }));
  });

  it('finds the emails around a meeting: from someone invited, or sharing its title', () => {
    const items = [
      preview({ id: 'a', who: 'Lee <lee@cascadia.example>', title: 'Pricing quote attached' }),
      preview({ id: 'b', who: 'Someone <x@else.example>', title: 'Re: Cascadia renewal terms' }),
      preview({ id: 'c', who: 'Me <me@example.com>', title: 'Lunch?' }),
      preview({ id: 'd', who: 'Newsletter <n@news.example>', title: 'Pricing tips' }),
      MEETING,
    ];
    expect(relatedTo(MEETING, items, 'me@example.com').map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('never links on the mailbox owner, even when they signed in with another address', () => {
    const meeting = preview({ kind: 'calendar_event', toolkit: 'googlecalendar', title: 'Q3 board meeting', people: ['dana@northwind.example', 'work@me.example'] });
    const items = [
      preview({ id: 'board', who: 'Dana <dana@northwind.example>', title: 'Board pack', people: ['work@me.example'] }),
      preview({ id: 'supplier', who: 'Desk <desk@supply.example>', title: 'Updated price list', people: ['work@me.example'] }),
      preview({ id: 'other', who: 'Sam <sam@x.example>', title: 'Lunch', people: ['work@me.example'] }),
    ];
    expect(relatedTo(meeting, items, 'personal@gmail.example').map((i) => i.id)).toEqual(['board']);
  });

  it('does not tick mail on an address alone: it may be the person’s own other address', () => {
    // 7 Nov, production: a meeting organised from the person's personal address pre-ticked
    // their unrelated personal mail, because that address was "invited".
    const meeting = preview({ kind: 'calendar_event', toolkit: 'googlecalendar', title: 'Supplier pricing review', who: 'me.personal@gmail.example', people: ['me@work.example'] });
    const items = [
      preview({ id: 'about', who: 'Me <me.personal@gmail.example>', title: 'Supplier pricing notes', people: ['me@work.example'] }),
      preview({ id: 'unrelated', who: 'Me <me.personal@gmail.example>', title: 'Visa paperwork', people: ['me@work.example'] }),
    ];
    expect(relatedTo(meeting, items, 'me@work.example').map((i) => i.id)).toEqual(['about']);
  });

  it('leaves room for the meeting itself under the limit', () => {
    const many = Array.from({ length: 40 }, (_, i) => preview({ id: `m${i}`, who: 'dana@northwind.example', title: 'Cascadia renewal' }));
    expect(relatedTo(MEETING, many)).toHaveLength(MAX_TICKED - 1);
  });

  it('returns only to a page on this site', () => {
    rememberReturn('https://evil.example/');
    expect(takeReturn()).toBe('/projects/settings');
    rememberReturn('//evil.example/x');
    expect(takeReturn()).toBe('/projects/settings');
    rememberReturn('/projects/from-accounts?for=briefing');
    expect(takeReturn()).toBe('/projects/from-accounts?for=briefing');
    // Taken once.
    expect(takeReturn()).toBe('/projects/settings');
  });

  it('shows dates in the reader’s language and leaves anything else alone', () => {
    expect(shortWhen('2026-11-10', 'en')).toMatch(/10 Nov|Nov 10/);
    expect(shortWhen('not a date', 'en')).toBe('not a date');
    expect(shortWhen('', 'en')).toBe('');
  });
});

describe('cleaning a file read in the browser', () => {
  it('removes what a screen does not draw, and links', () => {
    expect(cleanText('a​b‮c see https://evil.example/x and www.x.example')).toBe('abc see [link removed] and [link removed]');
  });

  it('caps the text and says so, within the cap', () => {
    const long = cleanText('word '.repeat(5000));
    expect(long.length).toBeLessThanOrEqual(8000);
    expect(long.endsWith('allows]')).toBe(true);
  });
});

describe('what a project holds from the accounts (7 Nov)', () => {
  const a = { kind: 'email' as const, source: 'Gmail · Dana', title: 'Pricing', text: 'One.' };
  const b = { kind: 'file' as const, source: 'Drive', title: 'Plan', text: 'Two.', when: '2026-11-03' };

  it('adds in order, once each, and never past the limit', () => {
    expect(mergeThirdParty([a], [a, b])).toEqual({ items: [a, b], left: [] });
    const many = Array.from({ length: MAX_HELD }, (_x, i) => ({ ...a, title: `t${i}` }));
    expect(mergeThirdParty(many, [b])).toEqual({ items: many, left: [b] });
  });

  it('keeps when it was sent, and the start conversation gets titles only', () => {
    expect(toThirdParty([{ id: '1', toolkit: 'googledrive', kind: 'file', source: 'Drive', title: 'Plan', text: 'Two.', when: '2026-11-03' }])).toEqual([b]);
    expect(titlesOnly([a, b])).toEqual([
      { kind: 'email', source: '', title: 'Pricing', text: '' },
      { kind: 'file', source: '', title: 'Plan', text: '', when: '2026-11-03' },
    ]);
  });

  it('hands the start screen what "Start this" carried, once, and only items', () => {
    sessionStorage.clear();
    rememberStartItems([a, b]);
    expect(takeStartItems()).toEqual([a, b]);
    expect(takeStartItems()).toEqual([]);
    sessionStorage.setItem('pm.start.items', JSON.stringify([a, { kind: 'script', title: 'x', text: 'y', source: '' }, 'junk']));
    expect(takeStartItems()).toEqual([a]);
    sessionStorage.setItem('pm.start.items', '{not json');
    expect(takeStartItems()).toEqual([]);
  });
});
