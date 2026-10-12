/** 12 Oct (Sean, Colette): one word per state, and a More menu that says what each entry does. */
import { describe, expect, it } from 'vitest';
import { versionPillLabel } from './renderers/stage-chrome';
import { byGroup, MORE_GROUPS } from './stage-transition-bar';

describe('version pills', () => {
  it('current, saved by Go, earlier and kept', () => {
    expect(versionPillLabel({ version_number: 4, source_operation: 'chat_instruct' }, true)).toBe('v4 · current');
    expect(versionPillLabel({ version_number: 5, source_operation: 'agent_revise' }, true)).toBe('v5 · current · saved by Go');
    expect(versionPillLabel({ version_number: 2, source_operation: 'stage_edit' }, false)).toBe('v2 · earlier, kept');
    expect(versionPillLabel({ version_number: 1, source_operation: 'stage_draft' }, false)).toBe('v1 · earlier');
  });
});

describe('More menu groups', () => {
  it('puts each group together, in order, keeping order inside a group', () => {
    const a = (id: string, group?: string) => ({ id, label: id, icon: 'x', onSelect: () => {}, group });
    const out = byGroup([a('done', MORE_GROUPS.stage), a('refine', MORE_GROUPS.rewrite), a('challenge', MORE_GROUPS.critique), a('check', MORE_GROUPS.stage), a('suggest')]);
    expect(out.map((x) => x.id)).toEqual(['suggest', 'done', 'check', 'refine', 'challenge']);
  });
});
