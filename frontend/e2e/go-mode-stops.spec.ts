import { expect, test, type Page } from '@playwright/test';

import { createProject, criterion, pressTransition, serviceSelect, stageArtifact } from './helpers';

/**
 * 1 Oct, items 1, 21 and 22 — a stop the run recorded is checked against the
 * project, and the window on show is the run's own.
 *
 * "Go sometimes continued to display an old human request after the project
 * appeared to have advanced." "Resume still sometimes feels unpredictable."
 * "The selected window said 12 steps while progress referenced 25."
 */

function goPanel(page: Page) {
  return page.getByRole('region', { name: 'Go mode', exact: true });
}

test('a request the user satisfies on the stage itself clears, and Resume carries on', async ({ page }) => {
  test.setTimeout(120_000);
  const id = await createProject(page, { workflow: 'Book', name: 'E2E go stale request', objective: 'A short book about tapirs [[mock:plan=advance_stage]]' });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await pressTransition(page);
  await expect(stageArtifact(page).getByText(/Mock /).first()).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Positioning/ })).toBeVisible();
  await expect(stageArtifact(page).getByText(/Mock /).first()).toBeVisible({ timeout: 30_000 });

  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();
  await page.getByRole('button', { name: 'Authorize and go' }).click();

  // Positioning's one required item is the user's to confirm: the run stops and asks.
  const card = page.getByRole('region', { name: 'Go mode needs you' });
  await expect(card).toContainText('I need your approval before I can continue', { timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath('01-go-asks-for-the-confirmation.png'), fullPage: true });
  const [asked] = await serviceSelect('agent_runs', `project_id=eq.${id}&select=id,needs&order=created_at.desc&limit=1`);
  expect(asked.needs).toMatchObject({ kind: 'tick_criterion', onStage: 'positioning' });

  // The user does it on the stage, not through the card.
  await criterion(page, 'differentiator').getByRole('checkbox').check();

  await expect(card).toBeHidden({ timeout: 15_000 });
  await expect(panel.getByRole('status').filter({ hasText: 'That is done. Press Resume and I will carry on.' })).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Resume$/ })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('02-request-cleared-resume-offered.png'), fullPage: true });
  const [cleared] = await serviceSelect('agent_runs', `id=eq.${asked.id}&select=needs,status`);
  expect(cleared.needs).toBeNull();

  await panel.getByRole('button', { name: /^Resume$/ }).click();
  await expect(page.getByRole('heading', { name: /Research/ })).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath('03-resumed-and-moved-on.png'), fullPage: true });
});

test('after a reload the window selector and the progress count show the same run', async ({ page }) => {
  await createProject(page, { workflow: 'Research', name: 'E2E go window', objective: 'Pendulum [[mock:plan=derive,prove]]' });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Guided/ }).click();
  await panel.getByLabel('Step budget').selectOption('25');
  await panel.getByRole('button', { name: /^Go$/ }).click();
  await expect(page.getByRole('region', { name: 'Go mode needs your approval' })).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await expect(page.getByRole('region', { name: 'Go mode needs your approval' })).toBeVisible({ timeout: 30_000 });
  await expect(goPanel(page).getByLabel('Step budget')).toHaveValue('25');
  await expect(goPanel(page).getByLabel('Budget used')).toContainText('0 / 25 steps this window');
  await expect(goPanel(page)).toContainText('A step is one action PromptMaster performs');
  await page.screenshot({ path: test.info().outputPath('01-window-matches-after-reload.png'), fullPage: true });
});

/**
 * 1 Oct, item 20 — "The project-level loop should be persistent even if
 * individual Go runs have 5/12/25-step windows … keep going across sessions
 * without losing objective, decisions, accepted findings, rejected routes."
 */
test('the planner is told what the user already decided, and an autonomous run can be authorized for further windows', async ({ page }) => {
  test.setTimeout(120_000);
  const id = await createProject(page, {
    workflow: 'Research', name: 'E2E go memory',
    objective: 'Pendulum [[mock:plan=derive,prove,simplify,limiting_case,try_contradiction,falsify_hypothesis,compare_alternatives]]',
  });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: 'Literature context' })).toBeVisible();

  // A route not taken, with its reason: skip Literature.
  await page.getByRole('group', { name: 'Stage actions' }).getByRole('button', { name: /^More/ }).click();
  await page.getByRole('menuitem', { name: 'Skip this stage' }).click();
  await page.getByPlaceholder('Or write your own reason').fill('Internal diagnosis; outside reading can wait.');
  await page.getByRole('button', { name: 'Skip stage' }).click();
  await expect(page.getByRole('heading', { name: 'Hypothesis or proposition' })).toBeVisible();

  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  await panel.getByLabel('Step budget').selectOption('5');
  const planned = page.waitForRequest((r) => r.url().includes('/api/agent/next-action') && r.method() === 'POST');
  await panel.getByRole('button', { name: /^Go$/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Authorize Go mode' });
  await dialog.getByLabel('Further windows without asking').selectOption('1');
  await expect(dialog).toContainText('At most 10 steps before it stops and asks.');
  await page.screenshot({ path: test.info().outputPath('01-authorize-further-windows.png') });
  await dialog.getByRole('button', { name: 'Authorize and go' }).click();

  // The first planning call already knows the skip and why.
  const { state } = (await planned).postDataJSON();
  expect(state.memory).toContain('Skipped Literature context: Internal diagnosis; outside reading can wait.');

  // Window one is used up; the second starts on its own, and is on the record as such.
  await expect
    .poll(async () => (await serviceSelect('agent_runs', `project_id=eq.${id}&select=id,continues_run_id,status&order=created_at`)).length, { timeout: 60_000 })
    .toBe(2);
  const runs = await serviceSelect('agent_runs', `project_id=eq.${id}&select=id,continues_run_id,status,authorization_id&order=created_at`);
  expect(runs[0].status).toBe('budget_exhausted');
  expect(runs[1].continues_run_id).toBe(runs[0].id);
  const decisions = await serviceSelect('decisions', `recommendation_id=eq.${runs[0].authorization_id}&select=metadata,rationale&order=created_at`);
  expect(decisions[0].metadata).toMatchObject({ auto_continue_windows: 1 });
  expect(decisions[1].metadata).toMatchObject({ continues_run_id: runs[0].id, auto: true });
  expect(decisions[1].rationale).toContain('on its own, as authorized in advance');
  await expect(page.getByRole('region', { name: 'What Go mode is doing' })).toContainText(/Objective complete|Nothing — the objective is met/, { timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath('02-second-window-ran-on-its-own.png'), fullPage: true });
});
