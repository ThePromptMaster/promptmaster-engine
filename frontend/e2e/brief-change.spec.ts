import { expect, test } from '@playwright/test';

import { createProject, pressTransition, serviceSelect } from './helpers';

/**
 * C1 (Sean, 5 Oct, acceptance tests 4 and 5): "An authoritative input changes
 * from 'funding secured' to 'funding pending'. PromptMaster should identify
 * [what] relied on secured funding, mark [it] for appropriate review … Unaffected
 * work should remain valid." And: "The user corrects punctuation or formatting
 * without changing meaning … without reopening unrelated analysis."
 */
test('a factual change reopens only what relied on it; a punctuation fix reopens nothing', async ({ page }) => {
  test.setTimeout(120_000);
  const id = await createProject(page, { workflow: 'Book', name: 'E2E brief change', objective: 'A book about giraffes' });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await page.locator('#setup-context').fill('Funding is secured through Q3 2026.');
  // Settled before the stage is finished: nothing was finished yet, so nothing to recheck.
  await page.waitForTimeout(3_500);
  await pressTransition(page);
  await expect(page.locator('header').getByRole('heading', { name: /Audience/ })).toBeVisible();

  // A fact changes: the stage that relied on it is reopened, with why.
  await page.getByText('Project brief').click();
  await page.locator('#brief-context').fill('Funding is pending until Q3 2026.');
  const notice = page.getByRole('status', { name: 'Brief change' });
  await expect(notice).toContainText('Changing the project context reopened Objective', { timeout: 30_000 });
  await expect(notice).toContainText("relied on 'pending'");
  await expect(page.getByRole('navigation').getByText('recheck', { exact: true })).toHaveCount(1);
  const [changed] = await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.brief_changed&select=actor,payload`);
  expect(changed).toMatchObject({ actor: 'user', payload: { field: 'context', kind: 'fact', presentation_only: false } });
  // The invented stage id the mock adds was dropped.
  expect(changed.payload.affected.map((a: { stage_id: string }) => a.stage_id)).toEqual(['objective']);
  await notice.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('01-fact-change-reopens-what-relied-on-it.png') });

  // Kept as it was: the stage is finished again.
  await notice.getByRole('button', { name: 'Keep them as they are' }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByRole('navigation').getByText('recheck', { exact: true })).toHaveCount(0);

  // Punctuation only: recorded, nothing reopened, no model call.
  const calls: string[] = [];
  page.on('request', (r) => r.url().includes('/api/assess-change') && calls.push(r.url()));
  await page.locator('#brief-context').fill('Funding is pending until Q3, 2026');
  await expect.poll(async () => (await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.brief_changed&select=payload&order=created_at`)).length, { timeout: 15_000 }).toBe(2);
  const all = await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.brief_changed&select=payload&order=created_at`);
  expect(all[1].payload).toMatchObject({ kind: 'wording', presentation_only: true, affected: [] });
  expect(calls).toEqual([]);
  await expect(notice).toHaveCount(0);
  await expect(page.getByRole('navigation').getByText('recheck', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('02-punctuation-reopens-nothing.png') });
});
