import { describe, expect, it } from 'vitest';

import { linksIn, sourceAccessNote } from './links';

describe('linksIn', () => {
  it("finds a linked Instagram account (Neil's cookbook, 18 Oct)", () => {
    const found = linksIn('Turn the recipes at https://www.instagram.com/somecook/ into a cookbook, one page each.');
    expect(found.urls).toEqual(['https://www.instagram.com/somecook/']);
    expect(found.video).toBe(true);
  });

  it('counts a named platform without a link', () => {
    expect(linksIn('Make a cookbook from the recipes in an Instagram account, with a QR code to each video').video).toBe(true);
  });

  it('finds a bare www address and is not fooled by trailing punctuation', () => {
    expect(linksIn('Summarise www.example.org/report.').urls).toEqual(['www.example.org/report']);
    expect(linksIn('See (https://example.com/a).').urls).toEqual(['https://example.com/a']);
  });

  it('says nothing for plain text', () => {
    expect(linksIn('Write a memo on Q3 revenue for the board')).toEqual({ urls: [], video: false });
    expect(sourceAccessNote('Write a memo on Q3 revenue for the board')).toBeNull();
  });
});

describe('sourceAccessNote', () => {
  it('names videos when a video platform is involved', () => {
    expect(sourceAccessNote('Use the videos at youtu.be/abc and https://youtu.be/abc')).toMatch(/can't open links or watch videos/);
  });

  it('names links only for an ordinary web page', () => {
    const note = sourceAccessNote('Summarise https://example.com/annual-report');
    expect(note).toMatch(/can't open links\. Paste the text/);
    expect(note).not.toMatch(/videos/);
  });
});
