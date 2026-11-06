import type { StartImage } from '@/components/projects/start-attachments';
import { prepareFiles, type PreparedFile } from '@/lib/data/attachments';
import { imagePreview } from '@/lib/data/preview';
import { createClient } from '@/lib/supabase/client';
import { attachProjectFile } from '@/lib/supabase/project-files';
import { createProject, hardDeleteProject } from '@/lib/supabase/projects';
import { appendVersion, createArtifact } from '@/lib/supabase/versions';
import { appendWorkflowEvent, publishUserTemplate } from '@/lib/supabase/workflow';
import { validateTemplate } from '@/lib/workflow/validate';
import type { LanguageCode } from '@/lib/workflow/languages';

import { PREPARED_OPERATION } from './cards';
import { exampleWorkflow, type Example } from './index';

/**
 * Make a project from an example, and say which.
 *
 * With no `own`, it is the sample: the first stage already written, marked as an
 * example so nothing drafts on its own (`use-stage-generation.ts`), and with web
 * access off, because nobody should search for a company that does not exist.
 * Routine approvals are Go's, so a run stops only where the decision is the
 * user's. With `own`, it is the same workflow on the user's work and from there
 * an ordinary project.
 *
 * Several writes, not one transaction, like the start screen's: a failure part
 * way takes the half-made project back out, so a retry starts clean.
 */
export async function startExample(
  example: Example,
  userId: string,
  { language, own }: {
    language: LanguageCode;
    own?: { title: string; objective: string; context: string; files: PreparedFile[]; images: StartImage[] };
  }
): Promise<string> {
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  const draft = exampleWorkflow(example, suffix);
  const problems = validateTemplate(draft);
  if (problems.length) throw new Error(problems[0]);
  const template = await publishUserTemplate(draft, userId, { listed: false });
  const first = template.stages[0];

  const project = await createProject(
    {
      ...example.project,
      ...(own ? { title: own.title, objective: own.objective, context: own.context, audience: '', constraints: '' } : {}),
      workflow: template.key,
      language,
    },
    userId
  );

  try {
    const { error } = await createClient()
      .from('projects')
      .update({
        workflow_template_id: template.id,
        stage: first?.id ?? '',
        ...(own ? {} : { example_key: example.key, web_access: 'off', routine_decisions: 'handle' }),
      })
      .eq('id', project.id);
    if (error) throw error;

    await createArtifact(project.id, userId, 'output', 'Output');
    await appendWorkflowEvent(project.id, userId, { type: 'project_created', stage_id: first?.id ?? '' });

    if (own) {
      for (const { file, preview } of own.files) await attachProjectFile(project, file, preview);
      for (const { file, caption } of own.images) await attachProjectFile(project, file, imagePreview(file.name, caption, 0, 0));
      return project.id;
    }

    if (first) {
      const artifact = await createArtifact(project.id, userId, 'output', first.label, first.id);
      await appendVersion(artifact, {
        content: example.prepared,
        source_operation: PREPARED_OPERATION,
        mode: example.project.mode,
        change_summary: 'Prepared for this example. No model wrote it.',
      });
    }
    for (const { name, text } of example.files ?? []) {
      const { ready, errors } = await prepareFiles([new File([text], name, { type: 'text/csv' })], []);
      if (errors.length) throw new Error(errors[0]);
      for (const { file, preview } of ready) await attachProjectFile(project, file, preview);
    }
    return project.id;
  } catch (e) {
    await hardDeleteProject(project.id).catch(() => undefined);
    throw e;
  }
}
