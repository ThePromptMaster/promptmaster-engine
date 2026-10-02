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

/**
 * Production pass, 2026-10-02 — an Autonomous run on Research reached a stage
 * whose one requirement was the user's approval. It may not move past that by
 * itself, and on Research there is always some reasoning move on offer, so
 * the "I need your approval" stop never fired: the planner "declared the
 * objective complete" instead, twice, and the run ended on "the model thinks
 * the work is done". It now asks for the approval, with the button.
 */
test('on Research, "nothing more for me here" on a stage waiting for approval becomes the approval request', async ({ page }) => {
  test.setTimeout(120_000);
  const id = await createProject(page, { workflow: 'Research', name: 'E2E go asks for approval', objective: 'Why pendulums slow down [[mock:plan=derive]]' });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  for (const heading of ['Literature context', 'Hypothesis or proposition']) {
    await pressTransition(page);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  }

  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();
  await page.getByRole('button', { name: 'Authorize and go' }).click();

  // One reasoning move, then the scripted planner says the objective is met.
  const card = page.getByRole('region', { name: 'Go mode needs you' });
  await expect(card).toContainText('I need your approval before I can continue: "I accept these hypotheses as the working set"', { timeout: 30_000 });
  await expect(panel).toContainText('has nothing left that I can do by myself. It is waiting for your approval');
  await expect(panel).not.toContainText('The model thinks the work is done');
  await page.screenshot({ path: test.info().outputPath('03-research-asks-for-the-approval.png'), fullPage: true });
  const [run] = await serviceSelect('agent_runs', `project_id=eq.${id}&select=status,needs&order=created_at.desc&limit=1`);
  expect(run).toMatchObject({ status: 'awaiting_decision', needs: { kind: 'tick_criterion', onStage: 'hypothesis' } });

  // The card's button gives the approval, as the user, and the run carries on.
  await card.getByRole('button', { name: 'Approve and resume' }).click();
  await expect(criterion(page, 'I accept these hypotheses as the working set').getByRole('checkbox')).toBeChecked({ timeout: 30_000 });
  await expect(card).toHaveCount(0);
});

/**
 * 2 Oct, item 10 — Go told the user "if your interface has that control,
 * press Generate the outline/results artifact", on a page with no such
 * button. The planner is now given the buttons that are on the page, built
 * from the same values the page draws them from, and a button it names is
 * kept only if it is one of them.
 */
test('Go is given the buttons that are really on the page, and may name only those', async ({ page }) => {
  await createProject(page, {
    workflow: 'Research', name: 'E2E go controls',
    objective: 'Pendulum [[mock:plan=request_user_decision]] [[mock:control=listed]]',
  });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  const planned = page.waitForRequest((r) => r.url().includes('/api/agent/next-action') && r.method() === 'POST');
  await panel.getByRole('button', { name: /^Go$/ }).click();
  await page.getByRole('button', { name: /^Authorize/ }).click();
  const { state } = (await planned).postDataJSON();
  const controls: { label: string; where: string }[] = state.controls;
  expect(controls.length).toBeGreaterThan(3);

  // The question names the first listed button, with where it is, in fixed words.
  const ask = page.getByRole('region', { name: 'Go mode asks you' });
  await expect(ask).toContainText(`The button is "${controls[0].label}", ${controls[0].where}.`, { timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath('01-go-names-a-real-button.png'), fullPage: true });

  // Every button Go was told about is on the page, under the words it was given.
  const bar = page.getByRole('group', { name: 'Stage actions' });
  await bar.getByRole('button', { name: /^More/ }).click();
  for (const c of controls) {
    if (c.where.includes('checklist')) await expect(page.getByRole('checkbox', { name: c.label })).toBeVisible();
    else await expect(page.getByRole('button', { name: c.label, exact: true }).or(page.getByRole('menuitem', { name: c.label, exact: true })).first()).toBeVisible();
  }
  await page.screenshot({ path: test.info().outputPath('02-the-listed-buttons-are-on-the-page.png'), fullPage: true });
});

test('a button Go invents is dropped, not shown to the user as if it existed', async ({ page }) => {
  const id = await createProject(page, {
    workflow: 'Research', name: 'E2E go invented control',
    objective: 'Pendulum [[mock:plan=request_user_decision]] [[mock:control=invented]]',
  });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();
  await page.getByRole('button', { name: /^Authorize/ }).click();
  const ask = page.getByRole('region', { name: 'Go mode asks you' });
  await expect(ask).toContainText('Mock: which way should this go?', { timeout: 30_000 });
  await expect(ask).not.toContainText('The button is');
  const [step] = await serviceSelect('agent_steps', `project_id=eq.${id}&action_key=eq.request_user_decision&select=params`);
  expect(step.params.control).toBeUndefined();
});
