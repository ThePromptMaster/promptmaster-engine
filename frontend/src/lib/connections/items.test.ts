import { afterEach, describe, expect, it } from 'vitest';

import { cleanText } from './read-file';
import {
  MAX_HELD,
  itemKey,
  mergeThirdParty,
  rememberStartItems,
  takeStartItems,
  toolkitFromSource,
  toolkitLogoUrl,
  titlesOnly,
  rememberReturn,
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

describe('which account an item came from', () => {
  it('reads it off the source line the backend writes', () => {
    expect(toolkitFromSource('Gmail · Dana Whitfield <dana@example.com> · 6 Nov 2026')).toBe('gmail');
    expect(toolkitFromSource('Google Calendar · 10 Nov 2026, 14:00')).toBe('googlecalendar');
    expect(toolkitFromSource('Google Drive')).toBe('googledrive');
    expect(toolkitFromSource('Outlook calendar · 12 Nov 2026')).toBe('outlook');
    expect(toolkitFromSource('OneDrive')).toBe('one_drive');
  });

  it('says nothing when the line names no account', () => {
    expect(toolkitFromSource('')).toBeNull();
    expect(toolkitFromSource(undefined)).toBeNull();
    expect(toolkitFromSource('Gmailer · someone')).toBeNull();
  });

  it('points each logo at Composio', () => {
    expect(toolkitLogoUrl('googledrive')).toBe('https://logos.composio.dev/api/googledrive');
  });
});
