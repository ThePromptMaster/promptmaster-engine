import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { factValues, leftoverMentions, namedLeftovers } from './fact-values';
import { replacedClause, scopeOf, supersededFactValues } from './facts';
import type { ProjectFact } from '@/types/project';


/**
 * Sean, 27 Nov, Calder finalist handoff (L-318): "This supersedes CAL-01 for Alex
 * Rivera only." Go's two repairs of Draft records were refused for "still giving 01"
 * in Morgan Lee's CAL-01 instructions and the FIRM-01 template heading. The draft is
 * his version 4, as saved.
 */
const DRAFT = readFileSync('src/lib/workflow/__fixtures__/calder-draft-records-v4.md', 'utf8');

function fact(statement: string, over: Partial<ProjectFact> = {}): ProjectFact {
  return { id: `f${statement.length}`, statement, kind: 'requirement', subject: null, retired_at: null, supersedes: null, created_at: '2026-11-27T10:59:59Z', ...over } as ProjectFact;
}
const CAL03 = fact('Calder Motion authorized a one-time exception for Alex Rivera only: the consultant conducts exactly one reference call and sends Calder a written summary. This supersedes CAL-01 for Alex Rivera only.');

describe('an id is read whole (L-318)', () => {
  it('reads CAL-01, FIRM-01, S4 and N8 as ids, and never their digits as numbers', () => {
    const v = factValues('CAL-01 and FIRM-01 apply; South S4 and North N8 ran; 18 seats; BANK-05 at 3:35 p.m.');
    expect(v.ids).toEqual(['CAL-01', 'FIRM-01', 'S4', 'N8', 'BANK-05']);
    expect(v.numbers).toEqual(['18']);
  });
});

describe('a replacement limited to one person (L-318)', () => {
  it('reads who it is limited to, and what it replaces without that', () => {
    expect(scopeOf('This supersedes CAL-01 for Alex Rivera only.')).toEqual({ scope: 'Alex Rivera', phrase: 'for Alex Rivera only' });
    expect(scopeOf('The new rate applies only for the Harbor crew')).toMatchObject({ scope: 'Harbor' });
    expect(scopeOf('Everyone moves to the new rate.')).toBeNull();
    expect(replacedClause(CAL03.statement)).toMatchObject({ was: 'supersedes CAL-01', scope: 'Alex Rivera' });
  });

  it("passes Sean's saved draft: Morgan Lee keeps CAL-01, the template keeps FIRM-01", () => {
    const superseded = supersededFactValues([CAL03]);
    expect(superseded.map((s) => [s.kind, s.value, s.scope])).toEqual([['ids', 'CAL-01', 'Alex Rivera']]);
    expect(leftoverMentions(DRAFT, superseded)).toEqual([]);
  });

  it("still refuses a draft that gives Alex Rivera the CAL-01 terms as current, naming the id", () => {
    const wrong = DRAFT.replace(
      '| Who contacts references | The consultant conducts exactly one reference call. This is a one-time exception for Alex Rivera only. | CAL-03 |',
      '| Who contacts references | Calder Motion conducts its own reference calls under CAL-01. | CAL-01 |'
    );
    const left = leftoverMentions(wrong, supersededFactValues([CAL03]));
    expect(left.length).toBeGreaterThan(0);
    expect(namedLeftovers(left)[0].text).toMatch(/^CAL-01 in "/);
  });

  it('a folder rule in force keeps its value true for everyone', () => {
    const replaced = fact('The Calder calling rule now says the consultant sends a summary, replacing CAL-01.');
    expect(supersededFactValues([replaced]).map((s) => s.value)).toEqual(['CAL-01']);
    expect(supersededFactValues([replaced], ['Calder calls its own references and the consultant sends the contact sheet (CAL-01).'])).toEqual([]);
  });
});

describe('the value a replacement brings in is not the one it replaces', () => {
  it('reads "supersedes the 24-seat limit with 18" as 24 replaced by 18', () => {
    const f = fact('The fire marshal supersedes the 24-seat limit with 18 seats for the workshop room.');
    expect(replacedClause(f.statement)).toMatchObject({ was: 'supersedes the 24-seat limit' });
    expect(supersededFactValues([f]).map((s) => s.value)).toEqual(['24']);
  });

  it("Sean's workshop: the clause ends at its colon, and the earlier Studio A fact does not keep 24 alive", () => {
    const older = fact('Studio A holds 24 people.', { id: 'old', kind: 'fact', created_at: '2026-11-27T09:00:00Z' });
    const update = fact('Confirmed 10:00 workshop update, superseding the earlier Studio A limit of 24: the room now has 18 seats for participants per session after facilitator space is accounted for. The 40-person roster stays as it is.', { id: 'new', kind: 'fact', created_at: '2026-11-27T10:05:00Z' });
    expect(replacedClause(update.statement)?.was).toBe('superseding the earlier Studio A limit of 24');
    expect(supersededFactValues([older, update]).map((s) => s.value)).toEqual(['24']);
    // A later fact about something else that states 24 still keeps it true.
    const later = fact('The caterer confirmed 24 lunch boxes.', { id: 'later', kind: 'fact', created_at: '2026-11-27T10:10:00Z' });
    expect(supersededFactValues([older, update, later])).toEqual([]);
  });

  it('reads "changed from 20 to 12" and ", now Monday" the same way', () => {
    expect(supersededFactValues([fact('The deadline changed from 20 business days to 12 business days.')]).map((s) => s.value)).toEqual(['20']);
    const opening = fact('CITY-02 supersedes CITY-01 on the public opening, now Monday, December 14, at 10 a.m.');
    const values = supersededFactValues([opening]).map((s) => `${s.kind}:${s.value}`);
    expect(values).toContain('ids:CITY-01');
    expect(values).not.toContain('ids:CITY-02');
    expect(values).not.toContain('weekdays:monday');
  });
});
