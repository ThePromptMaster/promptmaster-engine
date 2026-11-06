import { describe, expect, it } from 'vitest';

import type { StageDefinition } from '@/lib/workflow/types';

import { rollUpStarts, type StartArtifactRow, type StartEventRow, type StartProjectRow } from './start-funnel';

const stage = (id: string, renderer: StageDefinition['renderer'], required = true) => ({ id, renderer, required }) as StageDefinition;
const TEMPLATES = [
  { id: 'plain', stages: [stage('brief', 'prose'), stage('memo', 'prose'), stage('review', 'review')] },
  { id: 'screen', stages: [stage('criteria', 'prose'), stage('screen', 'assess'), stage('shortlist', 'prose')] },
  { id: 'book', stages: [stage('outline', 'outline'), stage('chapters', 'long_form')] },
];
const AT = '2026-11-01T10:00:00.000Z';

const project = (over: Partial<StartProjectRow> & { id: string }): StartProjectRow => ({
  user_id: 'u1', example_key: null, workflow_template_id: 'plain', created_at: AT, ...over,
});
const event = (project_id: string, type: string, over: Partial<StartEventRow> = {}): StartEventRow => ({
  project_id, user_id: 'u1', type, created_at: '2026-11-01T10:00:01.000Z', ...over,
});
const artifact = (project_id: string, stage_id: string, version_count = 1): StartArtifactRow => ({ project_id, stage_id, version_count });

const roll = (over: Partial<Parameters<typeof rollUpStarts>[0]>) =>
  rollUpStarts({ projects: [], events: [], artifacts: [], goProjects: [], templates: TEMPLATES, guests: new Set(), excluded: new Set(), ...over });

describe('how people start', () => {
  it('counts a project started here, how far it got, and whether Go was used', () => {
    const funnel = roll({
      projects: [project({ id: 'p1' }), project({ id: 'p2' })],
      events: [event('p1', 'project_created'), event('p1', 'project_finalized'), event('p2', 'project_created')],
      artifacts: [artifact('p1', 'memo'), artifact('p2', 'brief')],
      goProjects: ['p1'],
    });
    expect(funnel.lines).toEqual([
      { kind: 'own', guest: false, people: 1, projects: 2, firstDraft: 1, usedGo: 1, finished: 1, finishedEarly: 0 },
    ]);
  });

  it('leaves out copies, imports and admins', () => {
    const funnel = roll({
      projects: [
        // A copy keeps its original's older events.
        project({ id: 'copy', created_at: '2026-11-05T00:00:00.000Z' }),
        // An import has no project_created at all.
        project({ id: 'import' }),
        project({ id: 'admin', user_id: 'boss' }),
      ],
      events: [event('copy', 'project_created'), event('admin', 'project_created', { user_id: 'boss' })],
      excluded: new Set(['boss']),
    });
    expect(funnel.lines).toEqual([]);
    expect(funnel.people).toBe(0);
    expect(funnel.medianFirstDayMinutes).toBeNull();
  });

  it('does not count an example\'s prepared first stage as a first draft', () => {
    const funnel = roll({
      projects: [project({ id: 'p1', example_key: 'investment_memo' })],
      events: [event('p1', 'project_created')],
      artifacts: [artifact('p1', 'brief'), artifact('p1', 'memo', 0)],
    });
    expect(funnel.lines[0]).toMatchObject({ kind: 'example', projects: 1, firstDraft: 0 });
    expect(funnel.examples).toEqual([{ key: 'investment_memo', people: 1, projects: 1, firstDraft: 0, usedGo: 0, finished: 0 }]);
  });

  it('counts a verdict table, and a chapter, as a first draft', () => {
    const funnel = roll({
      projects: [
        project({ id: 'screen', workflow_template_id: 'screen' }),
        project({ id: 'book', workflow_template_id: 'book' }),
      ],
      events: [event('screen', 'project_created'), event('book', 'project_created'), event('book', 'section_written')],
      artifacts: [artifact('screen', 'screen')],
    });
    expect(funnel.lines[0]).toMatchObject({ projects: 2, firstDraft: 2 });
  });

  it('keeps guests and accounts apart, and notes who finished early', () => {
    const funnel = roll({
      projects: [project({ id: 'p1' }), project({ id: 'p2', user_id: 'g1' })],
      events: [
        event('p1', 'project_created'),
        event('p2', 'project_created', { user_id: 'g1' }),
        event('p2', 'project_finalized', { user_id: 'g1', early: true }),
      ],
      guests: new Set(['g1']),
    });
    expect(funnel.lines.map((l) => [l.kind, l.guest, l.finished, l.finishedEarly])).toEqual([
      ['own', false, 0, 0],
      ['own', true, 1, 1],
    ]);
  });

  it('sees who went on to their own work after an example, and not the other way round', () => {
    const funnel = roll({
      projects: [
        project({ id: 'ex1', example_key: 'deal_screening', created_at: '2026-11-01T10:00:00.000Z' }),
        project({ id: 'own1', created_at: '2026-11-01T11:00:00.000Z' }),
        project({ id: 'own2', user_id: 'u2', created_at: '2026-11-01T09:00:00.000Z' }),
        project({ id: 'ex2', user_id: 'u2', example_key: 'deal_screening', created_at: '2026-11-01T10:00:00.000Z' }),
      ],
      events: [
        event('ex1', 'project_created'),
        event('own1', 'project_created', { created_at: '2026-11-01T11:00:01.000Z' }),
        event('own2', 'project_created', { user_id: 'u2', created_at: '2026-11-01T09:00:01.000Z' }),
        event('ex2', 'project_created', { user_id: 'u2', created_at: '2026-11-01T10:00:01.000Z' }),
      ],
    });
    expect(funnel.triedExample).toBe(2);
    expect(funnel.ownAfterExample).toBe(1);
  });

  it('measures the first day and who came back', () => {
    const funnel = roll({
      projects: [project({ id: 'p1' }), project({ id: 'p2', user_id: 'u2' })],
      events: [
        event('p1', 'project_created', { created_at: '2026-11-01T10:00:00.000Z' }),
        event('p1', 'stage_advanced', { created_at: '2026-11-01T10:30:00.000Z' }),
        event('p1', 'stage_advanced', { created_at: '2026-11-03T09:00:00.000Z' }),
        event('p2', 'project_created', { user_id: 'u2', created_at: '2026-11-01T10:00:00.000Z' }),
        event('p2', 'stage_advanced', { user_id: 'u2', created_at: '2026-11-01T10:10:00.000Z' }),
      ],
    });
    expect(funnel.people).toBe(2);
    expect(funnel.cameBack).toBe(1);
    expect(funnel.medianFirstDayMinutes).toBe(20);
  });
});
