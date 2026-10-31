import { describe, expect, it } from 'vitest';

import { BOOK_V1, projectState } from './index';
import { buildChatContext, stageStatusLine } from './chat-context';
import { madeBy, pageChanges, pageSnapshot } from './chat-changes';
import type { StageArtifactBundle } from './digest';
import type { ArtifactVersion, Project } from '@/types/project';

/**
 * 31 Oct (Sean): "The run status moved from 'running' to 'blocked' to
 * 'awaiting_decision'. A 'Continue writing' button appeared and then
 * disappeared. The chat assistant gave me wrong version numbers and
 * contradictory button advice as a result."
 */
const PROJECT = { objective: 'A nonfiction book.' } as Pick<Project, 'objective' | 'audience' | 'data_files'>;
const stage = BOOK_V1.stages.find((s) => s.renderer === 'prose')!;
const v = (n: number, op: string, finish: string | null = null) =>
  ({ id: `v${n}`, version_number: n, source_operation: op, finish_reason: finish, content: `text ${n}` }) as unknown as ArtifactVersion;
const bundles = (versions: ArtifactVersion[]): Record<string, StageArtifactBundle> => ({ [stage.id]: { artifact: null, versions } });
const state = projectState(BOOK_V1, []);

describe('the chat is told the versions, and which one is on screen', () => {
  it('lists the latest versions with who made them and whether they were cut off', () => {
    const ctx = buildChatContext({
      template: BOOK_V1, state, project: PROJECT, stage, controls: [], shownVersionId: 'v7',
      bundles: bundles([v(6, 'stage_edit'), v(7, 'agent_revise', 'length'), v(8, 'chat_instruct')]),
    });
    expect(ctx.versions).toEqual([
      { number: 6, made_by: 'user', cut_off: false, shown: false },
      { number: 7, made_by: 'go', cut_off: true, shown: true },
      { number: 8, made_by: 'chat', cut_off: false, shown: false },
    ]);
  });

  it('the latest is the one on screen when none is chosen', () => {
    const ctx = buildChatContext({ template: BOOK_V1, state, project: PROJECT, stage, controls: [], bundles: bundles([v(1, 'stage_draft'), v(2, 'stage_draft')]) });
    expect(ctx.versions?.map((x) => x.shown)).toEqual([false, true]);
    expect(madeBy('stage_draft')).toBe('system');
  });

  it('says the stage is reopened or stuck, and why', () => {
    expect(stageStatusLine({ status: 'stale', stale: { reason: 'The work went back to Evidence base.', since: '', was: 'complete' } } as never)).toBe(
      'reopened, waiting for a recheck: The work went back to Evidence base.'
    );
    expect(stageStatusLine({ status: 'blocked', blocked: { kind: 'tool_missing', kinds: ['tool_missing', 'needs_decision'], reason: 'Credit' } } as never)).toBe(
      'marked stuck (tool missing, needs decision): Credit'
    );
    expect(stageStatusLine(undefined)).toBe('not started');
  });
});

describe('what changed since the last reply', () => {
  const before = pageSnapshot({
    stage_status: 'in progress', go_run: { status: 'running' } as never,
    buttons: [{ label: 'Continue writing', where: '' }, { label: 'Go', where: '' }],
    versions: [{ number: 8, made_by: 'go', cut_off: true, shown: true }],
  });

  it('names the run, the version and each button that came or went', () => {
    const now = pageSnapshot({
      stage_status: 'reopened, waiting for a recheck: sources changed', go_run: { status: 'awaiting_decision' } as never,
      buttons: [{ label: 'Resume', where: '' }],
      versions: [{ number: 8, made_by: 'go', cut_off: true, shown: false }, { number: 9, made_by: 'go', cut_off: false, shown: true }],
    });
    expect(pageChanges(before, now)).toEqual([
      'Go: running → waiting for your decision',
      'This stage: in progress → reopened, waiting for a recheck: sources changed',
      'New version saved: v9 (was v8)',
      'The user is now looking at v9',
      'No longer on the page: "Continue writing", "Go"',
      'Now on the page: "Resume"',
    ]);
  });

  it('nothing changed, or no reply yet: nothing to say', () => {
    expect(pageChanges(before, before)).toEqual([]);
    expect(pageChanges(undefined, before)).toEqual([]);
  });
});
