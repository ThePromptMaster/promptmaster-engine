'use client';

import { use, useEffect, useMemo, useState } from 'react';

import { MarkdownOutput } from '@/components/shared/markdown-output';
import { toManuscriptMarkdown } from '@/lib/export/project-export';
import { getLatestTemplate, getTemplateById } from '@/lib/supabase/workflow';
import { initialState } from '@/lib/workflow/engine';
import type { WorkflowTemplate } from '@/lib/workflow/types';
import { useProjectStore } from '@/stores/project-store';

/**
 * The manuscript alone, on a page made to print (C4): the browser's own
 * "Save as PDF" is the PDF export. Each chapter starts a new page; the
 * button and the app chrome do not print.
 */
export default function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const project = useProjectStore((s) => s.project);
  const stages = useProjectStore((s) => s.stages);
  const loading = useProjectStore((s) => s.loading);
  const error = useProjectStore((s) => s.error);
  const loadProject = useProjectStore((s) => s.loadProject);
  const [template, setTemplate] = useState<WorkflowTemplate | null>(null);

  useEffect(() => {
    void loadProject(id);
  }, [id, loadProject]);

  useEffect(() => {
    if (!project) return;
    const load = project.workflow_template_id ? getTemplateById(project.workflow_template_id) : getLatestTemplate(project.workflow);
    load.then(setTemplate).catch(() => setTemplate(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.workflow_template_id, project?.workflow]);

  const markdown = useMemo(() => {
    if (!project || !template) return '';
    return toManuscriptMarkdown({ project, template, state: initialState(template), events: [], stages, evaluations: {} });
  }, [project, template, stages]);

  if (loading || (!project && !error)) return <p className="p-8 text-body">Loading…</p>;
  if (error || !project) return <p className="p-8 text-body">This project could not be loaded.</p>;

  return (
    <main className="mx-auto max-w-[720px] px-6 py-10 print:max-w-none print:px-0 print:py-0">
      <style>{`@media print { .print-hide { display: none } article h2 { break-before: page } @page { margin: 2cm } }`}</style>
      <div className="print-hide mb-6 flex flex-wrap items-center gap-3">
        <button
          onClick={() => window.print()}
          className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)]"
        >
          Print or save as PDF
        </button>
        <span className="text-label text-[var(--on-surface-variant)]">Choose “Save as PDF” as the printer.</span>
      </div>
      {markdown ? (
        <MarkdownOutput content={markdown} />
      ) : (
        <p className="text-body text-[var(--on-surface-variant)]">Nothing has been written yet.</p>
      )}
    </main>
  );
}
