import { expect, test, type Page } from '@playwright/test';

import { createProject, pressTransition, serviceSelect, stageArtifact } from './helpers';

/**
 * Q2 — Sean, 9 Oct: "if Analysis identifies that further investigation is
 * needed, Go should return to Experiment or investigation, perform the
 * relevant work it can, save the results, and rerun the affected analysis
 * and checks." Under Autonomous with routine decisions handed to Go, the
 * return is Go's, recorded with its reason, and the work it names is added
 * to Experiment as a new version.
 */

function goPanel(page: Page) {
  return page.getByRole('region', { name: 'Go mode', exact: true });
}

test('from Analysis, Go goes back to Experiment with its reason, and adds the work there', async ({ page }) => {
  test.setTimeout(300_000);
  const id = await createProject(page, {
    workflow: 'Research', name: 'E2E go return',
    objective: 'Pendulum period against amplitude, inconclusive without further runs [[mock:plan=return_to_stage]]',
  });

  const analysis = page.locator('header').getByRole('heading', { name: 'Analysis', exact: true });
  for (let i = 0; i < 8 && !(await analysis.isVisible().catch(() => false)); i += 1) {
    await pressTransition(page);
    await page.waitForTimeout(1_200);
  }
  await expect(analysis).toBeVisible();
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  const before = await serviceSelect('artifact_versions', `project_id=eq.${id}&select=id,artifact_id`);

  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Handle them for me/ }).click();
  await expect.poll(async () => (await serviceSelect('projects', `id=eq.${id}&select=routine_decisions`))[0].routine_decisions).toBe('handle');
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();
  await page.getByRole('button', { name: 'Authorize and go' }).click();

  await expect.poll(
    async () => (await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.stage_returned&select=actor,stage_id,to_stage_id,agent_run_id,payload`)).length,
    { timeout: 120_000 }
  ).toBe(1);
  const [returned] = await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.stage_returned&select=actor,stage_id,to_stage_id,agent_run_id,payload`);
  expect(returned).toMatchObject({
    actor: 'system', stage_id: 'analysis', to_stage_id: 'experiment',
    payload: { agent_return: true, return_reason: expect.stringContaining('fourth run'), work: expect.stringContaining('run 4') },
  });
  expect(returned.agent_run_id).toBeTruthy();

  await expect(page.locator('header').getByRole('heading', { name: /Experiment/ })).toBeVisible({ timeout: 30_000 });
  // The work named is on Experiment as a new version.
  await expect.poll(async () => (await serviceSelect('artifact_versions', `project_id=eq.${id}&select=id`)).length, { timeout: 60_000 })
    .toBeGreaterThan(before.length);
  const [step] = await serviceSelect('agent_steps', `run_id=eq.${returned.agent_run_id}&action_key=eq.return_to_stage&select=status,output,changes`);
  expect(step.status).toBe('succeeded');
  expect(step.output).toContain('Went back to Experiment or investigation');
  await page.screenshot({ path: test.info().outputPath('01-go-went-back-to-experiment.png'), fullPage: true });
});
