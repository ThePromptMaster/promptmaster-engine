import path from 'node:path';

import { expect, test } from '@playwright/test';

import { dismissBetaNotice, serviceSelect } from './helpers';

/**
 * L-51 (7 Oct): the facts an attached document states are recorded by Go under
 * "Routine decisions: handle them for me", each quoted from its file. A fact
 * whose quote is not in the file is dropped.
 */
const FIXTURES = path.join(__dirname, '..', 'src', 'lib', 'data', '__fixtures__');

test('Go records the facts an attached brief states, citing the file, under the policy', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you want to do or figure out?').fill('Explain the margin decline to the board [[mock:plan=declare_objective_complete]]');
  await page.getByLabel('Attach files').setInputFiles(path.join(FIXTURES, 'brief.pdf'));
  await expect(page.getByRole('list', { name: 'Attached' })).toContainText('brief.pdf');
  await page.getByRole('button', { name: /Or choose the workflow yourself/ }).click();
  await page.getByRole('radio', { name: /^Single output/ }).click();
  await page.getByLabel('Project name').fill('E2E go facts');
  await page.getByRole('button', { name: /^Start / }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').at(-1)!;
  await expect(page.getByText('Mock output').first()).toBeVisible({ timeout: 30_000 });

  const panel = page.getByRole('region', { name: 'Go mode' });
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Handle them for me/ }).click();
  await expect.poll(async () => (await serviceSelect('projects', `id=eq.${id}&select=routine_decisions`))[0].routine_decisions).toBe('handle');
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();
  await page.getByRole('button', { name: 'Authorize and go' }).click();

  await expect.poll(async () => (await serviceSelect('project_facts', `project_id=eq.${id}&select=id`)).length, { timeout: 60_000 }).toBeGreaterThan(0);
  const facts = await serviceSelect('project_facts', `project_id=eq.${id}&select=statement,source_kind,source_ref,accepted_by,agent_run_id`);
  expect(facts).toHaveLength(1);
  expect(facts[0]).toMatchObject({ source_kind: 'file', accepted_by: 'policy', source_ref: { name: 'brief.pdf' } });
  expect(facts[0].statement).toContain('31.2%');
  expect(facts[0].agent_run_id).toBeTruthy();
  const facts_panel = page.getByRole('region', { name: 'Facts and requirements' });
  await expect(facts_panel).toContainText('accepted under your routine-decision policy', { timeout: 15_000 });
  await facts_panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('01-facts-from-the-brief.png') });
});
