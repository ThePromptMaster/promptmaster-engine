import { expect, test } from '@playwright/test';

import { createProject, pressTransition, serviceSelect, stageArtifact } from './helpers';

/**
 * A Research project from the first stage to the finished screen, in one
 * pass (the 1 Oct plan's verification list). Each piece has its own test;
 * this one is about them holding together on a single project:
 *
 *   Experiment arrives with the run the draft knew was not run already marked →
 *   on Drafting, Go builds the outline from the stages, stops for the user's
 *   approval, then drafts the sections → the project is finished, and the
 *   finished screen calls it a research report in sections, never a book.
 */
test('Research, start to finish: prefilled runs, Go derives and drafts the report, and it finishes as a research report', async ({ page }) => {
  test.setTimeout(420_000);
  const id = await createProject(page, {
    workflow: 'Research', name: 'E2E research end to end',
    objective: 'Why pendulums slow down [[mock:plan=generate_outline,draft_sections]]',
  });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });

  // Question → Experiment.
  for (const heading of ['Literature context', 'Hypothesis or proposition', 'Method', 'Experiment or investigation']) {
    await pressTransition(page);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  }
  // What the draft already knew is on the row, as the model's word, with its reason.
  await expect(stageArtifact(page).getByRole('row').nth(1)).toContainText('Not run');
  await expect(stageArtifact(page).getByRole('row').nth(1)).toContainText('Set by PromptMaster');
  // (The legend under the table names every status; the rows are what is checked.)
  await expect(stageArtifact(page).getByRole('combobox').filter({ hasText: 'Completed' })).toHaveCount(0);

  // Experiment → Drafting.
  const drafting = page.locator('header').getByRole('heading', { name: 'Drafting', exact: true });
  for (let i = 0; i < 8 && !(await drafting.isVisible().catch(() => false)); i += 1) {
    await pressTransition(page);
    await page.waitForTimeout(1_200);
  }
  await expect(drafting).toBeVisible();

  // Go builds the outline from the stages, and stops for the approval that is the user's.
  const panel = page.getByRole('region', { name: 'Go mode', exact: true });
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Guided/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();
  const prompt = page.getByRole('region', { name: 'Go mode needs your approval' });
  await expect(prompt).toContainText('Generate the outline', { timeout: 30_000 });
  await prompt.getByRole('button', { name: 'Approve' }).click();
  const card = page.getByRole('region', { name: 'Go mode needs you' });
  await expect(card).toContainText(/I need your approval of (the outline|outline version 1)/, { timeout: 30_000 });
  await card.getByRole('button', { name: /pprove the outline/ }).click();
  await expect(prompt).toContainText('Draft the sections', { timeout: 30_000 });
  await prompt.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/(\d+) of \1 sections written/)).toBeVisible({ timeout: 180_000 });
  await page.screenshot({ path: test.info().outputPath('01-report-drafted-by-go.png'), fullPage: true });

  // The run has done what it was for; the rest is the user's walk to the end.
  // (The scripted planner next proposes declaring the objective met; that is declined.)
  await expect(prompt).toContainText('Objective complete', { timeout: 30_000 });
  await prompt.getByRole('button', { name: 'Decline' }).click();
  await expect(prompt).toHaveCount(0);

  const finished = page.getByRole('region', { name: 'Your finished work' });
  for (let i = 0; i < 4 && !(await finished.isVisible().catch(() => false)); i += 1) {
    await pressTransition(page);
    await page.waitForTimeout(1_500);
  }
  await expect(finished.getByRole('heading', { name: 'Your research report is complete' })).toBeVisible();
  await expect(finished).toContainText(/\d+ sections · [\d,]+ words/);
  await expect(finished.getByRole('button', { name: 'Read the full research report' })).toBeVisible();
  await expect(finished.getByRole('button', { name: 'Start a new version' })).toBeVisible();
  await expect(finished).not.toContainText(/\bbook\b|chapter/i);
  await finished.getByRole('button', { name: 'Read the full research report' }).click();
  await expect(finished.getByRole('heading', { name: /Introduction/ }).first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('02-finished-as-a-research-report.png'), fullPage: true });

  const [project] = await serviceSelect('projects', `id=eq.${id}&select=status`);
  expect(project.status).toBe('finalized');
  const events = await serviceSelect('workflow_events', `project_id=eq.${id}&select=type,actor&order=seq`);
  expect(events.at(-1)).toMatchObject({ type: 'project_finalized', actor: 'user' });
  // The one approval in the run was the user's.
  expect(events.filter((e: { type: string }) => e.type === 'outline_approved')).toEqual([{ type: 'outline_approved', actor: 'user' }]);
  const [run] = await serviceSelect('agent_runs', `project_id=eq.${id}&select=id,status&order=created_at.desc&limit=1`);
  const steps = await serviceSelect('agent_steps', `run_id=eq.${run.id}&select=action_key,status&order=idx`);
  expect(steps.slice(0, 2)).toEqual([
    { action_key: 'generate_outline', status: 'succeeded' },
    { action_key: 'draft_sections', status: 'succeeded' },
  ]);
});
