'use client';

/**
 * "Take this into the full PromptMaster process" (Sean, 26 Oct): a Quick
 * answer project re-pinned, in place, to a workflow designed for the work —
 * or the standard one the setup picks — with the answer as the first version
 * of its deliverable. The chat, files, sources and facts are the project's
 * and stay with it; the Answer stage's chat is copied to the first stage, so
 * the user carries on talking where they were.
 *
 * The writes are ordered so a failure part-way leaves a working project: the
 * new workflow, the answer and the chat first (extra rows nobody reads yet),
 * then the `workflow_switched` event, then the pin. Until the pin moves, the
 * project is still the quick answer it was.
 */

import { useState } from 'react';

import { api } from '@/lib/api/client';
import { useT } from '@/lib/i18n/i18n-provider';
import { useWorkflowWords } from '@/components/projects/workflow-picker';
import { templateFromDesign } from '@/lib/workflow/custom';
import { validateTemplate } from '@/lib/workflow/validate';
import { carryTarget, switchBrief } from '@/lib/workflow/quick';
import { appendWorkflowEvent, getLatestTemplate, publishUserTemplate } from '@/lib/supabase/workflow';
import { appendVersion, createArtifact } from '@/lib/supabase/versions';
import { loadStageChat, saveStageChatMessage } from '@/lib/supabase/conversation';
import type { WorkflowTemplate } from '@/lib/workflow/types';
import type { Project } from '@/types/project';
import type { SetupSuggestion } from '@/types';

type Choice = { template: WorkflowTemplate & { id: string }; designed: boolean };

interface Props {
  project: Project;
  /** The Answer stage, whose chat comes along. */
  stageId: string;
  /** The answer as it stands: the head version on the Answer stage. */
  answer: string;
  /** After the switch: the workspace reloads onto the new workflow. */
  onSwitched: () => void;
}

export function TakeFullProcess({ project, stageId, answer, onSwitched }: Props) {
  const t = useT();
  const words = useWorkflowWords();
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [suggestion, setSuggestion] = useState<SetupSuggestion | null>(null);
  const [picked, setPicked] = useState(0);
  const [busy, setBusy] = useState<'preparing' | 'switching' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const web = project.web_access ?? 'on';

  async function prepare() {
    setOpen(true);
    if (choices) return;
    setBusy('preparing');
    setError(null);
    const brief = switchBrief(project.objective, answer);
    try {
      // The same pair the start screen offers (23 Oct): a workflow designed for
      // the work by default, the standard one the setup picks beside it.
      const [setup, designed] = await Promise.all([
        api.generateSetup({ objective: project.objective.trim(), material: brief, web_access: web }),
        api
          .generateWorkflow({ description: brief, objective: project.objective.trim().slice(0, 8_000), web_access: web })
          .then(({ workflow }) => {
            const made = templateFromDesign(workflow, crypto.randomUUID().replace(/-/g, '').slice(0, 10));
            return validateTemplate(made).length ? null : made;
          })
          .catch(() => null),
      ]);
      const standard = (await getLatestTemplate(setup.suggestion.workflow)) ?? (await getLatestTemplate('single_output'));
      const found: Choice[] = [
        ...(designed ? [{ template: { ...designed, id: '' }, designed: true }] : []),
        ...(standard ? [{ template: standard, designed: false }] : []),
      ];
      if (!found.length) throw new Error(t('start.createFailed'));
      setSuggestion(setup.suggestion);
      setChoices(found);
      setPicked(0);
    } catch (e) {
      setError(t('quick.takeFullFailed', { reason: e instanceof Error && e.message ? e.message : String(e) }));
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    const choice = choices?.[picked];
    if (!choice) return;
    setBusy('switching');
    setError(null);
    try {
      let target = choice.template;
      if (choice.designed) {
        const { id: _unsaved, ...design } = target;
        void _unsaved;
        target = await publishUserTemplate(design, project.user_id, { listed: false });
      }
      const first = target.stages[0]?.id ?? '';
      const carry = carryTarget(target);
      if (carry && answer.trim()) {
        const artifact = await createArtifact(project.id, project.user_id, 'output', carry.label, carry.id);
        await appendVersion(artifact, {
          content: answer,
          source_operation: 'carried_from_quick',
          change_summary: 'The quick answer, carried into the full process.',
        });
      }
      if (first) {
        for (const m of await loadStageChat(project.id, stageId)) {
          await saveStageChatMessage({
            project_id: project.id,
            stage_id: first,
            iteration_number: 1,
            role: m.role,
            content: m.content,
            mode: m.mode,
          }).catch(() => undefined);
        }
      }
      await appendWorkflowEvent(project.id, project.user_id, {
        type: 'workflow_switched',
        stage_id: first,
        payload: {
          from_template_id: project.workflow_template_id ?? null,
          to_template_id: target.id,
          deliverable_stage_id: carry?.id ?? null,
        },
      });
      const { createClient } = await import('@/lib/supabase/client');
      // The setup the quick answer never had, where the project has none of its own.
      const setup = suggestion
        ? {
            ...(project.audience?.trim() && project.audience !== 'General' ? {} : { audience: suggestion.audience || 'General' }),
            ...(project.constraints?.trim() ? {} : { constraints: suggestion.constraints }),
            ...(project.output_format?.trim() ? {} : { output_format: suggestion.output_format }),
            mode: suggestion.mode,
          }
        : {};
      const { error: pinError } = await createClient()
        .from('projects')
        .update({ workflow: target.key, workflow_template_id: target.id, stage: first, ...setup })
        .eq('id', project.id);
      if (pinError) throw pinError;
      onSwitched();
    } catch (e) {
      setError(t('quick.takeFullFailed', { reason: e instanceof Error && e.message ? e.message : String(e) }));
      setBusy(null);
    }
  }

  return (
    <section
      aria-label={t('quick.takeFullTitle')}
      className="mb-6 rounded-2xl bg-[var(--surface-container-low)] px-5 py-4"
    >
      {!open ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-body text-[var(--on-surface-variant)]">{t('quick.takeFullNote')}</p>
          <button
            type="button"
            onClick={() => void prepare()}
            disabled={!answer.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--pm-primary)] px-5 py-2.5 text-label font-semibold text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <span aria-hidden className="material-symbols-outlined text-[18px]">account_tree</span>
            {t('quick.takeFull')}
          </button>
        </div>
      ) : (
        <div>
          <h2 className="text-title text-[var(--on-surface)]">{t('quick.takeFullTitle')}</h2>
          <p className="mt-1 text-body text-[var(--on-surface-variant)]">{t('quick.takeFullIntro')}</p>
          {busy === 'preparing' && (
            <p role="status" className="mt-3 text-body text-[var(--on-surface-variant)]">{t('start.workingSetup')}</p>
          )}
          {choices && (
            <div role="radiogroup" aria-label={t('quick.takeFullTitle')} className="mt-4 grid gap-3 sm:grid-cols-2">
              {choices.map((c, i) => (
                <button
                  key={c.template.id || 'designed'}
                  type="button"
                  role="radio"
                  aria-checked={picked === i}
                  onClick={() => setPicked(i)}
                  className={`rounded-xl px-4 py-3 text-start transition-colors ${
                    picked === i
                      ? 'bg-[var(--surface-container-lowest)] shadow-[0_2px_8px_rgba(0,0,0,0.08)] ring-2 ring-[var(--pm-primary)]'
                      : 'bg-[var(--surface-container-high)] hover:bg-[var(--surface-container-highest)]'
                  }`}
                >
                  <span className="block text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
                    {c.designed ? t('quick.recommended') : t('quick.standard')}
                  </span>
                  <span className="mt-1 block text-title text-[var(--on-surface)]">{words.name(c.template)}</span>
                  <span className="mt-1 block text-label text-[var(--on-surface-variant)]">
                    {c.template.stages.map((s) => s.short_label || s.label).join(' → ')}
                  </span>
                </button>
              ))}
            </div>
          )}
          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-[var(--error-container)] px-3 py-2 text-label text-[var(--on-error-container)]">{error}</p>
          )}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy === 'switching'}
              className="rounded-lg px-4 py-2 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]"
            >
              {t('quick.cancel')}
            </button>
            {choices && (
              <button
                type="button"
                onClick={() => void confirm()}
                disabled={busy !== null}
                className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label font-semibold text-[var(--on-primary)] disabled:opacity-40"
              >
                {busy === 'switching' ? t('quick.takeFullWorking') : t('quick.takeFullConfirm', { name: words.name(choices[picked].template) })}
              </button>
            )}
            {!choices && error && (
              <button
                type="button"
                onClick={() => void prepare()}
                disabled={busy !== null}
                className="rounded-lg bg-[var(--surface-container-high)] px-4 py-2 text-label text-[var(--on-surface)]"
              >
                {t('start.retry')}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
