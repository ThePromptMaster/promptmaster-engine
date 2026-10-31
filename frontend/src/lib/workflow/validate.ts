/**
 * Whether a workflow template can be walked. Pure.
 *
 * The system templates are checked by tests at build time. A template a user
 * generates is checked here, at run time, before it is saved: a stage nobody
 * can reach, or a gate nobody can open, is a dead end the user would only find
 * halfway through. Every rule returns a sentence, not a code.
 */

import { getStage } from './engine';
import { ITEM_SCHEMAS, rendererHoldsItems } from './stage-artifact';
import { SCALE_LIMITS, presetScale, validScale } from './assess';
import type { StageRenderer, WorkflowTemplate } from './types';

const RENDERERS: readonly StageRenderer[] = ['prose', 'list', 'outline', 'long_form', 'review', 'assess'];
const GROUPS = ['planning', 'outlining', 'drafting', 'expansion', 'evaluation', 'revision', 'final_review'];

/**
 * `requireHints`: every stage must say what it produces. On for anything
 * generated; Single output predates hints and draws on the brief instead.
 * `requireAuthority`: every approval says whether it is a routine decision or
 * the user's alone (6 Oct). On for every template written from now on.
 */
export function validateTemplate(
  template: WorkflowTemplate,
  { requireHints = true, requireAuthority = true } = {}
): string[] {
  const errors: string[] = [];
  const stages = template.stages ?? [];
  if (!stages.length) return ['The workflow has no stages.'];
  if (stages.length > 20) errors.push('A workflow can have at most 20 stages.');

  const ids = new Set<string>();
  for (const s of stages) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(s.id)) errors.push(`"${s.label || s.id}" needs a short id of lowercase letters.`);
    if (ids.has(s.id)) errors.push(`Two stages share the id "${s.id}".`);
    ids.add(s.id);
    if (!s.label?.trim()) errors.push(`Stage "${s.id}" has no name.`);
    if (!RENDERERS.includes(s.renderer)) errors.push(`"${s.label}" has an unknown kind of page.`);
    if (!GROUPS.includes(s.group)) errors.push(`"${s.label}" has an unknown group.`);
    if (requireHints && !s.entry_prompt_hint?.trim()) errors.push(`"${s.label}" does not say what to produce.`);
  }

  for (const s of stages) {
    const next = s.transitions.default_next;
    if (next !== null && !ids.has(next)) errors.push(`"${s.label}" leads to a stage that does not exist.`);
    for (const back of s.transitions.allow_return_to) {
      if (!ids.has(back)) errors.push(`"${s.label}" returns to a stage that does not exist.`);
    }
    const loop = s.transitions.loop_to;
    if (loop && (!ids.has(loop) || stages.findIndex((x) => x.id === loop) >= stages.indexOf(s))) {
      errors.push(`"${s.label}" starts its next round from a stage that is not before it.`);
    }
    if (s.transitions.allow_skip && !s.skip_reasons.length) errors.push(`"${s.label}" can be skipped but gives no reason to.`);
    for (const c of s.exit_criteria) {
      if (c.check === 'auto' && !c.rule) errors.push(`"${s.label}": "${c.label}" is checked automatically but has no rule.`);
      if (c.check === 'manual' && requireAuthority && c.authority !== 'delegable' && c.authority !== 'reserved') {
        errors.push(`"${s.label}": "${c.label}" does not say whether it is a routine decision or the user's alone.`);
      }
      if (c.check === 'auto' && c.authority) errors.push(`"${s.label}": "${c.label}" is checked automatically, so nobody decides it.`);
    }
    for (const m of s.recommended_modes) {
      if (m.reason.length > 80) errors.push(`"${s.label}": a mode's reason is longer than 80 characters.`);
    }
    // An Assess stage judges against what came before it, on a scale it can hold (25 Oct).
    if (s.renderer === 'assess') {
      if (stages.indexOf(s) === 0) errors.push(`"${s.label}" assesses against criteria, so a stage before it must set them.`);
      const scale = s.assess?.scale;
      if (typeof scale === 'string' ? !presetScale(scale) : scale && !validScale({ id: 'custom', levels: scale })) {
        errors.push(`"${s.label}" has a scale that cannot be used: name a preset, or give ${SCALE_LIMITS.minLevels} to ${SCALE_LIMITS.maxLevels} levels.`);
      }
    }
    if (rendererHoldsItems(s.renderer) && s.exit_criteria.some((c) => c.rule?.type === 'every_item_has_status')) {
      const kind = s.expected_artifacts[0]?.kind;
      if (s.renderer === 'list' && !(kind && ITEM_SCHEMAS[kind]?.statuses?.length)) {
        errors.push(`"${s.label}" asks for a status on every row, but its rows have no statuses.`);
      }
    }
  }

  // Chapters are written against an approved outline (31 Oct: a designed
  // workflow may now have a chapters stage). Without one, the page would wait
  // for an outline nobody can make.
  const firstChapters = stages.findIndex((s) => s.renderer === 'long_form');
  if (firstChapters >= 0) {
    const planned =
      template.outline_stage === 'derived'
        ? Boolean(template.derived_outline)
        : template.outline_stage === 'explicit' && stages.slice(0, firstChapters).some((s) => s.renderer === 'outline');
    if (!planned) errors.push(`"${stages[firstChapters].label}" writes chapters, so a chapter plan must come before it.`);
    if (firstChapters === 0) errors.push(`"${stages[0].label}" writes chapters, so it cannot be the first stage.`);
  }

  const terminals = stages.filter((s) => s.transitions.default_next === null);
  if (terminals.length !== 1) errors.push('A workflow must end in exactly one final stage.');

  // Every stage reachable, every required stage on the default path.
  const reachable = new Set<string>();
  const walk = (id: string) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    const stage = getStage(template, id);
    if (!stage) return;
    if (stage.transitions.default_next) walk(stage.transitions.default_next);
    stage.transitions.allow_return_to.forEach(walk);
  };
  walk(stages[0].id);
  for (const s of stages) if (!reachable.has(s.id)) errors.push(`"${s.label}" cannot be reached.`);

  const spine = new Set<string>();
  let cursor: string | null = stages[0].id;
  while (cursor && !spine.has(cursor)) {
    spine.add(cursor);
    cursor = getStage(template, cursor)?.transitions.default_next ?? null;
  }
  for (const s of stages) if (s.required && !spine.has(s.id)) errors.push(`"${s.label}" is required but is not on the main path.`);

  // The first stage is where the project's objective is set (project-setup.tsx
  // is offered by the stage whose criteria ask for it).
  if (!stages[0].exit_criteria.some((c) => c.rule?.type === 'field_non_empty' && c.rule.field === 'objective')) {
    errors.push(`The first stage must ask for the objective.`);
  }

  return [...new Set(errors)];
}
