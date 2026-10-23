import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyColours,
  backgroundVariables,
  BACKGROUNDS,
  colourVariables,
  COLOURS_KEY,
  DEFAULT_COLOURS,
  loadColours,
  parseColours,
  saveColours,
  versionColour,
} from './colours';

describe('the user\'s colours (Sean, 18 Oct)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('style');
  });

  it('reads what was stored, and falls back to the defaults for anything unknown or damaged', () => {
    expect(parseColours(JSON.stringify({ accent: 'teal', starting: 'amber', palette: 'bright', background: 'pink' }))).toEqual({ accent: 'teal', starting: 'amber', palette: 'bright', background: 'pink' });
    // Saved before there was a background choice: the default background.
    expect(parseColours(JSON.stringify({ accent: 'teal', starting: 'amber', palette: 'bright' })).background).toBe('default');
    expect(parseColours(JSON.stringify({ accent: 'neon', palette: 3 }))).toEqual(DEFAULT_COLOURS);
    expect(parseColours('{not json')).toEqual(DEFAULT_COLOURS);
    expect(parseColours(null)).toEqual(DEFAULT_COLOURS);
  });

  it('v1 takes the starting colour; later versions cycle the palette', () => {
    expect(versionColour(1)).toBe('var(--version-1)');
    expect(versionColour(2)).toBe('var(--version-2)');
    expect(versionColour(6)).toBe('var(--version-6)');
    expect(versionColour(7)).toBe('var(--version-2)');
    const vars = colourVariables({ accent: 'plum', starting: 'rose', palette: 'mono', background: 'default' });
    expect(vars['--pm-primary']).toBe('#6a3d9a');
    expect(vars['--version-1']).toBe('#b3264f');
    expect(Object.keys(vars).filter((k) => k.startsWith('--version-'))).toHaveLength(6);
  });

  it('applies a choice on :root, keeps it in this browser, and the defaults clear it again', () => {
    const chosen = { accent: 'forest', starting: 'green', palette: 'calm', background: 'default' };
    saveColours(chosen);
    expect(window.localStorage.getItem(COLOURS_KEY)).toBe(JSON.stringify(chosen));
    applyColours(loadColours());
    expect(document.documentElement.style.getPropertyValue('--pm-primary')).toBe('#2d6a35');
    applyColours(DEFAULT_COLOURS);
    expect(document.documentElement.style.getPropertyValue('--pm-primary')).toBe('');
  });

  it('a pink background tints every surface, and the default clears it (Sean, 21 Oct)', () => {
    applyColours({ ...DEFAULT_COLOURS, background: 'pink' });
    const style = document.documentElement.style;
    const pink = BACKGROUNDS.find((b) => b.id === 'pink')!.ramp!;
    expect(style.getPropertyValue('--surface')).toBe(pink.base);
    expect(style.getPropertyValue('--surface-container-lowest')).toBe(pink.lowest);
    expect(style.getPropertyValue('--background')).toBe(pink.base);
    // The accent stays the stylesheet's own: only the background was chosen.
    expect(style.getPropertyValue('--pm-primary')).toBe('');
    applyColours(DEFAULT_COLOURS);
    expect(style.getPropertyValue('--surface')).toBe('');
    expect(style.getPropertyValue('--surface-container-lowest')).toBe('');
  });

  it('every tint keeps the tonal order, lightest card to darkest dim', () => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const b of BACKGROUNDS.filter((x) => x.ramp)) {
      const r = b.ramp!;
      const order = [r.lowest, r.base, r.low, r.container, r.high, r.highest, r.dim].map(lum);
      expect(order, b.id).toEqual([...order].sort((x, y) => y - x));
      expect(Object.keys(backgroundVariables(b.id)).length).toBeGreaterThan(10);
    }
    expect(backgroundVariables('default')).toEqual({});
  });
});
