import { expect, test } from '@playwright/test';

import { createProject, serviceSelect, stageArtifact } from './helpers';

/**
 * E1 (Sean, 5 Oct): "measure model/tool costs, elapsed time, … retries, and
 * repair work." Every model call a Go move makes is recorded against that move
 * and its step, with how long it took and whether it was a retry or a repair.
 */
test('a Go move\'s model calls are recorded with the move, the step and their time', async ({ page }) => {
  test.setTimeout(120_000);
  const id = await createProject(page, { workflow: 'Research', name: 'E2E usage detail', objective: 'Why customers churn [[mock:plan=evaluate_stage]]' });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });

  const panel = page.getByRole('region', { name: 'Go mode', exact: true });
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Guided/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();
  const prompt = page.getByRole('region', { name: 'Go mode needs your approval' });
  await expect(prompt).toContainText('Check this stage', { timeout: 30_000 });
  await prompt.getByRole('button', { name: 'Approve' }).click();

  const [step] = await (async () => {
    await expect
      .poll(async () => (await serviceSelect('agent_steps', `project_id=eq.${id}&action_key=eq.evaluate_stage&select=status`))[0]?.status, { timeout: 30_000 })
      .toBe('succeeded');
    return serviceSelect('agent_steps', `project_id=eq.${id}&action_key=eq.evaluate_stage&select=id`);
  })();
  await expect
    .poll(async () => (await serviceSelect('model_usage', `agent_step_id=eq.${step.id}&select=id`)).length, { timeout: 15_000 })
    .toBeGreaterThan(0);
  const rows = await serviceSelect('model_usage', `agent_step_id=eq.${step.id}&select=operation,attempt,elapsed_ms,project_id,route`);
  for (const r of rows) {
    expect(r).toMatchObject({ operation: 'go:evaluate_stage', attempt: 'first', project_id: id });
    expect(r.elapsed_ms).toBeGreaterThanOrEqual(0);
  }
  // Calls outside a Go move carry their route as the operation.
  const draft = await serviceSelect('model_usage', `project_id=eq.${id}&agent_step_id=is.null&select=operation,route&limit=1`);
  expect(draft[0].operation).toBe(draft[0].route);
});
