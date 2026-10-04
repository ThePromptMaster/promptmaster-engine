import { expect, test, type Page } from '@playwright/test';

import { createProject, pressTransition, serviceSelect, stageArtifact } from './helpers';

/**
 * B4 — Go mode (PM-12, PM-15, PM-17 … PM-20), end to end in the browser.
 *
 * The planner is the scripted mock: `[[mock:plan=a,b,c]]` in the objective
 * makes it choose those moves in order, then declare the objective complete.
 * Code runs in the scripted sandbox (SANDBOX_MODE=mock). Everything else — the
 * run and step rows, the authorization, the database's label and stage-move
 * checks — is real.
 */

function goPanel(page: Page) {
  return page.getByRole('region', { name: 'Go mode' });
}
function steps(page: Page) {
  return page.getByRole('list', { name: 'Go mode steps' }).getByRole('listitem');
}

async function researchProject(page: Page, name: string, objective: string) {
  const id = await createProject(page, { workflow: 'Research', name, objective });
  // The first stage drafts itself on entry; let that land before Go starts.
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  return id;
}

async function choose(page: Page, policy: 'Guided' | 'Checkpoint' | 'Autonomous', budget?: number) {
  const panel = goPanel(page);
  await panel.getByRole('radio', { name: new RegExp(`^${policy}`) }).click();
  if (budget) await panel.getByLabel('Step budget').selectOption(String(budget));
  await panel.getByRole('button', { name: /^Go$/ }).click();
  if (policy !== 'Guided') {
    await expect(page.getByRole('dialog', { name: 'Authorize Go mode' })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`authorize-${policy.toLowerCase()}.png`) });
    await page.getByRole('button', { name: 'Authorize and go' }).click();
  }
}

async function runOf(projectId: string) {
  const [run] = await serviceSelect('agent_runs', `project_id=eq.${projectId}&select=*&order=created_at.desc&limit=1`);
  return run as { id: string; status: string; policy: string; steps_used: number; authorization_id: string | null; stop_reason: string };
}
async function stepsOf(runId: string) {
  return (await serviceSelect('agent_steps', `run_id=eq.${runId}&select=idx,action_key,status,execution_label,block_kind,params&order=idx`)) as {
    idx: number; action_key: string; status: string; execution_label: string | null; block_kind: string | null; params: Record<string, unknown>;
  }[];
}

test('Guided proposes one move and waits; Approve performs it, labelled as reasoning', async ({ page }) => {
  const id = await researchProject(page, 'E2E go guided', 'Pendulum period [[mock:plan=derive,prove]]');
  await choose(page, 'Guided');

  const prompt = page.getByRole('region', { name: 'Go mode needs your approval' });
  await expect(prompt).toContainText('Derive');
  await expect(prompt).toContainText('Why: Mock: derive is the next scripted move.');
  await page.screenshot({ path: test.info().outputPath('01-guided-proposal.png') });
  // Nothing was performed before approval.
  expect((await stepsOf((await runOf(id)).id)).map((s) => s.status)).toEqual(['awaiting_decision']);

  await prompt.getByRole('button', { name: 'Approve' }).click();
  await expect(steps(page).first()).toContainText('Analyzed');
  await expect(steps(page).first()).toContainText('Mock Derive');
  // …and the next move is proposed, not performed.
  await expect(prompt).toContainText('Prove');
  const transparency = page.getByRole('region', { name: 'What Go mode is doing' });
  await expect(transparency.locator('[data-field="Stage"]')).toHaveText('Research question');
  await expect(transparency.locator('[data-field="Next"]')).toContainText('Prove — waiting for your approval');
  await page.screenshot({ path: test.info().outputPath('02-guided-performed-and-next.png'), fullPage: true });

  const run = await runOf(id);
  expect(run.policy).toBe('guided');
  expect(run.authorization_id).toBeNull();
  expect(await stepsOf(run.id)).toMatchObject([
    { action_key: 'derive', status: 'succeeded', execution_label: 'discussed' },
    { action_key: 'prove', status: 'awaiting_decision' },
  ]);

  await prompt.getByRole('button', { name: 'Decline' }).click();
  await expect(page.getByRole('region', { name: 'What Go mode is doing' })).toContainText('You declined "Prove".');
  expect((await runOf(id)).status).toBe('stopped');
});

test('Checkpoint: reasoning runs on its own, code waits for approval, then runs and is interpreted', async ({ page }) => {
  const id = await researchProject(page, 'E2E go checkpoint', 'Pendulum period [[mock:plan=derive,run_computation]]');
  await choose(page, 'Checkpoint');

  const prompt = page.getByRole('region', { name: 'Go mode needs your approval' });
  // derive is not important: performed without asking. run_computation is.
  await expect(prompt).toContainText('Run a computation');
  await expect(steps(page).first()).toContainText('Analyzed');
  await page.screenshot({ path: test.info().outputPath('01-checkpoint-stops-before-code.png'), fullPage: true });

  await prompt.getByRole('button', { name: 'Approve' }).click();
  const compute = steps(page).nth(1);
  const interpret = steps(page).nth(2);
  await expect(compute).toContainText('Code executed');
  await expect(compute).toContainText('2 + 2 = 4');
  await expect(interpret).toContainText('Result interpreted');
  await expect(interpret).toContainText('The run printed 2 + 2 = 4');
  // The plan is done: declaring the objective complete is important, so it waits.
  await expect(prompt).toContainText('Objective complete');
  await page.screenshot({ path: test.info().outputPath('02-code-executed-and-interpreted.png'), fullPage: true });

  const run = await runOf(id);
  expect(run.policy).toBe('checkpoint');
  const recorded = await stepsOf(run.id);
  expect(recorded.slice(0, 3)).toMatchObject([
    { action_key: 'derive', execution_label: 'discussed' },
    { action_key: 'run_computation', status: 'succeeded', execution_label: 'code_executed' },
    { action_key: 'interpret_result', status: 'succeeded', execution_label: 'result_interpreted' },
  ]);
  const [sandbox] = await serviceSelect('sandbox_runs', `run_id=eq.${run.id}&select=id,status,exit_code,stdout`);
  expect(sandbox).toMatchObject({ status: 'ok', exit_code: 0, stdout: '2 + 2 = 4\n' });
  expect(recorded[2].params.sandbox_run_id).toBe(sandbox.id);

  // The authorization is an accepted proposal with its decision on the trail.
  const [auth] = await serviceSelect('recommendations', `id=eq.${run.authorization_id}&select=status,scope`);
  expect(auth).toMatchObject({ status: 'accepted', scope: { kind: 'agent_authorization', policy: 'checkpoint' } });
  const decisions = await serviceSelect('decisions', `recommendation_id=eq.${run.authorization_id}&select=decision_type`);
  expect(decisions).toEqual([{ decision_type: 'accept_recommendation' }]);
});

test('Autonomous moves stages on its own authority and stops, blocked, at data it does not have', async ({ page }) => {
  // check_literature no longer blocks (it searches OpenAlex), so the honest
  // stop is the planner's own mark_blocked — once Literature has been drafted:
  // nothing is stuck before it has been tried (2 Oct screenshots).
  const id = await researchProject(page, 'E2E go autonomous', 'Pendulum period [[mock:plan=derive,advance_stage,draft_stage,mark_blocked]]');
  await choose(page, 'Autonomous');

  const transparency = page.getByRole('region', { name: 'What Go mode is doing' });
  await expect(transparency).toContainText('Mock: missing data', { timeout: 30_000 });
  await expect(transparency.locator('[data-field="Status"]')).toContainText('Could not continue');
  await expect(steps(page).last()).toContainText('Could not continue');
  await page.screenshot({ path: test.info().outputPath('01-autonomous-blocked-on-missing-data.png'), fullPage: true });

  const run = await runOf(id);
  expect(run.status).toBe('blocked');
  expect(await stepsOf(run.id)).toMatchObject([
    { action_key: 'derive', status: 'succeeded' },
    { action_key: 'advance_stage', status: 'succeeded', execution_label: null },
    { action_key: 'draft_stage', status: 'succeeded' },
    { action_key: 'mark_blocked', status: 'blocked', execution_label: 'blocked', block_kind: 'data_missing' },
  ]);
  // The stage moves are the run's, cited and checked by the database.
  const moves = await serviceSelect(
    'workflow_events',
    `project_id=eq.${id}&agent_run_id=eq.${run.id}&select=type,actor,stage_id,payload&order=seq`
  );
  expect(moves).toHaveLength(2);
  expect(moves[0]).toMatchObject({ actor: 'system', stage_id: 'question' });
  expect(['stage_marked_complete', 'stage_advanced']).toContain(moves[0].type);
  expect(moves[1]).toMatchObject({ type: 'stage_blocked', actor: 'system', stage_id: 'literature' });
});

test('Stop mid-step cancels it and keeps nothing it would have produced', async ({ page }) => {
  // A revision would write a new version when it lands — so it is the move to stop.
  const id = await researchProject(page, 'E2E go stop', 'Pendulum [[mock:plan=revise_stage,prove]] [[mock:slow=5]]');
  await choose(page, 'Autonomous');
  // Wait until a step is actually in flight, then stop it.
  await expect(steps(page).first()).toHaveAttribute('data-step-status', 'running', { timeout: 20_000 });
  const versionsBefore = await serviceSelect('artifact_versions', `project_id=eq.${id}&select=id`);
  await goPanel(page).getByRole('button', { name: 'Stop' }).click();
  await expect(steps(page).first()).toHaveAttribute('data-step-status', 'cancelled');
  await page.screenshot({ path: test.info().outputPath('01-stopped.png'), fullPage: true });

  // Give the abandoned response time to arrive — it must be discarded.
  await page.waitForTimeout(6_000);
  const run = await runOf(id);
  expect(run.status).toBe('stopped');
  expect((await stepsOf(run.id)).map((s) => s.status)).toEqual(['cancelled']);
  expect(await serviceSelect('artifact_versions', `project_id=eq.${id}&select=id`)).toHaveLength(versionsBefore.length);
});

test('Refreshing mid-run resumes without repeating the interrupted step', async ({ page }) => {
  test.setTimeout(150_000);
  const id = await researchProject(page, 'E2E go resume', 'Pendulum [[mock:plan=derive,prove,simplify]] [[mock:slow=3]]');
  await choose(page, 'Autonomous');
  await expect(steps(page).first()).toHaveAttribute('data-step-status', 'running', { timeout: 20_000 });

  await page.reload();
  await expect(steps(page).first()).toHaveAttribute('data-step-status', 'interrupted', { timeout: 20_000 });
  await expect(steps(page).first()).toContainText('It was not repeated');
  // It carries on by itself, then stops for the user: the deliverable is not done.
  await expect(page.getByRole('region', { name: 'What Go mode is doing' })).toContainText('the deliverable is not', { timeout: 90_000 });
  await page.screenshot({ path: test.info().outputPath('01-resumed-after-refresh.png'), fullPage: true });

  const recorded = await stepsOf((await runOf(id)).id);
  expect(recorded.map((s) => s.idx)).toEqual(recorded.map((_, i) => i));
  expect(recorded[0]).toMatchObject({ action_key: 'derive', status: 'interrupted' });
  expect(recorded.filter((s) => s.action_key === 'derive')).toHaveLength(1);
  expect(recorded.map((s) => s.action_key)).toEqual(['derive', 'prove', 'simplify', 'declare_objective_complete']);
});

test('The step budget ends the run', async ({ page }) => {
  const id = await researchProject(
    page,
    'E2E go budget',
    'Pendulum [[mock:plan=derive,prove,simplify,limiting_case,try_contradiction,falsify_hypothesis,compare_alternatives]]'
  );
  await choose(page, 'Autonomous', 5);
  await expect(page.getByRole('region', { name: 'What Go mode is doing' })).toContainText('Used all 5 steps', { timeout: 30_000 });
  await expect(goPanel(page).getByLabel('Budget used')).toContainText('5 of 5 steps used in the last window');
  await page.screenshot({ path: test.info().outputPath('01-budget-exhausted.png'), fullPage: true });
  const run = await runOf(id);
  expect(run).toMatchObject({ status: 'budget_exhausted', steps_used: 5 });
  expect(await stepsOf(run.id)).toHaveLength(5);

  // B4: the window is the unit, not the project. Another window continues the
  // same run under the same authorization, and the click is on the record.
  const card = page.getByRole('region', { name: 'Go mode needs you' });
  await expect(card).toContainText('This window of 5 steps is used up');
  // The main button offers the same continuation, not a run that starts over.
  await expect(goPanel(page).getByRole('button', { name: /^Continue$/ })).toBeVisible();
  // A different size picked meanwhile is for a *new* run; the card continues
  // this one at its own size, and the selector must say so ("Window 12 steps"
  // beside "14 / 25 steps this window").
  await goPanel(page).getByLabel('Step budget').selectOption('12');
  await card.getByRole('button', { name: 'Continue for 5 more steps' }).click();
  await expect(page.getByRole('region', { name: 'What Go mode is doing' })).toContainText(/Objective complete|Nothing — the objective is met/, { timeout: 30_000 });
  await expect(goPanel(page).getByLabel('Step budget')).toHaveValue('5');
  await expect(goPanel(page).getByLabel('Budget used')).toContainText('3 / 5 steps');
  const next = await runOf(id);
  expect(next.id).not.toBe(run.id);
  expect(next).toMatchObject({ policy: 'autonomous', authorization_id: run.authorization_id });
  const [row] = await serviceSelect('agent_runs', `id=eq.${next.id}&select=continues_run_id`);
  expect(row.continues_run_id).toBe(run.id);
  // Two remaining scripted moves, then the plan declares the objective complete.
  const continued = await stepsOf(next.id);
  expect(continued.map((s) => s.action_key)).toEqual(['falsify_hypothesis', 'compare_alternatives', 'declare_objective_complete']);
  const decisions = await serviceSelect('decisions', `recommendation_id=eq.${run.authorization_id}&select=decision_type,metadata&order=created_at`);
  expect(decisions).toHaveLength(2);
  expect(decisions[1].metadata).toMatchObject({ continues_run_id: run.id });
  await page.screenshot({ path: test.info().outputPath('02-continued-window.png'), fullPage: true });
});

test('A sandbox that is not available blocks the step honestly — never "executed"', async ({ page }) => {
  const id = await researchProject(page, 'E2E go sandbox down', 'Pendulum [[mock:plan=run_computation]] [[mock:sandbox=unavailable]]');
  await choose(page, 'Autonomous');
  const transparency = page.getByRole('region', { name: 'What Go mode is doing' });
  await expect(transparency).toContainText('Code could not be run', { timeout: 30_000 });
  await expect(steps(page).first()).toContainText('Could not continue');
  await expect(steps(page).first()).not.toContainText('Code executed');
  await page.screenshot({ path: test.info().outputPath('01-sandbox-unavailable-blocked.png'), fullPage: true });

  const run = await runOf(id);
  expect(run.status).toBe('blocked');
  expect(await stepsOf(run.id)).toMatchObject([
    { action_key: 'run_computation', status: 'blocked', execution_label: 'blocked', block_kind: 'tool_missing' },
  ]);
  const [sandbox] = await serviceSelect('sandbox_runs', `run_id=eq.${run.id}&select=status,exit_code`);
  expect(sandbox).toEqual({ status: 'unavailable', exit_code: null });
});

test('A run making no progress stops for direction, and Resume carries on', async ({ page }) => {
  const id = await researchProject(page, 'E2E go no progress', 'Pendulum [[mock:plan=derive,derive,derive,prove]]');
  await choose(page, 'Autonomous');
  const transparency = page.getByRole('region', { name: 'What Go mode is doing' });
  await expect(transparency).toContainText('was chosen 3 times in a row on this stage without moving on');
  await page.screenshot({ path: test.info().outputPath('01-no-progress-stop.png'), fullPage: true });

  // Resuming is the user's direction to continue — it must not re-trip on the same three steps.
  await goPanel(page).getByRole('button', { name: 'Resume' }).click();
  // The three identical derives are one row with a count; Prove is the next row (2 Oct, screenshot 7).
  await expect(steps(page).nth(0)).toContainText('×3');
  await expect(steps(page).nth(1)).toContainText('Prove');
  await expect(transparency).toContainText('the deliverable is not');
  const recorded = await stepsOf((await runOf(id)).id);
  expect(recorded.map((s) => s.action_key)).toEqual(['derive', 'derive', 'derive', 'prove', 'declare_objective_complete']);
});

test('A question the run asks can be answered in place, and the answer is on the record', async ({ page }) => {
  const id = await researchProject(page, 'E2E go answer', 'Pendulum [[mock:plan=request_user_decision,prove]]');
  await choose(page, 'Autonomous');
  const ask = page.getByRole('region', { name: 'Go mode asks you' });
  await expect(ask).toContainText('Mock: which way should this go?');
  await ask.getByLabel('Your answer').fill('Focus on amplitudes below 30 degrees.');
  await page.screenshot({ path: test.info().outputPath('01-question-and-answer.png'), fullPage: true });
  await ask.getByRole('button', { name: 'Answer and continue' }).click();

  await expect(steps(page).nth(1)).toContainText('Your answer');
  await expect(steps(page).nth(2)).toContainText('Prove');
  const recorded = await stepsOf((await runOf(id)).id);
  expect(recorded.slice(0, 3).map((s) => s.action_key)).toEqual(['request_user_decision', 'user_answer', 'prove']);
});

/**
 * 4 Oct, production — Go asked for the Literature approval in its own words,
 * quoting the requirement, and the card offered only a text box ("it asks me
 * to tick something and there is no tick"). The quoted requirement is now the
 * button: ticking it records the approval and Go carries on.
 */
test('a question that asks for an approval offers the tick itself, and Go carries on', async ({ page }) => {
  const id = await createProject(page, {
    workflow: 'Research', name: 'E2E go asks approval',
    objective: 'Pendulum [[mock:plan=request_user_decision,prove]] [[mock:ask=lit-gap]]',
  });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: 'Literature context' })).toBeVisible();
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  await goPanel(page).getByRole('button', { name: 'Set up Go' }).click();
  await choose(page, 'Autonomous');

  const ask = page.getByRole('region', { name: 'Go mode asks you' });
  const tick = ask.getByRole('button', { name: 'Tick: “I agree this says what is not yet known, and that this work addresses it”' });
  await expect(tick).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath('01-question-offers-the-tick.png'), fullPage: true });
  await tick.click();

  await expect(steps(page).nth(1)).toContainText('Your answer', { timeout: 30_000 });
  await expect(steps(page).nth(2)).toContainText('Prove', { timeout: 30_000 });
  // The tick is a project field, saved on the debounce.
  await expect
    .poll(async () => (await serviceSelect('projects', `id=eq.${id}&select=manual_checks`))[0].manual_checks?.['lit.gap'], { timeout: 10_000 })
    .toBe(true);
  await page.screenshot({ path: test.info().outputPath('02-ticked-and-carried-on.png'), fullPage: true });
});

test('a draft longer than the planner excerpt still gets a next move', async ({ page }) => {
  await researchProject(page, 'E2E go long draft', 'Pendulum period [[mock:plan=derive]]');

  // Longer than ARTIFACT_EXCERPT_CHARS: the digest has to trim it to the
  // backend's cap, marker included, or the planner refuses the request (422).
  const artifact = stageArtifact(page);
  await artifact.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Edit Research question').fill('A long research question draft. '.repeat(700));
  await page.getByRole('button', { name: 'Save as new version' }).click();
  await expect(artifact.getByRole('button', { name: 'Edit' })).toBeVisible();

  await choose(page, 'Guided');
  const prompt = page.getByRole('region', { name: 'Go mode needs your approval' });
  await expect(prompt).toContainText('Derive');
  await expect(page.getByText(/longer than the 12,000-character limit/)).toHaveCount(0);
  await prompt.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('01-long-draft-gets-a-proposal.png') });

  // Previewing a stage ahead of the cursor says so, rather than "earlier".
  await page.getByRole('button', { name: /^Hypothesis/ }).first().click();
  await expect(page.getByRole('button', { name: /Viewing a later stage — back to/ })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('02-later-stage-banner.png') });
});
