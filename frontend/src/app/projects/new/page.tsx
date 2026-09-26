'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { GuideQuestions } from '@/components/projects/guide-questions';
import { SetupCard, type SetupDraft } from '@/components/projects/setup-card';
import { AutoGrowTextarea } from '@/components/shared/auto-grow-textarea';
import { api } from '@/lib/api/client';
import { createProject } from '@/lib/supabase/projects';
import { appendWorkflowEvent, listTemplates } from '@/lib/supabase/workflow';
import { createArtifact } from '@/lib/supabase/versions';
import type { WorkflowTemplate } from '@/lib/workflow/types';
import type { GuideQuestion, SetupRationale } from '@/types';

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

function titleFrom(objective: string): string {
  const firstLine = objective.trim().split('\n')[0] ?? '';
  return firstLine.length <= 60 ? firstLine : `${firstLine.slice(0, 57).trimEnd()}…`;
}

export default function NewProjectPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [templates, setTemplates] = useState<(WorkflowTemplate & { id: string })[]>([]);
  const [step, setStep] = useState<Step>('ask');
  const [objective, setObjective] = useState('');
  const [questions, setQuestions] = useState<GuideQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
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
    mode: 'architect',
  });
  const [working, setWorking] = useState<null | 'questions' | 'setup' | 'creating'>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listTemplates()
      .then(setTemplates)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load workflows.'));
  }, []);

  const templateFor = (key: string) => templates.find((t) => t.key === key) ?? null;
  const selected = templates.find((t) => t.id === templateId) ?? null;
  const hasObjective = objective.trim().length > 0;

  async function recommend(withAnswers: boolean) {
    setWorking('setup');
    setError(null);
    try {
      const { suggestion } = await api.generateSetup({
        objective: objective.trim(),
        answers: withAnswers
          ? questions
              .map((q) => ({ question: q.question, answer: (answers[q.id] ?? '').trim() }))
              .filter((a) => a.answer)
          : undefined,
      });
      const recommended = templateFor(suggestion.workflow) ?? templateFor('single_output');
      setTemplateId(recommended?.id ?? null);
      setRecommendedKey(suggestion.workflow);
      setWorkflowReason(suggestion.workflow_reason);
      setRationale(suggestion.rationale);
      setDraft({
        title: titleFrom(objective),
        objective: objective.trim(),
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

  async function guideMe() {
    setWorking('questions');
    setError(null);
    try {
      const { questions: asked } = await api.guideQuestions({ objective: objective.trim() });
      setQuestions(asked);
      setAnswers({});
      setStep('questions');
    } catch (e) {
      setError(`Could not load questions${e instanceof Error && e.message ? `: ${e.message}` : ''}.`);
    } finally {
      setWorking(null);
    }
  }

  function chooseYourself() {
    setTemplateId(templateFor('book')?.id ?? templates[0]?.id ?? null);
    setRecommendedKey(null);
    setWorkflowReason('');
    setRationale(null);
    setDraft((d) => ({ ...d, title: titleFrom(objective), objective: objective.trim() }));
    setStep('setup');
  }

  async function handleCreate() {
    if (!user || !selected || working) return;
    setWorking('creating');
    setError(null);
    try {
      const project = await createProject(
        {
          title: draft.title.trim() || titleFrom(draft.objective) || 'Untitled project',
          objective: draft.objective.trim(),
          audience: draft.audience.trim() || 'General',
          constraints: draft.constraints.trim(),
          output_format: draft.output_format.trim(),
          mode: draft.mode,
          workflow: selected.key,
        },
        user.id
      );

      // Pin the exact template version, so a later revision cannot reshape a
      // project that is already under way.
      const { createClient } = await import('@/lib/supabase/client');
      await createClient()
        .from('projects')
        .update({
          workflow_template_id: selected.id,
          stage: selected.stages[0]?.id ?? '',
        })
        .eq('id', project.id);

      await createArtifact(project.id, user.id, 'output', 'Output');
      await appendWorkflowEvent(project.id, user.id, {
        type: 'project_created',
        stage_id: selected.stages[0]?.id ?? '',
      });

      router.push(`/projects/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the project.');
      setWorking(null);
    }
  }

  if (authLoading) return null;

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
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              onClick={() => void recommend(false)}
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
            you can; blanks are fine.
          </p>
          <GuideQuestions
            questions={questions}
            answers={answers}
            onAnswer={(id, answer) => setAnswers((prev) => ({ ...prev, [id]: answer }))}
          />
          <div className="mt-8 flex items-center gap-3">
            <button
              onClick={() => void recommend(true)}
              disabled={working !== null}
              className="rounded-xl bg-[var(--pm-primary)] px-6 py-3 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {working === 'setup' ? 'Working out a setup…' : 'Recommend a setup'}
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
          />
          <div className="mt-10 flex items-center gap-3">
            <button
              onClick={() => void handleCreate()}
              disabled={!selected || working !== null || !user || !draft.objective.trim()}
              className="rounded-xl bg-[var(--pm-primary)] px-6 py-3 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {working === 'creating' ? 'Creating…' : `Start ${selected?.name ?? 'project'}`}
            </button>
            <button
              onClick={() => setStep(questions.length ? 'questions' : 'ask')}
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
