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
  await expect(goPanel(page)).toContainText('A step is one thing PromptMaster does');
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
  // Accepted up front: a stage whose only open item is this approval is the
  // user's, and Go would stop there (4 Oct) instead of using its windows.
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  await criterion(page, 'I accept these hypotheses as the working set').getByRole('checkbox').check();

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
  await expect(page.getByRole('region', { name: 'What Go mode is doing' })).toContainText(/Check the objective is met|Nothing — the objective is met/, { timeout: 30_000 });
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

  // Only the user's approval is open, so Go asks for it at once — no
  // reasoning move first (4 Oct: Compare alternatives ×3 on an approval).
  const card = page.getByRole('region', { name: 'Go mode needs you' });
  await expect(card).toContainText('I need your approval before I can continue: "I accept these hypotheses as the working set"', { timeout: 30_000 });
  await expect(panel).not.toContainText('The model thinks the work is done');
  const [first] = await serviceSelect('agent_runs', `project_id=eq.${id}&select=id&order=created_at.desc&limit=1`);
  expect(await serviceSelect('agent_steps', `run_id=eq.${first.id}&select=action_key`)).toEqual([]);
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
  // Named in the words too (3 Oct call: "Press Generate Outline" where no
  // button exists): rewritten, never sent looking for it.
  await expect(ask).toContainText('Generate outline (there is no button for this on this page)');
  await expect(ask).not.toContainText('Press Generate Outline');
  await page.screenshot({ path: test.info().outputPath('01-invented-button-in-words-rewritten.png'), fullPage: true });
  const [step] = await serviceSelect('agent_steps', `project_id=eq.${id}&action_key=eq.request_user_decision&select=params`);
  expect(step.params.control).toBeUndefined();
});

/**
 * 2 Oct, item 9 — "Continue the stage and resume currently looks like a retry,
 * not a true continuation." The button cleared the block whatever had
 * happened since; Go took one step and stopped for the same reason. The card
 * now says whether anything changed and names each way forward for what it
 * is; a retry that stops at the same place says so and costs no step.
 */
test('a stuck stage says whether anything changed; a retry is called a retry; new data is a real resume', async ({ page }) => {
  const id = await createProject(page, {
    workflow: 'Research', name: 'E2E go stuck',
    objective: 'Why churn rose [[mock:plan=mark_blocked,mark_blocked]]',
  });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  // Question can advance as soon as it is drafted, and a stage that can
  // advance is not offered "stuck" (2 Oct, screenshot 2). Literature has a
  // blocking box only the user ticks, so there Go can still say it is stuck.
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Literature/ })).toBeVisible();
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();
  await page.getByRole('button', { name: 'Authorize and go' }).click();

  // The card is there at once — no second press of Resume to find it. At most
  // three ways forward, named for what they do (2 Oct screenshots: five on one
  // screen), and the footer names the stage bar's own button in its words.
  const card = page.getByRole('region', { name: 'Go mode needs you' });
  await expect(card).toContainText('Literature is marked stuck: Mock: missing data. Nothing in the project has changed since', { timeout: 30_000 });
  await expect(card.getByRole('button')).toHaveCount(3);
  await expect(card.getByRole('button', { name: 'Add the missing data' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Skip Literature for now' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Continue this stage by hand' })).toBeVisible();
  await expect(card.getByRole('button', { name: /Try again|Continue the stage/ })).toHaveCount(0);
  await expect(card).toContainText('use “Override and continue to Hypothesis” under More');
  // One surface: the stage's own "Stuck" notice and the "move on" suggestion stay out of it.
  await expect(page.getByText(/^Stuck — /)).toHaveCount(0);
  await expect(page.getByText(/^Move on to/)).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('01-stuck-three-ways-forward.png'), fullPage: true });
  const transparency = page.getByRole('region', { name: 'What Go mode is doing' });

  // "Add the missing data" goes to the Data panel; with a file attached the card says what changed.
  await card.getByRole('button', { name: 'Add the missing data' }).click();
  const data = page.getByRole('region', { name: 'Project data' });
  await expect(data).toBeInViewport();
  await data.getByLabel('Attach data files').setInputFiles({
    name: 'accounts.csv', mimeType: 'text/csv', buffer: Buffer.from('account_id,churned\nA1,1\nA2,0\n'),
  });
  await expect(data).toContainText('accounts.csv');
  await expect(card).toContainText('Literature is marked stuck: Mock: missing data. Since then, a data file was added.');
  await expect(card.getByRole('button', { name: 'Add the missing data' })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('03-stuck-inputs-changed.png'), fullPage: true });

  // The scripted planner marks it stuck once more — a new block, with the
  // file on record — and this time the user carries on by hand: the block is
  // lifted, Go stays stopped, and Resume is back. No step is spent on it.
  await card.getByRole('button', { name: 'Resume with what has changed' }).click();
  await expect(card).toContainText('Nothing in the project has changed since', { timeout: 30_000 });
  await expect(panel.getByLabel('Budget used')).toContainText('2 / 12 steps');
  await card.getByRole('button', { name: 'Continue this stage by hand' }).click();
  await expect(card).toHaveCount(0, { timeout: 30_000 });
  await expect(panel.getByRole('button', { name: /^Resume$/ })).toBeVisible();
  await expect(panel.getByLabel('Budget used')).toContainText('2 / 12 steps');
  await expect(transparency).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('02-continued-by-hand.png'), fullPage: true });

  const events = await serviceSelect('workflow_events', `project_id=eq.${id}&stage_id=eq.literature&select=type,payload&order=seq`);
  expect(events.map((e: { type: string }) => e.type).filter((t: string) => t.startsWith('stage_'))).toEqual(
    expect.arrayContaining(['stage_blocked', 'stage_unblocked', 'stage_blocked', 'stage_unblocked'])
  );
  const blocks = events.filter((e: { type: string }) => e.type === 'stage_blocked');
  expect(blocks[0].payload.inputs_at_block).toMatchObject({ files: [] });
});

/**
 * 2 Oct — "the big thing with the play button is that you should see it all
 * the time so you don't have to keep scrolling back and forth". While the Go
 * panel's own controls are scrolled out of view, a copy is pinned at the top
 * of the work column, and says when Go is waiting for the user.
 */
/**
 * 2 Oct, screenshot 7 — the execution log showed the same move repeated down
 * the screen before "Could not continue". Identical consecutive steps are now
 * one row with a count, and the run stops on its own when it goes round in
 * circles.
 */
test('repeated identical steps fold into one row, and the run stops rather than repeat a fourth time', async ({ page }) => {
  await createProject(page, {
    workflow: 'Research', name: 'E2E go repeats',
    objective: 'Pendulum [[mock:plan=derive,derive,derive,derive]]',
  });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();
  await page.getByRole('button', { name: 'Authorize and go' }).click();

  const transparency = page.getByRole('region', { name: 'What Go mode is doing' });
  await expect(transparency).toContainText('was chosen 3 times in a row on this stage without changing it', { timeout: 60_000 });
  const steps = page.getByRole('list', { name: 'Go mode steps' });
  await expect(steps.locator('[data-repeats="3"]')).toHaveCount(1);
  await expect(steps.locator('[data-repeats="3"]')).toContainText('×3');
  await expect(steps.getByRole('listitem')).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath('01-repeated-steps-fold-into-one-row.png'), fullPage: true });
});

test('the Go buttons stay in view while the page is scrolled, and point back when Go needs the user', async ({ page }) => {
  await createProject(page, { workflow: 'Research', name: 'E2E go dock', objective: 'Pendulum [[mock:plan=derive,prove]]' });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Guided/ }).click();
  // Nothing is pinned while the panel's own controls are on screen.
  await expect(page.getByRole('region', { name: 'Go buttons' })).toHaveCount(0);

  await page.keyboard.press('End');
  const dock = page.getByRole('region', { name: 'Go buttons' });
  await expect(dock).toBeVisible();
  await expect(dock).toBeInViewport();
  await expect(dock.getByRole('button', { name: /^Go$/ })).toBeVisible();
  await expect(dock.getByLabel('Step budget')).toHaveValue('12');
  await page.screenshot({ path: test.info().outputPath('01-go-controls-pinned.png') });

  // Go from the pinned copy; the proposal waits on the panel, and the copy says so.
  await dock.getByRole('button', { name: /^Go$/ }).click();
  await expect(page.getByRole('region', { name: 'Go mode needs your approval' })).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('End');
  await expect(dock.getByRole('button', { name: 'Go needs you — show' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('02-go-needs-you-pinned.png') });
  await dock.getByRole('button', { name: 'Go needs you — show' }).click();
  await expect(panel.getByRole('region', { name: 'Go mode needs your approval' })).toBeInViewport();
  await expect(page.getByRole('region', { name: 'Go buttons' })).toHaveCount(0);
});
