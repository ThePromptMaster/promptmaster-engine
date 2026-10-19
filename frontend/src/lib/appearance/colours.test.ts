import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyColours,
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
    expect(parseColours(JSON.stringify({ accent: 'teal', starting: 'amber', palette: 'bright' }))).toEqual({ accent: 'teal', starting: 'amber', palette: 'bright' });
    expect(parseColours(JSON.stringify({ accent: 'neon', palette: 3 }))).toEqual(DEFAULT_COLOURS);
    expect(parseColours('{not json')).toEqual(DEFAULT_COLOURS);
    expect(parseColours(null)).toEqual(DEFAULT_COLOURS);
  });

  it('v1 takes the starting colour; later versions cycle the palette', () => {
    expect(versionColour(1)).toBe('var(--version-1)');
    expect(versionColour(2)).toBe('var(--version-2)');
    expect(versionColour(6)).toBe('var(--version-6)');
    expect(versionColour(7)).toBe('var(--version-2)');
    const vars = colourVariables({ accent: 'plum', starting: 'rose', palette: 'mono' });
    expect(vars['--pm-primary']).toBe('#6a3d9a');
    expect(vars['--version-1']).toBe('#b3264f');
    expect(Object.keys(vars).filter((k) => k.startsWith('--version-'))).toHaveLength(6);
  });

  it('applies a choice on :root, keeps it in this browser, and the defaults clear it again', () => {
    const chosen = { accent: 'forest', starting: 'green', palette: 'calm' };
    saveColours(chosen);
    expect(window.localStorage.getItem(COLOURS_KEY)).toBe(JSON.stringify(chosen));
    applyColours(loadColours());
    expect(document.documentElement.style.getPropertyValue('--pm-primary')).toBe('#2d6a35');
    applyColours(DEFAULT_COLOURS);
    expect(document.documentElement.style.getPropertyValue('--pm-primary')).toBe('');
  });
});
