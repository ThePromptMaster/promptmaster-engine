/**
 * FR-20: the work comes back out, and it comes back out whole.
 *
 * The fixture is a real multi-stage project rather than a single stage with one
 * version, because every interesting property of this export is about what
 * happens across stages: template order, a deliberately skipped stage that must
 * not vanish, a stage nobody started that must not become an empty heading, and
 * a version history that must survive rather than be flattened to its head.
 */

import { describe, expect, it } from 'vitest';

import { exportFilename, toJson, toMarkdown, type ExportBundle } from './project-export';
import { BOOK_V1, projectState } from '@/lib/workflow';
import type { WorkflowEvent } from '@/lib/workflow/types';
import type { ArtifactVersion, Evaluation, Project } from '@/types/project';

function version(
  id: string,
  content: string,
  n: number,
  extra: Partial<ArtifactVersion> = {}
): ArtifactVersion {
  return {
    id,
    user_id: 'u1',
    project_id: 'p1',
    artifact_id: `a-${id}`,
    version_number: n,
    parent_version_id: null,
    source_operation: 'stage_draft',
    instruction: '',
    system_prompt: '',
    content,
    model: 'anthropic/claude-sonnet',
    mode: 'architect',
    change_summary: null,
    restored_from_version_id: null,
    finish_reason: 'stop',
    user_rating: null,
    continuity_snapshot: null,
    created_at: '2026-09-04T00:00:00Z',
    ...extra,
  };
}

const PROJECT = {
  id: 'p1',
  user_id: 'u1',
  title: 'Governing AI-assisted work',
  objective: 'A field guide to governing AI-assisted work.',
  audience: 'Engineering leads',
  constraints: 'No vendor names.',
  output_format: 'Book, twelve chapters',
  mode: 'architect',
  custom_name: '',
  custom_preamble: '',
  custom_tone: '',
  model: 'anthropic/claude-sonnet',
  session_facts: [],
  active_stack_id: null,
  constraint_presets: [],
  format_presets: [],
  workflow: 'book',
  workflow_template_id: 'tpl-1',
  stage: 'research',
  status: 'active',
  manual_checks: {},
  revision: 7,
  archived_at: null,
  deleted_at: null,
  legacy_session_id: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-04T00:00:00Z',
} as Project;

const EVALUATION: Evaluation = {
  id: 'e1',
  user_id: 'u1',
  project_id: 'p1',
  version_id: 'v-objective-2',
  alignment_score: 'High',
  alignment_explanation: 'Answers the stage.',
  drift_score: 'Low',
  drift_explanation: 'On target.',
  clarity_score: 'Medium',
  clarity_explanation: 'Some long sentences.',
  completeness_status: 'complete',
  completeness_reason: '',
  interpretation: null,
  findings: [
    { id: 'f1', category: 'clarity', summary: 'Paragraph two runs long.', suggested_change: 'Split it.' },
  ],
  needs_realignment: false,
  evaluator_model: 'anthropic/claude-sonnet',
  source: 'manual',
  created_at: '2026-09-04T00:00:00Z',
};

/** Two stages done, one skipped with a reason, the rest never started. */
function bundle(): ExportBundle {
  const events: WorkflowEvent[] = [
    {
      type: 'stage_completed',
      stage_id: 'objective',
      to_stage_id: 'audience',
      actor: 'user',
      created_at: '2026-09-02T00:00:00Z',
    },
    {
      type: 'stage_completed',
      stage_id: 'audience',
      to_stage_id: 'positioning',
      actor: 'user',
      created_at: '2026-09-03T00:00:00Z',
    },
    {
      type: 'stage_skipped',
      stage_id: 'positioning',
      to_stage_id: 'research',
      actor: 'user',
      reason: 'Not a commercial book',
      created_at: '2026-09-04T00:00:00Z',
    },
  ];

  return {
    project: PROJECT,
    template: BOOK_V1,
    state: projectState(BOOK_V1, events, PROJECT.stage),
    events,
    stages: {
      objective: {
        artifact: null,
        versions: [
          version('v-objective-1', 'A first, worse statement of the objective.', 1),
          version('v-objective-2', 'The objective, restated after review.', 2),
        ],
      },
      audience: {
        artifact: null,
        versions: [version('v-audience-1', 'Engineering leads who already ship AI-written work.', 1)],
      },
    },
    evaluations: { 'v-objective-2': EVALUATION },
  };
}

describe('Markdown export', () => {
  const md = toMarkdown(bundle());

  it('leads with the project and its setup', () => {
    expect(md).toMatch(/^# Governing AI-assisted work/);
    expect(md).toContain('**Objective:** A field guide to governing AI-assisted work.');
    expect(md).toContain('**Audience:** Engineering leads');
    expect(md).toContain('**Workflow:** ');
  });

  it('carries the head content of every stage that has any', () => {
    expect(md).toContain('The objective, restated after review.');
    expect(md).toContain('Engineering leads who already ship AI-written work.');
  });

  it('exports the head, not the history', () => {
    // The full history is the JSON export's job. A document that repeated
    // every superseded draft is not a document.
    expect(md).not.toContain('A first, worse statement of the objective.');
  });

  it('keeps stages in template order', () => {
    expect(md.indexOf('Engineering leads who already ship')).toBeGreaterThan(
      md.indexOf('The objective, restated after review.')
    );
  });

  it('records the skip and its reason rather than dropping the stage', () => {
    // "We deliberately did not do this, and here is why" is a finding. The
    // whole point of capturing a skip reason is that someone reads it later.
    expect(md).toContain('Skipped deliberately — Not a commercial book');
  });

  it('omits stages nobody started', () => {
    // Book has thirteen. A file that is mostly empty headings is a file nobody
    // scrolls to the bottom of.
    const headings = md.match(/^## /gm) ?? [];
    expect(headings.length).toBeLessThan(BOOK_V1.stages.length);
    expect(headings.length).toBeGreaterThanOrEqual(3);
  });

  it('attributes each stage under its content', () => {
    expect(md).toContain('version 2 of 2');
    expect(md).toContain('model anthropic/claude-sonnet');
  });

  it('carries the scores, including that drift is inverted', () => {
    expect(md).toContain('alignment High');
    expect(md).toContain('drift Low');
    expect(md).toContain('drift is inverted: Low is good');
    expect(md).toContain('Paragraph two runs long.');
  });

  it('is a document, not a wall of blank lines', () => {
    expect(md).not.toMatch(/\n{3}/);
    expect(md.endsWith('\n')).toBe(true);
  });
});

describe('JSON export', () => {
  const parsed = JSON.parse(toJson(bundle()));

  it('is the full record, not the current text', () => {
    const objective = parsed.stages.find((s: { stage_id: string }) => s.stage_id === 'objective');
    // artifact_versions is append-only precisely so the history is
    // trustworthy; flattening it here would throw away the evidence.
    expect(objective.versions).toHaveLength(2);
    expect(objective.versions[0].content).toContain('A first, worse statement');
  });

  it('carries the event log the stage state was derived from', () => {
    expect(parsed.workflow_events).toHaveLength(3);
    expect(parsed.workflow_events[2].reason).toBe('Not a commercial book');
  });

  it('records each stage status and skip reason', () => {
    const stages = parsed.workflow_template.stages as Array<{
      id: string;
      status: string;
      skipped_reason: string | null;
    }>;
    expect(stages.find((s) => s.id === 'positioning')?.status).toBe('skipped');
    expect(stages.find((s) => s.id === 'positioning')?.skipped_reason).toBe(
      'Not a commercial book'
    );
    expect(stages.find((s) => s.id === 'objective')?.status).toBe('complete');
  });

  it('attaches an evaluation to the version it scored', () => {
    const objective = parsed.stages.find((s: { stage_id: string }) => s.stage_id === 'objective');
    expect(objective.versions[0].evaluation).toBeNull();
    expect(objective.versions[1].evaluation.alignment.score).toBe('High');
    expect(objective.versions[1].evaluation.findings).toHaveLength(1);
  });

  it('pins the template version the project ran on', () => {
    expect(parsed.workflow_template.key).toBe('book');
    expect(parsed.workflow_template.version).toBe(BOOK_V1.version);
  });
});

describe('filenames', () => {
  it('is safe to write to a disk', () => {
    const name = exportFilename(PROJECT, 'md');
    expect(name).toMatch(/^governing-ai-assisted-work-\d{4}-\d{2}-\d{2}\.md$/);
  });

  it('survives a title made entirely of punctuation', () => {
    expect(exportFilename({ ...PROJECT, title: '///' }, 'json')).toMatch(
      /^project-\d{4}-\d{2}-\d{2}\.json$/
    );
  });
});
