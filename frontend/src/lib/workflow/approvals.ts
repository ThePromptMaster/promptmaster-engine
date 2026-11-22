/**
 * The approvals the user has given, as every prompt reads them (25 Oct, Sean:
 * "a previous test retained approved dates and financial constraints in one
 * section, but the final blocker still claimed they were unresolved").
 *
 * A tick was stored on the project (`manual_checks`, with the version it was
 * given on in `manual_check_versions`) and shown in the checklist, but no
 * prompt was told: the final review and the objective check judged the work
 * as if nothing had been approved. Pure.
 */
import type { ArtifactVersion, Project, ProjectFact } from '@/types/project';
import type { StageArtifactBundle } from './digest';
import { choosesAnOption } from './decision-options';
import { concernsItem, itemLabels } from './item-labels';
import type { WorkflowEvent, WorkflowTemplate } from './types';

export interface GivenApproval {
  stage: string;
  approval: string;
  /** The version it was given on, and the stage's current one; 0 when unknown. */
  version: number;
  current: number;
  /** The option the user chose when giving it (12 Nov); absent for a plain sign-off. */
  choice?: string;
  /**
   * Given by Go under the routine-decision policy, not ticked by the user (16 Nov,
   * hand pass: Go committed "I approve this brief and the shared assumptions",
   * and every later writer and check read its own refreshments plan as approved
   * by the user, so the invitation promised drinks and snacks).
   */
  by_policy?: boolean;
}

/**
 * The approvals Go committed itself, by criterion: the versions it committed
 * them on. One Go only re-confirmed on a newer version (`reconfirmed`) counts
 * as Go's only when Go also gave it in the first place.
 */
export function goCommitted(events: readonly Pick<WorkflowEvent, 'type' | 'payload'>[] | null | undefined): Map<string, Set<string>> {
  const versions = new Map<string, Set<string>>();
  const original = new Set<string>();
  for (const e of events ?? []) {
    if (e.type !== 'criterion_committed') continue;
    const p = (e.payload ?? {}) as { criterion_id?: unknown; evidence_version_id?: unknown; reconfirmed?: unknown; policy?: unknown };
    if (typeof p.criterion_id !== 'string' || p.policy !== 'routine_decisions') continue;
    if (!p.reconfirmed) original.add(p.criterion_id);
    if (typeof p.evidence_version_id === 'string') {
      if (!versions.has(p.criterion_id)) versions.set(p.criterion_id, new Set());
      versions.get(p.criterion_id)!.add(p.evidence_version_id);
    }
  }
  for (const id of [...versions.keys()]) if (!original.has(id)) versions.delete(id);
  return versions;
}

/**
 * The option chosen with each approval, by criterion (12 Nov): read from the
 * fact the choice recorded. A later choice for the same approval replaces an
 * earlier one; a retired fact says nothing.
 */
export function chosenFor(facts: readonly Pick<ProjectFact, 'source_ref' | 'retired_at'>[] | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of facts ?? []) {
    if (f.retired_at) continue;
    const ref = f.source_ref as { criterion_id?: unknown; choice?: unknown } | null | undefined;
    if (typeof ref?.criterion_id === 'string' && typeof ref.choice === 'string' && ref.choice.trim()) out.set(ref.criterion_id, ref.choice.trim());
  }
  return out;
}

/**
 * The fact that records the decision already made on an approval, if one is
 * current. A decision made again replaces it: two current facts saying "Option
 * B" and "Option A" for the same approval would both reach every prompt.
 */
export function earlierDecision<F extends Pick<ProjectFact, 'source_ref' | 'retired_at'> & Partial<Pick<ProjectFact, 'id' | 'supersedes'>>>(
  facts: readonly F[] | null | undefined,
  criterionId: string
): F | null {
  const all = facts ?? [];
  const decides = (f: F) => (f.source_ref as { criterion_id?: unknown } | null | undefined)?.criterion_id === criterionId;
  let found: F | null = null;
  for (const f of all) if (!f.retired_at && decides(f)) found = f;
  if (found) return found;
  // What stands where the decision stood. Restoring the text from before a decision offers to
  // update the fact to match, and "Not yet decided…" then replaces "Option A". Deciding again
  // left that fact current beside "Option B" (12 Nov, production pass): it is the one to replace.
  const byId = new Map(all.filter((f) => f.id).map((f) => [f.id as string, f]));
  for (const f of all) {
    if (f.retired_at) continue;
    let earlier = f.supersedes ? byId.get(f.supersedes) : undefined;
    for (let hops = 0; earlier && hops < 20; hops += 1) {
      if (decides(earlier)) {
        found = f;
        break;
      }
      earlier = earlier.supersedes ? byId.get(earlier.supersedes) : undefined;
    }
  }
  return found;
}

/** The answer part of an answer fact: "…, answered: Approve Option B at $49,000" is "Approve Option B at $49,000". */
export function answeredText(statement: string): string {
  const at = statement.lastIndexOf('answered:');
  return at >= 0 ? statement.slice(at + 'answered:'.length).trim() : statement.replace(/^Decided by the user:\s*/, '').trim();
}

/**
 * Answers to Go's own questions that chose an option of the kind a decision
 * now chooses, still current (22 Nov, L-275). Sean typed "Approve Option B at
 * $49,000 all-in" to Go's question; it was kept as a note, not as the decision.
 * Ten minutes later he pressed Option A on the approval, and both stood as "Decided
 * by the user": the final memo kept B and Go asked which. A decision made on
 * the approval replaces them. Only an answer that chooses ("approve", "go
 * with", "pick") and names an item of the same kind ("Option …"); one that only
 * mentions an option stays.
 */
export function answersReplacedBy<F extends Pick<ProjectFact, 'statement' | 'source_ref' | 'retired_at'>>(
  facts: readonly F[] | null | undefined,
  choice: string
): F[] {
  const kinds = new Set(itemLabels(choice).keys());
  if (!kinds.size) return [];
  return (facts ?? []).filter((f) => {
    if (f.retired_at) return false;
    const ref = f.source_ref as { via?: unknown; criterion_id?: unknown } | null | undefined;
    if (ref?.via !== 'go answer' || typeof ref?.criterion_id === 'string') return false;
    const answer = answeredText(f.statement);
    return choosesAnOption(answer) && [...itemLabels(answer).keys()].some((k) => kinds.has(k));
  });
}

/** The reason a replaced answer is retired with. */
export function replacedReason(approval: string, choice: string): string {
  return `Replaced by your decision on "${approval}": ${choice}`.slice(0, 500);
}

export function approvalsGiven(
  project: Pick<Project, 'manual_checks' | 'manual_check_versions' | 'facts'>,
  template: Pick<WorkflowTemplate, 'stages'>,
  bundles: Record<string, StageArtifactBundle> | null | undefined,
  events?: readonly Pick<WorkflowEvent, 'type' | 'payload'>[] | null
): GivenApproval[] {
  const ticked = project.manual_checks ?? {};
  const given = project.manual_check_versions ?? {};
  const chosen = chosenFor(project.facts);
  const byGo = goCommitted(events);
  const out: GivenApproval[] = [];
  for (const stage of template.stages) {
    const versions = bundles?.[stage.id]?.versions ?? [];
    const current = versions.at(-1)?.version_number ?? 0;
    for (const c of stage.exit_criteria) {
      if (c.check !== 'manual' || !ticked[c.id]) continue;
      const on = versions.find((v) => v.id === given[c.id])?.version_number ?? 0;
      const choice = chosen.get(c.id);
      const goGave = Boolean(given[c.id] && byGo.get(c.id)?.has(given[c.id]!));
      out.push({ stage: stage.label, approval: c.label, version: on, current, ...(choice ? { choice: choice.slice(0, 400) } : {}), ...(goGave ? { by_policy: true } : {}) });
    }
  }
  return out.slice(0, 60);
}

export interface ApprovalOnEarlierVersion {
  stageId: string;
  /** The stage's short name. */
  label: string;
  approval: string;
  version: number;
  current: number;
  /** What changed since it was given, one line per version (8 Nov). */
  since?: string[];
}

/** How Go writes a version under the routine-decision policy. */
const GO_ROUTINE_OPERATIONS: ReadonlySet<string> = new Set(['agent_revise', 'agent_apply', 'continuation']);

/**
 * The user's approval on this stage was given on an earlier version, and every
 * version since is Go's own routine repair (8 Nov; "without requiring me to …
 * repeatedly approve routine repairs"). It stays tied to the version it was
 * given on and is shown as such; it is not asked for again.
 */
export function approvalStandsThroughRepairs(
  project: Pick<Project, 'manual_checks' | 'manual_check_versions'>,
  stage: Pick<WorkflowTemplate['stages'][number], 'exit_criteria'>,
  versions: readonly Pick<ArtifactVersion, 'id' | 'source_operation'>[]
): boolean {
  const reserved = stage.exit_criteria.filter((c) => c.check === 'manual' && c.authority !== 'delegable');
  if (!reserved.length) return false;
  return reserved.every((c) => {
    if (!project.manual_checks?.[c.id]) return false;
    const at = versions.findIndex((v) => v.id === project.manual_check_versions?.[c.id]);
    if (at < 0 || at === versions.length - 1) return false;
    return versions.slice(at + 1).every((v) => GO_ROUTINE_OPERATIONS.has(v.source_operation));
  });
}

/**
 * Approvals the user gave on an earlier text than the stage holds now (5 Nov:
 * "5 done · 0 to go" while the repair log said the approval was for an earlier
 * version). Compared by text: a long-form stage saves a snapshot of the same
 * chapters as a newer version, and that changes nothing the user approved. An
 * approval Go may re-confirm under "handle them for me" is Go's to deal with,
 * not the user's. An older tick with no version on record is not guessed at.
 */
export function approvalsOnEarlierVersion(
  project: Pick<Project, 'manual_checks' | 'manual_check_versions' | 'routine_decisions' | 'facts'>,
  template: Pick<WorkflowTemplate, 'stages'>,
  bundles: Record<string, StageArtifactBundle> | null | undefined
): ApprovalOnEarlierVersion[] {
  const ticked = project.manual_checks ?? {};
  const given = project.manual_check_versions ?? {};
  const chosen = chosenFor(project.facts);
  const out: ApprovalOnEarlierVersion[] = [];
  for (const stage of template.stages) {
    const versions = bundles?.[stage.id]?.versions ?? [];
    const head = versions.at(-1);
    if (!head) continue;
    for (const c of stage.exit_criteria) {
      if (c.check !== 'manual' || !ticked[c.id]) continue;
      if (project.routine_decisions === 'handle' && c.authority === 'delegable') continue;
      const on = versions.find((v) => v.id === given[c.id]);
      if (!on || on.id === head.id || on.content === head.content) continue;
      // An approval given by choosing an option is the decision itself; Go
      // writing that decision into the stage is not a change to re-confirm
      // (12 Nov: "I choose option A or option B" was given on v3, Go recorded
      // the choice, and the finish asked for it again on v5).
      if (chosen.has(c.id) && versions.filter((v) => v.version_number > on.version_number).every((v) => GO_ROUTINE_OPERATIONS.has(v.source_operation))) continue;
      const since = versions.filter((v) => v.version_number > on.version_number).map((v) => (v.change_summary ?? '').split('\n')[0].slice(0, 160)).filter(Boolean);
      out.push({ stageId: stage.id, label: stage.short_label || stage.label, approval: c.label, version: on.version_number, current: head.version_number, ...(since.length ? { since } : {}) });
    }
  }
  return out;
}

/** The project with its approvals on it, for `inputsFrom`. The same object when there are none. */
export function withApprovals<P extends Project>(
  project: P,
  template: Pick<WorkflowTemplate, 'stages'>,
  bundles: Record<string, StageArtifactBundle> | null | undefined,
  events?: readonly Pick<WorkflowEvent, 'type' | 'payload'>[] | null
): P {
  const approvals = approvalsGiven(project, template, bundles, events);
  return approvals.length ? { ...project, approvals } : project;
}

/** A decision the user made by choosing an option, set aside because a fact about that option changed (L-272). */
export interface SetAsideDecision {
  /** The fact that recorded the decision: retired, so no prompt reads it as current (it stays in the history). */
  factId: string;
  criterionId: string;
  stageId: string;
  /** The option chosen, as it was recorded. */
  choice: string;
  /** The fact the choice rested on, as it read before the change. */
  because: string;
}

/** A line of `factsText` that records a decision, not a fact a decision rests on. */
const DECISION_LINE = /^(?:Decision:\s*)?Decided by the user\b/i;

/**
 * The decisions a change to the facts sets aside (L-272, 21 Nov, Sean: Option B
 * was approved at $60,000, its training charge then rose to $7,500, and the
 * approval stage was repaired and closed again with the $60,000 choice still
 * standing; the warehouse run did the same for Option A). A decision made by
 * choosing an option, still ticked, whose option a changed or removed fact
 * names, no longer stands: it is unticked, its fact is retired (kept in the
 * history: a review that still read it as current asked about a decision the
 * user had already replaced, 22 Nov production pass), and its stage reopens,
 * so Go asks again with the options. A fact replaced by a new decision never
 * counts.
 * `removed`: the statements the change took out of the facts (`statementsOf`).
 */
export function decisionsSetAside(
  project: Pick<Project, 'facts' | 'manual_checks'>,
  removed: readonly string[]
): SetAsideDecision[] {
  const changed = removed.filter((r) => !DECISION_LINE.test(r.trim()));
  if (!changed.length) return [];
  const out: SetAsideDecision[] = [];
  for (const f of project.facts ?? []) {
    if (f.retired_at) continue;
    const ref = (f.source_ref ?? {}) as { criterion_id?: unknown; choice?: unknown; stage_id?: unknown };
    if (typeof ref.criterion_id !== 'string' || typeof ref.choice !== 'string' || typeof ref.stage_id !== 'string') continue;
    if (!project.manual_checks?.[ref.criterion_id]) continue;
    if (out.some((d) => d.criterionId === ref.criterion_id)) continue;
    const because = changed.find((r) => concernsItem(r, ref.choice as string));
    if (because) out.push({ factId: f.id, criterionId: ref.criterion_id, stageId: ref.stage_id, choice: ref.choice, because });
  }
  return out;
}

/** What the reopened decision stage is told, and what the record says. */
export function setAsideReason(d: Pick<SetAsideDecision, 'choice' | 'because'>): string {
  return `the user's decision "${d.choice}" was made when the record said "${d.because}", which has changed. That decision is set aside until the user decides again: keep it only as an earlier decision, say the decision is awaited, and change nothing else.`;
}

/** What a stage after the decision is told: the choice is no longer the decision of record. */
export function setAsideLater(d: Pick<SetAsideDecision, 'choice'>): string {
  return `Also: the user's decision "${d.choice}" is set aside by this change until the user decides again. Do not present it as the decision of record or as approved; say the decision is awaited.`;
}
