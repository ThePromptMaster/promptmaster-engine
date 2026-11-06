import { expect, test, type Page } from '@playwright/test';

import { createProject, pressTransition, serviceInsert, serviceSelect, stageArtifact } from './helpers';

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
    objective: 'Does a pendulum period depend on amplitude [[mock:plan=return_to_stage]]',
  });

  const analysis = page.locator('header').getByRole('heading', { name: 'Analysis', exact: true });
  for (let i = 0; i < 8 && !(await analysis.isVisible().catch(() => false)); i += 1) {
    await pressTransition(page);
    await page.waitForTimeout(1_200);
  }
  await expect(analysis).toBeVisible();
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  // The analysis says what it cannot yet decide, as a saved version.
  const [art] = await serviceSelect('artifacts', `project_id=eq.${id}&stage_id=eq.analysis&select=id,user_id`);
  await serviceInsert('artifact_versions', {
    user_id: art.user_id, project_id: id, artifact_id: art.id, source_operation: 'stage_edit', instruction: '', model: '', mode: 'analyst',
    content: '## Analysis\n\nH1 is supported by runs 1–3. H2 is inconclusive: the period at 75 degrees was not computed, so further runs are needed.',
  });
  await page.reload();
  await expect(stageArtifact(page)).toContainText('inconclusive', { timeout: 30_000 });
  const before = await serviceSelect('artifact_versions', `project_id=eq.${id}&select=id,artifact_id`);

  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Handle them for me/ }).click();
  await expect.poll(async () => (await serviceSelect('projects', `id=eq.${id}&select=routine_decisions`))[0].routine_decisions).toBe('handle');
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();

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
  // The new version lands before the step is closed: wait for the step.
  const stepOf = async () => (await serviceSelect('agent_steps', `run_id=eq.${returned.agent_run_id}&action_key=eq.return_to_stage&select=status,output,changes`))[0];
  await expect.poll(async () => (await stepOf())?.status, { timeout: 60_000 }).toBe('succeeded');
  const step = await stepOf();
  expect(step.output).toContain('Went back to Experiment or investigation');
  await page.screenshot({ path: test.info().outputPath('01-go-went-back-to-experiment.png'), fullPage: true });
});

/**
 * 6 Nov, production pass: on Final review Go asked a question, the answer meant
 * changing the note on Output without saying "go back", and Go asked how to do it
 * and pointed at a button. Straight after an answer the way back is on offer on any
 * workflow; the return is recorded as Go's, because the reading of the answer is.
 */
test('straight after an answer about earlier work, Go goes back there itself, on a workflow that is no investigation', async ({ page }) => {
  test.setTimeout(300_000);
  const id = await createProject(page, {
    workflow: 'Single output', name: 'E2E go back after an answer',
    objective: 'A short staff note about the offsite [[mock:plan=request_user_decision,return_to_stage]]',
  });
  await pressTransition(page); // input
  await pressTransition(page); // review
  await expect(page.getByText('Mock output').first()).toBeVisible({ timeout: 30_000 });

  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Handle them for me/ }).click();
  await expect.poll(async () => (await serviceSelect('projects', `id=eq.${id}&select=routine_decisions`))[0].routine_decisions).toBe('handle');
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();

  // Set aside while the work could move on, so it is asked where the project asked it: on Final review.
  const ask = page.getByRole('region', { name: 'Go mode asks you' });
  await expect(ask).toContainText('Mock: which way should this go?', { timeout: 120_000 });
  await expect(page.locator('header').getByRole('heading', { name: 'Final review', exact: true })).toBeVisible();
  await ask.getByLabel('Your answer').fill('Keep every word at seven letters and leave the venue and finish time out.');
  await ask.getByRole('button', { name: 'Answer and continue' }).click();

  await expect.poll(
    async () => (await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.stage_returned&select=id`)).length,
    { timeout: 60_000 }
  ).toBe(1);
  const [returned] = await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.stage_returned&select=actor,stage_id,to_stage_id,agent_run_id,payload`);
  expect(returned).toMatchObject({ actor: 'system', stage_id: 'summary', to_stage_id: 'output', payload: { agent_return: true } });
  await expect(page.locator('header').getByRole('heading', { name: 'Output and evaluation', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath('01-went-back-after-the-answer.png'), fullPage: true });
});
