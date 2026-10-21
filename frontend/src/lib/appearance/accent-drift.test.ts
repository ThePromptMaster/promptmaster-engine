import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ACCENTS, accentVariables } from './colours';

describe('project accents (14 Oct call)', () => {
  it('the database allows exactly the accents the picker offers', () => {
    const sql = readFileSync(join(__dirname, '../../../../supabase/migrations/20261107000000_project_accent.sql'), 'utf8');
    const allowed = [...(sql.match(/accent in \(([^)]*)\)/)?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(allowed).toEqual(ACCENTS.map((a) => a.id));
  });

  it('sets the accent for a project that has one, and nothing otherwise', () => {
    expect(accentVariables('teal')).toEqual({ '--pm-primary': '#00696b', '--pm-primary-container': '#0f8a8c' });
    expect(accentVariables(null)).toEqual({});
    expect(accentVariables('neon')).toEqual({});
  });
});
