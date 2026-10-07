'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { GuideInterview } from '@/components/projects/guide-interview';
import { SetupCard, type SetupDraft } from '@/components/projects/setup-card';
import { CustomWorkflowDesigner } from '@/components/projects/custom-workflow-designer';
import { AutoGrowTextarea } from '@/components/shared/auto-grow-textarea';
import { api } from '@/lib/api/client';
import { createProject, hardDeleteProject } from '@/lib/supabase/projects';
import { appendWorkflowEvent, listTemplates } from '@/lib/supabase/workflow';
import { createArtifact } from '@/lib/supabase/versions';
import type { WorkflowTemplate } from '@/lib/workflow/types';
import type { SetupRationale } from '@/types';
import { splitAsk } from '@/lib/projects/split-ask';
import { StartAttachments, type StartImage } from '@/components/projects/start-attachments';
import { documentsOf, materialFrom, type PreparedFile } from '@/lib/data/attachments';
import { contextFromDocuments } from '@/lib/data/extract-text';
import { imagePreview } from '@/lib/data/preview';
import { INPUT_LIMITS } from '@/lib/projects/input-limits';
import { attachProjectFile } from '@/lib/supabase/project-files';
import { LimitCounter } from '@/components/shared/limit-counter';

/**
 * PM-09 — the unified entry.
 *
 * The old page opened on "What are you making? Book / Research / Single
 * output", which asked the user to know the right workflow before they had
 * said what they wanted. Sean wanted the original PromptMaster opening back:
 * "What do you want to do or figure out?", with two ways in — "I know what I
 * want to do" and "Guide me / ask me questions" — and PromptMaster
 * recommending the workflow and mode from the objective.
 *
 *   ask ──I know──────────────────────────▶ setup ──Start──▶ project
 *    └──Guide me──▶ questions ──Recommend──▶ setup
 *
 * Choosing the workflow yourself is still one click away on the first screen.
 */

type Step = 'ask' | 'questions' | 'setup';

/** The output format a Book gets when setup suggested none. */
export const BOOK_OUTPUT_FORMAT = 'A book manuscript in continuous prose, chapter by chapter';

function titleFrom(objective: string): string {
  const firstLine = objective.trim().split('\n')[0] ?? '';
  return firstLine.length <= 60 ? firstLine : `${firstLine.slice(0, 57).trimEnd()}…`;
}

export default function NewProjectPage() {
  // Not gated on the session check: that is a network round trip, and the page
  // used to be blank for it — on production long enough to type into nothing
  // (4 Oct). Start stays disabled until the user is known.
  const { user } = useAuth();
  const router = useRouter();

  const [templates, setTemplates] = useState<(WorkflowTemplate & { id: string })[]>([]);
  const [step, setStep] = useState<Step>('ask');
  const [objective, setObjective] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [recommendedKey, setRecommendedKey] = useState<string | null>(null);
  const [workflowReason, setWorkflowReason] = useState('');
  const [rationale, setRationale] = useState<SetupRationale | null>(null);
  const [draft, setDraft] = useState<SetupDraft>({
    title: '',
    objective: '',
    audience: 'General',
    constraints: '',
    output_format: '',
    context: '',
    mode: 'architect',
  });
  // Held until Start: a project's files are stored under its id (5 Oct, email 8).
  const [startFiles, setStartFiles] = useState<PreparedFile[]>([]);
  const [startImages, setStartImages] = useState<StartImage[]>([]);
  const material = materialFrom(startFiles, INPUT_LIMITS.context);
  /** The ask split into objective and context, with any attached documents' words after it. */
  const withDocuments = (text: string) => {
    const ask = splitAsk(text);
    return { ...ask, context: contextFromDocuments(ask.context, documentsOf(startFiles), INPUT_LIMITS.context).context };
  };
  const [working, setWorking] = useState<null | 'questions' | 'setup' | 'creating'>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdWithFailures, setCreatedWithFailures] = useState<{ id: string; failed: string[] } | null>(null);
  // Kept apart from `error`: every other action clears that, and a failed
  // workflow list then left "Start" disabled with nothing saying why (4 Oct).
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  const loadTemplates = useCallback(() => {
    setLoadingTemplates(true);
    setTemplatesError(null);
    listTemplates()
      .then(setTemplates)
      .catch((e) => setTemplatesError(e instanceof Error && e.message ? e.message : 'Could not load workflows.'))
      .finally(() => setLoadingTemplates(false));
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const templateFor = (key: string) => templates.find((t) => t.key === key) ?? null;
  const selected = templates.find((t) => t.id === templateId) ?? null;

  // The list arrived after the setup was recommended (a retry): select what
  // was recommended, so the user is not left to find it again.
  const [prevTemplates, setPrevTemplates] = useState(templates);
  if (prevTemplates !== templates) {
    setPrevTemplates(templates);
    if (step === 'setup' && !templateId && templates.length) {
      setTemplateId((templates.find((t) => t.key === (recommendedKey ?? 'book')) ?? templates[0]).id);
    }
  }
  const hasObjective = objective.trim().length > 0;

  async function recommend(given?: { question: string; answer: string }[]) {
    setWorking('setup');
    setError(null);
    try {
      const { suggestion } = await api.generateSetup({
        objective: objective.trim(),
        answers: given?.length ? given.slice(0, 8) : undefined,
        ...(material ? { material } : {}),
      });
      const recommended = templateFor(suggestion.workflow) ?? templateFor('single_output');
      setTemplateId(recommended?.id ?? null);
      setRecommendedKey(suggestion.workflow);
      setWorkflowReason(suggestion.workflow_reason);
      setRationale(suggestion.rationale);
      const ask = withDocuments(objective);
      setDraft({
        title: titleFrom(objective),
        objective: ask.objective,
        context: ask.context,
        audience: suggestion.audience || 'General',
        constraints: suggestion.constraints,
        output_format: suggestion.output_format,
        mode: suggestion.mode,
      });
      setStep('setup');
    } catch (e) {
      setError(
        `Could not recommend a setup${e instanceof Error && e.message ? `: ${e.message}` : ''}. You can choose the workflow yourself.`
      );
    } finally {
      setWorking(null);
    }
  }

  // The questions are asked one at a time, on their own screen (1 Oct, item 9).
  function guideMe() {
    setError(null);
    setStep('questions');
  }

  function chooseYourself() {
    setTemplateId(templateFor('book')?.id ?? templates[0]?.id ?? null);
    setRecommendedKey(null);
    setWorkflowReason('');
    setRationale(null);
    setDraft((d) => ({ ...d, title: titleFrom(objective), ...withDocuments(objective) }));
    setStep('setup');
  }

  async function handleCreate() {
    if (!user || !selected || working || createdWithFailures) return;
    setWorking('creating');
    setError(null);
    let createdId: string | null = null;
    try {
      const project = await createProject(
        {
          title: draft.title.trim() || titleFrom(draft.objective) || 'Untitled project',
          objective: draft.objective.trim(),
          audience: draft.audience.trim() || 'General',
          constraints: draft.constraints.trim(),
          context: draft.context.trim(),
          // A book's deliverable is prose. Left empty, every chapter prompt
          // read "Output format: (none)" and the mode's structural habits
          // filled the gap (2 Oct: "it really wants to make outlines").
          output_format: draft.output_format.trim() || (selected.key === 'book' ? BOOK_OUTPUT_FORMAT : ''),
          mode: draft.mode,
          workflow: selected.key,
        },
        user.id
      );
      createdId = project.id;

      // Pin the exact template version, so a later revision cannot reshape a
      // project that is already under way.
      const { createClient } = await import('@/lib/supabase/client');
      const { error: pinError } = await createClient()
        .from('projects')
        .update({
          workflow_template_id: selected.id,
          stage: selected.stages[0]?.id ?? '',
        })
        .eq('id', project.id);
      if (pinError) throw pinError;

      await createArtifact(project.id, user.id, 'output', 'Output');
      await appendWorkflowEvent(project.id, user.id, {
        type: 'project_created',
        stage_id: selected.stages[0]?.id ?? '',
      });

      // What was attached before the project existed. The project is made
      // by now, so a file that will not store is reported, not a reason to
      // take the project back out (6 Oct, email 9): its text is already in
      // the context, and the file can be added again on the first stage.
      const failed: string[] = [];
      for (const { file, preview } of startFiles) {
        try {
          await attachProjectFile(project, file, preview);
        } catch (e) {
          failed.push(`${file.name} (${e instanceof Error && e.message ? e.message : 'not stored'})`);
        }
      }
      for (const { file, caption } of startImages) {
        let width = 0;
        let height = 0;
        try {
          const bitmap = await createImageBitmap(file);
          width = bitmap.width;
          height = bitmap.height;
          bitmap.close();
        } catch {
          // Stored all the same; its size is just unknown.
        }
        try {
          await attachProjectFile(project, file, imagePreview(file.name, caption, width, height));
        } catch (e) {
          failed.push(`${file.name} (${e instanceof Error && e.message ? e.message : 'not stored'})`);
        }
      }
      if (failed.length) {
        setCreatedWithFailures({ id: project.id, failed });
        setWorking(null);
        return;
      }

      router.push(`/projects/${project.id}`);
    } catch (e) {
      // Four writes, not one transaction: a failure part-way left a project
      // with no workflow pinned and no history, and pressing Start again made
      // a second one. Take the half-made one back out, so a retry starts clean.
      if (createdId) await hardDeleteProject(createdId).catch(() => undefined);
      const reason = e instanceof Error && e.message ? e.message : 'Could not create the project.';
      setError(`${reason} Nothing was created — press Start to try again.`);
      setWorking(null);
    }
  }


  const busyLabel =
    working === 'questions' ? 'Thinking of questions…' : working === 'setup' ? 'Working out a setup…' : null;

  return (
    <main className="mx-auto max-w-[860px] px-6 py-14">
      <Link
        href="/projects"
        className="mb-10 inline-flex items-center gap-1.5 text-body text-[var(--on-surface-variant)] transition-colors hover:text-[var(--on-surface)]"
      >
        <span className="material-symbols-outlined text-[18px]">arrow_back</span>
        Projects
      </Link>

      {error && (
        <div role="alert" className="mb-6 rounded-xl bg-[var(--error-container)] px-4 py-3 text-body text-[var(--on-error-container)]">
          {error}
        </div>
      )}

      {createdWithFailures && (
        <div role="alert" className="mb-6 rounded-xl bg-[var(--error-container)] px-4 py-3 text-body text-[var(--on-error-container)]">
          <p>
            The project was created, but {createdWithFailures.failed.length === 1 ? 'this file' : 'these files'} could
            not be stored: {createdWithFailures.failed.join('; ')}. Any text in them is already in the project context;
            add the file again on the first stage if you need it there.
          </p>
          <Link href={`/projects/${createdWithFailures.id}`} className="mt-2 inline-block font-medium underline">
            Open the project
          </Link>
        </div>
      )}

      {templatesError && (
        <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--error-container)] px-4 py-3 text-body text-[var(--on-error-container)]">
          <span>The workflows could not be loaded, so a project can&apos;t be started yet. ({templatesError})</span>
          <button
            type="button"
            onClick={loadTemplates}
            disabled={loadingTemplates}
            className="rounded-lg bg-[var(--surface-container-lowest)] px-3 py-1.5 text-label text-[var(--on-surface)] disabled:opacity-60"
          >
            {loadingTemplates ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      {step === 'ask' && (
        <>
          <h1 className="text-display text-[var(--on-surface)]">What do you want to do or figure out?</h1>
          <p className="mt-3 text-body text-[var(--on-surface-variant)]">
            Say it in your own words. PromptMaster will suggest how to set it up — which workflow,
            how to think about it, who it is for — and you can change any of it.
          </p>

          <div className="mt-8 rounded-2xl bg-[var(--surface-container-lowest)] px-6 py-5 shadow-[0_1px_2px_rgba(25,28,30,0.04)]">
            <AutoGrowTextarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              rows={3}
              autoFocus
              aria-label="What do you want to do or figure out?"
              placeholder="e.g. Write a short book about giraffes for curious ten-year-olds"
              className="w-full bg-transparent text-title leading-relaxed text-[var(--on-surface)] outline-none placeholder:text-[var(--outline)]"
            />
            <LimitCounter length={objective.length} limit={INPUT_LIMITS.objective} />
            <StartAttachments
              files={startFiles}
              images={startImages}
              onFiles={setStartFiles}
              onImages={setStartImages}
              disabled={working !== null}
            />
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              onClick={() => void recommend()}
              disabled={!hasObjective || working !== null}
              className="rounded-2xl bg-[var(--pm-primary)] px-6 py-5 text-left text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <span className="block text-title">I know what I want to do</span>
              <span className="mt-1 block text-label opacity-90">Recommend a setup from what I wrote</span>
            </button>
            <button
              onClick={() => void guideMe()}
              disabled={!hasObjective || working !== null}
              className="rounded-2xl bg-[var(--surface-container-high)] px-6 py-5 text-left text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-highest)] disabled:opacity-40"
            >
              <span className="block text-title">Guide me — ask me questions</span>
              <span className="mt-1 block text-label text-[var(--on-surface-variant)]">
                A few quick questions first, then a setup
              </span>
            </button>
          </div>

          {busyLabel && (
            <p role="status" className="mt-4 text-body text-[var(--on-surface-variant)]">
              {busyLabel}
            </p>
          )}

          <button
            onClick={chooseYourself}
            disabled={templates.length === 0}
            className="mt-6 text-body text-[var(--on-surface-variant)] underline-offset-4 hover:text-[var(--on-surface)] hover:underline"
          >
            Or choose the workflow yourself
          </button>
        </>
      )}

      {step === 'questions' && (
        <>
          <h1 className="text-display text-[var(--on-surface)]">A few questions</h1>
          <p className="mt-3 mb-8 text-body text-[var(--on-surface-variant)]">
            About: <span className="text-[var(--on-surface)]">{objective.trim()}</span>. Answer what
            you can — one at a time, and you can stop whenever you like.
          </p>
          <GuideInterview
            objective={objective.trim()}
            material={material}
            busy={working === 'setup'}
            onDone={(given) => void recommend(given)}
            onBack={() => setStep('ask')}
          />
        </>
      )}

      {step === 'setup' && (
        <>
          <h1 className="text-display text-[var(--on-surface)]">Your setup</h1>
          <p className="mt-3 mb-8 text-body text-[var(--on-surface-variant)]">
            {recommendedKey
              ? 'Recommended from what you told us. Change anything before you start — all of it stays editable later.'
              : 'Pick a workflow and fill in what you know. All of it stays editable later.'}
          </p>
          <SetupCard
            templates={templates}
            templateId={templateId}
            onSelectTemplate={setTemplateId}
            workflowReason={workflowReason}
            recommendedKey={recommendedKey}
            draft={draft}
            rationale={rationale}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            designer={
              <CustomWorkflowDesigner
                objective={draft.objective}
                ownerId={user?.id ?? null}
                onPublished={(t) => {
                  setTemplates((prior) => [...prior, t]);
                  setTemplateId(t.id);
                }}
              />
            }
          />
          <div className="mt-10 flex items-center gap-3">
            <button
              onClick={() => void handleCreate()}
              disabled={!selected || working !== null || !user || !draft.objective.trim() || createdWithFailures !== null}
              className="rounded-xl bg-[var(--pm-primary)] px-6 py-3 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {working === 'creating' ? 'Creating…' : `Start ${selected?.name ?? 'project'}`}
            </button>
            <button
              onClick={() => setStep('ask')}
              className="px-3 py-3 text-body text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
            >
              Back
            </button>
          </div>
        </>
      )}
    </main>
  );
}
