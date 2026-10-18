import { expect, test, type Page } from '@playwright/test';

import { createProject, pressTransition, serviceSelect } from './helpers';

/**
 * 11 Oct, survey kickoff brief: "Go first stopped with 'The objective is not
 * met yet,' followed by wording describing the brief as satisfying the
 * requirements. It didn't identify a failed criterion or ask a specific
 * question … it says 'Your decision is needed' and waits for an answer
 * without specifying a decision."
 *
 * `[[mock:objective=noquote]]`: the check says "met" but quotes a heading,
 * both times it is asked. `[[mock:objective=criterion]]`: it names one
 * requirement unmet until a repair is on the run record.
 */
function goPanel(page: Page) {
  return page.getByRole('region', { name: 'Go mode', exact: true });
}

async function runGo(page: Page) {
  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();
}

test('a "met" the check could not quote is not shown as a failure, and the stop says what to decide', async ({ page }) => {
  test.setTimeout(120_000);
  const id = await createProject(page, {
    workflow: 'Single output',
    name: 'E2E objective no quote',
    objective: 'A survey kickoff brief [[mock:plan=declare_objective_complete]] [[mock:objective=noquote]]',
  });
  await pressTransition(page); // input
  await pressTransition(page); // review
  await expect(page.getByText('Mock output').first()).toBeVisible({ timeout: 30_000 });
  await runGo(page);

  const card = page.getByRole('region', { name: 'Go mode needs you' });
  await expect(card).toContainText('found nothing unmet', { timeout: 30_000 });
  await expect(card).not.toContainText('satisfies');
  await expect(card.getByRole('button', { name: 'Carry on' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Stop here' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'What Go has done' })).toContainText('Your decision is needed: “Carry on” or “Stop here”.');
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('01-no-quote-says-so-with-choices.png') });

  const [run] = await serviceSelect('agent_runs', `project_id=eq.${id}&select=status,needs&order=created_at.desc&limit=1`);
  expect(run.status).toBe('awaiting_decision');
  expect(run.needs).toMatchObject({ kind: 'objective_check', finding: 'no_evidence' });
  const [assessed] = await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.objective_assessed&select=payload`);
  expect(assessed.payload.reason).toContain('could not point to a passage');
  expect(assessed.payload.model_note).toContain('satisfies all of the requirements');
});

test('a requirement found unmet is named, and "Have Go fix it" repairs and checks again', async ({ page }) => {
  test.setTimeout(150_000);
  const id = await createProject(page, {
    workflow: 'Single output',
    name: 'E2E objective unmet criterion',
    objective: 'A survey kickoff brief [[mock:plan=declare_objective_complete]] [[mock:objective=criterion]]',
  });
  await pressTransition(page);
  await pressTransition(page);
  await expect(page.getByText('Mock output').first()).toBeVisible({ timeout: 30_000 });
  await runGo(page);

  const card = page.getByRole('region', { name: 'Go mode needs you' });
  await expect(card).toContainText('not met: Exactly four sections — It has two', { timeout: 30_000 });
  const fix = card.getByRole('button', { name: /^Have Go fix .+ and check again$/ });
  await expect(fix).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('02-unmet-named-with-fix.png') });

  const before = await serviceSelect('artifact_versions', `project_id=eq.${id}&select=id`);
  await fix.click();
  // The deliverable is repaired as a new version, then judged again.
  await expect.poll(async () => (await serviceSelect('artifact_versions', `project_id=eq.${id}&select=id`)).length, { timeout: 60_000 }).toBeGreaterThan(before.length);
  await expect.poll(async () => (await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.objective_assessed&select=id`)).length, { timeout: 60_000 }).toBeGreaterThan(1);
  await page.screenshot({ path: test.info().outputPath('03-fixed-and-checked-again.png'), fullPage: true });
});

test('a brief over its word limit is shortened, saved and checked again by Go, with no decision asked', async ({ page }) => {
  test.setTimeout(150_000);
  const id = await createProject(page, {
    workflow: 'Single output',
    name: 'E2E brief over its limit',
    objective: 'A survey kickoff brief under 30 words [[mock:plan=declare_objective_complete]]',
  });
  await pressTransition(page);
  await pressTransition(page);
  await expect(page.getByText('Mock output').first()).toBeVisible({ timeout: 30_000 });
  await runGo(page);

  // Shortened as routine work: a repair step that says what it measured.
  const card = page.getByRole('region', { name: 'Go mode needs you' });
  await expect(card).toContainText('The objective is met on', { timeout: 60_000 });
  await expect(card.getByRole('button', { name: /^Finish .+ and carry on$/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'What Go has done' })).toContainText(/revised Output to meet a requirement measured in code/i);
  await expect(page.getByText('Fix a measured requirement')).toBeVisible();
  await expect(card).not.toContainText('not met');
  const steps = await serviceSelect('agent_steps', `run_id=in.(${(await serviceSelect('agent_runs', `project_id=eq.${id}&select=id`)).map((r: { id: string }) => r.id).join(',')})&select=action_key,status,output,params&order=idx.asc`);
  const repair = steps.find((s: { action_key: string }) => s.action_key === 'recheck_stage');
  expect(repair).toMatchObject({ status: 'succeeded', params: { measured: true } });
  expect(repair.output).toMatch(/at most 30 words — \d+ words — measured in code on the saved text/);
  const versions = await serviceSelect('artifact_versions', `project_id=eq.${id}&select=content&order=version_number.asc`);
  expect(versions.at(-1).content).toContain('Shortened by the mock');
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('04-shortened-and-met.png') });
});

test('under "Handle them for me" a met objective carries on through the stages that are left, without asking', async ({ page }) => {
  test.setTimeout(180_000);
  const id = await createProject(page, {
    workflow: 'Single output',
    name: 'E2E brief handled to the end',
    objective: 'A survey kickoff brief under 30 words [[mock:plan=declare_objective_complete]]',
  });
  await pressTransition(page);
  await pressTransition(page);
  await expect(page.getByText('Mock output').first()).toBeVisible({ timeout: 30_000 });
  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Let Go run this' }).click();

  // 11 Oct, production retest: it stopped twice to ask whether to carry on.
  await expect.poll(async () => {
    const [run] = await serviceSelect('agent_runs', `project_id=eq.${id}&select=status&order=created_at.desc&limit=1`);
    return run?.status;
  }, { timeout: 120_000 }).toBe('completed');
  const runs = await serviceSelect('agent_runs', `project_id=eq.${id}&select=id,status,needs`);
  expect(runs.every((r: { needs: { kind?: string } | null }) => r.needs?.kind !== 'objective_check')).toBe(true);
  const steps = await serviceSelect('agent_steps', `run_id=in.(${runs.map((r: { id: string }) => r.id).join(',')})&select=action_key,output&order=idx.asc`);
  expect(steps.some((s: { output: string }) => /Carrying on under your routine-decision policy/.test(s.output ?? ''))).toBe(true);
  await expect(page.getByRole('region', { name: 'What Go has done' })).toContainText('Finished: the objective is verified as met.', { timeout: 30_000 });
  await page.getByRole('region', { name: 'What Go has done' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('05-handled-to-the-end.png') });
});
