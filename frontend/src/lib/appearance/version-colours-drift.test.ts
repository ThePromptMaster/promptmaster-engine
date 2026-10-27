import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { backgroundOfVersion, BACKGROUND_VARIABLES, colourOfVersion, VERSION_SWATCHES, versionTintVariables } from './colours';

describe('a version\'s own colour (Sean, 25 Oct, email 4)', () => {
  const sql = readFileSync(join(__dirname, '../../../../supabase/migrations/20261119000000_version_colour_choice.sql'), 'utf8');
  const bgSql = readFileSync(join(__dirname, '../../../../supabase/migrations/20261120000000_version_background_colour.sql'), 'utf8');

  it('the database allows exactly the colours the picker offers', () => {
    const allowed = [...(sql.match(/colour in \(([^)]*)\)/)?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(allowed).toEqual(VERSION_SWATCHES.map((s) => s.id));
  });

  it('the database allows exactly the same colours for the background', () => {
    const allowed = [...(bgSql.match(/background_colour in \(([^)]*)\)/)?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(allowed).toEqual(VERSION_SWATCHES.map((s) => s.id));
  });

  it('the trigger lets the two colours change and nothing else beside the rating', () => {
    expect(bgSql).toMatch(
      /to_jsonb\(new\) - 'user_rating' - 'colour' - 'background_colour'\s+is distinct from to_jsonb\(old\) - 'user_rating' - 'colour' - 'background_colour'/
    );
  });

  it('the background is the one chosen, or else the button colour (Sean, 26 Oct)', () => {
    expect(backgroundOfVersion(3, 'grey/calm', 'gold', 'navy')).toBe('#1e3a8a');
    expect(backgroundOfVersion(3, 'grey/calm', 'gold', null)).toBe('#f2a900');
    expect(backgroundOfVersion(3, 'grey/calm', null, 'neon')).toBe('#0f8a8c');
  });

  it('a chosen colour wins over the one the version was made with; an unknown one is ignored', () => {
    expect(colourOfVersion(3, 'grey/calm', 'gold')).toBe('#f2a900');
    expect(colourOfVersion(3, 'grey/calm', null)).toBe('#0f8a8c');
    expect(colourOfVersion(3, 'grey/calm', 'neon')).toBe('#0f8a8c');
  });

  it('tints every surface from what :root has, the page more than the cards', () => {
    const base = Object.fromEntries(BACKGROUND_VARIABLES.map((n) => [n, '#ffffff']));
    const tint = versionTintVariables('#2563eb', base);
    expect(Object.keys(tint)).toEqual([...BACKGROUND_VARIABLES]);
    const pct = (n: string) => Number(tint[n].match(/ (\d+)%/)![1]);
    expect(tint['--background']).toBe('color-mix(in srgb, #2563eb 10%, #ffffff)');
    expect(pct('--card')).toBeLessThan(pct('--background'));
    expect(pct('--surface-container-low')).toBeLessThan(pct('--surface-container-high'));
    expect(pct('--surface-container-high')).toBeLessThan(pct('--surface-container-highest'));
  });

  it('leaves a surface :root does not define alone', () => {
    expect(versionTintVariables('#2563eb', { '--surface': ' #fafafa ' })).toEqual({ '--surface': 'color-mix(in srgb, #2563eb 10%, #fafafa)' });
  });
});
