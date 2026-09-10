/**
 * FR-20: getting the work back out.
 *
 * There was already an export in this codebase — `api.exportSession()` calling
 * `export_session_json()` — and it is not reusable. It serialises the retired
 * `Session` shape (a `PMInput` and an array of `Iteration`s) and knows nothing
 * about projects, artifacts, versions, stages, workflow events or evaluations.
 * Pointing it at a Book project would produce a file describing a data model
 * that project has never been stored in.
 *
 * So: two formats, deliberately, because they answer two different questions.
 *
 * **Markdown** is the thing a user actually wants out — the artifact, readable,
 * pasteable into the document it was always going to become. It is the
 * "at least one text-based export format" FR-20 requires.
 *
 * **JSON** is the whole record: project, stages, every version with its
 * provenance, every evaluation, and the workflow event log. That is FR-01's
 * durability claim made inspectable — a user (or an auditor) can open the file
 * and see that the skipped stage, its reason, and the score attached to v3 are
 * all really there, rather than taking the interface's word for it.
 *
 * Both are pure functions over data already in memory. No API call, no second
 * source of truth, and nothing that can fail halfway and leave a partial file.
 */

import type { StageDefinition, WorkflowEvent, WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';
import type { Artifact, ArtifactVersion, Evaluation, Project } from '@/types/project';

export interface ExportBundle {
  project: Project;
  template: WorkflowTemplate;
  state: WorkflowState;
  events: WorkflowEvent[];
  /** Every stage's artifact and version history, keyed by stage id. */
  stages: Record<string, { artifact: Artifact | null; versions: ArtifactVersion[] }>;
  /** Stored evaluations, keyed by the version they scored. */
  evaluations: Record<string, Evaluation>;
}

/** `Objective — a field guide.md`, minus everything a filesystem dislikes. */
export function exportFilename(project: Project, extension: 'md' | 'json'): string {
  const stem =
    (project.title || 'untitled project')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'project';
  const day = new Date().toISOString().slice(0, 10);
  return `${stem}-${day}.${extension}`;
}

function head(version: ArtifactVersion[] | undefined): ArtifactVersion | undefined {
  return version?.at(-1);
}

function stageStatus(state: WorkflowState, stage: StageDefinition): string {
  return state.stages[stage.id]?.status ?? 'not_started';
}

/**
 * The artifact, as a document.
 *
 * Every stage the project actually reached appears in template order, under its
 * own heading, holding the content of its head version. A skipped stage is not
 * omitted — it appears with its reason, because "we deliberately did not do
 * this, and here is why" is a finding, and the whole point of recording a skip
 * reason is that someone reads it later.
 *
 * Stages that were never started are dropped entirely: a Book template has
 * thirteen of them, and a file that is mostly empty headings is a file nobody
 * scrolls to the bottom of.
 */
export function toMarkdown(bundle: ExportBundle): string {
  const { project, template, state, stages, evaluations } = bundle;
  const lines: string[] = [];

  lines.push(`# ${project.title || 'Untitled project'}`, '');

  const meta: Array<[string, string]> = [
    ['Workflow', `${template.name} (v${template.version})`],
    ['Objective', project.objective],
    ['Audience', project.audience],
    ['Constraints', project.constraints],
    ['Output format', project.output_format],
    ['Mode', project.mode],
    ['Exported', new Date().toISOString()],
  ];
  for (const [label, value] of meta) {
    if (value) lines.push(`**${label}:** ${value}  `);
  }
  lines.push('');

  for (const stage of template.stages) {
    const status = stageStatus(state, stage);
    const versions = stages[stage.id]?.versions ?? [];
    const current = head(versions);

    if (status === 'not_started' && !current?.content.trim()) continue;

    lines.push(`## ${stage.label}`, '');

    if (status === 'skipped') {
      const reason = state.stages[stage.id]?.skipped_reason;
      lines.push(
        reason
          ? `_Skipped deliberately — ${reason}_`
          : '_Skipped deliberately, with no reason recorded._',
        ''
      );
      if (!current?.content.trim()) continue;
    }

    if (!current?.content.trim()) {
      lines.push('_Started, but nothing was written._', '');
      continue;
    }

    lines.push(current.content.trim(), '');

    // Provenance sits under the content, not above it: the reader came for the
    // work, and the attribution is what they check afterwards.
    const provenance = [
      `version ${current.version_number} of ${versions.length}`,
      current.model && `model ${current.model}`,
      current.source_operation,
    ].filter(Boolean);
    lines.push(`_${provenance.join(' · ')}_`, '');

    const evaluation = evaluations[current.id];
    if (evaluation) {
      lines.push(
        `> **Evaluated** — alignment ${evaluation.alignment_score}, ` +
          `clarity ${evaluation.clarity_score}, drift ${evaluation.drift_score} ` +
          '(drift is inverted: Low is good).',
        ''
      );
      if (evaluation.findings?.length) {
        lines.push('> Findings:');
        for (const finding of evaluation.findings) {
          lines.push(`> - ${finding.summary}`);
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * The full record, as data.
 *
 * Versions are exported whole rather than head-only. That is the expensive
 * choice and the right one: `artifact_versions` is append-only precisely so
 * that the history is trustworthy, and an export that flattened it to the
 * current text would throw away the only evidence that it is.
 */
export function toJson(bundle: ExportBundle): string {
  const { project, template, state, events, stages, evaluations } = bundle;

  const payload = {
    schema: 1,
    exported_at: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      objective: project.objective,
      audience: project.audience,
      constraints: project.constraints,
      output_format: project.output_format,
      mode: project.mode,
      model: project.model,
      workflow: project.workflow,
      workflow_template_id: project.workflow_template_id,
      stage: project.stage,
      status: project.status,
      manual_checks: project.manual_checks,
      session_facts: project.session_facts,
      created_at: project.created_at,
      updated_at: project.updated_at,
    },
    workflow_template: {
      key: template.key,
      version: template.version,
      name: template.name,
      outline_stage: template.outline_stage,
      stages: template.stages.map((s) => ({
        id: s.id,
        label: s.label,
        renderer: s.renderer,
        status: stageStatus(state, s),
        skipped_reason: state.stages[s.id]?.skipped_reason ?? null,
      })),
    },
    // The record itself. `projects.stage` is a denormalised cursor; this is
    // what it was derived from.
    workflow_events: events,
    stages: template.stages
      .map((stage) => {
        const bundleForStage = stages[stage.id];
        if (!bundleForStage?.versions.length) return null;
        return {
          stage_id: stage.id,
          label: stage.label,
          artifact: bundleForStage.artifact
            ? {
                id: bundleForStage.artifact.id,
                kind: bundleForStage.artifact.kind,
                name: bundleForStage.artifact.name,
                summary: bundleForStage.artifact.summary,
                version_count: bundleForStage.artifact.version_count,
              }
            : null,
          versions: bundleForStage.versions.map((v) => ({
            id: v.id,
            version_number: v.version_number,
            parent_version_id: v.parent_version_id,
            restored_from_version_id: v.restored_from_version_id,
            source_operation: v.source_operation,
            instruction: v.instruction,
            model: v.model,
            mode: v.mode,
            change_summary: v.change_summary,
            finish_reason: v.finish_reason,
            user_rating: v.user_rating,
            content: v.content,
            created_at: v.created_at,
            evaluation: evaluations[v.id]
              ? {
                  alignment: {
                    score: evaluations[v.id].alignment_score,
                    explanation: evaluations[v.id].alignment_explanation,
                  },
                  clarity: {
                    score: evaluations[v.id].clarity_score,
                    explanation: evaluations[v.id].clarity_explanation,
                  },
                  drift: {
                    score: evaluations[v.id].drift_score,
                    explanation: evaluations[v.id].drift_explanation,
                  },
                  completeness: {
                    status: evaluations[v.id].completeness_status,
                    reason: evaluations[v.id].completeness_reason,
                  },
                  findings: evaluations[v.id].findings ?? [],
                  needs_realignment: evaluations[v.id].needs_realignment,
                  evaluator_model: evaluations[v.id].evaluator_model,
                  source: evaluations[v.id].source,
                  created_at: evaluations[v.id].created_at,
                }
              : null,
          })),
        };
      })
      .filter(Boolean),
  };

  return JSON.stringify(payload, null, 2);
}
