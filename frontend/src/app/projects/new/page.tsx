'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { WorkflowPicker } from '@/components/projects/workflow-picker';
import { createProject } from '@/lib/supabase/projects';
import { listTemplates } from '@/lib/supabase/workflow';
import { createArtifact } from '@/lib/supabase/versions';
import { appendWorkflowEvent } from '@/lib/supabase/workflow';
import type { WorkflowTemplate } from '@/lib/workflow/types';

export default function NewProjectPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [templates, setTemplates] = useState<(WorkflowTemplate & { id: string })[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listTemplates()
      .then((rows) => {
        setTemplates(rows);
        // Default to Book: it is the workflow the product is built around, and
        // a default of "no stages" quietly steers everyone away from the thing
        // that makes this more than a prompt box.
        setTemplateId((rows.find((t) => t.key === 'book') ?? rows[0])?.id ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load workflows.'));
  }, []);

  const selected = templates.find((t) => t.id === templateId) ?? null;

  async function handleCreate() {
    if (!user || !selected || creating) return;
    setCreating(true);
    setError(null);
    try {
      const project = await createProject(
        {
          title: title.trim() || objective.trim().slice(0, 80) || 'Untitled project',
          objective: objective.trim(),
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
      await appendWorkflowEvent(
        project.id,
        user.id,
        { type: 'project_created', stage_id: selected.stages[0]?.id ?? '' },
        1
      );

      router.push(`/projects/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the project.');
      setCreating(false);
    }
  }

  if (authLoading) return null;

  return (
    <main className="mx-auto max-w-[860px] px-6 py-14">
      <Link
        href="/projects"
        className="mb-10 inline-flex items-center gap-1.5 text-body text-[var(--on-surface-variant)] transition-colors hover:text-[var(--on-surface)]"
      >
        <span className="material-symbols-outlined text-[18px]">arrow_back</span>
        Projects
      </Link>

      <h1 className="text-display text-[var(--on-surface)]">New project</h1>
      <p className="mt-3 text-body text-[var(--on-surface-variant)]">
        The workflow decides what stages you move through. You can skip any of them.
      </p>

      {error && (
        <div className="mt-6 rounded-xl bg-[var(--error-container)] px-4 py-3 text-body text-[var(--on-error-container)]">
          {error}
        </div>
      )}

      <section className="mt-10">
        <h2 className="mb-4 text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
          What are you making?
        </h2>
        <WorkflowPicker templates={templates} selectedId={templateId} onSelect={setTemplateId} />
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
          What is it for?
        </h2>

        <div className="rounded-2xl bg-[var(--surface-container-lowest)] px-6 py-5 shadow-[0_1px_2px_rgba(25,28,30,0.04)]">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Give it a name"
            aria-label="Project name"
            className="w-full bg-transparent text-headline text-[var(--on-surface)] outline-none placeholder:text-[var(--outline)]"
          />
          <textarea
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            rows={3}
            placeholder={
              selected?.key === 'research'
                ? 'What question are you trying to answer, and what would count as an answer?'
                : 'What are you trying to produce, and who is it for?'
            }
            aria-label="Objective"
            className="mt-3 w-full resize-none bg-transparent text-body leading-relaxed text-[var(--on-surface-variant)] outline-none placeholder:text-[var(--outline)]"
          />
        </div>

        <p className="mt-2 text-label text-[var(--on-surface-variant)]">
          You can change any of this later — the first stage is about getting it right.
        </p>
      </section>

      <div className="mt-10 flex items-center gap-3">
        <button
          onClick={handleCreate}
          disabled={!selected || creating || !user}
          className="rounded-xl bg-[var(--pm-primary)] px-6 py-3 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {creating ? 'Creating…' : `Start ${selected?.name ?? 'project'}`}
        </button>
        <Link
          href="/projects"
          className="px-3 py-3 text-body text-[var(--on-surface-variant)] transition-colors hover:text-[var(--on-surface)]"
        >
          Cancel
        </Link>
      </div>
    </main>
  );
}
