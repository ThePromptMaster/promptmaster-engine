import { expect, test } from '@playwright/test';

import { createProject, pressTransition, serviceSelect } from './helpers';

/**
 * M2 (Sean, 4 Oct): Go is driven by what the stage itself still requires.
 *
 * On a custom workflow's Diagnosis stage there were four open findings and a
 * draft that had been cut off, yet Go chose Compare alternatives three times
 * and stopped. The order now is: finish the cut-off draft; apply the check's
 * findings; check again; and when only the user's approval is left, ask for
 * it — before any optional move.
 */
test('a cut-off draft with findings: continue, check, apply — then ask for the approval', async ({ page }) => {
  test.setTimeout(180_000);
  const id = await createProject(page, {
    workflow: 'Book', name: 'E2E go required work',
    objective: 'A book about giraffes [[mock:length]] [[mock:findings=2]]',
  });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  for (const heading of ['Audience', 'Positioning']) {
    await pressTransition(page);
    await expect(page.locator('header').getByRole('heading', { name: new RegExp(heading) })).toBeVisible();
  }
  // Positioning's draft was cut off; its one required item is the user's.
  await expect(page.getByRole('group', { name: 'Stage actions' }).getByRole('button', { name: 'Continue writing' })).toBeVisible({ timeout: 30_000 });

  const panel = page.getByRole('region', { name: 'Go mode', exact: true });
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();
  await page.getByRole('button', { name: 'Authorize and go' }).click();

  const card = page.getByRole('region', { name: 'Go mode needs you' });
  await expect(card).toContainText('I confirm the one-sentence differentiator is stated', { timeout: 120_000 });
  await page.getByRole('region', { name: 'What Go mode is doing' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('01-required-work-then-the-approval.png'), fullPage: true });

  const [run] = await serviceSelect('agent_runs', `project_id=eq.${id}&select=id,status,needs&order=created_at.desc&limit=1`);
  expect(run).toMatchObject({ status: 'awaiting_decision', needs: { kind: 'tick_criterion' } });
  const steps = (await serviceSelect('agent_steps', `run_id=eq.${run.id}&select=action_key,status,rationale&order=idx`)) as {
    action_key: string; status: string; rationale: string;
  }[];
  // Finished first, then checked, then the findings applied.
  expect(steps.slice(0, 3).map((s) => s.action_key)).toEqual(['continue_writing', 'evaluate_stage', 'apply_findings']);
  expect(steps[0].rationale).toContain('cut off');
  expect(steps.every((s) => s.status === 'succeeded')).toBe(true);
  // Every move was one of the stage's own requirements; none was optional.
  expect(new Set(steps.map((s) => s.action_key))).toEqual(new Set(['continue_writing', 'evaluate_stage', 'apply_findings']));
});
