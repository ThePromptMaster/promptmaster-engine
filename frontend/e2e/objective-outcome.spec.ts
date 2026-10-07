import { expect, test, type Page } from '@playwright/test';

import { createProject, pressTransition, serviceSelect } from './helpers';

/**
 * O2/O3 — Sean, 6 Oct, email 13: "The final research log correctly says the
 * mathematical success criterion is 'Not met' … But Go marked 'Objective
 * complete' and said 'Objective met.' … When a cycle ends with an unmet
 * project objective and a documented blocker, the project should remain
 * blocked or paused, preserve the missing-input requirements … The stage
 * evaluator, Go status, and completion message should agree." And email 10:
 * the side chat "could not inspect the autonomous execution trace".
 *
 * `[[mock:objective=unmet]]` makes the scripted objective check say "not met",
 * naming the missing formulas as the blocker.
 */
function goPanel(page: Page) {
  return page.getByRole('region', { name: 'Go mode' });
}

test('a finished cycle with an unmet objective pauses on its blocker; chat answers from the run record', async ({ page }) => {
  test.setTimeout(120_000);
  const id = await createProject(page, {
    workflow: 'Single output',
    name: 'E2E objective not met',
    objective: 'Find whether the Hessian is positive definite [[mock:plan=declare_objective_complete]] [[mock:objective=unmet]]',
  });
  await pressTransition(page); // input
  await pressTransition(page); // review
  await expect(page.getByText('Mock output').first()).toBeVisible({ timeout: 30_000 });

  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();
  await page.getByRole('button', { name: 'Authorize and go' }).click();

  // Not "Objective met": paused, with what it waits for.
  const paused = page.getByRole('status', { name: 'Objective not met' });
  await expect(paused).toContainText('Paused — the objective is not met', { timeout: 30_000 });
  await expect(paused).toContainText('the exact formulas and their parameterisation');
  await expect(paused).toContainText('Proposed, not done: Compute the Hessian once the formulas are supplied.');
  // A step id the run never recorded is not reported as done.
  await expect(paused).toContainText('Done: no computation or investigation was recorded as performed');
  await paused.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('01-paused-not-met.png') });

  const [run] = await serviceSelect('agent_runs', `project_id=eq.${id}&select=status,stop_reason&order=created_at.desc&limit=1`);
  expect(run.status).toBe('blocked');
  expect(run.stop_reason).toContain('Waiting for: the exact formulas');
  const [assessed] = await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.objective_assessed&select=actor,payload`);
  expect(assessed).toMatchObject({ actor: 'system', payload: { outcome: 'not_met' } });

  // The stage bar agrees: the objective is still open.
  await expect(page.getByRole('group', { name: 'Stage actions' })).toContainText('The objective is not met — waiting for: the exact formulas');

  // The side chat is given the run record, so "why did it stop?" is answered from it.
  const chat = page.getByRole('region', { name: 'Side chat' });
  const sent = page.waitForRequest((r) => r.url().endsWith('/api/chat-message'));
  await chat.getByRole('textbox', { name: 'Ask a question' }).fill('Why did Go stop?');
  await chat.getByRole('button', { name: 'Ask' }).click();
  const body = (await sent).postDataJSON() as { context?: { go_run?: { status: string; stop_reason: string; steps: { action: string }[]; objective: string } } };
  expect(body.context?.go_run?.status).toBe('blocked');
  expect(body.context?.go_run?.stop_reason).toContain('Waiting for: the exact formulas');
  expect(body.context?.go_run?.steps.map((s) => s.action)).toContain('declare_objective_complete');
  expect(body.context?.go_run?.objective).toMatch(/^not met/);
});
