/**
 * 25 Oct (Sean): "The literature stage should also distinguish AI-generated
 * candidate references from sources that have actually been retrieved."
 */
import { describe, expect, it } from 'vitest';
import { applySavedSources } from './lookup';
import { itemSchemaFor } from './stage-artifact';
import { RESEARCH_V1 } from './templates/research.v1';
import { formOf } from './work-form';

const stage = RESEARCH_V1.stages.find((s) => itemSchemaFor(s).lookup)!;
const schema = itemSchemaFor(stage);
const field = schema.lookup!.field;
const source = { seq: 3, url: 'https://arxiv.org/abs/2301.00001', title: 'Entanglement entropy of two disjoint intervals in conformal field theory', retrieved_at: '2026-10-24T10:00:00Z' };

describe('a work a web search found and saved is retrieved, not suggested', () => {
  it('marks the row from the saved source, with its [S#] and link', () => {
    const rows = [{ id: 'w1', [field]: 'Calabrese, Cardy, Tonni (2009). Entanglement entropy of two disjoint intervals in conformal field theory', status: 'candidate' }];
    // Numbered as the panel numbers it — third current source — not by the table's global seq (31 Oct).
    const earlier = [1, 2].map((i) => ({ seq: i, url: `https://example.org/${i}`, title: `Other ${i}`, retrieved_at: '2026-10-20T00:00:00Z' }));
    const { items, found } = applySavedSources(rows, [...earlier, { ...source, seq: 3017 }], schema);
    expect(found).toBe(1);
    expect(items[0].status).toBe(schema.lookup!.status);
    expect(items[0].status_source).toBe('tool');
    expect(items[0][schema.lookup!.recordField]).toContain('[S3]');
    expect(items[0][schema.lookup!.linkField]).toBe(source.url);
  });

  it('leaves a work it does not name, and the user\'s own decision, alone', () => {
    const other = [{ id: 'w2', [field]: 'Ryu and Takayanagi (2006). Holographic derivation of entanglement entropy', status: 'candidate' }];
    expect(applySavedSources(other, [source], schema).found).toBe(0);
    const mine = [{ id: 'w3', [field]: source.title, status: 'verified', status_source: 'user' }];
    expect(applySavedSources(mine, [source], schema).items[0].status).toBe('verified');
  });
});

describe('a short film or a pilot is a screenplay', () => {
  it('reads the form from the brief', () => {
    expect(formOf({ objective: 'Write a 12-minute short film about a lighthouse keeper' })?.key).toBe('screenplay');
    expect(formOf({ objective: 'Write the TV pilot script for a heist series' })?.key).toBe('screenplay');
    expect(formOf({ objective: 'Write a Python script that cleans the CSV' })).toBeNull();
  });
});
