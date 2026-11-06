/**
 * How people start, and how far they get (the client, 4 Nov: "we need to see
 * whether this actually reduces confusion", and on the call: "you're seeing people
 * hop on it and it's like they're hopping off again").
 *
 * Derived from what already happened, not new telemetry: projects, their events,
 * their artifacts and their Go runs. So history counts from the first day, and
 * there is nothing a tester's browser could fail to send. Pure; the route reads the
 * rows, after its admin check.
 */

import { deliverableStage } from '@/lib/workflow/engine';
import type { StageDefinition, WorkflowTemplate } from '@/lib/workflow/types';

export interface StartProjectRow {
  id: string;
  user_id: string;
  example_key: string | null;
  workflow_template_id: string | null;
  created_at: string;
}

export interface StartEventRow {
  project_id: string;
  user_id: string;
  type: string;
  created_at: string;
  /** `payload.early`: finished with work still open. */
  early?: unknown;
}

export interface StartArtifactRow {
  project_id: string;
  stage_id: string | null;
  version_count: number | null;
}

export interface StartTemplateRow {
  id: string;
  stages: StageDefinition[] | null;
}

export interface StartLine {
  kind: 'own' | 'example';
  guest: boolean;
  people: number;
  projects: number;
  firstDraft: number;
  usedGo: number;
  finished: number;
  /** Of `finished`, those finished with work still open. */
  finishedEarly: number;
}

export interface ExampleLine {
  key: string;
  people: number;
  projects: number;
  firstDraft: number;
  usedGo: number;
  finished: number;
}

export interface StartFunnel {
  lines: StartLine[];
  examples: ExampleLine[];
  /** People who tried an example, and those who then started a project of their own. */
  triedExample: number;
  ownAfterExample: number;
  /** Everyone counted, and those active on more than one day. */
  people: number;
  cameBack: number;
  /** From a person's first event to their last, on their first day. Null with nobody to measure. */
  medianFirstDayMinutes: number | null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Has it produced anything to read? The deliverable's stage has a version; or an
 * Assess stage holds a table, whatever comes after it; or a chapter was written,
 * which a manuscript does long before it has a version. An example's prepared first
 * stage is never its deliverable, so it does not count.
 */
function reachedFirstDraft(
  project: StartProjectRow,
  template: StartTemplateRow | undefined,
  artifacts: readonly StartArtifactRow[],
  events: readonly StartEventRow[]
): boolean {
  if (events.some((e) => e.type === 'section_written')) return true;
  const stages = template?.stages;
  if (!stages?.length) return false;
  const written = new Set(artifacts.filter((a) => (a.version_count ?? 0) > 0).map((a) => a.stage_id));
  if (stages.some((s) => s.renderer === 'assess' && written.has(s.id))) return true;
  const deliverable = deliverableStage({ stages } as WorkflowTemplate);
  return Boolean(deliverable && written.has(deliverable.id));
}

export function rollUpStarts(input: {
  projects: readonly StartProjectRow[];
  events: readonly StartEventRow[];
  artifacts: readonly StartArtifactRow[];
  goProjects: readonly string[];
  templates: readonly StartTemplateRow[];
  guests: ReadonlySet<string>;
  excluded: ReadonlySet<string>;
}): StartFunnel {
  const { projects, events, artifacts, goProjects, templates, guests, excluded } = input;
  const eventsOf = new Map<string, StartEventRow[]>();
  for (const e of events) eventsOf.set(e.project_id, [...(eventsOf.get(e.project_id) ?? []), e]);
  const artifactsOf = new Map<string, StartArtifactRow[]>();
  for (const a of artifacts) artifactsOf.set(a.project_id, [...(artifactsOf.get(a.project_id) ?? []), a]);
  const templateById = new Map(templates.map((t) => [t.id, t]));
  const usedGo = new Set(goProjects);

  // Started here: not a copy, whose events are older than it, and not an import, which has none.
  const started = projects.filter(
    (p) =>
      !excluded.has(p.user_id) &&
      (eventsOf.get(p.id) ?? []).some((e) => e.type === 'project_created' && e.created_at >= p.created_at)
  );

  const blank = (kind: StartLine['kind'], guest: boolean): StartLine => ({
    kind, guest, people: 0, projects: 0, firstDraft: 0, usedGo: 0, finished: 0, finishedEarly: 0,
  });
  const lines = new Map<string, StartLine>();
  const peopleIn = new Map<string, Set<string>>();
  const exampleLines = new Map<string, ExampleLine>();
  const peopleInExample = new Map<string, Set<string>>();

  for (const p of started) {
    const guest = guests.has(p.user_id);
    const kind: StartLine['kind'] = p.example_key ? 'example' : 'own';
    const key = `${kind}:${guest}`;
    const line = lines.get(key) ?? blank(kind, guest);
    lines.set(key, line);
    const people = peopleIn.get(key) ?? new Set<string>();
    peopleIn.set(key, people);
    people.add(p.user_id);

    const own = eventsOf.get(p.id) ?? [];
    const draft = reachedFirstDraft(p, p.workflow_template_id ? templateById.get(p.workflow_template_id) : undefined, artifactsOf.get(p.id) ?? [], own);
    const finished = own.find((e) => e.type === 'project_finalized');
    const go = usedGo.has(p.id);

    line.projects += 1;
    if (draft) line.firstDraft += 1;
    if (go) line.usedGo += 1;
    if (finished) line.finished += 1;
    if (finished?.early) line.finishedEarly += 1;

    if (p.example_key) {
      const ex = exampleLines.get(p.example_key) ?? { key: p.example_key, people: 0, projects: 0, firstDraft: 0, usedGo: 0, finished: 0 };
      exampleLines.set(p.example_key, ex);
      const inExample = peopleInExample.get(p.example_key) ?? new Set<string>();
      peopleInExample.set(p.example_key, inExample);
      inExample.add(p.user_id);
      ex.projects += 1;
      if (draft) ex.firstDraft += 1;
      if (go) ex.usedGo += 1;
      if (finished) ex.finished += 1;
    }
  }
  for (const [key, line] of lines) line.people = peopleIn.get(key)?.size ?? 0;
  for (const [key, ex] of exampleLines) ex.people = peopleInExample.get(key)?.size ?? 0;

  // Who went on to their own work after trying an example.
  const firstExample = new Map<string, string>();
  for (const p of started) {
    if (!p.example_key) continue;
    const held = firstExample.get(p.user_id);
    if (!held || p.created_at < held) firstExample.set(p.user_id, p.created_at);
  }
  const wentOn = new Set(
    started.filter((p) => !p.example_key && firstExample.has(p.user_id) && p.created_at > firstExample.get(p.user_id)!).map((p) => p.user_id)
  );

  // Time and return, from everything each person did, in the projects counted.
  const countedProjects = new Set(started.map((p) => p.id));
  const timesOf = new Map<string, string[]>();
  for (const e of events) {
    if (!countedProjects.has(e.project_id)) continue;
    timesOf.set(e.user_id, [...(timesOf.get(e.user_id) ?? []), e.created_at]);
  }
  let cameBack = 0;
  const firstDays: number[] = [];
  for (const times of timesOf.values()) {
    const sorted = [...times].sort();
    const firstDay = sorted[0].slice(0, 10);
    if (sorted.some((t) => t.slice(0, 10) !== firstDay)) cameBack += 1;
    const lastThatDay = sorted.filter((t) => t.slice(0, 10) === firstDay).at(-1)!;
    firstDays.push((Date.parse(lastThatDay) - Date.parse(sorted[0])) / 60_000);
  }

  const order = ['own:false', 'own:true', 'example:false', 'example:true'];
  const shown = order.flatMap((k) => (lines.has(k) ? [lines.get(k)!] : []));
  const middle = median(firstDays);
  return {
    lines: shown,
    examples: [...exampleLines.values()].sort((a, b) => b.projects - a.projects || a.key.localeCompare(b.key)),
    triedExample: firstExample.size,
    ownAfterExample: wentOn.size,
    people: new Set(started.map((p) => p.user_id)).size,
    cameBack,
    medianFirstDayMinutes: middle === null ? null : Math.round(middle),
  };
}
