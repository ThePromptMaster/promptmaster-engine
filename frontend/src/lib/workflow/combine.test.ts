import { describe, expect, it } from 'vitest';

import {
  CONFLICT_AXES,
  MAX_CONFLICTS,
  asFinding,
  buildCombinedInstruction,
  detectConflicts,
  parseTag,
} from './combine';
import type { RecommendationScope } from './recommend';

/**
 * The shared literal.
 *
 * `backend/tests/test_apply_recommendations.py` asserts that
 * `_format_findings_block` renders the same two recommendations to exactly this
 * string. Byte-identity across the two languages is FR-15's "the combined
 * instruction is visible" test: the text the user reads in the preview dialog
 * is the text spliced into the model's prompt, not a summary of it that could
 * drift. Both sides hardcode it, so changing either one alone fails.
 */
export const COMBINED_FIXTURE = [
  '- [realignment] Cut the vendor comparison → Remove every named vendor and restate the comparison in generic terms.',
  '- [fix] Name the audience in the opening → Say who this is for in the first paragraph.',
].join('\n');

const REALIGNMENT = {
  category: 'evaluation:draft:r1',
  kind: 'realignment' as const,
  title: 'Cut the vendor comparison',
  instruction: 'Remove every named vendor and restate the comparison in generic terms.',
};

const FIX = {
  category: 'evaluation:draft:r2',
  kind: 'fix' as const,
  title: 'Name the audience in the opening',
  instruction: 'Say who this is for in the first paragraph.',
};

const DOC: RecommendationScope = { kind: 'document', described_as: 'The whole chapter.' };

function selection(start: number, end: number): RecommendationScope {
  return { kind: 'selection', described_as: 'The selected text.', selection: { start, end } };
}

// --- FR-15: the combined instruction is visible ------------------------------

describe('FR-15: the combined instruction', () => {
  it('renders byte-identically to the backend’s findings block', () => {
    expect(buildCombinedInstruction([REALIGNMENT, FIX])).toBe(COMBINED_FIXTURE);
  });

  it('matches the Python fallback when nothing is selected', () => {
    expect(buildCombinedInstruction([])).toBe('(no findings selected)');
  });

  it('keeps input order, so the visible list and the prompt agree', () => {
    expect(buildCombinedInstruction([FIX, REALIGNMENT]).split('\n')[0]).toContain(FIX.title);
  });

  it('casts to the AuditFinding shape the existing prompt builder takes', () => {
    // Which is why /api/apply-recommendations needs no new prompt text at all.
    expect(asFinding(REALIGNMENT)).toEqual({
      id: 'evaluation:draft:r1',
      category: 'realignment',
      summary: 'Cut the vendor comparison',
      suggested_change: 'Remove every named vendor and restate the comparison in generic terms.',
    });
  });

  it('the cast round-trips: the findings render back to the same block', () => {
    const findings = [REALIGNMENT, FIX].map(asFinding);
    const rendered = findings
      .map((f) => `- [${f.category}] ${f.summary} → ${f.suggested_change}`)
      .join('\n');
    expect(rendered).toBe(COMBINED_FIXTURE);
  });
});

// --- the tag vocabulary ------------------------------------------------------

describe('FR-15: the tag vocabulary is closed on both halves', () => {
  it('parses every legal axis:direction', () => {
    for (const [axis, directions] of Object.entries(CONFLICT_AXES)) {
      for (const direction of directions) {
        expect(parseTag(`${axis}:${direction}`)).toEqual({ axis, direction });
      }
    }
  });

  it('rejects an unknown axis, an unknown direction, and malformed input', () => {
    // Ignored rather than guessed at: a mis-parsed tag produces a warning about
    // a conflict that does not exist, and one false warning stops people
    // reading the true ones.
    expect(parseTag('vibe:higher')).toBeNull();
    expect(parseTag('length:sideways')).toBeNull();
    expect(parseTag('length')).toBeNull();
    expect(parseTag('')).toBeNull();
    expect(parseTag(':shorter')).toBeNull();
  });

  it('has six axes, each with two opposing directions', () => {
    expect(Object.keys(CONFLICT_AXES)).toEqual([
      'length',
      'depth',
      'tone',
      'scope',
      'evidence',
      'structure',
    ]);
    for (const directions of Object.values(CONFLICT_AXES)) {
      expect(directions).toHaveLength(2);
    }
  });
});

// --- detection ---------------------------------------------------------------

describe('FR-15: obvious conflicts, detected without a model', () => {
  it('finds opposing directions on one axis', () => {
    const conflicts = detectConflicts([
      { ...REALIGNMENT, tags: ['length:longer'], scope: DOC },
      { ...FIX, tags: ['length:shorter'], scope: DOC },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toBe('axis');
    expect(conflicts[0].axis).toBe('length');
    expect(conflicts[0].between).toEqual([REALIGNMENT.category, FIX.category]);
    expect(conflicts[0].message).toContain(REALIGNMENT.title);
    expect(conflicts[0].message).toContain(FIX.title);
  });

  it('does not fire on the same direction, or on different axes', () => {
    expect(
      detectConflicts([
        { ...REALIGNMENT, tags: ['length:shorter'], scope: DOC },
        { ...FIX, tags: ['length:shorter'], scope: DOC },
      ])
    ).toEqual([]);
    expect(
      detectConflicts([
        { ...REALIGNMENT, tags: ['length:shorter'], scope: DOC },
        { ...FIX, tags: ['tone:plain'], scope: DOC },
      ])
    ).toEqual([]);
  });

  it('finds overlapping selections from the scope alone', () => {
    // No content is read and no anchor is inferred — two instructions that
    // share a character will fight whatever they say, because the second is
    // applied to text the first has already rewritten.
    const conflicts = detectConflicts([
      { ...REALIGNMENT, tags: [], scope: selection(0, 100) },
      { ...FIX, tags: [], scope: selection(50, 150) },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toBe('overlap');
  });

  it('treats touching ranges as not overlapping', () => {
    expect(
      detectConflicts([
        { ...REALIGNMENT, tags: [], scope: selection(0, 50) },
        { ...FIX, tags: [], scope: selection(50, 100) },
      ])
    ).toEqual([]);
  });

  it('never fires on document scopes, which always "overlap"', () => {
    expect(
      detectConflicts([
        { ...REALIGNMENT, tags: [], scope: DOC },
        { ...FIX, tags: [], scope: DOC },
      ])
    ).toEqual([]);
  });

  it('finds nothing in a single selection, or in none', () => {
    expect(detectConflicts([])).toEqual([]);
    expect(detectConflicts([{ ...FIX, tags: ['length:longer'], scope: DOC }])).toEqual([]);
  });

  it('reports each pair once and caps the list', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      category: `c${i}`,
      title: `Rec ${i}`,
      tags: [i % 2 === 0 ? 'length:longer' : 'length:shorter'],
      scope: DOC,
    }));
    const conflicts = detectConflicts(many);
    expect(conflicts).toHaveLength(MAX_CONFLICTS);
    const seen = new Set(conflicts.map((c) => c.between.join('|')));
    expect(seen.size).toBe(conflicts.length);
  });

  it('is deterministic — the same input gives the same output', () => {
    const input = [
      { ...REALIGNMENT, tags: ['scope:narrow'], scope: DOC },
      { ...FIX, tags: ['scope:broaden'], scope: DOC },
    ];
    expect(detectConflicts(input)).toEqual(detectConflicts(input));
  });

  it('ignores tags outside the vocabulary rather than warning about them', () => {
    expect(
      detectConflicts([
        { ...REALIGNMENT, tags: ['vibe:higher'], scope: DOC },
        { ...FIX, tags: ['vibe:lower'], scope: DOC },
      ])
    ).toEqual([]);
  });
});
