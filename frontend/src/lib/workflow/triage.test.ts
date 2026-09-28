import { describe, expect, it } from 'vitest';

import { BOOK_V1 } from './templates/book.v1';
import { isTriaged, itemSchemaFor, stageContentForChat, type StageItem } from './stage-artifact';
import { applyTriage, findingRisk, isTriageTable, splitUntriaged } from './triage';

const continuity = itemSchemaFor(BOOK_V1.stages.find((s) => s.id === 'continuity')!);
const critique = itemSchemaFor(BOOK_V1.stages.find((s) => s.id === 'critique')!);
const factCheck = itemSchemaFor(BOOK_V1.stages.find((s) => s.id === 'fact_check')!);
const row = (id: string, severity: string | undefined, over: Partial<StageItem> = {}): StageItem =>
  ({ id, finding: `Finding ${id}`, where: 'Ch 1', ...(severity !== undefined ? { severity } : {}), ...over }) as StageItem;

describe('which findings Go may decide (B3)', () => {
  it('continuity and critique carry a severity enum; fact-check is an outcome table, never triaged', () => {
    expect(isTriageTable(continuity)).toBe(true);
    expect(isTriageTable(critique)).toBe(true);
    expect(isTriageTable(factCheck)).toBe(false);
  });

  it('minor and moderate are routine; major, unknown and missing are material', () => {
    expect(findingRisk(row('a', 'minor'), continuity)).toBe('routine');
    expect(findingRisk(row('b', 'Moderate '), continuity)).toBe('routine');
    expect(findingRisk(row('c', 'major'), continuity)).toBe('material');
    expect(findingRisk(row('d', 'high'), continuity)).toBe('material'); // an older free-text severity
    expect(findingRisk(row('e', undefined), continuity)).toBe('material');
    expect(findingRisk(row('f', 'minor'), factCheck)).toBe('material'); // no severity field: never routine
  });

  it('splits only the undecided rows', () => {
    const items = [row('a', 'minor'), row('b', 'major'), row('c', 'minor', { status: 'accepted' }), row('d', 'moderate', { status: 'rejected' })];
    const { routine, material } = splitUntriaged(items, continuity);
    // 'd' has a reason-requiring status without a reason: still undecided, and routine.
    expect(routine.map((i) => i.id)).toEqual(['a', 'd']);
    expect(material.map((i) => i.id)).toEqual(['b']);
  });

  it('applies only decisions the table allows, and never touches a decided row', () => {
    const items = [row('a', 'minor'), row('b', 'minor'), row('c', 'minor'), row('d', 'minor', { status: 'accepted' })];
    const { items: next, applied } = applyTriage(items, [
      { id: 'a', status: 'accepted' },
      { id: 'b', status: 'rejected' }, // demands a reason
      { id: 'c', status: 'verified' }, // not a status here
      { id: 'd', status: 'rejected', reason: 'no' }, // already decided
      { id: 'zz', status: 'accepted' }, // unknown row
    ], continuity);
    expect(applied).toEqual(['a']);
    expect(next.map((i) => i.status ?? '')).toEqual(['accepted', '', '', 'accepted']);
    const withReason = applyTriage(items, [{ id: 'b', status: 'rejected', reason: 'The text does not say that.' }], continuity);
    expect(withReason.applied).toEqual(['b']);
    expect(withReason.items[1]).toMatchObject({ status: 'rejected', reason: 'The text does not say that.' });
  });
});

describe('claim table provenance (C3)', () => {
  const schema = itemSchemaFor(BOOK_V1.stages.find((s) => s.id === 'fact_check')!);
  it('a state PromptMaster set is not a decision; the user\'s is', () => {
    expect(isTriaged({ id: 'a', claim: 'x', status: 'candidate_source' }, schema)).toBe(false);
    expect(isTriaged({ id: 'a', claim: 'x', status: 'no_source' }, schema)).toBe(false);
    expect(isTriaged({ id: 'a', claim: 'x', status: 'verified' }, schema)).toBe(true);
    expect(isTriaged({ id: 'a', claim: 'x', status: 'unverifiable' }, schema)).toBe(false);
    expect(isTriaged({ id: 'a', claim: 'x', status: 'unverifiable', reason: 'No primary source.' }, schema)).toBe(true);
  });
  it('only a tool sets "Verified by PromptMaster", and Go never triages claims', () => {
    expect(schema.statuses!.find((s) => s.value === 'verified_by_promptmaster')!.settable).toBe(false);
    expect(isTriageTable(schema)).toBe(false);
  });
});

describe('stageContentForChat (C7)', () => {
  it('reads a table as numbered lines with the decision, and prose as it is', () => {
    const rows = JSON.stringify({ items: [
      { id: 'a', finding: 'Two chapters repeat the placement rule', where: 'Ch 2', severity: 'minor', status: 'accepted' },
      { id: 'b', finding: 'No fallback path', where: 'Ch 2', severity: 'major', status: 'rejected', reason: 'Out of scope' },
    ] });
    expect(stageContentForChat(continuity, rows)).toBe(
      '1. What is wrong: Two chapters repeat the placement rule — Where: Ch 2 — Severity: minor [Accept]\n' +
      '2. What is wrong: No fallback path — Where: Ch 2 — Severity: major [Reject: Out of scope]'
    );
    expect(stageContentForChat(continuity, 'Plain prose stays.')).toBe('Plain prose stays.');
  });
});
